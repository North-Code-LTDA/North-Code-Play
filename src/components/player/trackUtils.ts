import { ExternalSubtitleTrackInput, MediaTrackInfo } from './types';
import { normalizeServerUrl } from '../../utils/mediaUtils';

const LANGUAGE_LABELS: Record<string, string> = {
  pt: 'Português',
  por: 'Português',
  'pt-br': 'Português (Brasil)',
  pt_br: 'Português (Brasil)',
  pb: 'Português (Brasil)',
  pob: 'Português (Brasil)',
  'pt-pt': 'Português (Portugal)',
  pt_pt: 'Português (Portugal)',
  en: 'Inglês',
  eng: 'Inglês',
  'en-us': 'Inglês (EUA)',
  'en-gb': 'Inglês (Reino Unido)',
  es: 'Espanhol',
  spa: 'Espanhol',
  'es-419': 'Espanhol (Latino)',
  'es-es': 'Espanhol (Espanha)',
  'es-mx': 'Espanhol (México)',
  fr: 'Francês',
  fra: 'Francês',
  fre: 'Francês',
  it: 'Italiano',
  ita: 'Italiano',
  de: 'Alemão',
  deu: 'Alemão',
  ger: 'Alemão',
  ja: 'Japonês',
  jpn: 'Japonês',
  ko: 'Coreano',
  kor: 'Coreano',
  zh: 'Chinês',
  zho: 'Chinês',
  chi: 'Chinês',
  ru: 'Russo',
  rus: 'Russo',
  ar: 'Árabe',
  ara: 'Árabe',
  nl: 'Holandês',
  nld: 'Holandês',
  dut: 'Holandês',
  pl: 'Polonês',
  pol: 'Polonês',
  tr: 'Turco',
  tur: 'Turco',
  hi: 'Hindi',
  hin: 'Hindi',
  sv: 'Sueco',
  swe: 'Sueco',
  no: 'Norueguês',
  nor: 'Norueguês',
  da: 'Dinamarquês',
  dan: 'Dinamarquês',
  fi: 'Finlandês',
  fin: 'Finlandês',
};

const UNSUPPORTED_SUBTITLE_FORMATS = new Set([
  'pgs',
  'hdmv_pgs_subtitle',
  'sup',
  'dvd_subtitle',
  'vobsub',
  'idx',
  'sub',
  'dvb_subtitle',
  'dvbsub',
  'xsub',
  'ass',
  'ssa',
]);

const SUPPORTED_SUBTITLE_EXTENSIONS = new Map<string, 'vtt' | 'srt'>([
  ['vtt', 'vtt'],
  ['webvtt', 'vtt'],
  ['srt', 'srt'],
  ['subrip', 'srt'],
]);

/**
 * Redacts Xtream credentials and query tokens from URLs for safe logging or display.
 */
export function redactStreamUrlCredentials(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed.slice(0, 48);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    parsed.pathname = parsed.pathname.replace(
      /^(\/(?:live|movie|series)\/)([^/]+)\/([^/]+)(\/)/i,
      '$1***/***$4'
    );
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^(user|username|pass|password|token|auth|sig|signature)$/i.test(key)) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    return trimmed
      .replace(/(\/(?:live|movie|series)\/)[^/]+\/[^/]+\//i, '$1***/***/')
      .replace(/([?&](?:username|password|token)=)[^&]+/gi, '$1***');
  }
}

/**
 * Maps ISO language codes to human-readable Portuguese labels.
 */
export function normalizeLanguageLabel(lang?: string | null): string | null {
  if (!lang || typeof lang !== 'string') return null;
  const cleaned = lang.trim().toLowerCase();
  if (!cleaned || cleaned === 'und' || cleaned === 'unk' || cleaned === 'unknown' || cleaned === 'mul') {
    return null;
  }
  if (LANGUAGE_LABELS[cleaned]) {
    return LANGUAGE_LABELS[cleaned];
  }
  const baseCode = cleaned.split(/[-_]/)[0];
  if (baseCode && LANGUAGE_LABELS[baseCode]) {
    return LANGUAGE_LABELS[baseCode];
  }
  return null;
}

