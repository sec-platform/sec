import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../../runtime-state/physical/runtime/process.ts';
import { ensureProjectDependencies } from '../../toolchain/dependencies/runtime.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { copyRecursive } from '../../workspace/discovery.ts';
import { pathExists, removeDir, writeJson, type CommitFence } from '../../workspace/files.ts';
import { WorkspaceWriteLeaseError } from '../../workspace/lease.ts';
import {
  getWorkspacePaths,
  isPathInside,
  resolveWorkspaceArtifactPath
} from '../../workspace/paths.ts';
import { ensureProjectBase } from '../../workspace/project.ts';
import { composeProject } from '../compose/compose-project.ts';
import type { LockFile } from '../contract.ts';
import { CompilerError, formatCompilerFailure } from '../errors.ts';
import { createPipelineSemanticContext } from '../pipeline/semantic-context.ts';
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
    await ensureProjectDependencies(sourcePaths.workspaceRoot, {
      beforeCommit: commitFence,
      installMode: 'prebound-only'
    });
  }
  await commitFence?.();
  const validationRoot = await fs.mkdtemp(path.join(
    isolated ? sourcePaths.workspaceRoot : os.tmpdir(),
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
    await copyRecursive(sourcePaths.workspaceConfigPath, validationPaths.workspaceConfigPath, commitFence);
    if (await pathExists(sourcePaths.policiesRoot)) {
      await copyRecursive(sourcePaths.policiesRoot, validationPaths.policiesRoot, commitFence);
    }
    const lockPath = resolveWorkspaceArtifactPath(validationRoot, CI_ARTIFACT_FILES.graphLock);
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
      await typecheckProject(validationRoot, {
        dependencyProjectRoot: sourcePaths.workspaceRoot,
        isolated: true
      });
    } else {
      await typecheckProject(validationRoot);
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
