#!/usr/bin/env bash
#
# Headless end-to-end journey on an Android device or emulator.
#
# The Fire OS build is an Android app, so this drives the installed APK over adb with remote
# key events only — no host mouse or keyboard injection — and records what the app renders.
# Two kinds of evidence are captured per journey: a native screenshot (`screencap`) and the
# accessibility tree (`uiautomator dump`), which is what the assertions read.
#
#   bash scripts/android-journey.sh                       # install dist/snas-<version>.apk, then journey
#   bash scripts/android-journey.sh --no-install          # journey against whatever is installed
#   ANDROID_SERIAL=emulator-5556 bash scripts/android-journey.sh path/to/app.apk
#   SNAS_JOURNEY_RESUME=playback bash scripts/android-journey.sh --no-install
#
# Playback is the journey that matters most, so it must show real decoding rather than a UI
# timer: an ExoPlayer/MediaCodec/HLS session in logcat *and* a clock that advances between two
# dumps taken a few seconds apart. Whichever of those held is written into the result detail.
#
# Results land in research/android/results.json with screenshots and trees beside them.
set -Eeuo pipefail

# A failing step has to say so: without this, `set -e` ends the run after the last PASS and the log
# reads as if the journey finished, which would hide whole sections from the record.
trap 'echo "harness: stopped at line $LINENO (exit $?)" >&2' ERR

APP_ID=com.snas.tv
ACTIVITY="$APP_ID/.MainActivity"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/research/android"
ADB_BIN="${ADB:-/opt/android-sdk/platform-tools/adb}"

# The default is this project's declared version, so bumping the version cannot leave the journey
# installing the APK of an older release.
APK="$ROOT/dist/snas-$(node -p "require('$ROOT/firetv/package.json').version").apk"
INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-install) INSTALL=0 ;;
    --*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) APK="$arg" ;;
  esac
done

RESUME="${SNAS_JOURNEY_RESUME:-}"
if [[ -n "$RESUME" && "$RESUME" != playback ]]; then
  echo "unknown SNAS_JOURNEY_RESUME mode: $RESUME" >&2
  exit 2
fi
[[ "$RESUME" == playback ]] && INSTALL=0

cd "$ROOT"
mkdir -p "$OUT"
RESULTS_TSV="$OUT/.results.tsv"
if [[ "$RESUME" == playback ]]; then
  # Seed only when this follow-up is actually run. Editing the harness never
  # rewrites the evidence of a standard journey that is still running.
  python3 - "$OUT/results.json" "$RESULTS_TSV" <<'RESUMEPY'
import json, pathlib, sys
report, target = map(pathlib.Path, sys.argv[1:])
if report.exists():
    rows = json.loads(report.read_text())
elif target.exists():
    rows = []
    for line in target.read_text().splitlines():
        fields = line.split('\t')
        if len(fields) == 4:
            rows.append(dict(zip(('journey', 'result', 'detail', 'evidence'), fields)))
else:
    raise SystemExit('Playback resume requires an existing standard journey report')
rows = [row for row in rows if row['journey'] not in ('Playback', 'Playback exit', 'Guest resources')]
if not rows:
    raise SystemExit('Playback resume found no non-playback results to preserve')
lines = []
for row in rows:
    evidence = row.get('evidence', [])
    if isinstance(evidence, list):
        evidence = ', '.join(evidence)
    values = (row['journey'], row['result'], row.get('detail', ''), evidence)
    lines.append('\t'.join(str(value).replace('\t', ' ').replace('\n', ' ') for value in values))
temporary = target.with_suffix('.resume.tmp')
temporary.write_text('\n'.join(lines) + '\n')
temporary.replace(target)
print(f"Playback resume: preserving {len(rows)} non-playback results")
RESUMEPY
else
  : > "$RESULTS_TSV"
fi

# Every adb call goes through here, so the serial is applied in exactly one place.
SERIAL="${ANDROID_SERIAL:-}"
adb_() {
  if [[ -n "$SERIAL" ]]; then "$ADB_BIN" -s "$SERIAL" "$@"; else "$ADB_BIN" "$@"; fi
}

step() { printf '\n== %s\n' "$1"; }

# ---------------------------------------------------------------- device selection ----------

# The Vega virtual device also answers on an emulator-xxxx serial, so a candidate is only
# accepted once it answers an Android property (a Vega device has no getprop at all).
resolve_device() {
  if [[ -n "$SERIAL" ]]; then
    echo "using ANDROID_SERIAL=$SERIAL"
    return 0
  fi
  local candidate
  while read -r candidate _; do
    [[ -n "$candidate" ]] || continue
    case "$candidate" in
      *offline*|*unauthorized*) continue ;;
    esac
    if "$ADB_BIN" -s "$candidate" shell getprop ro.build.version.sdk 2>/dev/null | grep -qE '[0-9]+'; then
      SERIAL="$candidate"
      echo "using Android device $SERIAL"
      return 0
    fi
  done < <("$ADB_BIN" devices | tail -n +2)
  echo 'no Android device found (a Vega virtual device does not count)' >&2
  return 1
}