/**
 * Formats a clean, non-redundant label for an audio or subtitle track.
 */
export function formatMediaTrackLabel(options: {
  rawName?: string | null;
  lang?: string | null;
  fallbackPrefix: string;
  index: number;
  forced?: boolean;
  isDefault?: boolean;
  channels?: string | number | null;
}): string {
  const { rawName, lang, fallbackPrefix, index, forced, channels } = options;
  const langLabel = normalizeLanguageLabel(lang);
  const trimmedName = typeof rawName === 'string' ? rawName.trim() : '';
  const nameFromLangCode = trimmedName ? normalizeLanguageLabel(trimmedName) : null;

  let baseLabel = '';
  if (trimmedName) {
    const isGenericName =
      /^(track|faixa|audio|áudio|subtitle|legenda|stream)\s*#?\d*$/i.test(trimmedName) ||
      /^(und|unk|unknown|default)$/i.test(trimmedName);

    if (nameFromLangCode) {
      baseLabel = nameFromLangCode;
    } else if (isGenericName && langLabel) {
      baseLabel = langLabel;
    } else {
      baseLabel = trimmedName;
      if (
        langLabel &&
        !baseLabel.toLowerCase().includes(langLabel.toLowerCase()) &&
        !baseLabel.toLowerCase().includes((lang || '').trim().toLowerCase())
      ) {
        baseLabel = `${baseLabel} (${langLabel})`;
      }
    }
  } else if (langLabel) {
    baseLabel = langLabel;
  } else if (lang && lang.trim() && !/^(und|unk|unknown)$/i.test(lang.trim())) {
    baseLabel = `${fallbackPrefix} (${lang.trim().toUpperCase()})`;
  } else {
    baseLabel = `${fallbackPrefix} ${index + 1}`;
  }

  if (channels !== undefined && channels !== null && String(channels).trim() !== '') {
    const chStr = String(channels).trim();
    const chFormatted =
      chStr === '6'
        ? '5.1'
        : chStr === '8'
          ? '7.1'
          : chStr === '2'
            ? 'Estéreo'
            : chStr === '1'
              ? 'Mono'
              : chStr;
    if (!baseLabel.toLowerCase().includes(chFormatted.toLowerCase())) {
      baseLabel = `${baseLabel} · ${chFormatted}`;
    }
  }

  if (forced && !/for[çc]ad|forced/i.test(baseLabel)) {
    baseLabel = `${baseLabel} [Forçada]`;
  }

  return baseLabel;
}

/**
 * Deduplicates track names in a list so tracks with identical labels get disambiguated (e.g. "Português (2)").
 */
export function disambiguateTrackNames(tracks: MediaTrackInfo[]): MediaTrackInfo[] {
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const tr of tracks) {
    const key = tr.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return tracks.map((tr) => {
    const key = tr.name.trim().toLowerCase();
    const total = counts.get(key) || 1;
    if (total <= 1) return tr;
    const nextIdx = (seen.get(key) || 0) + 1;
    seen.set(key, nextIdx);
    if (nextIdx === 1) return tr;
    return {
      ...tr,
      name: `${tr.name} (${nextIdx})`,
    };
  });
}

/**
 * Detects whether a subtitle URL or format identifier is supported ('vtt' | 'srt'),
 * unsupported (binary/bitmap/ASS), or unknown.
 */
