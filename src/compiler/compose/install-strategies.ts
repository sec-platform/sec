import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { assertCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import { normalizeNewlines } from '../../system-architecture/foundation/runtime/collections.ts';
import { defaultLimit } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { copyRecursive } from '../../workspace/discovery.ts';
import { writeText, type CommitFence } from '../../workspace/files.ts';
import {
  isCanonicalWorkspaceArtifactPath,
  resolvePathInside,
  resolveRegistryRoot,
  resolveWorkspaceArtifactPath
} from '../../workspace/paths.ts';
import type { InstallPlanStep, LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';

export interface InstallContext {
  workspaceRoot: string;
  lock: LockFile;
  commitFence?: CommitFence;
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

function canonicalInstallTarget(step: InstallPlanStep): string {
  try {
    return assertCanonicalPortableLogicalPath(step.to, 'Install target path');
  } catch (error) {
    throw new CompilerError(
      'COMPOSE-PATH-004',
      `Install target path "${step.to}" is not one canonical portable logical path`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

function resolveTargetPath(step: InstallPlanStep, context: InstallContext): string {
  const target = canonicalInstallTarget(step);
  const targetPath = isCanonicalWorkspaceArtifactPath(target)
    ? resolveWorkspaceArtifactPath(context.workspaceRoot, target)
    : resolvePathInside(context.workspaceRoot, target);
  if (!targetPath) {
    throw new CompilerError('COMPOSE-PATH-004', `Install target path "${step.to}" escapes workspace root`);
  }
  return targetPath;
}

function readRequiredRetainedText(filePath: string, label: string): string {
  const bytes = readOptionalRetainedOrdinaryFile(filePath, label);
  if (bytes === null) {
    throw new CompilerError('COMPOSE-PATH-003', `${label} is missing`);
  }
  return decodeExactUtf8(bytes, label);
}

function readOptionalRetainedText(filePath: string, label: string): string {
  const bytes = readOptionalRetainedOrdinaryFile(filePath, label);
  return bytes === null ? '' : decodeExactUtf8(bytes, label);
}

export class CopyInstallStrategy implements InstallStrategy {
  readonly action = 'copy';

  canHandle(step: InstallPlanStep): boolean {
    return step.action === 'copy';
  }

  async execute(step: InstallPlanStep, context: InstallContext): Promise<void> {
    const sourcePath = resolveSourcePath(step, context);
    const targetPath = resolveTargetPath(step, context);
    await copyRecursive(sourcePath, targetPath, context.commitFence);
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
    const source = readRequiredRetainedText(sourcePath, `Install source ${step.blockId}:${step.from}`);
    const existing = readOptionalRetainedText(targetPath, `Install merge target ${step.to}`);
    const trimmed = source.trim();
    if (normalizeNewlines(existing).includes(normalizeNewlines(trimmed))) {
      return;
    }
    const next = `${existing.trimEnd()}\n\n${trimmed}\n`;
    await writeText(targetPath, next, context.commitFence);
  }
}

function groupInstallStepsByTarget(steps: readonly InstallPlanStep[]): InstallPlanStep[][] {
  const groups = new Map<string, InstallPlanStep[]>();
  for (const step of steps) {
    const target = canonicalInstallTarget(step);
    const group = groups.get(target);
    if (group) {
      group.push(step);
    } else {
      groups.set(target, [step]);
    }
  }
  return [...groups.values()];
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
    const targetGroups = groupInstallStepsByTarget(steps);
    await Promise.all(
      targetGroups.map((group) => defaultLimit(async () => {
        for (const step of group) {
          await this.resolve(step).execute(step, context);
        }
      }))
    );
  }
}

export const defaultInstallRegistry = new InstallStrategyRegistry();
