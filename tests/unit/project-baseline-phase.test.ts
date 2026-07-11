import { createHash } from 'node:crypto';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { ensureDir, writeJson, writeText } from '../../platform/shared/fs.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { writeProjectBaseline } from '../../platform/shared/project-baseline.ts';
import {
  checkProjectBeforeCompile,
  checkProjectBeforeVerify
} from '../../platform/shared/project-integrity.ts';
import type { ProvenanceFile } from '../../platform/shared/provenance-types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function lockFor(generatedPath: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'baseline-test',
      name: 'baseline-test',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [generatedPath],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'pending',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
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

test('current baseline accepts compiler output changes and detects later project drift', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);
    const artifactPath = 'app/page.tsx';
    const absolutePath = path.join(projectRoot, artifactPath);
    const previousContent = 'export const value = 1;';
    const currentContent = 'export const value = 2;';

    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, previousContent);
    await writeJson(provenancePath, provenanceFor(artifactPath, previousContent));

    await checkProjectBeforeCompile(workspaceRoot);

    await writeText(absolutePath, currentContent);
    await writeProjectBaseline(workspaceRoot, lockFor(artifactPath));
    await checkProjectBeforeVerify(workspaceRoot);

    await writeText(absolutePath, `${currentContent}\nexport const changed = true;`);
    await expect(checkProjectBeforeVerify(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });
  }, 'engineering-compiler-project-baseline-phase-');
});

test('verify falls back to artifact provenance when no current project baseline exists', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);
    const artifactPath = 'app/page.tsx';
    const absolutePath = path.join(projectRoot, artifactPath);
    const expectedContent = 'export const value = 1;';

    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, expectedContent);
    await writeJson(provenancePath, provenanceFor(artifactPath, expectedContent));

    await checkProjectBeforeVerify(workspaceRoot);

    await writeText(absolutePath, 'export const value = 9;');
    await expect(checkProjectBeforeVerify(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });
  }, 'engineering-compiler-project-baseline-fallback-');
});
