import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowLinkEntry,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  scanNoFollowDirectoryTreeInventory
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommand } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import {
  armRepositoryChangeObserver,
  settleRepositoryChangeObserver
} from '../../src/adapters/runtime-state/physical/runtime/repository-change-observer.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { loadRuntimeDependencySpec, RUNTIME_DEPENDENCY_PACKAGE_NAMES } from '../../src/adapters/toolchain/dependencies/contract/runtime-dependency-spec.ts';
import { transitionRecordName } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/codec.ts';
import { transitionAbsentSlot } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/contract.ts';
import { advanceDependencyTransition, beginDependencyTransition, compilerTransitionBackupPath, markDependencyTransitionFailure, readDependencyTransition } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/operation.ts';
import { dependencyTransitionNamespacePaths, observeDependencyTransitionSlot } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { runtimeDependencyOperationOptions } from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { readRuntimeDependencyOperationTelemetry } from '../../src/adapters/toolchain/dependencies/runtime/operation-telemetry.ts';
import {
  retainCompilerDependencyExecutionGeneration,
  retainCompilerDependencyReadGeneration,
  settleAbandonedLegacyProjection
} from '../../src/adapters/toolchain/dependencies/runtime/project-runtime.ts';
import {
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES, runtimeDependencySourceGeneration
} from '../../src/adapters/toolchain/dependencies/runtime/source-generation.ts';
import {
  assertCompilerDependencyEnvironmentRetirementReceipt,
  compilerDependencyLocatorWorktreeRetirementProvider,
  disposeCompilerDependencyEnvironment,
  ensureCompilerDepsReady,
  observeCompilerDependencyExecutionGenerationAuthority
} from '../../src/adapters/toolchain/dependencies/test/runtime.ts';
import { CodedFailure } from '../../src/contracts/failure.ts';
import { createGeneratedStateCleanupOperationSession } from '../../src/execution/generated-state/cleanup-budget.ts';
import { generatedStateDigest } from "../../src/execution/generated-state/contract.ts";
import type { GeneratedStateProducerHookSet, GeneratedStateProducerQuarantineHook, GeneratedStateWorktreeRetirementEffectAuthority } from "../../src/execution/generated-state/lifecycle-port.ts";
import {
  effectfulTest,
  settleEffectfulTestCleanup,
  type EffectfulTestContext
} from '../helpers/effectful-test.ts';
import { generatedStateProducerHooks } from '../helpers/generated-state-fixture.ts';
import { settleWorkspaceCallback, settleWorkspaceCleanups } from '../testkit/workspace-cleanup.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Git for Windows cannot consume the nested cache/action/shard/run path used by
// ordinary compiler fixtures. These external-tool fixtures therefore use an
// exact, run-owned OS-temp child while state/cache remain invocation-isolated.
const LINKED_WORKTREE_TEMP_PREFIX = 'sec-cdep-wt-';
type IsolatedGeneratedStateLifecycle = Readonly<
  GeneratedStateProducerHookSet & Partial<GeneratedStateProducerQuarantineHook>
>;
const generatedStateFixtureRoots = new WeakMap<IsolatedGeneratedStateLifecycle, string>();

function compilerCoordinationLockPath(
  repositoryRoot: string
): string {
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot });
  return path.join(roots.workspaceStateRoot, 'compiler-dependency-coordination', 'v1', 'compiler.lock');
}

