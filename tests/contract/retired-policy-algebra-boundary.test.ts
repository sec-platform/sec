import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { compilerRoot } from '../../platform/shared/paths.ts';

test('consumer-zero Policy Algebra model remains physically retired', async () => {
  await expect(fs.access(path.join(
    compilerRoot,
    'platform/compiler/verify/policy-algebra.ts'
  ))).rejects.toThrow();
  await expect(fs.access(path.join(
    compilerRoot,
    'tests/unit/policy-algebra.test.ts'
  ))).rejects.toThrow();
});