# ------------------------------------------------------------------------- evidence ----------

# `uiautomator dump` reports an idle-state timeout on screens that are busy drawing, so retry it a
# few times with a settle between attempts. The file is always left behind, even empty, so a failed
# dump shows up as a failed assertion rather than as a silent pass.
dump() {
  local name="$1" attempt=0
  while (( attempt < 4 )); do
    if adb_ shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1 &&
       adb_ pull /sdcard/window_dump.xml "$OUT/$name.xml" >/dev/null 2>&1 &&
       [[ -s "$OUT/$name.xml" ]] && grep -q '<hierarchy' "$OUT/$name.xml"; then
      echo "$OUT/$name.xml"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1.5
  done
  : > "$OUT/$name.xml"
  echo "$OUT/$name.xml"
}

shot() { adb_ exec-out screencap -p > "$OUT/$1.png"; }

# Both `text` and `content-desc` matter here: RN renders labels as text and testID /
# accessibilityLabel as resource-id and content-desc.
labels() {
  python3 - "$1" <<'PY'
import html, re, sys
data = open(sys.argv[1], encoding='utf-8', errors='replace').read()
seen = []
for node in re.finditer(r'<node\b[^>]*>', data):
    for attr in ('text', 'content-desc'):
        value = re.search(attr + r'="([^"]*)"', node.group(0))
        if value and value.group(1):
            text = html.unescape(value.group(1))
            if text not in seen:
                seen.append(text)
print('\n'.join(seen))
PY
}

saw() { labels "$1" | grep -Fq -- "$2"; }

# The "My List (3)" / "Continue watching (2)" headings the library screens render. Matching them
# in a shell grep needs escapes that are easy to get wrong, so the pattern lives in Python here —
# and the tree is read from the file rather than piped in, so a large tree cannot break the pipe.
counts() {
  python3 - "$1" <<'PY'
import re, sys
data = open(sys.argv[1], encoding='utf-8', errors='replace').read()
print(' '.join(m.group(0) for m in re.finditer(r'My List \(\d+\)|Continue watching \(\d+\)', data)))
PY
}

# How many titles the My List screen says it holds; zero when it says nothing.
saved_count() {
  python3 - "$1" <<'PY'
import re, sys
data = open(sys.argv[1], encoding='utf-8', errors='replace').read()
match = re.search(r'content-desc="Saved, (\d+)"', data)
print(match.group(1) if match else 0)
PY
}

# The wholesale dump of everything on screen, for the result detail and for hand inspection.
summary() {
  labels "$1" | grep -vE '^[A-Z0-9]$' | head -8 | tr '\n' '|' | sed 's/|$//'
}

# The node Android currently has focused, so a nav step can be checked instead of assumed.
focused() {
  python3 - "$1" <<'PY'
import html, re, sys
data = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for node in re.finditer(r'<node\b[^>]*>', data):
    if 'focused="true"' not in node.group(0):
        continue
    for attr in ('text', 'content-desc'):
        value = re.search(attr + r'="([^"]*)"', node.group(0))
        if value and value.group(1):
            print(html.unescape(value.group(1)))
            raise SystemExit
PY
}

# Position of a control within a known left-to-right row (0-based), or -1 when it is not in it.
row_index() {
  local wanted="$1"; shift
  local i=0 id
  for id in "$@"; do
    [[ "$id" == "$wanted" ]] && { echo "$i"; return 0; }
    i=$((i + 1))
  done
  echo -1
}

# Does this tree contain that node at all? testIDs are exact where labels are not: "Add to My List"
# sits on browse cards as well as on a detail page, so a detail page is proven by its own controls.
saw_id() { grep -Fq "resource-id=\"$2\"" "$1"; }

# Wait for a screen that is identified by its controls rather than by its words.
await_id() {
  local name="$1" id="$2" tries="${3:-12}" attempt=0 xml=""
  while (( attempt < tries )); do
    xml="$(dump "$name")"
    if saw_id "$xml" "$id"; then echo "$xml"; return 0; fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "$xml"
  return 1
}

# The player's elapsed-time readout. The player tags it (testID="player-position"), so the reading
# comes from that node rather than from the first label shaped like a clock: the chrome also shows a
# "remaining" time beside it, and reading the wrong one made a playing stream look frozen at 0.
# An empty answer is normal (the chrome had faded by the time of the dump) and must not abort the run.
clock() {
  python3 - "$1" <<'PY'
import html, re, sys
data = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for node in re.finditer(r'<node\b[^>]*>', data):
    if 'resource-id="player-position"' not in node.group(0):
        continue
    value = re.search(r'text="([^"]*)"', node.group(0))
    if value and value.group(1):
        print(html.unescape(value.group(1)))
        break
PY
}
secs() { awk -F: '{ s=0; for (i=1; i<=NF; i++) s = s*60 + $i; print s }' <<<"$1"; }

