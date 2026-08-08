import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import ts from 'typescript';

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

test('optional Windows AppContainer hardening keeps its native ABI and lifecycle boundary closed', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const sources = Object.fromEntries(await Promise.all(Object.entries({
    compilerFacade: 'platform/compiler/index.ts',
    orchestratorFacade: 'platform/orchestrator.ts',
    orchestratorIndex: 'platform/orchestrator/index.ts',
    nativeHelperSettlement: 'platform/shared/windows-appcontainer-native-helper-settlement.ts',
    appContainer: 'platform/shared/windows-appcontainer-executor.ts',
    appContainerHelper: 'platform/shared/windows-appcontainer-native-helper.ts',
    stagingTree: 'platform/compiler/verify/assert-isolated-staging-tree.ts'
  }).map(async ([name, relative]) => [
    name,
    (await readFile(path.join(root, relative), 'utf8')).replace(/\r\n?/gu, '\n')
  ] as const)));

  for (const facade of [sources.compilerFacade, sources.orchestratorFacade, sources.orchestratorIndex]) {
    expect(facade).not.toContain('windows-appcontainer-native-helper-settlement');
    for (const internalSettlementSymbol of [
      'WindowsAppContainerObservedNativeHelperSettlementRejection',
      'WindowsAppContainerObservedNativeHelperSettlementClassification',
      'WindowsAppContainerObservedNativeHelperSettlement',
      'classifyWindowsAppContainerObservedNativeHelperSettlement',
      'bindWindowsAppContainerObservedNativeHelperSettlement',
      'copyWindowsAppContainerObservedNativeHelperSettlement',
      'windowsAppContainerObservedNativeHelperSettlementForTests'
    ]) {
      expect(facade).not.toMatch(
        new RegExp(`export[^;]+\\b${internalSettlementSymbol}\\b`, 'su')
      );
    }
  }

  expect(sources.stagingTree).toContain(
    "readonly executionBoundary?: 'windows-appcontainer'"
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
  expect(sources.appContainer).toContain('recoveryOwnerPath');
  expect(sources.appContainer).toContain(
    'const canonicalOwner = await readRecoveryOwner(recoveryOwnerPath(boundary.transactionRoot));'
  );
  expect(sources.appContainer).toContain(
    '!canonicalOwner || !canonicalEquals(canonicalOwner, owner)'
  );
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
