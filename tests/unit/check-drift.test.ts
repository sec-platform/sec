import { expect, test, describe } from 'bun:test';
import path from 'node:path';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { checkReferenceDrift } from '../../platform/compiler/verify/check-drift.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { writeJson, writeText, ensureDir } from '../../platform/shared/fs.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import type { ProvenanceFile } from '../../platform/shared/provenance-types.ts';
import { createHash } from 'node:crypto';

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
      const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);

      // Create a dummy project file
      const relativeFilePath = 'app/page.tsx';
      const fileContent = 'export default function Page() {}';
      const fileHash = computeHash(fileContent);

      await ensureDir(path.join(projectRoot, 'app'));
      await writeText(path.join(projectRoot, relativeFilePath), fileContent);

      // Create provenance
      const provenance: ProvenanceFile = {
        formatVersion: '1',
        artifacts: [
          {
            path: relativeFilePath,
            originType: 'generated',
            originId: 'app/page.tsx',
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
      const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);

      const relativeFilePath = 'app/page.tsx';
      const originalContent = 'export default function Page() {}';
      const originalHash = computeHash(originalContent);

      await ensureDir(path.join(projectRoot, 'app'));
      await writeText(path.join(projectRoot, relativeFilePath), 'modified content');

      // Create provenance
      const provenance: ProvenanceFile = {
        formatVersion: '1',
        artifacts: [
          {
            path: relativeFilePath,
            originType: 'generated',
            originId: 'app/page.tsx',
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
      const { provenancePath } = getWorkspacePaths(workspaceRoot);

      const relativeFilePath = 'app/page.tsx';
      const originalHash = computeHash('some content');

      // Create provenance but do not create the file in projectRoot
      const provenance: ProvenanceFile = {
        formatVersion: '1',
        artifacts: [
          {
            path: relativeFilePath,
            originType: 'generated',
            originId: 'app/page.tsx',
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
      const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);

      const relativeFilePath = 'custom/normalizer.ts';
      const originalContent = 'export default function normalize() {}';
      const originalHash = computeHash(originalContent);

      await ensureDir(path.join(projectRoot, 'custom'));
      // File is modified
      await writeText(path.join(projectRoot, relativeFilePath), 'modified normalization logic');

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
