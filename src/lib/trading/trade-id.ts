export const buildTradeId = (symbol: string, openedAt: string): string => {
  const compactTimestamp = openedAt.replace(/[-:.TZ]/g, "");
  return `${symbol.toUpperCase()}-${compactTimestamp}`;
};
