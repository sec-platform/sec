import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { ensureDir, writeJson, writeText } from "../../src/adapters/filesystem/files.ts";
import { runCommand } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { checkProvenanceFallback } from '../../src/adapters/workspace/project-integrity.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { ProvenanceFile } from '../../src/semantics/provenance/types.ts';
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
  }, 'prov-u-');
});

test('provenance fallback rejects a missing tracked project artifact', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
    const artifactPath = 'src/ui/page.ts';
    const absolutePath = path.join(root, artifactPath);

    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, 'export const value = 1;');
    const initialized = await runCommand('git', [
      '-c', 'core.longpaths=true', 'init', '--quiet', '--template='
    ], { cwd: workspaceRoot });
    expect(initialized.code, initialized.stderr).toBe(0);
    const staged = await runCommand('git', [
      '-c', 'core.longpaths=true', 'add', artifactPath
    ], { cwd: workspaceRoot });
    expect(staged.code, staged.stderr).toBe(0);
    await fs.rm(absolutePath);
    await writeJson(provenancePath, provenanceFor(artifactPath));

    await expect(checkProvenanceFallback(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });
  }, 'prov-t-');
});
