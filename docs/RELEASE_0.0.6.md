# SNAS TV 0.0.6

Playback was down for every title: the provider's API began refusing this backend's requests, so no
source ever reached the app. This release is the backend repair, the automatic host tracking that
keeps it working when the provider moves again, and an app that says "the service is down" instead
of "this title can't play".

## What was wrong

On 2026-10-25 every `/v1/watch` answer was:

```json
{"error":"no stream provider is available right now",
 "detail":"no provider returned sources (tried miami, boise, vegas, reno, oakland, seattle)",
 "attempts":[{"provider":"miami","status":403,"reason":"seed request failed (HTTP 403)"}, …]}
```

All six mirrors failed at the *seed* request, before a single stream was looked up. The cause is a
Cloudflare rule in front of `api.wecollege.net`: it answers `403 Attention Required!` unless the
request carries a `Referer` from the provider's own site, and it accepts only the host the site is
serving from *today*. Measured against the live API:

| Referer sent | `/seed` answer |
|---|---|
| none, or a browser user-agent alone | `403` |
| `https://www.movy.bz/` (the site's previous host) | `403` |
| `https://example.com/`, a CDN host | `403` |
| `https://www.movy.sx/`, `https://movy.sx/` | `200` |

The backend sent only `accept`, so every request was refused. With the referer restored the same
requests answer `200`, the payload decrypts to four sources plus a master playlist, and the CDN
serves the variant playlist and segments (the CDN applies the same rule, which the app already
satisfies because the host travels to it in `headers`).

## What changed

- **Every upstream call sends the referer** — the Worker's direct transport, the relay function, and
  the live verification script.
- **The host is discovered, not hardcoded.** `worker/src/site.ts` asks the known seed domains where
  they point (`movy.bz` answers `301 https://www.movy.sx/` today), also reads the page's own
  `canonical`/`og:url`, caches the answer for 30 minutes, and re-resolves the moment the API
  answers `401`/`403`. A provider move therefore corrects itself on the next playback instead of
  taking the service down again — the failure this release exists to fix.
- **An operator can pin the host** with `UPSTREAM_SITE` (Cloudflare secret for the Worker, Supabase
  secret for the relay), which skips discovery entirely. This is the escape hatch if the provider
  moves somewhere its old domains no longer point to.
- **The CDN referer handed to the player is the same resolved host**, so a domain move follows
  through to playback rather than stopping at the API.
- **A failed discovery is remembered for a minute**, so a site that is unreachable costs one
  discovery, not two timeouts on every playback request.
- **The app tells the two failures apart.** A `5xx` from the source service now shows *"The source
  service is unavailable right now. Try again in a moment."* and logs
  `playback:source-unavailable status=…`; a title with no playable source keeps the old *"This title
  couldn't play"* copy. During this outage every title claimed to be unplayable, which is the
  misdiagnosis the change removes.

## Installation and compatibility

Install `snas-0.0.6.apk` with `adb install -r snas-0.0.6.apk` on an Android-based Fire TV with
developer access enabled. Package `com.snas.tv`; version name 0.0.6; version code 6; min SDK 24;
target SDK 35. Includes `arm64-v8a`, `armeabi-v7a` and `x86_64` native code.

The APK is built with Gradle's Release variant and signed with the repository's **Android debug
certificate**. It is a development/sideload build, not a production-signed Amazon Appstore artifact.
It is not a Vega OS VPKG.

## Verification

Backend: `npm --prefix worker test` 62 passed, `npm --prefix worker run typecheck` clean. The live
service was checked after deploying both halves: `/v1/watch` for a movie and for a TV episode each
answered `200` with four sources (`2160p, 1080p, 720p, 480p`), a master playlist and
`headers: {"referer":"https://www.movy.sx/"}`.

App: `npm run test:unit` 79 passed, `npm run test:player` 25 passed, `npm run typecheck` clean,
`npm run lint` 0 errors. The new tests cover the `5xx`-is-an-outage boundary, the discovery of a
moved host from a redirect and from a page's canonical link, the pinned override, the cache, and the
negative cache.

Playback on the emulator against the live backend is recorded in
[docs/QA_0.0.6.md](QA_0.0.6.md), including the rung chosen and the decoder's own line.

**No physical Fire TV was attached**, so the stick's decoder still has not run this build; nothing in
this release changes the playback path it exercises, which is documented in
[FIRETV_STICK_PLAYBACK.md](FIRETV_STICK_PLAYBACK.md).
