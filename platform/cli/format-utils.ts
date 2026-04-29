import { mergeCountSummaries, summarizeCounts } from '../shared/collections.ts';

export function formatList(values: string[], fallback = 'none'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

export function formatCounts(values: string[]): string {
  return formatList(
    summarizeCounts(values).map((entry) => `${entry.id}=${entry.count}`)
  );
}

export function formatJson(value: unknown, options: { compact: boolean }): string {
  return JSON.stringify(value, null, options.compact ? 0 : 2);
}

export function printJsonOrText<T>(
  value: T,
  options: { json: boolean; compact: boolean },
  formatText: (value: T) => string
): void {
  console.log(options.json ? formatJson(value, options) : formatText(value));
}

export function summarizeById(
  entries: Array<{ id: string; count: number }>
): Array<{ id: string; count: number }> {
  return mergeCountSummaries(entries);
}

export function formatSummaryEntries(entries: Array<{ id: string; count: number }>): string {
  return entries.length > 0
    ? entries.map((entry) => `${entry.id}=${entry.count}`).join(', ')
    : 'none';
}
