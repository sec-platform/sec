import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { relocateSemanticMutationIsolatedRunnerBundleForTests } from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  createWindowsAppContainerNativeHelperBundleLoaderForTests,
  encodeWindowsAppContainerNativeDerivedSid,
  encodeWindowsAppContainerNativeFailure,
  encodeWindowsAppContainerNativeOk,
  probeWindowsAppContainerCapabilityForTests,
  publishWindowsAppContainerProvisionalOwnerForTests,
  recoverWindowsAppContainerProvisionalOwnerForTests,
  redactWindowsAppContainerProbeCapabilityForTests,
  runWindowsAppContainerChild,
  settleWindowsAppContainerNativeHelperInvocationForTests,
  WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1,
  WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1,
  windowsAppContainerCapability,
  WindowsAppContainerCapabilityUnavailableError,
  WindowsAppContainerExecutionError,
  windowsAppContainerNativeHelperObservationForTests
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

test('Windows AppContainer native structure contract is frozen with no capabilities', () => {
  expect(WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1).toEqual({
    pointerBytes: 8,
    securityAttributesBytes: 24,
    securityAttributesLengthOffset: 0,
    securityAttributesDescriptorOffset: 8,
    securityAttributesInheritHandleOffset: 16,
    securityCapabilitiesBytes: 24,
    securityCapabilitiesAppContainerSidOffset: 0,
    securityCapabilitiesCapabilitiesOffset: 8,
    securityCapabilitiesCapabilityCountOffset: 16,
    securityCapabilitiesReservedOffset: 20,
    startupInfoExBytes: 112,
    startupInfoExFlagsOffset: 60,
    startupInfoExStdInputOffset: 80,
    startupInfoExStdOutputOffset: 88,
    startupInfoExStdErrorOffset: 96,
    startupInfoExAttributeListOffset: 104,
    processInformationBytes: 24,
    processInformationProcessHandleOffset: 0,
    processInformationThreadHandleOffset: 8,
    jobObjectExtendedLimitInformationBytes: 144,
    jobObjectLimitFlagsOffset: 16,
    procThreadAttributeHandleList: 0x0002_0002,
    procThreadAttributeSecurityCapabilities: 0x0002_0009,
    procThreadAttributeCount: 2,
    standardHandleCount: 3,
    startfUseStdHandles: 0x0000_0100,
    inheritHandles: 1,
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

test('Windows AppContainer helper observations are finite and redact protocol content', () => {
  const captureFailure = (
    run: () => unknown
  ): WindowsAppContainerExecutionError => {
    let captured: unknown;
    try {
      run();
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(WindowsAppContainerExecutionError);
    return captured as WindowsAppContainerExecutionError;
  };

  expect(settleWindowsAppContainerNativeHelperInvocationForTests(
    'execute',
    0,
    encodeWindowsAppContainerNativeOk(),
    false,
    { value: { exitCode: 3_221_225_477 } }
  )).toEqual({ exitCode: 3_221_225_477 });

  const diagnosticFailure = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute', 0, encodeWindowsAppContainerNativeOk(), true, { value: { exitCode: 0 } }
    ));
  expect(diagnosticFailure.phase).toBe('preparation');
  expect(windowsAppContainerNativeHelperObservationForTests(diagnosticFailure)).toEqual({
    mode: 'execute',
    helperExit: 0,
    diagnosticStream: 'present',
    protocol: 'ok',
    nativeReceipt: 'exit-code'
  });

  const declaredFailure = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute',
      1,
      JSON.stringify({ status: 'failed', phase: 'launch', nativeCode: 5 }),
      false,
      { value: { status: 'failed', phase: 'launch', nativeCode: 5 } }
    ));
  expect({ phase: declaredFailure.phase, nativeCode: declaredFailure.nativeCode }).toEqual({
    phase: 'launch',
    nativeCode: 5
  });
  expect(windowsAppContainerNativeHelperObservationForTests(declaredFailure)).toEqual({
    mode: 'execute',
    helperExit: 1,
    diagnosticStream: 'empty',
    protocol: 'declared-failure',
    nativeReceipt: 'declared-failure'
  });

  const abnormalHelperExit = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute', 3_221_225_477, '{"status":"ok"}', false, { value: { exitCode: 0 } }
    ));
  expect(abnormalHelperExit.phase).toBe('preparation');
  expect(windowsAppContainerNativeHelperObservationForTests(abnormalHelperExit)?.helperExit)
    .toBe(3_221_225_477);

  for (const [receiptRead, nativeReceipt] of [
    ['absent', 'absent'],
    ['read-error', 'read-error'],
    [{ value: { exitCode: 0, extra: true } }, 'invalid']
  ] as const) {
    const receiptFailure = captureFailure(() =>
      settleWindowsAppContainerNativeHelperInvocationForTests(
        'execute', 0, encodeWindowsAppContainerNativeOk(), false, receiptRead
      ));
    expect(receiptFailure.phase).toBe('wait');
    expect(windowsAppContainerNativeHelperObservationForTests(receiptFailure)?.nativeReceipt)
      .toBe(nativeReceipt);
  }

  expect(settleWindowsAppContainerNativeHelperInvocationForTests(
    'create-profile', 0, encodeWindowsAppContainerNativeOk(), false, 'not-applicable'
  )).toBeUndefined();

  const secretProtocol = 'secret-protocol-path';
  const secretReceipt = 'secret-receipt-path';
  const redactedFailure = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute',
      1,
      JSON.stringify({ status: 'failed', message: secretProtocol }),
      true,
      { value: { exitCode: 0, extra: secretReceipt } }
    ));
  const redactedObservation = windowsAppContainerNativeHelperObservationForTests(redactedFailure);
  expect(redactedObservation).toEqual({
    mode: 'execute',
    helperExit: 1,
    diagnosticStream: 'present',
    protocol: 'invalid',
    nativeReceipt: 'invalid'
  });
  expect(`${redactedFailure.message}${JSON.stringify(redactedFailure)}${JSON.stringify(redactedObservation)}`)
    .not.toContain('secret-');
  expect(Object.isFrozen(redactedObservation)).toBe(true);

  for (const invalidRun of [
    () => settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute', 0, JSON.stringify({ status: 'ok', extra: true }), false, { value: { exitCode: 0 } }
    ),
    () => settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute', 0, encodeWindowsAppContainerNativeOk(), false, { value: { exitCode: -1 } }
    ),
    () => settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute',
      0,
      encodeWindowsAppContainerNativeOk(),
      false,
      { value: { exitCode: 0x1_0000_0000 } }
    ),
    () => settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute',
      1,
      JSON.stringify({ status: 'failed', phase: 'launch', nativeCode: Number.MAX_SAFE_INTEGER + 1 }),
      false,
      { value: { exitCode: 0 } }
    )
  ]) {
    expect(['preparation', 'wait']).toContain(captureFailure(invalidRun).phase);
  }

  expect(String(encodeWindowsAppContainerNativeFailure(new Error('secret-error-path'))))
    .toBe('{"status":"failed","phase":"preparation"}');
  expect(String(encodeWindowsAppContainerNativeFailure(
    new WindowsAppContainerExecutionError('launch', 0x1_0000_0000)
  ))).toBe('{"status":"failed","phase":"preparation"}');
  expect(String(encodeWindowsAppContainerNativeDerivedSid('S-1-15-2-1-2-3-4-5-6-7')))
    .toBe('{"status":"ok","appContainerSid":"S-1-15-2-1-2-3-4-5-6-7"}');
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

