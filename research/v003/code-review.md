# Independent source review

The final code reviewer examined current source/diff and reported three actionable regressions:

1. Subtitle changes recreated the media source and replayed an old seek command.
2. Browse Try again restarted page 1 after a later page failed.
3. A native playback error after controls auto-hide left recovery hidden.

Each was reproduced with a mounted regression before correction. The adapter now deduplicates seeks by URI/target/command identity, pagination records the failed page and retains accumulated titles, and entering unavailable playback reveals recovery and closes any sheet. The reviewer independently rechecked all three and ran the then-current 13 mounted tests successfully, reporting no remaining actionable regressions in that source review scope.

A later native catalog capture exposed Home's sentence parser splitting `L.A.`. A fourteenth mounted regression reproduced it; Home now uses a bounded word-boundary excerpt. Native remote and decoder behavior are recorded separately; this review is not a physical Fire TV certification.

A final full player/Android adapter regression reproduced repeated Replay failing at the same target. Seek commands now carry the existing shared serial into the native adapter, so two Replay requests at position zero are distinct while subtitle reloads retain the same command identity. The full integration regression expects native seeks `[600, 0, 0]`; the final mounted suite contains 16 tests.

A separate narrow source review independently checked the final command-identity fix and its actual Screen/Android adapter regression, reporting no findings. Native execution was subsequently verified by the standard decoded-playback journey.
