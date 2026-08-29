import path from 'node:path';

import { expect, test } from 'bun:test';

import { defaultInstallRegistry } from '../../src/compiler/compose/install-strategies.ts';
import { parsePrismaSchema } from '../../src/compiler/compose/merge-prisma-template.ts';
import { readText, writeText } from '../../src/workspace/files.ts';
import type { InstallPlanStep, LockFile } from '../../src/compiler/contract.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function mergePrismaStep(stepId: string, from: string, to = 'prisma/schema.prisma'): InstallPlanStep {
  return {
    stepId,
    blockId: `test/${stepId}`,
    registrySourceId: 'test-private',
    registryKind: 'private',
    registryLocation: 'workspace',
    registryPath: '.',
    sourceRoot: 'registry',
    action: 'merge-prisma',
    from,
    to
  };
}

test('install strategy registry serializes read-modify-write steps sharing one target', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await Promise.all([
      writeText(path.join(workspaceRoot, 'registry', 'alpha.prisma'), `model Alpha {
  id Int @id
}
`),
      writeText(path.join(workspaceRoot, 'registry', 'beta.prisma'), `model Beta {
  id Int @id
}
`)
    ]);

    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    await defaultInstallRegistry.executeAll([
      mergePrismaStep('alpha', 'alpha.prisma'),
      mergePrismaStep('beta', 'beta.prisma')
    ], {
      workspaceRoot,
      projectRoot,
      lock: {} as LockFile
    });

    const schema = await readText(path.join(projectRoot, 'prisma', 'schema.prisma'));
    expect(parsePrismaSchema(schema).blocks
      .filter((block) => block.type === 'model')
      .map((block) => block.name)).toEqual(['Alpha', 'Beta']);
  }, 'engineering-compiler-install-target-scheduling-');
});
