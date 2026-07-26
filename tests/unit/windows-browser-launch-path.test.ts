import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  acquireBrowserLaunchPath,
  acquireBrowserLaunchPathForTests,
  assertRegisteredWindowsBrowserLaunchProofCurrent
} from '../../platform/compiler/verify/windows-browser-launch-path.ts';
import { runCommand } from '../../platform/shared/process.ts';

const EXECUTABLE_RELATIVE_PATH =
  'chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';

test.skipIf(process.platform !== 'win32')(
  'production Windows browser launch authority hardens and removes its private host root',
  async () => {
    const input = await fixture();
    try {
      const lease = await acquireBrowserLaunchPath(
        input.browserRoot,
        EXECUTABLE_RELATIVE_PATH
      );
      const authorityRoot = path.dirname(path.dirname(lease.browsersPath));
      await lease.assertCurrent();
      await lease.release();
      await expect(lstat(authorityRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(input.root, { recursive: true, force: true });
    }
  }
);

async function fixture(): Promise<Readonly<{
  browserRoot: string;
  executablePath: string;
  root: string;
  temporaryRoot: string;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-browser-launch-test-'));
  const browserRoot = path.join(root, 'physical-browser-cache');
  const executablePath = path.join(browserRoot, ...EXECUTABLE_RELATIVE_PATH.split('/'));
  const temporaryRoot = path.join(root, 'temporary-authority');
  await Promise.all([
    mkdir(path.dirname(executablePath), { recursive: true }),
    mkdir(temporaryRoot, { recursive: true })
  ]);
  await writeFile(executablePath, Buffer.from('exact-browser-executable'));
  return Object.freeze({ browserRoot, executablePath, root, temporaryRoot });
}

test('Windows browser launch projection binds one physical cache and cleans its lease', async () => {
  const input = await fixture();
  try {
    const lease = await acquireBrowserLaunchPathForTests(
      input.browserRoot,
      EXECUTABLE_RELATIVE_PATH,
      {
        platform: 'win32',
        proveTemporaryAuthority: async () => undefined,
        temporaryRoot: input.temporaryRoot
      }
    );
    const projectedExecutable = path.join(
      lease.browsersPath,
      ...EXECUTABLE_RELATIVE_PATH.split('/')
    );
    expect(lease.browsersPath).not.toBe(input.browserRoot);
    expect(path.relative(input.temporaryRoot, lease.browsersPath).startsWith('..')).toBe(false);
    expect(await realpath(lease.browsersPath)).toBe(await realpath(input.browserRoot));
    expect(await realpath(projectedExecutable)).toBe(await realpath(input.executablePath));
    expect(await readFile(projectedExecutable)).toEqual(await readFile(input.executablePath));
    await lease.assertCurrent();

    const leaseRoot = path.dirname(lease.browsersPath);
    await lease.release();
    await expect(lstat(lease.browsersPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(leaseRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await lease.release();
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test('POSIX browser launch path remains the exact physical staging cache', async () => {
  const input = await fixture();
  try {
    const lease = await acquireBrowserLaunchPathForTests(
      input.browserRoot,
      EXECUTABLE_RELATIVE_PATH,
      {
        platform: 'linux',
        temporaryRoot: input.temporaryRoot
      }
    );
    expect(lease.browsersPath).toBe(path.resolve(input.browserRoot));
    expect(await readdir(input.temporaryRoot)).toEqual([]);
    await lease.assertCurrent();
    await lease.release();
    expect(await readFile(input.executablePath, 'utf8')).toBe('exact-browser-executable');
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test('browser launch projection rejects target swaps without deleting unowned data', async () => {
  const input = await fixture();
  const outsideRoot = path.join(input.root, 'outside-browser-cache');
  const outsideExecutable = path.join(
    outsideRoot,
    ...EXECUTABLE_RELATIVE_PATH.split('/')
  );
  await mkdir(path.dirname(outsideExecutable), { recursive: true });
  await writeFile(outsideExecutable, Buffer.from('outside-browser-executable'));
  const lease = await acquireBrowserLaunchPathForTests(
    input.browserRoot,
    EXECUTABLE_RELATIVE_PATH,
    {
      platform: 'win32',
      proveTemporaryAuthority: async () => undefined,
      temporaryRoot: input.temporaryRoot
    }
  );
  const leaseRoot = path.dirname(lease.browsersPath);
  try {
    await unlink(lease.browsersPath);
    await symlink(
      outsideRoot,
      lease.browsersPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(lease.assertCurrent()).rejects.toThrow(
      'Browser launch projection changed before launch'
    );
    await expect(lease.release()).rejects.toThrow(
      'Browser launch projection changed before launch'
    );
    await expect(lstat(lease.browsersPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(leaseRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(outsideExecutable, 'utf8')).toBe('outside-browser-executable');
  } finally {
    const metadata = await lstat(lease.browsersPath).catch(() => null);
    if (metadata?.isSymbolicLink()) await unlink(lease.browsersPath);
    await rm(leaseRoot, { recursive: true, force: true });
    await rm(input.root, { recursive: true, force: true });
  }
});

test('browser launch proof rejects a post-readiness target swap at the command pre-spawn boundary', async () => {
  const input = await fixture();
  const outsideRoot = path.join(input.root, 'race-browser-cache');
  const outsideExecutable = path.join(
    outsideRoot,
    ...EXECUTABLE_RELATIVE_PATH.split('/')
  );
  const markerPath = path.join(input.root, 'browser-command-spawned');
  await mkdir(path.dirname(outsideExecutable), { recursive: true });
  await writeFile(outsideExecutable, Buffer.from('race-browser-executable'));
  const lease = await acquireBrowserLaunchPathForTests(
    input.browserRoot,
    EXECUTABLE_RELATIVE_PATH,
    {
      platform: 'win32',
      proveTemporaryAuthority: async () => undefined,
      temporaryRoot: input.temporaryRoot
    }
  );
  const leaseRoot = path.dirname(lease.browsersPath);
  try {
    await assertRegisteredWindowsBrowserLaunchProofCurrent(
      input.browserRoot,
      lease.browsersPath,
      lease.proofArgument
    );
    await unlink(lease.browsersPath);
    await symlink(
      outsideRoot,
      lease.browsersPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(runCommand(process.execPath, [
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'spawned')`
    ], {
      beforeSpawn: async () => await assertRegisteredWindowsBrowserLaunchProofCurrent(
        input.browserRoot,
        lease.browsersPath,
        lease.proofArgument
      ),
      cwd: input.root
    })).rejects.toThrow('Browser launch proof changed before browser spawn');
    await expect(lstat(markerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await lease.release().catch(() => undefined);
    const metadata = await lstat(lease.browsersPath).catch(() => null);
    if (metadata?.isSymbolicLink()) await unlink(lease.browsersPath);
    await rm(leaseRoot, { recursive: true, force: true });
    await rm(input.root, { recursive: true, force: true });
  }
});

test('browser launch projection rejects a physical but untrusted host root before creating residue', async () => {
  const input = await fixture();
  try {
    await expect(acquireBrowserLaunchPathForTests(
      input.browserRoot,
      EXECUTABLE_RELATIVE_PATH,
      {
        platform: 'win32',
        proveTemporaryAuthority: async () => {
          throw new Error('physical host root has an untrusted writer');
        },
        temporaryRoot: input.temporaryRoot
      }
    )).rejects.toThrow('physical host root has an untrusted writer');
    expect(await readdir(input.temporaryRoot)).toEqual([]);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test('browser launch projection fails closed when the executable path is not launch-compatible', async () => {
  const input = await fixture();
  try {
    await expect(acquireBrowserLaunchPathForTests(
      input.browserRoot,
      EXECUTABLE_RELATIVE_PATH,
      {
        maxLaunchPathLength: 1,
        platform: 'win32',
        proveTemporaryAuthority: async () => undefined,
        temporaryRoot: input.temporaryRoot
      }
    )).rejects.toThrow('exceeds the Win32 launch path limit');
    expect(await readdir(input.temporaryRoot)).toEqual([]);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test('browser launch projection rejects non-canonical executable paths', async () => {
  const input = await fixture();
  try {
    await expect(acquireBrowserLaunchPathForTests(
      input.browserRoot,
      '../outside.exe',
      {
        platform: 'win32',
        proveTemporaryAuthority: async () => undefined,
        temporaryRoot: input.temporaryRoot
      }
    )).rejects.toThrow('must be a canonical relative path');
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});
