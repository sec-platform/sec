import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { defaultLimit } from '../../shared/concurrency.ts';
import { ensureDir, pathExists, writeJson, writeText } from '../../shared/fs.ts';
import type { InstallPlanStep, LockFile, SlotTask } from '../../shared/lock-types.ts';
import { addGeneratedPaths, saveLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { applyOverrides } from './apply-overrides.ts';
import { generateRuntimeHostScaffold } from './generate-runtime-host.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import { mergePrismaTemplate } from './merge-prisma-template.ts';
import { installOpaqueModules } from './install-opaque-modules.ts';
import { mergeTailwindTheme } from './merge-tailwind-theme.ts';
import { mapCustomRoutes } from './map-custom-routes.ts';
import { formatOutputFiles } from './format-output-files.ts';
import { setProjectReadOnlyLock } from './project-readonly-lock.ts';





async function renderRouteGraph(workspaceRoot: string, lock: LockFile): Promise<string> {
  const routeEntries = await Promise.all(
    lock.resolvedBlocks.map(async (block) => {
      const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
      return manifestEntry.manifest.routes.map(
        (route) => `  { blockId: '${block.id}', path: '${route.path}', file: '${route.file}' }`
      );
    })
  );

  return `export interface GeneratedRoute {\n  blockId: string;\n  path: string;\n  file: string;\n}\n\nexport const routes: GeneratedRoute[] = [\n${routeEntries.flat().join(',\n')}\n];\n`;
}

function renderSlotSkeleton(task: SlotTask): string {
  if (task.exports && task.exports.length > 0) {
    const imports = new Map<string, Set<string>>();
    for (const exp of task.exports) {
      for (const p of exp.params) {
        if (p.importFrom) {
          if (!imports.has(p.importFrom)) imports.set(p.importFrom, new Set());
          imports.get(p.importFrom)!.add(p.type);
        }
      }
      if (exp.outputImportFrom && exp.outputType) {
        const baseType = exp.outputType.replace(/\[\]$/, '');
        if (!imports.has(exp.outputImportFrom)) imports.set(exp.outputImportFrom, new Set());
        imports.get(exp.outputImportFrom)!.add(baseType);
      }
    }
    const importLines = Array.from(imports.entries()).map(([src, types]) => {
      return `import type { ${Array.from(types).join(', ')} } from '${src}';`;
    }).join('\n');

    const funcLines = task.exports.map((exp) => {
      const paramStr = exp.params.map(p => `${p.name}: ${p.type}`).join(', ');
      return `export function ${exp.symbol}(${paramStr}): ${exp.outputType} {\n  throw new Error('Not implemented');\n}`;
    }).join('\n\n');

    return `// @generated slot-id:${task.id} block:${task.block}\n${importLines}\n\n${funcLines}\n`;
  }

  const importLine =
    task.inputType && task.outputType
      ? `import type { ${task.inputType}, ${task.outputType} } from '../src/runtime/database.ts';\n\n`
      : '';
  const signature =
    task.inputType && task.outputType
      ? `input: ${task.inputType}): ${task.outputType}`
      : 'input: unknown): unknown';
  return `// @generated slot-id:${task.id} block:${task.block}\n${importLine}export function ${task.symbol}(${signature} {\n  throw new Error('Not implemented');\n}\n`;
}

export async function composeProject(
  workspaceRoot: string,
  lock: LockFile,
  options?: { lockFiles?: boolean }
): Promise<LockFile> {
  const { projectRoot, generatedDir, blockUsageMapPath, installManifestPath } = getWorkspacePaths(workspaceRoot);

  // Make sure existing files are writable so compiler can overwrite them
  await setProjectReadOnlyLock(projectRoot, true);

  await ensureProjectBase(workspaceRoot);

  const installContext = { workspaceRoot, projectRoot, lock };
  await defaultInstallRegistry.executeAll(lock.installPlan, installContext);
  await mergePrismaTemplate(workspaceRoot, projectRoot);
  const opaqueGeneratedPaths = await installOpaqueModules(workspaceRoot, projectRoot);
  const tailwindGeneratedPaths = await mergeTailwindTheme(workspaceRoot, projectRoot);
  const customRoutesGeneratedPaths = await mapCustomRoutes(workspaceRoot, projectRoot);

  const installManifest: Array<InstallPlanStep & { status: 'installed' }> = lock.installPlan.map((step) => ({
    ...step,
    status: 'installed' as const
  }));

  const [routesContent] = await Promise.all([
    renderRouteGraph(workspaceRoot, lock),
    ensureDir(generatedDir),
    ensureDir(path.dirname(blockUsageMapPath)),
    ensureDir(path.dirname(installManifestPath))
  ]);

  await Promise.all([
    writeText(path.join(generatedDir, 'routes.ts'), routesContent),
    writeJson(blockUsageMapPath, {
      blocks: lock.resolvedBlocks.map((block) => ({
        id: block.id,
        installOrder: block.installOrder
      }))
    })
  ]);

  await Promise.all(
    lock.slotTasks.map((task) => defaultLimit(async () => {
      const targetPath = resolvePathInside(projectRoot, task.target);
      if (!targetPath) {
        throw new Error(`Slot target "${task.target}" escapes project root`);
      }
      if (!(await pathExists(targetPath))) {
        await writeText(targetPath, renderSlotSkeleton(task));
      }
      task.status = 'generated';
    }))
  );

  const runtimeScaffoldPaths = await generateRuntimeHostScaffold(workspaceRoot, lock);
  addGeneratedPaths(lock, [
    ...runtimeScaffoldPaths,
    'generated/routes.ts',
    CI_ARTIFACT_FILES.blockUsageMap,
    CI_ARTIFACT_FILES.installManifest,
    ...opaqueGeneratedPaths,
    ...tailwindGeneratedPaths,
    ...customRoutesGeneratedPaths
  ]);

  await applyOverrides(workspaceRoot, 'compose');

  await formatOutputFiles(projectRoot, lock.generatedPaths);

  await writeJson(installManifestPath, installManifest);
  lock.passStatus.compose = 'succeeded';

  if (options?.lockFiles) {
    const slotTargets = lock.slotTasks.map((t) => t.target);
    await setProjectReadOnlyLock(projectRoot, false, slotTargets);
  }

  await saveLock(workspaceRoot, lock);
  return lock;
}
