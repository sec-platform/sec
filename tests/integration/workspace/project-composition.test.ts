import { expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { validateResolvedTemplates as validateWithComposition } from '../../../src/adapters/verification/validate-resolved-templates.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { readLockFile } from '../../../src/adapters/workspace/lock.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { composeProject } from '../../../src/bootstrap/engineering/project-composition.ts';
import { initWorkspace } from '../../../src/bootstrap/engineering/workspace-orchestrator.ts';
import type { DependencyProjectOperationFactory } from '../../../src/execution/dependency-materialization.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const unreachedDependencies: DependencyProjectOperationFactory = {
  forWorkspace: () => {
    throw new Error('composition failure must stop before dependency materialization');
  }
};

// Independent expected outputs for the empty resolved workspace.
const minimalGeneratedPaths = [
  CI_ARTIFACT_FILES.blockUsageMap,
  CI_ARTIFACT_FILES.installManifest,
  CI_ARTIFACT_FILES.verificationReport,
  'package.json',
  'src/runtime/database.ts',
  'src/runtime/store.ts',
  'tests/fast.test.ts',
  'tsconfig.json'
].sort();

// Real providers, no dependency install/typecheck: composition publishes into
// the validation consumer's isolated root before the injected failure.
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
      const persisted = readLockFile(temporaryRoot);
      expect(persisted.passStatus.compose).toBe('succeeded');
      expect(persisted.generatedPaths).toEqual(minimalGeneratedPaths);
      expect(JSON.parse(await readFile(resolveWorkspaceArtifactPath(temporaryRoot, CI_ARTIFACT_FILES.installManifest), 'utf8'))).toEqual([]);
      expect(JSON.parse(await readFile(resolveWorkspaceArtifactPath(temporaryRoot, CI_ARTIFACT_FILES.blockUsageMap), 'utf8'))).toEqual({ blocks: [] });
      throw primary;
    })).rejects.toMatchObject({ code: 'TEMPLATE-BUILD-001', cause: primary });
    expect(composedRoot).toBeDefined();
    await expect(stat(composedRoot!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(readLockFile(root).passStatus.compose).toBe('pending');
  });
});
