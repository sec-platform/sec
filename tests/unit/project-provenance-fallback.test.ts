import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { runCommand } from '../../src/runtime-state/physical/runtime/process.ts';
import type { ProvenanceFile } from '../../src/semantic/provenance/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { checkProvenanceFallback } from '../../src/workspace/application/project-integrity.ts';
import { ensureDir, writeJson, writeText } from '../../src/workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function provenanceFor(artifactPath: string): ProvenanceFile {
  return {
    formatVersion: '1',
    artifacts: [{
      path: artifactPath,
      originType: 'generated',
      originId: artifactPath,
      generatedByPass: 'compose',
      verifiedBy: [],
      overrideStatus: 'none',
      hash: '0'.repeat(64)
    }]
  };
}

test('provenance fallback allows a missing untracked generated artifact to be rebuilt', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
    await writeJson(provenancePath, provenanceFor('src/generated/routes.ts'));

    await checkProvenanceFallback(workspaceRoot);
  }, 'engineering-compiler-provenance-untracked-missing-');
});

test('provenance fallback rejects a missing tracked project artifact', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
    const artifactPath = 'src/ui/page.ts';
    const absolutePath = path.join(root, artifactPath);

    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, 'export const value = 1;');
    expect((await runCommand('git', ['init'], { cwd: workspaceRoot })).code).toBe(0);
    expect((await runCommand('git', ['add', artifactPath], { cwd: workspaceRoot })).code).toBe(0);
    await fs.rm(absolutePath);
    await writeJson(provenancePath, provenanceFor(artifactPath));

    await expect(checkProvenanceFallback(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });
  }, 'engineering-compiler-provenance-tracked-missing-');
});
