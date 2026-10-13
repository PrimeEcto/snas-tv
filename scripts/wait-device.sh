#!/usr/bin/env bash
set -euo pipefail
source /home/primeecto/vega/env
for attempt in $(seq 1 40); do
  if timeout 8s vega device info -d VirtualDevice 2>/dev/null | rg -q '"profile": "tv"'; then
    vega exec vda shell 'touch /tmp/automation-toolkit.enable'
    echo 'Native TV services ready'
    exit 0
  fi
  sleep 3
done
echo 'Device services did not become ready under the configured resource cap' >&2
exit 1