# Poll the live hierarchy so a slow backend is not mistaken for a broken screen.
await_text() {
  local name="$1" needle="$2" tries="${3:-12}" attempt=0 xml=""
  while (( attempt < tries )); do
    xml="$(dump "$name")"
    if saw "$xml" "$needle"; then echo "$xml"; return 0; fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "$xml"
  return 1
}

# ------------------------------------------------------------------------ interaction ---------

# Remote keys by name. The bare names matter: `KEYCODE_UP` and `KEYCODE_CENTER` are not Android
# key codes — the D-pad ones are KEYCODE_DPAD_* — and an unknown name is accepted silently and
# delivered as nothing at all, which looks exactly like an app that ignores the remote.
keycode() {
  case "$1" in
    UP) echo KEYCODE_DPAD_UP ;;
    DOWN) echo KEYCODE_DPAD_DOWN ;;
    LEFT) echo KEYCODE_DPAD_LEFT ;;
    RIGHT) echo KEYCODE_DPAD_RIGHT ;;
    CENTER) echo KEYCODE_DPAD_CENTER ;;
    BACK) echo KEYCODE_BACK ;;
    *) echo "KEYCODE_$1" ;;
  esac
}
press() { adb_ shell input keyevent "$(keycode "$1")" >/dev/null; sleep "${2:-0.9}"; }

NOTE=""
note() { NOTE="${NOTE}${NOTE:+ · }$1"; }

record() { # journey result detail evidence
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$RESULTS_TSV"
  printf '%-4s %-14s %s\n' "$2" "$1" "$3"
}

# The tab bar, in the order it is rendered. Search is a tab like any other here; leaving it out
# shifts every later position and the walk below would aim at the wrong tab.
TABS=(Home Movies Series 'My List' Search About)

# The testID of the focused node, which is what identifies a control to the app's own screens
# (nav-Movies, home-play, details-play, …). Labels are not unique enough for this.
focused_id() {
  python3 - "$1" <<'PY'
import re, sys
data = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for node in re.finditer(r'<node\b[^>]*>', data):
    if 'focused="true"' not in node.group(0):
        continue
    match = re.search(r'resource-id="([^"]*)"', node.group(0))
    print(match.group(1) if match else '')
    break
PY
}  # Walk focus onto one tab and select it. Android's focus search is geometric and the app's bar
  # sits above its content, so a fixed number of presses is not portable: one step too far leaves
  # the bar and lands in a content rail. Every step is therefore observed and the direction is
  # chosen from where focus actually is — up climbs out of any rail into the bar, and inside the
  # bar left/right move between tabs.
goto_tab() {
  local name="$1" target=0 i id current
  for i in "${!TABS[@]}"; do [[ "${TABS[$i]}" == "$name" ]] && target="$i"; done
  for ((i = 0; i < 16; i++)); do
    id="$(focused_id "$(dump focus-watch)")"
    if [[ "$id" == "nav-$name" ]]; then press CENTER 1.6; return 0; fi
    # Focus can sit on an unlabelled container (an empty results list, a rail) instead of a control.
    # This walk wants the tab bar, and the bar is at the top of every screen, so it climbs.
    if [[ -z "$id" ]]; then press UP 0.4; continue; fi
    current=-1
    for i in "${!TABS[@]}"; do [[ "nav-${TABS[$i]}" == "$id" ]] && current="$i"; done
    if (( current >= 0 )); then
      if (( current < target )); then press RIGHT 0.3; else press LEFT 0.3; fi
    else
      press UP 0.3
    fi
  done
  echo "harness: could not reach the $name tab (focus was on '${id:-nothing}')" >&2
  return 1
}

# Walk focus onto one control and leave it there (the caller decides whether to select it).
# Same observed-walk idea as goto_tab, for any testID on the current screen: from the bar step
# down into the page, from the hero row step right, and from a rail climb up towards the hero.
focus_target() {
  local wanted="$1" x id direction i
  for ((i=0;i<32;i++)); do
    x="$(dump focus-watch)"; id="$(focused_id "$x")"
    [[ "$id" == "$wanted" ]] && return 0
    direction="$(python3 - "$x" "$wanted" <<'FOCUSPY'
import re,sys,xml.etree.ElementTree as E
nodes=list(E.parse(sys.argv[1]).iter('node'))
src=next((n for n in nodes if n.get('focused')=='true'),None)
target=next((n for n in nodes if n.get('resource-id')==sys.argv[2]),None)
if src is None or target is None: print('DOWN')
else:
 def center(n):
  a,b,c,d=map(int,re.findall(r'\d+',n.get('bounds','[0,0][0,0]')));return ((a+c)/2,(b+d)/2)
 x,y=center(src);tx,ty=center(target);dx,dy=tx-x,ty-y
 print(('DOWN' if dy>0 else 'UP') if abs(dy)>abs(dx) else ('RIGHT' if dx>0 else 'LEFT'))
FOCUSPY
)"
    press "$direction" 0.3
  done
  echo "harness: could not reach $wanted (focus was ${id:-nothing})" >&2; return 1
}

