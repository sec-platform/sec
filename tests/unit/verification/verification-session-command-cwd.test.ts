import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_TEST_TIMEOUT_MS } from '../../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { withRetainedBunTestWorkspace } from '../../testkit/process-resource.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const commandModule = JSON.stringify(path.join(repositoryRoot, 'src/adapters/verification/platform/ci/runtime/session-command.ts'));
const physicalModule = JSON.stringify(path.join(repositoryRoot, 'src/adapters/runtime-state/physical/runtime/physical-no-follow.ts'));

async function isolatedCase(body: string): Promise<void> {
  return withRetainedBunTestWorkspace('sec-session-command-cwd-', async (root, run) => {
    const script = path.join(root, 'case.ts');
    await writeFile(script, `
      import assert from 'node:assert/strict';
      import { mock } from 'bun:test';
      import * as fs from 'node:fs';
      import path from 'node:path';
      const root = ${JSON.stringify(root)};
      ${body}
    `);
    const result = await run([script], {
      cwd: repositoryRoot, env: process.env, timeoutMs: DEFAULT_TEST_TIMEOUT_MS
    });
    expect(result.code, result.stderr).toBe(0);
  });
}

test.skipIf(process.platform !== 'win32')('session command pins the actual Windows cwd chain against ancestor replacement', async () => {
  await isolatedCase(`
    const physical = await import(${physicalModule});
    const originalRetain = physical.retainNoFollowDirectoryForChildProcess;
    let retainedChildPath = '';
    mock.module(${physicalModule}, () => ({ ...physical,
      retainNoFollowDirectoryForChildProcess(...args) {
        const retained = originalRetain(...args);
        retainedChildPath = retained.childPath;
        if (process.platform === 'linux') {
          assert.equal(typeof retained.stdioSourceDescriptor, 'number');
          assert.ok(retained.stdioSourceDescriptor >= 5);
        } else {
          assert.equal(retained.stdioSourceDescriptor, null);
        }
        return retained;
      }
    }));
    const child = await import('node:child_process');
    const originalSpawn = child.spawnSync;
    const ancestor = path.join(root, 'ancestor');
    const parent = path.join(ancestor, 'parent');
    const working = path.join(parent, 'working');
    const movedAncestor = path.join(root, 'ancestor-replacement');
    const movedParent = path.join(root, 'parent-replacement');
    fs.mkdirSync(working, { recursive: true });
    fs.writeFileSync(path.join(working, 'identity'), 'owned');
    let attempts = 0;
    mock.module('node:child_process', () => ({ ...child, spawnSync(command, args, options) {
      attempts++;
      assert.equal(command, 'bun');
      assert.throws(() => fs.renameSync(parent, movedParent));
      assert.throws(() => fs.renameSync(ancestor, movedAncestor));
      assert.equal(options.cwd, working);
      assert.notEqual(retainedChildPath, '');
      return originalSpawn(process.execPath, [...args, path.join(retainedChildPath, 'identity')], options);
    }}));
    const { runVerificationSessionCommand } = await import(${commandModule});
    const result = runVerificationSessionCommand({ repositoryRoot: working }, 'bun', [
      '-e', "const fs=require('node:fs');const direct=fs.readFileSync(process.argv[1],'utf8');const relative=fs.readFileSync('identity','utf8');process.stdout.write(relative+':'+direct);fs.writeFileSync('effect','owned');"
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), 'owned:owned');
    assert.equal(attempts, 1);
    assert.equal(fs.readFileSync(path.join(working, 'effect'), 'utf8'), 'owned');
    assert.equal(fs.existsSync(movedParent), false);
    assert.equal(fs.existsSync(movedAncestor), false);
    // Successful ancestor and parent renames after the call observe release of every pin.
    fs.renameSync(ancestor, movedAncestor);
    assert.equal(fs.readFileSync(path.join(movedAncestor, 'parent', 'working', 'effect'), 'utf8'), 'owned');
    fs.renameSync(path.join(movedAncestor, 'parent'), movedParent);
    assert.equal(fs.readFileSync(path.join(movedParent, 'working', 'effect'), 'utf8'), 'owned');
  `);
});

test.skipIf(process.platform !== 'linux')('session command stays on its actual retained inode after pathname rebind', async () => {
  await isolatedCase(`
    const physical = await import(${physicalModule});
    const originalRetain = physical.retainNoFollowDirectoryForChildProcess;
    let retainedChildPath = '';
    mock.module(${physicalModule}, () => ({ ...physical,
      retainNoFollowDirectoryForChildProcess(...args) {
        const retained = originalRetain(...args);
        retainedChildPath = retained.childPath;
        if (process.platform === 'linux') {
          assert.equal(typeof retained.stdioSourceDescriptor, 'number');
          assert.ok(retained.stdioSourceDescriptor >= 5);
        } else {
          assert.equal(retained.stdioSourceDescriptor, null);
        }
        return retained;
      }
    }));
    const child = await import('node:child_process');
    const originalSpawn = child.spawnSync;
    const working = path.join(root, 'working');
    const moved = path.join(root, 'retained');
    fs.mkdirSync(working);
    fs.writeFileSync(path.join(working, 'identity'), 'owned');
    mock.module('node:child_process', () => ({ ...child, spawnSync(command, args, options) {
      fs.renameSync(working, moved); fs.mkdirSync(working);
      fs.writeFileSync(path.join(working, 'identity'), 'replacement');
      assert.notEqual(retainedChildPath, '');
      return originalSpawn(process.execPath, [...args, path.join(retainedChildPath, 'identity')], options);
    }}));
    const { runVerificationSessionCommand } = await import(${commandModule});
    const result = runVerificationSessionCommand({ repositoryRoot: working }, 'bun', [
      '-e', "const fs=require('node:fs');const direct=fs.readFileSync(process.argv[1],'utf8');const relative=fs.readFileSync('identity','utf8');process.stdout.write(relative+':'+direct);fs.writeFileSync('effect','owned');"
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), 'owned:owned');
    assert.equal(fs.readFileSync(path.join(moved, 'effect'), 'utf8'), 'owned');
    assert.equal(fs.existsSync(path.join(working, 'effect')), false);
    assert.equal(fs.readFileSync(path.join(working, 'identity'), 'utf8'), 'replacement');
  `);
});

