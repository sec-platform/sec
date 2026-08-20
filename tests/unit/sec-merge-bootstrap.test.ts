import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';


const ROOT = path.resolve(import.meta.dir, '../..');

test('legacy merge bootstrap entrypoints are retired', () => {
  for (const filePath of [
    'scripts/codex/sec-merge-bootstrap-contract.ts',
    'scripts/codex/sec-merge-bootstrap-runtime.ts',
    'scripts/codex/sec-merge-bootstrap.ts'
  ]) {
    expect(existsSync(path.join(ROOT, filePath))).toBe(false);
  }
});
