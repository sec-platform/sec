import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildWindowsAppContainerNativeHelperBundleSourceForTests,
  createWindowsAppContainerNativeHelperBundleLoaderForTests,
  encodeWindowsAppContainerNativeDerivedSid,
  encodeWindowsAppContainerNativeFailure,
  encodeWindowsAppContainerNativeOk,
  encodeWindowsAppContainerSidBytesForTests,
  normalizeWindowsAppContainerPreparationErrorForTests,
  proveWindowsAppContainerNativeHelperEntryForTests,
  publishWindowsAppContainerProvisionalOwnerForTests,
  recoverWindowsAppContainerProvisionalOwnerForTests,
  redactWindowsAppContainerProbeCapabilityForTests,
  runWindowsAppContainerChild,
  settleWindowsAppContainerNativeHelperInvocationForTests,
  windowsAppContainerCapability,
  WindowsAppContainerCapabilityUnavailableError,
  WindowsAppContainerExecutionError,
  windowsAppContainerNativeHelperObservationForTests
} from '../../src/runtime-state/physical/test/windows-appcontainer.ts';

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

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
  expect(diagnosticFailure.preparationSubstage).toBe('native-helper-diagnostic');
  expect(windowsAppContainerNativeHelperObservationForTests(diagnosticFailure)).toEqual({
    mode: 'execute',
    exitClass: 'zero',
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
    exitClass: 'nonzero',
    diagnosticStream: 'empty',
    protocol: 'declared-failure',
    nativeReceipt: 'declared-failure'
  });

  const typedPreparationFailure = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'create-profile',
      1,
      encodeWindowsAppContainerNativeFailure(new WindowsAppContainerExecutionError(
        'preparation',
        5,
        undefined,
        'profile-creation'
      )),
      false,
      'not-applicable'
    ));
  expect(typedPreparationFailure.preparationSubstage).toBe('profile-creation');
  expect(typedPreparationFailure.nativeCode).toBe(5);
  expect(typedPreparationFailure.nativeHelperObservation).toEqual({
    mode: 'create-profile',
    exitClass: 'nonzero',
    diagnosticStream: 'empty',
    protocol: 'declared-failure',
    nativeReceipt: 'not-applicable'
  });
  expect(Object.isFrozen(typedPreparationFailure.nativeHelperObservation)).toBe(true);

  const abnormalHelperExit = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute', 3_221_225_477, '{"status":"ok"}', false, { value: { exitCode: 0 } }
    ));
  expect(abnormalHelperExit.phase).toBe('preparation');
  expect(abnormalHelperExit.preparationSubstage).toBe('native-helper-protocol');
  expect(windowsAppContainerNativeHelperObservationForTests(abnormalHelperExit)?.exitClass)
    .toBe('nonzero');

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
  expect(settleWindowsAppContainerNativeHelperInvocationForTests(
    'suspended-create', 0, encodeWindowsAppContainerNativeOk(), false, 'not-applicable'
  )).toBeUndefined();

  const suspendedReceiptFailure = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'suspended-create', 0, encodeWindowsAppContainerNativeOk(), false, { value: { exitCode: 0 } }
    ));
  expect(suspendedReceiptFailure.preparationSubstage).toBe('native-receipt');
  expect(windowsAppContainerNativeHelperObservationForTests(suspendedReceiptFailure)).toEqual({
    mode: 'suspended-create',
    exitClass: 'zero',
    diagnosticStream: 'empty',
    protocol: 'ok',
    nativeReceipt: 'exit-code'
  });

  const suspendedTimeoutFailure = captureFailure(() =>
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'suspended-create',
      1,
      encodeWindowsAppContainerNativeFailure(new WindowsAppContainerExecutionError(
        'timeout', undefined, undefined, undefined, undefined, 'create-entered'
      )),
      false,
      'not-applicable'
    ));
  expect(suspendedTimeoutFailure).toMatchObject({
    phase: 'timeout',
    nativeWorkerProgressStage: 'create-entered'
  });

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
    exitClass: 'nonzero',
    diagnosticStream: 'present',
    protocol: 'invalid',
    nativeReceipt: 'invalid'
  });
  expect(`${redactedFailure.message}${JSON.stringify(redactedFailure)}${JSON.stringify(redactedObservation)}`)
    .not.toContain('secret-');
  expect(Object.isFrozen(redactedObservation)).toBe(true);
  expect(redactedFailure.nativeHelperObservation).toEqual(redactedObservation);

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
    .toBe('{"status":"failed","phase":"preparation","substage":"unknown"}');
  expect(String(encodeWindowsAppContainerNativeFailure(
    new WindowsAppContainerExecutionError('launch', 0x1_0000_0000)
  ))).toBe('{"status":"failed","phase":"preparation","substage":"unknown"}');
  expect(String(encodeWindowsAppContainerNativeDerivedSid('S-1-15-2-1-2-3-4-5-6-7')))
    .toBe('{"status":"ok","appContainerSid":"S-1-15-2-1-2-3-4-5-6-7"}');
  const invalidSid = captureFailure(() => encodeWindowsAppContainerNativeDerivedSid('not-a-sid'));
  expect(invalidSid.preparationSubstage).toBe('sid-derivation');
});

