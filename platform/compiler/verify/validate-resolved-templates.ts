import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeProject } from '../compose/compose-project.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { removeDir } from '../../shared/fs.ts';
import { typecheckProject } from './typecheck-project.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { LockFile } from '../../shared/types.ts';

export async function validateResolvedTemplates(lock: LockFile): Promise<void> {
  const validationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-template-'));
  const clonedLock = structuredClone(lock);

  try {
    await ensureProjectBase(validationRoot);
    const { lockPath, projectRoot } = getWorkspacePaths(validationRoot);
    await fs.writeFile(lockPath, `${JSON.stringify(clonedLock, null, 2)}\n`, 'utf8');
    await composeProject(validationRoot, clonedLock);
    await typecheckProject(projectRoot);
  } catch (error) {
    throw new CompilerError(
      'TEMPLATE-BUILD-001',
      'Resolved block templates failed validation before compose',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await removeDir(validationRoot);
  }
}
