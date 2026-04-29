import { CompilerError } from '../../shared/errors.ts';
import { copyRecursive, pathExists, readText, writeText } from '../../shared/fs.ts';
import { resolvePathInside, resolveRegistryRoot } from '../../shared/paths.ts';
import type { LockFile, InstallPlanStep } from '../../shared/lock-types.ts';

export interface InstallContext {
  workspaceRoot: string;
  projectRoot: string;
  lock: LockFile;
}

export interface InstallStrategy {
  readonly action: string;
  canHandle(step: InstallPlanStep): boolean;
  execute(step: InstallPlanStep, context: InstallContext): Promise<void>;
}

function resolveSourcePath(step: InstallPlanStep, context: InstallContext): string {
  const registryRoot = resolveRegistryRoot(context.workspaceRoot, step.registryLocation, step.registryPath);
  const sourceRoot = resolvePathInside(registryRoot, step.sourceRoot, { allowEmpty: true });
  const sourcePath = sourceRoot ? resolvePathInside(sourceRoot, step.from) : null;
  if (!sourcePath) {
    throw new CompilerError('COMPOSE-PATH-003', `Install source path "${step.from}" escapes registry source root`);
  }
  return sourcePath;
}

function resolveTargetPath(step: InstallPlanStep, context: InstallContext): string {
  const targetPath = resolvePathInside(context.projectRoot, step.to);
  if (!targetPath) {
    throw new CompilerError('COMPOSE-PATH-004', `Install target path "${step.to}" escapes project root`);
  }
  return targetPath;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export class CopyInstallStrategy implements InstallStrategy {
  readonly action = 'copy';

  canHandle(step: InstallPlanStep): boolean {
    return step.action === 'copy';
  }

  async execute(step: InstallPlanStep, context: InstallContext): Promise<void> {
    const sourcePath = resolveSourcePath(step, context);
    const targetPath = resolveTargetPath(step, context);
    await copyRecursive(sourcePath, targetPath);
  }
}

export class MergePrismaInstallStrategy implements InstallStrategy {
  readonly action = 'merge-prisma';

  canHandle(step: InstallPlanStep): boolean {
    return step.action === 'merge-prisma';
  }

  async execute(step: InstallPlanStep, context: InstallContext): Promise<void> {
    const sourcePath = resolveSourcePath(step, context);
    const targetPath = resolveTargetPath(step, context);
    const source = await readText(sourcePath);
    const existing = (await pathExists(targetPath)) ? await readText(targetPath) : '';
    const trimmed = source.trim();
    if (normalizeNewlines(existing).includes(normalizeNewlines(trimmed))) {
      return;
    }
    const next = `${existing.trimEnd()}\n\n${trimmed}\n`;
    await writeText(targetPath, next);
  }
}

const BUILTIN_STRATEGIES: InstallStrategy[] = [
  new CopyInstallStrategy(),
  new MergePrismaInstallStrategy()
];

export class InstallStrategyRegistry {
  private strategies: InstallStrategy[] = [...BUILTIN_STRATEGIES];

  register(strategy: InstallStrategy): this {
    this.strategies.push(strategy);
    return this;
  }

  resolve(step: InstallPlanStep): InstallStrategy {
    const strategy = this.strategies.find((candidate) => candidate.canHandle(step));
    if (!strategy) {
      throw new CompilerError('COMPOSE-PATH-002', `Unsupported install action "${step.action}"`);
    }
    return strategy;
  }

  async executeAll(steps: InstallPlanStep[], context: InstallContext): Promise<void> {
    await Promise.all(
      steps.map((step) => this.resolve(step).execute(step, context))
    );
  }
}

export const defaultInstallRegistry = new InstallStrategyRegistry();
