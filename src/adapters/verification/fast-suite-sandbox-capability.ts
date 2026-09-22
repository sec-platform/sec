/**
 * Cheap host-side preflight for the process-wide filesystem sandbox required
 * by isolated fast-suite execution. Exact evidence needs both immutable
 * generation bytes and read containment. The worker performs authoritative
 * ruleset creation and TSYNC restriction.
 */
export async function hasProvenFastSuiteProcessWideWriteSandbox(): Promise<boolean> {
  // Current Windows generation retention prevents writes to the generation,
  // but does not restrict reads from unrelated filesystem paths.
  if (process.platform === 'win32') return false;
  if (process.platform !== 'linux' || (process.arch !== 'x64' && process.arch !== 'arm64')) {
    return false;
  }
  let library: ReturnType<(typeof import('bun:ffi'))['dlopen']> | undefined;
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    library = dlopen('libc.so.6', {
      syscall: {
        args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64],
        returns: FFIType.i64
      }
    } as const);
    const abi = Number(library.symbols.syscall(444n, 0n, 0n, 1n, 0n, 0n, 0n));
    // ABI 8 introduces LANDLOCK_RESTRICT_SELF_TSYNC. Production capability
    // planning requires that process-wide guarantee rather than predicting
    // whether a future Bun worker happens to be single-threaded.
    return Number.isSafeInteger(abi) && abi >= 8;
  } catch {
    return false;
  } finally {
    try { library?.close(); } catch { /* capability remains unavailable */ }
  }
}
