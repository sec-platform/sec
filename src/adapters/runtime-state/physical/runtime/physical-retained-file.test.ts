import { expect, test } from 'bun:test';
import { closeSync, linkSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { currentRuntimeExecutableIdentity } from '../../../toolchain/dependencies/runtime/compiler-materialization-input.ts';
import {
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  retainCurrentLinuxSealedExecutable,
  retainCurrentProcessExecutable,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowOrdinaryFile,
} from './physical-no-follow.ts';
import { issueRetainedCommandBoundary, runRetainedCommand } from './process.ts';

const runtimeRoot = import.meta.dir;
const compilerIdentityModule = path.resolve(runtimeRoot,
  '../../../toolchain/dependencies/runtime/compiler-materialization-input.ts');

async function withWindowsRetentionFixture(run: (root: string, file: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-write-proof-'));
  const file = path.join(root, 'source.bin');
  writeFileSync(file, 'original');
  try { await run(root, file); }
  finally {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(tmpdir()));
    expect(path.basename(root).startsWith('sec-retained-write-proof-')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
}

async function windowsMappingApi() {
  const { dlopen, FFIType, toArrayBuffer } = await import('bun:ffi');
  const library = dlopen('kernel32.dll', {
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr,
      FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u64 },
    CreateFileMappingW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32,
      FFIType.u32, FFIType.ptr], returns: FFIType.u64 },
    MapViewOfFile: { args: [FFIType.u64, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u64], returns: FFIType.ptr },
    FlushViewOfFile: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
    UnmapViewOfFile: { args: [FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
  } as const);
  return { library, toArrayBuffer };
}

test.skipIf(process.platform !== 'win32')('Windows retained write proof blocks a preexisting hardlink writer until release', async () => {
  await withWindowsRetentionFixture((root, file) => {
    const alias = path.join(root, 'hardlink.bin');
    linkSync(file, alias);
    const retained = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(root), 'source.bin');
    try {
      expect(retained.linkCount).toBe(2);
      const initial = retained.digest();
      expect(() => writeFileSync(alias, 'changed!')).toThrow();
      retained.assertCurrent();
      expect(retained.digest()).toEqual(initial);
    } finally { retained.dispose(); }
    writeFileSync(alias, 'changed!');
    expect(readFileSync(file, 'utf8')).toBe('changed!');
  });
});

test.skipIf(process.platform !== 'win32')('Windows retained write proof refuses an already-open writable file handle', async () => {
  await withWindowsRetentionFixture(async (root, file) => {
    const { library } = await windowsMappingApi();
    let handle: bigint | null = null;
    let retained: RetainedNoFollowOrdinaryFile | undefined;
    try {
      handle = library.symbols.CreateFileW(Buffer.from(`${file}\0`, 'utf16le'), 0xc0000000, 7, null, 3, 0x80, null);
      expect(handle).not.toBe(0xffffffffffffffffn);
      expect(handle).not.toBe(0n);
      let admissionError: unknown;
      try { retained = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(root), 'source.bin'); }
      catch (error) { admissionError = error; }
      expect(retained).toBeUndefined();
      expect(admissionError).toBeInstanceOf(PhysicalNoFollowError);
      expect((admissionError as Error).message).toContain('NTSTATUS -1073741757');
    } finally {
      retained?.dispose();
      if (handle !== null && handle !== 0n && handle !== 0xffffffffffffffffn) library.symbols.CloseHandle(handle);
      library.close();
    }
    const after = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(root), 'source.bin');
    after.dispose();
  });
});

