#!/usr/bin/env bash
#
# Collect the evidence a Fire TV playback failure leaves behind.
#
# The 1st-generation Fire TV Stick 4K (AFTMM) fails in a way the app itself cannot report: the
# decoder refuses to allocate, and the process is often torn down with it. What survives is the
# device's own log, so this script clears it, launches the app, waits while the title that fails is
# played, and then writes everything worth having into research/firetv/.
#
#   bash scripts/device-playback-probe.sh 192.168.1.42:5555     # a stick on the network
#   bash scripts/device-playback-probe.sh                        # the only attached device
#   ANDROID_SERIAL=emulator-5556 bash scripts/device-playback-probe.sh
#
# Developer options → ADB debugging must be on: Settings → My Fire TV → About → press select 7×,
# then Settings → My Fire TV → Developer Options → ADB debugging → On. The stick's address is in
# Settings → My Fire TV → About → Network.
#
# Read the result in this order (the script prints the same list at the end):
#
#   snas-playback.log      the app's own account of the session, tagged SNAS
#   crash.log              Java/Kotlin fatal exceptions, if the failure was a throwable
#   kernel-crash.log       native crashes (a decoder SIGSEGV/SIGABRT lands here as a tombstone)
#   lowmemory.log          the low-memory killer, if the process was killed for its memory
#   media.log              codec and streaming detail: createGraphicBuffer, ACodec, MediaCodec
#   meminfo.txt            the app's memory at the moment of collection
#   device.txt             model, API level, ABI, and the decoder's own declared limits
set -Eeuo pipefail

APP_ID=com.snas.tv
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/research/firetv"
ADB_BIN="${ADB:-/opt/android-sdk/platform-tools/adb}"
WAIT="${SNAS_PROBE_WAIT:-120}"

TARGET="${1:-${ANDROID_SERIAL:-}}"

adb_() {
  if [[ -n "$TARGET" ]]; then "$ADB_BIN" -s "$TARGET" "$@"; else "$ADB_BIN" "$@"; fi
}

if [[ ! -x "$ADB_BIN" ]]; then
  echo "no adb at $ADB_BIN — set ADB=/path/to/adb" >&2
  exit 1
fi

# A stick reached over the network has to be attached first. Anything already connected is left
# alone rather than reconnected: adb does not mind, but it re-resolves the port and can stall.
if [[ -n "$TARGET" && "$TARGET" == *:* ]]; then
  if ! "$ADB_BIN" devices | grep -q "^${TARGET}[[:space:]]*device"; then
    echo "connecting to $TARGET"
    "$ADB_BIN" connect "$TARGET"
  fi
fi

if ! adb_ get-state >/dev/null 2>&1; then
  echo "no device attached — pass the stick's ip:port or attach it over USB" >&2
  "$ADB_BIN" devices -l
  exit 1
fi

mkdir -p "$OUT"
MODEL="$(adb_ shell getprop ro.product.model | tr -d '\r')"
echo "device: $MODEL"

adb_ logcat -c || true
adb_ shell am force-stop "$APP_ID" || true
sleep 1

echo
echo "Launching SNAS. Open the title that fails and let it fail."
echo "Collecting in ${WAIT}s — Ctrl-C to collect early."
echo
adb_ shell monkey -p "$APP_ID" -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1 ||
  adb_ shell monkey -p "$APP_ID" 1 >/dev/null 2>&1 || true
sleep "$WAIT"

echo "collecting…"
adb_ logcat -d -v threadtime >"$OUT/snas-playback.log" 2>&1 || true
adb_ logcat -b crash -d -v threadtime >"$OUT/crash.log" 2>&1 || true
adb_ logcat -d -v threadtime | grep -iE "DEBUG|tombstone|signal [0-9]+|Fatal signal" >"$OUT/kernel-crash.log" 2>&1 || true
adb_ logcat -d -v threadtime | grep -iE "lmkd|lowmemorykiller|Kill|Out of memory|am_kill" >"$OUT/lowmemory.log" 2>&1 || true
adb_ logcat -d -v threadtime |
  grep -iE "media|codec|ACodec|CCodec|BufferQueue|ExoPlayer|createGraphicBuffer|gralloc" >"$OUT/media.log" 2>&1 || true
adb_ shell dumpsys meminfo "$APP_ID" >"$OUT/meminfo.txt" 2>&1 || true
adb_ shell dumpsys media.codec >"$OUT/media.codec.txt" 2>&1 || true
adb_ shell dumpsys activity processes >"$OUT/processes.txt" 2>&1 || true
{
  echo "model=$(adb_ shell getprop ro.product.model | tr -d '\r')"
  echo "build=$(adb_ shell getprop ro.build.version.release | tr -d '\r')"
  echo "sdk=$(adb_ shell getprop ro.build.version.sdk | tr -d '\r')"
  echo "fingerprint=$(adb_ shell getprop ro.build.fingerprint | tr -d '\r')"
  echo "abilist=$(adb_ shell getprop ro.product.cpu.abilist | tr -d '\r')"
  echo "package=$(adb_ shell dumpsys package "$APP_ID" | grep -m1 -E "versionName|primaryCpuAbi" | tr -d '\r')"
} >"$OUT/device.txt" 2>&1 || true

echo
echo "wrote $OUT/"
echo
echo "--- the app's own playback log (tag SNAS) ---"
grep -E "SNAS" "$OUT/snas-playback.log" | tail -25 || echo "(no SNAS lines: the app may not have started or the title was not opened)"
echo
echo "--- fatal exceptions ---"
grep -E "FATAL|AndroidRuntime" "$OUT/crash.log" | tail -12 || echo "(none)"
echo
echo "--- memory at collection ---"
grep -E "TOTAL PSS|Native Heap|Dalvik Heap" "$OUT/meminfo.txt" | head -6 || true
