import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  materializeFastSuiteExecutionGeneration,
  type FastSuiteExecutionGeneration
} from './fast-suite-generation.ts';
import { captureFastSuiteProcessInput, type FastSuiteProcessInput } from './fast-suite-input.ts';
import { FAST_SUITE_WORKER_SOURCE } from './fast-suite-worker.ts';

import { CompilerError } from '../../compiler/errors.ts';
import { sha256 } from '../../contracts/canonical.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { parseExactJson } from '../../contracts/exact-json.ts';
import { throwIfNativeAborted } from '../../contracts/native-abort.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';
import { issueOperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../execution/operation/semantic.ts';
import { settleResources, settleResourcesAsync } from '../../execution/resource-settlement.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowRandomDirectory,
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeMetadata
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceRunResult,
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSessionReceipt
} from '../runtime-state/physical/runtime/process-resource-session.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from '../runtime-state/physical/runtime/process.ts';

export const FAST_SUITE_PROCESS_PROVIDER_REVISION =
  'sec-fast-suite-process-provider-v7' as const;

const FAST_SUITE_PROCESS_OPERATION = 'verification.fast-suite-process';
const FAST_SUITE_PROCESS_REQUIREMENT = 'verification.fast-suite-process.execute';
const FAST_SUITE_PROCESS_MAX_DURATION_MS = 180_000;
const FAST_SUITE_PROCESS_MAX_INPUT_BYTES = 16 * 1024;
const FAST_SUITE_PROCESS_MAX_STDOUT_BYTES = 64 * 1024;
const FAST_SUITE_PROCESS_MAX_STDERR_BYTES = 64 * 1024;
const FAST_SUITE_PROCESS_MAX_NATIVE_RESOURCES = 2;
const FAST_SUITE_TEMP_CLEANUP_DURATION_MS = 30_000;
const FAST_SUITE_TEMP_MAXIMUM_ENTRIES = 100_000;
const FAST_SUITE_WORKER_INPUT_SCHEMA = 'sec-fast-suite-worker-input-v1';
const FAST_SUITE_WORKER_RESULT_SCHEMA = 'sec-fast-suite-worker-result-v1';

type CapturedSuite = Readonly<{
  absolutePath: string;
  originalLabel: string;
  relativePath: string;
}>;

type FastSuiteTerminal =
  | Readonly<{ status: 'passed' }>
  | Readonly<{
      status: 'failed';
      failureKind: 'missing-export' | 'sandbox-unavailable' | 'suite-failure';
      failure: string;
    }>;

function captureSuites(
  workspaceRoot: string,
  suiteRoot: string,
  files: readonly string[]
): readonly CapturedSuite[] {
  if (!Array.isArray(files)) throw new TypeError('Suite file inventory must be an array');
  const root = path.resolve(workspaceRoot);
  const allowed = path.resolve(suiteRoot);
  const allowedRelative = path.relative(root, allowed);
  if (path.isAbsolute(allowedRelative) || allowedRelative === '..'
      || allowedRelative.startsWith('..' + path.sep)) {
    throw new Error('Suite root must remain inside the workspace root');
  }
  const captured: CapturedSuite[] = [];
  const length = files.length;
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(files, index);
    const file: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (typeof file !== 'string' || file.length === 0 || file.includes('\0')) {
      throw new TypeError('Suite files must be dense own non-empty path strings');
    }
    const absolutePath = path.resolve(root, file);
    const insideSuite = path.relative(allowed, absolutePath);
    if (insideSuite === '' || path.isAbsolute(insideSuite) || insideSuite === '..'
        || insideSuite.startsWith('..' + path.sep)) {
      throw new Error(`Suite file escapes its selected suite root: ${file}`);
    }
    captured.push(Object.freeze({
      absolutePath,
      originalLabel: file,
      relativePath: relativePosixPath(root, absolutePath)
    }));
  }
  return Object.freeze(captured);
}

