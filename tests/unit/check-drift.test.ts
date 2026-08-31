import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CompilerError } from '../../src/compiler/errors.ts';
import { checkReferenceDrift } from '../../src/compiler/verify/check-drift.ts';
import type { ProvenanceFile } from '../../src/semantic/provenance/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { ensureDir, writeJson, writeText } from '../../src/workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('checkReferenceDrift', () => {
  test('returns successfully if provenance.json does not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      // Should not throw
      await checkReferenceDrift(workspaceRoot);
    });
  });

  test('passes if read-only files match their hashes', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
      const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);

      // Create a dummy generated workspace file
      const relativeFilePath = 'src/ui/page.ts';
      const fileContent = 'export default function Page() {}';
      const fileHash = computeHash(fileContent);

      await ensureDir(path.dirname(path.join(root, relativeFilePath)));
      await writeText(path.join(root, relativeFilePath), fileContent);

      // Create provenance
      const provenance: ProvenanceFile = {
        formatVersion: '1',
        artifacts: [
          {
            path: relativeFilePath,
            originType: 'generated',
            originId: relativeFilePath,
            generatedByPass: 'compose',
            verifiedBy: [],
            overrideStatus: 'none',
            hash: fileHash
          }
        ]
      };
      await writeJson(provenancePath, provenance);

      // Should check and pass without throwing
      await checkReferenceDrift(workspaceRoot);
    });
  });

  test('throws ERROR-DRIFT-001 if a read-only file is modified', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
      const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);

      const relativeFilePath = 'src/ui/page.ts';
      const originalContent = 'export default function Page() {}';
      const originalHash = computeHash(originalContent);

      await ensureDir(path.dirname(path.join(root, relativeFilePath)));
      await writeText(path.join(root, relativeFilePath), 'modified content');

      // Create provenance
      const provenance: ProvenanceFile = {
        formatVersion: '1',
        artifacts: [
          {
            path: relativeFilePath,
            originType: 'generated',
            originId: relativeFilePath,
            generatedByPass: 'compose',
            verifiedBy: [],
            overrideStatus: 'none',
            hash: originalHash
          }
        ]
      };
      await writeJson(provenancePath, provenance);

      let error: any;
      try {
        await checkReferenceDrift(workspaceRoot);
      } catch (e: any) {
        error = e;
      }

      expect(error).toBeInstanceOf(CompilerError);
      expect(error.code).toBe('ERROR-DRIFT-001');
      expect(error.message).toContain('Read-only project file modified');
    });
  });

  test('throws ERROR-DRIFT-001 if a read-only file is missing', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);

      const relativeFilePath = 'src/ui/page.ts';
      const originalHash = computeHash('some content');

      // Create provenance but do not create the workspace file.
      const provenance: ProvenanceFile = {
        formatVersion: '1',
        artifacts: [
          {
            path: relativeFilePath,
            originType: 'generated',
            originId: relativeFilePath,
            generatedByPass: 'compose',
            verifiedBy: [],
            overrideStatus: 'none',
            hash: originalHash
          }
        ]
      };
      await writeJson(provenancePath, provenance);

      let error: any;
      try {
        await checkReferenceDrift(workspaceRoot);
      } catch (e: any) {
        error = e;
      }

      expect(error).toBeInstanceOf(CompilerError);
      expect(error.code).toBe('ERROR-DRIFT-001');
      expect(error.message).toContain('Read-only project file is missing');
    });
  });

  test('does not throw if a slot file (writable zone) is modified or missing', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
      const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);

      const relativeFilePath = 'src/slots/normalizer.ts';
      const originalContent = 'export default function normalize() {}';
      const originalHash = computeHash(originalContent);

      await ensureDir(path.dirname(path.join(root, relativeFilePath)));
      // File is modified
      await writeText(path.join(root, relativeFilePath), 'modified normalization logic');

      // Create provenance with originType: 'slot'
      const provenance: ProvenanceFile = {
        formatVersion: '1',
        artifacts: [
          {
            path: relativeFilePath,
            originType: 'slot',
            originId: 'normalizer',
            generatedByPass: 'adapt',
            verifiedBy: [],
            overrideStatus: 'none',
            hash: originalHash
          }
        ]
      };
      await writeJson(provenancePath, provenance);

      // Should check and pass because it's a slot file (not in read-only zone)
      await checkReferenceDrift(workspaceRoot);
    });
  });
});
