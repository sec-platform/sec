import path from 'node:path';

/**
 * Resolve the effective account's home through the Linux user database, not
 * HOME or Bun's environment-dependent os.userInfo implementation. The fixed
 * buffers bound memory; the host NSS provider still owns lookup latency.
 */
export async function resolveLinuxEffectiveUserHome(): Promise<string> {
  if (process.platform !== 'linux' || (process.arch !== 'x64' && process.arch !== 'arm64')) {
    throw new Error('Linux account home lookup is unavailable on this platform');
  }
  const { dlopen, FFIType, ptr } = await import('bun:ffi');
  const library = dlopen('libc.so.6', {
    geteuid: { args: [], returns: FFIType.u32 },
    getpwuid_r: {
      args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32
    }
  } as const);
  // glibc's LP64 struct passwd: uid at 16, pw_dir at 32, total size 48.
  const account = Buffer.alloc(48);
  const result = Buffer.alloc(8);
  const storage = Buffer.alloc(64 * 1024);
  try {
    const uid = library.symbols.geteuid();
    const status = library.symbols.getpwuid_r(uid, ptr(account), ptr(storage), storage.length, ptr(result));
    if (status !== 0 || result.readBigUInt64LE() !== BigInt(ptr(account)) ||
        account.readUInt32LE(16) !== uid || library.symbols.geteuid() !== uid) {
      throw new Error('Linux account home lookup did not settle for the effective user');
    }
    const offset = account.readBigUInt64LE(32) - BigInt(ptr(storage));
    if (offset < 0n || offset >= BigInt(storage.length)) {
      throw new Error('Linux account home lookup returned an invalid pointer');
    }
    const start = Number(offset);
    const end = storage.indexOf(0, start);
    if (end <= start) throw new Error('Linux account home lookup returned an invalid path');
    const home = new TextDecoder('utf-8', { fatal: true }).decode(storage.subarray(start, end));
    if (!path.posix.isAbsolute(home) || path.posix.resolve(home) !== home) {
      throw new Error('Linux account home lookup returned a noncanonical path');
    }
    return home;
  } finally {
    account.fill(0);
    result.fill(0);
    storage.fill(0);
    library.close();
  }
}
