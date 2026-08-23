import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from '../../platform/shared/fs.ts';
import {
  generatedStateDigestV1,
  type GeneratedStateRegistrationV1
} from '../../platform/shared/generated-state-contract.ts';
import {
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowLinkEntryV1
} from '../../platform/shared/physical-no-follow.ts';
import { runCommand } from '../../platform/shared/process.ts';
import {
  compilerDependencyLocatorWorktreeRetirementProviderV1,
  ensureCompilerDepsReady
} from '../../platform/shared/project-runtime.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
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

describe('compiler dependency installation', () => {
  test('serializes immutable generations and invalidates the binding on lockfile or runtime changes', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const stagingRoots = new Set<string>();
      const lifecycleEvents: string[] = [];
      const commandRunner = async (_command: string, args: string[], options: { cwd: string }) => {
        installCalls += 1;
        expect(args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts']);
        expect(options.cwd).not.toBe(tempRoot);
        const stagingName = path.basename(options.cwd);
        expect(stagingName.startsWith('c.staging-')).toBe(true);
        expect(stagingName.length).toBe('c.staging-'.length + 6);
        expect(path.dirname(options.cwd)).toBe(path.join(tempRoot, '.tmp', 'dependency-installs'));
        stagingRoots.add(options.cwd);
        await new Promise((resolve) => setTimeout(resolve, 50));
        await installCompilerDependencyFixture(options.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const options = {
        commandRunner,
        generatedStateLifecycle: {
          born: async (relativePath: string) => {
            lifecycleEvents.push(`born:${relativePath}`);
          },
          retired: async () => undefined,
          disposed: async (relativePath: string, outcome: string) => {
            lifecycleEvents.push(`disposed:${relativePath}:${outcome}`);
            await fs.rm(path.join(tempRoot, ...relativePath.split('/')), { force: true, recursive: true });
          }
        },
        pollIntervalMs: 10
      };

      const first = await Promise.all([
        ensureCompilerDepsReady(options, tempRoot),
        ensureCompilerDepsReady(options, tempRoot)
      ]);

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
      expect(lifecycleEvents.filter((event) => event.startsWith('born:.tmp/dependency-installs/c.staging-')))
        .toHaveLength(2);
      expect(lifecycleEvents.filter((event) => event.endsWith(':generation-published'))).toHaveLength(2);
      for (const stagingRoot of stagingRoots) {
        await expect(fs.stat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      }
      const binding = await readJson<Record<string, unknown>>(path.join(
        tempRoot,
        'node_modules',
        '.sec-compiler-deps-binding-v4.json'
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
    await withTempWorkspace(async (tempRoot) => {
      const ownerRoot = path.join(tempRoot, 'repository');
      const consumerRoot = path.join(tempRoot, 'candidate');
      await fs.mkdir(ownerRoot);
      const git = async (cwd: string, args: string[]): Promise<string> => {
        const result = await runCommand('git', args, { cwd, timeoutMs: 10_000 });
        if (result.code !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
      };
      await git(ownerRoot, ['init', '-b', 'main']);
      await git(ownerRoot, ['config', 'user.email', 'sec@example.invalid']);
      await git(ownerRoot, ['config', 'user.name', 'SEC Test']);
      await git(ownerRoot, ['config', 'core.autocrlf', 'false']);
      await writeCompilerDependencyRoot(ownerRoot);
      await fs.writeFile(path.join(ownerRoot, '.gitignore'), 'node_modules/\n.tmp/\n');
      await git(ownerRoot, ['add', '.gitignore', '.bun-version', 'bun.lock', 'package.json']);
      await git(ownerRoot, ['commit', '-m', 'fixture']);
      let installCalls = 0;
      await ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'primary-generation');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, ownerRoot);
      await git(ownerRoot, ['worktree', 'add', '-b', 'candidate', consumerRoot]);

      let failLifecycleBinding = true;
      const reuseOptions = {
        commandRunner: async () => {
          throw new Error('Exact linked-worktree reuse must not download or install dependencies.');
        },
        generatedStateLifecycle: {
          born: async () => {
            if (failLifecycleBinding) throw new Error('fixture lifecycle interruption');
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

      const consumer = inspectNoFollowDirectoryChainV1(consumerRoot, 'Fixture consumer').target;
      const locator = inspectNoFollowLinkEntryV1(consumer, 'node_modules');
      expect(locator).not.toBeNull();
      const source = Object.freeze({
        device: locator!.device,
        inode: locator!.inode,
        objectId: generatedStateDigestV1({ kind: 'link', target: locator!.linkTarget })
      });
      const registration: GeneratedStateRegistrationV1 = Object.freeze({
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
      const providerPlan = await compilerDependencyLocatorWorktreeRetirementProviderV1.plan({
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
      await expect(compilerDependencyLocatorWorktreeRetirementProviderV1.retire({
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
      await expect(compilerDependencyLocatorWorktreeRetirementProviderV1.retire({
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
      const providerReceipt = await compilerDependencyLocatorWorktreeRetirementProviderV1.retire({
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
      const resumedReceipt = await compilerDependencyLocatorWorktreeRetirementProviderV1.retire({
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
    }, 'engineering-compiler-linked-worktree-reuse-');
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
      const bindingPath = path.join(tempRoot, 'node_modules', '.sec-compiler-deps-binding-v4.json');
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
