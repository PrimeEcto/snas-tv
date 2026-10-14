#!/usr/bin/env bash
# Build the Fire OS (Android) APK from this umbrella project.
#
# The screens come from the parent project's src/, bundled by Metro here, so this APK carries the
# same UI the Vega package does and the two builds cannot drift apart. An Android build is by far
# the heaviest thing this repository does, so it runs inside one resource-limited cgroup and
# without a lingering Gradle daemon, exactly like the Vega build script does.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"
VERSION="$(node -p "require('./package.json').version")"
# Gradle 9 and AGP want a JDK the Kotlin toolchain supports; 17 is what React Native 0.83 targets.
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
export NODE_OPTIONS=--max-old-space-size=2048
APK="$ROOT/dist/snas-$VERSION.apk"

echo "building SNAS $VERSION (JAVA_HOME=$JAVA_HOME, ANDROID_HOME=$ANDROID_HOME)"
systemd-run --user --scope -p CPUQuota=250% -p MemoryMax=5G -p MemorySwapMax=0 nice -n 15 \
  ./android/gradlew -p android assembleRelease --no-daemon

mkdir -p "$ROOT/dist"
cp android/app/build/outputs/apk/release/app-release.apk "$APK"
sha256sum "$APK" | awk '{print $1}' > "$APK.sha256"
echo "wrote $APK ($(stat -c %s "$APK") bytes)"
