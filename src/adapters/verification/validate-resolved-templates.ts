import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../runtime-state/physical/runtime/process.ts';
import { ensureProjectDependencies } from '../toolchain/dependencies/runtime.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { ensureProjectBase } from '../workspace/project-base.ts';
import { pathExists, removeDir, writeJson } from "../filesystem/files.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { WorkspaceWriteLeaseError } from '../filesystem/write-lease.ts';
import { copyRecursive } from '../filesystem/discovery.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../workspace-context.ts";
import { isPathInside, resolvePathInside } from "../../contracts/relative-path.ts";
import { composeProject } from '../compilation/compose/compose-project.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError, formatCompilerFailure } from '../../compiler/errors.ts';
import { createPipelineSemanticContext } from '../../compiler/pipeline/semantic-context.ts';
import { buildWorkspaceSemanticBundle } from '../workspace/semantic-bundle.ts';
import { typecheckProject } from './typecheck-project.ts';

export async function validateResolvedTemplates(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  workspaceRoot = path.resolve(workspaceRoot);
  if (commitFence !== undefined && typeof commitFence !== 'function') {
    throw new TypeError('Template validation commit fence must be callable');
  }
  const sourcePaths = getWorkspacePaths(workspaceRoot);
  const isolated = process.env[ISOLATED_VERIFICATION_ENV_KEY] === '1';
  // Complete data preparation before acquiring a temporary root. A clone or
  // registry-path failure must not leak an allocation outside the cleanup scope.
  const clonedLock = structuredClone(lock);
  const registryCopies = new Map<string, string>();
  for (const block of clonedLock.resolvedBlocks) {
    if (block.registryLocation !== 'workspace' || registryCopies.has(block.registryPath)) continue;
    const sourceRoot = typeof block.registryPath === 'string'
      ? resolvePathInside(workspaceRoot, block.registryPath) : null;
    if (sourceRoot === null) {
      throw new CompilerError('TEMPLATE-BUILD-002', 'Workspace registry source escapes its validated workspace',
        { registryPath: block.registryPath });
    }
    if (isolated && isPathInside(sourceRoot, sourcePaths.workspaceRoot)) {
      throw new CompilerError('TEMPLATE-BUILD-002',
        'Workspace registry source cannot contain the template validation root', { registryPath: block.registryPath });
    }
    registryCopies.set(block.registryPath, sourceRoot);
  }
  if (isolated) {
    await ensureProjectDependencies(sourcePaths.workspaceRoot, {
      beforeCommit: commitFence,
      installMode: 'prebound-only'
    });
  }
  await commitFence?.();
  let failure: { error: unknown } | undefined;
  const validationRoot = await fs.mkdtemp(path.join(
    isolated ? sourcePaths.workspaceRoot : os.tmpdir(),
    '.engineering-compiler-template-'
  ));

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
      const targetRoot = resolvePathInside(validationRoot, registryPath);
      if (targetRoot === null) {
        throw new CompilerError('TEMPLATE-BUILD-002', 'Template registry destination escapes its temporary workspace',
          { registryPath });
      }
      await copyRecursive(sourceRoot, targetRoot, commitFence);
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
    await composeProject(validationRoot, clonedLock, semanticContext, {
      commitFence,
      opaqueModuleMaterializationMode: 'workspace-link'
    });
    if (isolated) {
      await typecheckProject(validationRoot, {
        dependencyProjectRoot: sourcePaths.workspaceRoot,
        isolated: true
      });
    } else {
      await typecheckProject(validationRoot);
    }
  } catch (error) {
    // Presence is separate from the thrown value: undefined/null/false/0 can
    // all be genuine failures and must survive a later cleanup error.
    failure = { error };
  }
  try {
    // Retain the original effect fence. Failure is not permission to force
    // cleanup through revoked authority or delete any other workspace.
    await removeDir(validationRoot, commitFence);
  } catch (cleanupError) {
    throw new CompilerError(
      'TEMPLATE-BUILD-003',
      'Template validation workspace cleanup did not complete',
      { validationRoot, validationCompleted: failure === undefined },
      { cause: failure === undefined ? cleanupError : new AggregateError(
        [failure.error, cleanupError], 'Template validation and workspace cleanup failed', { cause: failure.error }
      ) }
    );
  }
  if (failure !== undefined) throw templateValidationFailure(failure.error);
}

function templateValidationFailure(error: unknown): unknown {
  try {
    if (error instanceof WorkspaceWriteLeaseError || (error instanceof CompilerError &&
        ['TEMPLATE-BUILD-002', 'VERIFY-ISOLATION-003'].includes(error.code))) return error;
  } catch { /* A hostile or revoked thrown object is still the original cause. */ }
  return new CompilerError('TEMPLATE-BUILD-001',
    'Resolved block templates failed validation before compose', formatCompilerFailure(error), { cause: error });
}
