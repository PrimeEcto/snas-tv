import test from 'node:test';
import assert from 'node:assert/strict';

import { canServeAsVtt, groupSubtitles, srtToVtt, type SubtitleRecord } from '../src/subtitles.ts';

const record = (overrides: Partial<SubtitleRecord>): SubtitleRecord => ({
  id: 'x'.repeat(20),
  url: 'https://subtitles.vidy.st/download?id=x',
  display: 'English',
  language: 'en',
  format: 'srt',
  downloadCount: 0,
  isTrusted: false,
  isHearingImpaired: false,
  source: 'opensubtitles',
  ...overrides,
});

const SRT = [
  '1',
  '00:00:00,001 --> 00:00:50,001',
  '{\\3c&H00C5D2&\\fnArabic Typesetting\\b1}Hello there.',
  '',
  '2',
  '00:00:50,500 --> 00:00:52,000',
  'Second cue.',
  '',
].join('\r\n');

test('srtToVtt emits one WEBVTT header, dotted timestamps and no cue counters', () => {
  const vtt = srtToVtt(SRT);
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.equal(vtt.match(/WEBVTT/g)?.length, 1);
  assert.match(vtt, /00:00:00\.001 --> 00:00:50\.001/);
  assert.ok(!vtt.includes('\r'), 'CRLF must be normalised to LF');
  assert.ok(!vtt.includes('{'), 'ASS override blocks must be stripped');
  assert.ok(vtt.includes('Hello there.'));
  assert.ok(vtt.includes('Second cue.'));
});

test('srtToVtt keeps cue text that happens to be a number', () => {
  const input = '1\n00:00:01,000 --> 00:00:02,000\n42\n\n00:00:03,000 --> 00:00:04,000\n1999\n';
  const vtt = srtToVtt(input);
  assert.ok(vtt.includes('\n42\n'));
  assert.ok(vtt.includes('\n1999'));
});

test('srtToVtt normalises text that is already WebVTT', () => {
  const already = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nText\n';
  const vtt = srtToVtt(already);
  assert.equal(vtt.match(/WEBVTT/g)?.length, 1);
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.000'));
  assert.equal(srtToVtt(''), 'WEBVTT\n');
  assert.equal(srtToVtt('\uFEFF'), 'WEBVTT\n');
});

test('only SRT and VTT can be served to the player', () => {
  assert.equal(canServeAsVtt('srt'), true);
  assert.equal(canServeAsVtt('SRT'), true);
  assert.equal(canServeAsVtt('vtt'), true);
  assert.equal(canServeAsVtt('ssa'), false);
  assert.equal(canServeAsVtt('ass'), false);
  assert.equal(canServeAsVtt(''), false);
});

test('groups are per language, alphabetical, and best release first', () => {
  const groups = groupSubtitles([
    record({ id: 'a'.repeat(20), language: 'es', display: 'Spanish', downloadCount: 5 }),
    record({ id: 'b'.repeat(20), language: 'en', display: 'English', downloadCount: 10 }),
    record({ id: 'c'.repeat(20), language: 'en', display: 'English', downloadCount: 1, isTrusted: true }),
    record({ id: 'd'.repeat(20), language: 'en', display: 'English', downloadCount: 99 }),
    record({ id: '', language: 'fr', display: 'French' }),
    record({ id: 'e'.repeat(20), url: '', language: 'fr', display: 'French' }),
  ]);

  assert.deepEqual(groups.map((group) => group.languageName), ['English', 'Spanish']);
  const english = groups[0];
  assert.equal(english.subtitles.length, 3);
  assert.equal(english.subtitles[0].isTrusted, true, 'trusted release must lead the group');
  assert.equal(english.subtitles[1].downloadCount, 99);
  assert.equal(english.subtitles[2].downloadCount, 10);
  // Rows without an id or url are dropped rather than shipped to the device.
  assert.equal(groups.some((group) => group.language === 'fr'), false);
});
