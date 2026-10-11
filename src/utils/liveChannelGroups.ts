export type ChannelResolution = '4K' | 'FHD' | 'HD' | 'SD';

export interface ChannelVariant {
  resolution: ChannelResolution;
  stream: any;
}

export interface LiveChannelGroup {
  id: string;
  name: string;
  isGroup: boolean;
  primaryStream: any;
  variants: ChannelVariant[];
  streams: any[];
}

export const STABILITY_ORDER: ChannelResolution[] = ['FHD', 'HD', 'SD', '4K'];

/**
 * Detecta sufixo de resolução em stream.name:
 * - Reconhece SOMENTE o último token separado por pelo menos um espaço: 4K, FHD, HD ou SD (case-insensitive).
 * - O nome-base é tudo que vem antes desse último espaço, com espaços extremos retirados.
 * - Exige nome-base não vazio.
 * - Não trata "HDMI", "4Kids", "Canal HD 2", "HD+" ou "Telecine Action Full HD" como variantes da mesma base.
 */
export function parseChannelSuffix(rawName: unknown): { baseName: string; resolution: ChannelResolution } | null {
  if (!rawName || typeof rawName !== 'string') return null;
  const trimmed = rawName.trim();
  const match = trimmed.match(/^(.*?)\s+([A-Za-z0-9]+)$/);
  if (!match) return null;

  const basePart = match[1].trim();
  const token = match[2];
  if (!basePart) return null;

  const upperToken = token.toUpperCase();
  if (upperToken !== '4K' && upperToken !== 'FHD' && upperToken !== 'HD' && upperToken !== 'SD') {
    return null;
  }

  return {
    baseName: basePart,
    resolution: upperToken as ChannelResolution,
  };
}

/**
 * Agrupa canais de TV com o mesmo nome-base e pelo menos DUAS resoluções reconhecidas diferentes.
 * - Preserva a categoria selecionada.
 * - Não une streams com epg_channel_id preenchidos e diferentes.
 * - Não esconde espelhos de uma mesma resolução.
 * - Mantém a ordem estável da lista e uma chave estável por grupo.
 * - Para categorias virtuais (Recentes, Favoritos), preserva cada item individualmente sem agrupamento.
 */
export function groupLiveStreams(streams: any[], categoryId?: string): LiveChannelGroup[] {
  if (!Array.isArray(streams) || streams.length === 0) return [];

  // Categorias virtuais "Recentes" e "Favoritos" não agrupam variantes para não perder registros
  // nem alterar o stream_id selecionado pelo usuário.
  if (categoryId === 'nc_recent' || categoryId === 'nc_fav') {
    return streams.map((stream) => ({
      id: `stream_${stream.stream_id}`,
      name: stream.name || 'Canal',
      isGroup: false,
      primaryStream: stream,
      variants: [],
      streams: [stream],
    }));
  }

  interface CandidateCluster {
    parsedBase: string;
    normBase: string;
    catId: string;
    epgIds: Set<string>;
    resolutions: Set<ChannelResolution>;
    primaryStream: any;
    streams: any[];
    variants: ChannelVariant[];
  }

  const clusters: (CandidateCluster | { isDirect: true; group: LiveChannelGroup })[] = [];

  for (const stream of streams) {
    const parsed = parseChannelSuffix(stream.name);
    if (!parsed) {
      clusters.push({
        isDirect: true,
        group: {
          id: `stream_${stream.stream_id}`,
          name: stream.name || 'Canal',
          isGroup: false,
          primaryStream: stream,
          variants: [],
          streams: [stream],
        },
      });
      continue;
    }

    const normBase = parsed.baseName.trim().replace(/\s+/g, ' ').toLowerCase();
    const catId = stream.category_id != null ? String(stream.category_id) : '';
    const epgId = stream.epg_channel_id ? String(stream.epg_channel_id).trim() : '';

    // Encontra cluster existente compatível
    const existing = clusters.find((item) => {
      if ('isDirect' in item) return false;
      if (item.normBase !== normBase) return false;
      if (item.catId !== catId) return false;

      // Se ambos tiverem epg_channel_id preenchidos e diferentes, não une
      if (epgId && item.epgIds.size > 0 && !item.epgIds.has(epgId)) {
        return false;
      }

      // Se já houver stream com a mesma resolução, não une no mesmo grupo para não ocultar espelho
      if (item.resolutions.has(parsed.resolution)) {
        return false;
      }

      return true;
    }) as CandidateCluster | undefined;

    if (existing) {
      existing.streams.push(stream);
      existing.resolutions.add(parsed.resolution);
      existing.variants.push({
        resolution: parsed.resolution,
        stream,
      });
      if (epgId) existing.epgIds.add(epgId);
    } else {
      clusters.push({
        parsedBase: parsed.baseName,
        normBase,
        catId,
        epgIds: new Set(epgId ? [epgId] : []),
        resolutions: new Set([parsed.resolution]),
        primaryStream: stream,
        streams: [stream],
        variants: [
          {
            resolution: parsed.resolution,
            stream,
          },
        ],
      });
    }
  }

  // Converte clusters em LiveChannelGroup final
  return clusters.map((item) => {
    if ('isDirect' in item) {
      return item.group;
    }

    // Exige pelo menos DUAS resoluções reconhecidas diferentes para formar um canal agrupado
    if (item.resolutions.size >= 2) {
      const sortedVariants = [...item.variants].sort((a, b) => {
        const idxA = STABILITY_ORDER.indexOf(a.resolution);
        const idxB = STABILITY_ORDER.indexOf(b.resolution);
        return idxA - idxB;
      });

      return {
        id: `group_${item.primaryStream.stream_id}`,
        name: item.parsedBase,
        isGroup: true,
        primaryStream: sortedVariants[0].stream,
        variants: sortedVariants,
        streams: item.streams,
      };
    }

    // Apenas uma resolução: mantém como item individual com o nome original do stream
    return {
      id: `stream_${item.primaryStream.stream_id}`,
      name: item.primaryStream.name,
      isGroup: false,
      primaryStream: item.primaryStream,
      variants: item.variants,
      streams: item.streams,
    };
  });
}

/**
 * Verifica se a busca corresponde ao nome-base do grupo OU a qualquer nome completo de suas variantes.
 */
export function searchMatchesGroup(group: LiveChannelGroup, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (group.name.toLowerCase().includes(q)) return true;
  return group.streams.some((s) => s.name && s.name.toLowerCase().includes(q));
}

/**
 * Seleciona a variante inicial para o grupo:
 * 1. Resolução manual se especificada
 * 2. Última resolução de sucesso na sessão atual
 * 3. Ordem padrão de estabilidade: FHD, HD, SD, 4K
 */
export function getInitialVariant(
  group: LiveChannelGroup,
  manualResolution?: ChannelResolution | 'auto',
  lastSuccessfulResolution?: ChannelResolution
): ChannelVariant {
  if (!group.isGroup || group.variants.length === 0) {
    return {
      resolution: 'HD',
      stream: group.primaryStream,
    };
  }

  if (manualResolution && manualResolution !== 'auto') {
    const found = group.variants.find((v) => v.resolution === manualResolution);
    if (found) return found;
  }

  if (lastSuccessfulResolution) {
    const found = group.variants.find((v) => v.resolution === lastSuccessfulResolution);
    if (found) return found;
  }

  for (const res of STABILITY_ORDER) {
    const found = group.variants.find((v) => v.resolution === res);
    if (found) return found;
  }

  return group.variants[0];
}
