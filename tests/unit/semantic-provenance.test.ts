import path from 'node:path';

import { expect, test } from 'bun:test';

import { buildProvenance } from '../../src/compiler/emit/write-provenance.ts';
import { writeText } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { semanticArtifactLock } from '../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('semantic provenance preserves generator identity for a runtime artifact', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const target = 'src/installed/ticket/ticket-semantic-contract.ts';
    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    await writeText(path.join(projectRoot, target), 'export const generated = true;\n');

    const provenance = await buildProvenance(workspaceRoot, semanticArtifactLock(target));
    const artifact = provenance.artifacts.find((entry) => entry.path === target);

    expect(artifact).toMatchObject({
      originType: 'generated',
      originId: 'generator:ticket/basic:ticket-status-runtime-contract',
      sourceBlock: 'ticket/basic',
      sourcePath: 'catalog/registry/official/ticket.basic/contracts/ticket.yaml',
      runtimeTarget: target,
      generatedByPass: 'compose',
      generatorTaskId: 'generator:ticket/basic:ticket-status-runtime-contract',
      generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
      artifactEntityId: 'artifact:src/installed/ticket/ticket-semantic-contract.ts',
      semanticRevision: 'sha256:test-semantic',
      compilationTransactionId: 'pipeline:test-transaction',
      overrideStatus: 'none'
    });
    expect(artifact?.hash).toBeDefined();
  }, 'engineering-compiler-semantic-provenance-');
});

test('semantic provenance rejects a generated artifact without an execution binding', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const target = 'src/installed/ticket/ticket-semantic-contract.ts';
    const lock = semanticArtifactLock(target);
    delete lock.semanticLoweringTasks?.[0]?.artifactBinding;
    await expect(buildProvenance(workspaceRoot, lock)).rejects.toMatchObject({
      code: 'PROVENANCE-SEMANTIC-001'
    });
  }, 'engineering-compiler-semantic-provenance-missing-binding-');
});
