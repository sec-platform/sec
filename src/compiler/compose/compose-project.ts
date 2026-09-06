import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { ensureProjectBase } from '../../workspace/application/project-base.ts';
import { checkProjectWriteBoundary } from '../../workspace/application/project-write-boundary.ts';
import { ensureDir, writeJson, type CommitFence } from '../../workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace/runtime/paths.ts';
import { writeProjectBaseline } from '../../workspace/runtime/project-baseline.ts';
import type { InstallPlanStep, LockFile } from '../contract.ts';
import { addGeneratedPaths, saveLock } from '../lock.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import type { PipelineSemanticContext } from '../pipeline/types.ts';
import { lowerSemanticTasks } from '../semantic-lowering.ts';
import { applyOverrides } from './apply-overrides.ts';
import { formatOutputFiles } from './format-output-files.ts';
import { generateRuntimeLibraryScaffold } from './generate-runtime-library.ts';
import { installOpaqueModules } from './install-opaque-modules.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import { mergePrismaTemplate } from './merge-prisma-template.ts';
import type { OpaqueModuleMaterializationMode } from './opaque-module-materialization.ts';

export type ComposeProjectOptions = Readonly<{
  commitFence?: CommitFence;
  signal?: AbortSignal;
  opaqueModuleMaterializationMode: OpaqueModuleMaterializationMode;
}>;

export async function composeProject(
  workspaceRoot: string,
  lock: LockFile,
  semanticContext: PipelineSemanticContext,
  options: ComposeProjectOptions
): Promise<LockFile> {
  workspaceRoot = path.resolve(workspaceRoot);
  const { commitFence: providerFence, signal, opaqueModuleMaterializationMode } = options;
  if (providerFence !== undefined && typeof providerFence !== 'function') throw new TypeError('Compose commit fence must be callable');
  signal?.throwIfAborted();
  // One admitted plan drives both execution and its manifest, not a later
  // caller-mutated lock.installPlan. Lock state remains owned by composition.
  const installPlan = Object.freeze(lock.installPlan.map(step => Object.freeze({ ...step })));
  const commitFence: CommitFence = async () => {
    signal?.throwIfAborted();
    if (providerFence !== undefined) await Reflect.apply(providerFence, options, []);
    signal?.throwIfAborted();
  };
  const blockUsageMapPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.blockUsageMap
  );
  const installManifestPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.installManifest
  );

  // ProjectBaseline/Provenance own write admission. Flipping OS writable bits is
  // neither authorization nor a race-proof protection mechanism and therefore
  // does not belong on the compilation path.
  await checkProjectWriteBoundary(workspaceRoot);
  await ensureProjectBase(workspaceRoot, commitFence);
  signal?.throwIfAborted();

  const installContext = Object.freeze({ workspaceRoot, lock, commitFence, signal });
  await defaultInstallRegistry.executeAll(installPlan, installContext);
  await mergePrismaTemplate(workspaceRoot, commitFence);
  const opaqueGeneratedPaths = await installOpaqueModules(workspaceRoot, {
    commitFence,
    materializationMode: opaqueModuleMaterializationMode
  });
  signal?.throwIfAborted();

  const installManifest: Array<InstallPlanStep & { status: 'installed' }> = installPlan.map((step) => ({
    ...step,
    status: 'installed' as const
  }));

  // Directory preparation must not outlive a failed compose attempt.
  await ensureDir(path.dirname(blockUsageMapPath), commitFence);
  await ensureDir(path.dirname(installManifestPath), commitFence);

  await writeJson(blockUsageMapPath, {
    blocks: lock.resolvedBlocks.map((block) => ({ id: block.id, installOrder: block.installOrder }))
  }, commitFence);

  const semanticLowering = await lowerSemanticTasks(workspaceRoot, semanticContext, commitFence);
  lock.semanticLoweringTasks = semanticLowering.tasks;
  const semanticGeneratedPaths = semanticLowering.generatedPaths;
  const runtimeScaffoldPaths = await generateRuntimeLibraryScaffold(workspaceRoot, lock, commitFence);

  const initialGeneratedPaths = [
    ...semanticGeneratedPaths,
    ...runtimeScaffoldPaths,
    CI_ARTIFACT_FILES.blockUsageMap,
    CI_ARTIFACT_FILES.installManifest,
    ...opaqueGeneratedPaths
  ];
  addGeneratedPaths(lock, initialGeneratedPaths);
  await formatOutputFiles(workspaceRoot, lock.generatedPaths, commitFence);
  await applyOverrides(workspaceRoot, commitFence);
  signal?.throwIfAborted();
  await writeJson(installManifestPath, installManifest, commitFence);
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  await writeProjectBaseline(
    workspaceRoot,
    {
      artifactPaths: [
        ...installPlan.map((step) => step.to),
        ...lock.generatedPaths,
        ...overrideManifest.overrides.map((entry) => entry.target)
      ]
    },
    commitFence
  );
  lock.passStatus.compose = 'succeeded';
  await saveLock(workspaceRoot, lock, commitFence);
  return lock;
}
