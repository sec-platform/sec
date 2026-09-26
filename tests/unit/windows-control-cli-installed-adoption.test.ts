import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
  getWindowsControlCliExecutableBinding,
  parseWindowsControlCliEnvironmentAuthority
} from '../../src/adapters/providers/windows-control-cli/contract/environment.ts';
import {
  WindowsControlCliInstalledAdoptionError,
  adoptInstalledWindowsControlCli
} from '../../src/adapters/providers/windows-control-cli/runtime/installed-adoption.ts';

function installedRoot(command: 'git' | 'gh'): string {
  const locator = Bun.which(command);
  if (locator === null) throw new Error(`${command} is not installed for the Windows provider test`);
  const binding = getWindowsControlCliExecutableBinding(
    WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
    command
  );
  if (binding === null) throw new Error(`${command} has no installed profile binding`);
  const locatorKey = path.win32.normalize(locator).toLocaleLowerCase('en-US');
  for (const layout of binding.candidateLayouts) {
    const relative = layout.candidateRelativePath.replaceAll('/', '\\');
    if (!locatorKey.endsWith(relative.toLocaleLowerCase('en-US'))) continue;
    return path.win32.normalize(locator.slice(0, locator.length - relative.length)
      .replace(/[\\/]+$/u, ''));
  }
  throw new Error(`${command} locator is outside the installed profile layouts`);
}

async function copyBinding(command: 'git' | 'gh', targetRoot: string): Promise<void> {
  const sourceRoot = installedRoot(command);
  const binding = getWindowsControlCliExecutableBinding(
    WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
    command
  )!;
  const entries = new Map([
    ...binding.launcherEntries,
    binding.effectiveEntry,
    ...binding.appLocalModules
  ].map((entry) => [entry.relativePath.toLocaleLowerCase('en-US'), entry] as const));
  for (const entry of entries.values()) {
    const destination = path.win32.join(targetRoot, entry.relativePath);
    await mkdir(path.win32.dirname(destination), { recursive: true });
    await copyFile(path.win32.join(sourceRoot, entry.relativePath), destination);
  }
}

const windowsTest = test.skipIf(process.platform !== 'win32' || process.arch !== 'x64');

windowsTest.serial('installed adopter authenticates exact bytes and pins replacement until disposal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-control-cli-'));
  const gitRoot = path.win32.join(root, 'Git');
  const ghRoot = path.win32.join(root, 'GitHub CLI');
  await copyBinding('git', gitRoot);
  await copyBinding('gh', ghRoot);
  const deadline = {
    remainingMs: () => 30_000,
    assertLive() {}
  };
  try {
    const environment = {
      PATH: `${path.win32.join(gitRoot, 'bin')};${ghRoot}`,
      PROGRAMFILES: path.win32.join(root, 'program-files-none'),
      PROGRAMW6432: path.win32.join(root, 'program-files-none'),
      LOCALAPPDATA: path.win32.join(root, 'local-app-data-none')
    };
    const adoption = adoptInstalledWindowsControlCli({
      spec: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
      workingDirectory: root,
      deadline,
      budget: {
        maxRootObservedBytes: 128 * 1024 * 1024,
        maxExecutableObservedBytes: 128 * 1024 * 1024,
        maxRecords: 64
      },
      environment
    });
    expect(adoption.providerRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.hasOwn(adoption, 'commands')).toBe(false);
    const gh = path.win32.join(ghRoot, 'gh.exe');
    await expect(rename(gh, path.win32.join(ghRoot, 'gh.displaced.exe'))).rejects.toThrow();
    adoption.assertCurrent();
    adoption.dispose();

    const bytes = await readFile(gh);
    bytes[0] = bytes[0]! ^ 0xff;
    await writeFile(gh, bytes);
    expect(() => adoptInstalledWindowsControlCli({
      spec: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
      workingDirectory: root,
      deadline,
      budget: {
        maxRootObservedBytes: 128 * 1024 * 1024,
        maxExecutableObservedBytes: 128 * 1024 * 1024,
        maxRecords: 64
      },
      environment
    })).toThrow(WindowsControlCliInstalledAdoptionError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

windowsTest('installed adopter returns typed unknown without a matching physical closure', () => {
  expect(() => adoptInstalledWindowsControlCli({
    spec: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY,
    workingDirectory: process.cwd(),
    deadline: { remainingMs: () => 30_000, assertLive() {} },
    budget: {
      maxRootObservedBytes: 128 * 1024 * 1024,
      maxExecutableObservedBytes: 128 * 1024 * 1024,
      maxRecords: 64
    },
    environment: {
      PATH: '',
      PROGRAMFILES: String.raw`Z:\missing`,
      PROGRAMW6432: String.raw`Z:\missing`,
      LOCALAPPDATA: String.raw`Z:\missing`
    }
  })).toThrow('installed-executable-capability-unproven');
});

windowsTest.serial('installed adopter rejects manifest-authenticated bytes without a valid PE loader closure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-control-cli-loader-'));
  const gitRoot = path.win32.join(root, 'Git');
  const ghRoot = path.win32.join(root, 'GitHub CLI');
  await copyBinding('git', gitRoot);
  await copyBinding('gh', ghRoot);
  try {
    const ghPath = path.win32.join(ghRoot, 'gh.exe');
    const bytes = await readFile(ghPath);
    bytes[0] = 0;
    await writeFile(ghPath, bytes);
    const { specDigest: _specDigest, ...authority } = structuredClone(
      WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY
    );
    const gh = authority.executableBindings.find(({ id }) => id === 'gh')!;
    gh.executableEntries[0]!.observedSha256 = createHash('sha256').update(bytes).digest('hex');
    const spec = parseWindowsControlCliEnvironmentAuthority(authority);
    expect(() => adoptInstalledWindowsControlCli({
      spec,
      workingDirectory: root,
      deadline: { remainingMs: () => 30_000, assertLive() {} },
      budget: {
        maxRootObservedBytes: 128 * 1024 * 1024,
        maxExecutableObservedBytes: 128 * 1024 * 1024,
        maxRecords: 64
      },
      environment: {
        PATH: `${path.win32.join(gitRoot, 'bin')};${ghRoot}`,
        PROGRAMFILES: path.win32.join(root, 'program-files-none'),
        PROGRAMW6432: path.win32.join(root, 'program-files-none'),
        LOCALAPPDATA: path.win32.join(root, 'local-app-data-none')
      }
    })).toThrow('installed-loader-closure-unproven');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
