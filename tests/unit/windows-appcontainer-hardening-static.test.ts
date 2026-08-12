import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import ts from 'typescript';

import { runObservedCommand } from '../../platform/shared/observed-process.ts';
import {
  arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests,
  createWindowsAppContainerNativeExecutionBudgetForTests
} from '../../platform/shared/windows-appcontainer-executor.ts';

function propertyName(member: ts.TypeElement): string | null {
  if (!ts.isPropertySignature(member) || member.name === undefined) return null;
  return member.name.getText().replace(/^['"]|['"]$/gu, '');
}

function typeLiteralKeys(source: string, aliasName: string): string[][] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName);
  if (!declaration) throw new Error(`Missing type alias ${aliasName}`);
  const results: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeLiteralNode(node)) {
      results.push(node.members.map(propertyName).filter((name): name is string => name !== null));
      return;
    }
    node.forEachChild(visit);
  };
  visit(declaration.type);
  return results;
}

function typeStringLiteralValues(source: string, aliasName: string): string[] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName);
  if (!declaration) throw new Error(`Missing type alias ${aliasName}`);
  const members = ts.isUnionTypeNode(declaration.type)
    ? declaration.type.types
    : [declaration.type];
  return members.map((member) => {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
      throw new Error(`Type alias ${aliasName} contains a non-string-literal member`);
    }
    return member.literal.text;
  });
}

