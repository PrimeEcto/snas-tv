/**
 * Smoke test for a deployed (or local) SNAS backend.
 *
 *   npm run smoke                                   # against the deployed Worker
 *   npm run smoke -- http://127.0.0.1:8787          # against `wrangler dev`
 *   npm run smoke -- <base> --require-sources       # fail if upstream is unreachable
 *
 * Three outcomes are reported per check:
 *   PASS     the endpoint behaved correctly
 *   BLOCKED  the upstream refused this egress (HTTP 429/502/503). Expected while the
 *            Worker talks to api.wecollege.net directly; see docs/BACKEND.md.
 *   FAIL     anything else, which fails the run.
 *
 * `--require-sources` turns BLOCKED into FAIL, which is what you want once the upstream
 * relay is configured and sources must actually work.
 */
const base = (process.argv[2] && !process.argv[2].startsWith('-')
  ? process.argv[2]
  : process.env.SNAS_API_BASE ?? 'https://snas-movy.blockmindmcp.workers.dev').replace(/\/+$/, '');
const requireSources = process.argv.includes('--require-sources');

/** Spider-Man: Brand New Day — present on the site and used during reverse engineering. */
const TITLE = 'Spider-Man%3A%20Brand%20New%20Day';
const WATCH = `/v1/watch?tmdbId=969681&type=movie&title=${TITLE}&year=2026&imdb=tt22084616`;

type Outcome = 'pass' | 'blocked' | 'fail';
const results: { name: string; outcome: Outcome; detail: string }[] = [];

function record(name: string, outcome: Outcome, detail: string): void {
  results.push({ name, outcome, detail });
  const label = outcome === 'pass' ? 'PASS   ' : outcome === 'blocked' ? 'BLOCKED' : 'FAIL   ';
  console.log(`${label} ${name.padEnd(26)} ${detail}`);
}

async function check(name: string, path: string, verify: (body: any, status: number) => string): Promise<void> {
  try {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(45000) });
    const text = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    record(name, 'pass', verify(body, response.status));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'request failed';
    record(name, 'fail', detail);
  }
}

async function main(): Promise<void> {
  console.log(`smoke testing ${base}${requireSources ? ' (sources required)' : ''}\n`);

  await check('/health', '/health', (body, status) => {
    if (status !== 200 || body?.ok !== true) throw new Error(`unexpected response: ${status}`);
    return `${body.service} v${body.version}`;
  });

  await check('/v1/providers', '/v1/providers', (body, status) => {
    if (status !== 200 || !Array.isArray(body?.providers)) throw new Error(`unexpected response: ${status}`);
    return `${body.providers.length} mirrors, default ${body.default?.[0]}`;
  });

  await check('/v1/app/latest', '/v1/app/latest?currentVersion=0.0.1', (body, status) => {
    if (status !== 200 || typeof body?.updateAvailable !== 'boolean') {
      throw new Error(`unexpected response: ${status}`);
    }
    return body.latest ? `latest ${body.latest.version}` : 'no release configured yet';
  });

  // The two endpoints that depend on the upstream. A blocked egress is reported as such
  // rather than silently passing.
  for (const [name, path] of [['/v1/watch', WATCH], ['/v1/sources', WATCH.replace('/v1/watch', '/v1/sources')]] as const) {
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(60000) });
      const body = (await response.json()) as any;
      if (response.status === 200 && Array.isArray(body?.sources) && body.sources.length > 0) {
        const groups = Array.isArray(body.subtitleGroups) ? body.subtitleGroups.length : 0;
        record(name, 'pass', `${body.provider}: ${body.sources.length} sources, ${groups} subtitle languages`);
      } else if (response.status === 502 || response.status === 503) {
        const statuses = (body?.attempts ?? []).map((a: any) => `${a.provider}=${a.status}`).join(' ');
        record(name, requireSources ? 'fail' : 'blocked', `upstream refused this egress (${statuses || 'no attempts'})`);
      } else {
        record(name, 'fail', `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 160)}`);
      }
    } catch (error) {
      record(name, 'fail', error instanceof Error ? error.message : 'request failed');
    }
  }

  const failed = results.filter((result) => result.outcome === 'fail');
  const blocked = results.filter((result) => result.outcome === 'blocked');
  console.log(`\n${results.length - failed.length - blocked.length} passed, ${blocked.length} blocked, ${failed.length} failed`);
  if (blocked.length > 0 && !requireSources) {
    console.log('Upstream is unreachable from this egress; configure UPSTREAM_RELAY_URL (docs/BACKEND.md).');
  }
  if (failed.length > 0) process.exitCode = 1;
}

await main();
