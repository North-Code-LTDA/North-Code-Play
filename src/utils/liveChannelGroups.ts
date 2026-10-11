export type ResolutionQuality = '4K' | 'FHD' | 'HD' | 'SD';

export interface ChannelVariant {
  resolution: ResolutionQuality;
  stream: any;
  streamId: string | number;
  label: string;
}

export interface LiveChannelGroup {
  groupId: string; // Stable ID based on category, EPG, and normalized base name
  displayName: string; // Preserves casing of baseName
  category_id: string | number;
  epg_channel_id?: string;
  stream_icon?: string;
  isGrouped: boolean;
  variants: ChannelVariant[]; // Contains ALL streams matching resolution suffixes
  primaryStream: any;
  allStreams: any[];
}

export interface ParsedSuffixResult {
  baseName: string;
  normalizedBaseName: string;
  resolution: ResolutionQuality | null;
  isVariant: boolean;
}

/**
 * Parses a stream name to detect resolution suffix.
 * - Recognizes ONLY the last token separated by at least one space: 4K, FHD, HD, or SD (case-insensitive).
 * - Base name is everything before that last space, trimmed and whitespace-normalized.
 * - Requires non-empty base name.
 */
export function parseChannelVariantSuffix(streamName: string | undefined | null): ParsedSuffixResult {
  if (!streamName || typeof streamName !== 'string') {
    return {
      baseName: '',
      normalizedBaseName: '',
      resolution: null,
      isVariant: false,
    };
  }

  const trimmed = streamName.trim();
  const lastSpaceIdx = trimmed.lastIndexOf(' ');

  if (lastSpaceIdx <= 0) {
    return {
      baseName: trimmed,
      normalizedBaseName: trimmed.toLowerCase().replace(/\s+/g, ' '),
      resolution: null,
      isVariant: false,
    };
  }

  const candidateSuffix = trimmed.slice(lastSpaceIdx + 1).toUpperCase();
  const rawBaseName = trimmed.slice(0, lastSpaceIdx).trim();
  const normalizedBaseName = rawBaseName.toLowerCase().replace(/\s+/g, ' ');

  const validResolutions: ResolutionQuality[] = ['4K', 'FHD', 'HD', 'SD'];

  if (validResolutions.includes(candidateSuffix as ResolutionQuality) && rawBaseName.length > 0) {
    return {
      baseName: rawBaseName,
      normalizedBaseName,
      resolution: candidateSuffix as ResolutionQuality,
      isVariant: true,
    };
  }

  return {
    baseName: trimmed,
    normalizedBaseName: trimmed.toLowerCase().replace(/\s+/g, ' '),
    resolution: null,
    isVariant: false,
  };
}

/**
 * Groups a list of live stream objects by category, EPG channel ID, and base channel name
 * when at least 2 distinct resolutions (4K, FHD, HD, SD) exist for that base name.
 * Preserves ALL streams with distinct IDs inside variants and allStreams.
 */
