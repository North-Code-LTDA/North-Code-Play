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

  // Preserva categorias virtuais internas do app, exibindo em caixa alta
  if (
    trimmed === 'Assistidos Recentemente' ||
    trimmed === 'Canais Favoritos' ||
    trimmed === 'Filmes Favoritos' ||
    trimmed === 'Séries Favoritas'
  ) {
    return trimmed.toLocaleUpperCase('pt-BR');
  }

  let text = trimmed;

  // 1. Remove emojis e adornos decorativos isolados (preservando letras/números adjacentes)
  text = text.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}★☆⚡►◄🔥✨🎬📺🍿🔴🟢👉💎👑✔️✓•]+/gu,
    ' '
  );

  // 2. Remove colchetes ou parênteses puramente decorativos em torno de tokens isolados
  // Ex: "[BR] | Esportes" -> "BR | Esportes"
  text = text.replace(/(?:^|\s)\[([^[\]]+)\](?=\s|$|[|/·•:-])/g, ' $1 ');
  text = text.replace(/(?:^|\s)\(([^()]+)\)(?=\s|$|[|/·•:-])/g, ' $1 ');

  // 3. Substitui pipes usados como separadores por um separador visual consistente (" · ")
  text = text.replace(/\s*\|\s*/g, ' · ');

  // 4. Substitui barras separadas por espaços por " · " (ex: "Infantil / Família" -> "Infantil · Família")
  // mas preserva barras sem espaço que fazem parte de um nome contíguo (ex: "HBO/MAX", "AC/DC")
  text = text.replace(/\s+\/\s+/g, ' · ');

  // 5. Substitui traços espaçados usados como separadores por " · " (ex: "BR - Esportes" -> "BR · Esportes")
  text = text.replace(/\s+-\s+/g, ' · ');

  // 6. Normaliza múltiplos separadores consecutivos (ex: " · · " -> " · ")
  text = text.replace(/(?:\s*·\s*)+/g, ' · ');

  // 7. Somente para TV (domain === 'live'), retira prefixo "CANAIS" se for palavra completa
  // seguida por separador inequívoco (·, |, :, -, .) e se houver texto significativo depois.
  if (domain === 'live') {
    const matchPrefix = text.match(/^canais(?:\s*[·•|:.-]|\s+·)\s*(.+)$/i);
    if (matchPrefix && matchPrefix[1] && matchPrefix[1].trim()) {
      text = matchPrefix[1].trim();
    }
  }

  // 8. Remove separadores, pontuações residuais e espaços nas pontas
  text = text.replace(/^[\s·•\-—_~:/|\\]+|[\s·•\-—_~:/|\\]+$/gu, '');

  // 9. Normaliza espaços internos
  text = text.replace(/\s+/g, ' ').trim();

  // Se a higienização resultar em texto vazio, utiliza o original aparado
  const result = text || trimmed;
  return result.toLocaleUpperCase('pt-BR');
}