# The Home hero row is Play preview / View details / My List.
focus_home_button() {
  case "$1" in
    'Play preview') focus_target home-play ;;
    'View details') focus_target home-details ;;
    'My List') focus_target home-save ;;
    *) focus_target "$1" ;;
  esac
}

# ---------------------------------------------------------------------------- journeys --------

# The exact transport label is state, rather than a guess based on whether a
# key event was sent. MEDIA_PLAY_PAUSE is ignored while a source is loading.
player_toggle_label() {
  python3 - "$1" <<'TRANSPORTPY'
import re, sys, xml.etree.ElementTree as E
try:
    nodes = E.parse(sys.argv[1]).iter('node')
    for node in nodes:
        rid = node.get('resource-id', '').split(':id/')[-1]
        if rid == 'player-toggle':
            labels = [node.get('content-desc', ''), node.get('text', '')]
            labels += [child.get('text', '') for child in node.iter('node')]
            for label in labels:
                if label.strip() in ('Play', 'Pause', 'Replay'):
                    print(label.strip())
                    raise SystemExit
except (E.ParseError, OSError):
    pass
TRANSPORTPY
}

# Restrict codec evidence to this app process and this attempt (logcat is cleared
# immediately before launch). An ExoPlayer constructor or a URL alone is not a decoder.
playback_log() {
  local app_pid
  app_pid="$(adb_ shell pidof "$APP_ID" 2>/dev/null | tr -d '\r' | awk '{print $1}' || true)"
  if [[ "$app_pid" =~ ^[0-9]+$ ]]; then
    adb_ logcat -d --pid="$app_pid" 2>/dev/null || true
  fi
}

await_playback_decoder() {
  local attempt log
  for ((attempt=0; attempt<35; attempt++)); do
    log="$(playback_log)"
    printf '%s\n' "$log" > "$OUT/playback-session-logcat.txt"
    if grep -Eiq 'MediaCodec(Video|Audio)?Renderer|MediaCodec|CCodec|ACodec|OMX\.' <<< "$log"; then
      printf '%s\n' "$log" | grep -Ei 'MediaCodec(Video|Audio)?Renderer|MediaCodec|CCodec|ACodec|OMX\.' > "$OUT/playback-logcat.txt" || true
      return 0
    fi
    sleep 2
  done
  return 1
}

# Observe Play before returning a paused reading. If the first pause arrived
# during backend loading, the next attempt runs after a new observed tree and
# can pause the now-ready session. A paused player keeps its chrome visible.
# A Pause label is also handled explicitly, rather than treating a sent key as
# proof that playback stopped. There are no seek keys in this measurement.
pause_playback() {
  local name="$1" attempt xml label
  for ((attempt=0; attempt<8; attempt++)); do
    press MEDIA_PLAY_PAUSE 0.7
    press UP 0.4
    xml="$(dump "$name")"
    label="$(player_toggle_label "$xml")"
    if [[ "$label" == Play ]] && [[ -n "$(clock "$xml")" ]] && ! saw "$xml" 'Concept'; then
      echo "$xml"
      return 0
    fi
    if saw_id "$xml" player-retry || saw "$xml" 'Concept'; then
      echo "$xml"
      return 1
    fi
    echo "harness: waiting for paused native playback (attempt $((attempt+1)), transport=${label:-unavailable})" >&2
    sleep 2
  done
  echo "$xml"
  return 1
}

playback_exit_journey() {
  local xml leaving=0
  while (( leaving < 3 )); do
    press BACK 1.0
    xml="$(dump playback-exit)"
    if saw_id "$xml" home-details && ! saw_id "$xml" details-back && ! saw_id "$xml" player-reveal; then break; fi
    leaving=$((leaving + 1))
  done
  if saw_id "$xml" home-details && ! saw_id "$xml" details-back && ! saw_id "$xml" player-reveal; then
    record 'Playback exit' PASS 'Back exited the player to the hero on Home' 'playback-exit.xml'
  else
    record 'Playback exit' FAIL "Back did not return to Home; on screen: $(summary "$xml")" 'playback-exit.xml'
  fi
}

