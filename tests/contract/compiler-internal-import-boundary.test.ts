import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { compilerRoot, posixPath } from '../../platform/shared/paths.ts';

const EXPECTED_REMAINING_INTERNAL_COMPILER_BARREL_CONSUMERS = [
  'platform/orchestrator/pipeline-orchestrator.ts',
  'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts',
  'platform/orchestrator/semantic-mutation-orchestrator.ts',
  'platform/upgrade/upgrade-workspace.ts'
] as const;

async function collectTypeScriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) {
        files.push(absolute);
      }
    }
  };
  await visit(root);
  return files.sort();
}

test('internal orchestrator and upgrade code cannot grow compiler/index.ts super-barrel consumption', async () => {
  const roots = [
    path.join(compilerRoot, 'platform', 'orchestrator'),
    path.join(compilerRoot, 'platform', 'upgrade')
  ];
  const consumers: string[] = [];
  for (const root of roots) {
    for (const file of await collectTypeScriptFiles(root)) {
      const source = await fs.readFile(file, 'utf8');
      if (!/from\s+['"]\.\.\/compiler\/index\.ts['"]/u.test(source)) continue;
      consumers.push(posixPath(path.relative(compilerRoot, file)));
    }
  }

  expect(consumers.sort()).toEqual([...EXPECTED_REMAINING_INTERNAL_COMPILER_BARREL_CONSUMERS]);
});
