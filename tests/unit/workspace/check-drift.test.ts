import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureDir, writeJson, writeText } from "../../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { checkReferenceDrift } from '../../../src/adapters/workspace/project-integrity.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import type { ProvenanceFile } from '../../../src/semantics/provenance/types.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

test('strict reference drift accepts absent or matching provenance and rejects modified or missing files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await checkReferenceDrift(workspaceRoot);

    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
    const relativeFilePath = 'src/ui/page.ts';
    const absolutePath = path.join(root, relativeFilePath);
    const fileContent = 'export default function Page() {}';
    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, fileContent);
    await writeJson(provenancePath, {
      formatVersion: '1',
      artifacts: [{
        path: relativeFilePath,
        originType: 'generated',
        originId: relativeFilePath,
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none',
        hash: computeHash(fileContent)
      }]
    } satisfies ProvenanceFile);
    await checkReferenceDrift(workspaceRoot);

    await writeText(absolutePath, 'modified content');
    const modified = await checkReferenceDrift(workspaceRoot).then(() => undefined, error => error);
    expect(modified).toBeInstanceOf(CodedFailure);
    expect(modified).toMatchObject({
      code: 'ERROR-DRIFT-001',
      message: expect.stringContaining('Read-only project file modified')
    });

    await fs.rm(path.join(root, 'src'), { recursive: true });
    const missing = await checkReferenceDrift(workspaceRoot).then(() => undefined, error => error);
    expect(missing).toBeInstanceOf(CodedFailure);
    expect(missing).toMatchObject({
      code: 'ERROR-DRIFT-001',
      message: expect.stringContaining('Read-only project file is missing')
    });
  });
});