async function isolatedGeneratedStateLifecycle(
  repositoryRoot: string,
  cleanupDeadlineAtUnixMs: number
) {
  const hostRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-cdep-generated-state-'));
  try {
    const cleanupRemainingMs = cleanupDeadlineAtUnixMs - Date.now();
    if (!Number.isSafeInteger(cleanupDeadlineAtUnixMs) || cleanupRemainingMs <= 0) {
      throw new Error('Generated-state fixture cleanup deadline is invalid or expired.');
    }
    const lifecycle = generatedStateProducerHooks({ repositoryRoot }, {
      cleanupOperation: createGeneratedStateCleanupOperationSession({
        deadlineAtMonotonicMs: performance.now() + cleanupRemainingMs,
        maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
        maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
        monotonicNowMs: () => performance.now()
      }),
      environment: {
        ...process.env,
        SEC_CACHE_HOME: path.join(hostRoot, 'cache'),
        SEC_STATE_HOME: path.join(hostRoot, 'state')
      },
      worktreeRetirementProviders: [compilerDependencyLocatorWorktreeRetirementProvider]
    });
    generatedStateFixtureRoots.set(lifecycle, hostRoot);
    return lifecycle;
  } catch (error) {
    try {
      await fs.rm(hostRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Generated-state lifecycle construction and host-root cleanup both failed'
      );
    }
    throw error;
  }
}

async function removeSettledGeneratedStateFixtureRoot(
  lifecycle: IsolatedGeneratedStateLifecycle
): Promise<void> {
  const hostRoot = generatedStateFixtureRoots.get(lifecycle);
  if (hostRoot === undefined) {
    throw new Error('Generated-state fixture host root is missing or was already removed.');
  }
  await fs.rm(hostRoot, { recursive: true, force: true });
  generatedStateFixtureRoots.delete(lifecycle);
}

async function createIsolatedGeneratedStateLifecycles(
  repositoryRoots: readonly string[],
  cleanupDeadlineAtUnixMs: number
): Promise<IsolatedGeneratedStateLifecycle[]> {
  const lifecycles: IsolatedGeneratedStateLifecycle[] = [];
  try {
    for (const repositoryRoot of repositoryRoots) {
      lifecycles.push(await isolatedGeneratedStateLifecycle(repositoryRoot, cleanupDeadlineAtUnixMs));
    }
    return lifecycles;
  } catch (error) {
    try {
      await settleWorkspaceCleanups(lifecycles.map(
        lifecycle => () => removeSettledGeneratedStateFixtureRoot(lifecycle)
      ));
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Generated-state lifecycle batch construction and cleanup both failed'
      );
    }
    throw error;
  }
}

const EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS = 60_000;
const EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS = 30_000;
const POSIX_ROOT_PROCESS = typeof process.getuid === 'function' && process.getuid() === 0;

async function withEffectfulCompilerWorkspace(
  context: EffectfulTestContext,
  prefix: string,
  run: (
    root: string,
    lifecycle: Awaited<ReturnType<typeof isolatedGeneratedStateLifecycle>>
  ) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix));
  let lifecycle: IsolatedGeneratedStateLifecycle;
  try {
    lifecycle = (await createIsolatedGeneratedStateLifecycles(
      [root],
      context.cleanupDeadlineAtUnixMs
    ))[0]!;
  } catch (error) {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Compiler fixture setup and cleanup both failed');
    }
    throw error;
  }
  let primary: { error: unknown } | undefined;
  try {
    await run(root, lifecycle);
  } catch (error) {
    primary = { error };
  }
  let cleanup: { error: unknown } | undefined;
  let formallySettled = false;
  try {
    await settleEffectfulTestCleanup({
      context,
      resourceRoot: root,
      settle: async ({ outcome }) => {
        return disposeCompilerDependencyEnvironment(root, {
          deadlineAtUnixMs: context.cleanupDeadlineAtUnixMs,
          generatedStateLifecycle: lifecycle,
          signal: context.cleanupSignal
        }, outcome);
      }
    });
    formallySettled = true;
  } catch (error) {
    cleanup = { error };
  }
  if (formallySettled) {
    try {
      await settleWorkspaceCleanups([
        () => fs.rm(root, { recursive: true, force: true }),
        () => removeSettledGeneratedStateFixtureRoot(lifecycle)
      ]);
    } catch (error) {
      cleanup = cleanup === undefined
        ? { error }
        : { error: new AggregateError([cleanup.error, error], 'Compiler fixture cleanup failed') };
    }
  }
  if (primary !== undefined && cleanup !== undefined) {
    throw new AggregateError(
      [primary.error, cleanup.error],
      'Compiler dependency fixture operation and cleanup both failed'
    );
  }
  if (primary !== undefined) throw primary.error;
  if (cleanup !== undefined) throw cleanup.error;
}

