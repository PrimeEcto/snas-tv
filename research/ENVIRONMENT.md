# Environment record — 2026-10-13

Pop!_OS 24.04 LTS x86_64, Intel i9-11900KF, 32 GB RAM, NVIDIA RTX 4070 Super (hardware supplied by user). Workspace /data/SNAS initially empty and not a Git repository. 144 GB free space at setup.

Installed extension amazon-devices.kepler-studio-0.24.1-linux-x64 retained. Official installer was downloaded and reviewed before execution; noninteractive mode skipped extension reinstall. User-local CLI 1.4.4 and SDK 0.24.12112 installed at /home/primeecto/vega/sdk/vega-sdk/main/0.24.12112. KVM access available via ACL; no privileged host package changes required. Installer verifies download integrity. Official template helloWorld targets RN 0.83, React 19.2, kepler runtime4; manifest targets OS1.2.

Actual device reports: VirtualDevice, x86_64, tv, vvrp-tv-x64, OS1.2 (TV Ship/102401320), simulated true, inDeveloperMode true. It is the official VVD, not Android Fire OS.

After the user reported a mouse grab from the first visible run, all remaining work was kept inline and headless. No further foreground emulator or host input manipulation. snas-vvd.service caps CPU at150% and memory at4GB, Nice15. Builds capped similarly with two Metro workers. Appium runs at CPU50%, memory1GB.

Initial headless no-gl-accel attempt exposed no usable compositor; normal headless mode works. Native QMP screendump yielded a black framebuffer and was discarded as app evidence. The supported Appium screenshot API captures the actual Vega compositor correctly.

A fresh userdata control was created after inconsistent package-manager/shell discovery. Prior userdata files are preserved in research/vvd-data-backup. CLI readiness appears before all native services are usable; wait for valid device info before installation. A minimal native RN screen ran correctly.

Current SDK CLI does not expose legacy sdk doctor/validate-sdk commands in its installed help. Verification used SDK version/list, actual official template native builds, manifest validation (0 errors), package creation, device info, installation, launch, and Appium UI inspection.

Official references consulted:
- https://developer.amazon.com/docs/vega/0.24/install-vega-sdk
- https://developer.amazon.com/docs/vega/0.24/hello-world
- https://developer.amazon.com/docs/vega/0.24/run-apps
- https://developer.amazon.com/docs/vega/0.24/focus-management
- https://developer.amazon.com/docs/vega/0.24/kvd-issues
- https://developer.amazon.com/docs/vega/0.24/appium-install
- https://developer.amazon.com/docs/vega/0.24/appium-commands

Later diagnosis: a 3GB MemoryHigh threshold introduced reclamation stalls; it was aligned with the unchanged 4GB hard maximum. Startup also encountered LCM AppNotResponding / Lifecycle Callback / Creating surfaces. The documented per-app development timeout override let the process remain alive, but a render alone was not counted as a passed interaction test. Override was cleared before a final clean headless VVD restart, following Amazon's guidance for broken app/service connections. No syscall filtering, permissions or security checks were disabled.
