import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const modulePath = (relative: string): string => JSON.stringify(path.join(repositoryRoot, relative));
const commandModule = modulePath('src/adapters/verification/platform/ci/runtime/session-command.ts');
const physicalModule = modulePath('src/adapters/runtime-state/physical/runtime/physical-no-follow.ts');
const processModule = modulePath('src/adapters/runtime-state/physical/runtime/process.ts');

async function isolatedCase(body: string): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-session-command-cwd-'));
  try {
    const script = path.join(root, 'case.ts');
    await writeFile(script, `
      import assert from 'node:assert/strict';
      import { mock } from 'bun:test';
      import * as fs from 'node:fs';
      import path from 'node:path';
      const root = ${JSON.stringify(root)};
      ${body}
    `);
    const result = Bun.spawnSync([process.execPath, script], {
      cwd: repositoryRoot,
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15_000
    });
    expect(result.exitCode, Buffer.from(result.stderr).toString('utf8')).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== 'linux')('session command stays on retained inode after pathname rename and rebind', async () => {
  await isolatedCase(`
    const child = await import('node:child_process');
    const originalSpawn = child.spawnSync;
    const original = path.join(root, 'working');
    const moved = path.join(root, 'retained');
    fs.mkdirSync(original);
    fs.writeFileSync(path.join(original, 'identity'), 'owned');
    let effects = 0;
    mock.module('node:child_process', () => ({ ...child, spawnSync(command, args, options) {
      effects++;
      assert.equal(command, 'bun');
      fs.renameSync(original, moved);
      fs.mkdirSync(original);
      fs.writeFileSync(path.join(original, 'identity'), 'replacement');
      assert.match(options.cwd, /^\\/proc\\/self\\/fd\\/[0-9]+$/);
      return originalSpawn(process.execPath, args, options);
    }}));
    const { runVerificationSessionCommand } = await import(${commandModule});
    const result = runVerificationSessionCommand({ repositoryRoot: original }, 'bun', [
      '-e', "const fs=require('node:fs');process.stdout.write(fs.readFileSync('identity'));fs.writeFileSync('effect','owned');"
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), 'owned');
    assert.equal(effects, 1);
    assert.equal(fs.readFileSync(path.join(moved, 'effect'), 'utf8'), 'owned');
    assert.equal(fs.existsSync(path.join(original, 'effect')), false);
    assert.equal(fs.readFileSync(path.join(original, 'identity'), 'utf8'), 'replacement');
  `);
});

test('session command rejects unavailable retained-directory backend before spawning', async () => {
  await isolatedCase(`
    const child = await import('node:child_process');
    let effects = 0;
    mock.module('node:child_process', () => ({ ...child, spawnSync() { effects++; throw new Error('unexpected effect'); } }));
    const { runVerificationSessionCommand } = await import(${commandModule});
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    assert.throws(() => runVerificationSessionCommand({ repositoryRoot: root }, 'git', ['status']),
      error => error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
    assert.equal(effects, 0);
  `);
});

for (const fault of ['none', 'spawn', 'undefined-spawn', 'readback', 'dispose', 'spawn-and-dispose', 'readback-and-dispose'] as const) {
  test.skipIf(process.platform !== 'linux')(`session cwd settlement preserves command contract after ${fault}`, async () => {
    await isolatedCase(`
      const fault = ${JSON.stringify(fault)};
      const primary = fault === 'undefined-spawn' ? undefined : Object.freeze({ fault });
      const cleanup = Object.freeze({ cleanup: true });
      const events = [];
      let assertions = 0;
      const physical = await import(${physicalModule});
      const { RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR: descriptor } = await import(${processModule});
      const child = await import('node:child_process');
      mock.module(${physicalModule}, () => ({ ...physical,
        inspectNoFollowDirectoryChain(cwd) { events.push('inspect'); assert.equal(cwd, root); return {}; },
        retainNoFollowDirectoryForChildProcess(_chain, requested) {
          events.push('retain'); assert.equal(requested, descriptor);
          return { childPath: '/proc/self/fd/' + descriptor, stdioSourceDescriptor: 7,
            assertCurrent() { events.push('assert'); if (++assertions === 2 && fault.startsWith('readback')) throw primary; },
            dispose() { events.push('dispose'); if (fault.includes('dispose')) throw cleanup; }
          };
        }
      }));
      mock.module('node:child_process', () => ({ ...child, spawnSync(command, args, options) {
        events.push('spawn');
        assert.equal(command, 'git'); assert.deepEqual(args, ['status']);
        assert.equal(options.cwd, '/proc/self/fd/7');
        assert.equal(options.stdio[descriptor], 7);
        assert.deepEqual(options.stdio.slice(0, 3), ['pipe', 'pipe', 'pipe']);
        assert.equal(options.timeout, 60000); assert.equal(options.maxBuffer, 32 * 1024 * 1024);
        assert.equal(options.encoding, 'buffer'); assert.equal(options.windowsHide, true);
        assert.equal(options.env.GH_PROMPT_DISABLED, '1'); assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
        assert.deepEqual(options.input, Buffer.from('input'));
        if (fault.includes('spawn')) throw primary;
        return { status: 3, stdout: Buffer.from('output'), stderr: Buffer.from('diagnostic') };
      } }));
      const { runVerificationSessionCommand } = await import(${commandModule});
      let caught = false;
      try {
        const result = runVerificationSessionCommand({ repositoryRoot: root }, 'git', ['status'], root, 'input');
        assert.equal(fault, 'none');
        assert.equal(result.status, 3); assert.equal(result.stdout.toString(), 'output');
        assert.equal(result.stderr.toString(), 'diagnostic');
      } catch (error) {
        caught = true;
        if (fault.includes('and-dispose')) assert.deepEqual(error.errors, [primary, cleanup]);
        else if (fault === 'dispose') assert.deepEqual(error.errors, [cleanup]);
        else assert.equal(error, primary);
      }
      assert.equal(caught, fault !== 'none');
      assert.equal(events.filter(x => x === 'dispose').length, 1);
      assert.equal(events.at(-1), 'dispose');
      events.length = 0;
      assert.throws(() => runVerificationSessionCommand({ repositoryRoot: root }, 'git', ['bad\\0argument']), /NUL/);
      assert.deepEqual(events, []);
    `);
  });
}
