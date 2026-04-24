import { afterAll, expect, test } from 'vitest';
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

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

test('repair emits a local slot-scoped repair plan after verification failure', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-repair-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  await fs.writeFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    `import type { CustomerInput, NormalizedCustomerInput } from '../src/runtime/database.ts';\n\nexport function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {\n  return {\n    name: String(input.name ?? '').trim(),\n    email: String(input.email ?? '').trim(),\n    phone: String(input.phone ?? ''),\n    company: String(input.company ?? '').trim()\n  };\n}\n`,
    'utf8'
  );

  await expect(verifyWorkspace(workspaceRoot)).rejects.toThrow();

  const { repairPlan } = await repairWorkspace(workspaceRoot);
  expect(repairPlan.status).toBe('pending');
  expect(repairPlan.tasks.length).toBe(1);
  expect(repairPlan.tasks[0].targetFile).toBe('custom/customer_normalizer.ts');
  expect(repairPlan.tasks[0].allowedPaths).toEqual(['custom/customer_normalizer.ts']);
});
