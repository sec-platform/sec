import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import {
  composeWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';

test('compose refreshes runtime host scaffold for an existing workspace baseline', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-compose-refresh-');
  const projectRoot = path.join(workspaceRoot, 'project');

  await initWorkspace(workspaceRoot, { reset: true });
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'stale-generated-project',
        private: true,
        type: 'module',
        scripts: {
          test: 'node --test'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);

  const projectPackage = await readJson<{
    scripts: Record<string, string>;
  }>(path.join(projectRoot, 'package.json'));
  expect(projectPackage.scripts.build).toBe('next build --webpack');
  expect(projectPackage.scripts['verify:runtime:service']).toBe('bun run test:unit');
  expect(projectPackage.scripts['verify:runtime:full']).toBe(
    'bun run build && bun run test:unit && bun run test:acceptance'
  );
  expect(projectPackage.scripts['verify:runtime']).toBe('bun run verify:runtime:full');
  await expect(fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8')).resolves.toContain('workers: 1');
});
