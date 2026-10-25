# SNAS backend

The Fire TV app plays nothing on its own. This backend reverse-engineers the public
source API that `movy.sx` uses in the browser, decrypts it server-side, and returns
playable HLS URLs plus an OpenSubtitles menu. The device never contacts `movy.sx`,
`api.wecollege.net` or OpenSubtitles directly, so no third-party credentials, keys or
headers ship in the app package.

It is a single Cloudflare Worker named `snas-movy`
(`worker/wrangler.toml`), deployed at <https://snas-movy.blockmindmcp.workers.dev>, plus two
Supabase edge functions on project `cwfflqvzzkzytxuaxahy`: `tmdb`, the catalogue proxy the
device reads TMDB through, and `movy-relay`, the upstream fetch relay that the egress
limitation below forces.

The catalogue is separate from the source API. It comes from the `tmdb` function
(`supabase/functions/tmdb/index.ts`), an allow-listed read-only TMDB proxy that keeps the
credential in the function's own environment variables (`TMDB_API_KEY` for a v3 key, or
`TMDB_READ_TOKEN` for a v4 read access token). The app ships no TMDB key and has no field to
enter one; the Worker calls that same proxy when it has to resolve a title.

## Data flow

1. The device calls `GET /v1/watch` with a TMDB id (and optionally the title). Without a
   title the Worker resolves it through the `tmdb` proxy.
2. The Worker fetches a seed: `GET https://api.wecollege.net/seed?mediaId=<tmdbId>`.
   The `mediaId` is the TMDB id, not the internal id.
3. The Worker fetches `GET https://api.wecollege.net/<provider>/sources?...&enc=2&seed=<seed>`.
   Each provider slug is a mirror/quality tier.
4. The response body is base64url of `mvm1` followed by the JSON payload XORed with a
   keystream derived from the seed and media id. `worker/src/streamcrypto.ts` reproduces the
   site's PRNG, including the detail that its 61-slot state array must stay **sparse** (an
   array hole and a stored `0` mix differently). This is why the port is byte-exact and
   locked by a captured fixture rather than by inspection.
5. Sources are sorted high-quality to low and returned with the mirror that served them.
6. Subtitles come from `https://subtitles.vidy.st/search?id=<tmdbId>` (the OpenSubtitles
   source the site itself uses), optionally `&season=<n>&episode=<n>`. Rows are grouped per
   language; a single track is served as WebVTT through this Worker, with SRT converted on
   the fly (`worker/src/subtitles.ts`).

## Endpoints

