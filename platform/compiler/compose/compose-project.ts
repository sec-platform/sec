import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import { ensureDir, pathExists, writeJson, writeText } from '../../shared/fs.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { applyOverrides } from './apply-overrides.ts';
import { generateRuntimeHostScaffold } from './generate-runtime-host.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import type { InstallPlanStep, LockFile, SlotTask } from '../../shared/lock-types.ts';

function ensureGeneratedPaths(lock: LockFile, paths: string[]): void {
  for (const generatedPath of paths) {
    if (!lock.generatedPaths.includes(generatedPath)) {
      lock.generatedPaths.push(generatedPath);
    }
  }
  lock.generatedPaths.sort((left, right) => left.localeCompare(right));
}

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

export async function composeProject(workspaceRoot: string, lock: LockFile): Promise<LockFile> {
  const { projectRoot, generatedDir, blockUsageMapPath, installManifestPath, lockPath } = getWorkspacePaths(workspaceRoot);

  await ensureProjectBase(workspaceRoot);

  const installContext = { workspaceRoot, projectRoot, lock };
  await defaultInstallRegistry.executeAll(lock.installPlan, installContext);

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
    lock.slotTasks.map(async (task) => {
      const targetPath = resolvePathInside(projectRoot, task.target);
      if (!targetPath) {
        throw new Error(`Slot target "${task.target}" escapes project root`);
      }
      if (!(await pathExists(targetPath))) {
        await writeText(targetPath, renderSlotSkeleton(task));
      }
      task.status = 'generated';
    })
  );

  const runtimeScaffoldPaths = await generateRuntimeHostScaffold(workspaceRoot, lock);
  ensureGeneratedPaths(lock, [...runtimeScaffoldPaths, 'generated/routes.ts', 'control/evidence/block-usage-map.json', 'control/evidence/install-manifest.json']);

  await applyOverrides(workspaceRoot, 'compose');

  await writeJson(installManifestPath, installManifest);
  lock.passStatus.compose = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}
