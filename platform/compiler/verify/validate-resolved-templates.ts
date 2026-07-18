import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CompilerError, formatCompilerFailure } from '../../shared/errors.ts';
import { copyRecursive, pathExists, removeDir, writeJson, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths, isPathInside } from '../../shared/paths.ts';
import { createPipelineSemanticContext } from '../../shared/pipeline-semantic-context.ts';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../../shared/process.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { ensureProjectDependencies } from '../../shared/project-runtime.ts';
import { WorkspaceWriteLeaseError } from '../../shared/workspace-write-lease.ts';
import { composeProject } from '../compose/compose-project.ts';
import { buildWorkspaceSemanticBundle } from '../semantic-frontend.ts';
import { typecheckProject } from './typecheck-project.ts';

export async function validateResolvedTemplates(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const sourcePaths = getWorkspacePaths(workspaceRoot);
  const isolated = process.env[ISOLATED_VERIFICATION_ENV_KEY] === '1';
  if (isolated) {
    await ensureProjectDependencies(sourcePaths.projectRoot, {
      beforeCommit: commitFence,
      installMode: 'prebound-only'
    });
  }
  await commitFence?.();
  const validationRoot = await fs.mkdtemp(path.join(
    isolated ? sourcePaths.projectRoot : os.tmpdir(),
    '.engineering-compiler-template-'
  ));
  const clonedLock = structuredClone(lock);
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

  try {
    for (const [registryPath, sourceRoot] of registryCopies) {
      if (isPathInside(sourceRoot, validationRoot)) {
        throw new CompilerError(
          'TEMPLATE-BUILD-002',
          'Workspace registry source cannot contain the template validation root',
          { registryPath }
        );
      }
    }
    await ensureProjectBase(validationRoot, commitFence);
    for (const [registryPath, sourceRoot] of registryCopies) {
      await copyRecursive(sourceRoot, path.join(validationRoot, registryPath), commitFence);
    }
    const validationPaths = getWorkspacePaths(validationRoot);
    await copyRecursive(sourcePaths.planPath, validationPaths.planPath, commitFence);
    if (await pathExists(sourcePaths.sourcePoliciesRoot)) {
      await copyRecursive(sourcePaths.sourcePoliciesRoot, validationPaths.sourcePoliciesRoot, commitFence);
    }
    const { lockPath, projectRoot } = validationPaths;
    await writeJson(lockPath, clonedLock, commitFence);
    const { snapshot, generatorPlan, semanticViews } = await buildWorkspaceSemanticBundle(validationRoot);
    const semanticContext = createPipelineSemanticContext(
      `template-validation:${snapshot.ir.inputRevision}`,
      snapshot,
      generatorPlan,
      semanticViews
    );
    await composeProject(validationRoot, clonedLock, semanticContext, { commitFence });
    if (isolated) {
      await typecheckProject(projectRoot, {
        dependencyProjectRoot: sourcePaths.projectRoot,
        isolated: true
      });
    } else {
      await typecheckProject(projectRoot);
    }
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError || (
      error instanceof CompilerError &&
      ['TEMPLATE-BUILD-002', 'VERIFY-ISOLATION-003'].includes(error.code)
    )) {
      throw error;
    }
    throw new CompilerError(
      'TEMPLATE-BUILD-001',
      'Resolved block templates failed validation before compose',
      formatCompilerFailure(error)
    );
  } finally {
    await removeDir(validationRoot, commitFence);
  }
}
