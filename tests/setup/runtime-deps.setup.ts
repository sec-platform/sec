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
  await ensureSharedDepsReady();
}