test('Windows AppContainer detailed probe evidence redacts to exact status-only capability', () => {
  const capability = redactWindowsAppContainerProbeCapabilityForTests(Object.freeze({
    status: 'unavailable',
    primary: Object.freeze({
      stage: 'isolated-execution',
      invariant: 'isolated-child-succeeded',
      executionPhase: 'launch',
      nativeCode: 5
    }),
    cleanup: Object.freeze([
      Object.freeze({
        stage: 'cleanup',
        invariant: 'probe-root-remove',
        executionPhase: 'cleanup'
      })
    ])
  }));
  expect(capability).toEqual({ status: 'unavailable' });
  expect(Object.keys(capability)).toEqual(['status']);
});

test('Windows AppContainer native-helper bundle retries one transient rejected build', async () => {
  let attempts = 0;
  const expected = new TextEncoder().encode('export default 1;\n');
  const loader = createWindowsAppContainerNativeHelperBundleLoaderForTests(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient-build-rejection');
    return expected;
  });
  await expect(loader.build()).rejects.toThrow('transient-build-rejection');
  expect(await loader.build()).toEqual(expected);
  expect(await loader.build()).toEqual(expected);
  expect(attempts).toBe(2);
});

test('Windows AppContainer owner pending publication recovers before rename and after rename', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.tmp-appcontainer-owner-publication-'));
  const ownerName = '.semantic-mutation-appcontainer-provisional-owner-v1.json';
  const pendingName = `${ownerName}.pending-v1`;
  try {
    const beforeRename = path.join(root, 'before-rename');
    await mkdir(beforeRename);
    await expect(publishWindowsAppContainerProvisionalOwnerForTests(beforeRename, 'after-pending'))
      .rejects.toThrow('simulated-owner-publication-after-pending');
    expect(await exists(path.join(beforeRename, ownerName))).toBe(false);
    expect(await exists(path.join(beforeRename, pendingName))).toBe(true);
    expect(await recoverWindowsAppContainerProvisionalOwnerForTests(beforeRename)).toBe('none');
    expect(await exists(path.join(beforeRename, pendingName))).toBe(false);

    const afterRename = path.join(root, 'after-rename');
    await mkdir(afterRename);
    await expect(publishWindowsAppContainerProvisionalOwnerForTests(afterRename, 'after-rename'))
      .rejects.toThrow('simulated-owner-publication-after-rename');
    expect(await exists(path.join(afterRename, ownerName))).toBe(true);
    expect(await exists(path.join(afterRename, pendingName))).toBe(false);
    expect(await recoverWindowsAppContainerProvisionalOwnerForTests(afterRename)).toBe('canonical');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    '.isolated-compiler/platform/orchestrator/bundled-compiler-sentinel.mjs';
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
      "import ejs from 'ejs';",
      "import { Project } from 'ts-morph';",
      "import typescript from 'typescript';",
      'const stdinText = await Bun.stdin.text();',
      "process.stdout.write('bundled-compiler-stdout-marker');",
      "process.stderr.write('bundled-compiler-stderr-marker');",
      "const sourceFile = typescript.createSourceFile('sentinel.ts', 'const value: number = 1;', typescript.ScriptTarget.Latest);",
      'const project = new Project({ useInMemoryFileSystem: true });',
      "const projectFile = project.createSourceFile('project-sentinel.ts', 'export const value = 1;');",
      "const rendered = ejs.render('<%= value %>', { value: 'ejs-ok' });",
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
      "  ejs: rendered === 'ejs-ok',",
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
      ejs: true,
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

    const capability = windowsAppContainerCapability();
    expect(Object.keys(capability)).toEqual(['status']);
    expect(capability).toEqual({ status: 'available' });
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