playback_journey() {
  step 'native playback'
  NOTE=""
  local xml clock_a='' clock_b='' label_a='' label_b='' codec=0 advanced=0 paused_a=0 paused_b=0
  if ! goto_tab Home || ! focus_target home-play; then
    record Playback FAIL 'could not focus the Home Play control' 'focus-watch.xml'
    report_resources
    return
  fi
  # Waiting for app-process codec work avoids firing the first toggle while the
  # backend is still resolving sources. UI state below remains authoritative.
  adb_ logcat -c >/dev/null 2>&1 || true
  press CENTER 0.5
  if await_playback_decoder; then
    codec=1
    sleep 2
  else
    note 'no app-process MediaCodec decoder evidence appeared within 70 seconds'
  fi
  if xml="$(pause_playback playback)"; then
    paused_a=1
    label_a="$(player_toggle_label "$xml")"
    clock_a="$(clock "$xml")"
    shot playback
    # A stable second reading proves the Play label corresponds to a paused
    # clock, rather than a toggle whose native side has not yet settled.
    sleep 2
    press UP 0.3
    xml="$(dump playback-chrome)"
    label_a="$(player_toggle_label "$xml")"
    if [[ "$label_a" != Play || "$(clock "$xml")" != "$clock_a" ]]; then
      paused_a=0
      note 'the first paused clock was not stable across two observations'
    fi
  else
    shot playback
    note "could not observe paused native transport; visible: $(summary "$xml")"
  fi

  if (( paused_a )); then
    # Both measurements require the observed Play label. Resume between them
    # without asking UIAutomator to idle on a moving clock: that idle wait is
    # exactly what used to outlast auto-hide. The second native position must
    # advance, so merely sending a resume key can never make this pass.
    press MEDIA_PLAY_PAUSE 0.5
    press UP 0.3
    shot playback-resumed
    sleep 12
    if xml="$(pause_playback playback-later)"; then
      paused_b=1
      label_b="$(player_toggle_label "$xml")"
      clock_b="$(clock "$xml")"
    else
      note 'could not observe the second paused native transport'
    fi
    shot playback-later
  fi

  playback_log > "$OUT/playback-session-logcat.txt"
  if grep -Ei 'MediaCodec(Video|Audio)?Renderer|MediaCodec|CCodec|ACodec|OMX\.' "$OUT/playback-session-logcat.txt" > "$OUT/playback-logcat.txt"; then
    codec=1
    note "app-process decoder evidence ($(wc -l < "$OUT/playback-logcat.txt") lines)"
  else
    codec=0
    note 'no app-process decoder evidence'
  fi
  if [[ -n "$clock_a" && -n "$clock_b" ]]; then
    note "native clock $clock_a -> $clock_b; paused labels ${label_a:-none}/${label_b:-none}"
    if (( $(secs "$clock_b") > $(secs "$clock_a") )); then advanced=1; fi
  else
    note "missing native clock readings (${clock_a:-none}/${clock_b:-none})"
  fi
  if (( paused_a && paused_b && advanced && codec )) && ! saw "$xml" 'Concept'; then
    record Playback PASS "$NOTE" 'playback.png, playback.xml, playback-chrome.xml, playback-resumed.png, playback-later.png, playback-later.xml, playback-logcat.txt'
  else
    record Playback FAIL "paused=${paused_a}/${paused_b} advanced=${advanced} decoding=${codec} · $NOTE" 'playback.png, playback.xml, playback-chrome.xml, playback-resumed.png, playback-later.png, playback-later.xml, playback-logcat.txt'
  fi
  # Resource capture is taken in the player. Leaving a paused native session
  # open does not masquerade as a CPU measurement of active decoding.
  if (( paused_b )); then press MEDIA_PLAY_PAUSE 0.5; fi
  report_resources
  playback_exit_journey
}

