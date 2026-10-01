export const HISTORY_ROW_LIMIT = 9;

export function recentHistoryRounds(history, limit = HISTORY_ROW_LIMIT) {
  if (!Array.isArray(history) || limit <= 0) return [];

  // The server stores newest rounds first, so take from the front and keep
  // each round intact instead of flattening dice from different rounds.
  return history
    .filter(round => Array.isArray(round?.dice))
    .slice(0, limit);
}

export function countSymbolAppearances(history, symbolIds) {
  const counts = Object.fromEntries(symbolIds.map(id => [id, 0]));
  if (!Array.isArray(history)) return counts;

  for (const round of history) {
    if (!Array.isArray(round?.dice)) continue;
    for (const symbolId of round.dice) {
      if (Object.hasOwn(counts, symbolId)) counts[symbolId] += 1;
    }
  }

  return counts;
}
