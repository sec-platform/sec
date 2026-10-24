import { createHash } from 'node:crypto';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { ensureDir, writeJson, writeText } from "../../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { writeProjectBaseline } from '../../../src/adapters/workspace/project-baseline.ts';
import { checkProjectBeforeVerify } from '../../../src/adapters/workspace/project-integrity.ts';
import { checkProjectWriteBoundary } from '../../../src/adapters/workspace/project-write-boundary.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { ProvenanceFile } from '../../../src/semantics/provenance/types.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function baselinePathInput(generatedPath: string) {
  return {
    artifactPaths: [generatedPath]
  };
}

function provenanceFor(artifactPath: string, content: string): ProvenanceFile {
  return {
    formatVersion: '1',
    artifacts: [{
      path: artifactPath,
      originType: 'generated',
      originId: artifactPath,
      generatedByPass: 'compose',
      verifiedBy: [],
      overrideStatus: 'none',
      hash: digest(content)
    }]
  };
}

test('verification checks provenance until a current baseline supersedes it and detects drift in both phases', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
    const artifactPath = 'src/ui/page.ts';
    const absolutePath = path.join(root, artifactPath);
    const previousContent = 'export const value = 1;';
    const currentContent = 'export const value = 2;';

    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, previousContent);
    await writeJson(provenancePath, provenanceFor(artifactPath, previousContent));

    await checkProjectWriteBoundary(workspaceRoot);
    await checkProjectBeforeVerify(workspaceRoot);
    await writeText(absolutePath, 'export const value = 9;');
    await expect(checkProjectBeforeVerify(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });

    await writeText(absolutePath, currentContent);
    await writeProjectBaseline(workspaceRoot, baselinePathInput(artifactPath));
    await checkProjectBeforeVerify(workspaceRoot);

    await writeText(absolutePath, `${currentContent}\nexport const changed = true;`);
    await expect(checkProjectBeforeVerify(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });
  }, 'engineering-compiler-project-baseline-phase-');
});
