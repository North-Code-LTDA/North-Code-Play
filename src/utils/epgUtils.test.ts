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
  assert.strictEqual(
    decodeEpgText(toBase64Utf8('Programação Especial Ao Vivo')),
    'Programação Especial Ao Vivo'
  );
  // 4-char ASCII words that match base64 length/alphabet must NOT turn into garbage
  assert.strictEqual(decodeEpgText('Test'), 'Test');
  assert.strictEqual(decodeEpgText('News'), 'News');
  assert.strictEqual(decodeEpgText('Live'), 'Live');
  assert.strictEqual(decodeEpgText('Show'), 'Show');
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

test('computeEpgProgressPercent returns 0, 50, 100 within interval and null outside or when invalid', () => {
  const start = 1762980000;
  const end = 1762983600; // +3600s
  const entry = { start_timestamp: start, stop_timestamp: end };

  // Start boundary (0%), midpoint (50%), and end boundary (100%)
  assert.strictEqual(computeEpgProgressPercent(entry, start * 1000), 0);
  assert.strictEqual(computeEpgProgressPercent(entry, (start + 1800) * 1000), 50);
  assert.strictEqual(computeEpgProgressPercent(entry, end * 1000), 100);

  // Before start -> null
  assert.strictEqual(computeEpgProgressPercent(entry, (start - 60) * 1000), null);
  // After end -> null
  assert.strictEqual(computeEpgProgressPercent(entry, (end + 60) * 1000), null);

  // Missing or inverted timestamps -> null
  assert.strictEqual(computeEpgProgressPercent({ title: 'Programa sem hora' }, start * 1000), null);
  assert.strictEqual(
    computeEpgProgressPercent({ start_timestamp: end, stop_timestamp: start }, start * 1000),
    null
  );
  assert.strictEqual(
    computeEpgProgressPercent({ start_timestamp: start, stop_timestamp: start }, start * 1000),
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

test('resolveNowPlayingProgram strictly requires an active interval containing nowMs and rejects past, future, gap, or untimed entries', () => {
  const baseSec = 1762980000;
  const nowMs = (baseSec + 1800) * 1000; // base + 30 min

  // 1. Valid current program (start <= now < end) -> selected
  const singleActive = resolveNowPlayingProgram(
    [
      {
        title: toBase64Utf8('Jornal Ao Vivo'),
        description: toBase64Utf8('Notícias em tempo real.'),
        start_timestamp: baseSec,
        stop_timestamp: baseSec + 3600,
      },
    ],
    nowMs
  );
  assert(singleActive !== null);
  assert.strictEqual(singleActive.title, 'Jornal Ao Vivo');
  assert.strictEqual(singleActive.description, 'Notícias em tempo real.');
  assert.strictEqual(singleActive.progressPercent, 50);

  // 2. List containing ONLY past programs -> null
  const onlyPast = resolveNowPlayingProgram(
    [
      {
        title: toBase64Utf8('Programa Encerrado 1'),
        start_timestamp: baseSec - 7200,
        stop_timestamp: baseSec - 3600,
      },
      {
        title: toBase64Utf8('Programa Encerrado 2'),
        start_timestamp: baseSec - 3600,
        stop_timestamp: baseSec - 60,
      },
    ],
    nowMs
  );
  assert.strictEqual(onlyPast, null);

  // 3. List containing ONLY future programs -> null
  const onlyFuture = resolveNowPlayingProgram(
    [
      {
        title: toBase64Utf8('Programa Futuro 1'),
        start_timestamp: baseSec + 3600,
        stop_timestamp: baseSec + 7200,
      },
      {
        title: toBase64Utf8('Programa Futuro 2'),
        start_timestamp: baseSec + 7200,
        stop_timestamp: baseSec + 10800,
      },
    ],
    nowMs
  );
  assert.strictEqual(onlyFuture, null);

  // 4. List containing past and future programs with a schedule gap at nowMs -> null
  const scheduleGap = resolveNowPlayingProgram(
    [
      {
        title: toBase64Utf8('Programa Passado'),
        start_timestamp: baseSec - 3600,
        stop_timestamp: baseSec + 600, // ended 20 min ago
      },
      {
        title: toBase64Utf8('Programa Futuro'),
        start_timestamp: baseSec + 2400, // starts in 10 min
        stop_timestamp: baseSec + 5400,
      },
    ],
    nowMs
  );
  assert.strictEqual(scheduleGap, null);

  // 5. List containing past + current + future -> selects the current program
  const pastCurrentFuture = resolveNowPlayingProgram(
    [
      {
        title: toBase64Utf8('Programa Anterior'),
        start_timestamp: baseSec - 3600,
        stop_timestamp: baseSec,
      },
      {
        title: toBase64Utf8('Debate Ao Vivo'),
        description: toBase64Utf8('Discussão diária sobre tecnologia.'),
        start_timestamp: baseSec,
        stop_timestamp: baseSec + 3600,
      },
      {
        title: toBase64Utf8('Filme da Noite'),
        start_timestamp: baseSec + 3600,
        stop_timestamp: baseSec + 7200,
      },
    ],
    nowMs
  );
  assert(pastCurrentFuture !== null);
  assert.strictEqual(pastCurrentFuture.title, 'Debate Ao Vivo');
  assert.strictEqual(pastCurrentFuture.description, 'Discussão diária sobre tecnologia.');
  assert.strictEqual(pastCurrentFuture.progressPercent, 50);

  // 6. List containing only entries without timestamps -> null (cannot confirm live broadcast)
  const untimed = resolveNowPlayingProgram([{ title: 'Programa Sem Horário' }], nowMs);
  assert.strictEqual(untimed, null);
  const onlyStartNoEnd = resolveNowPlayingProgram(
    [{ title: 'Apenas Início', start_timestamp: baseSec }],
    nowMs
  );
  assert.strictEqual(onlyStartNoEnd, null);
  const onlyEndNoStart = resolveNowPlayingProgram(
    [{ title: 'Apenas Fim', stop_timestamp: baseSec + 3600 }],
    nowMs
  );
  assert.strictEqual(onlyEndNoStart, null);

  // 7. List containing entries with inverted or zero-duration timestamps (end <= start) -> null
  const inverted = resolveNowPlayingProgram(
    [
      {
        title: 'Invertido',
        start_timestamp: baseSec + 3600,
        stop_timestamp: baseSec,
      },
      {
        title: 'Duração Zero',
        start_timestamp: baseSec + 1800,
        stop_timestamp: baseSec + 1800,
      },
    ],
    nowMs
  );
  assert.strictEqual(inverted, null);

  // 8. Empty, null, or invalid list -> null
  assert.strictEqual(resolveNowPlayingProgram([], nowMs), null);
  assert.strictEqual(resolveNowPlayingProgram(null, nowMs), null);
  assert.strictEqual(resolveNowPlayingProgram(undefined, nowMs), null);
  assert.strictEqual(resolveNowPlayingProgram([{}], nowMs), null);
});

test('resolveNowPlayingProgram transitions deterministically across T1 (Program A) -> T2 (Program B) -> T3 (null)', () => {
  const t0Sec = 1762980000;
  const listings = [
    {
      title: toBase64Utf8('Programa A — Manhã'),
      description: toBase64Utf8('Primeira edição.'),
      start_timestamp: t0Sec,
      stop_timestamp: t0Sec + 1800, // 30 min: [t0, t0+1800]
    },
    {
      title: toBase64Utf8('Programa B — Tarde'),
      description: toBase64Utf8('Segunda edição.'),
      start_timestamp: t0Sec + 1800,
      stop_timestamp: t0Sec + 5400, // 60 min: [t0+1800, t0+5400]
    },
  ];

  // T1: 900s into Program A (50%)
  const t1Ms = (t0Sec + 900) * 1000;
  const atT1 = resolveNowPlayingProgram(listings, t1Ms);
  assert(atT1 !== null);
  assert.strictEqual(atT1.title, 'Programa A — Manhã');
  assert.strictEqual(atT1.progressPercent, 50);

  // Exact boundary (t0 + 1800): Program A ended, Program B just started (0%)
  const atBoundaryMs = (t0Sec + 1800) * 1000;
  const atBoundary = resolveNowPlayingProgram(listings, atBoundaryMs);
  assert(atBoundary !== null);
  assert.strictEqual(atBoundary.title, 'Programa B — Tarde');
  assert.strictEqual(atBoundary.progressPercent, 0);

  // T2: 1800s into Program B (50%)
  const t2Ms = (t0Sec + 3600) * 1000;
  const atT2 = resolveNowPlayingProgram(listings, t2Ms);
  assert(atT2 !== null);
  assert.strictEqual(atT2.title, 'Programa B — Tarde');
  assert.strictEqual(atT2.progressPercent, 50);

  // T3: after all programs have finished -> null
  const t3Ms = (t0Sec + 5401) * 1000;
  const atT3 = resolveNowPlayingProgram(listings, t3Ms);
  assert.strictEqual(atT3, null);
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