export function detectSubtitleFormat(
  url?: string | null,
  explicitFormat?: string | null
): 'vtt' | 'srt' | 'unsupported' | 'unknown' {
  if (explicitFormat && typeof explicitFormat === 'string') {
    const cleanFmt = explicitFormat.trim().replace(/^\./, '').toLowerCase();
    if (SUPPORTED_SUBTITLE_EXTENSIONS.has(cleanFmt)) {
      return SUPPORTED_SUBTITLE_EXTENSIONS.get(cleanFmt)!;
    }
    if (UNSUPPORTED_SUBTITLE_FORMATS.has(cleanFmt)) {
      return 'unsupported';
    }
  }

  if (!url || typeof url !== 'string') return 'unknown';
  const trimmed = url.trim();
  if (!trimmed) return 'unknown';

  if (/^data:text\/vtt/i.test(trimmed)) return 'vtt';
  if (/^data:application\/x-subrip/i.test(trimmed) || /^data:text\/srt/i.test(trimmed)) {
    return 'srt';
  }
  if (trimmed.startsWith('blob:')) return 'vtt';

  try {
    const parsed = new URL(trimmed, 'http://localhost');
    const pathLower = parsed.pathname.toLowerCase();
    const dotIdx = pathLower.lastIndexOf('.');
    if (dotIdx !== -1) {
      const ext = pathLower.slice(dotIdx + 1);
      if (SUPPORTED_SUBTITLE_EXTENSIONS.has(ext)) {
        return SUPPORTED_SUBTITLE_EXTENSIONS.get(ext)!;
      }
      if (UNSUPPORTED_SUBTITLE_FORMATS.has(ext)) {
        return 'unsupported';
      }
    }
    const fmtParam = (
      parsed.searchParams.get('format') ||
      parsed.searchParams.get('ext') ||
      parsed.searchParams.get('type') ||
      ''
    )
      .trim()
      .toLowerCase();
    if (fmtParam) {
      if (SUPPORTED_SUBTITLE_EXTENSIONS.has(fmtParam)) {
        return SUPPORTED_SUBTITLE_EXTENSIONS.get(fmtParam)!;
      }
      if (UNSUPPORTED_SUBTITLE_FORMATS.has(fmtParam)) {
        return 'unsupported';
      }
    }
  } catch {
    // ignore URL parse error
  }

  return 'unknown';
}

function looksLikeSubtitleUrlOrPath(str: string): boolean {
  const s = str.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^(https?:\/\/|data:|blob:|\/\/)/i.test(s)) return true;
  if (s.startsWith('/') || s.includes('/')) return true;
  if (/\.(vtt|webvtt|srt|subrip|ass|ssa|pgs|sup|idx|sub)(\?.*)?$/i.test(s)) return true;
  return false;
}

function resolveSubtitleUrl(rawUrl: unknown, serverUrl?: string | null): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!looksLikeSubtitleUrlOrPath(trimmed)) return null;

  if (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }

  if (trimmed.startsWith('//')) {
    const scheme =
      serverUrl && serverUrl.trim().toLowerCase().startsWith('https:') ? 'https:' : 'http:';
    return `${scheme}${trimmed}`;
  }

  if (serverUrl && typeof serverUrl === 'string' && serverUrl.trim()) {
    const cleanBase = normalizeServerUrl(serverUrl);
    if (cleanBase) {
      try {
        const baseWithSlash = cleanBase.endsWith('/') ? cleanBase : `${cleanBase}/`;
        return new URL(trimmed, baseWithSlash).href;
      } catch {
        const rel = trimmed.replace(/^\/+/, '');
        return `${cleanBase}/${rel}`;
      }
    }
  }

  return null;
}

const NON_MAP_METADATA_KEYS = new Set([
  'id',
  'index',
  'lang',
  'language',
  'srclang',
  'iso639',
  'label',
  'name',
  'title',
  'format',
  'ext',
  'extension',
  'codec',
  'codec_name',
  'codec_type',
  'codec_long_name',
  'default',
  'isdefault',
  'forced',
  'disposition',
  'tags',
]);

/**
 * Extracts valid external subtitle tracks from Xtream VOD or Series Episode metadata payloads.
 * Never fabricates tracks from embedded stream codec tables that lack a downloadable URL.
 */