test('unavailable retained-directory backend rejects with its original typed boundary before spawn', async () => {
  await isolatedCase(`
    const child = await import('node:child_process');
    let effects = 0;
    mock.module('node:child_process', () => ({ ...child, spawnSync() { effects++; throw new Error('unexpected spawn'); } }));
    const { runVerificationSessionCommand } = await import(${commandModule});
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    assert.throws(() => runVerificationSessionCommand({ repositoryRoot: root }, 'git', ['status']),
      error => error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
    assert.equal(effects, 0);
  `);
});

test.skipIf(process.platform !== 'win32')('session command rejects an actual Windows junction cwd before spawn', async () => {
  await isolatedCase(`
    const target = path.join(root, 'target'); const junction = path.join(root, 'junction');
    fs.mkdirSync(target); fs.symlinkSync(target, junction, 'junction');
    const child = await import('node:child_process'); let effects = 0;
    mock.module('node:child_process', () => ({ ...child, spawnSync() { effects++; throw new Error('unexpected spawn'); } }));
    const { runVerificationSessionCommand } = await import(${commandModule});
    assert.throws(() => runVerificationSessionCommand({ repositoryRoot: junction }, 'git', ['status']),
      error => error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
    assert.equal(effects, 0); assert.deepEqual(fs.readdirSync(target), []);
  `);
});

// Fault wrappers delegate acquisition/assertion/disposal to the real Physical
// resource. They diagnose composition, not a second capability or OS proof.
// The synchronous settlement owner covers exact primary-only propagation (including `undefined`)
// and cleanup semantics. Keep this adapter's distinct success, post-spawn readback, cleanup-only,
// and combined spawn/cleanup witnesses; a plain spawn-only rethrow adds no independent behavior.
for (const fault of ['none', 'readback', 'dispose', 'spawn-and-dispose'] as const) {
  test.skipIf(process.platform !== 'win32' && process.platform !== 'linux')(`session cwd settlement preserves command contract after ${fault}`, async () => {
    await isolatedCase(`
      const fault = ${JSON.stringify(fault)};
      const primary = Object.freeze({ fault });
      const cleanup = Object.freeze({ cleanup: true }); const events = []; let assertions = 0;
      const physical = await import(${physicalModule});
      const originalRetain = physical.retainNoFollowDirectoryForChildProcess;
      mock.module(${physicalModule}, () => ({ ...physical,
        retainNoFollowDirectoryForChildProcess(...args) {
          const retained = originalRetain(...args);
          events.push('retain');
          return { childPath: retained.childPath, stdioSourceDescriptor: retained.stdioSourceDescriptor,
            assertCurrent() { retained.assertCurrent(); events.push('assert'); if (++assertions === 2 && fault.startsWith('readback')) throw primary; },
            dispose() { retained.dispose(); events.push('dispose'); if (fault.includes('dispose')) throw cleanup; }
          };
        }
      }));
      const child = await import('node:child_process');
      mock.module('node:child_process', () => ({ ...child, spawnSync(command, args, options) {
        events.push('spawn'); assert.equal(command, 'git'); assert.deepEqual(args, ['status']);
        assert.equal(options.timeout, 60000); assert.equal(options.maxBuffer, 32 * 1024 * 1024);
        assert.equal(options.encoding, 'buffer'); assert.equal(options.windowsHide, true);
        assert.equal(options.env.GH_PROMPT_DISABLED, '1'); assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
        assert.deepEqual(options.input, Buffer.from('input'));
        assert.deepEqual(options.stdio.slice(0, 3), ['pipe', 'pipe', 'pipe']);
        if (process.platform === 'win32') assert.equal(options.cwd, root);
        if (fault.includes('spawn')) throw primary;
        return { status: 3, stdout: Buffer.from('output'), stderr: Buffer.from('diagnostic') };
      }}));
      const { runVerificationSessionCommand } = await import(${commandModule}); let caught = false;
      try {
        const result = runVerificationSessionCommand({ repositoryRoot: root }, 'git', ['status'], root, 'input');
        assert.equal(fault, 'none'); assert.equal(result.status, 3);
        assert.equal(result.stdout.toString(), 'output'); assert.equal(result.stderr.toString(), 'diagnostic');
      } catch (error) {
        caught = true;
        if (fault.includes('and-dispose')) assert.deepEqual(error.errors, [primary, cleanup]);
        else if (fault === 'dispose') assert.deepEqual(error.errors, [cleanup]);
        else assert.equal(error, primary);
      }
      assert.equal(caught, fault !== 'none');
      assert.equal(events.filter(event => event === 'dispose').length, 1);
      assert.equal(events.at(-1), 'dispose');
      if (fault === 'none') {
        events.length = 0;
        assert.throws(() => runVerificationSessionCommand({ repositoryRoot: root }, 'git', ['bad\\0argument']), /NUL/);
        assert.deepEqual(events, []);
      }
    `);
  });
}