test('Windows AppContainer binary SID encoder preserves the SID ABI and rejects noncanonical values', () => {
  const sid = 'S-1-15-2-1-2-3-4-5-6-7';
  const encoded = encodeWindowsAppContainerSidBytesForTests(sid);
  expect(encoded.byteLength).toBe(40);
  expect(encoded.toString('hex')).toBe(
    '010800000000000f0200000001000000020000000300000004000000050000000600000007000000'
  );
  expect(encodeWindowsAppContainerSidBytesForTests(
    'S-1-15-2-4294967295-2-3-4-5-6-7'
  ).readUInt32LE(12)).toBe(0xffff_ffff);
  for (const invalid of [
    'S-1-15-2-1-2-3-4-5-6-4294967296',
    'S-1-15-2-01-2-3-4-5-6-7',
    'S-1-16-2-1-2-3-4-5-6-7',
    'S-1-15-2-1-2-3-4-5-6'
  ]) {
    expect(() => encodeWindowsAppContainerSidBytesForTests(invalid))
      .toThrow(WindowsAppContainerExecutionError);
  }
});

test('Windows AppContainer preparation normalization is finite and preserves explicit evidence', () => {
  const unknown = normalizeWindowsAppContainerPreparationErrorForTests(
    new Error(String.raw`C:\secret\unknown-error`)
  );
  expect(unknown).toBeInstanceOf(WindowsAppContainerExecutionError);
  expect((unknown as WindowsAppContainerExecutionError).phase).toBe('preparation');
  expect((unknown as WindowsAppContainerExecutionError).preparationSubstage).toBe('unknown');
  expect(JSON.stringify(unknown)).not.toContain('secret');

  const upgraded = normalizeWindowsAppContainerPreparationErrorForTests(
    new WindowsAppContainerExecutionError('preparation', undefined, undefined, undefined, {
      mode: 'derive',
      exitClass: 'zero',
      diagnosticStream: 'empty',
      protocol: 'ok',
      nativeReceipt: 'not-applicable'
    }),
    'runtime-identity'
  ) as WindowsAppContainerExecutionError;
  expect(upgraded.preparationSubstage).toBe('runtime-identity');
  expect(windowsAppContainerNativeHelperObservationForTests(upgraded))
    .toEqual(upgraded.nativeHelperObservation);
  expect(Object.isFrozen(upgraded.nativeHelperObservation)).toBe(true);

  const explicit = normalizeWindowsAppContainerPreparationErrorForTests(
    new WindowsAppContainerExecutionError(
      'preparation', undefined, undefined, 'owner-publication'
    ),
    'runtime-identity'
  ) as WindowsAppContainerExecutionError;
  expect(explicit.preparationSubstage).toBe('owner-publication');
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
  await expect(loader.prepare()).rejects.toThrow('transient-build-rejection');
  expect(await loader.build()).toEqual(expected);
  expect(await loader.build()).toEqual(expected);
  expect(attempts).toBe(2);

  const invalidLoader = createWindowsAppContainerNativeHelperBundleLoaderForTests(
    async () => new Uint8Array()
  );
  const invalid = await invalidLoader.build().then(() => undefined, (error: unknown) => error);
  expect(invalid).toBeInstanceOf(WindowsAppContainerExecutionError);
  expect((invalid as WindowsAppContainerExecutionError).preparationSubstage)
    .toBe('native-helper-bundle-contract');
});

test('Windows AppContainer native-helper prebind and later build share one opaque source', async () => {
  let attempts = 0;
  let releaseSource!: () => void;
  const sourceReleased = new Promise<void>((resolve) => {
    releaseSource = resolve;
  });
  const expected = new TextEncoder().encode('export default 1;\n');
  const loader = createWindowsAppContainerNativeHelperBundleLoaderForTests(async () => {
    attempts += 1;
    await sourceReleased;
    return expected;
  });

  const prebind = loader.prepare();
  const laterBuild = loader.build();
  expect(attempts).toBe(1);
  releaseSource();
  expect(await prebind).toBeUndefined();
  expect(await laterBuild).toEqual(expected);
  expect(attempts).toBe(1);

  expected[0] = 0;
  const callerBytes = await loader.build();
  expect(new TextDecoder().decode(callerBytes)).toBe('export default 1;\n');
  callerBytes[0] = 0;
  expect(new TextDecoder().decode(await loader.build())).toBe('export default 1;\n');
  expect(attempts).toBe(1);
});

