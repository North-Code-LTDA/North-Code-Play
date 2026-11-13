import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEpgText,
  parseEpgTimestampMs,
  formatEpgTimeLabel,
  formatEpgTimeSlot,
  computeEpgProgressPercent,
  resolveNowPlayingProgram,
  buildEpgCacheKeys,
  computeLiveShowcaseRowBounds,
} from './epgUtils';

function toBase64Utf8(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64');
}

test('decodeEpgText decodes UTF-8 Base64 and preserves plain text words without corruption', () => {
  assert.strictEqual(decodeEpgText(toBase64Utf8('Jornal da Noite')), 'Jornal da Noite');
  assert.strictEqual(decodeEpgText(toBase64Utf8('Programação Especial Ao Vivo')), 'Programação Especial Ao Vivo');
  // 4-char ASCII word happens to match base64 length/alphabet — must NOT turn into garbage
  assert.strictEqual(decodeEpgText('Test'), 'Test');
  assert.strictEqual(decodeEpgText('News'), 'News');
  assert.strictEqual(decodeEpgText('  Série em Destaque  '), 'Série em Destaque');
  assert.strictEqual(decodeEpgText(''), '');
  assert.strictEqual(decodeEpgText(null), '');
});

test('parseEpgTimestampMs handles Unix seconds, milliseconds, and datetime strings', () => {
  const unixSecStart = 1762980000;
  const unixSecEnd = 1762983600;
  assert.strictEqual(
    parseEpgTimestampMs({ start_timestamp: unixSecStart, stop_timestamp: unixSecEnd }, 'start'),
    unixSecStart * 1000
  );
  assert.strictEqual(
    parseEpgTimestampMs({ start_timestamp: unixSecStart, stop_timestamp: unixSecEnd }, 'end'),
    unixSecEnd * 1000
  );
  assert.strictEqual(
    parseEpgTimestampMs({ start_timestamp: String(unixSecStart * 1000) }, 'start'),
    unixSecStart * 1000
  );

  const parsedLocal = parseEpgTimestampMs({ start: '2026-11-12 20:00:00' }, 'start');
  assert(parsedLocal !== null && Number.isFinite(parsedLocal));
  assert.strictEqual(parseEpgTimestampMs({ start: 'invalid-date' }, 'start'), null);
  assert.strictEqual(parseEpgTimestampMs(null, 'start'), null);
});

test('computeEpgProgressPercent returns null unless valid timestamps bracket nowMs', () => {
  const start = 1762980000;
  const end = 1762983600; // +3600s
  const entry = { start_timestamp: start, stop_timestamp: end };

  // Halfway through (50%)
  assert.strictEqual(computeEpgProgressPercent(entry, (start + 1800) * 1000), 50);
  // Start boundary (0%) and end boundary (100%)
  assert.strictEqual(computeEpgProgressPercent(entry, start * 1000), 0);
  assert.strictEqual(computeEpgProgressPercent(entry, end * 1000), 100);
  // Outside bounds -> null (no fabricated progress)
  assert.strictEqual(computeEpgProgressPercent(entry, (start - 60) * 1000), null);
  assert.strictEqual(computeEpgProgressPercent(entry, (end + 60) * 1000), null);
  // Missing or inverted timestamps -> null
  assert.strictEqual(computeEpgProgressPercent({ title: 'Programa sem hora' }, start * 1000), null);
  assert.strictEqual(
    computeEpgProgressPercent({ start_timestamp: end, stop_timestamp: start }, start * 1000),
    null
  );
});

test('formatEpgTimeSlot extracts valid HH:MM intervals or returns null', () => {
  assert.strictEqual(
    formatEpgTimeSlot({ start: '2026-11-12 09:05:00', end: '2026-11-12 10:30:00' }),
    '09:05 - 10:30'
  );
  assert.strictEqual(formatEpgTimeLabel('23:59'), '23:59');
  assert.strictEqual(formatEpgTimeLabel('99:99'), null);
  assert.strictEqual(formatEpgTimeSlot({ start: '2026-11-12 09:05:00' }), null);
});

test('resolveNowPlayingProgram prefers active interval and never invents missing fields', () => {
  const nowSec = 1762981800;
  const resolved = resolveNowPlayingProgram(
    [
      {
        title: toBase64Utf8('Programa Anterior'),
        start_timestamp: nowSec - 7200,
        stop_timestamp: nowSec - 3600,
      },
      {
        title: toBase64Utf8('Debate Ao Vivo'),
        description: toBase64Utf8('Discussão diária sobre tecnologia.'),
        start_timestamp: nowSec - 900,
        stop_timestamp: nowSec + 900,
      },
    ],
    nowSec * 1000
  );

  assert(resolved !== null);
  assert.strictEqual(resolved.title, 'Debate Ao Vivo');
  assert.strictEqual(resolved.description, 'Discussão diária sobre tecnologia.');
  assert.strictEqual(resolved.progressPercent, 50);

  // Entry with title only and no valid timestamps -> keeps title, leaves timeSlot/progressPercent null
  const untimed = resolveNowPlayingProgram([{ title: 'Programa Sem Horário' }], nowSec * 1000);
  assert(untimed !== null);
  assert.strictEqual(untimed.title, 'Programa Sem Horário');
  assert.strictEqual(untimed.timeSlot, null);
  assert.strictEqual(untimed.progressPercent, null);

  // Empty or garbage list -> returns null
  assert.strictEqual(resolveNowPlayingProgram([], nowSec * 1000), null);
  assert.strictEqual(resolveNowPlayingProgram([{}], nowSec * 1000), null);
});

test('buildEpgCacheKeys and computeLiveShowcaseRowBounds produce stable deterministic values', () => {
  const keys = buildEpgCacheKeys(
    {
      epg_channel_id: 'globo.sp',
      primaryStream: { stream_id: 101 },
      allStreams: [{ stream_id: 101 }, { stream_id: 102 }],
    },
    'http://tv.local|user1'
  );
  assert.deepStrictEqual(keys, [
    'http://tv.local|user1::epg:globo.sp',
    'http://tv.local|user1::stream:101',
    'http://tv.local|user1::stream:102',
  ]);

  assert.deepStrictEqual(computeLiveShowcaseRowBounds(20, 5, 8), { start: 5, end: 13, maxStart: 12 });
  assert.deepStrictEqual(computeLiveShowcaseRowBounds(20, 18, 8), { start: 12, end: 20, maxStart: 12 });
  assert.deepStrictEqual(computeLiveShowcaseRowBounds(3, 5, 8), { start: 0, end: 3, maxStart: 0 });
});
