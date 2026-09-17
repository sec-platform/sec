import path from 'node:path';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';

import { CI_ARTIFACT_FILES } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { ensureProjectBase } from '../../workspace/project-base.ts';
import { checkProjectWriteBoundary } from '../../workspace/project-write-boundary.ts';
import { ensureDir, writeJson } from "../../filesystem/files.ts";
import { type CommitFence } from "../../../contracts/commit-fence.ts";
import { resolveWorkspaceArtifactPath } from "../../workspace-context.ts";
import { writeProjectBaseline } from '../../workspace/project-baseline.ts';
import type { InstallPlanStep, LockFile } from '../../../compiler/contract.ts';
import { addGeneratedPaths } from "../../../compiler/contract/lock-schema.ts";
import { saveLock } from "../../workspace/lock.ts";
import { loadOverrideManifest } from '../../workspace/sources/load-override-manifest.ts';
import type { PipelineSemanticContext } from '../../../compiler/pipeline/semantic-context.ts';
import { lowerSemanticTasks } from '../../targets/typescript/semantic-lowering.ts';
import { applyOverrides } from './apply-overrides.ts';
import { formatOutputFiles } from './format-output-files.ts';
import { generateRuntimeLibraryScaffold } from './generate-runtime-library.ts';
import { installOpaqueModules } from './install-opaque-modules.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import { mergePrismaTemplate } from './merge-prisma-template.ts';
import type { OpaqueModuleMaterializationMode } from '../../../compiler/target-materialization.ts';

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
  throwIfNativeAborted(signal);
  // One admitted plan drives both execution and its manifest, not a later
  // caller-mutated lock.installPlan. Lock state remains owned by composition.
  const installPlan = Object.freeze(lock.installPlan.map(step => Object.freeze({ ...step })));
  const commitFence: CommitFence = async () => {
    throwIfNativeAborted(signal);
    if (providerFence !== undefined) await Reflect.apply(providerFence, options, []);
    throwIfNativeAborted(signal);
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
  throwIfNativeAborted(signal);

  const installContext = Object.freeze({ workspaceRoot, lock, commitFence, signal });
  await defaultInstallRegistry.executeAll(installPlan, installContext);
  await mergePrismaTemplate(workspaceRoot, commitFence);
  const opaqueGeneratedPaths = await installOpaqueModules(workspaceRoot, {
    commitFence,
    materializationMode: opaqueModuleMaterializationMode
  });
  throwIfNativeAborted(signal);

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
  const runtimeScaffoldPaths = await generateRuntimeLibraryScaffold(workspaceRoot, lock, commitFence, signal);

  const initialGeneratedPaths = [
    ...semanticGeneratedPaths,
    ...runtimeScaffoldPaths,
    CI_ARTIFACT_FILES.blockUsageMap,
    CI_ARTIFACT_FILES.installManifest,
    ...opaqueGeneratedPaths
  ];
  addGeneratedPaths(lock, initialGeneratedPaths);
  await formatOutputFiles(workspaceRoot, lock.generatedPaths, commitFence, signal);
  await applyOverrides(workspaceRoot, commitFence);
  throwIfNativeAborted(signal);
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
