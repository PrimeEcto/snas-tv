#!/usr/bin/env bash
# Start the headless Android emulator the Fire OS APK is tested on.
#
# Two things about device fidelity, both learned the hard way:
#
# 1. The emulator must not have a touchscreen. A real Fire TV stick has none, and Android stays
#    out of touch mode on such a device, so `View.requestFocus()` and `hasTVPreferredFocus`
#    are honoured the moment a screen mounts. Give the AVD a touchscreen and Android sits in
#    touch mode instead, silently refusing every programmatic focus request until a D-pad key
#    is pressed — which reads exactly like "the app never focuses anything", and sent an
#    earlier round of testing chasing a focus bug the app did not have. The AVD config is
#    rewritten here so the emulator behaves like the hardware.
# 2. It is detached (setsid) and bounded by its own `-memory` / `-cores` flags, with the log kept
#    on disk. An emulator that dies with the shell that started it is worse than none: the
#    failure looks like an app crash, and a stale screen in a dump reads like an app bug.
#
#   bash scripts/android-device-start.sh     # boot on port 5556 (5554/5555 belong to the VVD)
#   bash scripts/android-device-stop.sh      # stop it again
set -euo pipefail
# Prefixed names on purpose: a bare PORT is commonly exported by other tooling, and an empty or
# non-numeric value here would be handed to `emulator -port`, which refuses to start.
PORT="${SNAS_EMULATOR_PORT:-5556}"
AVD="${SNAS_EMULATOR_AVD:-firestick_sim}"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${LOG:-/tmp/snas-android.log}"

export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
export ANDROID_SDK_ROOT="$SDK"

CONFIG="$ANDROID_AVD_HOME/$AVD.avd/config.ini"
[ -f "$CONFIG" ] || { echo "no AVD config at $CONFIG" >&2; exit 1; }

# Enforce TV input fidelity every start, so the device cannot drift back into touch mode.
set_config() {
  if grep -qE "^$1[[:space:]]*=" "$CONFIG"; then
    sed -i -E "s|^$1[[:space:]]*=.*|$1 = $2|" "$CONFIG"
  else
    printf '%s = %s\n' "$1" "$2" >> "$CONFIG"
  fi
}
set_config hw.screen no-touch      # the point of the whole exercise: no touchscreen, no touch mode
set_config hw.dPad yes
set_config hw.keyboard no
set_config hw.mainKeys yes
set_config hw.touchpad0 no

if (exec 3<>"/dev/tcp/localhost/$PORT") 2>/dev/null; then
  exec 3>&- 3<&-
  echo "port $PORT is already in use — emulator already running?" >&2
  exit 1
fi

echo "starting $AVD on port $PORT (log: $LOG)"
cd "$ROOT"
setsid nohup "$SDK/emulator/emulator" -avd "$AVD" -port "$PORT" \
  -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect -memory 2048 -cores 2 \
  -netdelay none -netspeed full >"$LOG" 2>&1 </dev/null &
echo $! > "$ROOT/research/android-emulator.pid"
disown || true

# Wait for the device to answer, then for the boot to complete. Bounded: a device that never
# boots should fail the run rather than hang it.
ADB="$SDK/platform-tools/adb"
for _ in $(seq 1 60); do
  state="$("$ADB" -s "emulator-$PORT" get-state 2>/dev/null || true)"
  [ "$state" = device ] && break
  sleep 2
done
"$ADB" -s "emulator-$PORT" wait-for-device
for _ in $(seq 1 90); do
  [ "$("$ADB" -s "emulator-$PORT" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  sleep 2
done
BOOTED="$("$ADB" -s "emulator-$PORT" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"

# The system image still presents a touchscreen whatever the AVD asks for, and Android therefore
# boots into touch mode, where every programmatic focus request is refused. One D-pad key leaves
# it — and nothing in the harness ever touches the screen, so it stays out. This is what a real
# Fire TV looks like from the app's side, having no touchscreen at all.
if [ "$BOOTED" = 1 ]; then
  "$ADB" -s "emulator-$PORT" shell input keyevent KEYCODE_DPAD_DOWN >/dev/null 2>&1 || true
  "$ADB" -s "emulator-$PORT" shell input keyevent KEYCODE_DPAD_UP >/dev/null 2>&1 || true
  TOUCH_MODE="$("$ADB" -s "emulator-$PORT" shell dumpsys input 2>/dev/null | grep -m1 'TouchMode: ' | tr -d '\r' || true)"
fi

echo "device emulator-$PORT is $([ "$BOOTED" = 1 ] && echo booted || echo 'not booted')${TOUCH_MODE:+ (${TOUCH_MODE# } )}"
