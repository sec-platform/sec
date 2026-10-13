import { expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { validateResolvedTemplates as validateWithComposition } from '../../src/adapters/verification/validate-resolved-templates.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { readLockFile, saveLock } from '../../src/adapters/workspace/lock.ts';
import { buildWorkspaceSemanticBundle } from '../../src/adapters/workspace/semantic-bundle.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { composeWorkspace } from '../../src/bootstrap/engineering/compose-orchestrator.ts';
import { composeProject } from '../../src/bootstrap/engineering/project-composition.ts';
import { initWorkspace } from '../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { createPipelineSemanticContext } from '../../src/compiler/pipeline/semantic-context.ts';
import type { DependencyProjectOperationFactory } from '../../src/execution/dependency-materialization.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const unreachedDependencies: DependencyProjectOperationFactory = {
  forWorkspace: () => {
    throw new Error('composition failure must stop before dependency materialization');
  }
};

// Real providers, no dependency install/typecheck: an empty resolved workspace
// exercises baseline/lock/artifact publication through both real consumers.
test('workspace bootstrap and template composition entry publish the same application result', async () => {
  const observe = (entry: 'workspace' | 'template') => withTempWorkspace(async root => {
    await initWorkspace(root);
    const lock = readLockFile(root);
    Object.assign(lock.passStatus, { parse: 'succeeded', align: 'succeeded', resolve: 'succeeded' });
    await saveLock(root, lock);
    if (entry === 'workspace') {
      await composeWorkspace(root, { opaqueModuleMaterializationMode: 'workspace-link' });
    } else {
      const { snapshot, generatorPlan, semanticViews } = await buildWorkspaceSemanticBundle(root);
      const semantic = createPipelineSemanticContext('template-composition:test', snapshot, generatorPlan, semanticViews);
      await composeProject(root, lock, semantic, { opaqueModuleMaterializationMode: 'workspace-link' });
    }
    const persisted = readLockFile(root);
    expect(persisted.passStatus.compose).toBe('succeeded');
    expect(persisted.generatedPaths).toContain(CI_ARTIFACT_FILES.installManifest);
    expect(persisted.generatedPaths).toContain(CI_ARTIFACT_FILES.blockUsageMap);
    const manifest = JSON.parse(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.installManifest), 'utf8'));
    const usage = JSON.parse(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.blockUsageMap), 'utf8'));
    expect(manifest).toEqual([]);
    expect(usage).toEqual({ blocks: [] });
    return { generatedPaths: persisted.generatedPaths, manifest, usage };
  });
  expect(await observe('workspace')).toEqual(await observe('template'));
});


test('template validation consumes injected composition and preserves its failure through cleanup', async () => {
  await withTempWorkspace(async root => {
    await initWorkspace(root);
    const lock = readLockFile(root);
    const primary = new Error('composition completed; stop before typecheck');
    const fence = async () => {};
    let composedRoot: string | undefined;
    await expect(validateWithComposition(root, lock, fence, unreachedDependencies, async (temporaryRoot, selectedLock, semantic, selectedFence) => {
      composedRoot = temporaryRoot;
      expect(temporaryRoot).not.toBe(root);
      expect(selectedLock).not.toBe(lock);
      expect(selectedFence).toBe(fence);
      await composeProject(temporaryRoot, selectedLock, semantic, {
        commitFence: selectedFence, opaqueModuleMaterializationMode: 'workspace-link'
      });
      expect(readLockFile(temporaryRoot).passStatus.compose).toBe('succeeded');
      throw primary;
    })).rejects.toMatchObject({ code: 'TEMPLATE-BUILD-001', cause: primary });
    expect(composedRoot).toBeDefined();
    await expect(stat(composedRoot!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(readLockFile(root).passStatus.compose).toBe('pending');
  });
});
