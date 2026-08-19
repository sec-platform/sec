import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from '../../platform/shared/fs.ts';
import { ensureCompilerDepsReady } from '../../platform/shared/project-runtime.ts';
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
      const options = { commandRunner, pollIntervalMs: 10 };

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
        formatVersion: 'compiler-deps-binding-v4'
      });
      expect(binding).not.toHaveProperty('packageManifestSha256');
      expect(binding).not.toHaveProperty('packageSourceSha256');
    }, 'engineering-compiler-dev-deps-');
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
