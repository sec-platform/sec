import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePaths, resolveRegistryRoot } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import { copyRecursive, ensureDir, pathExists, readText, writeJson, writeText } from '../../shared/fs.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { applyOverrides } from './apply-overrides.ts';
import { generateRuntimeHostScaffold } from './generate-runtime-host.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
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
  const routeEntries: string[] = [];

  for (const block of lock.resolvedBlocks) {
    const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
    for (const route of manifestEntry.manifest.routes) {
      routeEntries.push(`  { blockId: '${block.id}', path: '${route.path}', file: '${route.file}' }`);
    }
  }

  return `export interface GeneratedRoute {\n  blockId: string;\n  path: string;\n  file: string;\n}\n\nexport const routes: GeneratedRoute[] = [\n${routeEntries.join(',\n')}\n];\n`;
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

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

async function mergePrisma(sourcePath: string, targetPath: string): Promise<void> {
  const source = await readText(sourcePath);
  const existing = (await pathExists(targetPath)) ? await readText(targetPath) : '';
  const trimmed = source.trim();
  if (normalizeNewlines(existing).includes(normalizeNewlines(trimmed))) {
    return;
  }
  const next = `${existing.trimEnd()}\n\n${trimmed}\n`;
  await writeText(targetPath, next);
}

async function applyInstallStep(workspaceRoot: string, projectRoot: string, step: InstallPlanStep): Promise<void> {
  const sourcePath = path.join(
    resolveRegistryRoot(workspaceRoot, step.registryLocation, step.registryPath),
    step.sourceRoot,
    step.from
  );
  const targetPath = path.join(projectRoot, step.to);

  if (step.action === 'copy') {
    await copyRecursive(sourcePath, targetPath);
    return;
  }

  if (step.action === 'merge-prisma') {
    await mergePrisma(sourcePath, targetPath);
    return;
  }

  throw new CompilerError('COMPOSE-PATH-002', `Unsupported install action "${step.action}"`);
}

export async function composeProject(workspaceRoot: string, lock: LockFile): Promise<LockFile> {
  const { projectRoot, generatedDir, blockUsageMapPath, installManifestPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const installManifest: Array<InstallPlanStep & { status: 'installed' }> = [];

  await ensureProjectBase(workspaceRoot);

  for (const step of lock.installPlan) {
    await applyInstallStep(workspaceRoot, projectRoot, step);
    installManifest.push({ ...step, status: 'installed' });
  }

  await ensureDir(generatedDir);
  await ensureDir(path.dirname(blockUsageMapPath));
  await ensureDir(path.dirname(installManifestPath));
  await writeText(path.join(generatedDir, 'routes.ts'), await renderRouteGraph(workspaceRoot, lock));
  await writeJson(blockUsageMapPath, {
    blocks: lock.resolvedBlocks.map((block) => ({
      id: block.id,
      installOrder: block.installOrder
    }))
  });

  for (const task of lock.slotTasks) {
    const targetPath = path.join(projectRoot, task.target);
    if (!(await pathExists(targetPath))) {
      await writeText(targetPath, renderSlotSkeleton(task));
    }
    task.status = 'generated';
  }

  const runtimeScaffoldPaths = await generateRuntimeHostScaffold(workspaceRoot, lock);
  ensureGeneratedPaths(lock, [...runtimeScaffoldPaths, 'generated/routes.ts', 'control/evidence/block-usage-map.json', 'control/evidence/install-manifest.json']);

  await applyOverrides(workspaceRoot, 'compose');

  await writeJson(installManifestPath, installManifest);
  lock.passStatus.compose = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}
