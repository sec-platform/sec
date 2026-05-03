import { expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { compilerRoot } from '../../platform/shared/paths.ts';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export async function expectGoldenJson(relativePath: string, value: unknown): Promise<void> {
  const goldenPath = path.join(compilerRoot, 'tests', 'golden', relativePath);
  const expected = await fs.readFile(goldenPath, 'utf8');
  expect(stableJson(value)).toBe(expected);
}
