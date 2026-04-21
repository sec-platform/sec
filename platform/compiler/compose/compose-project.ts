import fs from 'node:fs/promises';
import path from 'node:path';
import { blockRoot, getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import { copyRecursive, ensureDir, pathExists, readText, writeJson, writeText } from '../../shared/fs.ts';
import type { InstallPlanStep, LockFile, SlotTask } from '../../shared/types.ts';

function renderRouteGraph(lock: LockFile): string {
  const routeEntries = lock.resolvedBlocks.map((block) => {
    const pathHint = block.id === 'auth/basic-session' ? '/login' : block.id === 'entity/customer-basic' ? '/customers' : '/workspace';
    return `  { blockId: '${block.id}', path: '${pathHint}' }`;
  });

  return `export const routes = [\n${routeEntries.join(',\n')}\n];\n`;
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

async function mergePrisma(sourcePath: string, targetPath: string): Promise<void> {
  const source = await readText(sourcePath);
  const existing = (await pathExists(targetPath)) ? await readText(targetPath) : '';
  const trimmed = source.trim();
  if (existing.includes(trimmed)) {
    return;
  }
  const next = `${existing.trimEnd()}\n\n${trimmed}\n`;
  await writeText(targetPath, next);
}

async function applyInstallStep(projectRoot: string, step: InstallPlanStep): Promise<void> {
  const sourcePath = path.join(blockRoot(step.blockId), step.from);
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
  const { projectRoot, generatedDir, installManifestPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const installManifest: Array<InstallPlanStep & { status: 'installed' }> = [];

  for (const step of lock.installPlan) {
    await applyInstallStep(projectRoot, step);
    installManifest.push({ ...step, status: 'installed' });
  }

  await ensureDir(generatedDir);
  await writeText(path.join(generatedDir, 'routes.ts'), renderRouteGraph(lock));
  await writeJson(path.join(generatedDir, 'block-usage-map.json'), {
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

  await writeJson(installManifestPath, installManifest);
  lock.passStatus.compose = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}