export function extractXtreamSubtitles(
  payload: any,
  serverUrl?: string | null
): ExternalSubtitleTrackInput[] {
  if (!payload || typeof payload !== 'object') return [];

  const candidateSources: unknown[] = [
    payload.externalSubtitles,
    payload.subtitles,
    payload.subtitle,
    payload.subtitle_url,
    payload.sub_url,
    payload.subtitles_url,
    payload.info?.subtitles,
    payload.info?.subtitle,
    payload.info?.subtitle_url,
    payload.info?.sub_url,
    payload.info?.subtitles_url,
    payload.movie_data?.subtitles,
    payload.movie_data?.subtitle,
    payload.movie_data?.subtitle_url,
  ];

  const results: ExternalSubtitleTrackInput[] = [];
  const seenUrls = new Set<string>();

  const pushCandidate = (
    rawUrl: unknown,
    meta?: {
      id?: string | number;
      lang?: string;
      label?: string;
      format?: string;
      isDefault?: boolean;
      forced?: boolean;
    }
  ) => {
    const resolved = resolveSubtitleUrl(rawUrl, serverUrl);
    if (!resolved || seenUrls.has(resolved)) return;

    const detectedFmt = detectSubtitleFormat(resolved, meta?.format);
    if (detectedFmt === 'unsupported') return;

    seenUrls.add(resolved);
    results.push({
      id: meta?.id ?? results.length,
      url: resolved,
      lang: meta?.lang,
      label: meta?.label,
      format: detectedFmt === 'unknown' ? 'unknown' : detectedFmt,
      isDefault: meta?.isDefault,
      forced: meta?.forced,
    });
  };

  const inspectEntry = (entry: any, fallbackKey?: string) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      pushCandidate(entry, {
        lang: fallbackKey && !/^\d+$/.test(fallbackKey) ? fallbackKey : undefined,
      });
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, idx) => inspectEntry(item, String(idx)));
      return;
    }
    if (typeof entry === 'object') {
      const directUrl =
        entry.url ??
        entry.src ??
        entry.file ??
        entry.path ??
        entry.link ??
        entry.subtitle_url ??
        entry.sub_url;

      if (typeof directUrl === 'string' && directUrl.trim()) {
        const lang =
          entry.lang ??
          entry.language ??
          entry.srclang ??
          entry.iso639 ??
          entry.tags?.language ??
          (fallbackKey && !/^\d+$/.test(fallbackKey) ? fallbackKey : undefined);
        const label =
          entry.label ??
          entry.name ??
          entry.title ??
          entry.tags?.title ??
          undefined;
        const format =
          entry.format ??
          entry.ext ??
          entry.extension ??
          entry.codec_name ??
          entry.codec ??
          undefined;
        pushCandidate(directUrl, {
          id: entry.id ?? fallbackKey,
          lang: typeof lang === 'string' ? lang : undefined,
          label: typeof label === 'string' ? label : undefined,
          format: typeof format === 'string' ? format : undefined,
          isDefault: Boolean(entry.default || entry.isDefault || entry.disposition?.default),
          forced: Boolean(entry.forced || entry.disposition?.forced),
        });
        return;
      }

      // Map keyed by language or index: { pt: "http://...", en: { url: "http://..." } }
      for (const [k, v] of Object.entries(entry)) {
        if (NON_MAP_METADATA_KEYS.has(k.toLowerCase())) continue;
        if (typeof v === 'string' && looksLikeSubtitleUrlOrPath(v)) {
          inspectEntry(v, k);
        } else if (v && typeof v === 'object') {
          inspectEntry(v, k);
        }
      }
    }
  };

  for (const src of candidateSources) {
    if (src !== undefined && src !== null) {
      inspectEntry(src);
    }
  }

  return results;
}

function normalizeSrtTimestamp(rawTs: string): string | null {
  const cleaned = rawTs.trim().replace(',', '.');
  // Match HH:MM:SS.mmm or MM:SS.mmm
  const hmsMatch = cleaned.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (hmsMatch) {
    const hh = hmsMatch[1].padStart(2, '0');
    const mm = hmsMatch[2];
    const ss = hmsMatch[3];
    const ms = (hmsMatch[4] || '000').padEnd(3, '0').slice(0, 3);
    return `${hh}:${mm}:${ss}.${ms}`;
  }
  const msMatch = cleaned.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (msMatch) {
    const mm = msMatch[1].padStart(2, '0');
    const ss = msMatch[2];
    const ms = (msMatch[3] || '000').padEnd(3, '0').slice(0, 3);
    return `00:${mm}:${ss}.${ms}`;
  }
  return null;
}

