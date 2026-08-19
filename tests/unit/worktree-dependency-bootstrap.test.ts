import { expect, test } from 'bun:test';

import { readRepositoryModuleGraphV1 } from '../../platform/shared/test-impact-contract.ts';

const bootstrapEntry = 'platform/dev-runner.ts';

test('worktree dependency bootstrap static closure has no preinstalled package dependency', () => {
  const graph = readRepositoryModuleGraphV1();
  const pending = [bootstrapEntry];
  const visited = new Set<string>();
  const externalImports: string[] = [];

  while (pending.length > 0) {
    const filePath = pending.pop() as string;
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    for (const reference of graph.references.filter((entry) => entry.from === filePath)) {
      if (reference.kind !== 'static') continue;
      if (reference.specifier.startsWith('node:') || reference.specifier.startsWith('bun:')) continue;
      if (reference.resolvedTarget === null) {
        externalImports.push(`${filePath} -> ${reference.specifier}`);
        continue;
      }
      pending.push(reference.resolvedTarget);
    }
  }

  expect(externalImports).toEqual([]);
  expect([...visited]).toContain('platform/shared/project-runtime.ts');
  expect([...visited]).not.toContain('platform/shared/concurrency.ts');
});