function parseTerminal(stdout: Uint8Array, nonce: string, file: string): FastSuiteTerminal {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch (error) {
    throw new CompilerError(
      'VERIFY-BUILD-006',
      `Test file "${file}" child output is not exact UTF-8`,
      {},
      { cause: error }
    );
  }
  const matching = source.split(/\r?\n/u).filter((line) => line.includes(nonce));
  if (matching.length !== 1) {
    throw new CompilerError(
      'VERIFY-BUILD-006',
      `Test file "${file}" did not produce one exact terminal receipt`,
      { matchingReceiptLines: matching.length }
    );
  }
  let parsed: unknown;
  try {
    parsed = parseExactJson(matching[0]!, 'Fast suite terminal receipt', undefined, 3);
  } catch (error) {
    throw new CompilerError(
      'VERIFY-BUILD-006',
      `Test file "${file}" terminal receipt is invalid`,
      {},
      { cause: error }
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CompilerError('VERIFY-BUILD-006', `Test file "${file}" terminal receipt is not an object`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== FAST_SUITE_WORKER_RESULT_SCHEMA || record.nonce !== nonce) {
    throw new CompilerError('VERIFY-BUILD-006', `Test file "${file}" terminal receipt identity is invalid`);
  }
  if (record.status === 'passed') {
    if (Object.keys(record).sort().join(',') !== 'nonce,schema,status') {
      throw new CompilerError('VERIFY-BUILD-006', `Test file "${file}" passed receipt has extra fields`);
    }
    return Object.freeze({ status: 'passed' });
  }
  if (record.status === 'failed') {
    if (Object.keys(record).sort().join(',') !== 'failure,failureKind,nonce,schema,status'
        || (record.failureKind !== 'missing-export'
          && record.failureKind !== 'sandbox-unavailable'
          && record.failureKind !== 'suite-failure')
        || typeof record.failure !== 'string'
        || record.failure.length > 4096) {
      throw new CompilerError('VERIFY-BUILD-006', `Test file "${file}" failed receipt is invalid`);
    }
    return Object.freeze({
      status: 'failed',
      failureKind: record.failureKind,
      failure: record.failure
    });
  }
  throw new CompilerError('VERIFY-BUILD-006', `Test file "${file}" terminal status is invalid`);
}

function compileFastSuiteOperation(input: Readonly<{
  environment: NodeJS.ProcessEnv;
  file: CapturedSuite;
  providerIdentityDigest: OperationDigest;
}>): BoundSemanticOperation {
  const deadlineAtUnixMs = Date.now() + FAST_SUITE_PROCESS_MAX_DURATION_MS;
  const contractDigest = sha256({
    domain: 'verification.fast-suite-process.contract-v1',
    durationMs: FAST_SUITE_PROCESS_MAX_DURATION_MS,
    inputBytes: FAST_SUITE_PROCESS_MAX_INPUT_BYTES,
    outputBytes: FAST_SUITE_PROCESS_MAX_STDOUT_BYTES + FAST_SUITE_PROCESS_MAX_STDERR_BYTES,
    processes: FAST_SUITE_PROCESS_MAX_NATIVE_RESOURCES
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: FAST_SUITE_PROCESS_OPERATION,
    intentDigest: sha256({
      domain: 'verification.fast-suite-process.intent-v1',
      file: input.file.relativePath,
      environment: input.environment,
      providerIdentityDigest: input.providerIdentityDigest
    }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: FAST_SUITE_PROCESS_MAX_DURATION_MS },
      { resource: 'input-bytes', maximum: FAST_SUITE_PROCESS_MAX_INPUT_BYTES },
      {
        resource: 'output-bytes',
        maximum: FAST_SUITE_PROCESS_MAX_STDOUT_BYTES + FAST_SUITE_PROCESS_MAX_STDERR_BYTES
      },
      { resource: 'processes', maximum: FAST_SUITE_PROCESS_MAX_NATIVE_RESOURCES }
    ],
    requirements: [{
      id: FAST_SUITE_PROCESS_REQUIREMENT,
      contractDigest,
      effectKinds: ['filesystem', 'process'],
      failureKinds: [
        'filesystem.identity-drift',
        'process.cancelled',
        'process.deadline-exhausted',
        'process.identity-drift',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: FAST_SUITE_PROCESS_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

async function withSuiteEnvironment<Value>(
  signal: AbortSignal | undefined,
  execute: (environment: NodeJS.ProcessEnv) => Promise<Value>
): Promise<Value> {
  throwIfNativeAborted(signal);
  const temporaryParent = inspectNoFollowDirectoryChain(
    os.tmpdir(),
    'Fast suite process temporary parent'
  ).target;
  const temporaryRoot = createExclusiveNoFollowRandomDirectory(
    temporaryParent,
    'sec-fast-suite-process-'
  );
  let outcome:
    | Readonly<{ status: 'succeeded'; value: Value }>
    | Readonly<{ status: 'failed'; error: unknown }>;
  try {
    await ensureIsolatedProcessDirectories(temporaryRoot.path);
    assertSameNoFollowDirectoryIdentity(temporaryRoot, 'Fast suite process temporary root');
    const additional: NodeJS.ProcessEnv = { CI: 'true' };
    if (process.env[ISOLATED_VERIFICATION_ENV_KEY] !== undefined) {
      additional[ISOLATED_VERIFICATION_ENV_KEY] = process.env[ISOLATED_VERIFICATION_ENV_KEY];
    }
    if (process.env.TEST_PORT !== undefined) additional.TEST_PORT = process.env.TEST_PORT;
    const environment = buildIsolatedProcessEnvironment(
      temporaryRoot.path,
      additional,
      process.env
    );
    outcome = Object.freeze({ status: 'succeeded', value: await execute(environment) });
  } catch (error) {
    outcome = Object.freeze({ status: 'failed', error });
  }
  await settleResourcesAsync({
    ...(outcome.status === 'failed'
      ? { primary: { label: 'fast suite process execution', error: outcome.error } }
      : {}),
    cleanup: [{
      label: 'fast suite process temporary generation retirement',
      settle: () => {
        const deadlineAtMonotonicMs = performance.now() + FAST_SUITE_TEMP_CLEANUP_DURATION_MS;
        const inventory = scanNoFollowDirectoryTreeMetadata(temporaryRoot, {
          deadlineAtMs: deadlineAtMonotonicMs,
          maximumEntries: FAST_SUITE_TEMP_MAXIMUM_ENTRIES,
          includePermissionMode: true
        });
        retireNoFollowDirectoryTree({
          deadlineAtMonotonicMs,
          inventory,
          parent: temporaryParent,
          root: temporaryRoot,
          restoreOwnerPermissions: true
        });
      }
    }]
  });
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

async function runOneSuite(input: Readonly<{
  boundary: ReturnType<typeof issueRetainedCommandBoundary>;
  environment: NodeJS.ProcessEnv;
  file: CapturedSuite;
  providerIdentityDigest: OperationDigest;
  signal?: AbortSignal;
  commitFence?: CommitFence;
  sealedGeneration: boolean;
}>): Promise<void> {
  const nonce = randomBytes(32).toString('hex');
  const temporaryDirectory = input.environment.TMPDIR ?? input.environment.TEMP ?? input.environment.TMP ?? null;
  const writableRoot = typeof temporaryDirectory === 'string'
    ? path.dirname(temporaryDirectory)
    : null;
  if (input.sealedGeneration && (typeof writableRoot !== 'string' || !path.isAbsolute(writableRoot))) {
    throw new CompilerError(
      'VERIFY-BUILD-006',
      'Sealed fast suite execution requires one absolute writable temporary root'
    );
  }
  const commandInput = Buffer.from(`${JSON.stringify({
    schema: FAST_SUITE_WORKER_INPUT_SCHEMA,
    nonce,
    relativeFile: input.file.relativePath,
    sealedGeneration: input.sealedGeneration,
    writableRoot
  })}\n`, 'utf8');
  if (commandInput.byteLength > FAST_SUITE_PROCESS_MAX_INPUT_BYTES) {
    throw new CompilerError('VERIFY-BUILD-006', 'Fast suite worker input exceeds its process budget');
  }
  const operation = compileFastSuiteOperation({
    environment: input.environment,
    file: input.file,
    providerIdentityDigest: input.providerIdentityDigest
  });
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: FAST_SUITE_PROCESS_REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    }),
    signal: input.signal
  });
  const args = Object.freeze([
    '--no-env-file',
    '--no-install',
    '--eval',
    FAST_SUITE_WORKER_SOURCE
  ]);
  let runResult: ProcessResourceRunResult | undefined;
  // A thrown undefined is still a failure; presence and payload are distinct.
  let executionFailure: Readonly<{ error: unknown }> | undefined;
  let receipt: ProcessResourceSessionReceipt | undefined;
  try {
    await input.commitFence?.();
    runResult = await session.run(input.boundary, args, {
      env: input.environment,
      envMode: 'replace',
      input: commandInput,
      maxStdinBytes: FAST_SUITE_PROCESS_MAX_INPUT_BYTES,
      maxStdoutBytes: FAST_SUITE_PROCESS_MAX_STDOUT_BYTES,
      maxStderrBytes: FAST_SUITE_PROCESS_MAX_STDERR_BYTES,
      beforeSpawn: input.commitFence
    });
    await input.commitFence?.();
  } catch (error) {
    executionFailure = { error };
  }
  settleResources({
    ...(executionFailure === undefined
      ? {}
      : { primary: { label: 'fast suite process attempt', error: executionFailure.error } }),
    cleanup: [{
      label: 'fast suite process session close',
      settle: () => {
        receipt = session.close();
        assertProcessResourceSessionReceipt(receipt, {
          operationIdentityDigest: operation.plan.identity.identityDigest,
          boundAttemptDigest: operation.boundAttemptDigest,
          requirementId: FAST_SUITE_PROCESS_REQUIREMENT
        });
      }
    }]
  });
  if (runResult === undefined || receipt === undefined) {
    throw new Error('Fast suite process settled without one exact result and receipt');
  }
  assertProcessResourceRunResult(runResult, receipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: FAST_SUITE_PROCESS_REQUIREMENT,
    boundary: input.boundary,
    args,
    input: commandInput,
    env: input.environment,
    envMode: 'replace',
    ordinal: 1
  });
  const expectedNativeResources = process.platform === 'win32' ? 2 : 1;
  if (receipt.processCount !== 1 || receipt.settledProcessCount !== 1
      || receipt.successfulProcessRecordCount !== 1 || receipt.failedProcessCount !== 0
      || receipt.rootProcessCount !== 1 || receipt.stdinWorkerCount !== expectedNativeResources - 1
      || receipt.helperProcessCount !== 0
      || receipt.admittedNativeResourceCount !== expectedNativeResources
      || receipt.startedNativeResourceCount !== expectedNativeResources
      || receipt.settledNativeResourceCount !== expectedNativeResources
      || receipt.failedNativeAdmissionCount !== 0
      || receipt.inputBytes !== commandInput.byteLength
      || receipt.outputBytes > FAST_SUITE_PROCESS_MAX_STDOUT_BYTES + FAST_SUITE_PROCESS_MAX_STDERR_BYTES) {
    throw new Error('Fast suite process terminal resource receipt is inconsistent');
  }

  const terminal = parseTerminal(runResult.result.stdout, nonce, input.file.originalLabel);
  if (terminal.status === 'passed') {
    if (runResult.result.code !== 0) {
      throw new CompilerError(
        'VERIFY-BUILD-006',
        `Test file "${input.file.originalLabel}" passed receipt disagrees with child exit`
      );
    }
    return;
  }
  if (runResult.result.code === 0) {
    throw new CompilerError(
      'VERIFY-BUILD-006',
      `Test file "${input.file.originalLabel}" failed receipt disagrees with child exit`
    );
  }
  if (terminal.failureKind === 'sandbox-unavailable') {
    throw new CompilerError(
      'VERIFY-BUILD-006',
      `Test file "${input.file.originalLabel}" sealed execution sandbox is unavailable`,
      { failure: terminal.failure }
    );
  }
  if (terminal.failureKind === 'missing-export') {
    throw new CompilerError(
      'VERIFY-BUILD-002',
      `Test file "${input.file.originalLabel}" must export runSuite()`
    );
  }
  throw new CompilerError(
    'VERIFY-BUILD-007',
    `Test file "${input.file.originalLabel}" failed in its bounded child process`,
    { failure: terminal.failure }
  );
}

export async function runSuiteProcesses(
  untrustedInput: FastSuiteProcessInput
): Promise<void> {
  const input = captureFastSuiteProcessInput(untrustedInput);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const suiteRoot = path.resolve(input.suiteRoot);
  const onSuitePassed = input.onSuitePassed;
  const signal = input.signal;
  const commitFence = input.commitFence;
  const workspaceInputMode = input.workspaceInputMode ?? 'live-workspace';
  if (commitFence !== undefined && typeof commitFence !== 'function') {
    throw new TypeError('Fast suite commit fence must be callable');
  }
  throwIfNativeAborted(signal);
  if (onSuitePassed !== undefined && typeof onSuitePassed !== 'function') {
    throw new TypeError('Suite pass recorder must be callable');
  }
  const files = captureSuites(workspaceRoot, suiteRoot, input.files);
  await commitFence?.();

  const executablePath = path.resolve(await fs.realpath(process.execPath));
  let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
  let liveWorkingDirectory: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let exactGeneration: FastSuiteExecutionGeneration | undefined;
  let boundary: ReturnType<typeof issueRetainedCommandBoundary> | undefined;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const executableParent = inspectNoFollowDirectoryChain(
      path.dirname(executablePath),
      'Fast suite Bun executable parent'
    );
    executable = retainNoFollowOrdinaryFile(
      executableParent,
      path.basename(executablePath),
      undefined,
      'Fast suite Bun executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    const workspaceChain = inspectNoFollowDirectoryChain(
      workspaceRoot,
      'Fast suite workspace root'
    );
    if (workspaceInputMode === 'sealed-generation') {
      exactGeneration = await materializeFastSuiteExecutionGeneration({
        workspaceRoot,
        commitFence,
        signal
      });
    } else {
      liveWorkingDirectory = retainNoFollowDirectoryForChildProcess(
        workspaceChain,
        RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
        'Fast suite workspace root'
      );
    }
    const workingDirectory = exactGeneration?.generation.workingDirectory ?? liveWorkingDirectory!;
    const executionFence = async (): Promise<void> => {
      await commitFence?.();
      await exactGeneration?.assertCurrent();
    };
    await executionFence();
    const providerIdentityDigest = sha256({
      domain: 'verification.fast-suite-process.physical-provider-v2',
      providerRevision: FAST_SUITE_PROCESS_PROVIDER_REVISION,
      workerSourceDigest: sha256({ source: FAST_SUITE_WORKER_SOURCE }),
      executable: {
        path: executable.path,
        parent: executable.parent,
        physical: executable.physical,
        digest: executable.digest()
      },
      workspace: exactGeneration === undefined
        ? { kind: 'live-workspace', root: workspaceChain.target }
        : {
            kind: 'sealed-generation',
            inputDigest: exactGeneration.inputDigest
          }
    }) as OperationDigest;
    boundary = issueRetainedCommandBoundary({ executable, workingDirectory });

    for (const file of files) {
      throwIfNativeAborted(signal);
      await withSuiteEnvironment(signal, async (environment) => {
        await runOneSuite({
          boundary: boundary!,
          environment,
          file,
          providerIdentityDigest,
          signal,
          commitFence: executionFence,
          sealedGeneration: exactGeneration !== undefined
        });
      });
      await executionFence();
      throwIfNativeAborted(signal);
      await onSuitePassed?.(file.originalLabel);
      // An awaited recorder may invalidate the candidate or its authorization.
      // Its return is not a currentness proof for the enclosing verification.
      await executionFence();
      throwIfNativeAborted(signal);
    }
  } catch (error) {
    primaryFailure = { error };
  }

  await settleResourcesAsync({
    ...(primaryFailure === undefined
      ? {}
      : { primary: { label: 'fast suite process execution', error: primaryFailure.error } }),
    cleanup: [
      ...(exactGeneration === undefined ? [] : [{
        label: 'fast suite sealed generation retirement',
        settle: async () => { await exactGeneration!.retire(); }
      }]),
      ...(liveWorkingDirectory === undefined ? [] : [{
        label: 'fast suite workspace capability dispose',
        settle: () => liveWorkingDirectory!.dispose()
      }]),
      ...(executable === undefined ? [] : [{
        label: 'fast suite executable capability dispose',
        settle: () => executable!.dispose()
      }])
    ]
  });
}
