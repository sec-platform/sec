import { expect, test } from 'bun:test';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  GENERATED_ROUTES_ARTIFACT_PATH,
  planGeneratedRoutesArtifactV1,
  publishGeneratedRoutesArtifactV1
} from '../../platform/compiler/compose/generated-routes-artifact.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

function emptyResolvedLock(): LockFile {
  return { resolvedBlocks: [] } as unknown as LockFile;
}

test('generated routes planning is zero-write and publication matches planned bytes', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sec-routes-artifact-'));
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    await fs.mkdir(projectRoot, { recursive: true });

    const plan = await planGeneratedRoutesArtifactV1(workspaceRoot, emptyResolvedLock());
    expect(plan.schema).toBe('sec-generated-routes-artifact-plan-v1');
    expect(plan.relativePath).toBe(GENERATED_ROUTES_ARTIFACT_PATH);
    expect(Buffer.from(plan.bytes).toString('utf8')).toContain('export const routes: GeneratedRoute[] = [');

    await expect(fs.lstat(path.join(projectRoot, 'generated'))).rejects.toMatchObject({ code: 'ENOENT' });

    await publishGeneratedRoutesArtifactV1(workspaceRoot, plan);
    const published = await fs.readFile(path.join(projectRoot, ...GENERATED_ROUTES_ARTIFACT_PATH.split('/')));
    expect(published.equals(Buffer.from(plan.bytes))).toBe(true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
