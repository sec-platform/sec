import { retainCurrentProcessExecutable } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

/** Test-only fixture for raw spawn APIs; Linux/Windows hold the retained runtime.
 * Keep this fixture alive until every spawned child and stream has settled.
 * It is never a production execution authority or a source-path fallback.
 */
export function createRawTestExecutableFixture() {
  if (process.platform !== 'linux' && process.platform !== 'win32') {
    // Keep the pre-existing raw-API tests reachable where retained execution is
    // unsupported. This branch claims only a test lifetime, not physical retention.
    const command = process.execPath;
    let disposed = false;
    const assertCurrent = (): void => {
      if (disposed) throw new Error('Raw process test fixture is disposed.');
    };
    return Object.freeze({
      mode: 'native-unretained' as const,
      get command(): string { assertCurrent(); return command; },
      assertCurrent,
      dispose: () => { disposed = true; }
    });
  }
  const executable = retainCurrentProcessExecutable(3, 'raw process test executable');
  const ownerPid = process.pid;
  const descriptor = executable.stdioSourceDescriptor;
  const command = process.platform === 'linux'
    ? `/proc/${ownerPid}/fd/${descriptor}`
    : executable.childPath;
  if (process.platform === 'linux' && (descriptor === null || !Number.isSafeInteger(descriptor))) {
    executable.dispose();
    throw new Error('Raw process test executable requires an owned Linux descriptor.');
  }
  return Object.freeze({
    mode: 'retained' as const,
    get command(): string {
      if (process.pid !== ownerPid) throw new Error('Raw process test executable belongs to another process.');
      executable.assertCurrent();
      return command;
    },
    assertCurrent: () => executable.assertCurrent(),
    dispose: () => executable.dispose()
  });
}
