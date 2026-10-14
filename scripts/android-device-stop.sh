#!/usr/bin/env bash
# Stop the headless Android emulator started by scripts/android-device-start.sh.
#
# It stops exactly the device it started — by AVD port through `adb emu kill`, falling back to the
# recorded PID — rather than a broad `pkill -f emulator`, which can match the stopping shell itself
# or an unrelated emulator someone else is using.
set -euo pipefail
PORT="${SNAS_EMULATOR_PORT:-5556}"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="$SDK/platform-tools/adb"

if "$ADB" -s "emulator-$PORT" get-state >/dev/null 2>&1; then
  echo "stopping emulator-$PORT"
  "$ADB" -s "emulator-$PORT" emu kill >/dev/null 2>&1 || true
fi

PIDFILE="$ROOT/research/android-emulator.pid"
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  # Only signal it if it is genuinely the emulator binary we launched.
  if [ -n "$PID" ] && tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null | grep -q 'emulator/qemu/linux-x86_64/qemu-system-x86_64-headless'; then
    kill "$PID" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
fi
echo "emulator-$PORT stopped"
