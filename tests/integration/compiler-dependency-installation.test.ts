import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { generatedStateDigest } from '../../src/adapters/runtime-state/generated-state/contract.ts';
import {
  createGeneratedStateCleanupOperationSession,
  generatedStateProducerHooks,
  type GeneratedStateProducerHookSet,
  type GeneratedStateProducerQuarantineHook,
  type GeneratedStateWorktreeRetirementEffectAuthority
} from '../../src/adapters/runtime-state/generated-state/lifecycle.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowLinkEntry,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  scanNoFollowDirectoryTreeInventory
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommand } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import { runtimeDependencyOperationOptions } from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { readRuntimeDependencyOperationTelemetry } from '../../src/adapters/toolchain/dependencies/runtime/operation-telemetry.ts';
import {
  retainCompilerDependencyExecutionGeneration,
  retainCompilerDependencyReadGeneration
} from '../../src/adapters/toolchain/dependencies/runtime/project-runtime.ts';
import {
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES
} from '../../src/adapters/toolchain/dependencies/runtime/source-generation.ts';
import {
  assertCompilerDependencyEnvironmentRetirementReceipt,
  compilerDependencyLocatorWorktreeRetirementProvider,
  disposeCompilerDependencyEnvironment,
  ensureCompilerDepsReady,
  observeCompilerDependencyExecutionGenerationAuthority
} from '../../src/adapters/toolchain/dependencies/test/runtime.ts';
import { readJson } from "../../src/adapters/filesystem/files.ts";
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