async function withCompilerTestWorkspace(
  effectful: EffectfulTestContext,
  prefix: string,
  run: (
    root: string,
    operation: Readonly<{
      deadlineAtUnixMs: number;
      generatedStateLifecycle: Awaited<ReturnType<typeof isolatedGeneratedStateLifecycle>>;
      signal: AbortSignal;
    }>
  ) => Promise<void>
): Promise<void> {
    await withEffectfulCompilerWorkspace(effectful, prefix, async (root, lifecycle) => {
      await run(root, Object.freeze({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycle,
        signal: effectful.operationSignal
      }));
    });
  }

async function runFixtureGit(workspaceRoot: string, args: string[]): Promise<string> {
  const result = await runCommand('git', ['-c', 'core.longpaths=true', ...args], {
    cwd: workspaceRoot,
    timeoutMs: 10_000
  });
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function withLinkedWorktreeTempWorkspace<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(tmpdir(), LINKED_WORKTREE_TEMP_PREFIX));
  return settleWorkspaceCallback(
    () => callback(root),
    () => fs.rm(root, { recursive: true, force: true })
  );
}

async function installCompilerDependencyFixture(workingDirectory: string, marker: string): Promise<void> {
  const packages = [{ name: 'commander', version: '1.0.0' }, {
    main: './lib/typescript.js',
    name: 'typescript',
    version: '1.0.0'
  }];
  for (const manifest of packages) {
    const packageRoot = path.join(workingDirectory, 'node_modules', manifest.name);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify(manifest)}\n`);
    if (manifest.main) {
      const entryPath = path.join(packageRoot, ...manifest.main.replace(/^\.\//u, '').split('/'));
      await fs.mkdir(path.dirname(entryPath), { recursive: true });
      await fs.writeFile(entryPath, `${marker}:${manifest.name}\n`);
    }
  }
}

async function writeCompilerDependencyRoot(
  root: string,
  lockfile = 'lock-v1\n',
  bunVersion = process.versions.bun!
): Promise<void> {
  await Promise.all([
    fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
      packageManager: `bun@${bunVersion}`,
      dependencies: { commander: '1.0.0' },
      devDependencies: { typescript: '1.0.0' }
    })}\n`, 'utf8'),
    fs.writeFile(path.join(root, 'bun.lock'), lockfile, 'utf8'),
    fs.writeFile(path.join(root, '.bun-version'), `${bunVersion}\n`, 'utf8')
  ]);
}

async function prepareLinkedWorktreeEpochTransition(
  tempRoot: string,
  ownerOperation: Parameters<typeof ensureCompilerDepsReady>[0],
  consumerOperation: Parameters<typeof ensureCompilerDepsReady>[0],
  onOperationStart: (root: string) => void
): Promise<Readonly<{
  consumerRoot: string;
  ownerRoot: string;
}>> {
  const ownerRoot = path.join(tempRoot, 'repository');
  const consumerRoot = path.join(tempRoot, 'candidate');
  await fs.mkdir(ownerRoot);
  await runFixtureGit(ownerRoot, ['init', '-b', 'main']);
  await runFixtureGit(ownerRoot, ['config', 'user.email', 'sec@example.invalid']);
  await runFixtureGit(ownerRoot, ['config', 'user.name', 'SEC Test']);
  await runFixtureGit(ownerRoot, ['config', 'core.autocrlf', 'false']);
  await writeCompilerDependencyRoot(ownerRoot);
  await fs.writeFile(path.join(ownerRoot, '.gitignore'), 'node_modules/\n.tmp/\n');
  await runFixtureGit(ownerRoot, ['add', '.gitignore', '.bun-version', 'bun.lock', 'package.json']);
  await runFixtureGit(ownerRoot, ['commit', '-m', 'epoch-v1']);
  await runFixtureGit(ownerRoot, ['worktree', 'add', '-b', 'candidate', consumerRoot]);
  onOperationStart(consumerRoot);
  await ensureCompilerDepsReady({
    ...consumerOperation,
    materialize: async (_args, command) => {
      await installCompilerDependencyFixture(command.cwd, 'candidate-generation-v1');
      return { code: 0, stdout: 'ok', stderr: '' };
    }
  }, consumerRoot);

  await fs.writeFile(path.join(ownerRoot, 'bun.lock'), 'lock-v2\n');
  await runFixtureGit(ownerRoot, ['add', 'bun.lock']);
  await runFixtureGit(ownerRoot, ['commit', '-m', 'epoch-v2']);
  await runFixtureGit(consumerRoot, ['reset', '--hard', 'main']);
  onOperationStart(ownerRoot);
  await ensureCompilerDepsReady({
    ...ownerOperation,
    materialize: async (_args, command) => {
      await installCompilerDependencyFixture(command.cwd, 'primary-generation-v2');
      return { code: 0, stdout: 'ok', stderr: '' };
    }
  }, ownerRoot);
  return Object.freeze({ consumerRoot, ownerRoot });
}

