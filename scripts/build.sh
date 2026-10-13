#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source /home/primeecto/vega/env
export NODE_OPTIONS=--max-old-space-size=2048
# Bound all bundler/compiler descendants, not merely the shell process.
systemd-run --user --scope -p CPUQuota=150% -p MemoryMax=4G -p MemorySwapMax=0 nice -n 15 npx react-native build-vega --build-type Release --target x86_64

mkdir -p dist
cp 'build/private/kepler/@amazon-devices/snas/undefined/vega/x86_64/Release/@amazon-devices/snas_x86_64.vpkg' dist/snas_x86_64.vpkg
