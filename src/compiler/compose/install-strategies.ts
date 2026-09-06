import { throwIfNativeAborted } from '../../system-architecture/foundation/runtime/native-abort.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { assertCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import { normalizeNewlines } from '../../system-architecture/foundation/runtime/collections.ts';
import path from 'node:path';
import { createTaskGroupEffectFence, mapTaskGroup } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { writeText, type CommitFence } from '../../workspace/files.ts';
import { copyRecursive } from '../../workspace/runtime/discovery.ts';
import {
  isCanonicalWorkspaceArtifactPath,
  resolvePathInside,
  resolveRegistryRoot,
  resolveWorkspaceArtifactPath
} from '../../workspace/runtime/paths.ts';
import type { InstallPlanStep, LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';

export interface InstallContext {
  workspaceRoot: string;
  lock: LockFile;
  commitFence?: CommitFence;
  signal?: AbortSignal;
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

/** Ancestor/descendant targets share one serial lane, not just exact names.
 * Uses resolved lexical targets; physical alias admission remains with the IO owner. */
function groupInstallTargets<T extends { target: string }>(entries: readonly T[]): T[][] {
  const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const targets = new Set(entries.map(entry => key(entry.target)));
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    let root = key(entry.target);
    let parent = path.dirname(root);
    while (parent !== path.dirname(parent)) {
      if (targets.has(parent)) root = parent;
      parent = path.dirname(parent);
    }
    const group = groups.get(root);
    if (group) group.push(entry); else groups.set(root, [entry]);
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
    if (typeof strategy?.canHandle !== 'function' || typeof strategy?.execute !== 'function') throw new TypeError('Install strategy needs callable selection and execution');
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

  async executeAll(steps: readonly InstallPlanStep[], context: InstallContext): Promise<void> {
    const workspaceRoot = path.resolve(context.workspaceRoot);
    const { lock, signal: parentSignal, commitFence } = context;
    if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Install commit fence must be callable');
    throwIfNativeAborted(parentSignal);
    const base = Object.freeze({ workspaceRoot, lock });
    // Capture all providers before selection callbacks or async execution.
    const strategies = this.strategies.map(receiver => ({
      accepts: receiver.canHandle.bind(receiver), execute: receiver.execute.bind(receiver)
    }));
    // Finish input capture before a provider's selector can modify another step.
    const capturedSteps = Array.from(steps, raw => Object.freeze({ ...raw }));
    const prepared = capturedSteps.map(step => {
      const target = resolveTargetPath(step, base);
      const selected = strategies.find(strategy => strategy.accepts(step));
      if (!selected) throw new CompilerError('COMPOSE-PATH-002', `Unsupported install action "${step.action}"`);
      return { step, target, execute: selected.execute };
    });
    const groups = groupInstallTargets(prepared);
    await mapTaskGroup(groups, async (group, _index, signal) => {
      const fence = createTaskGroupEffectFence(signal, commitFence === undefined
        ? undefined : () => Reflect.apply(commitFence, context, []));
      const effective = Object.freeze({ ...base, signal, commitFence: fence });
      for (const { step, execute } of group) {
        await fence();
        await execute(step, effective);
      }
    }, { signal: parentSignal });
  }
}

export const defaultInstallRegistry = new InstallStrategyRegistry();
