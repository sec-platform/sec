import { describe, expect, spyOn, test } from 'bun:test';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import { generatedStateDigest } from '../../src/adapters/runtime-state/generated-state/contract.ts';
import {
  createGeneratedStateCleanupOperationSession,
  generatedStateProducerHooks,
  type GeneratedStateProducerHookSet,
  type GeneratedStateProducerQuarantineHook,
  type GeneratedStateWorktreeRetirementEffectAuthority
} from '../../src/adapters/runtime-state/generated-state/lifecycle.ts';
import * as physicalNoFollow from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
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
import * as dependencyTransitions from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/operation.ts';
import { advanceDependencyTransition, beginDependencyTransition, compilerTransitionBackupPath, markDependencyTransitionFailure, readDependencyTransition } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/operation.ts';
import { dependencyTransitionNamespacePaths, observeDependencyTransitionSlot } from '../../src/adapters/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { runtimeDependencyOperationOptions } from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { readRuntimeDependencyOperationTelemetry } from '../../src/adapters/toolchain/dependencies/runtime/operation-telemetry.ts';
import {
  ensureCompilerDepsReadyFromGeneration,
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
  migrateDependencyTransitionJournal,
  observeCompilerDependencyExecutionGenerationAuthority
} from '../../src/adapters/toolchain/dependencies/test/runtime.ts';
import { SecError } from '../../src/contracts/failure.ts';
import {
  effectfulTest,
  settleEffectfulTestCleanup,
  type EffectfulTestContext
} from '../helpers/effectful-test.ts';
import { settleWorkspaceCallback, settleWorkspaceCleanups } from '../testkit/workspace-cleanup.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Git for Windows cannot consume the nested cache/action/shard/run path used by
// ordinary compiler fixtures. These external-tool fixtures therefore use an
// exact, run-owned OS-temp child while state/cache remain invocation-isolated.
const LINKED_WORKTREE_TEMP_PREFIX = 'sec-cdep-wt-';
type IsolatedGeneratedStateLifecycle = Readonly<
  GeneratedStateProducerHookSet & GeneratedStateProducerQuarantineHook
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
    lifecycle: Awaited<ReturnType<typeof isolatedGeneratedStateLifecycle>>,
    secondary?: Readonly<{ root: string; lifecycle: IsolatedGeneratedStateLifecycle }>
  ) => Promise<void>,
  secondaryPrefix?: string
): Promise<void> {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix));
  const roots = [root];
  let lifecycles: IsolatedGeneratedStateLifecycle[];
  try {
    if (secondaryPrefix !== undefined) {
      roots.push(await fs.mkdtemp(path.join(tmpdir(), secondaryPrefix)));
    }
    lifecycles = await createIsolatedGeneratedStateLifecycles(roots, context.cleanupDeadlineAtUnixMs);
  } catch (error) {
    try {
      await settleWorkspaceCleanups(roots.map(fixtureRoot =>
        () => fs.rm(fixtureRoot, { recursive: true, force: true })));
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Compiler fixture setup and cleanup both failed');
    }
    throw error;
  }
  let primary: { error: unknown } | undefined;
  try {
    await run(root, lifecycles[0]!, roots[1] === undefined ? undefined
      : { root: roots[1], lifecycle: lifecycles[1]! });
  } catch (error) {
    primary = { error };
  }
  let cleanup: { error: unknown } | undefined;
  let formallySettled = false;
  try {
    await settleEffectfulTestCleanup({ context, resourceRoot: root,
      settle: async ({ outcome }) => {
        const failures: unknown[] = [];
        let ownerReceipt: Awaited<ReturnType<typeof disposeCompilerDependencyEnvironment>> | undefined;
        // Settle every admitted root, consumer first. A successful source
        // receipt cannot hide a secondary root's independent retirement failure.
        for (let index = roots.length - 1; index >= 0; index--) {
          try {
            const receipt = await disposeCompilerDependencyEnvironment(roots[index]!, {
              deadlineAtUnixMs: context.cleanupDeadlineAtUnixMs,
              generatedStateLifecycle: lifecycles[index]!, signal: context.cleanupSignal
            }, outcome);
            if (index === 0) ownerReceipt = receipt;
            else assertCompilerDependencyEnvironmentRetirementReceipt(receipt, roots[index]!);
          } catch (error) { failures.push(error); }
        }
        if (ownerReceipt === undefined || failures.length !== 0) {
          throw new AggregateError(failures,
            'Compiler dependency fixture retirement failed before terminal receipt consumption');
        }
        return ownerReceipt;
      }
    });
    formallySettled = true;
  } catch (error) {
    cleanup = { error };
  }
  if (formallySettled) {
    try {
      await settleWorkspaceCleanups([
        ...roots.map(fixtureRoot => () => fs.rm(fixtureRoot, { recursive: true, force: true })),
        ...lifecycles.map(lifecycle => () => removeSettledGeneratedStateFixtureRoot(lifecycle))
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

function effectfulCompilerTest(
  title: string,
  prefix: string,
  run: (
    root: string,
    operation: Readonly<{
      deadlineAtUnixMs: number;
      generatedStateLifecycle: Awaited<ReturnType<typeof isolatedGeneratedStateLifecycle>>;
      signal: AbortSignal;
    }>
  ) => Promise<void>
): void {
  effectfulTest(test, title, {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, prefix, async (root, lifecycle) => {
      await run(root, Object.freeze({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycle,
        signal: effectful.operationSignal
      }));
    });
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

function effectfulLinkedCompilerTest(
  title: string,
  run: (input: Readonly<{
    consumerOperation: Parameters<typeof ensureCompilerDepsReady>[0];
    consumerRoot: string;
    ownerOperation: Parameters<typeof ensureCompilerDepsReady>[0];
    ownerRoot: string;
  }>) => Promise<void>
): void {
  effectfulTest(test, title, {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, async (effectful) => {
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
  });
}

export function registerCompilerDependencyInstallationTests(
  shard: 'generation' | 'external' | 'recovery' | 'locks'
): void {
describe('compiler dependency installation', () => {
  if (shard === 'generation') {
  if (process.platform === 'win32') effectfulCompilerTest(
    'reads an existing coordination locator without transient repository writes',
    'engineering-compiler-coordination-zero-write-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const options = {
        ...operation,
        materialize: async (_args: string[], command: { cwd: string }) => {
          await installCompilerDependencyFixture(command.cwd, 'stable');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      };
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      const resolution = await armRepositoryChangeObserver({
        roots: [path.join(tempRoot, '.tmp', 'dependency-installs')],
        deadlineAtUnixMs: operation.deadlineAtUnixMs
      });
      expect(resolution.status).toBe('ready');
      if (resolution.status !== 'ready') return;
      try {
        expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
      } finally {
        const settlement = await settleRepositoryChangeObserver(resolution.observer);
        if (settlement.status !== 'zero-events') {
          throw new Error(`Existing compiler locator read mutated its coordination namespace: ${JSON.stringify({
            status: settlement.status,
            events: settlement.status === 'events' ? settlement.events.slice(0, 8) : undefined
          })}`);
        }
      }
    });
  effectfulLinkedCompilerTest(
    'retires an owned dangling linked-worktree locator after its physical owner advances',
    async ({ consumerOperation, consumerRoot, ownerOperation, ownerRoot }) => {
      const consumerLocator = path.join(consumerRoot, 'node_modules');
      expect((await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('The first linked consumer must reuse its owner.');
        }
      }, consumerRoot)).source).toBe('existing');
      const oldTarget = await fs.realpath(consumerLocator);

      await fs.writeFile(path.join(ownerRoot, 'bun.lock'), 'lock-v3\n');
      await runFixtureGit(ownerRoot, ['add', 'bun.lock']);
      await runFixtureGit(ownerRoot, ['commit', '-m', 'epoch-v3']);
      await runFixtureGit(consumerRoot, ['reset', '--hard', 'main']);
      await ensureCompilerDepsReady({
        ...ownerOperation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'primary-generation-v3');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, ownerRoot);
      await expect(fs.lstat(oldTarget)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await fs.lstat(consumerLocator)).isSymbolicLink()).toBeTrue();

      expect((await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('A dangling owned locator must recover from its physical owner.');
        }
      }, consumerRoot)).source).toBe('existing');
      expect(await fs.realpath(consumerLocator))
        .toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      expect(await fs.readFile(path.join(
        consumerLocator, 'typescript', 'lib', 'typescript.js'
      ), 'utf8')).toBe('primary-generation-v3:typescript\n');
    }
  );

  effectfulTest(test,
    'serializes immutable generations and invalidates the binding on lockfile or runtime changes',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-dev-deps-', async (
      tempRoot,
      lifecycleOwner
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const stagingRoots = new Set<string>();
      const materialize = async (args: string[], options: { cwd: string }) => {
        installCalls += 1;
        expect(args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile']);
        expect(options.cwd).not.toBe(tempRoot);
        const stagingName = path.basename(options.cwd);
        expect(stagingName.startsWith('c.staging-')).toBe(true);
        expect(stagingName.length).toBe('c.staging-'.length + 6);
        expect(path.dirname(options.cwd)).toBe(path.join(tempRoot, '.tmp', 'dependency-installs'));
        stagingRoots.add(options.cwd);
        await installCompilerDependencyFixture(options.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const controls = runtimeDependencyOperationOptions({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycleOwner,
        signal: effectful.operationSignal
      });
      const options = { ...controls, materialize };

      const firstCall = ensureCompilerDepsReady(options, tempRoot);
      const secondCall = ensureCompilerDepsReady(options, tempRoot);
      const concurrent = await Promise.allSettled([firstCall, secondCall]);
      const concurrentFailures = concurrent.flatMap(result =>
        result.status === 'rejected' ? [result.reason] : []
      );
      if (concurrentFailures.length === 1) throw concurrentFailures[0];
      if (concurrentFailures.length > 1) {
        throw new AggregateError(concurrentFailures, 'Concurrent compiler dependency admissions failed');
      }
      const first = concurrent.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);

      expect(installCalls).toBe(1);
      expect(first.map(({ source }) => source).sort()).toEqual(['existing', 'installed']);
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');

      const packagePath = path.join(tempRoot, 'package.json');
      const packageManifest = JSON.parse(await fs.readFile(packagePath, 'utf8')) as Record<string, unknown>;
      await fs.writeFile(packagePath, `${JSON.stringify({
        ...packageManifest,
        scripts: { diagnostics: 'bun ./scripts/diagnostics.ts' }
      })}\n`, 'utf8');
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
      expect(installCalls).toBe(1);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n', 'utf8');
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(await fs.readFile(path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'), 'utf8'))
        .toBe('generation-2:typescript\n');

      await writeCompilerDependencyRoot(tempRoot, 'lock-v2\n', '0.0.0');
      await expect(ensureCompilerDepsReady(options, tempRoot))
        .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-001' });
      expect(installCalls).toBe(2);
      await writeCompilerDependencyRoot(tempRoot, 'lock-v2\n');
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
      expect(installCalls).toBe(2);
      expect(stagingRoots.size).toBe(2);
      for (const stagingRoot of stagingRoots) {
        await expect(fs.stat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      }
      const binding = await readJson<Record<string, unknown>>(path.join(
        tempRoot,
        'node_modules',
        '.sec-compiler-deps-binding-v5.json'
      ));
      expect(binding).toMatchObject({
        bunExecutablePath: expect.any(String),
        bunExecutableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        bunVersion: process.versions.bun,
        declaredBunVersion: process.versions.bun,
        dependencyManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        formatVersion: 'compiler-deps-binding-v5'
      });
      expect(binding).not.toHaveProperty('packageManifestSha256');
      expect(binding).not.toHaveProperty('packageSourceSha256');
      expect(readRuntimeDependencyOperationTelemetry(controls).phases).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: 'install', count: 2, outcomes: expect.objectContaining({ completed: 2 }) }),
        expect.objectContaining({ phase: 'publication', count: 2, outcomes: expect.objectContaining({ completed: 2 }) }),
        expect.objectContaining({ phase: 'validation', count: 2, outcomes: expect.objectContaining({ completed: 2 }) })
      ]));
    });
  });

  effectfulTest(test,
    'recovers an installed staging generation only from its durable intent and lifecycle registration',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-stage-intent-', async (
      tempRoot,
      lifecycleOwner
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lifecycleOutcomes: string[] = [];
      let installCalls = 0;
      let rejectFirstDisposal = true;
      const lifecycle = {
        born: lifecycleOwner.born,
        inspect: lifecycleOwner.inspect,
        bind: lifecycleOwner.bind,
        restore: lifecycleOwner.restore,
        retired: lifecycleOwner.retired,
        observeRetirement: lifecycleOwner.observeRetirement,
        disposed: async (
          relativePath: string,
          request: Parameters<typeof lifecycleOwner.disposed>[1]
        ) => {
          lifecycleOutcomes.push(request.outcome);
          if (rejectFirstDisposal) {
            rejectFirstDisposal = false;
            throw new Error('fixture disposal interruption');
          }
          return lifecycleOwner.disposed(relativePath, request);
        }
      };
      const materialize = async (_args: string[], options: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(options.cwd, `intent-generation-${installCalls}`);
        return installCalls === 1
          ? { code: 1, stdout: '', stderr: 'fixture install failure' }
          : { code: 0, stdout: 'ok', stderr: '' };
      };

      const operation = {
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        signal: effectful.operationSignal
      };
      await expect(ensureCompilerDepsReady({ ...operation, materialize, generatedStateLifecycle: lifecycle }, tempRoot))
        .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      const stagedAfterFailure = (await fs.readdir(path.join(tempRoot, '.tmp', 'dependency-installs')))
        .filter((name) => name.startsWith('c.staging-'));
      expect(stagedAfterFailure).toHaveLength(1);
      const foreignResidue = path.join(
        tempRoot,
        '.tmp',
        'dependency-installs',
        stagedAfterFailure[0]!,
        'foreign-residue'
      );
      await fs.writeFile(foreignResidue, 'foreign\n');
      await expect(ensureCompilerDepsReady({ ...operation, materialize, generatedStateLifecycle: lifecycle }, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(installCalls).toBe(1);
      await fs.rm(foreignResidue);

      const ready = await ensureCompilerDepsReady({ ...operation, materialize, generatedStateLifecycle: lifecycle }, tempRoot);
      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(lifecycleOutcomes).toContain('generation-staging-recovered');
      expect((await fs.readdir(path.join(tempRoot, '.tmp', 'dependency-installs')))
        .filter((name) => name.startsWith('c.staging-'))).toHaveLength(0);
    });
  });

  effectfulTest(test,
    'recovers a published compiler generation only from its exact producer provenance',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-published-provenance-', async (
      tempRoot,
      lifecycleOwner
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      let nodeModulesBirthAttempts = 0;
      let rejectFirstNodeModulesBirth = true;
      let rejectStageProvenanceBinding = false;
      let stageRelativePath: string | null = null;
      const lifecycle = Object.freeze({
        ...lifecycleOwner,
        born: async (relativePath: string, operationId: string): Promise<void> => {
          if (relativePath === 'node_modules') {
            nodeModulesBirthAttempts += 1;
            if (rejectFirstNodeModulesBirth) {
              rejectFirstNodeModulesBirth = false;
              throw new Error('fixture process loss before active generation provenance birth');
            }
          } else if (stageRelativePath === null) {
            stageRelativePath = relativePath;
          }
          await lifecycleOwner.born(relativePath, operationId);
        },
        bind: async (
          relativePath: string,
          expected?: Parameters<typeof lifecycleOwner.bind>[1]
        ) => {
          if (rejectStageProvenanceBinding && relativePath === stageRelativePath) {
            throw Object.assign(new Error('fixture stage provenance binding is unavailable'), {
              code: 'GENERATED_STATE_PROVENANCE_BLOCKED'
            });
          }
          return lifecycleOwner.bind(relativePath, expected);
        }
      });
      const operation = Object.freeze({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycle,
        signal: effectful.operationSignal
      });
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        if (installCalls !== 1) {
          throw new Error('Published-generation recovery must not install a replacement generation.');
        }
        await installCompilerDependencyFixture(command.cwd, 'published-provenance');
        return { code: 0, stdout: 'ok', stderr: '' };
      };

      await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
        .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(installCalls).toBe(1);
      expect(nodeModulesBirthAttempts).toBe(1);
      expect(stageRelativePath).not.toBeNull();
      await expect(observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });

      const stageRootPath = path.join(tempRoot, ...stageRelativePath!.split('/'));
      const parkedStageRootPath = `${stageRootPath}.fixture-parked`;
      await fs.rename(stageRootPath, parkedStageRootPath);
      await fs.mkdir(stageRootPath);
      try {
        await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
          .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      } finally {
        await fs.rmdir(stageRootPath);
        await fs.rename(parkedStageRootPath, stageRootPath);
      }
      expect(installCalls).toBe(1);
      await expect(observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });

      rejectStageProvenanceBinding = true;
      try {
        await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
          .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      } finally {
        rejectStageProvenanceBinding = false;
      }
      expect(installCalls).toBe(1);
      await expect(observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });

      const recovered = await ensureCompilerDepsReady({ ...operation, materialize }, tempRoot);
      expect(recovered.source).toBe('existing');
      expect(installCalls).toBe(1);
      const executionAuthority = await observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot);
      expect(executionAuthority).not.toBeNull();

      const repositoryPhysical = inspectNoFollowDirectoryChain(
        tempRoot,
        'Published generation provenance fixture root'
      ).target;
      const locator = inspectNoFollowLinkEntry(repositoryPhysical, 'node_modules');
      if (locator === null || locator.linkTarget === null) {
        throw new Error('Recovered compiler generation did not publish its canonical locator.');
      }
      const activeRegistration = await lifecycleOwner.bind('node_modules');
      expect(activeRegistration).toMatchObject({
        phase: 'active',
        relativePath: 'node_modules',
        root: {
          device: locator.device,
          inode: locator.inode,
          objectId: generatedStateDigest({ kind: 'link', target: locator.linkTarget })
        }
      });
      expect(installCalls).toBe(1);
      expect(nodeModulesBirthAttempts).toBe(2);
    });
  });

  effectfulCompilerTest(
    'retires only registered legacy staging roots and preserves foreign descendants',
    'engineering-compiler-legacy-stage-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lifecycle = operation.generatedStateLifecycle;
      const stagingParent = path.join(tempRoot, '.tmp', 'dependency-installs');
      const createLegacyStage = async (name: string, foreign = false): Promise<string> => {
        const stageRoot = path.join(stagingParent, name);
        await fs.mkdir(path.join(stageRoot, 'node_modules'), { recursive: true });
        await Promise.all([
          fs.writeFile(path.join(stageRoot, 'package.json'), '{}\n'),
          fs.writeFile(path.join(stageRoot, 'bun.lock'), 'legacy\n'),
          fs.writeFile(path.join(stageRoot, 'bunfig.toml'), '[install]\n')
        ]);
        if (foreign) await fs.writeFile(path.join(stageRoot, 'foreign-residue'), 'foreign\n');
        await lifecycle.born(
          path.relative(tempRoot, stageRoot).replaceAll('\\', '/'),
          `legacy-stage:${name}`
        );
        return stageRoot;
      };
      const registeredLegacyStage = await createLegacyStage('c.staging-legacy-registered');
      let installCalls = 0;
      const materialize = async (_args: string[], options: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(options.cwd, `legacy-retirement-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };

      const ready = await ensureCompilerDepsReady({ ...operation, materialize }, tempRoot);
      expect(ready.source).toBe('installed');
      await expect(fs.stat(registeredLegacyStage)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(installCalls).toBe(1);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const foreignLegacyStage = await createLegacyStage('c.staging-legacy-foreign', true);
      await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(installCalls).toBe(1);
      expect(await fs.readFile(path.join(foreignLegacyStage, 'foreign-residue'), 'utf8')).toBe('foreign\n');

      const foreignLegacyStageRelativePath = path.relative(tempRoot, foreignLegacyStage).replaceAll('\\', '/');
      await fs.rm(path.join(foreignLegacyStage, 'foreign-residue'));
      await lifecycle.bind(foreignLegacyStageRelativePath);
      await lifecycle.retired(foreignLegacyStageRelativePath, 'fixture-settlement');
      await lifecycle.disposed(
        foreignLegacyStageRelativePath,
        { outcome: 'fixture-settlement', profile: 'automatic' }
      );
    });

  }
  if (shard === 'external') {
  effectfulTest(test.serial,
    'compiler fixture preserves terminal authority when secondary retirement fails',
    { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
    async effectful => {
      const fixtures: { root: string; lifecycle: IsolatedGeneratedStateLifecycle }[] = [];
      let probeEntered = false;
      let probeFailure: unknown;
      try {
        const failure = await withEffectfulCompilerWorkspace(effectful, 'sec-cdep-terminal-source-', async (root, lifecycle, secondary) => {
          fixtures.push({ root, lifecycle });
          await writeCompilerDependencyRoot(root);
          await ensureCompilerDepsReady({
            deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
            generatedStateLifecycle: lifecycle,
            signal: effectful.operationSignal,
            materialize: async (_args, command) => {
              await installCompilerDependencyFixture(command.cwd, 'terminal-source');
              return { code: 0, stdout: 'ok', stderr: '' };
            }
          }, root);
          {
            const { root: targetRoot, lifecycle: targetLifecycle } = secondary!;
            fixtures.push({ root: targetRoot, lifecycle: targetLifecycle });
            await migrateDependencyTransitionJournal(targetRoot, {
              deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
              generatedStateLifecycle: targetLifecycle, signal: effectful.operationSignal
            });
            await fs.mkdir(path.join(targetRoot, 'node_modules'));
            await fs.writeFile(path.join(targetRoot, 'node_modules', 'unmanaged-fixture.txt'), 'fixture-owned\n');
          }
        }, 'sec-cdep-terminal-target-').then(() => null, error => error);
        expect(failure).not.toBeNull();
        const [source, target] = fixtures;
        expect(await fs.readFile(path.join(target!.root, 'node_modules', 'unmanaged-fixture.txt'), 'utf8'))
          .toBe('fixture-owned\n');
        // The source cleanup still ran despite the target's independent failure.
        await expect(fs.lstat(path.join(source!.root, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
        probeFailure = await settleEffectfulTestCleanup({
          context: effectful, resourceRoot: source!.root,
          settle: async () => {
            probeEntered = true;
            throw new Error('terminal-authority-probe');
          }
        }).then(() => null, error => error);
      } finally {
        const [source, target] = fixtures;
        if (target !== undefined) {
          // Only remove the known unmanaged directory this test created; then
          // ask the dependency owner for its actual terminal readback receipt.
          await fs.rm(path.join(target.root, 'node_modules'), { recursive: true });
        }
        const failures: unknown[] = [];
        let sourceReceipt: Awaited<ReturnType<typeof disposeCompilerDependencyEnvironment>> | undefined;
        const settle = async (outcome: string) => {
          for (const fixture of [...fixtures].reverse()) {
            try {
              const receipt = await disposeCompilerDependencyEnvironment(fixture.root, {
                deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
                generatedStateLifecycle: fixture.lifecycle, signal: effectful.cleanupSignal
              }, outcome);
              if (fixture === source) sourceReceipt = receipt;
              else assertCompilerDependencyEnvironmentRetirementReceipt(receipt, fixture.root);
            } catch (error) { failures.push(error); }
          }
          if (sourceReceipt === undefined || failures.length !== 0) {
            throw new AggregateError(failures, 'Terminal-authority counterexample cleanup failed');
          }
          return sourceReceipt;
        };
        if (source !== undefined) {
          if (probeEntered) {
            await settleEffectfulTestCleanup({ context: effectful, resourceRoot: source.root,
              settle: ({ outcome }) => settle(outcome) });
          } else {
            // A regressed fixture already consumed the terminal receipt; still
            // settle its retained target so the negative baseline leaks nothing.
            assertCompilerDependencyEnvironmentRetirementReceipt(
              await settle('terminal-authority-counterexample-cleanup'), source.root
            );
          }
          let duplicateSettlementEntered = false;
          await expect(settleEffectfulTestCleanup({ context: effectful, resourceRoot: source.root,
            settle: async () => {
              duplicateSettlementEntered = true;
              throw new Error('duplicate-terminal-probe');
            }
          })).rejects.toMatchObject({ code: 'EFFECTFUL-TEST-TERMINAL-AUTHORITY-UNRESOLVED' });
          expect(duplicateSettlementEntered).toBeFalse();
        }
        await settleWorkspaceCleanups(fixtures.flatMap(fixture => [
          () => fs.rm(fixture.root, { recursive: true, force: true }),
          async () => {
            if (generatedStateFixtureRoots.has(fixture.lifecycle)) {
              await removeSettledGeneratedStateFixtureRoot(fixture.lifecycle);
            }
          }
        ]));
      }
      expect(probeEntered).toBeTrue();
      expect(probeFailure).toMatchObject({ code: 'EFFECTFUL-TEST-PHYSICAL-RESIDUE' });
    });

  for (const interference of ['same-byte-directory', 'directory-alias'] as const) {
    effectfulTest(test,
      `explicit generation reuse rejects ${interference} target replacement across source observation`,
      { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
        cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
      effectful => withEffectfulCompilerWorkspace(effectful, 'sec-cdep-pin-owner-', async (ownerRoot, ownerLifecycle, secondary) => {
        const ownerOperation = { deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
          generatedStateLifecycle: ownerLifecycle, signal: effectful.operationSignal };
        await writeCompilerDependencyRoot(ownerRoot);
        const source = await ensureCompilerDepsReady({ ...ownerOperation, materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'pinned-source');
          return { code: 0, stdout: 'ok', stderr: '' };
        } }, ownerRoot);
        {
          const { root: consumerRoot, lifecycle: consumerLifecycle } = secondary!;
          const operation = { deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
            generatedStateLifecycle: consumerLifecycle, signal: effectful.operationSignal };
          await writeCompilerDependencyRoot(consumerRoot);
          const inputNames = ['package.json', 'bun.lock', '.bun-version'] as const;
          const inputs = await Promise.all(inputNames.map(name => fs.readFile(path.join(consumerRoot, name))));
          const originalIdentity = await fs.lstat(consumerRoot, { bigint: true });
          const parkedRoot = `${consumerRoot}.admitted`;
          const replacementRoot = interference === 'directory-alias' ? `${consumerRoot}.replacement` : consumerRoot;
          let parked = false;
          let replacementReady = false;
          await settleWorkspaceCallback(async () => {
            await expect(ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, {
              generatedStateLifecycle: consumerLifecycle,
              deadlineAtUnixMs: operation.deadlineAtUnixMs,
              installMode: 'prebound-only', signal: operation.signal,
              // This original public fence is awaited by source observation,
              // after target input bytes have been admitted, before publication.
              beforeCommit: async () => {
                if (parked) return;
                await fs.rename(consumerRoot, parkedRoot);
                parked = true;
                await fs.mkdir(replacementRoot);
                await Promise.all(inputNames.map((name, index) =>
                  fs.writeFile(path.join(replacementRoot, name), inputs[index]!)));
                if (interference === 'directory-alias') {
                  await fs.symlink(replacementRoot, consumerRoot, process.platform === 'win32' ? 'junction' : 'dir');
                }
                replacementReady = true;
              }
            }, consumerRoot)).rejects.toMatchObject({ code: interference === 'same-byte-directory'
              ? 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' : 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
            expect(replacementReady).toBeTrue();
            const replacementIdentity = await fs.lstat(replacementRoot, { bigint: true });
            expect(replacementIdentity.dev).toBe(originalIdentity.dev);
            expect(replacementIdentity.ino).not.toBe(originalIdentity.ino);
            for (let index = 0; index < inputNames.length; index++) {
              expect(await fs.readFile(path.join(replacementRoot, inputNames[index]!))).toEqual(inputs[index]!);
            }
            await expect(fs.lstat(path.join(replacementRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(fs.lstat(path.join(replacementRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
          }, async () => {
            if (!parked) return;
            if (interference === 'directory-alias') {
              const link = await fs.lstat(consumerRoot).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
                throw error;
              });
              if (link !== null) {
                expect(link.isSymbolicLink()).toBeTrue();
                await fs.unlink(consumerRoot);
              }
            } else if (replacementReady && await fs.lstat(path.join(consumerRoot, 'node_modules'))
              .then(() => true, error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
                throw error;
              })) {
              // Even a regressed implementation's published locator must go
              // through its original owner before the fixture root is restored.
              const receipt = await disposeCompilerDependencyEnvironment(consumerRoot, {
                generatedStateLifecycle: consumerLifecycle,
                deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs, signal: effectful.cleanupSignal
              });
              assertCompilerDependencyEnvironmentRetirementReceipt(receipt, consumerRoot);
            }
            await fs.rm(replacementRoot, { recursive: true, force: true });
            await fs.rename(parkedRoot, consumerRoot);
            // Early target rejection has not created coordination state. Let
            // its original migration owner prepare the restoration for cleanup.
            await migrateDependencyTransitionJournal(consumerRoot, {
              generatedStateLifecycle: consumerLifecycle,
              deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs, signal: effectful.cleanupSignal
            });
          });
        }
        // The original outer fixture must acquire its retirement receipt. A
        // leaked generation borrow would prevent that terminal cleanup.
      }, 'sec-cdep-pin-target-'));
  }

  for (const cut of ['after-publication', 'during-source-retirement'] as const) {
    // These module observers are scoped by the original Effectful fixture and
    // serial registrar. Every call forwards to its owner, even outside this root.
    effectfulTest(test.serial,
      `explicit generation reuse refuses target drift ${cut} and preserves owner recovery`,
      { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
        cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
      effectful => withEffectfulCompilerWorkspace(effectful, 'sec-cdep-late-owner-', async (ownerRoot, ownerLifecycle, secondary) => {
        const ownerOperation = { deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
          generatedStateLifecycle: ownerLifecycle, signal: effectful.operationSignal };
        await writeCompilerDependencyRoot(ownerRoot);
        const source = await ensureCompilerDepsReady({ ...ownerOperation, materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'late-cut-source');
          return { code: 0, stdout: 'ok', stderr: '' };
        } }, ownerRoot);
        const sourcePath = await fs.realpath(source.nodeModulesPath);
        const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: ownerRoot });
        const consumers = path.join(roots.workspaceStateRoot, 'compiler-dependency-coordination', 'v1', 'consumers');
        type ConsumerRecord = { leaseId: string; recordDigest: string; generationDigest: string; phase: string };
        type ConsumerZeroReceipt = { terminal: string; purpose: string; generationDigest: string;
          terminalRecords: { acquired: ConsumerRecord; released: ConsumerRecord & { previousRecordDigest: string } }[] };
        {
          const { root: consumerRoot, lifecycle: consumerLifecycle } = secondary!;
          const operation = { deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
            generatedStateLifecycle: consumerLifecycle, signal: effectful.operationSignal };
          await writeCompilerDependencyRoot(consumerRoot);
          const request = { generatedStateLifecycle: consumerLifecycle, deadlineAtUnixMs: operation.deadlineAtUnixMs,
            installMode: 'prebound-only' as const, signal: operation.signal };
          const inputNames = ['package.json', 'bun.lock', '.bun-version'] as const;
          const inputs = await Promise.all(inputNames.map(name => fs.readFile(path.join(consumerRoot, name))));
          const originalIdentity = await fs.lstat(consumerRoot, { bigint: true });
          const parkedRoot = `${consumerRoot}.published`;
          const readLedger = dependencyTransitions.readDependencyTransitionLedger;
          const assertReceipt = physicalNoFollow.assertPhysicalGenerationRetirementReceipt;
          const publishDurable = physicalNoFollow.publishExclusiveDurableCanonicalFile;
          let ledgerObserver: ReturnType<typeof spyOn> | undefined;
          let retirementObserver: ReturnType<typeof spyOn> | undefined;
          let settlementObserver: ReturnType<typeof spyOn> | undefined;
          let parked = false;
          let replacementIdentity: { dev: bigint; ino: bigint } | undefined;
          let publication: { recordDigest: `sha256:${string}`; registrationDigest: `sha256:${string}`; locatorInode: bigint;
            acquired: ConsumerRecord } | undefined;
          let physicalRetirementObserved = false;
          let sourceSettlementObserved = false;
          // Synchronous substitution is needed inside the real synchronous
          // receipt validator; it cannot return an unawaited mutation promise.
          const replaceTarget = () => {
            expect(fsSync.lstatSync(consumerRoot, { bigint: true }).ino).toBe(originalIdentity.ino);
            fsSync.renameSync(consumerRoot, parkedRoot);
            parked = true;
            fsSync.mkdirSync(consumerRoot);
            replacementIdentity = fsSync.lstatSync(consumerRoot, { bigint: true });
            inputNames.forEach((name, index) => fsSync.writeFileSync(path.join(consumerRoot, name), inputs[index]!));
            const replacement = fsSync.lstatSync(consumerRoot, { bigint: true });
            expect(replacement.dev).toBe(originalIdentity.dev);
            expect(replacement.ino).not.toBe(originalIdentity.ino);
          };
          const restoreTarget = async () => {
            if (!parked) return;
            // Only the new, fixture-owned empty target may be removed. Preserve
            // the parked locator and registration until their original owner runs.
            expect(await fs.lstat(parkedRoot, { bigint: true })).toMatchObject({
              dev: originalIdentity.dev, ino: originalIdentity.ino });
            if (replacementIdentity !== undefined) {
              expect(await fs.lstat(consumerRoot, { bigint: true })).toMatchObject({
                dev: replacementIdentity.dev, ino: replacementIdentity.ino });
            }
            await expect(fs.lstat(path.join(consumerRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(fs.lstat(path.join(consumerRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
            await fs.rm(consumerRoot, { recursive: true, force: true });
            await fs.rename(parkedRoot, consumerRoot);
            parked = false;
          };
          await settleWorkspaceCallback(async () => {
            try {
              ledgerObserver = spyOn(dependencyTransitions, 'readDependencyTransitionLedger')
                .mockImplementation(async (...args) => {
                  const result = await Reflect.apply(readLedger, dependencyTransitions, args);
                  if (path.resolve(args[0]) !== ownerRoot || publication !== undefined) return result;
                  const targetLedger = await Reflect.apply(readLedger, dependencyTransitions, [consumerRoot, args[1]]);
                  if (targetLedger?.tip?.phase !== 'complete') return result;
                  expect(targetLedger.tip.kind).toBe('compiler-locator');
                  expect(result?.tip?.phase).toBe('complete');
                  const inventory = await operation.generatedStateLifecycle.inspect!(['node_modules']);
                  expect(inventory.entries[0]).toMatchObject({ owner: 'compiler-dependency-runtime',
                    ruleId: 'compiler-node-modules', registrationState: 'active' });
                  expect(inventory.entries[0]!.registrationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
                  const locator = await fs.lstat(path.join(consumerRoot, 'node_modules'), { bigint: true });
                  expect(locator.isSymbolicLink()).toBeTrue();
                  expect(await fs.realpath(path.join(consumerRoot, 'node_modules'))).toBe(sourcePath);
                  const acquiredNames = (await fs.readdir(consumers)).filter(name => name.endsWith('-acquired.json'));
                  expect(acquiredNames).toHaveLength(1);
                  const acquired = await readJson<ConsumerRecord>(path.join(consumers, acquiredNames[0]!));
                  expect(acquired).toMatchObject({ phase: 'acquired', generationDigest: source.executionGenerationAuthority.generationDigest });
                  publication = { recordDigest: targetLedger.tip.recordDigest,
                    registrationDigest: inventory.entries[0]!.registrationDigest!, locatorInode: locator.ino, acquired };
                  // This is the outer source-terminal read after the actual
                  // complete publication, not a beforeCommit inside its writer.
                  if (cut === 'after-publication') replaceTarget();
                  return result;
                });
              retirementObserver = spyOn(physicalNoFollow, 'assertPhysicalGenerationRetirementReceipt')
                .mockImplementation((receipt) => {
                  Reflect.apply(assertReceipt, physicalNoFollow, [receipt]);
                  if (publication === undefined || physicalRetirementObserved || receipt.root.path !== sourcePath) return;
                  expect(receipt.terminal).toBe('released');
                  physicalRetirementObserved = true;
                  // The original physical retire promise has resolved. The
                  // retained source owner must still release its durable borrow
                  // and return its own receipt before the final target fence.
                  if (cut === 'during-source-retirement') replaceTarget();
                });
              settlementObserver = spyOn(physicalNoFollow, 'publishExclusiveDurableCanonicalFile')
                .mockImplementation((...args) => {
                  const result = Reflect.apply(publishDurable, physicalNoFollow, args);
                  const input = args[0];
                  if (publication === undefined || input.parent.path !== consumers || !input.name.startsWith('zero-')) return result;
                  // Observe the real durable receipt before original compaction
                  // removes it. Never substitute caller bytes or its authority.
                  const receipt = JSON.parse(fsSync.readFileSync(path.join(consumers, input.name), 'utf8')) as ConsumerZeroReceipt;
                  if (receipt.purpose !== 'terminal-compaction') return result;
                  expect(receipt.terminal).toBe('consumer-zero');
                  expect(receipt.generationDigest).toBe(source.executionGenerationAuthority.generationDigest);
                  expect(receipt.terminalRecords.some(record => record.acquired.recordDigest === publication!.acquired.recordDigest
                    && record.released.leaseId === publication!.acquired.leaseId
                    && record.released.previousRecordDigest === publication!.acquired.recordDigest
                    && record.released.phase === 'released')).toBeTrue();
                  sourceSettlementObserved = true;
                  return result;
                });
              await expect(ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, request, consumerRoot))
                .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
                  message: expect.stringContaining(cut === 'after-publication'
                    ? 'generation consumer after publication' : 'generation consumer after source settlement') });
            } finally {
              settlementObserver?.mockRestore();
              retirementObserver?.mockRestore();
              ledgerObserver?.mockRestore();
            }
            expect(publication).toBeDefined();
            expect(parked).toBeTrue();
            expect(physicalRetirementObserved).toBeTrue();
            expect(sourceSettlementObserved).toBeTrue();
            for (let index = 0; index < inputNames.length; index++) {
              expect(await fs.readFile(path.join(consumerRoot, inputNames[index]!))).toEqual(inputs[index]!);
            }
            // The genuine source owner has also finished durable compaction;
            // its acquisition and release records must no longer be live.
            const names = await fs.readdir(consumers);
            expect(names.filter(name => name.endsWith('-acquired.json') || name.endsWith('-released.json'))).toEqual([]);
            await restoreTarget();
            expect((await fs.lstat(path.join(consumerRoot, 'node_modules'), { bigint: true })).ino)
              .toBe(publication!.locatorInode);
            const recoveredLedger = await readLedger(consumerRoot, operation);
            expect(recoveredLedger?.tip?.recordDigest).toBe(publication!.recordDigest);
            const inventory = await operation.generatedStateLifecycle.inspect!(['node_modules']);
            expect(inventory.entries[0]!.registrationDigest).toBe(publication!.registrationDigest);
            const recovered = await ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, request, consumerRoot);
            expect(recovered.requiresFreshProcess).toBeFalse();
            expect(recovered.executionGenerationAuthority.generationDigest).toBe(source.executionGenerationAuthority.generationDigest);
            expect(await fs.realpath(recovered.nodeModulesPath)).toBe(sourcePath);
            const receipt = await disposeCompilerDependencyEnvironment(consumerRoot, {
                generatedStateLifecycle: consumerLifecycle,
              deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs, signal: effectful.cleanupSignal
            });
            assertCompilerDependencyEnvironmentRetirementReceipt(receipt, consumerRoot);
            expect(receipt).toMatchObject({ locatorRetirement: 'retired', nodeModulesReadback: 'absent',
              generationCollection: 'complete', terminal: 'retired' });
            expect(await fs.readFile(path.join(sourcePath, 'typescript', 'lib', 'typescript.js'), 'utf8'))
              .toBe('late-cut-source:typescript\n');
          }, restoreTarget);
        }
        // Original outer cleanup also requires its genuine environment receipt;
        // any leaked source borrow prevents source generation collection.
      }, 'sec-cdep-late-target-'));
  }

  effectfulTest(test,
    'reuses a compatible external physical generation without giving its bridge mutation ownership',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
      const tempRoot = await fs.mkdtemp(path.join(tmpdir(), LINKED_WORKTREE_TEMP_PREFIX));
      const ownerRoot = path.join(tempRoot, 'owner');
      const consumerRoot = path.join(tempRoot, 'consumer');
      const noConfigOwnerRoot = path.join(tempRoot, 'no-config-owner');
      const testOnlyConsumerRoot = path.join(tempRoot, 'test-only-consumer');
      let ownerLifecycle: IsolatedGeneratedStateLifecycle;
      let consumerLifecycle: IsolatedGeneratedStateLifecycle;
      let noConfigOwnerLifecycle: IsolatedGeneratedStateLifecycle;
      let testOnlyConsumerLifecycle: IsolatedGeneratedStateLifecycle;
      try {
        await Promise.all([
          fs.mkdir(ownerRoot),
          fs.mkdir(consumerRoot),
          fs.mkdir(noConfigOwnerRoot),
          fs.mkdir(testOnlyConsumerRoot)
        ]);
        const lifecycles = await createIsolatedGeneratedStateLifecycles([
          ownerRoot,
          consumerRoot,
          noConfigOwnerRoot,
          testOnlyConsumerRoot
        ], effectful.cleanupDeadlineAtUnixMs);
        ownerLifecycle = lifecycles[0]!;
        consumerLifecycle = lifecycles[1]!;
        noConfigOwnerLifecycle = lifecycles[2]!;
        testOnlyConsumerLifecycle = lifecycles[3]!;
      } catch (error) {
        try {
          await fs.rm(tempRoot, { recursive: true, force: true });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'External compiler fixture setup and cleanup both failed');
        }
        throw error;
      }
      const operation = (generatedStateLifecycle: typeof ownerLifecycle) => Object.freeze({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle,
        signal: effectful.operationSignal
      });
      const ownerOperation = operation(ownerLifecycle);
      const consumerOperation = operation(consumerLifecycle);
      const noConfigOwnerOperation = operation(noConfigOwnerLifecycle);
      const testOnlyConsumerOperation = operation(testOnlyConsumerLifecycle);
      const startedRoots: Array<readonly [string, typeof ownerLifecycle]> = [];
      const cleanupFailures: unknown[] = [];
      let primaryFailure: { error: unknown } | undefined;
      try {
        await Promise.all([
          writeCompilerDependencyRoot(ownerRoot),
          writeCompilerDependencyRoot(consumerRoot)
        ]);
        await Promise.all([
        fs.writeFile(
          path.join(ownerRoot, 'bunfig.toml'),
          '[install]\r\nauto = "disable"\r\n\r\n[test]\r\npreload = ["owner.ts"]\r\n'
        ),
        fs.writeFile(
          path.join(consumerRoot, 'bunfig.toml'),
          '[install]\nauto = "disable"\n\n[test]\npreload = ["consumer.ts"]\n'
        )
        ]);
      let installCalls = 0;
      startedRoots.push([ownerRoot, ownerLifecycle]);
      let ownerReady = await ensureCompilerDepsReady({
        ...ownerOperation,
        materialize: async (_args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'shared-owner');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, ownerRoot);
      const bridgePath = path.join(consumerRoot, 'node_modules');
      const generationPath = path.join(ownerRoot, 'node_modules');
      const ownerProofRoot = path.join(
        ownerRoot,
        '.tmp',
        'dependency-installs',
        'compiler-backups',
        'read-only-generations'
      );
      const ownerProofNames = await fs.readdir(ownerProofRoot);
      expect(ownerProofNames).toHaveLength(1);
      const ownerProofPath = path.join(ownerProofRoot, ownerProofNames[0]!);
      const generationPhysicalPath = await fs.realpath(generationPath);
      if (process.platform === 'win32') {
        const proofBefore = await fs.readFile(ownerProofPath);
        const sourceGeneration = ownerReady.sourceGeneration!;
        const physicalRoot = inspectNoFollowDirectoryChain(
          generationPhysicalPath,
          'Stale owner proof fixture generation root'
        ).target;
        const inventory = scanNoFollowDirectoryTreeInventory(physicalRoot, {
          deadlineAtMs: performance.now() + 30_000,
          maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
          maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES
        });
        const identityBefore = await fs.lstat(generationPhysicalPath, { bigint: true });
        const competing = await materializeRetainedNoFollowProvenDirectoryGeneration({
          binding: {
            generationDigest: sourceGeneration.epoch,
            treeDigest: sourceGeneration.treeDigest,
            treeEntryCount: sourceGeneration.treeEntryCount
          },
          deadlineAtUnixMs: Date.now() + 30_000,
          inventory,
          proofText: null,
          root: physicalRoot
        });
        await competing.generation.retire();
        expect((await fs.lstat(generationPhysicalPath, { bigint: true })).ctimeNs)
          .not.toBe(identityBefore.ctimeNs);
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          ownerOperation,
          ownerRoot
        )).toBeNull();
        ownerReady = await ensureCompilerDepsReady({
          ...ownerOperation,
          materialize: async () => {
            throw new Error('Stale owner proof recovery must not install.');
          }
        }, ownerRoot);
        expect(await fs.readFile(ownerProofPath)).not.toEqual(proofBefore);
        const recovered = await retainCompilerDependencyExecutionGeneration(
          ownerReady.executionGenerationAuthority,
          { deadlineAtUnixMs: Date.now() + 30_000 }
        );
        try {
          await recovered.physicalGeneration.assertAuthorityCurrent();
        } finally {
          await recovered.retire();
        }
      }
      const ownerProofBefore = await fs.readFile(ownerProofPath);
      const generationBefore = await fs.lstat(generationPhysicalPath, { bigint: true });
      await fs.symlink(generationPath, bridgePath, process.platform === 'win32' ? 'junction' : 'dir');
      startedRoots.push([consumerRoot, consumerLifecycle]);
      await consumerLifecycle.born(
        'node_modules',
        `compiler-dependency-bridge-fixture:${effectful.operationId}`
      );

      const parkedOwnerProofPath = `${ownerProofPath}.missing`;
      await fs.rename(ownerProofPath, parkedOwnerProofPath);
      try {
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          ownerOperation,
          ownerRoot
        )).toBeNull();
        await expect(observeCompilerDependencyExecutionGenerationAuthority(
          consumerOperation,
          consumerRoot
        )).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
        await expect(ensureCompilerDepsReady({
          ...consumerOperation,
          materialize: async () => {
            throw new Error('A consumer cannot replace its source owner proof.');
          }
        }, consumerRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
        expect((await fs.lstat(generationPhysicalPath, { bigint: true })).ctimeNs)
          .toBe(generationBefore.ctimeNs);
        await expect(fs.lstat(path.join(
          consumerRoot,
          '.tmp',
          'dependency-installs',
          'compiler-backups',
          'read-only-generations'
        ))).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await fs.rename(parkedOwnerProofPath, ownerProofPath);
      }

      const reused = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Compatible dependency bridge must not install.');
        }
      }, consumerRoot);
      expect(reused).toMatchObject({
        nodeModulesPath: bridgePath,
        root: consumerRoot,
        source: 'existing'
      });
      expect(installCalls).toBe(1);
      expect(await fs.realpath(bridgePath)).toBe(await fs.realpath(generationPath));
      const generationAfter = await fs.lstat(generationPhysicalPath, { bigint: true });
      expect(generationAfter.ctimeNs).toBe(generationBefore.ctimeNs);
      expect(await fs.readFile(ownerProofPath)).toEqual(ownerProofBefore);
      const consumerAuthority = await observeCompilerDependencyExecutionGenerationAuthority(
        consumerOperation,
        consumerRoot
      );
      expect(consumerAuthority).not.toBeNull();
      const consumerGeneration = await retainCompilerDependencyReadGeneration(
        consumerAuthority!,
        { deadlineAtUnixMs: Date.now() + 30_000 }
      );
      try {
        await consumerGeneration.assertAuthorityCurrent();
      } finally {
        await consumerGeneration.retire();
      }
      if (process.platform === 'win32') {
        const sourceGeneration = ownerReady.sourceGeneration!;
        const physicalRoot = inspectNoFollowDirectoryChain(
          generationPhysicalPath,
          'Stale consumer proof fixture generation root'
        ).target;
        const inventory = scanNoFollowDirectoryTreeInventory(physicalRoot, {
          deadlineAtMs: performance.now() + 30_000,
          maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
          maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES
        });
        const proofBefore = await fs.readFile(ownerProofPath);
        const competing = await materializeRetainedNoFollowProvenDirectoryGeneration({
          binding: {
            generationDigest: sourceGeneration.epoch,
            treeDigest: sourceGeneration.treeDigest,
            treeEntryCount: sourceGeneration.treeEntryCount
          },
          deadlineAtUnixMs: Date.now() + 30_000,
          inventory,
          proofText: null,
          root: physicalRoot
        });
        await competing.generation.retire();
        await expect(observeCompilerDependencyExecutionGenerationAuthority(
          consumerOperation,
          consumerRoot
        )).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          ownerOperation,
          ownerRoot
        )).toBeNull();
        ownerReady = await ensureCompilerDepsReady({
          ...ownerOperation,
          materialize: async () => {
            throw new Error('Stale consumer-visible owner proof recovery must not install.');
          }
        }, ownerRoot);
        expect(await fs.readFile(ownerProofPath)).not.toEqual(proofBefore);
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          consumerOperation,
          consumerRoot
        )).not.toBeNull();
      }

      const parkedBridgePath = path.join(consumerRoot, 'node_modules.validated');
      const replacementGenerationPath = path.join(tempRoot, 'replacement', 'node_modules');
      await fs.mkdir(replacementGenerationPath, { recursive: true });
      await expect(ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage !== 'binding-observed') return;
          await fs.rename(bridgePath, parkedBridgePath);
          await fs.symlink(
            replacementGenerationPath,
            bridgePath,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
        }
      }, consumerRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(await fs.realpath(parkedBridgePath)).toBe(await fs.realpath(generationPath));
      expect(await fs.realpath(bridgePath)).toBe(await fs.realpath(replacementGenerationPath));
      await fs.unlink(bridgePath);
      await fs.rename(parkedBridgePath, bridgePath);

      const originalConsumerLock = await fs.readFile(path.join(consumerRoot, 'bun.lock'));
      await expect(ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage !== 'final-binding-observed') return;
          await fs.writeFile(path.join(consumerRoot, 'bun.lock'), 'consumer-drift-during-admission\n');
        }
      }, consumerRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), originalConsumerLock);

      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), 'incompatible-lock\n');
      let incompatibleConsumerInstalls = 0;
      const incompatibleReady = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async (_args, command) => {
          incompatibleConsumerInstalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'incompatible-consumer');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, consumerRoot);
      expect(incompatibleReady.source).toBe('installed');
      expect(incompatibleConsumerInstalls).toBe(1);
      expect(await fs.realpath(bridgePath)).not.toBe(await fs.realpath(generationPath));
      expect(await fs.readFile(
        path.join(generationPath, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('shared-owner:typescript\n');
      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), originalConsumerLock);

      await Promise.all([
        writeCompilerDependencyRoot(noConfigOwnerRoot),
        writeCompilerDependencyRoot(testOnlyConsumerRoot),
        fs.writeFile(
          path.join(testOnlyConsumerRoot, 'bunfig.toml'),
          '[test]\npreload = ["consumer.ts"]\n'
        )
      ]);
      startedRoots.push([noConfigOwnerRoot, noConfigOwnerLifecycle]);
      await ensureCompilerDepsReady({
        ...noConfigOwnerOperation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'no-install-config');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, noConfigOwnerRoot);
      const testOnlyBridgePath = path.join(testOnlyConsumerRoot, 'node_modules');
      await fs.symlink(
        path.join(noConfigOwnerRoot, 'node_modules'),
        testOnlyBridgePath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      startedRoots.push([testOnlyConsumerRoot, testOnlyConsumerLifecycle]);
      await testOnlyConsumerLifecycle.born(
        'node_modules',
        `compiler-dependency-test-only-bridge-fixture:${effectful.operationId}`
      );
      expect((await ensureCompilerDepsReady({
        ...testOnlyConsumerOperation,
        materialize: async () => {
          throw new Error('Absent and non-install-only config must share one identity.');
        }
      }, testOnlyConsumerRoot)).source).toBe('existing');
      } catch (error) {
        primaryFailure = { error };
      }
      let cleanupFailure: { error: unknown } | undefined;
      try {
        if (startedRoots.length !== 0) {
          await settleEffectfulTestCleanup({
            context: effectful,
            resourceRoot: ownerRoot,
            settle: async ({ outcome }) => {
              for (const [root, generatedStateLifecycle] of startedRoots.slice(1).reverse()) {
                try {
                  const receipt = await disposeCompilerDependencyEnvironment(root, {
                    deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
                    generatedStateLifecycle,
                    signal: effectful.cleanupSignal
                  }, outcome);
                  assertCompilerDependencyEnvironmentRetirementReceipt(receipt, root);
                } catch (error) {
                  cleanupFailures.push(error);
                }
              }
              let ownerReceipt: Awaited<ReturnType<typeof disposeCompilerDependencyEnvironment>> | null = null;
              try {
                ownerReceipt = await disposeCompilerDependencyEnvironment(ownerRoot, {
                  deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
                  generatedStateLifecycle: ownerLifecycle,
                  signal: effectful.cleanupSignal
                }, outcome);
              } catch (error) {
                cleanupFailures.push(error);
              }
              if (ownerReceipt === null || cleanupFailures.length !== 0) {
                throw new AggregateError(
                  cleanupFailures,
                  'Compiler dependency fixture retirement failed before terminal receipt consumption'
                );
              }
              return ownerReceipt;
            }
          });
        }
        if (cleanupFailures.length !== 0) {
          throw new AggregateError(
            cleanupFailures,
            'Compiler dependency fixture secondary retirement failed'
          );
        }
        await settleWorkspaceCleanups([
          () => fs.rm(tempRoot, { recursive: true, force: true }),
          ...[
            testOnlyConsumerLifecycle,
            noConfigOwnerLifecycle,
            consumerLifecycle,
            ownerLifecycle
          ].map(lifecycle => () => removeSettledGeneratedStateFixtureRoot(lifecycle))
        ]);
      } catch (error) {
        cleanupFailure = { error };
      }
      if (primaryFailure !== undefined && cleanupFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure.error, cleanupFailure.error],
          'Compiler dependency fixture operation and cleanup both failed'
        );
      }
      if (primaryFailure !== undefined) throw primaryFailure.error;
      if (cleanupFailure !== undefined) throw cleanupFailure.error;
  });

  effectfulTest(test.skipIf(process.platform !== 'linux'),
    'rejects a sealed generation content mutation before publishing its proof',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
      let retiredRoot: string | undefined;
      await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-sealed-mutation-', async (
        tempRoot,
        lifecycle
      ) => {
        retiredRoot = tempRoot;
        await writeCompilerDependencyRoot(tempRoot);
        const operation = {
          deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
          generatedStateLifecycle: lifecycle,
          signal: effectful.operationSignal
        };
        const backupRoot = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler-backups');
        const proofRoot = path.join(backupRoot, 'read-only-generations');
        const nodeModulesPath = path.join(tempRoot, 'node_modules');
        let mutation: Readonly<{
          path: string;
          bytes: Buffer<ArrayBuffer>;
          device: bigint;
          inode: bigint;
        }> | undefined;
        const rejectedTransition = await settleWorkspaceCallback(async () => {
          const failure = await ensureCompilerDepsReady({
            ...operation,
            beforeCommit: async () => {
              if (mutation !== undefined) return;
              let names: string[];
              try {
                names = await fs.readdir(backupRoot);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
                throw error;
              }
              const generationName = names.find(name => name.startsWith('generation-'));
              if (generationName === undefined) return;
              const target = path.join(backupRoot, generationName, 'typescript', 'lib', 'typescript.js');
              let metadata: fsSync.BigIntStats;
              try {
                metadata = await fs.lstat(target, { bigint: true });
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
                throw error;
              }
              const sealedMode = Number(metadata.mode & 0o777n);
              if ((sealedMode & 0o222) !== 0) return;
              mutation = {
                path: target,
                bytes: await fs.readFile(target),
                device: metadata.dev,
                inode: metadata.ino
              };
              await fs.chmod(target, 0o600);
              try {
                await fs.writeFile(target, 'mutated-after-seal\n');
              } finally {
                await fs.chmod(target, sealedMode);
              }
            },
            materialize: async (_args, command) => {
              await installCompilerDependencyFixture(command.cwd, 'post-seal-mutation');
              return { code: 0, stdout: 'ok', stderr: '' };
            }
          }, tempRoot).then(() => null, (error: unknown) => error);
          // The publication wrapper reports recovery responsibility; its
          // durable predecessor must still identify the specific seal failure.
          expect(failure).toMatchObject({
            code: 'IMPORT-AUTHORITY-004',
            details: {
              recoveryRequired: true,
              recoveryCause: 'Compiler dependency sealed generation changed before proof publication',
              causeDetails: {
                causeDetails: { cause: 'Linux generation proof changed.' }
              }
            }
          });
          expect(mutation).toBeDefined();
          expect(await fs.readFile(mutation!.path, 'utf8')).toBe('mutated-after-seal\n');
          expect((await fs.lstat(mutation!.path)).mode & 0o200).not.toBe(0);
          await expect(fs.readdir(proofRoot)).resolves.toEqual([]);
          await expect(fs.lstat(nodeModulesPath)).rejects.toMatchObject({ code: 'ENOENT' });
          const pending = await readDependencyTransition(tempRoot, runtimeDependencyOperationOptions(operation));
          expect(pending).toMatchObject({
            kind: 'compiler-local-locator',
            phase: 'recovery-required',
            failure: {
              code: 'RUNTIME-DEPS-004',
              message: 'Compiler dependency sealed generation changed before proof publication'
            }
          });
          // Unrepaired content is not disposal authority, even for the real
          // owner. Re-entry must preserve the corrupted generation and proof absence.
          await expect(disposeCompilerDependencyEnvironment(tempRoot, operation)).rejects.toMatchObject({
            code: 'IMPORT-AUTHORITY-004',
            details: { cause: 'Local compiler immutable generation binding drifted' }
          });
          expect(await fs.readFile(mutation!.path, 'utf8')).toBe('mutated-after-seal\n');
          await expect(fs.readdir(proofRoot)).resolves.toEqual([]);
          await expect(fs.lstat(nodeModulesPath)).rejects.toMatchObject({ code: 'ENOENT' });
          return pending!;
        }, async () => {
          if (mutation === undefined) return;
          // Undo only this fixture's injected bytes on the same physical file.
          // The owner must restore write authority; no chmod, journal edit or
          // forced generation removal may manufacture a successful cleanup.
          const file = await fs.open(mutation.path, fsSync.constants.O_RDWR | fsSync.constants.O_NOFOLLOW);
          try {
            const current = await file.stat({ bigint: true });
            expect(current.isFile()).toBeTrue();
            expect(current.dev).toBe(mutation.device);
            expect(current.ino).toBe(mutation.inode);
            expect(current.mode & 0o200n).not.toBe(0n);
            expect(await file.readFile('utf8')).toBe('mutated-after-seal\n');
            const restored = await file.write(mutation.bytes, 0, mutation.bytes.length, 0);
            expect(restored.bytesWritten).toBe(mutation.bytes.length);
            await file.truncate(mutation.bytes.length);
          } finally {
            await file.close();
          }
          expect(await fs.readFile(mutation.path)).toEqual(mutation.bytes);
        });
        expect((await ensureCompilerDepsReady({
          ...operation,
          installMode: 'prebound-only',
          materialize: async () => { throw new Error('Seal recovery must reuse the original generation.'); }
        }, tempRoot)).source).toBe('existing');
        const recovered = await readDependencyTransition(tempRoot, runtimeDependencyOperationOptions(operation));
        expect(recovered).toMatchObject({
          operationKey: rejectedTransition.operationKey,
          phase: 'complete',
          failure: null,
          sourceGeneration: rejectedTransition.sourceGeneration
        });
        expect(await fs.realpath(nodeModulesPath)).toBe(rejectedTransition.sourceGeneration.sourcePath);
        expect((await fs.lstat(mutation!.path)).mode & 0o222).toBe(0);
        expect(await fs.readdir(proofRoot)).toHaveLength(1);
      });
      expect(retiredRoot).toBeDefined();
      await expect(fs.lstat(retiredRoot!)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  effectfulTest(test.skipIf(process.platform !== 'linux' || POSIX_ROOT_PROCESS),
    'restores owner write authority when sealed generation proof publication is denied',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
      await withEffectfulCompilerWorkspace(
        effectful,
        'engineering-compiler-proof-publication-denied-',
        async (tempRoot, lifecycle) => {
          await writeCompilerDependencyRoot(tempRoot);
          const proofRoot = path.join(
            tempRoot,
            '.tmp',
            'dependency-installs',
            'compiler-backups',
            'read-only-generations'
          );
          let denied = false;
          let proofRootMode: number | undefined;
          let sealedPayloadPath: string | undefined;
          const failure = await ensureCompilerDepsReady({
            deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
            generatedStateLifecycle: lifecycle,
            signal: effectful.operationSignal,
            beforeCommit: async () => {
              if (denied) return;
              let proofEntries: string[];
              let generationEntries: string[];
              try {
                [proofEntries, generationEntries] = await Promise.all([
                  fs.readdir(proofRoot),
                  fs.readdir(path.dirname(proofRoot))
                ]);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
                throw error;
              }
              if (proofEntries.length !== 0) return;
              const generationName = generationEntries.find(name => name.startsWith('generation-'));
              if (generationName === undefined) return;
              const payloadPath = path.join(
                path.dirname(proofRoot),
                generationName,
                'typescript',
                'lib',
                'typescript.js'
              );
              let payload: Awaited<ReturnType<typeof fs.lstat>>;
              try {
                payload = await fs.lstat(payloadPath);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
                throw error;
              }
              if ((payload.mode & 0o222) !== 0) return;
              proofRootMode = (await fs.lstat(proofRoot)).mode & 0o777;
              await fs.chmod(proofRoot, proofRootMode & ~0o222);
              sealedPayloadPath = payloadPath;
              denied = true;
            },
            materialize: async (_args, command) => {
              await installCompilerDependencyFixture(command.cwd, 'proof-publication-denied');
              return { code: 0, stdout: 'ok', stderr: '' };
            }
          }, tempRoot).then(
            () => null,
            (error: unknown) => error
          );
          try {
            expect(failure).not.toBeNull();
            expect(denied).toBeTrue();
            expect(sealedPayloadPath).toBeDefined();
            expect((await fs.lstat(sealedPayloadPath!)).mode & 0o200).not.toBe(0);
            await expect(fs.readdir(proofRoot)).resolves.toEqual([]);
          } finally {
            if (proofRootMode !== undefined) await fs.chmod(proofRoot, proofRootMode);
          }
        }
      );
    });

  test('rejects a forged compiler locator retirement authority without touching its generation', async () => {
    await withLinkedWorktreeTempWorkspace(async (tempRoot) => {
      const ownerRoot = path.join(tempRoot, 'repository');
      const consumerRoot = path.join(tempRoot, 'candidate');
      await fs.mkdir(ownerRoot);
      await runFixtureGit(ownerRoot, ['init', '-b', 'main']);
      await writeCompilerDependencyRoot(ownerRoot);
      await fs.writeFile(path.join(ownerRoot, '.gitignore'), 'node_modules/\n.tmp/\n');
      await runFixtureGit(ownerRoot, ['add', '.gitignore', '.bun-version', 'bun.lock', 'package.json']);
      await runFixtureGit(ownerRoot, [
        '-c', 'user.email=sec@example.invalid',
        '-c', 'user.name=SEC Test',
        '-c', 'core.autocrlf=false',
        'commit', '-m', 'fixture'
      ]);
      await runFixtureGit(ownerRoot, ['config', 'core.autocrlf', 'false']);
      await installCompilerDependencyFixture(ownerRoot, 'primary-generation');
      await runFixtureGit(ownerRoot, ['worktree', 'add', '-b', 'candidate', consumerRoot]);
      await fs.symlink(
        path.join(ownerRoot, 'node_modules'),
        path.join(consumerRoot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      await expect(compilerDependencyLocatorWorktreeRetirementProvider.retire(Object.freeze({
        schema: 'sec-generated-state-worktree-retirement-effect-authority-v1'
      }) as GeneratedStateWorktreeRetirementEffectAuthority)).rejects.toThrow('forged, stale, replayed');
      expect((await fs.lstat(path.join(consumerRoot, 'node_modules'))).isSymbolicLink()).toBeTrue();
      expect(await fs.readFile(
        path.join(ownerRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation:typescript\n');
    });
  });

  effectfulLinkedCompilerTest(
    'retires one exact stale worktree generation before publishing a shared locator',
    async ({ consumerOperation, consumerRoot, ownerRoot }) => {
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const ready = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Exact external generation reuse must not install.');
        }
      }, consumerRoot);

      expect(ready).toMatchObject({
        requiresFreshProcess: true,
        root: consumerRoot,
        source: 'existing',
        transitionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      });
      expect(await fs.realpath(consumerNodeModules)).toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      const backupsRoot = path.join(consumerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
      const backups = (await fs.readdir(backupsRoot)).filter((name) => name.startsWith('locator-preimage-'));
      expect(backups).toEqual([]);

      const admittedByFreshProcess = await ensureCompilerDepsReady(consumerOperation, consumerRoot);
      expect(admittedByFreshProcess.requiresFreshProcess).toBeFalse();
      expect(admittedByFreshProcess.transitionDigest).not.toBe(ready.transitionDigest);
    });

  }
  if (shard === 'recovery') {
  effectfulCompilerTest(
    'settles a fully absent unpublished foreign project attempt without trusting its source',
    'engineering-project-orphan-owner-',
    async (ownerRoot, operation) => {
      await writeCompilerDependencyRoot(ownerRoot);
      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'project-orphan-owner');
          return { code: 0, stdout: 'fixture', stderr: '' };
        }
      }, ownerRoot);
      const options = runtimeDependencyOperationOptions(operation);
      const sourcePath = ready.sourceGeneration!.sourcePath;
      const sourceBinding = await readJson<unknown>(
        path.join(sourcePath, '.sec-compiler-deps-binding-v5.json')
      );
      const sourceGeneration = await runtimeDependencySourceGeneration({
        binding: sourceBinding,
        options,
        ownerRoot,
        sourcePath
      });
      const canonicalTarget = path.join(ownerRoot, 'current-project', 'node_modules');
      let abandoned: Awaited<ReturnType<typeof beginDependencyTransition>> | undefined;
      await withTempWorkspace(async (fixtureRoot) => {
        const target = path.join(fixtureRoot, 'node_modules');
        const stageRoot = path.join(fixtureRoot, '.tmp', 'project.staging-abandoned');
        const stage = path.join(stageRoot, 'node_modules');
        await fs.mkdir(stage, { recursive: true });
        abandoned = await beginDependencyTransition({
          kind: 'project-projection', ownerRoot, destinationPath: target,
          stagePath: stage, stageRootPath: stageRoot, backupPath: null,
          sourceGeneration, bindingDigest: sourceGeneration.bindingDigest, options
        });
        abandoned = await markDependencyTransitionFailure(abandoned,
          new SecError('RUNTIME-DEPS-004', 'Project transition journal targets a foreign canonical path'), options);
        await expect(settleAbandonedLegacyProjection(abandoned, ownerRoot, canonicalTarget, options))
          .rejects.toThrow('physical residue');
        expect((await fs.lstat(stage)).isDirectory()).toBe(true);
      }, 'engineering-project-orphan-fixture-');
      expect(await settleAbandonedLegacyProjection(abandoned!, ownerRoot, canonicalTarget, options)).toBe(true);
      expect((await readDependencyTransition(ownerRoot, options))?.phase).toBe('rolled-back');

      await withTempWorkspace(async (fixtureRoot) => {
        const target = path.join(fixtureRoot, 'node_modules');
        const stageRoot = path.join(fixtureRoot, '.tmp', 'project.staging-published');
        const stage = path.join(stageRoot, 'node_modules');
        await fs.mkdir(stage, { recursive: true });
        let published = await beginDependencyTransition({
          kind: 'project-projection', ownerRoot, destinationPath: target,
          stagePath: stage, stageRootPath: stageRoot, backupPath: null,
          sourceGeneration, bindingDigest: sourceGeneration.bindingDigest, options
        });
        await fs.rename(stage, target);
        published = await advanceDependencyTransition(published, {
          destination: await observeDependencyTransitionSlot(target, sourceGeneration.bindingDigest),
          stage: transitionAbsentSlot(stage),
          phase: 'published'
        }, options);
        published = await markDependencyTransitionFailure(published,
          new SecError('RUNTIME-DEPS-004', 'Project transition journal targets a foreign canonical path'), options);
        abandoned = published;
      }, 'engineering-project-published-fixture-');
      await expect(settleAbandonedLegacyProjection(abandoned!, ownerRoot, canonicalTarget, options))
        .rejects.toThrow('source binding is not exact');
      await advanceDependencyTransition(abandoned!, {
        destination: transitionAbsentSlot(abandoned!.destination.path),
        stage: transitionAbsentSlot(abandoned!.stage!.path),
        stageRoot: transitionAbsentSlot(abandoned!.stageRoot!.path),
        phase: 'rolled-back',
        durability: 'known'
      }, options);
    }
  );
  effectfulCompilerTest(
    'settles only an abandoned legacy runtime projection after residue and tamper checks',
    'engineering-compiler-legacy-projection-',
    async (root, operation) => {
      await writeCompilerDependencyRoot(root);
      const runtimeSpec = await loadRuntimeDependencySpec();
      await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
        packageManager: `bun@${process.versions.bun}`,
        dependencies: runtimeSpec.dependencies,
        devDependencies: runtimeSpec.devDependencies
      })}\n`);
      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'legacy-runtime-source');
          for (const name of RUNTIME_DEPENDENCY_PACKAGE_NAMES) {
            const packageRoot = path.join(command.cwd, 'node_modules', ...name.split('/'));
            const request = runtimeSpec.dependencies[name] ?? runtimeSpec.devDependencies[name]!;
            const alias = /^npm:(@[^/\s]+\/[^@\s]+|[^@\s]+)@(.+)$/u.exec(request);
            const manifestName = alias?.[1] ?? name;
            const version = alias?.[2] ?? request;
            await fs.mkdir(packageRoot, { recursive: true });
            await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
              name: manifestName,
              version,
              ...(name === 'typescript' ? { main: './lib/typescript.js' } : {})
            })}\n`);
          }
          return { code: 0, stdout: 'fixture', stderr: '' };
        }
      }, root);
      expect(ready.runtimeMaterialization).not.toBeNull();
      const options = runtimeDependencyOperationOptions(operation);
      const source = await runtimeDependencySourceGeneration({
        binding: ready.runtimeMaterialization!,
        options,
        ownerRoot: root,
        sourcePath: ready.sourceGeneration!.sourcePath
      });
      const legacyFixture = await fs.mkdtemp(path.join(tmpdir(), 'sec-legacy-projection-'));
      try {
        const sharedRoot = path.join(legacyFixture, '.shared-deps');
        const stageRoot = path.join(sharedRoot, '.runtime-generation-abc123');
        const stagePath = path.join(stageRoot, 'node_modules');
        const activePath = path.join(sharedRoot, 'node_modules');
        await fs.mkdir(stagePath, { recursive: true });
        let transition = await beginDependencyTransition({
          kind: 'runtime-projection', ownerRoot: root, destinationPath: activePath,
          stagePath, stageRootPath: stageRoot,
          backupPath: compilerTransitionBackupPath(root, 'runtime', source),
          sourceGeneration: source, bindingDigest: source.bindingDigest, options
        });
        await fs.rename(stagePath, activePath);
        transition = await advanceDependencyTransition(transition, {
          destination: await observeDependencyTransitionSlot(activePath, source.bindingDigest),
          stage: transitionAbsentSlot(stagePath),
          phase: 'published'
        }, options);
        transition = await markDependencyTransitionFailure(transition,
          new SecError('IMPORT-AUTHORITY-004', 'Compiler transition journal targets a foreign canonical path'),
          options);
        await expect(ensureCompilerDepsReady(operation, root)).rejects.toMatchObject({
          code: 'IMPORT-AUTHORITY-004',
          details: { cause: 'Abandoned projection still has physical residue' }
        });
        expect((await fs.lstat(activePath)).isDirectory()).toBeTrue();
        await fs.rm(legacyFixture, { recursive: true });
        const blocked = (await readDependencyTransition(root, options))!;
        const recordPath = path.join(dependencyTransitionNamespacePaths(root).recordsRoot,
          transitionRecordName(blocked.recordDigest));
        const originalBytes = await fs.readFile(recordPath);
        try {
          await fs.writeFile(recordPath, Buffer.from(originalBytes.toString('utf8').replace('runtime-projection', 'untime-projection')));
          await expect(ensureCompilerDepsReady(operation, root)).rejects.toBeDefined();
        } finally {
          await fs.writeFile(recordPath, originalBytes);
        }
        const settled = await ensureCompilerDepsReady(operation, root);
        expect(settled.source).toBe('existing');
        expect((await readDependencyTransition(root, options))?.phase).toBe('rolled-back');
        await expect(fs.lstat(activePath)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await fs.rm(legacyFixture, { recursive: true, force: true });
      }
    });
  effectfulLinkedCompilerTest(
    'preserves an unknown physical worktree dependency directory instead of claiming it',
    async ({ consumerOperation, consumerRoot }) => {
      const ownedGeneration = path.join(consumerRoot, 'node_modules.owned-fixture');
      const unknownGeneration = path.join(consumerRoot, 'node_modules');
      const ownedTarget = await fs.realpath(unknownGeneration);
      await fs.rename(unknownGeneration, ownedGeneration);
      try {
        await fs.mkdir(unknownGeneration);
        await fs.writeFile(path.join(unknownGeneration, 'user-sentinel.txt'), 'preserve-me\n');

        await expect(ensureCompilerDepsReady({
          ...consumerOperation,
          materialize: async () => {
            throw new Error('Unknown physical state must not trigger install.');
          }
        }, consumerRoot)).rejects.toMatchObject({
          code: 'IMPORT-AUTHORITY-004',
          message: expect.stringContaining('not an owned compiler dependency generation')
        });
        expect((await fs.lstat(unknownGeneration)).isDirectory()).toBeTrue();
        expect(await fs.readFile(path.join(unknownGeneration, 'user-sentinel.txt'), 'utf8')).toBe('preserve-me\n');
        expect((await fs.lstat(ownedGeneration)).isSymbolicLink()).toBeTrue();
        expect(await fs.realpath(ownedGeneration)).toBe(ownedTarget);
      } finally {
        await fs.rm(unknownGeneration, { recursive: true, force: true });
        await fs.rename(ownedGeneration, unknownGeneration);
      }
    });

  effectfulLinkedCompilerTest(
    'recovers a retired stale locator after validation fails before ownership binding',
    async ({ consumerOperation, consumerRoot, ownerRoot }) => {
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');

      await expect(ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage === 'binding-observed') throw new Error('injected locator validation failure');
        }
      }, consumerRoot)).rejects.toMatchObject({
        code: 'IMPORT-AUTHORITY-004',
        details: { cause: 'injected locator validation failure' },
        message: 'Compiler dependency consumer bridge is incompatible'
      });
      await expect(fs.lstat(consumerNodeModules)).rejects.toMatchObject({ code: 'ENOENT' });
      const recovered = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Retired locator recovery must reuse its physical owner.');
        }
      }, consumerRoot);
      expect(recovered.source).toBe('existing');
      expect(await fs.realpath(consumerNodeModules))
        .toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      expect(await fs.readFile(
        path.join(consumerNodeModules, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation-v2:typescript\n');
    });

  effectfulLinkedCompilerTest(
    'preserves an external replacement and emits recovery evidence when locator rollback loses CAS',
    async ({ consumerOperation, consumerRoot }) => {
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const displacedLocator = path.join(consumerRoot, 'node_modules.displaced-locator');
      let replacementCreated = false;

      const failure = await ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage !== 'binding-observed' || replacementCreated) return;
          replacementCreated = true;
          await fs.rename(consumerNodeModules, displacedLocator);
          await fs.mkdir(consumerNodeModules);
          await fs.writeFile(path.join(consumerNodeModules, 'external-sentinel.txt'), 'external-owner\n');
          throw new Error('injected external replacement');
        }
      }, consumerRoot).then(
        () => null,
        (error: unknown) => error
      );

      const typedFailure = failure as {
        code: string;
        details: {
          cause: string;
          causeDetails: { cause: string };
          recoveryBackup: string | null;
          rollbackFailure: string;
        };
      };
      expect(typedFailure.code).toBe('IMPORT-AUTHORITY-004');
      expect(typedFailure.details.recoveryBackup).toBeNull();
      expect(typedFailure.details).toMatchObject({
        cause: 'Compiler dependency consumer bridge is incompatible',
        causeDetails: { cause: 'injected external replacement' },
        rollbackFailure: expect.stringContaining('changed before')
      });
      expect(await fs.readFile(path.join(consumerNodeModules, 'external-sentinel.txt'), 'utf8'))
        .toBe('external-owner\n');
      expect((await fs.lstat(displacedLocator)).isSymbolicLink()).toBeTrue();
      expect(await fs.readFile(
        path.join(displacedLocator, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation-v2:typescript\n');
      await fs.rm(consumerNodeModules, { recursive: true });
      await fs.rename(displacedLocator, consumerNodeModules);
      expect((await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Recovered locator must reuse the physical owner.');
        }
      }, consumerRoot)).source).toBe('existing');
    });

  effectfulCompilerTest(
    'protects sealed compiler entries and repairs mutable corruption before developer commands',
    'engineering-compiler-dev-deps-corruption-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const options = {
        ...operation,
        materialize: async (_args: string[], command: { cwd: string }) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      };
      await ensureCompilerDepsReady(options, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
      if (process.platform === 'win32') {
        await expect(fs.writeFile(entryPath, 'corrupt\n')).rejects.toMatchObject({ code: 'EPERM' });
        expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
        expect(installCalls).toBe(1);
        expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-1:typescript\n');
      } else {
        await fs.writeFile(entryPath, 'corrupt\n');
        expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
        expect(installCalls).toBe(2);
        expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-2:typescript\n');
      }
    });

  effectfulCompilerTest(
    'does not publish failed compiler materialization and allows a fresh exact retry',
    'engineering-compiler-dev-deps-rollback-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const stagingRoots: string[] = [];
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        stagingRoots.push(command.cwd);
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let failedInstallRoot: string | null = null;
      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        materialize: async (_args, command) => {
          failedInstallRoot = command.cwd;
          return { code: 1, stdout: '', stderr: 'injected install failure' };
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-002' });
      expect(failedInstallRoot).not.toBeNull();
      await expect(fs.stat(failedInstallRoot!)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.lstat(path.join(tempRoot, 'node_modules')))
        .rejects.toMatchObject({ code: 'ENOENT' });

      expect((await ensureCompilerDepsReady(baseOptions, tempRoot)).source).toBe('installed');
      await expect(fs.stat(stagingRoots.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-2:typescript\n');
    });

  effectfulCompilerTest(
    'rejects a prepared historical transition when its stage lifecycle provenance is absent',
    'engineering-compiler-dev-deps-prepared-stage-absent-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      let stagedRoot: string | null = null;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        stagedRoot = command.cwd;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = {
        ...operation,
        materialize,
      };
      await ensureCompilerDepsReady(baseOptions, tempRoot);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        testCompilerRename: async (source, target) => {
          if (stagedRoot !== null && path.resolve(source) === path.join(stagedRoot, 'node_modules')) {
            const interruption = new Error('historical process loss before preimage move') as NodeJS.ErrnoException;
            interruption.code = 'ENOTEMPTY';
            throw interruption;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(installCalls).toBe(2);
      expect(stagedRoot).not.toBeNull();
      await expect(fs.stat(stagedRoot!)).resolves.toBeTruthy();

      // Remove the independent stage/lifecycle owner while leaving the
      // compiler-generation journal prepared. The unchanged preimage is not
      // enough to manufacture a rollback receipt from journal bytes alone.
      const stageIntentsPath = path.join(
        tempRoot,
        '.tmp',
        'dependency-installs',
        '.compiler-stage-intents-v1'
      );
      const parkedStageIntentsPath = `${stageIntentsPath}.fixture-parked`;
      await fs.rename(stageIntentsPath, parkedStageIntentsPath);
      let recoveryInstalls = 0;
      let recoveryError: unknown;
      try {
        await ensureCompilerDepsReady({
          ...baseOptions,
          materialize: async () => {
            recoveryInstalls += 1;
            throw new Error('provenance rejection must not install');
          }
        }, tempRoot);
      } catch (error) {
        recoveryError = error;
      } finally {
        await fs.rename(parkedStageIntentsPath, stageIntentsPath);
      }
      expect(recoveryError).toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect((recoveryError as { details?: { cause?: string } }).details?.cause)
        .toMatch(/lifecycle|disposal authority|provenance|settlement intent/u);
      expect(recoveryInstalls).toBe(0);
      await ensureCompilerDepsReady({
        ...baseOptions,
        materialize: async () => {
          throw new Error('Restored stage provenance recovery must not reinstall.');
        }
      }, tempRoot);
    });

  }
  if (shard === 'locks') {
  effectfulCompilerTest(
    'retries only bounded Windows transient generation renames and preserves the exact source identity',
    'engineering-compiler-dev-deps-windows-rename-retry-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');

      let transientFailures = 0;
      const delays: number[] = [];
      const result = await ensureCompilerDepsReady({
        ...baseOptions,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
        testCompilerPublishPlatform: 'win32',
        testCompilerRename: async (source, target) => {
          const stagedPublish = path.basename(source) === 'node_modules' &&
            path.basename(path.dirname(source)).includes('.staging-');
          if (stagedPublish && transientFailures < 2) {
            transientFailures += 1;
            const error = new Error('injected transient Windows rename denial') as NodeJS.ErrnoException;
            error.code = 'EPERM';
            throw error;
          }
          await fs.rename(source, target);
        }
      }, tempRoot);

      expect(result.source).toBe('installed');
      expect(transientFailures).toBe(2);
      expect(delays).toEqual([25, 50]);
      expect(await fs.readFile(path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'), 'utf8'))
        .toBe('generation-2:typescript\n');
    });

  effectfulCompilerTest(
    'preserves a replaced staging source and recovers after its original identity returns',
    'engineering-compiler-dev-deps-windows-rename-identity-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let replaced = false;
      let stagedSource: string | null = null;

      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        sleep: async () => undefined,
        testCompilerPublishPlatform: 'win32',
        testCompilerRename: async (source, target) => {
          const stagedPublish = path.basename(source) === 'node_modules' &&
            path.basename(path.dirname(source)).includes('.staging-');
          if (stagedPublish && !replaced) {
            replaced = true;
            stagedSource = source;
            await fs.rename(source, `${source}-original`);
            await fs.mkdir(source);
            const error = new Error('injected transient rename with source replacement') as NodeJS.ErrnoException;
            error.code = 'EBUSY';
            throw error;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({
        code: 'IMPORT-AUTHORITY-004'
      });
      expect(replaced).toBe(true);
      expect(stagedSource).not.toBeNull();
      expect((await fs.lstat(stagedSource!)).isDirectory()).toBeTrue();
      expect(await fs.readFile(path.join(
        `${stagedSource!}-original`, 'typescript', 'lib', 'typescript.js'
      ), 'utf8')).toBe('generation-2:typescript\n');
      await fs.rmdir(stagedSource!);
      await fs.rename(`${stagedSource!}-original`, stagedSource!);
      expect((await ensureCompilerDepsReady({
        ...baseOptions,
        materialize: async () => {
          throw new Error('Recovered exact stage must not install again.');
        }
      }, tempRoot)).source).toBe('existing');
      expect(await fs.readFile(path.join(
        tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'
      ), 'utf8')).toBe('generation-2:typescript\n');
    });

  effectfulCompilerTest(
    'does not retry a non-transient compiler generation rename failure',
    'engineering-compiler-dev-deps-non-transient-rename-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let failures = 0;

      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        sleep: async () => {
          throw new Error('non-transient rename must not sleep');
        },
        testCompilerPublishPlatform: 'win32',
        testCompilerRename: async (source, target) => {
          const stagedPublish = path.basename(source) === 'node_modules' &&
            path.basename(path.dirname(source)).includes('.staging-');
          if (stagedPublish) {
            failures += 1;
            const error = new Error('injected non-transient rename failure') as NodeJS.ErrnoException;
            error.code = 'ENOTEMPTY';
            throw error;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(failures).toBe(1);
    });

  test('rejects invalid or widening operation budgets before creating a dependency namespace', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const candidateRoot = path.join(tempRoot, 'candidate');
      for (const lockTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 300_001]) {
        await expect(ensureCompilerDepsReady({ lockTimeoutMs }, candidateRoot))
          .rejects.toMatchObject({ code: 'RUNTIME-DEPS-003' });
      }
      for (const pollIntervalMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_001]) {
        await expect(ensureCompilerDepsReady({ pollIntervalMs }, candidateRoot))
          .rejects.toMatchObject({ code: 'RUNTIME-DEPS-003' });
      }
      await expect(fs.stat(candidateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-dev-deps-budget-admission-');
  });

  effectfulCompilerTest(
    'aborts compiler lock waiting without spawning or replacing the live owner',
    'engineering-compiler-dev-deps-lock-abort-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      const lockPath = compilerCoordinationLockPath(tempRoot);
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'live-owner'
      })}\n`);
      const controller = new AbortController();
      let installCalls = 0;

      await expect(ensureCompilerDepsReady({
        ...operation,
        materialize: async () => {
          installCalls += 1;
          return { code: 0, stdout: '', stderr: '' };
        },
        lockTimeoutMs: 1_000,
        pollIntervalMs: 1,
        signal: controller.signal,
        sleep: async () => new Promise<void>(() => {
          queueMicrotask(() => controller.abort(new Error('fixture lock wait aborted')));
        })
      }, tempRoot)).rejects.toBeTruthy();

      expect(installCalls).toBe(0);
      expect(await readJson<{ token: string }>(lockPath)).toMatchObject({ token: 'live-owner' });
      await fs.rm(lockPath);
    });

  effectfulCompilerTest(
    'gives the compiler command only the operation budget remaining after lock contention',
    'engineering-compiler-dev-deps-budget-narrowing-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'temporary-live-owner'
      })}\n`);
      const lockContentionElapsedMs = 150;
      const initialRemainingMs = operation.deadlineAtUnixMs - Date.now();
      let waited = false;
      let observedCommandTimeoutMs: number | undefined;

      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          observedCommandTimeoutMs = command.timeoutMs;
          await installCompilerDependencyFixture(command.cwd, 'remaining-budget');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 1,
        sleep: async () => {
          if (!waited) {
            waited = true;
            await new Promise<void>(resolve => setTimeout(resolve, lockContentionElapsedMs));
            await fs.rm(lockPath);
          }
        }
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(waited).toBe(true);
      expect(observedCommandTimeoutMs).toBeGreaterThan(0);
      expect(observedCommandTimeoutMs).toBeLessThan(initialRemainingMs - lockContentionElapsedMs);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  effectfulCompilerTest(
    'removes its exact compiler lock even when the final caller fence rejects',
    'engineering-compiler-dev-deps-cleanup-fence-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'cleanup-fence');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);

      const lockPath = compilerCoordinationLockPath(tempRoot);
      let lifecycleBound = false;
      const lifecycle = Object.freeze({
        ...operation.generatedStateLifecycle,
        bind: async (...args: Parameters<typeof operation.generatedStateLifecycle.bind>) => {
          const registration = await operation.generatedStateLifecycle.bind(...args);
          lifecycleBound = true;
          return registration;
        }
      });
      await expect(ensureCompilerDepsReady({
        ...operation,
        beforeCommit: async () => {
          if (lifecycleBound) throw new Error('fixture final cleanup fence rejected');
        },
        generatedStateLifecycle: lifecycle
      }, tempRoot)).rejects.toThrow('fixture final cleanup fence rejected');

      expect(lifecycleBound).toBe(true);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  effectfulCompilerTest(
    'retries only the same Windows compiler lock identity and proves final absence',
    'engineering-compiler-lock-delete-retry-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      const deleteAttempts: number[] = [];
      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-retry');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 1,
        testInstallLockDeletePlatform: 'win32',
        testInstallLockDelete: async (filePath, attempt) => {
          expect(filePath.startsWith('\\\\?\\') ? filePath.slice(4) : filePath).toBe(lockPath);
          deleteAttempts.push(attempt);
          if (attempt === 1) {
            throw Object.assign(new Error('fixture Windows sharing violation'), { code: 'EBUSY' });
          }
        }
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(deleteAttempts).toEqual([1, 2, 1, 2]);
      await expect(fs.stat(lockPath))
        .rejects.toMatchObject({ code: 'ENOENT' });
    });

  effectfulCompilerTest(
    'preserves a replacement Windows compiler lock after a transient deletion failure',
    'engineering-compiler-lock-delete-replacement-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      let replaced = false;
      await expect(ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-replacement');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 1,
        testInstallLockDeletePlatform: 'win32',
        testInstallLockDelete: async (filePath, attempt) => {
          if (attempt !== 1) return;
          await fs.rm(filePath);
          await fs.writeFile(filePath, `${JSON.stringify({
            createdAt: new Date().toISOString(),
            pid: process.pid,
            token: 'replacement-owner'
          })}\n`);
          replaced = true;
          throw Object.assign(new Error('fixture Windows replacement race'), { code: 'EPERM' });
        }
      }, tempRoot)).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-003',
        details: { outcome: 'preserved-replacement' }
      });

      expect(replaced).toBe(true);
      expect(await readJson<{ token: string }>(lockPath)).toMatchObject({ token: 'replacement-owner' });
      await fs.rm(lockPath);
    });

  effectfulCompilerTest(
    'reports an unknown Windows lock settlement when the operation deadline expires',
    'engineering-compiler-lock-delete-deadline-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      let monotonicNowMs = performance.now();
      let failure: unknown;
      try {
        await ensureCompilerDepsReady({
          ...operation,
          materialize: async (_args, command) => {
            await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-deadline');
            return { code: 0, stdout: 'ok', stderr: '' };
          },
          monotonicNowMs: () => monotonicNowMs,
          pollIntervalMs: 1,
          testInstallLockDeletePlatform: 'win32',
          testInstallLockDelete: async () => {
            monotonicNowMs += 100_000;
            throw Object.assign(new Error('fixture Windows sharing violation'), { code: 'EBUSY' });
          }
        }, tempRoot);
      } catch (error) {
        failure = error;
      } finally {
        await fs.rm(lockPath, { force: true });
      }
      expect(failure).toMatchObject({
        code: 'RUNTIME-DEPS-003',
        details: { outcome: 'unknown' }
      });
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  effectfulCompilerTest(
    'reclaims a dead compiler install owner instead of timing out future development',
    'engineering-compiler-dev-deps-orphan-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 2_147_483_647,
        token: 'dead-owner'
      })}\n`);
      let installCalls = 0;

      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'recovered');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 10,
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(1);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  effectfulCompilerTest(
    'preserves an unissued legacy reclaim marker for explicit architecture migration',
    'engineering-compiler-dev-deps-legacy-reclaim-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      const reclaimPath = `${lockPath}.reclaim`;
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 2_147_483_647,
        token: 'dead-legacy-owner'
      })}\n`);
      await fs.writeFile(reclaimPath, '123e4567-e89b-42d3-a456-426614174000\n');
      const expired = new Date('2026-01-01T00:00:00.000Z');
      await fs.utimes(reclaimPath, expired, expired);
      await expect(ensureCompilerDepsReady({
        ...operation,
        materialize: async () => {
          throw new Error('Unissued legacy marker must not start an install.');
        },
        pollIntervalMs: 10
      }, tempRoot)).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-004',
        details: { migrationRequired: true }
      });
      expect((await readJson<{ token: string }>(lockPath)).token).toBe('dead-legacy-owner');
      expect(await fs.readFile(reclaimPath, 'utf8')).toBe('123e4567-e89b-42d3-a456-426614174000\n');
      await fs.rm(reclaimPath);
      await fs.rm(lockPath);
      expect((await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'recovered-after-explicit-legacy-settlement');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot)).source).toBe('installed');
    });
  }
});
}
