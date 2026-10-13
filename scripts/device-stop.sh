#!/usr/bin/env bash
set -euo pipefail
source /home/primeecto/vega/env
vega virtual-device stop || true
systemctl --user stop snas-vvd.service || true
