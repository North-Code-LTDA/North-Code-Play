import type { LiveChannelGroup } from './liveChannelGroups';

export interface ResolvedNowPlaying {
  title: string | null;
  description: string | null;
  timeSlot: string | null;
  progressPercent: number | null;
  startMs: number | null;
  endMs: number | null;
}

const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
const STRICT_BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Safely decodes Xtream EPG text that may be UTF-8 Base64 or already plain text.
 * Rejects binary garbage when plain ASCII words happen to be multiples of 4 chars.
 */
export function decodeEpgText(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';

  if (
    STRICT_BASE64_RE.test(trimmed) &&
    trimmed.length % 4 === 0 &&
    typeof atob === 'function'
  ) {
    try {
      const binary = atob(trimmed);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
      if (decoded && !CONTROL_CHARS_RE.test(decoded)) {
        return decoded;
      }
    } catch {
      // Not valid UTF-8 Base64 — treat as plain text below
    }
  }

  return trimmed;
}

/**
 * Parses start or end timestamps from Xtream EPG listings (`start_timestamp`/`stop_timestamp`
 * or `start`/`end`/`stop` datetime strings). Returns epoch milliseconds or `null`.
 */
export function parseEpgTimestampMs(entry: any, bound: 'start' | 'end'): number | null {
  if (!entry || typeof entry !== 'object') return null;

  const rawNumeric =
    bound === 'start'
      ? entry.start_timestamp
      : (entry.stop_timestamp ?? entry.end_timestamp);

  if (rawNumeric !== undefined && rawNumeric !== null && rawNumeric !== '') {
    const num = Number(rawNumeric);
    if (Number.isFinite(num) && num > 0) {
      return num < 1e12 ? num * 1000 : num;
    }
  }

  const rawDateStr =
    bound === 'start'
      ? entry.start
      : (entry.end ?? entry.stop);

  if (typeof rawDateStr !== 'string') return null;
  const trimmed = rawDateStr.trim();
  if (!trimmed) return null;

  // Match "YYYY-MM-DD HH:MM(:SS)" in local wall-clock time consistently
  const localMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (localMatch) {
    const year = Number(localMatch[1]);
    const month = Number(localMatch[2]) - 1;
    const day = Number(localMatch[3]);
    const hour = Number(localMatch[4]);
    const minute = Number(localMatch[5]);
    const second = Number(localMatch[6] || '0');
    const dt = new Date(year, month, day, hour, minute, second);
    const ms = dt.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatClockFromMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Extracts `HH:MM` from an EPG time field (`YYYY-MM-DD HH:MM:SS` or `HH:MM`),
 * or falls back to a validated millisecond timestamp.
 */
export function formatEpgTimeLabel(
  val: unknown,
  fallbackTimestampMs: number | null = null
): string | null {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed) {
      const parts = trimmed.split(/[\sT]+/);
      const timePart = parts.length > 1 ? parts[1] : parts[0];
      if (timePart) {
        const sub = timePart.substring(0, 5);
        if (/^\d{1,2}:\d{2}$/.test(sub)) {
          const [h, m] = sub.split(':').map(Number);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          }
        }
      }
    }
  }
  return formatClockFromMs(fallbackTimestampMs);
}

/**
 * Formats `"HH:MM - HH:MM"` strictly from valid start & end fields/timestamps.
 */
