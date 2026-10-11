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
