import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  probeWindowsAppContainerCapability,
  runWindowsAppContainerChild,
  WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1,
  WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1,
  WindowsAppContainerCapabilityUnavailableError,
  windowsAppContainerCapability
} from '../../platform/shared/windows-appcontainer-executor.ts';
import { acquireWorkspaceWriteLease } from '../../platform/shared/workspace-write-lease.ts';

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function readAcl(icaclsPath: string, targetPath: string): string {
  const result = Bun.spawnSync([icaclsPath, targetPath], {
    env: { PATH: '', SystemRoot: path.dirname(path.dirname(icaclsPath)) },
    stderr: 'ignore'
  });
  if (result.exitCode !== 0) throw new Error('ACL probe failed');
  return result.stdout.toString();
}

function readSecAppContainerProfiles(regPath: string): readonly string[] {
  const result = Bun.spawnSync([
    regPath,
    'query',
    'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings',
    '/s',
    '/f',
    'sec.sm3.',
    '/d'
  ], {
    env: { PATH: '', SystemRoot: path.dirname(path.dirname(regPath)) },
    stderr: 'ignore'
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error('profile probe failed');
  return Object.freeze(result.stdout.toString()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /sec\.sm3\./iu.test(line))
    .sort());
}

function windowsProcessesReferencingPath(systemRoot: string, targetPath: string): readonly number[] {
  const powershellPath = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const encodedTarget = Buffer.from(targetPath, 'utf16le').toString('base64');
  const script = [
    `$needle=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedTarget}'))`,
    '$ids=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like (\'*\'+$needle+\'*\') } | Select-Object -ExpandProperty ProcessId)',
    '[Console]::Out.Write((ConvertTo-Json -Compress -InputObject $ids))'
  ].join(';');
  const result = Bun.spawnSync([
    powershellPath,
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ], {
    env: { PATH: '', SystemRoot: systemRoot, WINDIR: systemRoot },
    stderr: 'ignore'
  });
  if (result.exitCode !== 0) throw new Error('process residue probe failed');
  const parsed = JSON.parse(result.stdout.toString() || '[]') as unknown;
  const processIds = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed];
  if (processIds.some((entry) => !Number.isSafeInteger(entry) || Number(entry) <= 0)) {
    throw new Error('invalid process residue probe');
  }
  return Object.freeze(processIds.map(Number).sort((left, right) => left - right));
}