/**
 * Converts SubRip (.srt) text or normalizes WebVTT (.vtt) text into valid WebVTT content.
 * Returns null if the input is HTML, empty, or contains no valid cue timings.
 */
export function normalizeSubtitleContentToWebVtt(rawText: string): string | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const text = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!text) return null;

  // Reject HTML error pages (e.g. 404/403 HTML returned by server)
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(text)) {
    return null;
  }

  // Already WebVTT
  if (/^WEBVTT(?:\s|$)/i.test(text)) {
    const normalizedVtt = text.replace(/^webvtt/i, 'WEBVTT');
    return normalizedVtt.includes('-->') ? `${normalizedVtt}\n` : null;
  }

  // Parse and convert SRT lines into WebVTT
  const lines = text.split('\n');
  const outputLines: string[] = ['WEBVTT', ''];
  let validCueCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line.includes('-->')) {
      const arrowParts = line.split('-->');
      if (arrowParts.length === 2) {
        const startRaw = arrowParts[0].trim();
        const rightTokens = arrowParts[1].trim().split(/\s+/);
        const endRaw = rightTokens[0] || '';
        const restSettings = rightTokens.slice(1).join(' ');

        const startVtt = normalizeSrtTimestamp(startRaw);
        const endVtt = normalizeSrtTimestamp(endRaw);
        if (startVtt && endVtt) {
          validCueCount += 1;
          outputLines.push(
            restSettings
              ? `${startVtt} --> ${endVtt} ${restSettings}`
              : `${startVtt} --> ${endVtt}`
          );
          continue;
        }
      }
    }

    // Strip ASS/SSA override tags like {\an8} or {\pos(x,y)} from cue payload lines
    const cleanedLine = line.replace(/\{\\[^}]*\}/g, '');
    outputLines.push(cleanedLine);
  }

  if (validCueCount === 0) {
    return null;
  }

  return `${outputLines.join('\n').trim()}\n`;
}

export const convertSrtToWebVtt = normalizeSubtitleContentToWebVtt;

/**
 * Fetches or decodes an external subtitle URL (.vtt or .srt), converts it to WebVTT,
 * and returns a same-origin Blob/Data URL safe for <track> without requiring crossOrigin on <video>.
 */
export async function loadExternalSubtitleAsVttUrl(
  url: string,
  signal?: AbortSignal
): Promise<{ resolvedUrl: string; isBlobUrl: boolean } | null> {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('blob:')) {
    return { resolvedUrl: trimmed, isBlobUrl: false };
  }

  const createVttResourceUrl = (vttText: string): { resolvedUrl: string; isBlobUrl: boolean } => {
    try {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
        const blob = new Blob([vttText], { type: 'text/vtt;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        if (blobUrl && blobUrl.startsWith('blob:')) {
          return { resolvedUrl: blobUrl, isBlobUrl: true };
        }
      }
    } catch {
      // Fallback to data URI below
    }
    return {
      resolvedUrl: `data:text/vtt;charset=utf-8,${encodeURIComponent(vttText)}`,
      isBlobUrl: false,
    };
  };

  if (trimmed.startsWith('data:')) {
    try {
      const commaIdx = trimmed.indexOf(',');
      if (commaIdx === -1) return null;
      const meta = trimmed.slice(0, commaIdx).toLowerCase();
      const body = trimmed.slice(commaIdx + 1);
      const rawContent = meta.includes(';base64')
        ? typeof atob === 'function'
          ? atob(body)
          : Buffer.from(body, 'base64').toString('utf-8')
        : decodeURIComponent(body);
      const vtt = normalizeSubtitleContentToWebVtt(rawContent);
      if (!vtt) return null;
      return createVttResourceUrl(vtt);
    } catch {
      return null;
    }
  }

  if (typeof fetch !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      return null;
    }
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetch(trimmed, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const rawText = await response.text();
    const vtt = normalizeSubtitleContentToWebVtt(rawText);
    if (!vtt) {
      return null;
    }
    return createVttResourceUrl(vtt);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }
}