test('Windows AppContainer native-helper entry proof rejects missing, aliases, and identity drift', async () => {
  const entryPath = path.resolve('native-helper-entry.ts');
  const physicalPath = path.resolve('physical-native-helper-entry.ts');
  const metadata = (identity: string) => Object.freeze({
    identity,
    isFile: true,
    isSymbolicLink: false,
    linkCount: 1
  });
  const assertEntryFailure = async (probe: Parameters<
    typeof proveWindowsAppContainerNativeHelperEntryForTests
  >[1]) => {
    const failure = await proveWindowsAppContainerNativeHelperEntryForTests(entryPath, probe)
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(WindowsAppContainerExecutionError);
    expect((failure as WindowsAppContainerExecutionError).preparationSubstage)
      .toBe('native-helper-entry');
  };

  await assertEntryFailure({
    async lstat() { throw new Error('missing'); },
    async realpath() { return entryPath; }
  });
  await assertEntryFailure({
    async lstat() { return metadata('stable'); },
    async realpath() { return physicalPath; }
  });
  let reads = 0;
  await assertEntryFailure({
    async lstat() { return metadata(++reads === 1 ? 'before' : 'after'); },
    async realpath() { return entryPath; }
  });
});

test('Windows AppContainer native-helper build and bundle contract failures stay distinct', async () => {
  const entryPath = path.resolve('native-helper-entry.ts');
  const metadata = Object.freeze({
    identity: 'stable',
    isFile: true,
    isSymbolicLink: false,
    linkCount: 1
  });
  const probe = {
    async lstat() { return metadata; },
    async realpath() { return entryPath; }
  };
  const buildFailure = await buildWindowsAppContainerNativeHelperBundleSourceForTests(
    entryPath,
    probe,
    async () => { throw new Error('build rejected'); }
  ).then(() => undefined, (error: unknown) => error);
  expect(buildFailure).toBeInstanceOf(WindowsAppContainerExecutionError);
  expect((buildFailure as WindowsAppContainerExecutionError).preparationSubstage)
    .toBe('native-helper-build');

  const unsuccessfulBuild = await buildWindowsAppContainerNativeHelperBundleSourceForTests(
    entryPath,
    probe,
    async () => ({ success: false, outputs: [] })
  ).then(() => undefined, (error: unknown) => error);
  expect((unsuccessfulBuild as WindowsAppContainerExecutionError).preparationSubstage)
    .toBe('native-helper-build');

  const invalidOutputCount = await buildWindowsAppContainerNativeHelperBundleSourceForTests(
    entryPath,
    probe,
    async () => ({
      success: true,
      outputs: [
        { async arrayBuffer() { return new ArrayBuffer(1); } },
        { async arrayBuffer() { return new ArrayBuffer(1); } }
      ]
    })
  ).then(() => undefined, (error: unknown) => error);
  expect((invalidOutputCount as WindowsAppContainerExecutionError).preparationSubstage)
    .toBe('native-helper-build');

  for (const source of ['', 'import value from "./helper.ts";\n']) {
    const loader = createWindowsAppContainerNativeHelperBundleLoaderForTests(async () =>
      new TextEncoder().encode(source));
    const failure = await loader.build().then(() => undefined, (error: unknown) => error);
    expect((failure as WindowsAppContainerExecutionError).preparationSubstage)
      .toBe('native-helper-bundle-contract');
  }
});

test('Windows AppContainer exact native-helper production entry builds without AppContainer', async () => {
  const bundle = await buildWindowsAppContainerNativeHelperBundleSourceForTests();
  expect(bundle.byteLength).toBeGreaterThan(0);
  expect(new TextDecoder().decode(bundle)).not.toMatch(
    /(?:from|import\s*\()\s*["'][^"']+\.ts["']/u
  );
});

test('Windows AppContainer exact native-helper bundle self-boots its finite Worker role', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.tmp-appcontainer-helper-worker-'));
  let worker: Worker | undefined;
  try {
    const helperPath = path.join(root, 'native-helper.mjs');
    await writeFile(helperPath, await buildWindowsAppContainerNativeHelperBundleSourceForTests());
    worker = new Worker(pathToFileURL(helperPath), { ref: true });
    const terminal = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker bootstrap timed out')), 2_000);
      worker!.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data);
      };
      worker!.onerror = (event) => {
        event.preventDefault();
        clearTimeout(timeout);
        reject(new Error('worker bootstrap failed'));
      };
      worker!.postMessage('invalid-request');
    });
    expect(terminal).toEqual({
      kind: 'failed',
      payload: '{"status":"failed","phase":"preparation","substage":"unknown"}'
    });
  } finally {
    worker?.terminate();
    await rm(root, { recursive: true, force: true });
  }
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
    const ownerFailure = await publishWindowsAppContainerProvisionalOwnerForTests(
      afterRename,
      'after-pending'
    ).then(() => undefined, (error: unknown) => error);
    expect(ownerFailure).toBeInstanceOf(WindowsAppContainerExecutionError);
    expect((ownerFailure as WindowsAppContainerExecutionError).preparationSubstage)
      .toBe('owner-publication');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
