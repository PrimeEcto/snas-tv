#!/usr/bin/env bash
set -euo pipefail
exec systemd-run --user --unit=snas-appium --collect -p CPUQuota=50% -p MemoryMax=1G -p Nice=15 /bin/bash -c 'source /home/primeecto/vega/env; export APPIUM_HOME=/data/SNAS/research/automation-home; export PATH=/home/primeecto/vega/sdk/vega-sdk/main/0.24.12112/workspace/env/KeplerCLIVegaDeviceAdaptor-2.0/runtime/bin:/data/SNAS/research/automation/node_modules/node-linux-x64/bin:$PATH; node /data/SNAS/research/automation/node_modules/appium/index.js --address 127.0.0.1 --port 4723 --log /data/SNAS/research/appium-server.log --log-level warn'
