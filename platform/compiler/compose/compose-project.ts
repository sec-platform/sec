import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { defaultLimit } from '../../shared/concurrency.ts';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, pathExists, writeJson, writeText, type CommitFence } from '../../shared/fs.ts';
import type { InstallPlanStep, LockFile, SlotTask } from '../../shared/lock-types.ts';
import { addGeneratedPaths, saveLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import type { PipelineSemanticContext } from '../../shared/pipeline-types.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { CodeBuilder } from '../codegen/code-builder.ts';
import { lowerSemanticTasks } from '../semantic-lowering.ts';
import { applyOverrides } from './apply-overrides.ts';
import { formatOutputFiles } from './format-output-files.ts';
import { applyPrefixSandboxing } from './frontend-stitching.ts';
import {
  GENERATED_ROUTES_ARTIFACT_PATH,
  planGeneratedRoutesArtifactV1,
  publishGeneratedRoutesArtifactV1
} from './generated-routes-artifact.ts';
import { generateRuntimeHostScaffold } from './generate-runtime-host.ts';
import { installOpaqueModules } from './install-opaque-modules.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import { mapCustomRoutes } from './map-custom-routes.ts';
import { mergePrismaTemplate } from './merge-prisma-template.ts';
import { mergeTailwindTheme } from './merge-tailwind-theme.ts';
import { lowerToMicroservices } from './microservice-lower-pass.ts';
import { setProjectReadOnlyLock } from './project-readonly-lock.ts';

function renderSlotSkeleton(task: SlotTask): string {
  if (task.mockTemplate) {
    return task.mockTemplate;
  }

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
      builder.addImport({
        moduleSpecifier: src,
        namedImports: Array.from(types),
        isTypeOnly: true
      });
    }

    for (const exp of task.exports) {
      builder.addFunction({
        name: exp.symbol,
        isExported: true,
        parameters: exp.params.map(p => ({ name: p.name, type: p.type })),
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

export async function composeProject(
  workspaceRoot: string,
  lock: LockFile,
  semanticContext: PipelineSemanticContext,
  options?: { lockFiles?: boolean; commitFence?: CommitFence; signal?: AbortSignal }
): Promise<LockFile> {
  const commitFence = options?.commitFence;
  const { projectRoot, blockUsageMapPath, installManifestPath } = getWorkspacePaths(workspaceRoot);

  await setProjectReadOnlyLock(projectRoot, true, [], commitFence);
  await ensureProjectBase(workspaceRoot, commitFence);

  const installContext = { workspaceRoot, projectRoot, lock, commitFence };
  await defaultInstallRegistry.executeAll(lock.installPlan, installContext);
  await mergePrismaTemplate(workspaceRoot, projectRoot, {
    commitFence,
    signal: options?.signal
  });
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
      blocks: lock.resolvedBlocks.map((block) => ({
        id: block.id,
        installOrder: block.installOrder
      }))
    }, commitFence)
  ]);

  await Promise.all(
    lock.slotTasks.map((task) => defaultLimit(async () => {
      const targetPath = resolvePathInside(projectRoot, task.target);
      if (!targetPath) {
        throw new CompilerError('SLOT-SECURITY-001', `Slot target "${task.target}" escapes project root`);
      }
      if (!(await pathExists(targetPath))) {
        await writeText(targetPath, renderSlotSkeleton(task), commitFence);
      }
      task.status = 'generated';
    }))
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
  const sandboxedPaths = await applyPrefixSandboxing(projectRoot, initialGeneratedPaths, undefined, commitFence);

  addGeneratedPaths(lock, [
    ...initialGeneratedPaths,
    ...sandboxedPaths
  ]);

  await applyOverrides(workspaceRoot, 'compose', commitFence);
  await formatOutputFiles(projectRoot, lock.generatedPaths, commitFence);
  await writeJson(installManifestPath, installManifest, commitFence);
  lock.passStatus.compose = 'succeeded';

  if (options?.lockFiles) {
    const slotTargets = lock.slotTasks.map((task) => task.target);
    await setProjectReadOnlyLock(projectRoot, false, slotTargets, commitFence);
  }

  await saveLock(workspaceRoot, lock, commitFence);
  return lock;
}
