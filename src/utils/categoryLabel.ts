/**
 * Padroniza apenas o rótulo visível de categorias (TV, Filmes, Séries).
 * Atua SOMENTE na apresentação; não modifica category_id, category_name original,
 * parâmetros de API ou chaves de estado/busca.
 */
export function formatCategoryLabel(rawName: unknown, domain?: string): string {
  if (rawName == null || typeof rawName !== 'string') {
    return 'GERAL';
  }

  const trimmed = rawName.trim();
  if (!trimmed) {
    return 'GERAL';
  }

  // Preserva categorias virtuais internas do app em caixa alta
  if (
    trimmed === 'Assistidos Recentemente' ||
    trimmed === 'Canais Favoritos' ||
    trimmed === 'Filmes Favoritos' ||
    trimmed === 'Séries Favoritas' ||
    trimmed === 'ASSISTIDOS RECENTEMENTE' ||
    trimmed === 'CANAIS FAVORITOS' ||
    trimmed === 'FILMES FAVORITOS' ||
    trimmed === 'SÉRIES FAVORITAS'
  ) {
    return trimmed.toUpperCase();
  }

  let text = trimmed;

  // 1. Remove emojis e adornos decorativos isolados (preservando letras/números adjacentes)
  text = text.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}★☆⚡►◄🔥✨🎬📺🍿🔴🟢👉💎👑✔️✓•]+/gu,
    ' '
  );

  // 2. Remove colchetes ou parênteses puramente decorativos em torno de tokens isolados
  // Ex: "[BR] | Esportes" -> "BR | Esportes"
  text = text.replace(/(?:^|\s)\[([^[\]]+)\](?=\s|$|[|/·•-])/g, ' $1 ');
  text = text.replace(/(?:^|\s)\(([^()]+)\)(?=\s|$|[|/·•-])/g, ' $1 ');

  // 3. Substitui pipes usados como separadores por um separador visual consistente (" · ")
  text = text.replace(/\s*\|\s*/g, ' · ');

  // 4. Substitui barras separadas por espaços por " · " (ex: "Infantil / Família" -> "Infantil · Família")
  text = text.replace(/\s+\/\s+/g, ' · ');

  // 5. Substitui traços espaçados usados como separadores por " · " (ex: "BR - Esportes" -> "BR · Esportes")
  text = text.replace(/\s+-\s+/g, ' · ');

  // 6. Normaliza múltiplos separadores consecutivos (ex: " · · " -> " · ")
  text = text.replace(/(?:\s*·\s*)+/g, ' · ');

  // 7. Remove separadores, pontuações residuais e espaços nas pontas
  text = text.replace(/^[\s·•\-—_~:/|\\]+|[\s·•\-—_~:/|\\]+$/gu, '');

  // 8. Normaliza espaços internos
  text = text.replace(/\s+/g, ' ').trim();

  // 9. Somente quando domain === 'live', remove prefixo "CANAIS" se for palavra completa seguida de separador
  if (domain === 'live') {
    text = text.replace(/^CANAIS\s*[·.|:-]\s*(?=\S)/i, '');
    text = text.replace(/^[\s·•\-—_~:/|\\]+|[\s·•\-—_~:/|\\]+$/gu, '').trim();
  }

  const result = text || trimmed;
  return result.toUpperCase();
}

const KNOWN_CATEGORY_ACRONYMS = new Set([
  'TV',
  'HBO',
  'ESPN',
  'CNN',
  'HD',
  'FHD',
  '4K',
  '8K',
  'UHD',
  'SD',
  'BR',
  'SP',
  'RJ',
  'MG',
  'RS',
  'PR',
  'SC',
  'BA',
  'PE',
  'CE',
  'DF',
  'UFC',
  'NBA',
  'NFL',
  'BBB',
  'MTV',
  'TNT',
  'AXN',
  'AMC',
  'FX',
  'SIC',
  'RTP',
  'SBT',
  'GNT',
  'TLC',
  'TBS',
  'VIP',
  'PPV',
  'EUA',
  'USA',
  'UK',
  'PT',
  'F1',
]);

/**
 * Formats a category title for visual presentation with natural capitalization
 * (e.g. "Esportes ao vivo", "Canais de filmes", "Notícias", "Assistidos recentemente", "Canais favoritos"),
 * stripping decorative symbols/redundant prefixes and preserving legitimate acronyms (TV, HBO, ESPN, CNN, HD, FHD, 4K, UHD, SD, BR, SP, RJ, UFC, NBA, NFL).
 * Does not mutate original provider category_name or category IDs.
 */
export function formatLiveCategoryTitle(
  rawName: unknown,
  domain: 'live' | 'vod' | 'series' = 'live'
): string {
  const upperCleaned = formatCategoryLabel(rawName, domain);
  if (!upperCleaned) return '';

  const tokens = upperCleaned.split(/\s+/);
  let capitalizeNextWord = true;

  const formattedTokens = tokens.map((token) => {
    if (!token) return token;

    if (/^[·•|\-–—:/]+$/.test(token)) {
      capitalizeNextWord = true;
      return token === '|' ? '·' : token;
    }

    // Strip surrounding punctuation for acronym check while preserving it in output
    const match = token.match(/^([^a-zA-Z0-9À-ÖØ-öø-ÿ]*)([a-zA-Z0-9À-ÖØ-öø-ÿ+]+)([^a-zA-Z0-9À-ÖØ-öø-ÿ]*)$/);
    if (!match) {
      return token.toLowerCase();
    }

    const [, leadingPunct, core, trailingPunct] = match;
    const coreUpper = core.toUpperCase();

    if (KNOWN_CATEGORY_ACRONYMS.has(coreUpper)) {
      capitalizeNextWord = false;
      return `${leadingPunct}${coreUpper}${trailingPunct}`;
    }

    const lowerCore = core.toLowerCase();
    if (capitalizeNextWord) {
      capitalizeNextWord = false;
      const capitalized = lowerCore.charAt(0).toUpperCase() + lowerCore.slice(1);
      return `${leadingPunct}${capitalized}${trailingPunct}`;
    }

    return `${leadingPunct}${lowerCore}${trailingPunct}`;
  });

  return formattedTokens.join(' ');
}