function classPublicReadonlyKeys(source: string, className: string): string[] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  if (!declaration) throw new Error(`Missing class ${className}`);
  const hasModifier = (
    node: ts.PropertyDeclaration | ts.ParameterDeclaration,
    kind: ts.SyntaxKind
  ): boolean => ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
  const publicReadonlyName = (
    node: ts.PropertyDeclaration | ts.ParameterDeclaration
  ): string | null => {
    if (!hasModifier(node, ts.SyntaxKind.PublicKeyword) ||
      !hasModifier(node, ts.SyntaxKind.ReadonlyKeyword) || node.name === undefined) return null;
    return node.name.getText().replace(/^['"]|['"]$/gu, '');
  };
  return declaration.members.flatMap((member) => {
    if (ts.isPropertyDeclaration(member)) {
      const name = publicReadonlyName(member);
      return name === null ? [] : [name];
    }
    if (!ts.isConstructorDeclaration(member)) return [];
    return member.parameters.flatMap((parameter) => {
      const name = publicReadonlyName(parameter);
      return name === null ? [] : [name];
    });
  });
}

const RECOVERY_OWNER_OBSERVATION_SCHEMA = 'sec-recovery-owner-behavior-observation-v1' as const;
const RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES = 512;

type RecoveryOwnerScenario =
  | 'canonical-key-order'
  | 'owner-absent'
  | 'persisted-mismatch'
  | 'persisted-workspace-mismatch'
  | 'persisted-staging-identity-mismatch'
  | 'persisted-staging-directory-mismatch'
  | 'persisted-app-container-name-mismatch'
  | 'workspace-mismatch'
  | 'staging-identity-mismatch'
  | 'staging-directory-mismatch'
  | 'app-container-name-mismatch'
  | 'result-path-mismatch'
  | 'malformed-expected-owner'
  | 'malformed-persisted-owner';

type RecoveryOwnerObservationResult = 'accepted' | 'cleanup' | 'unexpected';

interface RecoveryOwnerObservation {
  readonly schema: typeof RECOVERY_OWNER_OBSERVATION_SCHEMA;
  readonly result: RecoveryOwnerObservationResult;
}

interface RecoveryOwnerProjectionCleanupState {
  authorized: boolean;
}

function recoveryOwnerProjectionHarness(): string {
  return String.raw`
const __secRecoveryOwnerObservationSchemaV1 = 'sec-recovery-owner-behavior-observation-v1';

async function __secRecoveryOwnerBehaviorProjectionV1(payload: {
  readonly scenario: string;
  readonly transactionRoot: string;
  readonly stagingRoot: string;
}): Promise<Readonly<{ schema: string; result: 'accepted' | 'cleanup' | 'unexpected' }>> {
  const workspaceIdentityDigest = 'sha256:' + 'a'.repeat(64);
  const stagingIdentityDigest = 'sha256:' + 'b'.repeat(64);
  const alternateStagingIdentityDigest = 'sha256:' + 'c'.repeat(64);
  const baseOwner: WindowsAppContainerRecoveryOwnerV1 = Object.freeze({
    formatVersion: RECOVERY_OWNER_FORMAT_VERSION,
    workspaceIdentityDigest,
    stagingIdentityDigest,
    stagingDirectoryName: path.basename(payload.stagingRoot),
    runtimeRelativePath: RUNTIME_DIRECTORY_NAME,
    resultFileName: NATIVE_RESULT_FILE_NAME,
    appContainerName: buildAppContainerName(payload.stagingRoot, stagingIdentityDigest),
    appContainerSid: 'S-1-15-2-1-2-3-4-5-6-7'
  });
  let expectedOwner: WindowsAppContainerRecoveryOwnerV1 | null = baseOwner;
  let persistedOwner: Record<string, unknown> | undefined = baseOwner;
  let requestedNativeResultPath = nativeResultPath(payload.transactionRoot);
  const firstAlternateName = 'sec.sm3.000000000000.111111111111111111111111';
  const secondAlternateName = 'sec.sm3.222222222222.333333333333333333333333';
  const alternateAppContainerName = baseOwner.appContainerName === firstAlternateName
    ? secondAlternateName
    : firstAlternateName;
  switch (payload.scenario) {
    case 'owner-absent':
      persistedOwner = undefined;
      break;
    case 'persisted-mismatch':
      persistedOwner = { ...baseOwner, appContainerSid: 'S-1-15-2-1-2-3-4-5-6-8' };
      break;
    case 'persisted-workspace-mismatch':
      persistedOwner = { ...baseOwner, workspaceIdentityDigest: alternateStagingIdentityDigest };
      break;
    case 'persisted-staging-identity-mismatch':
      persistedOwner = { ...baseOwner, stagingIdentityDigest: alternateStagingIdentityDigest };
      break;
    case 'persisted-staging-directory-mismatch':
      persistedOwner = { ...baseOwner, stagingDirectoryName: 'forged' };
      break;
    case 'persisted-app-container-name-mismatch':
      persistedOwner = { ...baseOwner, appContainerName: alternateAppContainerName };
      break;
    case 'workspace-mismatch':
      expectedOwner = Object.freeze({ ...baseOwner, workspaceIdentityDigest: alternateStagingIdentityDigest });
      persistedOwner = expectedOwner;
      break;
    case 'staging-identity-mismatch':
      expectedOwner = Object.freeze({ ...baseOwner, stagingIdentityDigest: alternateStagingIdentityDigest });
      persistedOwner = expectedOwner;
      break;
    case 'staging-directory-mismatch':
      expectedOwner = Object.freeze({ ...baseOwner, stagingDirectoryName: 'forged' });
      persistedOwner = expectedOwner;
      break;
    case 'app-container-name-mismatch':
      expectedOwner = Object.freeze({
        ...baseOwner,
        appContainerName: alternateAppContainerName
      });
      persistedOwner = expectedOwner;
      break;
    case 'result-path-mismatch':
      requestedNativeResultPath += '.forged';
      break;
    case 'malformed-expected-owner':
      expectedOwner = null;
      persistedOwner = undefined;
      break;
    case 'malformed-persisted-owner':
      persistedOwner = { ...baseOwner, extraKey: true };
      break;
  }
  if (persistedOwner !== undefined) {
    const entries = Object.entries(persistedOwner);
    const orderedEntries = payload.scenario === 'canonical-key-order' ? entries.reverse() : entries;
    await writeFile(
      path.join(
        payload.transactionRoot,
        WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1.ownerFileName
      ),
      JSON.stringify(Object.fromEntries(orderedEntries)) + '\n',
      { flag: 'wx' }
    );
  }
  try {
    await assertRecoveryOwner(
      expectedOwner as WindowsAppContainerRecoveryOwnerV1,
      {
        stagingRoot: payload.stagingRoot,
        transactionRoot: payload.transactionRoot,
        stagingIdentityDigest
      },
      { workspaceIdentityDigest } as WorkspaceWriteLeaseToken,
      requestedNativeResultPath
    );
    return Object.freeze({ schema: __secRecoveryOwnerObservationSchemaV1, result: 'accepted' });
  } catch (error) {
    const result = error instanceof WindowsAppContainerExecutionError && error.phase === 'cleanup'
      ? 'cleanup'
      : 'unexpected';
    return Object.freeze({ schema: __secRecoveryOwnerObservationSchemaV1, result });
  }
}

if (import.meta.main) {
  const payload = JSON.parse(process.argv[2] ?? 'null') as {
    readonly scenario: string;
    readonly transactionRoot: string;
    readonly stagingRoot: string;
  };
  const observation = await __secRecoveryOwnerBehaviorProjectionV1(payload);
  process.stdout.write(JSON.stringify(observation) + '\n');
}
`;
}

function foldedLocalPath(value: string): string {
  return path.resolve(value).toLocaleLowerCase('en-US');
}

async function buildRecoveryOwnerProjection(
  entryPath: string,
  source: string,
  outputPath: string
): Promise<void> {
  const canonicalEntryPath = foldedLocalPath(entryPath);
  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'bun',
    format: 'esm',
    splitting: false,
    minify: false,
    sourcemap: 'none',
    plugins: [{
      name: 'recovery-owner-exact-module-projection-v1',
      setup(build) {
        build.onLoad({ filter: /windows-appcontainer-executor\.ts$/u }, async (args) => {
          if (foldedLocalPath(args.path) !== canonicalEntryPath) return undefined;
          return {
            contents: `${source}\n${recoveryOwnerProjectionHarness()}`,
            loader: 'ts'
          };
        });
      }
    }]
  });
  if (!result.success || result.outputs.length !== 1) {
    throw new Error(`Recovery-owner projection build failed: ${result.logs.map(String).join('; ')}`);
  }
  await writeFile(outputPath, Buffer.from(await result.outputs[0]!.arrayBuffer()), { flag: 'wx' });
}

