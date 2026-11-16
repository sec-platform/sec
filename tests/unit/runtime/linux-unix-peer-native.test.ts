import { expect, test } from 'bun:test';
import path from 'node:path';
import { runRetainedBunTestCommand } from '../../testkit/process-resource.ts';

// Preserve the real test runtime; mocks live only in a bounded child process.
const fixture = path.resolve('tests/helpers/linux-unix-peer/native-fixture.ts');
const cases = ['native owner encodes the retained inode and owns only the peer connection',
  'native owner floors peer descriptors before connect and settles both generations once',
  'native owner refuses invalid or non-socket borrowed descriptors before opening a peer',
  'native owner settles an allocated connection on incomplete connect or credential failure',
  'native owner settles failed descriptor duplication and does not close a failed socket result',
  'native owner preserves admission and close failures and never retries a failed close'];

for (const name of cases) {
  test.skipIf(process.platform !== 'linux' || process.arch !== 'x64')(name, async () => {
    const result = await runRetainedBunTestCommand([fixture, name], {
      timeoutMs: 10_000, maxStdoutBytes: 256 * 1024, maxStderrBytes: 256 * 1024
    });
    expect({ status: result.code, stderr: result.stderr }).toEqual({
      status: 0, stderr: ''
    });
    expect(result.stdout).toBe('passed\n');
  });
}
