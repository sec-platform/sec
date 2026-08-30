import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { relocateSemanticMutationIsolatedRunnerBundleForTests } from '../../src/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  probeWindowsAppContainerCapabilityForTests,
  redactWindowsAppContainerProbeCapabilityForTests,
  runWindowsAppContainerChild,
  WINDOWS_APPCONTAINER_RECOVERY_CONTRACT,
  windowsAppContainerCapability,
  WindowsAppContainerExecutionError
} from '../../src/runtime-state/physical/test/windows-appcontainer.ts';
import { acquireWorkspaceWriteLease } from '../../src/workspace/lease.ts';

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
    stderr: 'ignore',
    timeout: 30_000
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
    stderr: 'ignore',
    timeout: 30_000
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
    stderr: 'ignore',
    timeout: 30_000
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

test.serial('Windows AppContainer sentinel proves no outside read/write, no network, Job fence, and recovery', async () => {
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

    const detailedCapability = await probeWindowsAppContainerCapabilityForTests({
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
    const capability = redactWindowsAppContainerProbeCapabilityForTests(detailedCapability);

    expect(detailedCapability).toEqual({ status: 'available' });
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
    if (!await exists(path.join(stagingRoot, '.sm3p'))) {
      await rm(probeRoot, { recursive: true, force: true });
    }
  }
}, 45_000);

test.serial('Windows AppContainer pins attribute payloads, isolates stdio, and evaluates the relocated bundled compiler', async () => {
  if (process.platform !== 'win32') return;

  const workspaceRoot = await mkdtemp(path.join(process.cwd(), '.tmp-appcontainer-bundled-compiler-'));
  const transactionDigest = 'e'.repeat(64);
  const stagingRoot = path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    transactionDigest,
    'workspace'
  );
  const runnerRelativePath =
    '.isolated-compiler/src/compiler/orchestration/bundled-compiler-sentinel.mjs';
  const runnerPath = path.join(stagingRoot, runnerRelativePath);
  const bundleEntryPath = path.join(workspaceRoot, 'bundled-compiler-sentinel.ts');
  const stagedTypeScriptRoot = path.join(
    stagingRoot,
    '.isolated-compiler',
    'node_modules',
    'typescript'
  );
  const stagedTsMorphCommonRoot = path.join(
    stagingRoot,
    '.isolated-compiler',
    'node_modules',
    '@ts-morph',
    'common'
  );
  const resultPath = path.join(stagingRoot, 'bundled-compiler-sentinel.json');
  let lease: Awaited<ReturnType<typeof acquireWorkspaceWriteLease>> | undefined;

  try {
    await mkdir(path.dirname(runnerPath), { recursive: true });
    await Promise.all([
      cp(path.join(process.cwd(), 'package.json'), path.join(stagingRoot, '.isolated-compiler', 'package.json')),
      writeFile(path.join(stagingRoot, '.isolated-compiler', 'bunfig.toml'), '# isolated runtime\n', 'utf8')
    ]);
    await cp(
      path.join(process.cwd(), '.shared-deps', 'node_modules', 'typescript'),
      stagedTypeScriptRoot,
      { recursive: true }
    );
    await cp(
      path.join(process.cwd(), '.shared-deps', 'node_modules', '@ts-morph', 'common'),
      stagedTsMorphCommonRoot,
      { recursive: true }
    );
    await writeFile(bundleEntryPath, [
      `import { assertIsolatedStagingTree } from ${JSON.stringify(path.relative(
        path.dirname(bundleEntryPath),
        path.join(process.cwd(), 'platform', 'compiler', 'verify', 'assert-isolated-staging-tree.ts')
      ).split(path.sep).join('/'))};`,
      "import { parse as parseYaml } from 'yaml';",
      "import { Project } from 'ts-morph';",
      "import typescript from 'typescript';",
      'const stdinText = await Bun.stdin.text();',
      "process.stdout.write('bundled-compiler-stdout-marker');",
      "process.stderr.write('bundled-compiler-stderr-marker');",
      "const sourceFile = typescript.createSourceFile('sentinel.ts', 'const value: number = 1;', typescript.ScriptTarget.Latest);",
      'const project = new Project({ useInMemoryFileSystem: true });',
      "const projectFile = project.createSourceFile('project-sentinel.ts', 'export const value = 1;');",
      "const parsedYaml = parseYaml('value: yaml-ok');",
      "let stagingTreeBoundary = 'passed';",
      "let stagingTreeErrorCode = 'none';",
      "let stagingTreeOperation = 'none';",
      "try { await assertIsolatedStagingTree(process.cwd(), { executionBoundary: 'windows-appcontainer' }); } catch (error) {",
      "  stagingTreeBoundary = error instanceof Error ? error.message : 'unknown';",
      "  stagingTreeErrorCode = error && typeof error === 'object' && 'details' in error &&",
      "    error.details && typeof error.details === 'object' && 'errorCode' in error.details",
      "    ? String(error.details.errorCode) : 'classified';",
      "  stagingTreeOperation = error && typeof error === 'object' && 'details' in error &&",
      "    error.details && typeof error.details === 'object' && 'operation' in error.details",
      "    ? String(error.details.operation) : 'classified';",
      "}",
      "await Bun.write('bundled-compiler-sentinel.json', JSON.stringify({",
      "  ciExact: process.env.CI === 'true',",
      "  yaml: parsedYaml?.value === 'yaml-ok',",
      "  isolatedVerificationExact: process.env.SEC_ISOLATED_VERIFICATION === '1',",
      "  pathExact: process.env.PATH === '',",
      '  stagingTreeBoundary,',
      '  stagingTreeErrorCode,',
      '  stagingTreeOperation,',
      "  stdinEof: stdinText === '',",
      "  systemRootPresent: typeof process.env.SYSTEMROOT === 'string' && process.env.SYSTEMROOT.length > 0,",
      '  typescript: sourceFile.statements.length === 1,',
      "  tsMorph: projectFile.getVariableDeclarationOrThrow('value').getName() === 'value',",
      "  windirPresent: typeof process.env.WINDIR === 'string' && process.env.WINDIR.length > 0",
      '}));',
      ''
    ].join('\n'), 'utf8');
    const build = await Bun.build({
      entrypoints: [bundleEntryPath],
      format: 'esm',
      minify: false,
      sourcemap: 'none',
      splitting: false,
      target: 'bun'
    });
    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    const relocatedBundle = relocateSemanticMutationIsolatedRunnerBundleForTests(
      new Uint8Array(await build.outputs[0]!.arrayBuffer())
    );
    const relocatedSource = new TextDecoder().decode(relocatedBundle);
    expect(relocatedSource).not.toContain(path.resolve(process.cwd()));
    expect(relocatedSource).toContain('__secSemanticMutationRuntimePathV1');
    await writeFile(runnerPath, relocatedBundle);

    const processRoot = path.join(stagingRoot, '.process');
    const directories = {
      home: path.join(processRoot, 'home'),
      appData: path.join(processRoot, 'appdata'),
      localAppData: path.join(processRoot, 'localappdata'),
      temp: path.join(processRoot, 'tmp')
    };
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
    lease = await acquireWorkspaceWriteLease(workspaceRoot);
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (!systemRoot) throw new Error('Windows system root is unavailable for the sentinel');

    const execution = await runWindowsAppContainerChild({
      stagingRoot,
      runnerRelativePath,
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
        TZ: 'UTC',
        CI: 'true',
        SEC_ISOLATED_VERIFICATION: '1'
      },
      workspaceRoot,
      workspaceWriteLease: lease.token,
      timeoutMs: 20_000
    });
    expect(execution).toEqual({ exitCode: 0 });
    expect(JSON.parse(await readFile(resultPath, 'utf8'))).toEqual({
      ciExact: true,
      yaml: true,
      isolatedVerificationExact: true,
      pathExact: true,
      stagingTreeBoundary: 'passed',
      stagingTreeErrorCode: 'none',
      stagingTreeOperation: 'none',
      stdinEof: true,
      systemRootPresent: true,
      typescript: true,
      tsMorph: true,
      windirPresent: true
    });
  } finally {
    await lease?.release().catch(() => undefined);
    await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}, 60_000);

