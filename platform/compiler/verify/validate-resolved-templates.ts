import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CompilerError, formatCompilerFailure } from '../../shared/errors.ts';
import { copyRecursive, removeDir, writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { composeProject } from '../compose/compose-project.ts';
import { typecheckProject } from './typecheck-project.ts';

export async function validateResolvedTemplates(workspaceRoot: string, lock: LockFile): Promise<void> {
  const validationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-template-'));
  const clonedLock = structuredClone(lock);

  try {
    await ensureProjectBase(validationRoot);
    const registryCopies = new Map<string, string>();
    for (const block of clonedLock.resolvedBlocks) {
      if (block.registryLocation !== 'workspace' || registryCopies.has(block.registryPath)) {
        continue;
      }
      registryCopies.set(
        block.registryPath,
        path.join(workspaceRoot, block.registryPath)
      );
    }
    for (const [registryPath, sourceRoot] of registryCopies) {
      await copyRecursive(sourceRoot, path.join(validationRoot, registryPath));
    }
    const { lockPath, projectRoot } = getWorkspacePaths(validationRoot);
    await writeJson(lockPath, clonedLock);
    await composeProject(validationRoot, clonedLock);
    await typecheckProject(projectRoot);
  } catch (error) {
    throw new CompilerError(
      'TEMPLATE-BUILD-001',
      'Resolved block templates failed validation before compose',
      formatCompilerFailure(error)
    );
  } finally {
    await removeDir(validationRoot);
  }
}