describe('compiler dependency installation', () => {
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
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-sealed-mutation-', async (
      tempRoot,
      lifecycle
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      let mutated = false;
      let mutatedPath: string | null = null;
      await expect(ensureCompilerDepsReady({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycle,
        signal: effectful.operationSignal,
        beforeCommit: async () => {
          if (mutated) return;
          const backupRoot = path.join(
            tempRoot,
            '.tmp',
            'dependency-installs',
            'compiler-backups'
          );
          let names: string[];
          try {
            names = await fs.readdir(backupRoot);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
          }
          const generationName = names.find((name) => name.startsWith('generation-'));
          if (generationName === undefined) return;
          const target = path.join(
            backupRoot,
            generationName,
            'typescript',
            'lib',
            'typescript.js'
          );
          let metadata: Awaited<ReturnType<typeof fs.lstat>>;
          try {
            metadata = await fs.lstat(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
          }
          const sealedMode = metadata.mode & 0o777;
          if ((sealedMode & 0o222) !== 0) return;
          await fs.chmod(target, 0o600);
          try {
            await fs.writeFile(target, 'mutated-after-seal\n');
          } finally {
            await fs.chmod(target, sealedMode);
          }
          mutated = true;
          mutatedPath = target;
        },
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'post-seal-mutation');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(mutated).toBeTrue();
      expect(mutatedPath).not.toBeNull();
      expect((await fs.lstat(mutatedPath!)).mode & 0o222).not.toBe(0);
      await expect(fs.readdir(path.join(
        tempRoot,
        '.tmp',
        'dependency-installs',
        'compiler-backups',
        'read-only-generations'
      ))).resolves.toEqual([]);
    });
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

  effectfulLinkedCompilerTest(
    'preserves an unknown physical worktree dependency directory instead of claiming it',
    async ({ consumerOperation, consumerRoot }) => {
      const ownedGeneration = path.join(consumerRoot, 'node_modules.owned-fixture');
      const unknownGeneration = path.join(consumerRoot, 'node_modules');
      await fs.rename(unknownGeneration, ownedGeneration);
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
      expect((await fs.lstat(ownedGeneration)).isDirectory()).toBeTrue();
      await fs.rm(unknownGeneration, { recursive: true });
      await fs.rename(ownedGeneration, unknownGeneration);
    });

  effectfulLinkedCompilerTest(
    'restores the exact stale generation when locator validation fails before ownership binding',
    async ({ consumerOperation, consumerRoot }) => {
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const staleIdentity = await fs.lstat(consumerNodeModules, { bigint: true });

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
      const restoredIdentity = await fs.lstat(consumerNodeModules, { bigint: true });
      expect({ dev: restoredIdentity.dev, ino: restoredIdentity.ino, mode: restoredIdentity.mode })
        .toEqual({ dev: staleIdentity.dev, ino: staleIdentity.ino, mode: staleIdentity.mode });
      expect(await fs.readFile(
        path.join(consumerNodeModules, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('candidate-generation-v1:typescript\n');
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
          recoveryBackup: string;
          rollbackFailure: string;
        };
      };
      expect(typedFailure.code).toBe('IMPORT-AUTHORITY-004');
      const recoveryBackup = typedFailure.details.recoveryBackup;
      expect(typeof recoveryBackup).toBe('string');
      expect(typedFailure.details).toMatchObject({
        cause: 'Compiler dependency consumer bridge is incompatible',
        causeDetails: { cause: 'injected external replacement' },
        rollbackFailure: expect.stringContaining('changed before')
      });
      expect(await fs.readFile(path.join(consumerNodeModules, 'external-sentinel.txt'), 'utf8'))
        .toBe('external-owner\n');
      expect((await fs.lstat(displacedLocator)).isSymbolicLink()).toBeTrue();
      expect(await fs.readFile(
        path.join(recoveryBackup, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('candidate-generation-v1:typescript\n');
      await fs.rm(consumerNodeModules, { recursive: true });
      await fs.rename(displacedLocator, consumerNodeModules);
    });

  effectfulCompilerTest(
    'repairs critical compiler entry corruption before developer commands load dependencies',
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
      await fs.writeFile(entryPath, 'corrupt\n');

      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-2:typescript\n');
    });

  effectfulCompilerTest(
    'preserves the active generation when materialization or atomic publish fails',
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
      const bindingPath = path.join(tempRoot, 'node_modules', '.sec-compiler-deps-binding-v5.json');
      const originalEntry = await fs.readFile(entryPath);
      const originalBinding = await fs.readFile(bindingPath);

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
      expect(await fs.readFile(entryPath)).toEqual(originalEntry);
      expect(await fs.readFile(bindingPath)).toEqual(originalBinding);

      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        testCompilerPublishHook: () => {
          throw new Error('injected publish failure');
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      await expect(fs.stat(stagingRoots.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(entryPath)).toEqual(originalEntry);
      expect(await fs.readFile(bindingPath)).toEqual(originalBinding);
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
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v1\n');
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
        .toMatch(/lifecycle|disposal authority|provenance/u);
      expect(recoveryInstalls).toBe(0);
      await ensureCompilerDepsReady({
        ...baseOptions,
        materialize: async () => {
          throw new Error('Restored stage provenance recovery must not reinstall.');
        }
      }, tempRoot);
    });

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
    'fails closed and restores the active generation when a transient rename changes source identity',
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
      const entryPath = path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
      const originalEntry = await fs.readFile(entryPath);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let replaced = false;

      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        sleep: async () => undefined,
        testCompilerPublishPlatform: 'win32',
        testCompilerRename: async (source, target) => {
          const stagedPublish = path.basename(source) === 'node_modules' &&
            path.basename(path.dirname(source)).includes('.staging-');
          if (stagedPublish && !replaced) {
            replaced = true;
            await fs.rename(source, `${source}-original`);
            await fs.mkdir(source);
            const error = new Error('injected transient rename with source replacement') as NodeJS.ErrnoException;
            error.code = 'EBUSY';
            throw error;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({
        code: 'IMPORT-AUTHORITY-004',
        details: {
          cause: expect.stringContaining('identity changed')
        }
      });
      expect(replaced).toBe(true);
      expect(await fs.readFile(entryPath)).toEqual(originalEntry);
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
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
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
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'temporary-live-owner'
      })}\n`);
      const operationBudgetMs = 3_000;
      const lockContentionElapsedMs = 150;
      let monotonicNowMs = 0;
      let waited = false;
      let observedCommandTimeoutMs: number | undefined;

      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          observedCommandTimeoutMs = command.timeoutMs;
          await installCompilerDependencyFixture(command.cwd, 'remaining-budget');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        lockTimeoutMs: operationBudgetMs,
        monotonicNowMs: () => monotonicNowMs,
        pollIntervalMs: 1,
        sleep: async () => {
          if (!waited) {
            waited = true;
            monotonicNowMs = lockContentionElapsedMs;
            await fs.rm(lockPath);
          }
        }
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(waited).toBe(true);
      expect(observedCommandTimeoutMs).toBeGreaterThan(0);
      expect(observedCommandTimeoutMs).toBeLessThan(operationBudgetMs - lockContentionElapsedMs);
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

      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
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
      let deleteAttempts = 0;
      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-retry');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 1,
        testInstallLockDeletePlatform: 'win32',
        testInstallLockDelete: async (_filePath, attempt) => {
          deleteAttempts += 1;
          if (attempt === 1) {
            throw Object.assign(new Error('fixture Windows sharing violation'), { code: 'EBUSY' });
          }
        }
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(deleteAttempts).toBe(2);
      await expect(fs.stat(path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    });

  effectfulCompilerTest(
    'preserves a replacement Windows compiler lock after a transient deletion failure',
    'engineering-compiler-lock-delete-replacement-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
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
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      let monotonicNowMs = 0;
      await expect(ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-deadline');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        lockTimeoutMs: 100,
        monotonicNowMs: () => monotonicNowMs,
        pollIntervalMs: 1,
        testInstallLockDeletePlatform: 'win32',
        testInstallLockDelete: async () => {
          monotonicNowMs = 101;
          throw Object.assign(new Error('fixture Windows sharing violation'), { code: 'EBUSY' });
        }
      }, tempRoot)).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-003',
        details: {
          failureOrder: ['primary', 'fence', 'cleanup'],
          cleanupFailure: { details: { outcome: 'unknown' } }
        }
      });

      expect((await readJson<{ token: string }>(lockPath)).token).toBeTruthy();
      await fs.rm(lockPath);
    });

  effectfulCompilerTest(
    'reclaims a dead compiler install owner instead of timing out future development',
    'engineering-compiler-dev-deps-orphan-',
    async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
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
    'migrates an expired legacy reclaim marker only with a dead paired lock owner',
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
      let installCalls = 0;

      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'legacy-reclaim-recovered');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 10
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(1);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(reclaimPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