function parseRecoveryOwnerObservation(source: string): RecoveryOwnerObservation {
  if (Buffer.byteLength(source, 'utf8') > RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES) {
    throw new Error('Recovery-owner projection observation exceeded its closed transport bound');
  }
  if (!source.endsWith('\n') || source.includes('\r')) {
    throw new Error('Recovery-owner projection returned a noncanonical line ending');
  }
  const value = JSON.parse(source.slice(0, -1)) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'result,schema') {
    throw new Error('Recovery-owner projection returned an invalid observation shape');
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== RECOVERY_OWNER_OBSERVATION_SCHEMA ||
    (record.result !== 'accepted' && record.result !== 'cleanup' && record.result !== 'unexpected')) {
    throw new Error('Recovery-owner projection returned an invalid observation value');
  }
  const observation: RecoveryOwnerObservation = Object.freeze({
    schema: RECOVERY_OWNER_OBSERVATION_SCHEMA,
    result: record.result
  });
  if (source !== `${JSON.stringify(observation)}\n`) {
    throw new Error('Recovery-owner projection returned noncanonical JSON bytes');
  }
  return observation;
}

async function observeRecoveryOwnerScenario(
  bundlePath: string,
  scenarioRoot: string,
  scenario: RecoveryOwnerScenario,
  cleanupState: RecoveryOwnerProjectionCleanupState
): Promise<RecoveryOwnerObservation> {
  const transactionRoot = path.join(scenarioRoot, 'transaction');
  const stagingRoot = path.join(transactionRoot, 's');
  await mkdir(stagingRoot, { recursive: true });
  const observedBytes: Record<'stdout' | 'stderr', number> = { stdout: 0, stderr: 0 };
  const observedChunks: Record<'stdout' | 'stderr', Buffer[]> = { stdout: [], stderr: [] };
  let outcome: Awaited<ReturnType<typeof runObservedCommand>>;
  try {
    outcome = await runObservedCommand(process.execPath, [
      bundlePath,
      JSON.stringify({ scenario, transactionRoot, stagingRoot })
    ], {
      cwd: scenarioRoot,
      maxObservedOutputBytes: RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES,
      timeoutMs: 10_000,
      terminationGraceMs: 250,
      terminationDeadlineMs: 2_000,
      onChunk(stream, byteLength) {
        observedBytes[stream] += byteLength;
        if (observedBytes[stream] > RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES) {
          throw new Error('Recovery-owner projection stream exceeded its acquisition bound');
        }
      },
      onOutput(stream, chunk) {
        observedChunks[stream].push(Buffer.from(chunk));
      }
    });
  } catch {
    cleanupState.authorized = false;
    throw new Error('Recovery-owner projection process observation did not settle');
  }
  const cleanupAuthorized = outcome.started
    ? outcome.termination.childCloseObserved &&
      outcome.termination.streamsDrained &&
      outcome.termination.treeClosed
    : outcome.termination.streamsDrained && outcome.termination.treeClosed;
  cleanupState.authorized &&= cleanupAuthorized;
  if (outcome.status !== 'exited' || outcome.exitCode !== 0 ||
    outcome.stdout.observerTruncated || outcome.stderr.observerTruncated ||
    outcome.stderr.bytes !== 0 ||
    !outcome.termination.childCloseObserved ||
    !outcome.termination.streamsDrained ||
    !outcome.termination.treeClosed) {
    throw new Error('Recovery-owner projection process did not settle successfully');
  }
  const stdoutBytes = Buffer.concat(observedChunks.stdout);
  const stderrBytes = Buffer.concat(observedChunks.stderr);
  if (stdoutBytes.byteLength !== outcome.stdout.bytes ||
    stderrBytes.byteLength !== outcome.stderr.bytes ||
    observedBytes.stdout !== outcome.stdout.bytes ||
    observedBytes.stderr !== outcome.stderr.bytes) {
    throw new Error('Recovery-owner projection stream evidence did not match captured bytes');
  }
  const stdout = stdoutBytes.toString('utf8');
  if (!Buffer.from(stdout, 'utf8').equals(stdoutBytes)) {
    throw new Error('Recovery-owner projection stdout was not canonical UTF-8');
  }
  return parseRecoveryOwnerObservation(stdout);
}

