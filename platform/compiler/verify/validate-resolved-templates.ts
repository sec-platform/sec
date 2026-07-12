import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CompilerError, formatCompilerFailure } from '../../shared/errors.ts';
import { copyRecursive, pathExists, removeDir, writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PipelineSemanticContext } from '../../shared/pipeline-types.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { composeProject } from '../compose/compose-project.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../ir/load-workspace-engineering-ir-input.ts';
import { buildValidatedEngineeringIR } from '../ir/validate-engineering-ir.ts';
import { buildSemanticGeneratorPlan } from '../semantic-plan.ts';
import { buildSemanticViewSet } from '../projection/build-semantic-view-set.ts';
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
    const sourcePaths = getWorkspacePaths(workspaceRoot);
    const validationPaths = getWorkspacePaths(validationRoot);
    await copyRecursive(sourcePaths.planPath, validationPaths.planPath);
    if (await pathExists(sourcePaths.sourcePoliciesRoot)) {
      await copyRecursive(sourcePaths.sourcePoliciesRoot, validationPaths.sourcePoliciesRoot);
    }
    const { lockPath, projectRoot } = validationPaths;
    await writeJson(lockPath, clonedLock);
    const { engineeringIRInput, generatorDeclarations } = await loadWorkspaceEngineeringIRBuildInput(validationRoot);
    const snapshot = buildValidatedEngineeringIR(engineeringIRInput);
    const generatorPlan = buildSemanticGeneratorPlan(snapshot, generatorDeclarations);
    const semanticViews = buildSemanticViewSet(snapshot);
    const semanticContext: PipelineSemanticContext = {
      transactionId: `template-validation:${snapshot.ir.inputRevision}`,
      inputRevision: snapshot.ir.inputRevision,
      semanticRevision: snapshot.ir.semanticRevision,
      snapshot,
      generatorPlan,
      semanticViews
    };
    await composeProject(validationRoot, clonedLock, semanticContext);
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
