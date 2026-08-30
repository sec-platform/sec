import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { generatedStateDigest, type GeneratedStateRegistration } from '../../src/runtime-state/generated-state/contract.ts';
import { generatedStateProducerHooks } from '../../src/runtime-state/generated-state/lifecycle.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowLinkEntry } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommand } from '../../src/runtime-state/physical/runtime/process.ts';
import {
  compilerDependencyLocatorWorktreeRetirementProvider,
  ensureCompilerDepsReady,
  migrateDependencyTransitionJournal
} from '../../src/toolchain/dependencies/test/runtime.ts';
import { readJson } from '../../src/workspace/files.ts';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Git for Windows cannot consume the nested cache/action/shard/run path used by
// ordinary compiler fixtures. These external-tool fixtures therefore use an
// exact, run-owned OS-temp child while state/cache remain invocation-isolated.
const LINKED_WORKTREE_TEMP_PREFIX = 'sec-cdep-wt-';

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
    main: 'dist/ts-morph-common.js',
    name: '@ts-morph/common',
    version: '1.0.0'
  }, {
    main: './script/mod.js',
    name: 'code-block-writer',
    version: '1.0.0'
  }, {
    main: 'dist/ts-morph.js',
    name: 'ts-morph',
    version: '1.0.0'
  }, {
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
      devDependencies: { 'ts-morph': '1.0.0', typescript: '1.0.0' }
    })}\n`, 'utf8'),
    fs.writeFile(path.join(root, 'bun.lock'), lockfile, 'utf8'),
    fs.writeFile(path.join(root, '.bun-version'), `${bunVersion}\n`, 'utf8')
  ]);
}

async function prepareLinkedWorktreeEpochTransition(tempRoot: string): Promise<Readonly<{
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
  await ensureCompilerDepsReady({
    commandRunner: async (_command, _args, command) => {
      await installCompilerDependencyFixture(command.cwd, 'candidate-generation-v1');
      return { code: 0, stdout: 'ok', stderr: '' };
    }
  }, consumerRoot);

  await fs.writeFile(path.join(ownerRoot, 'bun.lock'), 'lock-v2\n');
  await runFixtureGit(ownerRoot, ['add', 'bun.lock']);
  await runFixtureGit(ownerRoot, ['commit', '-m', 'epoch-v2']);
  await runFixtureGit(consumerRoot, ['reset', '--hard', 'main']);
  await ensureCompilerDepsReady({
    commandRunner: async (_command, _args, command) => {
      await installCompilerDependencyFixture(command.cwd, 'primary-generation-v2');
      return { code: 0, stdout: 'ok', stderr: '' };
    }
  }, ownerRoot);
  return Object.freeze({ consumerRoot, ownerRoot });
}

describe('compiler dependency installation', () => {
  test('serializes immutable generations and invalidates the binding on lockfile or runtime changes', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const stagingRoots = new Set<string>();
      const lifecycleEvents: string[] = [];
      let lockWaiterHasArrived = false;
      let releaseLockWaiter!: () => void;
      const lockWaiterArrival = new Promise<void>((resolve) => {
        releaseLockWaiter = resolve;
      });
      const contentionBarrier = Object.freeze({
        async waitForLockWaiter(): Promise<void> {
          await lockWaiterArrival;
        },
        announceLockWaiter(): void {
          if (lockWaiterHasArrived) return;
          lockWaiterHasArrived = true;
          releaseLockWaiter();
        }
      });
      let releaseFirstCompletion!: () => void;
      const firstCompletion = new Promise<void>((resolve) => {
        releaseFirstCompletion = resolve;
      });
      const commandRunner = async (_command: string, args: string[], options: { cwd: string }) => {
        installCalls += 1;
        expect(args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts']);
        expect(options.cwd).not.toBe(tempRoot);
        const stagingName = path.basename(options.cwd);
        expect(stagingName.startsWith('c.staging-')).toBe(true);
        expect(stagingName.length).toBe('c.staging-'.length + 6);
        expect(path.dirname(options.cwd)).toBe(path.join(tempRoot, '.tmp', 'dependency-installs'));
        stagingRoots.add(options.cwd);
        await contentionBarrier.waitForLockWaiter();
        await installCompilerDependencyFixture(options.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      type FixtureBindingExpectation = Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: Readonly<{ device: string; inode: string; objectId: string }>;
      }>;
      const registrations = new Map<string, GeneratedStateRegistration>();
      const fixtureRegistration = (
        relativePath: string,
        expected: FixtureBindingExpectation | undefined,
        phase: 'active' | 'retired'
      ): GeneratedStateRegistration => {
        const registrationId = generatedStateDigest({
          schema: 'fixture-generated-state-registration-id-v1',
          relativePath,
          phase
        });
        const registrationDigest = generatedStateDigest({
          schema: 'fixture-generated-state-registration-v1',
          registrationId,
          relativePath,
          phase,
          physical: expected?.physical ?? { device: 'fixture', inode: relativePath, objectId: 'fixture' }
        });
        return Object.freeze({
          schema: 'sec-generated-state-registration-v1',
          registrationId,
          repositoryRoot: tempRoot,
          workspace: { device: 'fixture', inode: 'workspace', objectId: 'fixture' },
          ruleId: expected?.ruleId ?? 'fixture-rule',
          relativePath,
          root: expected?.physical ?? { device: 'fixture', inode: relativePath, objectId: 'fixture' },
          owner: expected?.owner ?? 'fixture-owner',
          producer: expected?.producer ?? 'fixture-producer',
          operationId: `fixture:${relativePath}`,
          phase,
          retirementRef: phase === 'retired' ? generatedStateDigest({ registrationDigest }) : null,
          generatedAt: '2026-08-28T00:00:00.000Z',
          registrationDigest
        });
      };
      const options = {
        commandRunner,
        generatedStateLifecycle: {
          born: async (relativePath: string) => {
            lifecycleEvents.push(`born:${relativePath}`);
            registrations.set(relativePath, fixtureRegistration(relativePath, undefined, 'active'));
          },
          bind: async (relativePath: string, expected?: FixtureBindingExpectation) => {
            const current = registrations.get(relativePath);
            if (current === undefined) throw new Error(`fixture lifecycle registration missing: ${relativePath}`);
            lifecycleEvents.push(`bind:${relativePath}`);
            const bound = fixtureRegistration(relativePath, expected, current.phase);
            registrations.set(relativePath, bound);
            return bound;
          },
          restore: async (
            relativePath: string,
            expectedRegistrationDigest: `sha256:${string}`,
            expectedPhysical: Readonly<{ device: string; inode: string; objectId: string }>
          ) => {
            const current = registrations.get(relativePath);
            if (current?.registrationDigest !== expectedRegistrationDigest) {
              throw new Error(`fixture lifecycle restore predecessor mismatch: ${relativePath}`);
            }
            const restored = fixtureRegistration(relativePath, { physical: expectedPhysical }, 'active');
            registrations.set(relativePath, restored);
            return restored;
          },
          retired: async (relativePath: string) => {
            const current = registrations.get(relativePath);
            if (current === undefined) throw new Error(`fixture lifecycle registration missing: ${relativePath}`);
            const retired = fixtureRegistration(relativePath, {
              owner: current.owner,
              producer: current.producer,
              ruleId: current.ruleId,
              physical: current.root
            }, 'retired');
            registrations.set(relativePath, retired);
            return retired;
          },
          disposed: async (relativePath: string, outcome: string) => {
            lifecycleEvents.push(`disposed:${relativePath}:${outcome}`);
            await fs.rm(path.join(tempRoot, ...relativePath.split('/')), { force: true, recursive: true });
            registrations.delete(relativePath);
          }
        },
        pollIntervalMs: 10,
        sleep: async () => {
          contentionBarrier.announceLockWaiter();
          await firstCompletion;
        }
      };

      const firstCall = ensureCompilerDepsReady(options, tempRoot);
      void firstCall.then(releaseFirstCompletion, releaseFirstCompletion);
      const secondCall = ensureCompilerDepsReady(options, tempRoot);
      const first = await Promise.all([firstCall, secondCall]);

      expect(installCalls).toBe(1);
      expect(lockWaiterHasArrived).toBe(true);
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
      expect(lifecycleEvents.filter((event) => event.startsWith('born:.tmp/dependency-installs/c.staging-')))
        .toHaveLength(2);
      expect(lifecycleEvents.filter((event) => event.endsWith(':generation-published'))).toHaveLength(2);
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
    }, 'engineering-compiler-dev-deps-');
  });

  test('recovers an installed staging generation only from its durable intent and lifecycle registration', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      const registrations = new Map<string, GeneratedStateRegistration>();
      const lifecycleOutcomes: string[] = [];
      let installCalls = 0;
      let rejectFirstDisposal = true;
      const registration = (
        relativePath: string,
        physical: Readonly<{ device: string; inode: string; objectId: string }>
      ): GeneratedStateRegistration => {
        const registrationId = generatedStateDigest({ relativePath, physical });
        return Object.freeze({
          schema: 'sec-generated-state-registration-v1',
          registrationId,
          repositoryRoot: tempRoot,
          workspace: { device: 'fixture', inode: 'workspace', objectId: 'fixture' },
          ruleId: 'compiler-dependency-staging-generation',
          relativePath,
          root: physical,
          owner: 'compiler-dependency-runtime-owner',
          producer: 'compiler-dependency-generation-staging',
          operationId: `fixture:${relativePath}`,
          phase: 'active',
          retirementRef: null,
          generatedAt: '2026-08-30T00:00:00.000Z',
          registrationDigest: generatedStateDigest({ registrationId, relativePath, physical })
        });
      };
      const lifecycle = {
        born: async (relativePath: string) => {
          const root = inspectNoFollowDirectoryChain(
            path.join(tempRoot, ...relativePath.split('/')),
            'Compiler stage recovery fixture'
          ).target;
          registrations.set(relativePath, registration(relativePath, {
            device: root.device,
            inode: root.inode,
            objectId: generatedStateDigest({ device: root.device, inode: root.inode })
          }));
        },
        bind: async (relativePath: string) => {
          const current = registrations.get(relativePath);
          if (current === undefined) throw new Error(`missing fixture registration: ${relativePath}`);
          return current;
        },
        retired: async () => undefined,
        disposed: async (relativePath: string, outcome: string) => {
          lifecycleOutcomes.push(outcome);
          if (rejectFirstDisposal) {
            rejectFirstDisposal = false;
            throw new Error('fixture disposal interruption');
          }
          await fs.rm(path.join(tempRoot, ...relativePath.split('/')), { recursive: true });
          registrations.delete(relativePath);
        }
      };
      const commandRunner = async (_command: string, _args: string[], options: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(options.cwd, `intent-generation-${installCalls}`);
        return installCalls === 1
          ? { code: 1, stdout: '', stderr: 'fixture install failure' }
          : { code: 0, stdout: 'ok', stderr: '' };
      };

      await expect(ensureCompilerDepsReady({ commandRunner, generatedStateLifecycle: lifecycle }, tempRoot))
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
      await expect(ensureCompilerDepsReady({ commandRunner, generatedStateLifecycle: lifecycle }, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(installCalls).toBe(1);
      await fs.rm(foreignResidue);

      const ready = await ensureCompilerDepsReady({ commandRunner, generatedStateLifecycle: lifecycle }, tempRoot);
      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(lifecycleOutcomes).toContain('generation-staging-recovered');
      expect((await fs.readdir(path.join(tempRoot, '.tmp', 'dependency-installs')))
        .filter((name) => name.startsWith('c.staging-'))).toHaveLength(0);
      expect([...registrations.keys()].filter((value) => value.includes('/c.staging-'))).toHaveLength(0);
    }, 'engineering-compiler-stage-intent-');
  });

  test('retires only registered legacy staging roots and preserves foreign descendants', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const priorStateHome = process.env.SEC_STATE_HOME;
      const priorCacheHome = process.env.SEC_CACHE_HOME;
      const stateHome = path.join(tmpdir(), `sec-stage-state-${path.basename(tempRoot)}`);
      const cacheHome = path.join(tmpdir(), `sec-stage-cache-${path.basename(tempRoot)}`);
      process.env.SEC_STATE_HOME = stateHome;
      process.env.SEC_CACHE_HOME = cacheHome;
      try {
      await writeCompilerDependencyRoot(tempRoot);
      const lifecycle = generatedStateProducerHooks(
        { repositoryRoot: tempRoot },
        { environment: { ...process.env } }
      );
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
      const commandRunner = async (_command: string, _args: string[], options: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(options.cwd, `legacy-retirement-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };

      const ready = await ensureCompilerDepsReady({ commandRunner, generatedStateLifecycle: lifecycle }, tempRoot);
      expect(ready.source).toBe('installed');
      await expect(fs.stat(registeredLegacyStage)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(installCalls).toBe(1);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const foreignLegacyStage = await createLegacyStage('c.staging-legacy-foreign', true);
      await expect(ensureCompilerDepsReady({ commandRunner, generatedStateLifecycle: lifecycle }, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(installCalls).toBe(1);
      expect(await fs.readFile(path.join(foreignLegacyStage, 'foreign-residue'), 'utf8')).toBe('foreign\n');

      await fs.rm(path.join(foreignLegacyStage, 'foreign-residue'));
      await lifecycle.bind(path.relative(tempRoot, foreignLegacyStage).replaceAll('\\', '/'));
      await lifecycle.disposed(
        path.relative(tempRoot, foreignLegacyStage).replaceAll('\\', '/'),
        'fixture-settlement'
      );
      } finally {
        if (priorStateHome === undefined) delete process.env.SEC_STATE_HOME;
        else process.env.SEC_STATE_HOME = priorStateHome;
        if (priorCacheHome === undefined) delete process.env.SEC_CACHE_HOME;
        else process.env.SEC_CACHE_HOME = priorCacheHome;
        await Promise.all([
          fs.rm(stateHome, { force: true, recursive: true }),
          fs.rm(cacheHome, { force: true, recursive: true })
        ]);
      }
    }, 'engineering-compiler-legacy-stage-');
  });

  test('reuses a compatible external physical generation without giving its bridge mutation ownership', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const ownerRoot = path.join(tempRoot, 'owner');
      const consumerRoot = path.join(tempRoot, 'consumer');
      await Promise.all([fs.mkdir(ownerRoot), fs.mkdir(consumerRoot)]);
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
      await ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'shared-owner');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, ownerRoot);
      const bridgePath = path.join(consumerRoot, 'node_modules');
      const generationPath = path.join(ownerRoot, 'node_modules');
      await fs.symlink(generationPath, bridgePath, process.platform === 'win32' ? 'junction' : 'dir');

      const reused = await ensureCompilerDepsReady({
        commandRunner: async () => {
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

      const parkedBridgePath = path.join(consumerRoot, 'node_modules.validated');
      const replacementGenerationPath = path.join(tempRoot, 'replacement', 'node_modules');
      await fs.mkdir(replacementGenerationPath, { recursive: true });
      await expect(ensureCompilerDepsReady({
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
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage !== 'final-binding-observed') return;
          await fs.writeFile(path.join(consumerRoot, 'bun.lock'), 'consumer-drift-during-admission\n');
        }
      }, consumerRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), originalConsumerLock);

      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), 'incompatible-lock\n');
      await expect(ensureCompilerDepsReady({
        commandRunner: async () => {
          throw new Error('Incompatible dependency bridge must not install or replace its target.');
        }
      }, consumerRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(await fs.realpath(bridgePath)).toBe(await fs.realpath(generationPath));
      expect(await fs.readFile(
        path.join(generationPath, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('shared-owner:typescript\n');

      const noConfigOwnerRoot = path.join(tempRoot, 'no-config-owner');
      const testOnlyConsumerRoot = path.join(tempRoot, 'test-only-consumer');
      await Promise.all([fs.mkdir(noConfigOwnerRoot), fs.mkdir(testOnlyConsumerRoot)]);
      await Promise.all([
        writeCompilerDependencyRoot(noConfigOwnerRoot),
        writeCompilerDependencyRoot(testOnlyConsumerRoot),
        fs.writeFile(
          path.join(testOnlyConsumerRoot, 'bunfig.toml'),
          '[test]\npreload = ["consumer.ts"]\n'
        )
      ]);
      await ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
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
      expect((await ensureCompilerDepsReady({
        commandRunner: async () => {
          throw new Error('Absent and non-install-only config must share one identity.');
        }
      }, testOnlyConsumerRoot)).source).toBe('existing');
    }, 'engineering-compiler-dev-deps-bridge-');
  });

  test('automatically reuses and provider-retires the primary worktree locator without touching its generation', async () => {
    await withLinkedWorktreeTempWorkspace(async (tempRoot) => {
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
      await runFixtureGit(ownerRoot, ['commit', '-m', 'fixture']);
      let installCalls = 0;
      await ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'primary-generation');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, ownerRoot);
      await runFixtureGit(ownerRoot, ['worktree', 'add', '-b', 'candidate', consumerRoot]);

      let failLifecycleBinding = true;
      const reuseOptions = {
        commandRunner: async () => {
          throw new Error('Exact linked-worktree reuse must not download or install dependencies.');
        },
        generatedStateLifecycle: {
          born: async () => {
            if (failLifecycleBinding) throw new Error('fixture lifecycle interruption');
          },
          bind: async (_relativePath: string, expected?: Readonly<{
            owner?: string;
            producer?: string;
            ruleId?: string;
            physical?: Readonly<{ device: string; inode: string; objectId: string }>;
          }>) => {
            if (failLifecycleBinding) throw new Error('fixture lifecycle interruption');
            return Object.freeze({
              schema: 'sec-generated-state-registration-v1' as const,
              registrationId: generatedStateDigest({ schema: 'fixture-registration-id-v1' }),
              repositoryRoot: ownerRoot,
              workspace: { device: 'fixture', inode: 'workspace', objectId: 'fixture' },
              ruleId: expected?.ruleId ?? 'compiler-node-modules',
              relativePath: 'node_modules',
              root: expected?.physical ?? { device: 'fixture', inode: 'root', objectId: 'fixture' },
              owner: expected?.owner ?? 'compiler-dependency-runtime',
              producer: expected?.producer ?? 'ensure-compiler-deps-ready',
              operationId: 'fixture:linked-worktree',
              phase: 'active' as const,
              retirementRef: null,
              generatedAt: '2026-08-28T00:00:00.000Z',
              registrationDigest: generatedStateDigest({ schema: 'fixture-registration-v1' })
            });
          },
          retired: async () => undefined,
          disposed: async () => undefined
        }
      };
      await expect(ensureCompilerDepsReady(reuseOptions, consumerRoot))
        .rejects.toThrow('fixture lifecycle interruption');
      expect(await fs.realpath(path.join(consumerRoot, 'node_modules')))
        .toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      failLifecycleBinding = false;
      const ready = await ensureCompilerDepsReady(reuseOptions, consumerRoot);

      expect(ready).toMatchObject({ root: consumerRoot, source: 'existing' });
      expect(installCalls).toBe(1);
      expect(await fs.realpath(path.join(consumerRoot, 'node_modules')))
        .toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      expect(await fs.readFile(
        path.join(consumerRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation:typescript\n');

      const consumer = inspectNoFollowDirectoryChain(consumerRoot, 'Fixture consumer').target;
      const locator = inspectNoFollowLinkEntry(consumer, 'node_modules');
      expect(locator).not.toBeNull();
      const source = Object.freeze({
        device: locator!.device,
        inode: locator!.inode,
        objectId: generatedStateDigest({ kind: 'link', target: locator!.linkTarget })
      });
      const registration: GeneratedStateRegistration = Object.freeze({
        schema: 'sec-generated-state-registration-v1',
        registrationId: `sha256:${'1'.repeat(64)}`,
        repositoryRoot: ownerRoot,
        workspace: { device: consumer.device, inode: consumer.inode, objectId: consumer.objectId },
        ruleId: 'compiler-node-modules',
        relativePath: 'node_modules',
        root: source,
        owner: 'compiler-dependency-runtime',
        producer: 'ensure-compiler-deps-ready',
        operationId: 'fixture-operation',
        phase: 'retired',
        retirementRef: `sha256:${'2'.repeat(64)}`,
        generatedAt: '2026-08-23T00:00:00.000Z',
        registrationDigest: `sha256:${'3'.repeat(64)}`
      });
      const staleConsumerManifest = JSON.parse(
        await fs.readFile(path.join(consumerRoot, 'package.json'), 'utf8')
      ) as Record<string, unknown>;
      await fs.writeFile(path.join(consumerRoot, 'package.json'), `${JSON.stringify({
        ...staleConsumerManifest,
        description: 'consumer inputs changed after the external generation was linked'
      }, null, 2)}\n`);
      const providerPlan = await compilerDependencyLocatorWorktreeRetirementProvider.plan({
        repositoryRoot: ownerRoot,
        workspaceRoot: consumerRoot,
        relativePath: 'node_modules',
        source,
        registration
      });
      const parkedConsumerRoot = path.join(tempRoot, 'candidate-planned');
      const replacementConsumerRoot = consumerRoot;
      await fs.rename(consumerRoot, parkedConsumerRoot);
      await fs.mkdir(replacementConsumerRoot);
      for (const name of ['package.json', 'bun.lock', '.bun-version']) {
        await fs.copyFile(path.join(parkedConsumerRoot, name), path.join(replacementConsumerRoot, name));
      }
      await fs.rename(
        path.join(parkedConsumerRoot, 'node_modules'),
        path.join(replacementConsumerRoot, 'node_modules')
      );
      await expect(compilerDependencyLocatorWorktreeRetirementProvider.retire({
        operationId: `sha256:${'4'.repeat(64)}`,
        repositoryRoot: ownerRoot,
        workspaceRoot: replacementConsumerRoot,
        relativePath: 'node_modules',
        source,
        registration,
        planBytes: providerPlan.bytes,
        planDigest: providerPlan.digest
      })).rejects.toThrow('consumer root identity changed');
      expect((await fs.lstat(path.join(replacementConsumerRoot, 'node_modules'))).isSymbolicLink()).toBeTrue();
      expect(await fs.readFile(
        path.join(ownerRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation:typescript\n');
      await fs.rename(
        path.join(replacementConsumerRoot, 'node_modules'),
        path.join(parkedConsumerRoot, 'node_modules')
      );
      await fs.rm(replacementConsumerRoot, { recursive: true });
      await fs.rename(parkedConsumerRoot, consumerRoot);
      const parkedLocator = path.join(consumerRoot, 'node_modules.planned');
      const replacementGeneration = path.join(tempRoot, 'replacement-generation', 'node_modules');
      await fs.mkdir(replacementGeneration, { recursive: true });
      await fs.rename(path.join(consumerRoot, 'node_modules'), parkedLocator);
      await fs.symlink(
        replacementGeneration,
        path.join(consumerRoot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      await expect(compilerDependencyLocatorWorktreeRetirementProvider.retire({
        operationId: `sha256:${'4'.repeat(64)}`,
        repositoryRoot: ownerRoot,
        workspaceRoot: consumerRoot,
        relativePath: 'node_modules',
        source,
        registration,
        planBytes: providerPlan.bytes,
        planDigest: providerPlan.digest
      })).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(await fs.realpath(path.join(consumerRoot, 'node_modules'))).toBe(await fs.realpath(replacementGeneration));
      await fs.unlink(path.join(consumerRoot, 'node_modules'));
      await fs.rename(parkedLocator, path.join(consumerRoot, 'node_modules'));
      const providerReceipt = await compilerDependencyLocatorWorktreeRetirementProvider.retire({
        operationId: `sha256:${'4'.repeat(64)}`,
        repositoryRoot: ownerRoot,
        workspaceRoot: consumerRoot,
        relativePath: 'node_modules',
        source,
        registration,
        planBytes: providerPlan.bytes,
        planDigest: providerPlan.digest
      });
      expect(JSON.parse(providerReceipt.bytes)).toMatchObject({ outcome: 'removed' });
      await expect(fs.lstat(path.join(consumerRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(
        path.join(ownerRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation:typescript\n');
      const resumedReceipt = await compilerDependencyLocatorWorktreeRetirementProvider.retire({
        operationId: `sha256:${'4'.repeat(64)}`,
        repositoryRoot: ownerRoot,
        workspaceRoot: consumerRoot,
        relativePath: 'node_modules',
        source,
        registration,
        planBytes: providerPlan.bytes,
        planDigest: providerPlan.digest
      });
      expect(JSON.parse(resumedReceipt.bytes)).toMatchObject({ outcome: 'resumed-absent' });
    });
  });

  test('retires one exact stale worktree generation before publishing a shared locator', async () => {
    await withLinkedWorktreeTempWorkspace(async (tempRoot) => {
      const { consumerRoot, ownerRoot } = await prepareLinkedWorktreeEpochTransition(tempRoot);
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const staleIdentity = await fs.lstat(consumerNodeModules, { bigint: true });
      const ready = await ensureCompilerDepsReady({
        commandRunner: async () => {
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
      expect(backups).toHaveLength(1);
      const retiredIdentity = await fs.lstat(path.join(backupsRoot, backups[0]!), { bigint: true });
      expect({ dev: retiredIdentity.dev, ino: retiredIdentity.ino, mode: retiredIdentity.mode })
        .toEqual({ dev: staleIdentity.dev, ino: staleIdentity.ino, mode: staleIdentity.mode });
      expect(await fs.readFile(
        path.join(backupsRoot, backups[0]!, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('candidate-generation-v1:typescript\n');

      const admittedByFreshProcess = await ensureCompilerDepsReady({}, consumerRoot);
      expect(admittedByFreshProcess.requiresFreshProcess).toBeFalse();
      expect(admittedByFreshProcess.transitionDigest).not.toBe(ready.transitionDigest);
    });
  });

  test('preserves an unknown physical worktree dependency directory instead of claiming it', async () => {
    await withLinkedWorktreeTempWorkspace(async (tempRoot) => {
      const { consumerRoot } = await prepareLinkedWorktreeEpochTransition(tempRoot);
      const ownedGeneration = path.join(consumerRoot, 'node_modules.owned-fixture');
      const unknownGeneration = path.join(consumerRoot, 'node_modules');
      await fs.rename(unknownGeneration, ownedGeneration);
      await fs.mkdir(unknownGeneration);
      await fs.writeFile(path.join(unknownGeneration, 'user-sentinel.txt'), 'preserve-me\n');

      await expect(ensureCompilerDepsReady({
        commandRunner: async () => {
          throw new Error('Unknown physical state must not trigger install.');
        }
      }, consumerRoot)).rejects.toMatchObject({
        code: 'IMPORT-AUTHORITY-004',
        message: expect.stringContaining('not an owned compiler dependency generation')
      });
      expect((await fs.lstat(unknownGeneration)).isDirectory()).toBeTrue();
      expect(await fs.readFile(path.join(unknownGeneration, 'user-sentinel.txt'), 'utf8')).toBe('preserve-me\n');
      expect((await fs.lstat(ownedGeneration)).isDirectory()).toBeTrue();
    });
  });

  test('restores the exact stale generation when locator validation fails before ownership binding', async () => {
    await withLinkedWorktreeTempWorkspace(async (tempRoot) => {
      const { consumerRoot } = await prepareLinkedWorktreeEpochTransition(tempRoot);
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const staleIdentity = await fs.lstat(consumerNodeModules, { bigint: true });

      await expect(ensureCompilerDepsReady({
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
  });

  test('preserves an external replacement and emits recovery evidence when locator rollback loses CAS', async () => {
    await withLinkedWorktreeTempWorkspace(async (tempRoot) => {
      const { consumerRoot } = await prepareLinkedWorktreeEpochTransition(tempRoot);
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const displacedLocator = path.join(consumerRoot, 'node_modules.displaced-locator');
      let replacementCreated = false;

      const failure = await ensureCompilerDepsReady({
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
    });
  });

  test('repairs critical direct and transitive entry corruption before developer commands load dependencies', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const options = {
        commandRunner: async (_command: string, _args: string[], command: { cwd: string }) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      };
      await ensureCompilerDepsReady(options, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', '@ts-morph', 'common', 'dist', 'ts-morph-common.js');
      await fs.writeFile(entryPath, 'corrupt\n');

      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-2:@ts-morph/common\n');
    }, 'engineering-compiler-dev-deps-corruption-');
  });

  test('preserves the active generation when materialization or atomic publish fails', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const stagingRoots: string[] = [];
      const commandRunner = async (_command: string, _args: string[], command: { cwd: string }) => {
        installCalls += 1;
        stagingRoots.push(command.cwd);
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { commandRunner };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
      const bindingPath = path.join(tempRoot, 'node_modules', '.sec-compiler-deps-binding-v5.json');
      const originalEntry = await fs.readFile(entryPath);
      const originalBinding = await fs.readFile(bindingPath);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let failedInstallRoot: string | null = null;
      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        commandRunner: async (_command, _args, command) => {
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
    }, 'engineering-compiler-dev-deps-rollback-');
  });

  test('rolls back a prepared historical transition when its unpublished stage is already absent', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      let stagedRoot: string | null = null;
      const commandRunner = async (_command: string, _args: string[], command: { cwd: string }) => {
        installCalls += 1;
        stagedRoot = command.cwd;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      await ensureCompilerDepsReady({ commandRunner }, tempRoot);
      const originalEntry = await fs.readFile(path.join(
        tempRoot,
        'node_modules',
        'typescript',
        'lib',
        'typescript.js'
      ));

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      await expect(ensureCompilerDepsReady({
        commandRunner,
        testCompilerRename: async (source, target) => {
          if (path.resolve(source) === path.join(tempRoot, 'node_modules')) {
            await fs.rm(stagedRoot!, { recursive: true });
            const interruption = new Error('historical process loss before preimage move') as NodeJS.ErrnoException;
            interruption.code = 'ENOTEMPTY';
            throw interruption;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(installCalls).toBe(2);
      expect(stagedRoot).not.toBeNull();
      await expect(fs.stat(stagedRoot!)).rejects.toMatchObject({ code: 'ENOENT' });

      // Reproduce the exact pre-intent durable state: the immutable
      // compiler-generation journal remains prepared, while the unpublished
      // stage and its newer intent namespace are absent. The unchanged
      // preimage must be accepted only as a zero-install rollback.
      await fs.rm(path.join(
        tempRoot,
        '.tmp',
        'dependency-installs',
        '.compiler-stage-intents-v1'
      ), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v1\n');
      let recoveryInstalls = 0;
      const recovered = await ensureCompilerDepsReady({
        commandRunner: async () => {
          recoveryInstalls += 1;
          throw new Error('journal-only rollback must not install');
        }
      }, tempRoot);
      expect(recovered.source).toBe('existing');
      expect(recoveryInstalls).toBe(0);
      expect(await fs.readFile(path.join(
        tempRoot,
        'node_modules',
        'typescript',
        'lib',
        'typescript.js'
      ))).toEqual(originalEntry);
    }, 'engineering-compiler-dev-deps-prepared-stage-absent-');
  }, 30_000);

  test('retries only bounded Windows transient generation renames and preserves the exact source identity', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const commandRunner = async (_command: string, _args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { commandRunner };
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
    }, 'engineering-compiler-dev-deps-windows-rename-retry-');
  });

  test('fails closed and restores the active generation when a transient rename changes source identity', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const commandRunner = async (_command: string, _args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { commandRunner };
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
    }, 'engineering-compiler-dev-deps-windows-rename-identity-');
  });

  test('does not retry a non-transient compiler generation rename failure', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const commandRunner = async (_command: string, _args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { commandRunner };
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
    }, 'engineering-compiler-dev-deps-non-transient-rename-');
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

  test('aborts compiler lock waiting without spawning or replacing the live owner', async () => {
    await withTempWorkspace(async (tempRoot) => {
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
        commandRunner: async () => {
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
    }, 'engineering-compiler-dev-deps-lock-abort-');
  });

  test('gives the compiler command only the operation budget remaining after lock contention', async () => {
    await withTempWorkspace(async (tempRoot) => {
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
        commandRunner: async (_command, _args, command) => {
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
    }, 'engineering-compiler-dev-deps-budget-narrowing-');
  });

  test('removes its exact compiler lock even when the final caller fence rejects', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'cleanup-fence');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);

      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      let lifecycleBound = false;
      await expect(ensureCompilerDepsReady({
        beforeCommit: async () => {
          if (lifecycleBound) throw new Error('fixture final cleanup fence rejected');
        },
        generatedStateLifecycle: {
          born: async () => undefined,
          bind: async (relativePath, expected) => {
            lifecycleBound = true;
            const registrationId = generatedStateDigest({ relativePath, schema: 'cleanup-fence-id-v1' });
            return Object.freeze({
              schema: 'sec-generated-state-registration-v1' as const,
              registrationId,
              repositoryRoot: tempRoot,
              workspace: { device: 'fixture', inode: 'workspace', objectId: 'fixture' },
              ruleId: expected?.ruleId ?? 'compiler-node-modules',
              relativePath,
              root: expected?.physical ?? { device: 'fixture', inode: 'root', objectId: 'fixture' },
              owner: expected?.owner ?? 'compiler-dependency-runtime',
              producer: expected?.producer ?? 'ensure-compiler-deps-ready',
              operationId: 'fixture:cleanup-fence',
              phase: 'active' as const,
              retirementRef: null,
              generatedAt: '2026-08-28T00:00:00.000Z',
              registrationDigest: generatedStateDigest({ registrationId, schema: 'cleanup-fence-v1' })
            });
          },
          retired: async () => undefined,
          disposed: async () => undefined
        }
      }, tempRoot)).rejects.toThrow('fixture final cleanup fence rejected');

      expect(lifecycleBound).toBe(true);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-dev-deps-cleanup-fence-');
  });

  test('retries only the same Windows compiler lock identity and proves final absence', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let deleteAttempts = 0;
      const ready = await ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
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
    }, 'engineering-compiler-lock-delete-retry-');
  });

  test('preserves a replacement Windows compiler lock after a transient deletion failure', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      let replaced = false;
      await expect(ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
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
    }, 'engineering-compiler-lock-delete-replacement-');
  });

  test('reports an unknown Windows lock settlement when the operation deadline expires', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      let monotonicNowMs = 0;
      await expect(ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
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
    }, 'engineering-compiler-lock-delete-deadline-');
  });

  test('reclaims a dead compiler install owner instead of timing out future development', async () => {
    await withTempWorkspace(async (tempRoot) => {
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
        commandRunner: async (_command, _args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'recovered');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        lockTimeoutMs: 1000,
        pollIntervalMs: 10,
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(1);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-dev-deps-orphan-');
  });
});
