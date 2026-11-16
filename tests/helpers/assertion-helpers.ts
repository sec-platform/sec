import { expect } from 'bun:test';
import fs from 'node:fs/promises';

export async function expectFileUnchanged(filePath: string, beforeText: string): Promise<void> {
  await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(beforeText);
}

// Compare complete semantic fields and list members, not prose spacing or
// substrings shared by a different key, record, or evidence field.
export function recordFields(line: string | undefined): string[] {
  expect(line).toBeDefined();
  return line!.split(';').map(field => field.trim().replace(/\s*,\s*/gu, ','));
}

export function expectRecord(line: string | undefined, fields: readonly string[]): void {
  expect(recordFields(line).sort()).toEqual(
    fields.map(field => field.trim().replace(/\s*,\s*/gu, ',')).sort()
  );
}
