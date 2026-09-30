import { expect, test } from 'bun:test';
import path from 'node:path';

const supported = process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64');
const moduleUrl = new URL('../../src/adapters/runtime-state/physical/runtime/linux-user-home.ts', import.meta.url).href;

async function probe(source: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const child = Bun.spawn([process.execPath, '--eval', source], {
    env, stdout: 'pipe', stderr: 'pipe', timeout: 5_000
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ]);
  expect(code, stderr).toBe(0);
  return stdout.trim();
}

test.skipIf(!supported)('uses the effective OS account with hostile HOME present before Bun startup', async () => {
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.HOME;
  // Independent runtime API in a clean child is only the reference. In the
  // adversarial child, that same Bun API incorrectly consumes poisoned HOME.
  const expected = await probe('console.log(require("node:os").userInfo().homedir)', cleanEnvironment);
  const hostile = path.join('/tmp', 'sec-home-must-not-be-trusted');
  expect(expected).not.toBe(hostile);
  const actual = await probe(`
    const { resolveLinuxEffectiveUserHome } = await import(${JSON.stringify(moduleUrl)});
    console.log(await resolveLinuxEffectiveUserHome());
  `, { ...process.env, HOME: hostile, USER: 'untrusted-user', LOGNAME: 'untrusted-user',
    GH_CONFIG_DIR: hostile, XDG_CONFIG_HOME: hostile });
  expect(actual).toBe(expected);
});

for (const failure of ['lookup-error', 'missing-record', 'buffer-exhausted', 'foreign-pointer',
  'wrong-user', 'relative-home', 'unterminated-home', 'invalid-utf8'] as const) {
  test.skipIf(!supported)(`fails closed and closes the native library for ${failure}`, async () => {
    const actual = await probe(`
      const { spyOn } = await import('bun:test');
      const ffi = await import('bun:ffi');
      const failure = ${JSON.stringify(failure)};
      const buffers = new Map();
      let next = 0x100000;
      let closed = 0;
      spyOn(ffi, 'ptr').mockImplementation((buffer) => {
          for (const [address, existing] of buffers) if (existing === buffer) return address;
          const address = next;
          next += 0x100000;
          buffers.set(address, buffer);
          return address;
      });
      spyOn(ffi, 'dlopen').mockImplementation(() => {
          return {
            close() { closed += 1; },
            symbols: {
              geteuid() { return 1000; },
              getpwuid_r(uid, accountPointer, storagePointer, size, resultPointer) {
                if (size !== 65536) throw new Error('unbounded account lookup');
                if (failure === 'lookup-error') return 5;
                if (failure === 'buffer-exhausted') return 34;
                if (failure === 'missing-record') return 0;
                const account = buffers.get(accountPointer);
                const storage = buffers.get(storagePointer);
                buffers.get(resultPointer).writeBigUInt64LE(BigInt(accountPointer));
                account.writeUInt32LE(failure === 'wrong-user' ? 999 : uid, 16);
                account.writeBigUInt64LE(BigInt(storagePointer + (failure === 'foreign-pointer' ? size : 0)), 32);
                if (failure === 'unterminated-home') storage.fill(65);
                else if (failure === 'invalid-utf8') storage.set([47, 255, 0]);
                else storage.write(failure === 'relative-home' ? 'relative' : '/home/account');
                return 0;
              }
            }
          };
      });
      const { resolveLinuxEffectiveUserHome } = await import(${JSON.stringify(moduleUrl)});
      let rejected = false;
      try { await resolveLinuxEffectiveUserHome(); } catch { rejected = true; }
      console.log(JSON.stringify({ rejected, closed }));
    `);
    expect(JSON.parse(actual)).toEqual({ rejected: true, closed: 1 });
  });
}
