import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative: string) => JSON.stringify(path.join(repo, relative));

// Keep provider fault injection in a child so mocked physical providers cannot
// affect other tests. Exercise the production preparation entry, not a test export.
for (const fault of ['package-acquire', 'lock-acquire', 'lock-acquire-and-dispose', 'read', 'read-and-dispose', 'undefined-read'] as const) {
  test(`frozen release controls settle owned handles after ${fault}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-release-control-lifetime-'));
    try {
      const script = path.join(root, 'case.ts');
      await writeFile(script, `
        import assert from 'node:assert/strict';
        import { mock } from 'bun:test';
        const fault = ${JSON.stringify(fault)};
        const primary = fault === 'undefined-read' ? undefined : Object.freeze({ fault });
        const lockCleanup = Object.freeze({ cleanup: 'lock' });
        const packageCleanup = Object.freeze({ cleanup: 'package' });
        const events = [];
        const physicalPath = ${source('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')};
        const physical = await import(physicalPath);
        const runtimePath = ${source('src/adapters/toolchain/runtime.ts')};
        const runtime = await import(runtimePath);
        const sourcePath = ${source('src/adapters/release/release-git-tree-source.ts')};
        const sourceProvider = await import(sourcePath);
        const packageBytes = Buffer.from(JSON.stringify({ version: '1.0.0',
          source: './src/entry.ts', bin: { fixture: './dist/index.js' },
          scripts: { fixture: runtime.PACKAGE_SOURCE_LAUNCHER_SCRIPT },
          packageManager: 'bun@' + Bun.version, dependencies: {} }));
        mock.module(runtimePath, () => ({ ...runtime, loadCanonicalBunRuntimeVersion: async () => Bun.version }));
        mock.module(sourcePath, () => ({ ...sourceProvider,
          materializeExactReleaseGitTree: async () => ({ root: '/frozen', stageRoot: '/stage', sourceCommit: 'a', sourceTree: 'b' }),
          disposeExactReleaseGitTree: async () => { events.push('dispose-stage'); }
        }));
        mock.module(physicalPath, () => ({ ...physical,
          retainCurrentProcessExecutable: () => ({
            digest: () => ({ byteDigest: 'sha256:' + 'a'.repeat(64) }),
            assertCurrent() {}, dispose() {}
          }),
          inspectNoFollowDirectoryChain: () => ({ target: { path: '/frozen' } }),
          inspectNoFollowOrdinaryFileEntry: () => ({ device: '1', inode: '1' }),
          retainNoFollowOrdinaryFile: (_parent, name, _identity, label) => {
            const dependency = label.startsWith('Frozen dependency');
            if (dependency) {
              events.push('acquire-' + name);
              if ((fault === 'package-acquire' && name === 'package.json') ||
                  (fault.startsWith('lock-acquire') && name === 'bun.lock')) throw primary;
            }
            return {
              readBytes() {
                if (dependency) throw primary;
                return name === 'package.json' ? packageBytes : Buffer.from('{}');
              },
              assertCurrent() {},
              dispose() {
                if (!dependency) return;
                events.push('dispose-' + name);
                if (fault.endsWith('and-dispose')) throw name === 'bun.lock' ? lockCleanup : packageCleanup;
              }
            };
          }
        }));
        const { prepareFrozenReleaseSource } = await import(${source('src/adapters/release/release-source-materialization.ts')});
        // Repeat in the same module instance to detect leaked shared ownership.
        for (let invocation = 0; invocation < 2; invocation++) {
          events.length = 0;
          let caught = false;
          try { await prepareFrozenReleaseSource('/borrowed-repository'); }
          catch (error) {
            caught = true;
            if (fault === 'lock-acquire-and-dispose') {
              assert.deepEqual(error.errors, [primary, packageCleanup]);
            } else if (fault === 'read-and-dispose') {
              assert.deepEqual(error.errors, [primary, lockCleanup, packageCleanup]);
              assert.deepEqual(error.failures.map(f => f.label), [
                'frozen dependency materialization',
                'frozen dependency bun.lock dispose',
                'frozen dependency package.json dispose'
              ]);
            } else assert.equal(error, primary);
          }
          assert.equal(caught, true);
          const expected = fault === 'package-acquire'
            ? ['acquire-package.json', 'dispose-stage']
            : fault.startsWith('lock-acquire')
              ? ['acquire-package.json', 'acquire-bun.lock', 'dispose-package.json', 'dispose-stage']
              : ['acquire-package.json', 'acquire-bun.lock', 'dispose-bun.lock', 'dispose-package.json', 'dispose-stage'];
          assert.deepEqual(events, expected);
        }
        console.log('owned controls settled');
      `);
      const child = Bun.spawn([process.execPath, script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
      ]);
      expect(code, stderr).toBe(0);
      expect(stdout.trim()).toBe('owned controls settled');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
