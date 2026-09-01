import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary
} from '../../../runtime-state/physical/runtime/process.ts';
import { rawSha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  assertDockerCommandProviderCapability,
  claimDockerCommandProviderCapability,
  disposeUnclaimedDockerCommandProviderCapability,
  issueDockerCommandProviderCapability,
  requireDockerCommandProviderCapability
} from './command-provider.ts';

async function retainedProviderFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-docker-command-provider-'));
  const executablePath = path.join(root, process.platform === 'win32' ? 'docker.exe' : 'docker');
  await writeFile(executablePath, Buffer.from('provider-bytes'));
  const directory = inspectNoFollowDirectoryChain(root, 'Docker provider fixture root');
  const executableEntry = inspectNoFollowOrdinaryFileEntry(
    directory.target,
    path.basename(executablePath)
  );
  if (executableEntry === null || executableEntry.kind !== 'file') {
    throw new Error('Docker provider fixture executable is unavailable.');
  }
  const executable = retainNoFollowOrdinaryFile(
    directory,
    path.basename(executablePath),
    { device: executableEntry.device, inode: executableEntry.inode },
    'Docker provider fixture executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    directory,
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'Docker provider fixture cwd'
  );
  const environment = process.platform === 'win32'
    ? {
      APPDATA: root,
      HOME: root,
      LOCALAPPDATA: root,
      PATH: '',
      PROGRAMDATA: root,
      PROGRAMFILES: root,
      SYSTEMROOT: root,
      TEMP: root,
      TMP: root,
      USERPROFILE: root,
      WINDIR: root
    }
    : { HOME: root, PATH: '', TEMP: root, TMP: root };
  const capability = issueDockerCommandProviderCapability({
    boundary: issueRetainedCommandBoundary({ executable, workingDirectory }),
    environment,
    platform: process.platform,
    providerContractDigest: rawSha256('sec.docker.command-provider.fixture'),
    workingDirectory: directory.target
  });
  return { capability, executablePath, root };
}

test('Docker command provider ignores ambient command and directory redirection', async () => {
  const fixture = await retainedProviderFixture();
  let claimed: ReturnType<typeof claimDockerCommandProviderCapability> | undefined;
  const original = {
    PATH: process.env.PATH,
    PROGRAMFILES: process.env.PROGRAMFILES,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP
  };
  try {
    process.env.PATH = path.join(fixture.root, 'ambient-bin');
    process.env.PROGRAMFILES = path.join(fixture.root, 'ambient-program-files');
    process.env.TEMP = path.join(fixture.root, 'ambient-temp');
    process.env.TMP = path.join(fixture.root, 'ambient-tmp');
    expect('loginStart' in fixture.capability).toBe(false);
    claimed = claimDockerCommandProviderCapability(fixture.capability);
    expect('loginStart' in claimed).toBe(false);
    expect(claimed.executable).toBe(fixture.executablePath);
    expect(claimed.environment.PATH).toBe('');
    expect(claimed.environment.TEMP).toBe(fixture.root);
    expect(claimed.environment.PROGRAMFILES).toBe(fixture.root);
  } finally {
    claimed?.boundary.workingDirectory.dispose();
    claimed?.boundary.executable.dispose();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('Docker command provider is nonforgeable, single-use, and rejects ambient PATH', async () => {
  const fixture = await retainedProviderFixture();
  try {
    expect(() => assertDockerCommandProviderCapability({ ...fixture.capability }))
      .toThrow('not owner-issued');
    expect(() => requireDockerCommandProviderCapability(undefined))
      .toThrow('capability is unavailable');
    const claimed = claimDockerCommandProviderCapability(fixture.capability);
    expect(() => claimDockerCommandProviderCapability(fixture.capability))
      .toThrow('is claimed');
    claimed.boundary.workingDirectory.dispose();
    claimed.boundary.executable.dispose();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('Docker command provider retains executable identity through replacement attempts', async () => {
  const fixture = await retainedProviderFixture();
  try {
    const replacement = path.join(fixture.root, 'replacement.exe');
    await writeFile(replacement, Buffer.from('replacement'));
    const replacementAttempt = rename(replacement, fixture.executablePath);
    if (process.platform === 'win32') {
      await expect(replacementAttempt).rejects.toBeDefined();
    } else {
      await replacementAttempt;
      const claimed = claimDockerCommandProviderCapability(fixture.capability);
      expect(() => claimed.boundary.executable.assertCurrent()).toThrow();
      claimed.boundary.workingDirectory.dispose();
      claimed.boundary.executable.dispose();
      return;
    }
    const claimed = claimDockerCommandProviderCapability(fixture.capability);
    claimed.boundary.executable.assertCurrent();
    claimed.boundary.workingDirectory.dispose();
    claimed.boundary.executable.dispose();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('unclaimed Docker command provider can be settled without a session', async () => {
  const fixture = await retainedProviderFixture();
  try {
    disposeUnclaimedDockerCommandProviderCapability(fixture.capability);
    expect(() => claimDockerCommandProviderCapability(fixture.capability))
      .toThrow('is disposed');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
