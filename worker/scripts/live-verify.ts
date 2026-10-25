/**
 * Live verification against the real movy.sx / OpenSubtitles backends.
 *
 * Proves the whole chain outside Cloudflare: seed -> encrypted /sources -> TS decryption
 * -> parsed sources, plus the OpenSubtitles search and WebVTT conversion. It also
 * captures a byte-exact fixture (seed + ciphertext + plaintext) so the crypto port has an
 * offline regression test that cannot silently drift.
 *
 *   npm run verify:live            # in worker/
 *   npm run verify:live -- --keep  # also rewrite test/fixtures/streamcrypto.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { decryptStreamPayload } from '../src/streamcrypto.ts';
import {
  DEFAULT_PROVIDER_ORDER,
  PROVIDERS,
  buildSourceParams,
  buildSourcesUrl,
  getSeed,
  type TitleRef,
} from '../src/movy.ts';
import { groupSubtitles, searchSubtitles, srtToVtt } from '../src/subtitles.ts';
import { siteReferer } from '../src/site.ts';

// Run from the worker directory (`npm run verify:live`), beside the test fixture.
const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'streamcrypto.json');

/** Spider-Man: Brand New Day, the title used throughout the reverse engineering. */
const TEST_TITLE: TitleRef = {
  title: 'Spider-Man: Brand New Day',
  year: 2026,
  tmdbId: 969681,
  imdbId: 'tt22084616',
  mediaType: 'movie',
};

interface Fixture {
  name: string;
  provider: string;
  url: string;
  seed: string;
  mediaId: number;
  ciphertext: string;
  plaintext: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Capture one provider's raw ciphertext plus its decrypted plaintext. */
async function capture(providerSlug: string): Promise<Fixture> {
  const provider = PROVIDERS.find((entry) => entry.slug === providerSlug);
  if (!provider) throw new Error(`unknown provider ${providerSlug}`);
  const params = buildSourceParams(TEST_TITLE, provider);

  let lastError = 'no attempt made';
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const seed = await getSeed(TEST_TITLE.tmdbId);
      const url = buildSourcesUrl(provider, params, seed);
      // The host the provider is serving from today, discovered rather than assumed.
      const referer = await siteReferer();
      console.log(`  referer ${referer}`);
      const response = await fetch(url, {
        headers: { accept: 'application/json, text/plain, */*', referer },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        console.warn(`  ${providerSlug}: ${lastError} (attempt ${attempt}), backing off`);
        await sleep(6000 * attempt);
        continue;
      }
      const ciphertext = await response.text();
      const plaintext = decryptStreamPayload(ciphertext, seed, TEST_TITLE.tmdbId);
      return { name: `${TEST_TITLE.mediaType}-${providerSlug}`, provider: providerSlug, url, seed, mediaId: TEST_TITLE.tmdbId, ciphertext, plaintext };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unknown failure';
      console.warn(`  ${providerSlug}: ${lastError} (attempt ${attempt})`);
      await sleep(6000 * attempt);
    }
  }
  throw new Error(`${providerSlug} failed after retries: ${lastError}`);
}

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  const failures: string[] = [];

  console.log('1) encrypted source fetch + TypeScript decryption');
  const fixtures: Fixture[] = [];
  for (const slug of DEFAULT_PROVIDER_ORDER.slice(0, 3)) {
    try {
      const fixture = await capture(slug);
      fixtures.push(fixture);
      const parsed = JSON.parse(fixture.plaintext) as { sources?: { quality: string; url: string }[]; subtitles?: unknown[]; playlist?: string; thumbnail?: string };
      console.log(`  ${slug}: ok — ${parsed.sources?.length ?? 0} sources, ${parsed.subtitles?.length ?? 0} embedded subtitle rows, playlist=${Boolean(parsed.playlist)}, thumbnail=${Boolean(parsed.thumbnail)}`);
      for (const source of parsed.sources ?? []) console.log(`      ${source.quality.padEnd(8)} ${source.url.slice(0, 78)}`);
      break;
    } catch (error) {
      failures.push(`sources(${slug}): ${error instanceof Error ? error.message : 'failed'}`);
      console.log(`  ${slug}: unavailable, trying next mirror`);
    }
    await sleep(3000);
  }

  console.log('2) tampered-payload guard');
  const first = fixtures[0];
  if (first) {
    let threw = false;
    try {
      decryptStreamPayload(first.ciphertext, `${first.seed}-wrong`, first.mediaId);
    } catch {
      threw = true;
    }
    console.log(`  wrong seed rejected: ${threw ? 'yes' : 'NO — unexpected'}`);
    if (!threw) failures.push('wrong seed did not fail decryption');
  }

  console.log('3) OpenSubtitles menu');
  try {
    const records = await searchSubtitles(TEST_TITLE.tmdbId);
    const groups = groupSubtitles(records);
    const languages = groups.map((group) => group.languageName);
    console.log(`  ${records.length} tracks across ${groups.length} languages`);
    console.log(`  languages: ${languages.slice(0, 14).join(', ')}${languages.length > 14 ? ', ...' : ''}`);
    if (groups.length < 2) failures.push(`expected multiple subtitle languages, saw ${groups.length}`);

    const sample = records[0];
    if (sample) {
      const response = await fetch(sample.url, { signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      const vtt = srtToVtt(text);
      console.log(`  converted '${sample.display}' (${sample.format}) to ${vtt.length} chars of WebVTT, header ok=${vtt.startsWith('WEBVTT')}`);
      if (!vtt.startsWith('WEBVTT')) failures.push('srtToVtt did not emit a WEBVTT header');
    }
  } catch (error) {
    failures.push(`subtitles: ${error instanceof Error ? error.message : 'failed'}`);
  }

  if (keep && fixtures.length > 0) {
    await mkdir(dirname(FIXTURE_PATH), { recursive: true });
    await writeFile(FIXTURE_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');
    console.log(`4) wrote ${fixtures.length} fixture(s) to ${FIXTURE_PATH}`);
  }

  if (failures.length > 0) {
    console.error(`\nFAILED:\n${failures.map((line) => ` - ${line}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll live checks passed.');
}

await main();
