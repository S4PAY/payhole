#!/bin/bash
# Boots a headless emulator, installs an APK, and screenshots the Home tab, the Resolver check,
# and About. Use it to look at a build before handing it to anyone.
#
#   scripts/emulator-shots.sh dist/payhole-0.1.3-release.apk /tmp/shots
#
# Needs ANDROID_HOME with the emulator package, platform-tools, and an AVD (default "payhole",
# override with AVD=name). KVM must be usable by the current user.
set -u
APK="${1:?apk path}"; OUT="${2:?output directory}"; AVD="${AVD:-payhole}"
mkdir -p "$OUT"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

log() { echo "[$(date +%H:%M:%S)] $*"; }

if ! adb devices | grep -q "emulator-"; then
  log "starting emulator $AVD"
  nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -memory 2048 \
    > "$OUT/emulator.log" 2>&1 < /dev/null &
  adb wait-for-device
fi
for _ in $(seq 1 150); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
log "booted: $(adb shell getprop sys.boot_completed | tr -d '\r')"
for key in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$key" 0 >/dev/null
done

log "installing $APK"
adb install -r -g "$APK" 2>&1 | tail -1
adb shell am start -W -n org.payhole.app/.MainActivity >/dev/null 2>&1
sleep 6
adb exec-out screencap -p > "$OUT/home.png"
log "home screenshot: $OUT/home.png"

# Taps a control by its visible text or accessibility label, using the accessibility tree.
tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml > "$OUT/ui.xml"
  python3 - "$OUT/ui.xml" "$1" <<'EOF'
import re, subprocess, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
label = sys.argv[2]
for node in re.finditer(r"<node [^>]*>", xml):
    n = node.group(0)
    if f'text="{label}"' in n or f'content-desc="{label}"' in n:
        m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        x = (int(m.group(1)) + int(m.group(3))) // 2
        y = (int(m.group(2)) + int(m.group(4))) // 2
        subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)], check=False)
        print(f"tapped {label} at {x},{y}")
        break
else:
    print(f"not found: {label}")
EOF
}

tap_text "Resolver"; sleep 2
tap_text "Check resolver"; sleep 5
adb exec-out screencap -p > "$OUT/resolver.png"
log "resolver screenshot: $OUT/resolver.png"
tap_text "About"; sleep 2
adb exec-out screencap -p > "$OUT/about.png"
log "about screenshot: $OUT/about.png"
