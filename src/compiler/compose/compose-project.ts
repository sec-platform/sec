import path from 'node:path';

import { readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { defaultLimit } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { ensureDir, publishExclusiveCanonicalWorkspaceFile, writeJson, type CommitFence } from '../../workspace/files.ts';
import { getWorkspacePaths, resolvePathInside } from '../../workspace/paths.ts';
import { checkProjectWriteBoundary, ensureProjectBase } from '../../workspace/project.ts';
import { CodeBuilder } from '../codegen/code-builder.ts';
import type { InstallPlanStep, LockFile, SlotTask } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { addGeneratedPaths, saveLock } from '../lock.ts';
import type { PipelineSemanticContext } from '../pipeline/types.ts';
import { lowerSemanticTasks } from '../semantic-lowering.ts';
import { applyOverrides } from './apply-overrides.ts';
import { formatOutputFiles } from './format-output-files.ts';
import { generateRuntimeLibraryScaffold } from './generate-runtime-library.ts';
import { installOpaqueModules } from './install-opaque-modules.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import { mergePrismaTemplate } from './merge-prisma-template.ts';

function renderSlotSkeleton(task: SlotTask): string {
  const builder = new CodeBuilder(task.target)
    .addFileComment(`@generated slot-id:${task.id} block:${task.block}`);

  if (task.inputType && task.outputType) {
    builder.addImport({
      moduleSpecifier: '../src/runtime/database.ts',
      namedImports: [task.inputType, task.outputType],
      isTypeOnly: true
    });
  }
  builder.addFunction({
    name: task.symbol,
    isExported: true,
    parameters: [{ name: 'input', type: task.inputType ?? 'unknown' }],
    returnType: task.outputType ?? 'unknown',
    body: "throw new Error('Not implemented');"
  });
  return builder.getText();
}

async function ensureSlotSkeleton(
  workspaceRoot: string,
  projectRoot: string,
  task: SlotTask,
  commitFence?: CommitFence
): Promise<void> {
  const targetPath = resolvePathInside(projectRoot, task.target);
  if (!targetPath) {
    throw new CompilerError('COMPOSE-PATH-003', `Slot target "${task.target}" escapes project root`);
  }
  const existing = readOptionalRetainedOrdinaryFile(
    targetPath,
    `Compose Slot target ${task.block}:${task.id}`
  );
  if (existing === null) {
    await publishExclusiveCanonicalWorkspaceFile({
      workspaceRoot,
      targetPath,
      bytes: Buffer.from(renderSlotSkeleton(task), 'utf8'),
      label: `Compose Slot skeleton ${task.block}:${task.id}`,
      commitFence
    });
  }
  task.status = 'generated';
}

export async function composeProject(
  workspaceRoot: string,
  lock: LockFile,
  semanticContext: PipelineSemanticContext,
  options?: { commitFence?: CommitFence; signal?: AbortSignal }
): Promise<LockFile> {
  const commitFence = options?.commitFence;
  const { projectRoot, blockUsageMapPath, installManifestPath } = getWorkspacePaths(workspaceRoot);

  // ProjectBaseline/Provenance own write admission. Flipping OS writable bits is
  // neither authorization nor a race-proof protection mechanism and therefore
  // does not belong on the compilation path.
  await checkProjectWriteBoundary(workspaceRoot);
  await ensureProjectBase(workspaceRoot, commitFence);

  const installContext = { workspaceRoot, projectRoot, lock, commitFence };
  await defaultInstallRegistry.executeAll(lock.installPlan, installContext);
  await mergePrismaTemplate(workspaceRoot, projectRoot, commitFence);
  const opaqueGeneratedPaths = await installOpaqueModules(workspaceRoot, projectRoot, { commitFence });

  const installManifest: Array<InstallPlanStep & { status: 'installed' }> = lock.installPlan.map((step) => ({
    ...step,
    status: 'installed' as const
  }));

  await Promise.all([
    ensureDir(path.dirname(blockUsageMapPath), commitFence),
    ensureDir(path.dirname(installManifestPath), commitFence)
  ]);

  await writeJson(blockUsageMapPath, {
    blocks: lock.resolvedBlocks.map((block) => ({ id: block.id, installOrder: block.installOrder }))
  }, commitFence);

  await Promise.all(
    lock.slotTasks.map((task) => defaultLimit(() =>
      ensureSlotSkeleton(workspaceRoot, projectRoot, task, commitFence)
    ))
  );

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
  await applyOverrides(workspaceRoot, 'compose', commitFence);
  await formatOutputFiles(projectRoot, lock.generatedPaths, commitFence);
  await writeJson(installManifestPath, installManifest, commitFence);
  lock.passStatus.compose = 'succeeded';
  await saveLock(workspaceRoot, lock, commitFence);
  return lock;
}