main() {
  step 'device'
  adb_ wait-for-device
  local boot=''
  for _ in $(seq 1 60); do
    boot="$(adb_ shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    [[ "$boot" == "1" ]] && break
    sleep 2
  done
  if [[ "$boot" != "1" ]]; then echo 'device never finished booting' >&2; exit 1; fi
  adb_ shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_ shell svc power stayon true >/dev/null 2>&1 || true
  # Deterministic frames: animations off keeps the dumps comparable between attempts.
  for scale in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb_ shell settings put global "$scale" 0 >/dev/null 2>&1 || true
  done
  echo "device ready: $(adb_ shell getprop ro.product.model | tr -d '\r') / Android $(adb_ shell getprop ro.build.version.sdk | tr -d '\r')"

  # A phone-profile emulator starts in Android's touch mode, where a view's programmatic
  # requestFocus() is refused, so nothing is focused and the first arrow key has nothing to move.
  # One key event leaves touch mode; a real Fire TV never enters it, having no touchscreen.
  adb_ shell input keyevent KEYCODE_DPAD_DOWN >/dev/null 2>&1 || true
  adb_ shell input keyevent KEYCODE_DPAD_UP >/dev/null 2>&1 || true

  local pkg
  pkg="$(adb_ shell dumpsys package "$APP_ID" 2>/dev/null | grep -E 'versionName|versionCode|primaryCpuAbi' | tr -d '\r' | tr '\n' ' ' || true)"
  echo "installed: ${pkg:-not installed}"

  if [[ "$RESUME" == playback ]]; then
    step 'resume playback only'
    adb_ shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
    adb_ shell am start -W -n "$ACTIVITY" >/dev/null
    if ! await_id playback-resume-home home-play 30 >/dev/null; then
      record Playback FAIL 'Home did not become ready for playback resume' 'playback-resume-home.xml'
      report_resources
      return
    fi
    playback_journey
    return
  fi

  if (( INSTALL )); then
    step "install $APK"
    if [[ ! -f "$APK" ]]; then echo "APK not found: $APK" >&2; exit 1; fi
    adb_ install -r -d "$APK"
    # The journey drives a fresh install. The collection, the watch positions and the saved titles
    # live in the app's own storage, so leftovers from an earlier run would let the "My List is
    # empty" leg pass for the wrong reason — and this is what a first launch on a new Fire TV looks
    # like anyway.
    adb_ shell pm clear "$APP_ID" >/dev/null 2>&1 || true
    pkg="$(adb_ shell dumpsys package "$APP_ID" 2>/dev/null | grep -E 'versionName|versionCode|primaryCpuAbi' | tr -d '\r' | tr '\n' ' ' || true)"
    echo "installed: ${pkg:-not installed}"
  fi

  step 'launch'
  adb_ shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
  adb_ logcat -c >/dev/null 2>&1 || true
  local xml
  adb_ shell am start -W -n "$ACTIVITY" >/dev/null
  sleep 2
  adb_ shell input keyevent KEYCODE_DPAD_DOWN >/dev/null 2>&1 || true
  adb_ shell input keyevent KEYCODE_DPAD_UP >/dev/null 2>&1 || true
  if xml="$(await_text launch 'Home' 24)"; then
    shot launch
    NOTE=""
    note "first paint: $(summary "$xml")"
    note "installed: ${pkg:-unknown}"
    record launch PASS "$NOTE" 'launch.png, launch.xml'
  else
    record launch FAIL "the app never painted a Home tab; on screen: $(summary "$xml")" 'launch.png, launch.xml'
  fi

  # ---- Home ---------------------------------------------------------------------------------
  NOTE=""
  goto_tab Home
  if xml="$(await_id home home-play 24)"; then
    shot home
    if saw "$xml" 'LIVE CATALOG'; then
      note 'live catalogue badge present (backend reachable from the device)'
    elif saw "$xml" 'SAMPLE CATALOG'; then
      note 'showing the SAMPLE catalog, not live data'
    fi
    if saw "$xml" 'Play preview' || saw "$xml" 'View details'; then
      note 'hero controls present'
    fi
    note "visible: $(summary "$xml")"
    record Home PASS "$NOTE" 'home.png, home.xml'
  else
    shot home
    record Home FAIL "no catalog badge on Home; on screen: $(summary "$xml")" 'home.png, home.xml'
  fi

  # ---- Movies / Series --------------------------------------------------------------------
  for tab in Movies Series; do
    NOTE=""
    goto_tab "$tab"
    if xml="$(await_id "browse-$(echo "$tab" | tr 'A-Z' 'a-z')" genre 26)"; then
      shot "browse-$(echo "$tab" | tr 'A-Z' 'a-z')"
      note "heading and filters present (Genre / Sort)"
      if saw "$xml" 'No titles in this category'; then note 'grid reported empty'; fi
      if saw "$xml" 'Try again'; then note 'the catalog request failed on screen'; fi
      note "visible: $(summary "$xml")"
      record "$tab" PASS "$NOTE" "browse-$(echo "$tab" | tr 'A-Z' 'a-z').png, browse-$(echo "$tab" | tr 'A-Z' 'a-z').xml"
    else
      shot "browse-$(echo "$tab" | tr 'A-Z' 'a-z')"
      record "$tab" FAIL "no browse filters rendered; on screen: $(summary "$xml")" "browse-$(echo "$tab" | tr 'A-Z' 'a-z').png, browse-$(echo "$tab" | tr 'A-Z' 'a-z').xml"
    fi
  done

  # ---- Search -------------------------------------------------------------------------------
  NOTE=""
  goto_tab Search
  if xml="$(await_id search key-A 24)"; then
    shot search
    # The screen carries its own letter grid, so a real query is typed with the remote alone: one
    # Select types a letter and the live backend search runs on it. The key is targeted explicitly
    # rather than assumed to be focused — this section once recorded a pass for a query that was
    # never typed, because it only checked that the screen had rendered.
    local typed=0 served=0
    if focus_target key-A; then
      press CENTER 1.5
      xml="$(dump search)"
      if saw "$xml" 'Search query: A'; then
        typed=1
        note 'one letter typed on the on-screen keyboard'
      else
        note "the letter key did not reach the query field (focused: $(focused "$xml"))"
      fi
    else
      printf '%s\n' 'harness: the on-screen keyboard never took focus' >&2
    fi
    if xml="$(await_text search-results 'shown for' 22)"; then
      served=1
      note "query ran against the backend: $(labels "$xml" | grep -E 'shown for|No matches|Searching' | head -1)"
    elif saw "$xml" 'No matches'; then
      served=1
      note 'query ran and returned a genuine empty state'
    else
      note 'no result line appeared for the query'
    fi

    if (( typed )) && (( served )); then
      note "visible: $(summary "$xml")"
      record Search PASS "$NOTE" 'search.png, search.xml'
    else
      record Search FAIL "typed=$typed served=$served · $NOTE" 'search.png, search.xml'
    fi
  else
    shot search
    record Search FAIL "search surface did not render; on screen: $(summary "$xml")" 'search.png, search.xml'
  fi

  # ---- My List, empty then populated from a detail page --------------------------------------
  NOTE=""
  goto_tab 'My List'
  if xml="$(await_id my-list-empty list-saved 22)"; then
    shot my-list-empty
    local saved_empty
    saved_empty="$(saved_count "$xml")"
    # The heading alone says nothing: what makes a collection screen empty is the empty copy and a
    # count of zero, so both are required before this leg is allowed to pass.
    if saw "$xml" 'No saved titles yet' && (( saved_empty == 0 )); then
      note "empty state on a fresh install · counts: $(counts "$xml")"
      record 'My List (empty)' PASS "$NOTE" 'my-list-empty.png, my-list-empty.xml'
    else
      record 'My List (empty)' FAIL "a fresh install should hold nothing, but saved=$saved_empty ($(counts "$xml"))" 'my-list-empty.png, my-list-empty.xml'
    fi
  else
    shot my-list-empty
    record 'My List (empty)' FAIL "My List never rendered; on screen: $(summary "$xml")" 'my-list-empty.png, my-list-empty.xml'
  fi

  NOTE=""
  goto_tab Home
  local opened=0
  if focus_home_button 'View details'; then
    press CENTER 3.0
    opened=1
  fi
  # A saved title says "Remove from My List" instead, so the state is tested rather than assumed;
  # a fallback inside one command substitution would capture both echoes and break the path.
  local details_ok=0
  if (( opened )); then
    if xml="$(await_id details details-play 18)"; then details_ok=1
    elif xml="$(await_id details details-save 4)"; then details_ok=1
    fi
  fi
  if (( details_ok )); then
    shot details
    local longest save_before save_after played=0 toggled=0
    longest="$(labels "$xml" | awk '{ print length($0) }' | sort -n | tail -1)"
    note "longest text block ${longest} chars (synopsis)"
    if saw_id "$xml" details-play; then
      played=1
      note 'Play control present'
    fi
    # The control toggles, so what proves the save is that it *changed*, in either direction: a
    # title already in the collection flips back to Add. Asserting one direction only reported a
    # working save as a failure depending on what an earlier run had left behind.
    save_before="$(labels "$xml" | grep -E 'Add to My List|Remove from My List' | head -1 || true)"
    # Save sits beside Play, but where focus actually is after the detail page opens is not ours
    # to assume: the walk observes it, so the control is reached rather than hoped for.
    if focus_target details-save; then
      press CENTER 2.0
    else
      echo 'harness: could not focus the save control' >&2
    fi
    if ! xml="$(await_text details-saved 'Remove from My List' 8)"; then
      xml="$(dump details-saved)"
    fi
    save_after="$(labels "$xml" | grep -E 'Add to My List|Remove from My List' | head -1 || true)"
    if [[ -n "$save_before" && -n "$save_after" && "$save_before" != "$save_after" ]]; then
      toggled=1
      note "save toggled on the detail page: ${save_before} → ${save_after}"
    elif [[ -n "$save_after" ]]; then
      note "save control unchanged (${save_after})"
    else
      note 'no save control on the detail page'
    fi
    if (( played )) && (( toggled )); then
      record 'Details + save' PASS "$NOTE" 'details.png, details.xml, details-saved.xml'
    else
      record 'Details + save' FAIL "played=$played toggled=$toggled · $NOTE" 'details.png, details.xml, details-saved.xml'
    fi
  else
    shot details
    record 'Details + save' FAIL 'could not reach a detail page from Home' 'details.png, details.xml'
  fi

  NOTE=""
  goto_tab 'My List'
  xml="$(await_id my-list list-saved 22)"
  shot my-list
  if (( $(saved_count "$xml") > 0 )); then
    note "saved title listed: $(counts "$xml")"
    note "visible: $(summary "$xml")"
    record 'My List (saved)' PASS "$NOTE" 'my-list.png, my-list.xml'
  else
    note "visible: $(summary "$xml")"
    record 'My List (saved)' FAIL "the saved title is not listed: $(counts "$xml")" 'my-list.png, my-list.xml'
  fi

  # ---- A relaunch keeps the collection -------------------------------------------------------
  # The collection is the app's own storage, so what proves it was written is a new process reading
  # it back: the app is stopped, started again, and the same title looked for. This is the launch
  # path the update check runs on as well.
  NOTE=""
  adb_ shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
  sleep 2
  adb_ shell am start -n "$ACTIVITY" >/dev/null 2>&1 || true
  goto_tab 'My List' || true
  xml="$(await_id my-list-relaunch list-saved 26)" || true
  shot my-list-relaunch
  if (( $(saved_count "$xml") > 0 )); then
    note "the collection survived a relaunch: $(counts "$xml")"
    record 'Relaunch persistence' PASS "$NOTE" 'my-list-relaunch.png, my-list-relaunch.xml'
  else
    record 'Relaunch persistence' FAIL "the saved title was gone after a relaunch: $(counts "$xml")" 'my-list-relaunch.png, my-list-relaunch.xml'
  fi

  # ---- About --------------------------------------------------------------------------------
  NOTE=""
  goto_tab About
  focus_target settings-About
  press CENTER 0.6
  if xml="$(await_text about 'TMDB' 24)"; then
    shot about
    note 'TMDB attribution present'
    if saw "$xml" 'Catalog: live TMDB discovery'; then
      note 'running on the live catalog'
    elif saw "$xml" 'Catalog: genuine sample records'; then
      note 'running on the sample catalog'
    fi
    note "visible: $(summary "$xml")"
    record About PASS "$NOTE" 'about.png, about.xml'
  else
    shot about
    record About FAIL "About did not render its attribution; on screen: $(summary "$xml")" 'about.png, about.xml'
  fi

  playback_journey
}

