#!/usr/bin/env bash
set -euo pipefail
source /home/primeecto/vega/env
export KEPLER_CSAT_DISABLED=true
# No GUI or input grab. All descendants stay in this resource-limited cgroup.
exec systemd-run --user --unit=snas-vvd --collect -p CPUQuota=150% -p MemoryMax=4G -p MemoryHigh=4G -p Nice=15 -p IOSchedulingClass=idle -p WorkingDirectory=/data/SNAS -p RemainAfterExit=yes /bin/bash -c 'source /home/primeecto/vega/env; export KEPLER_CSAT_DISABLED=true; export QT_QPA_PLATFORM=offscreen; vega virtual-device start --no-gui --display-res=1920,1080 --timeout 180'