| Method | Path | Required query | Returns | Supabase TTL (s) |
| --- | --- | --- | --- | --- |
| GET | `/` or `/health` | none | `service`, `version`, `ok`, `time`, `endpoints` | none |
| GET | `/v1/providers` | none | `providers[]` (slug, name, note) and `default[]` failover order | none (HTTP `max-age=86400`) |
| GET | `/v1/watch` | `tmdbId`, and `title` unless `TMDB_PROXY_URL` is set | sources plus `headers`, `subtitleGroups[]` / `subtitleCount` in one round trip | 600 |
| GET | `/v1/sources` | same as `/v1/watch` | sources only: `provider`, `note`, `sources[]`, `headers`, `attempts[]`, `cached` | 600 |
| GET | `/v1/subtitles` | `tmdbId`, and `title` unless `TMDB_PROXY_URL` is set | `groups[]` of `SubtitleRecord`, `count`, `cached` | 21600 |
| GET | `/v1/subtitle/<id>.vtt` | `tmdbId` plus the same title rule | one track as `text/vtt`, SRT converted to WebVTT | 86400 |
| GET | `/v1/app/latest` | none (`currentVersion` for the device's own build) | `updateAvailable`, `currentVersion`, `latest` release manifest, APK asset first | none (HTTP `max-age=300`) |
| GET | `/v1/app/asset/<name>` | none | release asset bytes proxied from the private repository | none |
| GET | `/v1/app/latest?channel=beta` | none | same, but prereleases are eligible | none (HTTP `max-age=300`) |

Shared query parameters:

- `type` is `movie` (default) or `tv`; anything else is a `400`.
- `season` and `episode` must be supplied **together**, and only for `type=tv`.
- `year`, `imdb`, `totalSeasons` are passed through to the upstream query when present.
- `provider` (single slug) or `providers` (comma-separated) override the default failover order.
- `fresh=1` (or `fresh=true`) bypasses the Supabase cache and this isolate's seed cache. A
  relayed deployment keeps its seed cache inside `movy-relay`, so `fresh=1` does not force a
  new seed there; a stale seed is instead refreshed automatically by the relay's own 401/403
  retry, which is the case that matters.
- `title` is required only when `TMDB_PROXY_URL` is not configured; with it, the Worker
  resolves title, year and IMDb id through the catalogue proxy and reports
  `resolvedFromTmdb: true`.

Error behaviour: `400` for missing/invalid `tmdbId`, a bad `type`, half an episode pair, an
invalid subtitle id, or a missing title; `404` for an unknown subtitle track or asset; `415`
when a track's format cannot be served as WebVTT (for example `ssa`); `502` when a subtitle
download fails or when every mirror fails (the response then carries `attempts[]`); `503`
when the underlying error itself carried HTTP 429.

## Examples

`tmdbId=969681` is *Spider-Man: Brand New Day*, the title used throughout the reverse
engineering.

```bash
BASE=https://snas-movy.blockmindmcp.workers.dev

# Service banner and version.
curl -s "$BASE/health"

# Mirrors a server picker can show, plus the default order.
curl -s "$BASE/v1/providers"

# Sources and the subtitle menu in one call: the device's main entry point.
curl -s "$BASE/v1/watch?tmdbId=969681&type=movie&title=Spider-Man%3A%20Brand%20New%20Day&year=2026&imdb=tt22084616"

# Sources only, restricted to two mirrors, bypassing the cache. The reply also carries the
# `headers` block the player has to send with the stream (see "Playing the returned sources").
curl -s "$BASE/v1/sources?tmdbId=969681&type=movie&title=Spider-Man%3A%20Brand%20New%20Day&providers=miami,boise&fresh=1"

# Subtitle menu for a series episode.
curl -s "$BASE/v1/subtitles?tmdbId=1399&type=tv&season=1&episode=1&title=Game%20of%20Thrones"

# One track as WebVTT, using the id from the menu above.
curl -s "$BASE/v1/subtitle/<id>.vtt?tmdbId=969681&title=Spider-Man%3A%20Brand%20New%20Day"

# Update check for a device that is running 0.1.0.
curl -s "$BASE/v1/app/latest?currentVersion=0.1.0"
```

## Providers and failover

`worker/src/movy.ts` holds all 18 slugs from the site's own client:

| Slug | Note | Slug | Note |
| --- | --- | --- | --- |
| `miami` | Original audio. May have 4K | `austin` | Original audio, multi-language mirror |
| `boise` | Original audio. May have 4K | `dallas` | Original audio |
| `vegas` | Original audio | `tampa` | Original audio |
| `reno` | Original audio | `orlando` | Original audio |
| `oakland` | Original audio | `munich` | German audio (sends `language=german`) |
| `seattle` | Original audio | `berlin` | German audio |
| `phoenix` | Original audio | `paris` | French audio |
| `atlanta` | Original audio | `delhi` | Hindi audio |
| `portland` | Original audio | `cancun` | Spanish audio |

The default failover order is `miami, boise, vegas, reno, oakland, seattle`. Failover runs
server-side with a 150 ms stagger between mirrors, because the upstream rate-limits hard and
walking all 18 at once reliably triggers HTTP 429. The first mirror that returns at least one
source wins; providers that answer but return no sources are skipped too. Every response
includes `attempts[]`, listing each mirror tried with its HTTP status and the reason it was
skipped, so a failure is diagnosable from the client.

## Playing the returned sources

A source URL on its own is not playable. The stream CDN answers `403` with an HTML body to a
request that carries no `Referer`, and `200 application/vnd.apple.mpegurl` once it is sent;
changing only the `User-Agent` left the `403` in place. Measured on the live CDN for
`tmdbId=969681`: with `referer: https://www.movy.sx/` the master playlist returned 4 variants
and one variant playlist returned 1451 segments.

Every response that carries sources therefore carries the headers to send with them —
`headers: { "referer": "https://www.movy.sx/" }`, top-level beside `sources`, identically for
`/v1/watch` and `/v1/sources`. The player attaches them to the master playlist, to every
variant playlist and to every segment request.

### The referer follows the provider's host

The host in that header is the provider's *current* one, and it is discovered rather than written
down, because the provider moves (`movy.bz` → `movy.sx`). Measured on 2026-10-25: the API
(`api.wecollege.net/seed`) answers `403 Attention Required!` to a request with no `Referer`, with a
browser `User-Agent` alone, with the old host `https://www.movy.bz/`, or with any unrelated host —
and `200` only for `https://www.movy.sx/` or `https://movy.sx/`. Every mirror failed at the seed
until that header was restored.

`worker/src/site.ts` resolves the host: the seed domains `movy.sx` and `movy.bz` are asked where
they point (`movy.bz` answers `301 https://www.movy.sx/`), the page's own `canonical`/`og:url` is
read as well, and the answer is cached for 30 minutes. A `401`/`403` from the API clears that cache
and the request is retried once with the re-resolved host, so a move corrects itself on the next
playback. A failed discovery is remembered for a minute so an unreachable site does not cost two
timeouts per request. `UPSTREAM_SITE` pins the host and skips discovery entirely.

The same resolved host is what the player is told to send to the CDN, so the two cannot disagree.

## Releases and the update check

The repository is private, so the device cannot read GitHub and must not carry a token. The
Worker holds a fine-grained `Contents: read` token and exposes only two things: the latest
release manifest and the asset bytes, streamed through. `src/update.ts` on the device asks
`/v1/app/latest?currentVersion=<running>` once per launch and only ever *reports* a newer
build; installing it is a host-side action.

A release is cut from this machine (both toolchains are local), which is what
`scripts/release-app.mjs` does. The artifact names are a contract, because the manifest the
device reads and the upload have to agree:

| Asset | Target | Notes |
| --- | --- | --- |
| `snas-<version>.apk` | Fire OS / Fire TV | Built by `firetv/scripts/build-apk.sh`; installed with `adb install -r`. Listed **first** in the manifest. |
| `snas_<arch>.vpkg` | Vega virtual device | Built by `npm run build:tv`. |
| `version.json` | — | Sizes and SHA-256 digests of everything above. |

The tag is `v<version>` and `scripts/release-app.mjs` refuses to release when the version in
`package.json` (what the app reports at runtime) or `firetv/package.json` (what Android writes
into the APK) disagrees with it, so a running build can never be told a different version
exists. `--apk-only` and `--vpkg-only` narrow a release to one artifact.

```bash
node scripts/release-app.mjs --dry-run     # what would be built and uploaded
node scripts/release-app.mjs               # build, tag v<version>, upload, publish
node scripts/release-app.mjs --skip-build  # release what is already in dist/
```

## Configuration

`.env` at the repository root (git-ignored, written with mode 600) is the single source of
truth for deployment secrets, and `.env.example` is its template. Function secrets are
pushed with `supabase secrets set --env-file .env --project-ref cwfflqvzzkzytxuaxahy`, which
sets `TMDB_API_KEY` and `RELAY_SECRET` on the project; this CLI version needs the explicit
`--project-ref` because it will not resolve the linked project on its own. Worker-only
secrets are still set with `cd worker && wrangler secret put <NAME>` or in the Cloudflare
dashboard. None of them belong in the repository, and `CloudflareCredentials/` and
`worker/.dev.vars` are git-ignored. `worker/.dev.vars.example` is the local template.

| Name | Purpose | Optional |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL for the durable cache (`worker/src/cache.ts`) | no for caching; the API works without it |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used over PostgREST | no for caching; the API works without it |
| `SUPABASE_DB_PASSWORD` | Read only by the Supabase CLI, for `supabase db push` | yes; nothing at runtime reads it |
| `GITHUB_REPO` | `owner/name` of the private repository used by `/v1/app/latest` | yes; without it the endpoint returns `latest: null` |
| `GITHUB_TOKEN` | Fine-grained PAT with `Contents: read` on that repository | yes; the repo is private, so it is required for real releases |
| `TMDB_PROXY_URL` | The `tmdb` function's URL, so the device may send only `tmdbId` | yes |
| `ALLOWED_ORIGINS` | CORS allow-list; defaults to `*` because the API is read-only | yes |
| `UPSTREAM_RELAY_URL` | The `movy-relay` function's URL. Without it the Worker fetches upstream directly and gets HTTP 429 | yes, but required in practice |
| `UPSTREAM_RELAY_SECRET` | Shared secret sent as `x-relay-secret`; must equal the function's `RELAY_SECRET` | yes, but required in practice |
| `UPSTREAM_SITE` | Pins the provider's site host (the `Referer` its API and CDN require), e.g. `https://www.movy.sx/`. Left unset, it is discovered from the seed domains; set it when the provider moves somewhere its old domains no longer point to | no |

The relay speaks two request shapes, both with an `x-relay-secret` header, and both carry the
`referer` the Worker resolved: the API answers `403` to any request without one from the current
site host, and the relay's own egress is the fallback if none is supplied. A plain fetch is
`POST {"url":"...","referer":"..."}`, answering
`{"status":<upstream status>,"body":"<raw upstream body>","referer":"<host used>"}`.
The seeded fetch is the one the Worker uses:
`POST {"seedUrl":"...","url":"...{{seed}}...","referer":"..."}` makes the relay request the
seed, substitute it into the URL and fetch that too, answering
`{"status":...,"body":...,"seed":"<seed used>","referer":"<host used>"}` — or
`{"seedStatus":<status>,"status":<status>,"body":"","seed":"","referer":"..."}` when the seed
request itself failed, so a rate limit on the seed is never reported as a mirror failure. A `401`
or `403` on the sources request is treated as a stale seed *or* a host the provider has moved away
from: the relay clears both and retries once. The host it echoes back is the one the Worker then
hands the player for the CDN. Both requests happen inside one invocation because the upstream
binds a seed to the
client that asked for it (see below).

The relay allow-lists three upstream origins — `api.wecollege.net`, `trailers.wecollege.net`
and `subtitles.vidy.st` — so it is never an open proxy: a missing or wrong secret is `401`,
and a foreign origin is `403`.

## Supabase

The project is dedicated to SNAS: `public` holds the four tables below and nothing else, and
the only deployed functions are `tmdb` and `movy-relay`. Applying this directory's single
migration is the whole setup — the CLI needs `SUPABASE_DB_PASSWORD` for it, and a shell that
sources `.env` must not expand `$` characters inside that password, or the CLI reports
`password authentication failed for user "postgres"` while the password itself is correct.

Caching is best-effort by design: with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
unset, `createCache` returns a no-op handle, so reads always miss and writes are dropped
without a network call, and a request never fails because the cache did. Both are set in
production, so caching is live: a repeated `/v1/watch` answers `cached: true` and came back
in ~330 ms against ~1150 ms for the upstream round trip. The Worker reaches Supabase over
PostgREST (no SQL driver) with keys namespaced as `movy:<key>`.

The same project hosts both edge functions: `tmdb` needs `TMDB_API_KEY` (or
`TMDB_READ_TOKEN`) and `movy-relay` needs `RELAY_SECRET`. Both are declared with JWT
verification off in `supabase/config.toml`, because the device holds no Supabase JWT.

Apply the migration with the Supabase CLI or the SQL editor:

```bash
supabase db push      # or paste supabase/migrations/0001_movy_cache.sql into the SQL editor
```

| Table | Stores |
| --- | --- |
| `movy_stream_cache` | Decrypted source payloads, keyed by title identity plus the provider list |
| `movy_subtitle_cache` | OpenSubtitles search results, and converted WebVTT blobs keyed by subtitle id |
| `movy_watch_progress` | Continue Watching rows per device and title/episode |
| `movy_devices` | Known installs so progress rows can be attributed |

All four enable row level security with no policies: the service role bypasses RLS, so only
the Worker's server-side key can read or write.

## Running and deploying

```bash
cd worker
npm install
npm run dev            # wrangler dev on the local runtime
npm run typecheck      # Workers types for src, Node types for tests and scripts
npm test               # offline unit tests
npm run verify:live    # hits the real upstreams end to end
npm run verify:live -- --keep   # also rewrites test/fixtures/streamcrypto.json
npm run deploy         # wrangler deploy
```

`npm run verify:live -- --keep` is the only way the regression fixture is produced, and it
must be rerun whenever the reverse-engineered upstream changes shape: the fixture is
captured from a real seed/ciphertext/plaintext triple.

Deploying needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment (a
user-scoped API token fails the `/user` endpoints that `wrangler whoami` uses, which is
expected; the account-scoped token deploys normally).

The Supabase functions deploy separately, from the repository root:

```bash
supabase secrets set --env-file .env --project-ref cwfflqvzzkzytxuaxahy
supabase functions deploy tmdb --project-ref cwfflqvzzkzytxuaxahy
supabase functions deploy movy-relay --project-ref cwfflqvzzkzytxuaxahy
```

## Upstream egress and the relay

**A direct upstream fetch from the Cloudflare Worker fails with HTTP 429.**

Observed evidence: `/v1/watch` on the deployed Worker returns `502` with
`attempts[]` showing `seed request failed (HTTP 429)` for every provider, while the same
`GET https://api.wecollege.net/seed?mediaId=969681` from an ordinary host returns `200`, and
a non-Cloudflare datacenter relay also returns `200`. Changing the `User-Agent` (including
sending none) does not change the result. The upstream is rate-limiting Cloudflare's shared
egress IPs, not rejecting the request shape.

Without a relay, `/v1/watch` and `/v1/sources` are not usable from the deployed Worker
(`502`, or `503` when the thrown error carries 429). `/health`, `/v1/providers` and
`/v1/app/latest` behave normally, and the subtitle paths are unreachable in practice for the
same reason, since `/v1/watch` fails before it reaches them.

The fix is `movy-relay`, deployed at
<https://cwfflqvzzkzytxuaxahy.supabase.co/functions/v1/movy-relay>. It performs only the
upstream HTTP fetch from a different egress; failover and decryption stay in the Worker, so
the cipher still lives in exactly one place. Point the Worker at it with
`UPSTREAM_RELAY_URL` and `UPSTREAM_RELAY_SECRET`. Verified live: the relay's seed fetch
returns upstream `200` while the deployed Worker's direct fetch returns `429`, a missing or
wrong `x-relay-secret` is `401`, and a non-allow-listed origin is `403`.

The relay also removes a second constraint, measured the same way: the upstream binds a seed
to the client that requested it. A seed fetched through the relay and used from anywhere else
answers `401 STREAMCRYPTO_SEED_INVALID`, and so does the reverse — seed from the host with the
sources request through the relay — while host plus host passes with identical headers. That
is why the seed and the request derived from it have to be one pair inside a single relay
invocation, and why the Worker's relay transport sends a `{{seed}}` template instead of a
seed of its own.

## Verifying

- `npm test` runs offline regression tests: the captured crypto fixture decrypts
  byte-for-byte, a wrong seed is rejected, the sparse-state keystream is deterministic,
  `srtToVtt` output is checked, subtitle grouping is checked, the Supabase cache degrades to
  a no-op and swallows failures, and the GitHub release manifest/version comparison behaves.
  Handler tests drive every route with a mocked `fetch`, so routing, validation, sorting and
  status codes are covered without touching the network.
- `npm run verify:live` proves the chain against the real services: seed, encrypted
  `/sources`, TypeScript decryption, the tampered-payload guard, the OpenSubtitles menu
  (many languages) and an SRT-to-WebVTT conversion of a real downloaded track.
- Neither proves a device can play the returned HLS, and neither covers the Cloudflare
  egress limitation above, which only appears from the deployed Worker.