export function formatEpgTimeSlot(entry: any): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const startMs = parseEpgTimestampMs(entry, 'start');
  const endMs = parseEpgTimestampMs(entry, 'end');
  const startLabel = formatEpgTimeLabel(entry.start, startMs);
  const endLabel = formatEpgTimeLabel(entry.end ?? entry.stop, endMs);
  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`;
  }
  return null;
}

export const EPG_CLOCK_UPDATE_INTERVAL_MS = 60_000;

let epgClockOverrideNowMs: number | null = null;
const epgClockListeners = new Set<(nowMs: number) => void>();

export function getLiveEpgClockNowMs(): number {
  return epgClockOverrideNowMs !== null ? epgClockOverrideNowMs : Date.now();
}

export function setLiveEpgClockNowForTest(nowMs: number | null): void {
  epgClockOverrideNowMs = nowMs;
  const effective = getLiveEpgClockNowMs();
  epgClockListeners.forEach((listener) => {
    try {
      listener(effective);
    } catch {
      // Ignore listener errors in test clock notifications
    }
  });
}

export function subscribeLiveEpgClockForTest(listener: (nowMs: number) => void): () => void {
  epgClockListeners.add(listener);
  return () => {
    epgClockListeners.delete(listener);
  };
}

/**
 * Computes progress percentage (`0..100`) ONLY when both start and end timestamps
 * are valid, `end > start`, and `nowMs` falls within `[startMs, endMs]`.
 * Returns `null` when timestamps are absent, malformed, or outside bounds so
 * UI never invents fake progress bars.
 */
export function computeEpgProgressPercent(
  entry: any,
  nowMs: number = getLiveEpgClockNowMs()
): number | null {
  const startMs = parseEpgTimestampMs(entry, 'start');
  const endMs = parseEpgTimestampMs(entry, 'end');
  if (startMs === null || endMs === null || endMs <= startMs) {
    return null;
  }
  if (!Number.isFinite(nowMs) || nowMs < startMs || nowMs > endMs) {
    return null;
  }
  const ratio = (nowMs - startMs) / (endMs - startMs);
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/**
 * Resolves the active/current program from an array of Xtream EPG listings
 * strictly when a program has valid start & end timestamps (`end > start`)
 * and `nowMs` falls within its interval.
 * Never falls back to expired, future, or untimed entries.
 */
export function resolveNowPlayingProgram(
  listings: any[],
  nowMs: number = getLiveEpgClockNowMs()
): ResolvedNowPlaying | null {
  if (!Array.isArray(listings) || listings.length === 0) return null;
  if (!Number.isFinite(nowMs)) return null;

  const validEntries = listings.filter(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item)
  );
  if (validEntries.length === 0) return null;

  // Prefer half-open [startMs, endMs) first so boundary transitions (A ends at T, B starts at T)
  // immediately resolve B; fall back to inclusive [startMs, endMs] when at the exact end of the last program.
  const activeHalfOpen = validEntries.find((entry) => {
    const startMs = parseEpgTimestampMs(entry, 'start');
    const endMs = parseEpgTimestampMs(entry, 'end');
    return (
      startMs !== null &&
      endMs !== null &&
      endMs > startMs &&
      nowMs >= startMs &&
      nowMs < endMs
    );
  });

  const liveMatch =
    activeHalfOpen ||
    validEntries.find((entry) => {
      const startMs = parseEpgTimestampMs(entry, 'start');
      const endMs = parseEpgTimestampMs(entry, 'end');
      return (
        startMs !== null &&
        endMs !== null &&
        endMs > startMs &&
        nowMs >= startMs &&
        nowMs <= endMs
      );
    });

  if (!liveMatch) {
    return null;
  }

  const title = decodeEpgText(liveMatch.title) || null;
  const description = decodeEpgText(liveMatch.description) || null;
  const timeSlot = formatEpgTimeSlot(liveMatch);
  const startMs = parseEpgTimestampMs(liveMatch, 'start');
  const endMs = parseEpgTimestampMs(liveMatch, 'end');
  const progressPercent = computeEpgProgressPercent(liveMatch, nowMs);

  if (!title && !description) {
    return null;
  }

  return {
    title,
    description,
    timeSlot,
    progressPercent,
    startMs,
    endMs,
  };
}

/**
 * Shared in-memory session EPG cache keyed by account + epg_channel_id / stream_id.
 * Allows passive reuse across cards and view transitions without firing bulk network requests.
 */
const sessionEpgListingsCache = new Map<string, any[]>();

export function getSharedSessionEpgCache(): Map<string, any[]> {
  return sessionEpgListingsCache;
}

export function clearSharedSessionEpgCache(accountPrefix?: string): void {
  if (!accountPrefix) {
    sessionEpgListingsCache.clear();
    return;
  }
  const prefixWithSep = `${accountPrefix}::`;
  for (const key of Array.from(sessionEpgListingsCache.keys())) {
    if (key.startsWith(prefixWithSep)) {
      sessionEpgListingsCache.delete(key);
    }
  }
}

/**
 * Builds canonical lookup keys so cached EPG responses loaded on active channel
 * selection can be read passively by matching wide channel cards in rows.
 */
export function buildEpgCacheKeys(
  group: Pick<LiveChannelGroup, 'epg_channel_id' | 'primaryStream' | 'allStreams'> | null | undefined,
  accountPrefix = ''
): string[] {
  if (!group) return [];
  const prefix = accountPrefix ? `${accountPrefix}::` : '';
  const keys: string[] = [];
  const epgId = group.epg_channel_id ? String(group.epg_channel_id).trim() : '';
  if (epgId) {
    keys.push(`${prefix}epg:${epgId}`);
  }
  const primaryId = group.primaryStream?.stream_id ?? group.primaryStream?.id;
  if (primaryId !== undefined && primaryId !== null && String(primaryId).trim() !== '') {
    keys.push(`${prefix}stream:${String(primaryId)}`);
  }
  if (Array.isArray(group.allStreams)) {
    for (const s of group.allStreams) {
      const sId = s?.stream_id ?? s?.id;
      if (sId !== undefined && sId !== null && String(sId).trim() !== '') {
        const key = `${prefix}stream:${String(sId)}`;
        if (!keys.includes(key)) keys.push(key);
      }
    }
  }
  return keys;
}

export const LIVE_SHOWCASE_ROW_WINDOW_SIZE = 8;

export function computeLiveShowcaseRowBounds(
  totalRows: number,
  requestedStart: number,
  windowSize: number = LIVE_SHOWCASE_ROW_WINDOW_SIZE
): { start: number; end: number; maxStart: number } {
  if (totalRows <= 0) {
    return { start: 0, end: 0, maxStart: 0 };
  }
  const effectiveWindow = Math.max(1, windowSize);
  const maxStart = Math.max(0, totalRows - effectiveWindow);
  const start = Math.max(0, Math.min(maxStart, Math.floor(requestedStart)));
  const end = Math.min(totalRows, start + effectiveWindow);
  return { start, end, maxStart };
}

export interface ChronologicalEpgEntry {
  id: string;
  title: string;
  description: string;
  startMs: number | null;
  endMs: number | null;
  timeSlot: string | null;
  isCurrent: boolean;
  progressPercent: number | null;
}

/**
 * Resolves a chronological list of current and upcoming EPG programs from raw Xtream listings.
 * Never fabricates timestamps, titles, descriptions, or arbitrary progress bars.
 */
export function resolveChronologicalEpgSchedule(
  listings: any[],
  nowMs: number = getLiveEpgClockNowMs()
): ChronologicalEpgEntry[] {
  if (!Array.isArray(listings) || listings.length === 0) return [];
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();

  const parsed: Array<ChronologicalEpgEntry & { rawIdx: number }> = [];

  for (let i = 0; i < listings.length; i++) {
    const item = listings[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const title = decodeEpgText(item.title || item.name || '');
    const description = decodeEpgText(item.description || item.plot || item.descr || '');
    if (!title && !description) continue;

    const startMs = parseEpgTimestampMs(item, 'start');
    const endMs = parseEpgTimestampMs(item, 'end');

    // Skip programs that have already finished before safeNow
    if (startMs !== null && endMs !== null && endMs > startMs && endMs <= safeNow) {
      continue;
    }

    const hasValidInterval = startMs !== null && endMs !== null && endMs > startMs;
    const isCurrent = hasValidInterval && safeNow >= startMs! && safeNow < endMs!;
    const progressPercent = isCurrent ? computeEpgProgressPercent(item, safeNow) : null;
    const timeSlot = formatEpgTimeSlot(item);

    parsed.push({
      id: String(item.id ?? item.epg_id ?? `${startMs ?? 'na'}_${endMs ?? 'na'}_${i}`),
      title: title || 'Programa sem título',
      description,
      startMs,
      endMs,
      timeSlot,
      isCurrent,
      progressPercent,
      rawIdx: i,
    });
  }

  parsed.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }
    if (a.startMs !== null && b.startMs !== null && a.startMs !== b.startMs) {
      return a.startMs - b.startMs;
    }
    if (a.startMs !== null && b.startMs === null) return -1;
    if (a.startMs === null && b.startMs !== null) return 1;
    return a.rawIdx - b.rawIdx;
  });

  const seen = new Set<string>();
  const result: ChronologicalEpgEntry[] = [];
  for (const entry of parsed) {
    const dedupKey = `${entry.startMs ?? ''}|${entry.endMs ?? ''}|${entry.title}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const { rawIdx: _unused, ...cleanEntry } = entry;
    result.push(cleanEntry);
  }

  return result;
}

