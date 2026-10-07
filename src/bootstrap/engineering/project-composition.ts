import path from 'node:path';
import { executeProjectComposition, type ComposeProjectOptions, type ProjectCompositionOperations } from '../../application/project-composition.ts';

import { applyOverrides } from '../../adapters/compilation/compose/apply-overrides.ts';
import { formatOutputFiles } from '../../adapters/compilation/compose/format-output-files.ts';
import { generateRuntimeLibraryScaffold } from '../../adapters/compilation/compose/generate-runtime-library.ts';
import { installOpaqueModules } from '../../adapters/compilation/compose/install-opaque-modules.ts';
import { defaultInstallRegistry } from '../../adapters/compilation/compose/install-strategies.ts';
import { mergePrismaTemplate } from '../../adapters/compilation/compose/merge-prisma-template.ts';
import { ensureDir, writeJson } from "../../adapters/filesystem/files.ts";
import { lowerSemanticTasks } from '../../adapters/targets/typescript/semantic-lowering.ts';
import { resolveWorkspaceArtifactPath } from "../../adapters/workspace-context.ts";
import { saveLock } from "../../adapters/workspace/lock.ts";
import { ensureProjectBase } from '../../adapters/workspace/project-base.ts';
import { writeProjectBaseline } from '../../adapters/workspace/project-baseline.ts';
import { checkProjectWriteBoundary } from '../../adapters/workspace/project-write-boundary.ts';
import { loadOverrideManifest } from '../../adapters/workspace/sources/load-override-manifest.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { LockFile } from '../../compiler/contract.ts';
import type { PipelineSemanticContext } from '../../compiler/pipeline/semantic-context.ts';

export type { ComposeProjectOptions } from '../../application/project-composition.ts';

/** Bind physical composition capabilities, without executing the use case. */
export function createProjectCompositionOperations(workspaceRoot: string): ProjectCompositionOperations {
  workspaceRoot = path.resolve(workspaceRoot);
  const blockUsageMapPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.blockUsageMap);
  const installManifestPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.installManifest);
  return {
    checkWriteBoundary: async () => { await checkProjectWriteBoundary(workspaceRoot); },
    ensureBase: fence => ensureProjectBase(workspaceRoot, fence),
    install: (steps, lock, commitFence, signal) => defaultInstallRegistry.executeAll(
      steps, Object.freeze({ workspaceRoot, lock, commitFence, signal })
    ),
    mergePrisma: fence => mergePrismaTemplate(workspaceRoot, fence),
    installOpaque: (materializationMode, commitFence) =>
      installOpaqueModules(workspaceRoot, { commitFence, materializationMode }),
    prepareArtifactDirectories: async fence => {
      await ensureDir(path.dirname(blockUsageMapPath), fence);
      await ensureDir(path.dirname(installManifestPath), fence);
    },
    publishBlockUsage: (blocks, fence) => writeJson(blockUsageMapPath, { blocks }, fence),
    lowerSemantic: (semantic, fence) => lowerSemanticTasks(workspaceRoot, semantic, fence),
    generateRuntime: (lock, fence, signal) => generateRuntimeLibraryScaffold(workspaceRoot, lock, fence, signal),
    format: (paths, fence, signal) => formatOutputFiles(workspaceRoot, paths, fence, signal),
    applyOverrides: fence => applyOverrides(workspaceRoot, fence),
    publishInstallManifest: (manifest, fence) => writeJson(installManifestPath, manifest, fence),
    readOverrideTargets: async () => (await loadOverrideManifest(workspaceRoot)).overrides.map(entry => entry.target),
    publishBaseline: async (artifactPaths, fence) => { await writeProjectBaseline(workspaceRoot, { artifactPaths }, fence); },
    persistLock: (lock, fence) => saveLock(workspaceRoot, lock, fence)
  };
}

/** Bind template validation to the same application workflow as workspace composition. */
export async function composeProject(
  workspaceRoot: string,
  lock: LockFile,
  semanticContext: PipelineSemanticContext,
  options: ComposeProjectOptions
): Promise<LockFile> {
  return executeProjectComposition(lock, semanticContext, options, createProjectCompositionOperations(workspaceRoot));
}
