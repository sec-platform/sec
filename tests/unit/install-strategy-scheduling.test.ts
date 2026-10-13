import path from 'node:path';

import { expect, test } from 'bun:test';

import { defaultInstallRegistry } from '../../src/adapters/compilation/compose/install-strategies.ts';
import { readText, writeText } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import type { InstallPlanStep, LockFile } from '../../src/compiler/contract.ts';
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

    const { prismaRoot } = getWorkspacePaths(workspaceRoot);
    await defaultInstallRegistry.executeAll([
      mergePrismaStep('alpha', 'alpha.prisma'),
      mergePrismaStep('beta', 'beta.prisma')
    ], {
      workspaceRoot,
      lock: {} as LockFile
    });

    const schema = await readText(path.join(prismaRoot, 'schema.prisma'));
    expect(schema).toBe(`model Alpha {
  id Int @id
}

model Beta {
  id Int @id
}
`);
  }, 'engineering-compiler-install-target-scheduling-');
});