async function waitForNoWindowsProcessesReferencingPath(
  systemRoot: string,
  targetPath: string
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2_000) {
    if (windowsProcessesReferencingPath(systemRoot, targetPath).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('AppContainer process residue remains');
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

test('Windows AppContainer native structure contract is frozen with no capabilities', () => {
  expect(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1).toEqual({
    pointerBytes: 8,
    securityCapabilitiesBytes: 24,
    securityCapabilitiesAppContainerSidOffset: 0,
    securityCapabilitiesCapabilitiesOffset: 8,
    securityCapabilitiesCapabilityCountOffset: 16,
    securityCapabilitiesReservedOffset: 20,
    startupInfoExBytes: 112,
    startupInfoExAttributeListOffset: 104,
    processInformationBytes: 24,
    processInformationProcessHandleOffset: 0,
    processInformationThreadHandleOffset: 8,
    jobObjectExtendedLimitInformationBytes: 144,
    jobObjectLimitFlagsOffset: 16,
    procThreadAttributeSecurityCapabilities: 0x0002_0009,
    capabilityCount: 0,
    reserved: 0,
    creationFlags: 0x0808_0404,
    jobLimitFlags: 0x0000_2000
  });
  expect(Object.isFrozen(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1)).toBe(true);
  expect(WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1).toEqual({
    formatVersion: 'windows-appcontainer-recovery-owner-v1',
    ownerFileName: '.semantic-mutation-appcontainer-owner-v1.json',
    resultFileName: '.semantic-mutation-appcontainer-result-v1.json',
    runtimeRelativePath: '.sm3r'
  });
  expect(Object.isFrozen(WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1)).toBe(true);
});

test('non-Windows hosts report capability unavailable without a spawn fallback', async () => {
  if (process.platform === 'win32') {
    expect(windowsAppContainerCapability()).toEqual({ status: 'available' });
    return;
  }
  expect(windowsAppContainerCapability()).toEqual({
    status: 'unavailable',
    reason: 'non-windows'
  });
  await expect(runWindowsAppContainerChild({
    stagingRoot: '.',
    runnerRelativePath: 'runner.mjs',
    environment: {},
    workspaceRoot: '.',
    workspaceWriteLease: {} as never
  })).rejects.toBeInstanceOf(WindowsAppContainerCapabilityUnavailableError);
});

test('Windows AppContainer sentinel proves no outside read/write, no network, Job fence, and recovery', async () => {
  if (process.platform !== 'win32') return;

  const probeRoot = await mkdtemp(path.join(process.cwd(), '.tmp-appcontainer-probe-'));
  const stagingRoot = path.join(probeRoot, 'staging');
  await mkdir(stagingRoot);
  const lease = await acquireWorkspaceWriteLease(probeRoot);
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) throw new Error('Windows system root is unavailable for the probe');
  const icaclsPath = path.join(systemRoot, 'System32', 'icacls.exe');

  try {
    const processRoot = path.join(stagingRoot, '.process');
    const directories = {
      home: path.join(processRoot, 'home'),
      appData: path.join(processRoot, 'appdata'),
      localAppData: path.join(processRoot, 'localappdata'),
      temp: path.join(processRoot, 'tmp')
    };
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
    const parentAclBefore = readAcl(icaclsPath, path.dirname(stagingRoot));
    const rootAclBefore = readAcl(icaclsPath, stagingRoot);

    const capability = await probeWindowsAppContainerCapability({
      stagingRoot,
      timeoutMs: 12_000,
      workspaceRoot: probeRoot,
      workspaceWriteLease: lease.token,
      environment: {
        PATH: '',
        SYSTEMROOT: systemRoot,
        WINDIR: systemRoot,
        HOME: directories.home,
        USERPROFILE: directories.home,
        APPDATA: directories.appData,
        LOCALAPPDATA: directories.localAppData,
        TEMP: directories.temp,
        TMP: directories.temp,
        TMPDIR: directories.temp,
        LANG: 'C',
        LC_ALL: 'C',
        TZ: 'UTC'
      }
    });

    expect(capability).toEqual({ status: 'available' });
    expect(Object.keys(capability)).toEqual(['status']);
    expect(await exists(path.join(
      stagingRoot,
      '.sm3p'
    ))).toBe(false);
    expect(readAcl(icaclsPath, path.dirname(stagingRoot))).toBe(parentAclBefore);
    expect(readAcl(icaclsPath, stagingRoot)).toBe(rootAclBefore);
  } finally {
    await lease.release();
    await rm(probeRoot, { recursive: true, force: true });
  }
}, 45_000);

test('Windows AppContainer canonical workspace just beyond MAX_PATH launches or fails closed cleanly', async () => {
  if (process.platform !== 'win32') return;

  const maxPath = 260;
  const transactionDigest = 'a'.repeat(64);
  const stagingRelativePath = path.join(
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    transactionDigest,
    'workspace'
  );
  const tempPrefix = path.join(process.cwd(), '.tmp-appcontainer-long-path-');
  const randomSuffixLength = 6;
  const paddingLength = maxPath + 1 - tempPrefix.length - randomSuffixLength - 1 -
    stagingRelativePath.length;
  if (paddingLength < 1) throw new Error('test workspace is already too long');

  const workspaceRoot = await mkdtemp(`${tempPrefix}${'x'.repeat(paddingLength)}`);
  const stagingRoot = path.join(workspaceRoot, stagingRelativePath);
  const transactionRoot = path.dirname(stagingRoot);
  const runnerPath = path.join(stagingRoot, 'long-path-runner.mjs');
  const processMarkerPath = path.join(stagingRoot, 'long-path-process.json');
  const ownerPath = path.join(
    transactionRoot,
    WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1.ownerFileName
  );
  const nativeResultPath = path.join(
    transactionRoot,
    WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1.resultFileName
  );
  let lease: Awaited<ReturnType<typeof acquireWorkspaceWriteLease>> | undefined;

  try {
    expect(stagingRoot.length).toBe(maxPath + 1);
    expect(path.relative(workspaceRoot, stagingRoot).split(path.sep).join('/')).toBe(
      `.sec/semantic-mutation/v1/transactions/${transactionDigest}/workspace`
    );
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(
      runnerPath,
      "await Bun.write('long-path-process.json', JSON.stringify({ processId: process.pid }));\n"
    );

    const processRoot = path.join(stagingRoot, '.process');
    const directories = {
      home: path.join(processRoot, 'home'),
      appData: path.join(processRoot, 'appdata'),
      localAppData: path.join(processRoot, 'localappdata'),
      temp: path.join(processRoot, 'tmp'),
      isolatedProcess: path.join(stagingRoot, '.isolated-process')
    };
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
    lease = await acquireWorkspaceWriteLease(workspaceRoot);

    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (!systemRoot) throw new Error('Windows system root is unavailable for the probe');
    const icaclsPath = path.join(systemRoot, 'System32', 'icacls.exe');
    const regPath = path.join(systemRoot, 'System32', 'reg.exe');
    const environment = Object.freeze({
      PATH: '',
      SYSTEMROOT: systemRoot,
      WINDIR: systemRoot,
      HOME: directories.home,
      USERPROFILE: directories.home,
      APPDATA: directories.appData,
      LOCALAPPDATA: directories.localAppData,
      TEMP: directories.temp,
      TMP: directories.temp,
      TMPDIR: directories.temp,
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
      CI: 'true',
      SEC_ISOLATED_VERIFICATION: '1'
    });
    const aclTargets = [
      stagingRoot,
      runnerPath,
      ...Object.values(directories)
    ];
    const aclBefore = aclTargets.map((target) => readAcl(icaclsPath, target));
    const profilesBefore = readSecAppContainerProfiles(regPath);

    const capability = await probeWindowsAppContainerCapability({
      stagingRoot,
      timeoutMs: 12_000,
      workspaceRoot,
      workspaceWriteLease: lease.token,
      environment
    });
    expect(Object.keys(capability)).toEqual(['status']);
    if (capability.status === 'available') {
      const execution = await runWindowsAppContainerChild({
        stagingRoot,
        runnerRelativePath: path.basename(runnerPath),
        environment,
        workspaceRoot,
        workspaceWriteLease: lease.token,
        timeoutMs: 12_000
      });
      expect(execution).toEqual({ exitCode: 0 });
      const marker = JSON.parse(await readFile(processMarkerPath, 'utf8')) as unknown;
      expect(marker && typeof marker === 'object' && !Array.isArray(marker)).toBe(true);
      expect(Object.keys(marker as object)).toEqual(['processId']);
      const processId = Number((marker as { readonly processId?: unknown }).processId);
      expect(Number.isSafeInteger(processId) && processId > 0).toBe(true);
      expect(processIsAlive(processId)).toBe(false);
      await rm(processMarkerPath, { force: true });
    } else {
      expect(capability).toEqual({ status: 'unavailable' });
    }

    await waitForNoWindowsProcessesReferencingPath(systemRoot, workspaceRoot);
    expect(readSecAppContainerProfiles(regPath)).toEqual(profilesBefore);
    expect(await exists(ownerPath)).toBe(false);
    expect(await exists(nativeResultPath)).toBe(false);
    expect(await exists(path.join(
      stagingRoot,
      WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1.runtimeRelativePath
    ))).toBe(false);
    expect(await exists(path.join(stagingRoot, '.sm3h'))).toBe(false);
    expect(await exists(path.join(stagingRoot, '.sm3p'))).toBe(false);
    expect(aclTargets.map((target) => readAcl(icaclsPath, target))).toEqual(aclBefore);
  } finally {
    await lease?.release().catch(() => undefined);
    if (!await exists(ownerPath)) {
      await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  }
}, 90_000);
