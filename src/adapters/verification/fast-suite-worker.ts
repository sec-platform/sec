/**
 * Child harness code is a provider input, not a second path-loaded script.
 * Capture callable intrinsics before candidate import and serialize only
 * primitive fields. A candidate's Object.prototype.toJSON or stdout wrappers
 * must not observe or rewrite the harness's terminal object. This does not
 * make the child an independent verifier of its own native/FFI code.
 */
export const FAST_SUITE_WORKER_SOURCE = String.raw`
(async () => {
  const { closeSync, openSync, readFileSync, readdirSync, writeSync } = await import('node:fs');
  const { isProxy } = await import('node:util/types');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const apply = Reflect.apply;
  const stringify = JSON.stringify;
  const ownDescriptor = Object.getOwnPropertyDescriptor;
  const hasOwn = Object.hasOwn;
  const stringValue = String;
  const stringSlice = String.prototype.slice;
  const encoder = new TextEncoder();
  const encode = TextEncoder.prototype.encode.bind(encoder);
  const byteLengthGetter = ownDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
  const processObject = process;
  const PromiseConstructor = Promise;
  const schedule = setTimeout;
  const now = performance.now.bind(performance);
  const source = readFileSync(0, 'utf8');
  const input = JSON.parse(source);
  const inputKeys = input && typeof input === 'object' && !Array.isArray(input)
    ? Object.keys(input).sort()
    : [];
  if (inputKeys.join(',') !== 'nonce,relativeFile,schema,sealedGeneration,writableRoot'
      || input.schema !== 'sec-fast-suite-worker-input-v1'
      || typeof input.nonce !== 'string'
      || !/^[0-9a-f]{64}$/.test(input.nonce)
      || typeof input.relativeFile !== 'string'
      || input.relativeFile.length === 0
      || typeof input.sealedGeneration !== 'boolean'
      || (input.writableRoot !== null && typeof input.writableRoot !== 'string')
      || (typeof input.writableRoot === 'string' && !path.isAbsolute(input.writableRoot))
      || input.relativeFile.includes('\0')
      || input.relativeFile.includes('\\')
      || path.isAbsolute(input.relativeFile)
      || input.relativeFile.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error('invalid fast suite worker input');
  }
  const root = path.resolve(processObject.cwd());
  const absoluteFile = path.resolve(root, ...input.relativeFile.split('/'));
  const relative = path.relative(root, absoluteFile);
  if (relative === '' || path.isAbsolute(relative) || relative === '..'
      || relative.startsWith('..' + path.sep)) {
    throw new Error('fast suite worker file escaped its retained workspace root');
  }
  const installLinuxFilesystemSandbox = async () => {
    if (!input.sealedGeneration || processObject.platform !== 'linux') return;
    if (processObject.arch !== 'x64' && processObject.arch !== 'arm64') {
      throw new Error('sealed fast-suite Landlock syscall binding supports Linux x64/arm64 only');
    }
    if (typeof input.writableRoot !== 'string') throw new Error('sealed generation writable root is unavailable');
    const { dlopen, FFIType, ptr } = await import('bun:ffi');
    const library = dlopen('libc.so.6', {
      syscall: {
        args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64],
        returns: FFIType.i64
      },
      prctl: {
        args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
        returns: FFIType.i32
      }
    });
    let rulesetFd = -1;
    let generationFd = -1;
    let writableFd = -1;
    try {
      const syscall = library.symbols.syscall;
      const abi = Number(syscall(444n, 0n, 0n, 1n, 0n, 0n, 0n));
      // ABI 3 is the first ABI that can deny truncate/ftruncate. ABI 8 adds
      // process-wide TSYNC. On ABI 3..7 a Landlock domain is exact only when
      // this Bun process is actually single-threaded at enforcement time.
      if (!Number.isSafeInteger(abi) || abi < 3) {
        throw new Error('Landlock ABI 3 or newer is required for sealed fast-suite execution');
      }
      const EXECUTE = 1n << 0n;
      const WRITE_FILE = 1n << 1n;
      const READ_FILE = 1n << 2n;
      const READ_DIR = 1n << 3n;
      const REMOVE_DIR = 1n << 4n;
      const REMOVE_FILE = 1n << 5n;
      const MAKE_CHAR = 1n << 6n;
      const MAKE_DIR = 1n << 7n;
      const MAKE_REG = 1n << 8n;
      const MAKE_SOCK = 1n << 9n;
      const MAKE_FIFO = 1n << 10n;
      const MAKE_BLOCK = 1n << 11n;
      const MAKE_SYM = 1n << 12n;
      const REFER = 1n << 13n;
      const TRUNCATE = 1n << 14n;
      const readOnly = EXECUTE | READ_FILE | READ_DIR;
      const writeEffects = WRITE_FILE | REMOVE_DIR | REMOVE_FILE | MAKE_CHAR | MAKE_DIR |
        MAKE_REG | MAKE_SOCK | MAKE_FIFO | MAKE_BLOCK | MAKE_SYM | REFER | TRUNCATE;
      const handled = readOnly | writeEffects;
      const ruleset = Buffer.alloc(8);
      ruleset.writeBigUInt64LE(handled, 0);
      rulesetFd = Number(syscall(
        444n,
        ptr(ruleset),
        BigInt(ruleset.byteLength),
        0n, 0n, 0n, 0n
      ));
      if (!Number.isSafeInteger(rulesetFd) || rulesetFd < 0) {
        throw new Error('Landlock ruleset creation failed');
      }
      generationFd = openSync(root, 0x00290000);
      writableFd = openSync(input.writableRoot, 0x00290000);
      const addPathRule = (fd, access, label) => {
        const pathRule = Buffer.alloc(16);
        pathRule.writeBigUInt64LE(access, 0);
        pathRule.writeInt32LE(fd, 8);
        const added = Number(syscall(
          445n,
          BigInt(rulesetFd),
          1n,
          ptr(pathRule),
          0n, 0n, 0n
        ));
        if (added !== 0) throw new Error('Landlock ' + label + ' rule failed');
      };
      addPathRule(generationFd, readOnly, 'sealed-generation');
      addPathRule(writableFd, handled, 'writable-root');
      const restrictFlags = abi >= 8 ? 8n : 0n;
      if (abi < 8) {
        const tasks = readdirSync('/proc/self/task');
        if (tasks.length !== 1) {
          throw new Error(
            'Landlock ABI 8 TSYNC or a provably single-threaded worker is required for sealed fast-suite execution'
          );
        }
      }
      if (library.symbols.prctl(38, 1, 0, 0, 0) !== 0) {
        throw new Error('Landlock no-new-privileges admission failed');
      }
      const restricted = Number(syscall(
        446n,
        BigInt(rulesetFd),
        restrictFlags, 0n, 0n, 0n, 0n
      ));
      if (restricted !== 0) throw new Error('Landlock self-restriction failed');
    } finally {
      if (writableFd >= 0) closeSync(writableFd);
      if (generationFd >= 0) closeSync(generationFd);
      if (rulesetFd >= 0) closeSync(rulesetFd);
      library.close();
    }
  };
  const slice = (value) => apply(stringSlice, value, [0, 4096]);
  const failureSummary = (error) => {
    if (typeof error === 'string') return slice(error);
    if (error === null || typeof error === 'undefined' || typeof error === 'number'
        || typeof error === 'boolean' || typeof error === 'bigint') {
      return slice(stringValue(error));
    }
    if (typeof error === 'object' && !isProxy(error)) {
      const message = ownDescriptor(error, 'message');
      if (message && hasOwn(message, 'value') && typeof message.value === 'string') {
        return slice(message.value);
      }
    }
    return '[non-Error suite failure]';
  };
  let status = 'failed';
  let failureKind = 'suite-failure';
  let failure = '';
  try {
    try {
      await installLinuxFilesystemSandbox();
    } catch (error) {
      failureKind = 'sandbox-unavailable';
      failure = failureSummary(error);
      throw Object.freeze({ fastSuiteSandboxFailure: true });
    }
    const loaded = await import(pathToFileURL(absoluteFile).href);
    const runSuite = loaded.runSuite;
    if (typeof runSuite !== 'function') {
      failureKind = 'missing-export';
      failure = 'runSuite export is missing';
    } else {
      try {
        await apply(runSuite, loaded, []);
        status = 'passed';
      } catch (error) {
        failure = failureSummary(error);
      }
    }
  } catch (error) {
    if (failureKind !== 'sandbox-unavailable') failure = failureSummary(error);
  }
  // JSON.stringify on primitive strings does not invoke inherited toJSON.
  // Never hand a nonce-bearing object to candidate-modifiable serializers.
  let terminal = '{"schema":"sec-fast-suite-worker-result-v1","nonce":'
    + stringify(input.nonce) + ',"status":' + stringify(status);
  if (status === 'failed') {
    terminal += ',"failureKind":' + stringify(failureKind) + ',"failure":' + stringify(failure);
  }
  terminal += '}';
  processObject.exitCode = status === 'passed' ? 0 : 1;
  const bytes = encode('\n' + terminal + '\n');
  const length = apply(byteLengthGetter, bytes, []);
  let offset = 0;
  const terminalDeadline = now() + 1000;
  while (offset < length) {
    if (now() >= terminalDeadline) throw new Error('terminal write deadline exceeded');
    let count;
    try {
      count = writeSync(1, bytes, offset, length - offset);
    } catch (error) {
      // A captured native fd writer bypasses candidate stream hooks, but a
      // nonblocking pipe may apply backpressure. Retry only that native case
      // within one finite publication deadline; never retry arbitrary errors.
      const descriptor = error !== null && typeof error === 'object' && !isProxy(error)
        ? ownDescriptor(error, 'code') : undefined;
      const code = descriptor && hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      if (code !== 'EAGAIN' && code !== 'EWOULDBLOCK') throw error;
      await new PromiseConstructor(resolve => schedule(resolve, 1));
      continue;
    }
    if (count <= 0 || count > length - offset) throw new Error('terminal write made no progress');
    offset += count;
  }
})().catch(() => {
  process.exitCode = 86;
});
`;
