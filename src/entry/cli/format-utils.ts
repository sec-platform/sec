import { summarizeCounts } from '../../contracts/collections.ts';
import { stringifyJsonValue } from '../../contracts/json-text.ts';
import type { JsonOutputOptions } from './json-output-options.ts';

export function formatList(values: readonly string[], fallback = 'none'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

export function formatCounts(values: readonly string[]): string {
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
  return stringifyJsonValue(value, options.compact ? 0 : 2, 'CLI JSON output');
}

export function printJson(value: unknown, options: Pick<JsonOutputOptions, 'compact'>): void {
  console.log(formatJson(value, options));
}

export function printJsonOrText<T>(
  value: T,
  options: JsonOutputOptions,
  formatText: (value: T) => string
): void {
  console.log(options.json ? formatJson(value, options) : formatText(value));
}

export function formatSummaryEntries(entries: readonly Readonly<{ id: string; count: number }>[]): string {
  return entries.length > 0
    ? entries.map((entry) => `${entry.id}=${entry.count}`).join(', ')
    : 'none';
}