test.skipIf(process.platform !== 'win32')('Windows retained write proof must reject or prevent a writable mapping after its creating file handle closes', async () => {
  await withWindowsRetentionFixture(async (root, file) => {
    const parent = inspectNoFollowDirectoryChain(root);
    const control = retainNoFollowOrdinaryFile(parent, 'source.bin');
    control.dispose();
    const { library, toArrayBuffer } = await windowsMappingApi();
    let creatingFile: bigint | null = null;
    let mapping: bigint | null = null;
    let view: ReturnType<typeof library.symbols.MapViewOfFile> = null;
    let retained: RetainedNoFollowOrdinaryFile | undefined;
    const observe = (read: () => unknown) => {
      try { return { status: 'returned', value: read() }; }
      catch (error) { return { status: 'threw', message: error instanceof Error ? error.message : String(error) }; }
    };
    try {
      creatingFile = library.symbols.CreateFileW(Buffer.from(`${file}\0`, 'utf16le'), 0xc0000000, 7, null, 3, 0x80, null);
      expect(creatingFile).not.toBe(0xffffffffffffffffn);
      expect(creatingFile).not.toBe(0n);
      mapping = library.symbols.CreateFileMappingW(creatingFile, null, 4, 0, 0, null);
      expect(mapping).not.toBe(0n);
      view = library.symbols.MapViewOfFile(mapping, 6, 0, 0, 8);
      expect(view).not.toBeNull();
      if (view === null) throw new Error('The writable mapping fixture did not produce a view');
      expect(library.symbols.CloseHandle(creatingFile)).toBe(1);
      creatingFile = null;
      let admissionError: unknown;
      try { retained = retainNoFollowOrdinaryFile(parent, 'source.bin'); }
      catch (error) { admissionError = error; }
      if (retained === undefined) {
        expect(admissionError).toBeInstanceOf(PhysicalNoFollowError);
        console.info(JSON.stringify({ qualification: 'closed-file-handle-writable-mapping',
          creatingFileHandleClosed: creatingFile === null, mappingHandleLive: mapping !== null && mapping !== 0n,
          viewLive: view !== null, admission: 'refused',
          code: admissionError instanceof PhysicalNoFollowError ? admissionError.code : null,
          message: admissionError instanceof Error ? admissionError.message : String(admissionError) }));
        return;
      }
      const initial = retained.digest();
      const bytes = new Uint8Array(toArrayBuffer(view, 0, 8));
      expect(Buffer.from(bytes).toString('utf8')).toBe('original');
      bytes.set(Buffer.from('changed!'));
      expect(library.symbols.FlushViewOfFile(view, 8)).toBe(1);
      const mappedWriteSucceeded = Buffer.from(bytes).toString('utf8') === 'changed!';
      const duringIdentity = observe(() => retained!.assertCurrent());
      const duringDigest = observe(() => retained!.digest());
      bytes.set(Buffer.from('original'));
      expect(library.symbols.FlushViewOfFile(view, 8)).toBe(1);
      const afterIdentity = observe(() => retained!.assertCurrent());
      const afterDigest = observe(() => retained!.digest());
      expect(readFileSync(file, 'utf8')).toBe('original');
      const diagnostic = JSON.stringify({ creatingFileHandleClosed: creatingFile === null,
        retainedAdmission: 'accepted', mappedWriteSucceeded, initial, duringIdentity, duringDigest, afterIdentity, afterDigest });
      expect(mappedWriteSucceeded, diagnostic).toBe(false);
    } finally {
      const failures: string[] = [];
      try { retained?.dispose(); } catch (error) { failures.push(String(error)); }
      if (view !== null && library.symbols.UnmapViewOfFile(view) === 0) failures.push('UnmapViewOfFile failed');
      if (mapping !== null && mapping !== 0n && library.symbols.CloseHandle(mapping) === 0) failures.push('Mapping CloseHandle failed');
      if (creatingFile !== null && creatingFile !== 0n && creatingFile !== 0xffffffffffffffffn
          && library.symbols.CloseHandle(creatingFile) === 0) failures.push('File CloseHandle failed');
      library.close();
      if (failures.length !== 0) throw new AggregateError(failures, 'Writable mapping fixture cleanup failed');
    }
  });
});

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
      expect(result.code, result.stderr).toBe(0);
      expect(result.terminal).toEqual({ exitCode: 0, signal: null });
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