async function assertRecoveryOwnerBehavioralProjection(
  entryPath: string,
  source: string
): Promise<void> {
  const projectionRoot = await mkdtemp(path.join(tmpdir(), 'sec-recovery-owner-proof-'));
  const cleanupState: RecoveryOwnerProjectionCleanupState = { authorized: true };
  try {
    const canonicalBundle = path.join(projectionRoot, 'canonical.mjs');
    await buildRecoveryOwnerProjection(entryPath, source, canonicalBundle);
    const scenarios: ReadonlyArray<Readonly<{
      scenario: RecoveryOwnerScenario;
      expected: RecoveryOwnerObservationResult;
    }>> = [
      { scenario: 'canonical-key-order', expected: 'accepted' },
      { scenario: 'owner-absent', expected: 'cleanup' },
      { scenario: 'persisted-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-workspace-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-staging-identity-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-staging-directory-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-app-container-name-mismatch', expected: 'cleanup' },
      { scenario: 'workspace-mismatch', expected: 'cleanup' },
      { scenario: 'staging-identity-mismatch', expected: 'cleanup' },
      { scenario: 'staging-directory-mismatch', expected: 'cleanup' },
      { scenario: 'app-container-name-mismatch', expected: 'cleanup' },
      { scenario: 'result-path-mismatch', expected: 'cleanup' },
      { scenario: 'malformed-expected-owner', expected: 'cleanup' },
      { scenario: 'malformed-persisted-owner', expected: 'cleanup' }
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const observation = await observeRecoveryOwnerScenario(
        canonicalBundle,
        path.join(projectionRoot, `canonical-${index}`),
        scenario.scenario,
        cleanupState
      );
      expect(observation).toEqual({
        schema: RECOVERY_OWNER_OBSERVATION_SCHEMA,
        result: scenario.expected
      });
    }

  } finally {
    if (cleanupState.authorized) {
      await rm(projectionRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  }
}

test('optional Windows AppContainer hardening keeps its native ABI and lifecycle boundary closed', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const sources = Object.fromEntries(await Promise.all(Object.entries({
    nativeHelperSettlement: 'platform/shared/windows-appcontainer-native-helper-settlement.ts',
    appContainer: 'platform/shared/windows-appcontainer-executor.ts',
    appContainerHelper: 'platform/shared/windows-appcontainer-native-helper.ts'
  }).map(async ([name, relative]) => [
    name,
    (await readFile(path.join(root, relative), 'utf8')).replace(/\r\n?/gu, '\n')
  ] as const)));

  await assertRecoveryOwnerBehavioralProjection(
    path.join(root, 'platform/shared/windows-appcontainer-executor.ts'),
    sources.appContainer
  );

  expect(sources.appContainer).toContain('PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES');
  expect(sources.appContainer).toContain('PROC_THREAD_ATTRIBUTE_HANDLE_LIST');
  expect(sources.appContainer).toContain('PROC_THREAD_ATTRIBUTE_JOB_LIST');
  expect(sources.appContainer).toContain('STARTF_USESTDHANDLES');
  expect(sources.appContainer).toContain('CreateFileW');
  expect(sources.appContainer).toContain('standardInputHandle = openNullHandle(GENERIC_READ)');
  expect(sources.appContainer).toContain('standardOutputHandle = openNullHandle(GENERIC_WRITE)');
  expect(sources.appContainer).toContain('standardErrorHandle = openNullHandle(GENERIC_WRITE)');
  expect(sources.appContainer).toContain(
    'WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.procThreadAttributeCount'
  );
  expect(sources.appContainer).toContain(
    'WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.inheritHandles'
  );
  expect(sources.appContainer).toContain('CloseHandle(standardInputHandle)');
  expect(sources.appContainer).toContain('CloseHandle(standardOutputHandle)');
  expect(sources.appContainer).toContain('CloseHandle(standardErrorHandle)');
  expect(sources.appContainer).toContain('attributePayloads.push(securityCapabilities)');
  expect(sources.appContainer).toContain('attributePayloads.push(appContainerSidBytes)');
  expect(sources.appContainer.indexOf('attributePayloads.push(appContainerSidBytes)'))
    .toBeLessThan(sources.appContainer.indexOf('attributePayloads.push(securityCapabilities)'));
  expect(sources.appContainer).toContain('attributePayloads.push(standardHandleList)');
  expect(sources.appContainer).toContain('attributePayloads.push(jobHandleList)');
  const createInnerJob = sources.appContainer.indexOf(
    'jobHandle = kernel32.symbols.CreateJobObjectW(null, null)'
  );
  const initializeAttributeList = sources.appContainer.indexOf(
    'kernel32.symbols.InitializeProcThreadAttributeList('
  );
  const publishJobList = sources.appContainer.indexOf(
    'BigInt(PROC_THREAD_ATTRIBUTE_JOB_LIST)'
  );
  const createAppContainerProcess = sources.appContainer.indexOf(
    'kernel32.symbols.CreateProcessW('
  );
  const createEnteredProgress = sources.appContainer.indexOf(
    "onProgress?.('create-entered')"
  );
  const createReturnedProgress = sources.appContainer.indexOf(
    "onProgress?.('create-returned')",
    createAppContainerProcess
  );
  const jobSettledProgress = sources.appContainer.indexOf(
    "onProgress?.('job-settled')",
    createReturnedProgress
  );
  expect(createInnerJob).toBeGreaterThan(-1);
  expect(initializeAttributeList).toBeGreaterThan(createInnerJob);
  expect(publishJobList).toBeGreaterThan(initializeAttributeList);
  expect(createAppContainerProcess).toBeGreaterThan(publishJobList);
  expect(createEnteredProgress).toBeLessThan(createAppContainerProcess);
  expect(createReturnedProgress).toBeGreaterThan(createAppContainerProcess);
  expect(jobSettledProgress).toBeGreaterThan(createReturnedProgress);
  expect(sources.appContainer).not.toContain('AssignProcessToJobObject');
  expect(sources.appContainer).not.toContain('CREATE_BREAKAWAY_FROM_JOB');
  const deleteAttributeList = sources.appContainer.indexOf(
    'DeleteProcThreadAttributeList(attributeList)'
  );
  const pinAttributePayloads = sources.appContainer.indexOf(
    'for (const payload of attributePayloads) void payload.byteLength',
    deleteAttributeList
  );
  expect(deleteAttributeList).toBeGreaterThan(-1);
  expect(pinAttributePayloads).toBeGreaterThan(deleteAttributeList);
  expect(sources.appContainer).toContain(
    "if (diagnosticStreamPresent || protocol.classification === 'invalid')"
  );
  expect(sources.appContainer).toContain(
    'const nativeHelperObservations = new WeakMap<Error, WindowsAppContainerNativeHelperObservation>()'
  );
  expect(sources.appContainer.match(
    /^const \w+ = new WeakMap<.*>\(\);$/gmu
  )).toEqual([
    'const executionCleanupFailures = new WeakMap<Error, readonly Error[]>();',
    'const nativeHelperObservations = new WeakMap<Error, WindowsAppContainerNativeHelperObservation>();'
  ]);
  expect(typeLiteralKeys(
    sources.appContainer,
    'WindowsAppContainerNativeHelperObservation'
  )).toEqual([[
    'mode', 'exitClass', 'diagnosticStream', 'protocol', 'nativeReceipt'
  ]]);
  expect(typeStringLiteralValues(
    sources.nativeHelperSettlement,
    'WindowsAppContainerObservedNativeHelperMode'
  )).toEqual(['derive', 'create-profile', 'suspended-create', 'execute']);
  expect(typeStringLiteralValues(
    sources.nativeHelperSettlement,
    'WindowsAppContainerObservedNativeHelperSettlementRejection'
  )).toEqual([
    'timed-out',
    'not-started',
    'closure-unproven',
    'requested-termination',
    'not-exited',
    'exit-status-unproven',
    'stdout-truncated',
    'stderr-truncated',
    'stdout-evidence-mismatch',
    'stderr-evidence-mismatch'
  ]);
  expect(typeLiteralKeys(
    sources.nativeHelperSettlement,
    'WindowsAppContainerObservedNativeHelperSettlementClassification'
  )).toEqual([['status'], ['status', 'reason']]);
  expect(sources.nativeHelperSettlement).toContain(
    "Readonly<{ readonly status: 'success' }>"
  );
  expect(sources.nativeHelperSettlement).toContain([
    "readonly status: 'rejected';",
    '      readonly reason: WindowsAppContainerObservedNativeHelperSettlementRejection;'
  ].join('\n'));
  expect(typeLiteralKeys(
    sources.nativeHelperSettlement,
    'WindowsAppContainerObservedNativeHelperSettlement'
  )).toEqual([['mode', 'reason']]);
  expect(sources.nativeHelperSettlement).toContain(
    'new WeakMap<Error, WindowsAppContainerObservedNativeHelperSettlement>()'
  );
  expect(sources.nativeHelperSettlement.match(/new WeakMap<.*>\(\)/gu)?.length).toBe(1);
  expect(sources.nativeHelperSettlement).toContain(
    'settlementsByError.set(error, Object.freeze({ mode, reason: classification.reason }))'
  );
  expect(sources.nativeHelperSettlement).toContain(
    'if (settlement) settlementsByError.set(target, settlement)'
  );
  expect(sources.nativeHelperSettlement).toContain('return settlementsByError.get(error)');
  expect(sources.appContainer).toContain(
    'copyWindowsAppContainerObservedNativeHelperSettlement(error, normalized);'
  );
  expect(sources.appContainer).not.toContain(
    'export type WindowsAppContainerObservedNativeHelperSettlement'
  );
  expect(sources.appContainer).not.toContain(
    'windowsAppContainerObservedNativeHelperSettlementForTests'
  );
  expect(classPublicReadonlyKeys(
    sources.appContainer,
    'WindowsAppContainerExecutionError'
  )).toEqual([
    'code', 'preparationSubstage', 'nativeHelperObservation', 'nativeWorkerProgressStage',
    'phase', 'nativeCode', 'hostToolFailure'
  ]);
  expect(sources.appContainer).toContain(
    "diagnosticStream: diagnosticStreamPresent ? 'present' : 'empty'"
  );
  expect(sources.appContainer).toContain('nativeReceipt: nativeReceipt.classification');
  expect(sources.appContainer).not.toContain('const controller = new AbortController()');
  expect(sources.appContainer).not.toContain('signal: controller.signal');
  expect(sources.appContainer).not.toContain('controller.abort()');
  expect(sources.appContainer).not.toContain('normalizeExecutionError(monitorError ?? error,');
  expect(sources.appContainer).toContain('WINDOWS_APPCONTAINER_NATIVE_WAIT_SLICE_MS');
  expect(sources.appContainer).not.toContain(
    'writeFileSync(nativeResultPath, `${JSON.stringify({ exitCode })}\\n`, { flag: \'wx\' })'
  );
  expect(sources.appContainer).toContain(
    '? await readNativeReceipt(helperRequest.nativeResultPath, commitFence)'
  );
  expect(sources.appContainer).toContain("handle = await open(resultPath, 'r')");
  expect(sources.appContainer).toContain('const after = await handle.stat()');
  expect(sources.appContainer).toContain(
    'String(after.dev) !== String(before.dev) || String(after.ino) !== String(before.ino)'
  );
  expect(sources.appContainer).toContain('Buffer.alloc(MAX_NATIVE_RECEIPT_BYTES + 1)');
  expect(sources.appContainer).not.toContain("readFile(resultPath, 'utf8')");
  expect(sources.appContainer).toContain(
    'if (error instanceof Error) nativeHelperObservations.set(error, observation)'
  );
  expect(sources.appContainer).not.toContain('parseNativeResult(');
  expect(sources.appContainer).not.toContain('observeNativeReceipt(');
  for (const forbiddenObservationField of [
    'readonly stdout', 'readonly stderr', 'readonly path', 'readonly message', 'readonly rawOutput'
  ]) {
    expect(sources.appContainer).not.toContain(forbiddenObservationField);
  }
  expect(sources.appContainer).not.toContain('process.stderr.write');
  expect(sources.appContainer).toContain('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE');
  expect(sources.appContainer).toContain('probeWindowsAppContainerCapability');
  expect(sources.appContainer).toContain('rawConnect === false');
  const createProfileHelper = sources.appContainer.indexOf("'create-profile',\n          nativeRequest");
  const suspendedCreateHelper = sources.appContainer.indexOf(
    "'suspended-create',\n            nativeRequest",
    createProfileHelper
  );
  const executeHelper = sources.appContainer.indexOf(
    "'execute',\n            nativeRequest",
    createProfileHelper
  );
  expect(createProfileHelper).toBeGreaterThan(-1);
  expect(suspendedCreateHelper).toBeGreaterThan(createProfileHelper);
  expect(executeHelper).toBeGreaterThan(createProfileHelper);
  expect(sources.appContainer).toContain('createWindowsAppContainerProfileForNativeHelper');
  expect(sources.appContainer).toContain('deriveWindowsAppContainerSidForNativeHelper');
  expect(sources.appContainer).not.toContain('[sm3-native]');
  expect(sources.appContainer).not.toContain('SEC_DEBUG_ISOLATED_RUNTIME');
  const helperExitPreload = sources.appContainerHelper.indexOf(
    'const exitNativeHelper = await loadNativeHelperExit()'
  );
  const helperProfileCreate = sources.appContainerHelper.indexOf(
    'await createWindowsAppContainerProfileForNativeHelper(envelope.request)'
  );
  expect(helperExitPreload).toBeGreaterThan(-1);
  expect(helperProfileCreate).toBeGreaterThan(helperExitPreload);
  const helperHardTerminate = sources.appContainerHelper.indexOf(
    'kernel32.symbols.TerminateProcess(currentProcess, exitCode)'
  );
  const helperExitFallback = sources.appContainerHelper.indexOf(
    'kernel32.symbols.ExitProcess(exitCode)'
  );
  expect(sources.appContainerHelper).toContain('kernel32.symbols.GetCurrentProcess()');
  expect(helperHardTerminate).toBeGreaterThan(-1);
  expect(helperExitFallback).toBeGreaterThan(helperHardTerminate);
  expect(sources.appContainerHelper).toContain("mode: 'create-profile'");
  expect(sources.appContainerHelper).toContain("mode: 'suspended-create'");
  expect(sources.appContainerHelper).toContain('writeSync(1, payload)');
  expect(sources.appContainerHelper).toContain('writeFileSync(');
  expect(sources.appContainerHelper).toContain(
    'new Worker(import.meta.url, { ref: true })'
  );
  expect(sources.appContainerHelper).toContain(
    'if (Bun.isMainThread) await runNativeHelperMain()'
  );
  const nativeWorkerStart = sources.appContainerHelper.indexOf(
    'async function runNativeExecutionWorker('
  );
  const nativeWorkerEnd = sources.appContainerHelper.indexOf(
    '\nfunction installNativeExecutionWorker()',
    nativeWorkerStart
  );
  expect(nativeWorkerStart).toBeGreaterThan(-1);
  expect(nativeWorkerEnd).toBeGreaterThan(nativeWorkerStart);
  const nativeWorker = sources.appContainerHelper.slice(nativeWorkerStart, nativeWorkerEnd);
  expect(nativeWorker).not.toContain('writeNativeHelperOutput(');
  expect(nativeWorker).not.toContain('writeFileSync(');
  expect(nativeWorker).not.toContain('exitNativeHelper(');
  expect(nativeWorker).toContain('runWindowsAppContainerNativeSuspendedCreateForHelper');
  expect(nativeWorker).toContain("kind: 'suspended-created'");
  expect(nativeWorker).toContain("kind: 'progress'");
  expect(sources.appContainerHelper).toContain("if (envelope.mode === 'execute') {");
  expect(sources.appContainerHelper).not.toContain("mode: 'worker'");
  expect(sources.appContainerHelper).not.toContain('process.stdout.write');
  expect(sources.appContainerHelper).not.toContain('assertWorkspaceWriteLease');
  expect(sources.appContainer).toContain(
    "const HOST_BUN_CONFIG_RELATIVE_ROOT = '.sm3h'"
  );
  expect(sources.appContainer).toContain(
    'await durableCreateFile(configPath, ISOLATED_BUN_CONFIG_CONTENT, commitFence)'
  );
  expect(sources.appContainer).toContain(
    'if (cachedPromise) return cachedPromise'
  );
  expect(sources.appContainer).toContain(
    'if (cachedPromise === cached) cachedPromise = undefined'
  );
  expect(sources.appContainer).toContain('entrypoints: [NATIVE_HELPER_PATH]');
  expect(sources.appContainer).toContain('await durableCreateFile(helperPath, helperContents, commitFence)');
  expect(sources.appContainer).toContain("Number(helperMetadata.nlink) !== 1");
  expect(sources.appContainer).toContain(
    'await cleanupWindowsAppContainerNativeOwner(cleanupRequest, provenAppContainerSid)'
  );
  expect(sources.appContainerHelper).not.toContain("mode: 'cleanup'");
  expect(sources.appContainer).toMatch(
    /'--no-env-file',\s*`--config=\$\{configPath\}`,\s*'--no-install',\s*helperPath,\s*encodedRequest/u
  );
  expect(sources.appContainer).not.toContain('[NATIVE_HELPER_PATH, serialized]');
  expect(sources.appContainer.match(
    /'--no-env-file',\s*'--config=' \+ bunConfigPath,\s*'--no-install'/gu
  )?.length).toBe(2);
  expect(sources.appContainer.match(
    /const bunConfigPath = path\.join\(path\.dirname\(process\.execPath\), 'bunfig\.toml'\)/gu
  )?.length).toBe(2);
  expect(sources.appContainer).toContain('() => cleanupHostBunConfig(stagingRoot, commitFence)');
  expect(sources.appContainer).not.toContain("import { runCommand } from './process.ts'");
  expect(sources.appContainer).toContain('const executionRetainedOwners = new WeakSet<Error>();');
  expect(sources.appContainer).toContain('executionRetainedOwners.has(primaryError)');
  expect(sources.appContainer).toContain('if (!cleanupSafe) executionRetainedOwners.add(error);');
  const settlementStart = sources.appContainer.indexOf(
    'function settleObservedHostBunCommand('
  );
  const settlementEnd = sources.appContainer.indexOf(
    '\nfunction observedDiagnosticCaptureForTests(',
    settlementStart
  );
  const settlement = sources.appContainer.slice(settlementStart, settlementEnd);
  expect(settlementStart).toBeGreaterThan(-1);
  expect(settlementEnd).toBeGreaterThan(settlementStart);
  expect(settlement).toContain([
    'function settleObservedHostBunCommand(',
    '  mode: WindowsAppContainerObservedNativeHelperMode,'
  ].join('\n'));
  expect(settlement).toContain([
    'const cleanupSafe = outcome.started',
    '    ? closedTree',
    '    : outcome.termination.streamsDrained && outcome.termination.treeClosed;'
  ].join('\n'));
  expect(settlement).toContain(
    'const classification = classifyWindowsAppContainerObservedNativeHelperSettlement('
  );
  expect(settlement).toContain(
    "if (classification.status !== 'success' || outcome.exitCode === null)"
  );
  expect(settlement).toContain(
    'bindWindowsAppContainerObservedNativeHelperSettlement(error, mode, rejection);'
  );
  expect(settlement).toContain('if (!cleanupSafe) executionRetainedOwners.add(error);');
  const cleanupStart = settlement.indexOf('const closedTree =');
  const classificationStart = settlement.indexOf('const classification =');
  const cleanupAuthorization = settlement.slice(cleanupStart, classificationStart);
  expect(cleanupStart).toBeGreaterThan(-1);
  expect(classificationStart).toBeGreaterThan(cleanupStart);
  expect(cleanupAuthorization).not.toContain('classification');
  expect(cleanupAuthorization).not.toContain('reason');
  const rejectionCreate = settlement.indexOf('const error = executionError(');
  const sidecarBind = settlement.indexOf(
    'bindWindowsAppContainerObservedNativeHelperSettlement(error, mode, rejection);'
  );
  const retentionDecision = settlement.indexOf(
    'if (!cleanupSafe) executionRetainedOwners.add(error);'
  );
  const rejectionThrow = settlement.indexOf('throw error;');
  expect(rejectionCreate).toBeGreaterThan(classificationStart);
  expect(sidecarBind).toBeGreaterThan(rejectionCreate);
  expect(retentionDecision).toBeGreaterThan(sidecarBind);
  expect(rejectionThrow).toBeGreaterThan(retentionDecision);
  expect(arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(60_000)).toEqual({
    childTimeoutMs: 60_000,
    hostWatchdogMs: 70_000
  });
  expect(arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(undefined)).toEqual({
    childTimeoutMs: 120_000,
    hostWatchdogMs: 130_000
  });
  expect(createWindowsAppContainerNativeExecutionBudgetForTests(60_000, 1_000)).toEqual({
    startedAtMs: 1_000,
    timeoutMs: 60_000
  });
  expect(sources.appContainer).toContain(
    'function waitForWindowsAppContainerNativeProcess('
  );
  expect(sources.appContainer).toContain([
    'waitForWindowsAppContainerNativeProcess(executionBudget, {',
    '      nowMs: Date.now,',
    '      waitForProcess: (timeoutMs) => kernel32!.symbols.WaitForSingleObject('
  ].join('\n'));
  const nativeChildStart = sources.appContainer.indexOf(
    'async function runWindowsAppContainerNativeChildInternal('
  );
  const nativeChildEnd = sources.appContainer.indexOf(
    '\nexport function runWindowsAppContainerNativeChild(',
    nativeChildStart
  );
  const nativeChild = sources.appContainer.slice(nativeChildStart, nativeChildEnd);
  expect(nativeChild.indexOf('const startedAtMs = Date.now();'))
    .toBeLessThan(nativeChild.indexOf('assertCapability();'));
  expect(nativeChild).toContain(
    '() => appContainerSidBytesFromString(request.owner.appContainerSid)'
  );
  expect(nativeChild).not.toContain('deriveAppContainerSidPointer(');
  expect(sources.appContainer).toContain([
    'const applicationName = suspendedCreateOnly',
    '      ? windowsWide(process.execPath)',
    '      : prepared.executablePath;'
  ].join('\n'));
  expect(sources.appContainer).toContain([
    'const commandLine = suspendedCreateOnly',
    '      ? windowsWide(quoteWindowsArgument(process.execPath))',
    '      : prepared.commandLine;'
  ].join('\n'));
  expect(sources.appContainer).toContain([
    'const environmentBlock = suspendedCreateOnly',
    '      ? null',
    '      : prepared.environmentBlock;'
  ].join('\n'));
  expect(sources.appContainer).toContain([
    'const currentDirectory = suspendedCreateOnly',
    '      ? null',
    '      : prepared.currentDirectory;'
  ].join('\n'));
  expect(sources.appContainer).toContain([
    'kernel32.symbols.CreateProcessW(',
    '      applicationName,',
    '      commandLine,',
    '      null,',
    '      null,',
    '      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.inheritHandles,',
    '      WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.creationFlags,',
    '      environmentBlock,',
    '      currentDirectory,',
    '      startupInfoEx,',
    '      processInformation'
  ].join('\n'));
  expect(sources.appContainer).not.toContain('commandLine: windowsWide(process.execPath)');
  expect(sources.appContainer).toContain('cwd: path.parse(stagingRoot).root');
  expect(sources.appContainer).toContain("envMode: 'replace'");
  expect(sources.appContainer).toContain('env: environment');
  expect(nativeChild).toContain([
    'const executionBudget = createWindowsAppContainerNativeExecutionBudget(',
    '    executionDeadlines.childTimeoutMs,',
    '    startedAtMs',
    '  );'
  ].join('\n'));
  expect(sources.appContainer).toContain([
    "'execute',",
    '            nativeRequest,',
    '            validated.stagingRoot,',
    '            request.environment,',
    '            commitFence,',
    '            executionDeadlines.hostWatchdogMs'
  ].join('\n'));
  expect(sources.appContainer).toContain(
    'maxObservedOutputBytes: WINDOWS_HOST_TOOL_OUTPUT_LIMIT_BYTES'
  );
  expect(sources.appContainer).toContain('whileRunning: commitFence');
  expect(sources.appContainer).toContain(
    'result = settleObservedHostBunCommand(mode, observed, stdoutChunks, Object.freeze({'
  );
});