test.serial('Windows AppContainer canonical workspace just beyond MAX_PATH launches or fails closed cleanly', async () => {
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
    WINDOWS_APPCONTAINER_RECOVERY_CONTRACT.ownerFileName
  );
  const nativeResultPath = path.join(
    transactionRoot,
    WINDOWS_APPCONTAINER_RECOVERY_CONTRACT.resultFileName
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

    const capability = windowsAppContainerCapability();
    expect(Object.keys(capability)).toEqual(['status']);
    expect(capability).toEqual({ status: 'available' });
    let execution: Awaited<ReturnType<typeof runWindowsAppContainerChild>> | undefined;
    let cleanLaunchFailure: WindowsAppContainerExecutionError | undefined;
    try {
      execution = await runWindowsAppContainerChild({
        stagingRoot,
        runnerRelativePath: path.basename(runnerPath),
        environment,
        workspaceRoot,
        workspaceWriteLease: lease.token,
        timeoutMs: 12_000
      });
    } catch (error) {
      expect(error).toBeInstanceOf(WindowsAppContainerExecutionError);
      cleanLaunchFailure = error as WindowsAppContainerExecutionError;
      expect({
        code: cleanLaunchFailure.code,
        phase: cleanLaunchFailure.phase,
        nativeCode: cleanLaunchFailure.nativeCode
      }).toEqual({
        code: 'VERIFY-APPCONTAINER-EXECUTION',
        phase: 'launch',
        nativeCode: 267
      });
    }

    if (execution) {
      expect(execution).toEqual({ exitCode: 0 });
      const marker = JSON.parse(await readFile(processMarkerPath, 'utf8')) as unknown;
      expect(marker && typeof marker === 'object' && !Array.isArray(marker)).toBe(true);
      expect(Object.keys(marker as object)).toEqual(['processId']);
      const processId = Number((marker as { readonly processId?: unknown }).processId);
      expect(Number.isSafeInteger(processId) && processId > 0).toBe(true);
      expect(processIsAlive(processId)).toBe(false);
      await rm(processMarkerPath, { force: true });
    } else {
      expect(cleanLaunchFailure).toBeDefined();
      expect(await exists(processMarkerPath)).toBe(false);
    }

    await waitForNoWindowsProcessesReferencingPath(systemRoot, workspaceRoot);
    expect(readSecAppContainerProfiles(regPath)).toEqual(profilesBefore);
    expect(await exists(ownerPath)).toBe(false);
    expect(await exists(`${ownerPath}.pending-v1`)).toBe(false);
    expect(await exists(path.join(
      transactionRoot,
      '.semantic-mutation-appcontainer-provisional-owner-v1.json'
    ))).toBe(false);
    expect(await exists(path.join(
      transactionRoot,
      '.semantic-mutation-appcontainer-provisional-owner-v1.json.pending-v1'
    ))).toBe(false);
    expect(await exists(nativeResultPath)).toBe(false);
    expect(await exists(path.join(
      stagingRoot,
      WINDOWS_APPCONTAINER_RECOVERY_CONTRACT.runtimeRelativePath
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
