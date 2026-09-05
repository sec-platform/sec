import type { JsonOutputOptions } from './json-output-options.ts';
import { mergeCountSummaries, summarizeCounts } from '../../system-architecture/foundation/runtime/collections.ts';

export function formatList(values: string[], fallback = 'none'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

export function formatCounts(values: string[]): string {
  return formatList(
    summarizeCounts(values).map((entry) => `${entry.id}=${entry.count}`)
  );
}

export function optionalFields(entries: Array<[unknown, string]>): string[] {
  return entries.filter(([value]) => value !== undefined && value !== null).map(([, text]) => text);
}

export function formatFields(values: readonly string[]): string {
  return values.join('; ');
}

export function formatJson(value: unknown, options: Pick<JsonOutputOptions, 'compact'>): string {
  return JSON.stringify(value, null, options.compact ? 0 : 2);
}

export function printJsonOrText<T>(
  value: T,
  options: JsonOutputOptions,
  formatText: (value: T) => string
): void {
  console.log(options.json ? formatJson(value, options) : formatText(value));
}

function summarizeById(
  entries: Array<{ id: string; count: number }>
): Array<{ id: string; count: number }> {
  return mergeCountSummaries(entries);
}

export function formatSummaryEntries(entries: Array<{ id: string; count: number }>): string {
  return entries.length > 0
    ? entries.map((entry) => `${entry.id}=${entry.count}`).join(', ')
    : 'none';
}

export function formatMergedSummaryEntries(entries: Array<{ id: string; count: number }>): string {
  return formatSummaryEntries(summarizeById(entries));
}