async function withLinkedCompilerTestWorkspaces(
  effectful: EffectfulTestContext,
  run: (input: Readonly<{
    consumerOperation: Parameters<typeof ensureCompilerDepsReady>[0];
    consumerRoot: string;
    ownerOperation: Parameters<typeof ensureCompilerDepsReady>[0];
    ownerRoot: string;
  }>) => Promise<void>
): Promise<void> {
    const tempRoot = await fs.mkdtemp(path.join(tmpdir(), LINKED_WORKTREE_TEMP_PREFIX));
    const ownerRoot = path.join(tempRoot, 'repository');
    const consumerRoot = path.join(tempRoot, 'candidate');
    let ownerLifecycle: IsolatedGeneratedStateLifecycle;
    let consumerLifecycle: IsolatedGeneratedStateLifecycle;
    try {
      const lifecycles = await createIsolatedGeneratedStateLifecycles(
        [ownerRoot, consumerRoot],
        effectful.cleanupDeadlineAtUnixMs
      );
      ownerLifecycle = lifecycles[0]!;
      consumerLifecycle = lifecycles[1]!;
    } catch (error) {
      try {
        await fs.rm(tempRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Linked compiler fixture setup and cleanup both failed');
      }
      throw error;
    }
    const ownerOperation = Object.freeze({
      deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
      generatedStateLifecycle: ownerLifecycle,
      signal: effectful.operationSignal
    });
    const consumerOperation = Object.freeze({
      deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
      generatedStateLifecycle: consumerLifecycle,
      signal: effectful.operationSignal
    });
    const startedRoots: Array<readonly [string, typeof ownerLifecycle]> = [];
    const startedRootPaths = new Set<string>();
    const markOperationStarted = (root: string): void => {
      if (startedRootPaths.has(root)) return;
      startedRootPaths.add(root);
      startedRoots.push([
        root,
        root === ownerRoot ? ownerLifecycle : consumerLifecycle
      ]);
    };
    let primary: { error: unknown } | undefined;
    try {
      await prepareLinkedWorktreeEpochTransition(
        tempRoot,
        ownerOperation,
        consumerOperation,
        markOperationStarted
      );
      await run({ consumerOperation, consumerRoot, ownerOperation, ownerRoot });
    } catch (error) {
      primary = { error };
    }
    let cleanup: { error: unknown } | undefined;
    try {
      const retirementFailures: unknown[] = [];
      if (startedRoots.length !== 0) {
        const retirementOrder = [
          ...startedRoots.filter(([root]) => root === consumerRoot),
          ...startedRoots.filter(([root]) => root === ownerRoot)
        ];
        const finalRetirement = retirementOrder.at(-1)!;
        for (const [root, generatedStateLifecycle] of retirementOrder.slice(0, -1)) {
          try {
            const receipt = await disposeCompilerDependencyEnvironment(root, {
              deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
              generatedStateLifecycle,
              signal: effectful.cleanupSignal
            }, `effectful-linked-secondary:${effectful.operationId}`);
            assertCompilerDependencyEnvironmentRetirementReceipt(receipt, root);
          } catch (error) {
            retirementFailures.push(error);
          }
        }
        let terminalRetirementFailure: { error: unknown } | undefined;
        try {
          await settleEffectfulTestCleanup({
            context: effectful,
            resourceRoot: finalRetirement[0],
            settle: async ({ outcome }) => {
              const receipt = await disposeCompilerDependencyEnvironment(finalRetirement[0], {
                deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
                generatedStateLifecycle: finalRetirement[1],
                signal: effectful.cleanupSignal
              }, outcome);
              if (retirementFailures.length !== 0) {
                throw new AggregateError(
                  retirementFailures,
                  'Linked compiler fixture secondary retirement failed'
                );
              }
              return receipt;
            }
          });
        } catch (error) {
          terminalRetirementFailure = { error };
        }
        if (terminalRetirementFailure !== undefined) throw terminalRetirementFailure.error;
      }
      if (retirementFailures.length !== 0) {
        throw new AggregateError(retirementFailures, 'Linked compiler fixture retirement failed');
      }
      await settleWorkspaceCleanups([
        () => fs.rm(tempRoot, { recursive: true, force: true }),
        () => removeSettledGeneratedStateFixtureRoot(consumerLifecycle),
        () => removeSettledGeneratedStateFixtureRoot(ownerLifecycle)
      ]);
    } catch (error) {
      cleanup = { error };
    }
    if (primary !== undefined && cleanup !== undefined) {
      throw new AggregateError(
        [primary.error, cleanup.error],
        'Linked compiler fixture operation and cleanup both failed'
      );
    }
    if (primary !== undefined) throw primary.error;
    if (cleanup !== undefined) throw cleanup.error;
  }

// Keep the shared fixture module and its dependency evaluation order unchanged
// while each executable shard owns its actual registration and callback sites.
export {
  advanceDependencyTransition,
  armRepositoryChangeObserver,
  assertCompilerDependencyEnvironmentRetirementReceipt,
  beginDependencyTransition, CodedFailure, compilerCoordinationLockPath,
  compilerDependencyLocatorWorktreeRetirementProvider,
  compilerTransitionBackupPath,
  createIsolatedGeneratedStateLifecycles,
  dependencyTransitionNamespacePaths,
  describe,
  disposeCompilerDependencyEnvironment, EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS,
  EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS, effectfulTest,
  ensureCompilerDepsReady,
  expect,
  fs,
  generatedStateDigest,
  inspectNoFollowDirectoryChain,
  inspectNoFollowLinkEntry,
  installCompilerDependencyFixture, LINKED_WORKTREE_TEMP_PREFIX, loadRuntimeDependencySpec,
  markDependencyTransitionFailure,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  observeCompilerDependencyExecutionGenerationAuthority,
  observeDependencyTransitionSlot,
  path, POSIX_ROOT_PROCESS, readDependencyTransition,
  readJson,
  readRuntimeDependencyOperationTelemetry,
  removeSettledGeneratedStateFixtureRoot,
  retainCompilerDependencyExecutionGeneration,
  retainCompilerDependencyReadGeneration,
  runFixtureGit, RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES, runtimeDependencyOperationOptions,
  runtimeDependencySourceGeneration,
  scanNoFollowDirectoryTreeInventory,
  settleAbandonedLegacyProjection,
  settleEffectfulTestCleanup,
  settleRepositoryChangeObserver,
  settleWorkspaceCleanups,
  test,
  tmpdir,
  transitionAbsentSlot,
  transitionRecordName,
  withCompilerTestWorkspace,
  withEffectfulCompilerWorkspace,
  withLinkedCompilerTestWorkspaces,
  withLinkedWorktreeTempWorkspace,
  withTempWorkspace,
  writeCompilerDependencyRoot, type GeneratedStateWorktreeRetirementEffectAuthority,
  type IsolatedGeneratedStateLifecycle
};
