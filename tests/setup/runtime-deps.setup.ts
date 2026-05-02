import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureSharedDepsReady } from '../../platform/shared/project-runtime.ts';

async function configureTestTempRoot(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const tempRoot = path.join(repoRoot, '.tmp', 'test-workspaces');
  await fs.mkdir(tempRoot, { recursive: true });
  process.env.TMPDIR = tempRoot;
  process.env.TMP = tempRoot;
  process.env.TEMP = tempRoot;
}

export default async function prewarmSharedRuntimeDeps(): Promise<void> {
  await configureTestTempRoot();
  if (process.env.PJC_SKIP_RUNTIME_DEPS_SETUP !== '1') {
    await ensureSharedDepsReady();
  }
}

// Bun test compat: execute immediately
await prewarmSharedRuntimeDeps();