export function groupLiveStreams(streams: any[]): LiveChannelGroup[] {
  if (!Array.isArray(streams) || streams.length === 0) {
    return [];
  }

  // Map to hold candidate buckets: key -> streams array
  const buckets = new Map<
    string,
    { baseName: string; categoryId: string | number; epgId: string; streams: { stream: any; parsed: ParsedSuffixResult }[] }
  >();
  const streamToBucketKey = new Map<any, string>();

  for (const stream of streams) {
    const parsed = parseChannelVariantSuffix(stream?.name);
    const catId = stream?.category_id ?? 'default';

    if (parsed.isVariant && parsed.resolution) {
      const epgId = stream?.epg_channel_id ? String(stream.epg_channel_id).trim() : '';
      const bucketKey = `${catId}_${epgId}_${parsed.normalizedBaseName}`;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          baseName: parsed.baseName,
          categoryId: catId,
          epgId,
          streams: [],
        });
      }
      buckets.get(bucketKey)!.streams.push({ stream, parsed });
      streamToBucketKey.set(stream, bucketKey);
    }
  }

  const result: LiveChannelGroup[] = [];
  const processedBucketKeys = new Set<string>();

  for (const stream of streams) {
    const bucketKey = streamToBucketKey.get(stream);

    if (bucketKey && buckets.has(bucketKey)) {
      if (processedBucketKeys.has(bucketKey)) {
        continue;
      }

      const bucket = buckets.get(bucketKey)!;

      // Count unique resolutions in this bucket
      const resSet = new Set<ResolutionQuality>();
      for (const item of bucket.streams) {
        if (item.parsed.resolution) {
          resSet.add(item.parsed.resolution);
        }
      }

      // Group ONLY if at least 2 distinct resolutions exist!
      if (resSet.size >= 2) {
        processedBucketKeys.add(bucketKey);

        const allBucketStreams = bucket.streams.map((i) => i.stream);
        const icon = allBucketStreams.find((s) => s.stream_icon)?.stream_icon || stream.stream_icon;
        const epgId = bucket.epgId;

        // Build variants array preserving ALL distinct streams
        const variants: ChannelVariant[] = [];
        const resCounts = new Map<ResolutionQuality, number>();

        // Order by standard resolution priority: FHD, HD, SD, 4K
        const resolutionPriority: ResolutionQuality[] = ['FHD', 'HD', 'SD', '4K'];
        for (const res of resolutionPriority) {
          const matchingItems = bucket.streams.filter((item) => item.parsed.resolution === res);
          for (let i = 0; i < matchingItems.length; i++) {
            const s = matchingItems[i].stream;
            const sId = s.stream_id || s.id;
            const count = (resCounts.get(res) || 0) + 1;
            resCounts.set(res, count);

            const label = matchingItems.length > 1 ? `${res} (${count})` : res;

            variants.push({
              resolution: res,
              stream: s,
              streamId: sId,
              label,
            });
          }
        }

        // Primary stream stability priority: FHD > HD > SD > 4K
        let primary = variants.find((v) => v.resolution === 'FHD')?.stream;
        if (!primary) primary = variants.find((v) => v.resolution === 'HD')?.stream;
        if (!primary) primary = variants.find((v) => v.resolution === 'SD')?.stream;
        if (!primary) primary = variants.find((v) => v.resolution === '4K')?.stream;
        if (!primary) primary = stream;

        // Stable groupId based on category, EPG, and normalized base name
        const cleanBase = bucket.streams[0].parsed.normalizedBaseName.replace(/[^a-z0-9]/g, '_');
        const groupId = `group_${bucket.categoryId}_${epgId || 'noepg'}_${cleanBase}`;

        result.push({
          groupId,
          displayName: bucket.baseName,
          category_id: bucket.categoryId,
          epg_channel_id: epgId,
          stream_icon: icon,
          isGrouped: true,
          variants,
          primaryStream: primary,
          allStreams: allBucketStreams,
        });

        continue;
      }
    }

    // Single item (either no resolution variant, or only 1 resolution variant in bucket)
    const streamId = stream.stream_id || stream.id;
    result.push({
      groupId: `single_${stream.category_id || 'default'}_${streamId}`,
      displayName: stream.name || 'Sem nome',
      category_id: stream.category_id,
      epg_channel_id: stream.epg_channel_id,
      stream_icon: stream.stream_icon,
      isGrouped: false,
      variants: [],
      primaryStream: stream,
      allStreams: [stream],
    });
  }

  return result;
}

/**
 * Filter live channel groups by search query.
 * Matches if query is included in group displayName OR any variant/stream full name.
 */
export function filterLiveChannelGroups(groups: LiveChannelGroup[], searchQuery: string): LiveChannelGroup[] {
  if (!searchQuery || !searchQuery.trim()) {
    return groups;
  }

  const q = searchQuery.toLowerCase().trim();

  return groups.filter((group) => {
    if (group.displayName.toLowerCase().includes(q)) {
      return true;
    }
    return group.allStreams.some((s) => (s.name || '').toLowerCase().includes(q));
  });
}
