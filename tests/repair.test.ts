import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  repairWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';

test('repair emits a local slot-scoped repair plan after verification failure', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-repair-'));

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  await fs.writeFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    `import type { CustomerInput, NormalizedCustomerInput } from '../src/runtime/database.ts';\n\nexport function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {\n  return {\n    name: String(input.name ?? '').trim(),\n    email: String(input.email ?? '').trim(),\n    phone: String(input.phone ?? ''),\n    company: String(input.company ?? '').trim()\n  };\n}\n`,
    'utf8'
  );

  await assert.rejects(
    async () => verifyWorkspace(workspaceRoot),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'VERIFY-ACCEPTANCE-003'
  );

  const { repairPlan } = await repairWorkspace(workspaceRoot);
  assert.equal(repairPlan.status, 'pending');
  assert.equal(repairPlan.tasks.length, 1);
  assert.equal(repairPlan.tasks[0].targetFile, 'custom/customer_normalizer.ts');
  assert.deepEqual(repairPlan.tasks[0].allowedPaths, ['custom/customer_normalizer.ts']);
});
