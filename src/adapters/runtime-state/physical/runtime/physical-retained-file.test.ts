import { expect, test } from 'bun:test';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { currentRuntimeExecutableIdentity } from '../../../toolchain/dependencies/runtime/compiler-materialization-input.ts';
import {
  inspectNoFollowDirectoryChain,
  retainCurrentLinuxSealedExecutable,
  retainCurrentProcessExecutable,
  retainNoFollowDirectoryForChildProcess,
} from './physical-no-follow.ts';
import { issueRetainedCommandBoundary, runRetainedCommand } from './process.ts';

const runtimeRoot = import.meta.dir;
const compilerIdentityModule = path.resolve(runtimeRoot,
  '../../../toolchain/dependencies/runtime/compiler-materialization-input.ts');

const nestedScript = `
  import { retainCurrentLinuxSealedExecutable, retainedExecutableSourcePath,
    retainNoFollowDirectoryForChildProcess, inspectNoFollowDirectoryChain }
    from ${JSON.stringify(path.join(runtimeRoot, 'physical-no-follow.ts'))};
  import { issueRetainedCommandBoundary, runRetainedCommand }
    from ${JSON.stringify(path.join(runtimeRoot, 'process.ts'))};
  import { currentRuntimeExecutableIdentity } from ${JSON.stringify(compilerIdentityModule)};
  const identity = await currentRuntimeExecutableIdentity();
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const sourceKey = 'SEC_RETAINED_EXECUTABLE_SOURCE_PATH';
  const originalSource = process.env[sourceKey];
  const maliciousRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-executable-source-rejection-'));
  try {
    const fifo = path.join(maliciousRoot, 'fifo');
    const made = Bun.spawnSync(['mkfifo', fifo], {stdout: 'pipe', stderr: 'pipe', timeout: 5000});
    if (made.exitCode !== 0) throw new Error('FIFO fixture creation failed');
    const symlink = path.join(maliciousRoot, 'source-link');
    fs.symlinkSync(originalSource, symlink);
    for (const locator of [fifo, symlink, ${JSON.stringify(import.meta.path)}]) {
      process.env[sourceKey] = locator;
      let rejected = false;
      try { await currentRuntimeExecutableIdentity(true); } catch { rejected = true; }
      if (!rejected) throw new Error('Compiler accepted unproven executable source');
    }
  } finally {
    process.env[sourceKey] = originalSource;
    fs.rmSync(maliciousRoot, {recursive: true, force: true});
  }
  const executable = retainCurrentLinuxSealedExecutable();
  const directory = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(process.cwd()), 4);
  try {
    delete process.env[sourceKey];
    let admissionFailure;
    try {
      await runRetainedCommand(issueRetainedCommandBoundary({executable, workingDirectory: directory}),
        ['--eval', "process.stdout.write('must-not-run')"],
        {timeoutMs: 10000, maxStdoutBytes: 1000, maxStderrBytes: 1000});
    } catch (error) { admissionFailure = error; }
    finally { process.env[sourceKey] = originalSource; }
    if (!admissionFailure?.message.includes('canonical source locator')
        || admissionFailure.outcome.started !== false)
      throw new Error('Missing source admission lost its cause or started a child');
    for (const locator of [undefined, ${JSON.stringify(import.meta.path)}]) {
      let rejected = false;
      try { retainedExecutableSourcePath(executable, locator); } catch { rejected = true; }
      if (!rejected) throw new Error('Unproven source provenance was admitted');
    }
    const result = await runRetainedCommand(issueRetainedCommandBoundary({executable, workingDirectory: directory}),
      ['--no-env-file', '--eval', ${JSON.stringify(`
        import { currentRuntimeExecutableIdentity } from ${JSON.stringify(compilerIdentityModule)};
        process.stdout.write(JSON.stringify(await currentRuntimeExecutableIdentity()));
      `)}], {timeoutMs: 10000, maxStdoutBytes: 10000, maxStderrBytes: 10000});
    if (result.code !== 0) throw new Error(result.stderr);
    if (JSON.stringify(JSON.parse(result.stdout)) !== JSON.stringify(identity))
      throw new Error('Grandchild runtime identity changed');
    process.stdout.write(result.stdout);
  } finally { directory.dispose(); executable.dispose(); }
  let disposedRejected = false;
  try { executable.assertCurrent(); } catch { disposedRejected = true; }
  if (!disposedRejected) throw new Error('Disposed executable remained usable');
`;

test.skipIf(process.platform !== 'linux')(
  'sealed executable provenance survives child and grandchild with physical source revalidation',
  async () => {
    const expected = await currentRuntimeExecutableIdentity();
    const executable = retainCurrentProcessExecutable(3, 'runtime provenance test');
    const directory = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(process.cwd()), 4);
    try {
      const result = await runRetainedCommand(issueRetainedCommandBoundary({executable, workingDirectory: directory}),
        ['--no-env-file', '--eval', nestedScript],
        {timeoutMs: 15000, maxStdoutBytes: 10000, maxStderrBytes: 10000});
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expected);
    } finally {
      directory.dispose();
      executable.dispose();
    }
  }
);

test.skipIf(process.platform !== 'linux')(
  'current sealed executable adoption rejects an ordinary descriptor without closing its owner',
  () => {
    const descriptor = openSync(import.meta.path, 'r');
    try {
      expect(() => retainCurrentLinuxSealedExecutable(descriptor)).toThrow();
      // Closing remains the caller's responsibility even after adoption fails.
    } finally { closeSync(descriptor); }
    expect(() => retainCurrentLinuxSealedExecutable(-1)).toThrow();
  }
);


test.skipIf(process.platform !== 'linux')(
  'separate retained Bun test processes preserve independent PIDs and isolated globals',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-test-isolation-'));
    const executable = retainCurrentProcessExecutable(3, 'isolated test executable');
    const directory = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(root), 4);
    try {
      const files = ['first.test.ts', 'second.test.ts'];
      for (const file of files) writeFileSync(path.join(root, file), `
        import {expect,test} from 'bun:test';
        test('process globals start isolated', () => {
          expect(globalThis.retainedIsolationMarker).toBeUndefined();
          globalThis.retainedIsolationMarker = true;
          process.stdout.write('isolated-pid:' + process.pid + '\\n');
        });
      `);
      const boundary = issueRetainedCommandBoundary({executable, workingDirectory: directory});
      const results = await Promise.all(files.map((file) => runRetainedCommand(boundary,
        ['--no-env-file', 'test', './' + file, '--no-orphans'],
        {timeoutMs: 10000, maxStdoutBytes: 10000, maxStderrBytes: 10000})));
      const childPids = results.map((result) => {
        expect(result.code).toBe(0);
        const observed = /isolated-pid:(\d+)/u.exec(result.stdout);
        expect(observed).not.toBeNull();
        return Number(observed![1]);
      });
      expect(new Set(childPids).size).toBe(files.length);
      expect(childPids).not.toContain(process.pid);
    } finally {
      directory.dispose();
      executable.dispose();
      rmSync(root, {recursive: true, force: true});
    }
  }
);
