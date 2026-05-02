import fs from 'node:fs/promises';
import { expect } from 'bun:test';

export function expectContainsAll(haystack: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !haystack.includes(n));
  expect(missing, `Missing ${missing.length} marker(s): ${missing.map((m) => JSON.stringify(m)).join(', ')}`).toEqual([] as any);
}

export function expectContainsNone(haystack: string, needles: readonly string[]): void {
  const found = needles.filter((n) => haystack.includes(n));
  expect(found, `Unexpectedly found ${found.length} marker(s): ${found.map((f) => JSON.stringify(f)).join(', ')}`).toEqual([] as any);
}

export async function expectFileUnchanged(filePath: string, beforeText: string): Promise<void> {
  await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(beforeText);
}
