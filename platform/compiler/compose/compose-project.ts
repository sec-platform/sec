import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { defaultLimit } from '../../shared/concurrency.ts';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, writeJson, type CommitFence } from '../../shared/fs.ts';
import type { InstallPlanStep, LockFile, SlotTask } from '../../shared/lock-types.ts';
import { addGeneratedPaths, saveLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import type { PipelineSemanticContext } from '../../shared/pipeline-types.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { checkProjectWriteBoundary } from '../../shared/project-write-boundary.ts';
import { readOptionalRetainedOrdinaryFileV1 } from '../../shared/retained-file-read.ts';
import { publishExclusiveCanonicalWorkspaceFileV1 } from '../../shared/workspace-file-publication.ts';
import { CodeBuilder } from '../codegen/code-builder.ts';
import { lowerSemanticTasks } from '../semantic-lowering.ts';
import { applyOverrides } from './apply-overrides.ts';
import { formatOutputFiles } from './format-output-files.ts';
import { applyPrefixSandboxing } from './frontend-stitching.ts';
import { generateRuntimeHostScaffold } from './generate-runtime-host.ts';
import {
  GENERATED_ROUTES_ARTIFACT_PATH,
  planGeneratedRoutesArtifactV1,
  publishGeneratedRoutesArtifactV1
} from './generated-routes-artifact.ts';
import { installOpaqueModules } from './install-opaque-modules.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import { mapCustomRoutes } from './map-custom-routes.ts';
import { mergePrismaTemplate } from './merge-prisma-template.ts';
import { mergeTailwindTheme } from './merge-tailwind-theme.ts';
import { lowerToMicroservices } from './microservice-lower-pass.ts';

function renderSlotSkeleton(task: SlotTask): string {
  if (task.mockTemplate) return task.mockTemplate;

  const builder = new CodeBuilder(task.target)
    .addFileComment(`@generated slot-id:${task.id} block:${task.block}`);

  if (task.exports && task.exports.length > 0) {
    const imports = new Map<string, Set<string>>();
    for (const exp of task.exports) {
      for (const p of exp.params) {
        if (p.importFrom) {
          if (!imports.has(p.importFrom)) imports.set(p.importFrom, new Set());
          imports.get(p.importFrom)?.add(p.type);
        }
      }
      if (exp.outputImportFrom && exp.outputType) {
        const baseType = exp.outputType.replace(/\[\]$/, '');
        if (!imports.has(exp.outputImportFrom)) imports.set(exp.outputImportFrom, new Set());
        imports.get(exp.outputImportFrom)?.add(baseType);
      }
    }

    for (const [src, types] of imports) {
      builder.addImport({ moduleSpecifier: src, namedImports: Array.from(types), isTypeOnly: true });
    }
    for (const exp of task.exports) {
      builder.addFunction({
        name: exp.symbol,
        isExported: true,
        parameters: exp.params.map((p) => ({ name: p.name, type: p.type })),
        returnType: exp.outputType,
        body: "throw new Error('Not implemented');"
      });
    }
    return builder.getText();
  }

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
  const existing = readOptionalRetainedOrdinaryFileV1(
    targetPath,
    `Compose Slot target ${task.block}:${task.id}`
  );
  if (existing === null) {
    await publishExclusiveCanonicalWorkspaceFileV1({
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
  const tailwindGeneratedPaths = await mergeTailwindTheme(workspaceRoot, projectRoot, commitFence);
  const customRoutesGeneratedPaths = await mapCustomRoutes(workspaceRoot, projectRoot, commitFence);

  const installManifest: Array<InstallPlanStep & { status: 'installed' }> = lock.installPlan.map((step) => ({
    ...step,
    status: 'installed' as const
  }));

  const [routesPlan] = await Promise.all([
    planGeneratedRoutesArtifactV1(workspaceRoot, lock),
    ensureDir(path.dirname(blockUsageMapPath), commitFence),
    ensureDir(path.dirname(installManifestPath), commitFence)
  ]);

  await Promise.all([
    publishGeneratedRoutesArtifactV1(workspaceRoot, routesPlan, commitFence),
    writeJson(blockUsageMapPath, {
      blocks: lock.resolvedBlocks.map((block) => ({ id: block.id, installOrder: block.installOrder }))
    }, commitFence)
  ]);

  await Promise.all(
    lock.slotTasks.map((task) => defaultLimit(() =>
      ensureSlotSkeleton(workspaceRoot, projectRoot, task, commitFence)
    ))
  );

  const semanticLowering = await lowerSemanticTasks(workspaceRoot, semanticContext, commitFence);
  lock.semanticLoweringTasks = semanticLowering.tasks;
  const semanticGeneratedPaths = semanticLowering.generatedPaths;
  const runtimeScaffoldPaths = await generateRuntimeHostScaffold(workspaceRoot, lock, commitFence);
  const microservicePaths = await lowerToMicroservices(workspaceRoot, lock, commitFence);

  const initialGeneratedPaths = [
    ...semanticGeneratedPaths,
    ...runtimeScaffoldPaths,
    GENERATED_ROUTES_ARTIFACT_PATH,
    CI_ARTIFACT_FILES.blockUsageMap,
    CI_ARTIFACT_FILES.installManifest,
    ...opaqueGeneratedPaths,
    ...tailwindGeneratedPaths,
    ...customRoutesGeneratedPaths,
    ...microservicePaths
  ];
  const sandboxedPaths = await applyPrefixSandboxing(projectRoot, initialGeneratedPaths, commitFence);

  addGeneratedPaths(lock, [...initialGeneratedPaths, ...sandboxedPaths]);
  await applyOverrides(workspaceRoot, 'compose', commitFence);
  await formatOutputFiles(projectRoot, lock.generatedPaths, commitFence);
  await writeJson(installManifestPath, installManifest, commitFence);
  lock.passStatus.compose = 'succeeded';
  await saveLock(workspaceRoot, lock, commitFence);
  return lock;
}
