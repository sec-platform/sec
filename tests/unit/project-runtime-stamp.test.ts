import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureCompilerDepsReady } from '../../platform/shared/project-runtime.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

interface FixturePackage {
  readonly main?: string;
  readonly name: string;
  readonly version: string;
}

async function installCompilerDependencyFixture(workingDirectory: string, marker: string): Promise<void> {
  const packages: readonly FixturePackage[] = [
    { name: 'commander', version: '1.0.0' },
    { main: 'dist/ts-morph-common.js', name: '@ts-morph/common', version: '1.0.0' },
    { main: './script/mod.js', name: 'code-block-writer', version: '1.0.0' },
    { main: 'dist/ts-morph.js', name: 'ts-morph', version: '1.0.0' },
    { main: './lib/typescript.js', name: 'typescript', version: '1.0.0' }
  ];
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
  bunVersion = '1.3.6'
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

describe('ensureCompilerDepsReady stamp file', () => {
  test('creates a stamp after the first call and short-circuits identity recomputation', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const commandRunner = async (
        _command: string,
        _args: string[],
        command: { cwd: string }
      ): Promise<{ code: number; stdout: string; stderr: string }> => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const options = { commandRunner, runtimeVersion: '1.3.6' };

      // First call installs dependencies and writes the stamp.
      const first = await ensureCompilerDepsReady(options, tempRoot);
      expect(first.source).toBe('installed');
      expect(installCalls).toBe(1);

      // Stamp file is created at the canonical path with cachedIdentity.
      const stampPath = path.join(tempRoot, '.tmp', 'compiler-deps.stamp.json');
      const stamp = JSON.parse(await fs.readFile(stampPath, 'utf8')) as {
        packageJsonMtimeMs: number;
        bunLockMtimeMs: number;
        packageJsonSize: number;
        bunLockSize: number;
        cachedIdentity: {
          architecture: string;
          bunVersion: string;
          declaredBunVersion: string;
          manifestHash: string;
          packageNames: string[];
          packageVersions: Record<string, string>;
          platform: string;
        };
        lastReadyState: { source: string };
      };
      expect(typeof stamp.packageJsonMtimeMs).toBe('number');
      expect(typeof stamp.bunLockMtimeMs).toBe('number');
      expect(typeof stamp.packageJsonSize).toBe('number');
      expect(typeof stamp.bunLockSize).toBe('number');
      expect(stamp.cachedIdentity.bunVersion).toBe('1.3.6');
      expect(typeof stamp.cachedIdentity.architecture).toBe('string');
      expect(stamp.cachedIdentity.architecture.length).toBeGreaterThan(0);
      expect(typeof stamp.cachedIdentity.platform).toBe('string');
      expect(stamp.cachedIdentity.platform.length).toBeGreaterThan(0);
      expect(typeof stamp.cachedIdentity.manifestHash).toBe('string');
      expect(Array.isArray(stamp.cachedIdentity.packageNames)).toBe(true);
      expect(stamp.lastReadyState.source).toBe('existing');

      // Second call hits the stamp: skips compilerDependencyIdentity but still
      // runs compilerDependencyTreeReady to verify node_modules integrity.
      // No corruption → returns cached 'existing' state without re-installing.
      const second = await ensureCompilerDepsReady(options, tempRoot);
      expect(second.source).toBe('existing');
      expect(installCalls).toBe(1);

      // Corrupt a node_modules package.json. The stamp still matches (package.json
      // and bun.lock are unchanged), but compilerDependencyTreeReady now detects
      // the corruption and triggers a re-install.
      await fs.writeFile(
        path.join(tempRoot, 'node_modules', 'typescript', 'package.json'),
        'corrupt\n',
        'utf8'
      );

      // Third call: stamp hits but integrity check fails → re-installs.
      const third = await ensureCompilerDepsReady(options, tempRoot);
      expect(third.source).toBe('installed');
      expect(installCalls).toBe(2);
    }, 'engineering-compiler-stamp-');
  });

  test('invalidates the stamp when the runtime architecture changes', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const commandRunner = async (
        _command: string,
        _args: string[],
        command: { cwd: string }
      ): Promise<{ code: number; stdout: string; stderr: string }> => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };

      // First call with x64 architecture installs and writes the stamp with
      // cachedIdentity.architecture = 'x64'.
      const first = await ensureCompilerDepsReady(
        { commandRunner, runtimeVersion: '1.3.6', runtimeArchitecture: 'x64' },
        tempRoot
      );
      expect(first.source).toBe('installed');
      expect(installCalls).toBe(1);

      // Second call with the same architecture hits the stamp, verifies
      // integrity via compilerDependencyTreeReady, and returns 'existing'.
      const second = await ensureCompilerDepsReady(
        { commandRunner, runtimeVersion: '1.3.6', runtimeArchitecture: 'x64' },
        tempRoot
      );
      expect(second.source).toBe('existing');
      expect(installCalls).toBe(1);

      // Third call with a different architecture misses the stamp (runtime
      // identity mismatch), falls through to full validation where the binding
      // file's architecture doesn't match, and re-installs.
      const third = await ensureCompilerDepsReady(
        { commandRunner, runtimeVersion: '1.3.6', runtimeArchitecture: 'arm64' },
        tempRoot
      );
      expect(third.source).toBe('installed');
      expect(installCalls).toBe(2);
    }, 'engineering-compiler-stamp-runtime-');
  });
});
