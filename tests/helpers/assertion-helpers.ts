import { expect } from 'bun:test';
import fs from 'node:fs/promises';

export function expectContainsAll(haystack: string, needles: readonly string[]): void {
  const missing = needles.filter((needle) => !haystack.includes(needle));
  expect(missing, `Missing ${missing.length} marker(s): ${missing.map((m) => JSON.stringify(m)).join(', ')}`).toHaveLength(0);
}

export function expectContainsNone(haystack: string, needles: readonly string[]): void {
  const found = needles.filter((needle) => haystack.includes(needle));
  expect(found, `Unexpectedly found ${found.length} marker(s): ${found.map((f) => JSON.stringify(f)).join(', ')}`).toHaveLength(0);
}

export async function expectFileUnchanged(filePath: string, beforeText: string): Promise<void> {
  await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(beforeText);
}