# What the app costs the guest while it is doing the most work (the player is still open).
report_resources() {
  step 'guest resources'
  adb_ shell dumpsys meminfo "$APP_ID" > "$OUT/meminfo.txt" 2>/dev/null || true
  adb_ shell dumpsys cpuinfo > "$OUT/cpuinfo.txt" 2>/dev/null || true
  adb_ shell top -n 1 -b > "$OUT/top.txt" 2>/dev/null || adb_ shell top -n 1 > "$OUT/top.txt" 2>/dev/null || true
  adb_ shell dumpsys package "$APP_ID" 2>/dev/null | grep -E 'versionName|versionCode|primaryCpuAbi|nativeLibraryDir' > "$OUT/package.txt" || true
  NOTE=""
  local captured=1
  if grep -q 'TOTAL PSS' "$OUT/meminfo.txt" 2>/dev/null; then
    note "$(grep -m1 'TOTAL PSS' "$OUT/meminfo.txt" | tr -s ' ')"
  else
    note 'meminfo unavailable'
    captured=0
  fi
  note "$(cat "$OUT/package.txt" 2>/dev/null | tr -d '\r' | tr '\n' ' ')"
  if (( captured )); then
    record 'Guest resources' PASS "$NOTE" 'meminfo.txt, cpuinfo.txt, top.txt, package.txt'
  else
    record 'Guest resources' FAIL "$NOTE" 'meminfo.txt, cpuinfo.txt, top.txt, package.txt'
  fi
  echo '--- meminfo ---'
  grep -E 'TOTAL PSS|TOTAL RSS|App Summary|Java Heap|Native Heap' -A1 "$OUT/meminfo.txt" 2>/dev/null | head -12 || true
  echo '--- top (app rows) ---'
  grep -E "PID|$APP_ID" "$OUT/top.txt" 2>/dev/null | head -8 || true
  echo '--- package ---'
  cat "$OUT/package.txt" 2>/dev/null || true
}

resolve_device
main

# ---------------------------------------------------------------------------- report ----------

python3 - "$RESULTS_TSV" "$OUT/results.json" <<'PY'
import json, sys
rows = []
for line in open(sys.argv[1], encoding='utf-8'):
    parts = line.rstrip('\n').split('\t')
    if len(parts) != 4:
        continue
    journey, result, detail, evidence = parts
    rows.append({
        'journey': journey,
        'result': result,
        'detail': detail,
        'evidence': [item.strip() for item in evidence.split(',') if item.strip()],
    })
json.dump(rows, open(sys.argv[2], 'w', encoding='utf-8'), indent=2)
failed = sum(1 for row in rows if row['result'] == 'FAIL')
passed = sum(1 for row in rows if row['result'] == 'PASS')
skipped = sum(1 for row in rows if row['result'] == 'SKIP')
print(f"\n{passed} passed, {failed} failed, {skipped} skipped — {sys.argv[2]}")
sys.exit(0)
PY

failed=$(awk -F'\t' '$2=="FAIL"' "$RESULTS_TSV" | wc -l)
if (( failed > 0 )); then
  echo "journeys failed: $failed" >&2
  exit 1
fi
