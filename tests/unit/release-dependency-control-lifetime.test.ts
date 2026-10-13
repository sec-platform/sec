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

test('release public entries preserve body and cleanup failures for every retained capability', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-release-single-control-lifetime-'));
  try {
    const script = path.join(root, 'case.ts');
    await writeFile(script, `
      import assert from 'node:assert/strict';
      import { mock } from 'bun:test';
      const physicalPath = ${source('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts')};
      const physical = await import(physicalPath);
      const runtimePath = ${source('src/adapters/toolchain/runtime.ts')};
      const runtime = await import(runtimePath);
      const sourcePath = ${source('src/adapters/release/release-git-tree-source.ts')};
      const sourceProvider = await import(sourcePath);
      const processPath = ${source('src/adapters/runtime-state/physical/runtime/process.ts')};
      const processProvider = await import(processPath);
      const sessionPath = ${source('src/adapters/runtime-state/physical/runtime/process-resource-session.ts')};
      const sessionProvider = await import(sessionPath);
      const directory = { path: '/frozen', device: '1', inode: '1', objectId: 'fixture-source' };
      const executableDigest = 'sha256:' + 'a'.repeat(64);
      const packageBytes = Buffer.from(JSON.stringify({ version: '1.0.0',
        source: './src/entry.ts', bin: { fixture: './dist/index.js' },
        scripts: { fixture: runtime.PACKAGE_SOURCE_LAUNCHER_SCRIPT },
        packageManager: 'bun@' + Bun.version, dependencies: {} }));
      let phase, bodyFails, cleanupFails, primary, cleanup;
      let events = [], commandCompleted = false;
      const body = (selected) => { if (phase === selected && bodyFails) throw primary; };
      const release = (selected) => {
        events.push('dispose-' + selected);
        if (phase === selected && cleanupFails) throw cleanup;
      };
      mock.module(runtimePath, () => ({ ...runtime, loadCanonicalBunRuntimeVersion: async () => Bun.version }));
      mock.module(sourcePath, () => ({ ...sourceProvider,
        materializeExactReleaseGitTree: async () => ({ root: '/frozen', stageRoot: '/stage', sourceCommit: 'a', sourceTree: 'b' }),
        disposeExactReleaseGitTree: async () => { events.push('dispose-stage'); }
      }));
      // Synthetic provider values exercise failure/lifetime composition only;
      // they neither issue physical authority nor prove a real process settled.
      mock.module(processPath, () => ({ ...processProvider, issueRetainedCommandBoundary: () => ({}) }));
      mock.module(sessionPath, () => ({ ...sessionProvider,
        assertProcessResourceSessionReceipt() { if (phase === 'receipt' && cleanupFails) throw cleanup; },
        openProcessResourceSession: () => ({
          async run() {
            body('command'); body('receipt');
            commandCompleted = true;
            return { result: { code: phase === 'command-exit' ? 1 : 0, stdout: '', stderr: 'fixture failure' } };
          },
          close() {
            release(phase === 'command-exit' ? 'command-exit' : 'command');
            const count = commandCompleted ? 1 : 0;
            return { processCount: count, settledProcessCount: count, successfulProcessRecordCount: count, inputBytes: 0, outputBytes: 0 };
          }
        })
      }));
      mock.module(physicalPath, () => ({ ...physical,
        retainCurrentProcessExecutable: (_descriptor, label) => ({
          path: '/fixture-bun', parent: directory, physical: { device: '1', inode: '1' }, size: 1,
          digest() { if (label === 'Release Bun executable identity') body('identity'); return { byteDigest: executableDigest }; },
          assertCurrent() {},
          dispose() { release(label === 'Release Bun executable identity' ? 'identity' : 'executable'); }
        }),
        inspectNoFollowDirectoryChain: () => ({ target: directory, ancestors: [directory] }),
        assertSameNoFollowDirectoryIdentity: () => ({ target: directory, ancestors: [directory] }),
        inspectNoFollowOrdinaryFileEntry: (_parent, name) => ({ device: '1', inode: '1',
          bytes: Buffer.from(name === '.bun-version' ? Bun.version + '\\n' : 'export {};') }),
        retainNoFollowDirectoryForChildProcess: () => ({ dispose() { release('directory'); } }),
        retainNoFollowOrdinaryFile: (_parent, name, _identity, label) => ({
          readBytes() {
            if (label === 'Frozen package.json') body('control');
            return name === 'package.json' ? packageBytes
              : name === '.sec-release-build-metafile.json' ? Buffer.from('{"inputs":{}}') : Buffer.from('{}');
          },
          assertCurrent() {},
          dispose() { release(label === 'Frozen package.json' ? 'control' : name); }
        }),
        retainNoFollowFileTransaction: () => ({
          async createExclusive() { body('marker'); return { bytes: Buffer.from(Bun.version + '\\n') }; },
          dispose() { release('marker'); }
        })
      }));
      const { prepareFrozenReleaseSource, buildFrozenReleaseBundle } = await import(${source('src/adapters/release/release-source-materialization.ts')});
      const frozen = { root: '/frozen', dependencies: [],
        entrypoint: { source: 'src/entry.ts', artifact: 'dist/index.js' },
        builder: { schema: 'sec-release-builder-identity-v1', runtime: 'bun', version: Bun.version,
          executableSha256: executableDigest, platform: process.platform, architecture: process.arch } };
      for (phase of ['identity', 'control', 'marker', 'command', 'receipt']) {
        for (const settings of [[true, false], [true, true], [false, true]]) {
          [bodyFails, cleanupFails] = settings;
          for (primary of [undefined, null, false, 0, NaN, Object.freeze({ phase })]) {
            cleanup = Object.freeze({ cleanup: phase });
            events = []; commandCompleted = false;
            let caught = false;
            try {
              if (phase === 'marker') await buildFrozenReleaseBundle(frozen, '/artifact');
              else await prepareFrozenReleaseSource('/borrowed-repository');
            } catch (error) {
              caught = true;
              if (bodyFails && !cleanupFails) assert.ok(Object.is(error, primary));
              else {
                const expected = bodyFails ? [primary, cleanup] : [cleanup];
                assert.deepEqual(error.errors, expected);
              }
            }
            assert.equal(caught, true, phase + ' must not return success');
            assert.equal(events.filter(event => event === 'dispose-' + (phase === 'receipt' ? 'command' : phase)).length, 1);
            if (phase === 'command' || phase === 'receipt') {
              const close = events.indexOf('dispose-command');
              assert.deepEqual(events.slice(close, close + 3), ['dispose-command', 'dispose-directory', 'dispose-executable']);
              assert.ok(events.includes('dispose-bun.lock'));
              assert.ok(events.includes('dispose-package.json'));
            }
          }
        }
      }
      phase = 'command-exit'; bodyFails = false; cleanupFails = true;
      cleanup = Object.freeze({ cleanup: 'nonzero command close' });
      events = []; commandCompleted = false;
      await assert.rejects(prepareFrozenReleaseSource('/borrowed-repository'), error => {
        assert.equal(error.errors[0].message, 'bun install failed: fixture failure');
        assert.equal(error.errors[1], cleanup);
        return true;
      });
      assert.ok(events.includes('dispose-directory'));
      assert.ok(events.includes('dispose-executable'));
      console.log('retained capability failures preserved');
    `);
    const child = Bun.spawn([process.execPath, script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
    ]);
    expect(code, stderr).toBe(0);
    expect(stdout.trim()).toBe('retained capability failures preserved');
  } finally { await rm(root, { recursive: true, force: true }); }
});
