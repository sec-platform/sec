import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  retainCommandAuxiliaryOrdinaryFiles,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  RetainedCommandTransportError
} from '../../runtime-state/physical/runtime/process.ts';
import { settlePhysicalResources } from '../../runtime-state/physical/runtime/resource-settlement.ts';
import type { RetainedCommandBoundary } from '../../runtime-state/physical/runtime/retained-command-boundary.ts';
import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import { compilerRoot } from '../../workspace/runtime/paths.ts';
import { DEFAULT_FAST_TEST_MAX_CONCURRENCY } from './fast-test-policy.ts';
import { applyDefaultFastTestConcurrency } from './test-concurrency-policy.ts';
import { captureDevCommandInput, DEV_COMMAND_MAX_DURATION_MS, DEV_COMMAND_MAX_STDIN_BYTES,
  type DevCommandOptions, type ObserveDevCommandOptions } from './command-input.ts';
import { failureMessage } from '../../system-architecture/foundation/runtime/failure-inspection.ts';
import { snapshotByteTail } from '../../system-architecture/foundation/runtime/byte-snapshot.ts';
import { requireCommandExitCode, type DevCommandObservation, type DevCommandTerminalOutcome } from './command-outcome.ts';
export { devCommandObservationExitCode } from './command-outcome.ts';
export type { DevCommandObservation, DevCommandObservationIntegrity, DevCommandTerminalOutcome } from './command-outcome.ts';
export { DEV_COMMAND_MAX_DURATION_MS, DEV_COMMAND_MAX_STDIN_BYTES } from './command-input.ts';
export type { ExecuteDevCommandOptions, ObserveDevCommandOptions } from './command-input.ts';

export const DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES = 8 * 1024;
export const DEV_COMMAND_MAX_STDOUT_BYTES = 32 * 1024 * 1024;
export const DEV_COMMAND_MAX_STDERR_BYTES = 32 * 1024 * 1024;

const DEV_COMMAND_REQUIREMENT_ID = 'development.runner.bun-process';
const DEV_COMMAND_CONTRACT_DIGEST = sha256({
  domain: 'development.runner.bun-command',
  executable: 'current-bun-runtime',
  workingDirectory: 'owner-admitted-retained-directory',
  maximumNativeProcessResources: 2,
  maximumDurationMs: DEV_COMMAND_MAX_DURATION_MS,
  maximumStdinBytes: DEV_COMMAND_MAX_STDIN_BYTES,
  maximumStdoutBytes: DEV_COMMAND_MAX_STDOUT_BYTES,
  maximumStderrBytes: DEV_COMMAND_MAX_STDERR_BYTES
}) as SecOperationDigest;

export function boundedUtf8TextTail(
  value: string | Uint8Array,
  maximumBytes: number
): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error('UTF-8 text tail maximum must be a non-negative safe integer.');
  }
  if (maximumBytes === 0) return '';

  const normalized = typeof value === 'string'
    ? Buffer.from(value, 'utf8').toString('utf8')
    : (() => {
        const bytes = Buffer.from(value);
        let firstCodePointBoundary = 0;
        while (
          firstCodePointBoundary < bytes.byteLength &&
          (bytes[firstCodePointBoundary] & 0xc0) === 0x80
        ) {
          firstCodePointBoundary += 1;
        }
        return bytes.subarray(firstCodePointBoundary).toString('utf8');
      })();
  if (Buffer.byteLength(normalized, 'utf8') <= maximumBytes) return normalized;

  let retainedBytes = 0;
  let retainedStart = normalized.length;
  while (retainedStart > 0) {
    let characterStart = retainedStart - 1;
    const finalCodeUnit = normalized.charCodeAt(characterStart);
    if (
      finalCodeUnit >= 0xdc00 &&
      finalCodeUnit <= 0xdfff &&
      characterStart > 0
    ) {
      const precedingCodeUnit = normalized.charCodeAt(characterStart - 1);
      if (precedingCodeUnit >= 0xd800 && precedingCodeUnit <= 0xdbff) {
        characterStart -= 1;
      }
    }

    const characterBytes = Buffer.byteLength(
      normalized.slice(characterStart, retainedStart),
      'utf8'
    );
    if (retainedBytes + characterBytes > maximumBytes) break;
    retainedBytes += characterBytes;
    retainedStart = characterStart;
  }
  return normalized.slice(retainedStart);
}

type DevCommandResult<TOptions extends DevCommandOptions | undefined> =
  TOptions extends ObserveDevCommandOptions ? DevCommandObservation : number;

function transportFailure(error: unknown): RetainedCommandTransportError | null {
  // Classification is not allowed to replace a revoked-proxy failure.
  try { return error instanceof RetainedCommandTransportError ? error : null; }
  catch { return null; }
}

function appendOutputTail(
  current: Buffer<ArrayBufferLike>,
  chunk: Uint8Array
): Buffer<ArrayBufferLike> {
  // Capture only the diagnostic suffix. Output resource charging still belongs
  // to the process session and counts the complete provider chunk.
  const bytes = snapshotByteTail(chunk, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES, 'Dev command output');
  if (bytes.byteLength >= DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES) return bytes;
  const retainedCurrent = current.subarray(Math.max(
    0,
    current.byteLength + bytes.byteLength - DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES
  ));
  return Buffer.concat([retainedCurrent, bytes]);
}

function physicalOutcomeTerminal(
  outcome: RetainedCommandTransportError['outcome']
): DevCommandTerminalOutcome {
  if (outcome.status === 'spawn-failed') {
    return { kind: 'spawn-failed', error: 'canonical observed command transport failed to spawn' };
  }
  if (outcome.exitCode !== null && outcome.signal !== null) {
    return { kind: 'unresolved', reason: 'contradictory-close-status' };
  }
  if (outcome.signal !== null) {
    return { kind: 'signaled', signal: outcome.signal };
  }
  if (outcome.exitCode !== null) {
    return { kind: 'exited', exitCode: outcome.exitCode };
  }
  return {
    kind: 'unresolved',
    reason: outcome.exitCode === null && outcome.signal === null
      ? 'close-without-status'
      : 'contradictory-close-status'
  };
}

function compileDevCommandOperation(input: Readonly<{
  auxiliaryOrdinaryFilePaths: readonly string[];
  deadlineAtUnixMs: number;
  effectiveArgv: readonly string[];
  environment: Readonly<NodeJS.ProcessEnv>;
  inputDigest: `sha256:${string}`;
  inputBytes: number;
  maximumNativeProcessResources: number;
  providerIdentityDigest: SecOperationDigest;
  timeoutMs: number;
  workingDirectory: string;
}>): SecBoundSemanticOperation {
  const plan = compileSecSemanticOperationPlan({
    operation: 'development.runner.bun-command',
    intentDigest: sha256({
      effectiveArgv: input.effectiveArgv,
      environment: input.environment,
      inputDigest: input.inputDigest,
      auxiliaryOrdinaryFilePaths: input.auxiliaryOrdinaryFilePaths,
      workingDirectory: input.workingDirectory
    }) as SecOperationDigest,
    decisionDigest: DEV_COMMAND_CONTRACT_DIGEST,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: DEV_COMMAND_CONTRACT_DIGEST
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: input.timeoutMs },
      { resource: 'input-bytes', maximum: input.inputBytes },
      {
        resource: 'output-bytes',
        maximum: DEV_COMMAND_MAX_STDOUT_BYTES + DEV_COMMAND_MAX_STDERR_BYTES
      },
      { resource: 'processes', maximum: input.maximumNativeProcessResources }
    ],
    requirements: [{
      id: DEV_COMMAND_REQUIREMENT_ID,
      contractDigest: DEV_COMMAND_CONTRACT_DIGEST,
      effectKinds: ['process'],
      failureKinds: [
        'development.runner.cancelled',
        'development.runner.deadline-exhausted',
        'development.runner.output-limit-exceeded',
        'development.runner.physical-identity-drift',
        'development.runner.spawn-failed',
        'development.runner.termination-unproven'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: DEV_COMMAND_REQUIREMENT_ID,
    contractDigest: DEV_COMMAND_CONTRACT_DIGEST,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

interface DevCommandPhysicalCapability {
  readonly auxiliaryOrdinaryFiles: readonly RetainedNoFollowOrdinaryFile[];
  readonly boundary: RetainedCommandBoundary;
  readonly executable: RetainedNoFollowOrdinaryFile;
  readonly providerIdentityDigest: SecOperationDigest;
  readonly workingDirectory: RetainedNoFollowChildProcessDirectory;
}

/** All acquisition and execution exits release the same owned closure, in the
 * original order. A partially acquired capability simply omits missing members.
 * This selects cleanup actions; settlePhysicalResources remains the sole owner
 * of sequential attempts and combined primary/cleanup failures.
 */
function devCommandCleanup(
  capability: Readonly<{
    auxiliaryOrdinaryFiles: readonly RetainedNoFollowOrdinaryFile[];
    executable?: RetainedNoFollowOrdinaryFile;
    workingDirectory?: RetainedNoFollowChildProcessDirectory;
  }>,
  closeSession?: () => void
) {
  const { auxiliaryOrdinaryFiles, executable, workingDirectory } = capability;
  return [
    ...[...auxiliaryOrdinaryFiles].reverse().map((file, index) => ({
      label: `dev-command-auxiliary-file-dispose[${index}]`, settle: () => file.dispose()
    })),
    ...(closeSession === undefined ? [] : [{ label: 'dev-command-process-session-close', settle: closeSession }]),
    ...(workingDirectory === undefined ? [] : [{ label: 'dev-command-working-directory-dispose', settle: () => workingDirectory.dispose() }]),
    ...(executable === undefined ? [] : [{ label: 'dev-command-executable-dispose', settle: () => executable.dispose() }])
  ];
}

const ISSUED_DEV_COMMAND_PHYSICAL_CAPABILITIES = new WeakSet<object>();

function issueDevCommandPhysicalCapability(input: Readonly<{
  auxiliaryOrdinaryFilePaths: readonly string[];
  workingDirectory: string;
}>): DevCommandPhysicalCapability {
  let auxiliaryOrdinaryFiles: readonly RetainedNoFollowOrdinaryFile[] = [];
  let executable: RetainedNoFollowOrdinaryFile | undefined;
  let workingDirectory: RetainedNoFollowChildProcessDirectory | undefined;
  try {
    const executablePath = path.resolve(process.execPath);
    executable = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(
        path.dirname(executablePath),
        'Dev command executable parent'
      ),
      path.basename(executablePath),
      undefined,
      'Dev command executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    const workingDirectoryChain = inspectNoFollowDirectoryChain(
      input.workingDirectory,
      'Dev command working directory'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Dev command working directory'
    );
    if (input.auxiliaryOrdinaryFilePaths.length > 0) {
      const requests = input.auxiliaryOrdinaryFilePaths.map((filePath, index) => ({
        expectedParent: inspectNoFollowDirectoryChain(
          path.dirname(filePath),
          `Dev command auxiliary file[${index}] parent`
        ),
        label: `Dev command auxiliary file[${index}]`,
        name: path.basename(filePath)
      }));
      auxiliaryOrdinaryFiles = retainCommandAuxiliaryOrdinaryFiles(
        requests as [typeof requests[number], ...typeof requests[number][]]
      );
    }
    const capability = Object.freeze({
      auxiliaryOrdinaryFiles,
      boundary: issueRetainedCommandBoundary({
        executable,
        workingDirectory,
        auxiliaryInputs: auxiliaryOrdinaryFiles.map((capability) => ({
          capability,
          kind: 'ordinary-file' as const
        }))
      }),
      executable,
      providerIdentityDigest: sha256({
        domain: 'development.runner.bun-command.physical-provider',
        executable: {
          path: executable.path,
          parent: executable.parent,
          physical: executable.physical,
          size: executable.size
        },
        auxiliaryOrdinaryFiles: auxiliaryOrdinaryFiles.map((file) => ({
          path: file.path,
          parent: file.parent,
          physical: file.physical,
          size: file.size
        })),
        workingDirectory: workingDirectoryChain.target
      }) as SecOperationDigest,
      workingDirectory
    });
    ISSUED_DEV_COMMAND_PHYSICAL_CAPABILITIES.add(capability);
    return capability;
  } catch (error) {
    settlePhysicalResources({
      primary: { label: 'dev-command-capability-admission', error },
      cleanup: devCommandCleanup({ auxiliaryOrdinaryFiles, executable, workingDirectory })
    });
    throw new Error('Unreachable Dev command capability admission state.');
  }
}

function assertDevCommandResourceReceipt(
  receipt: ProcessResourceSessionReceipt,
  operation: SecBoundSemanticOperation,
  completed: boolean,
  expectedInputBytes: number
): void {
  assertProcessResourceSessionReceipt(receipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: DEV_COMMAND_REQUIREMENT_ID
  });
  if (receipt.operationIdentityDigest !== operation.plan.identity.identityDigest
      || receipt.boundAttemptDigest !== operation.boundAttemptDigest
      || receipt.processCount < (completed ? 1 : 0)
      || receipt.processCount > 1
      || receipt.settledProcessCount !== receipt.processCount
      || receipt.successfulProcessRecordCount !== (completed ? 1 : 0)
      || receipt.inputBytes !== expectedInputBytes
      || receipt.outputBytes > DEV_COMMAND_MAX_STDOUT_BYTES + DEV_COMMAND_MAX_STDERR_BYTES) {
    throw new Error('Dev command process receipt does not match the owner operation.');
  }
}

function settleDevCommandExecution(input: Readonly<{
  capability: DevCommandPhysicalCapability;
  executionFailure: Readonly<{ error: unknown }> | undefined;
  completed: boolean;
  expectedInputBytes: number;
  operation: SecBoundSemanticOperation;
  session: ProcessResourceSession;
}>): void {
  if (!ISSUED_DEV_COMMAND_PHYSICAL_CAPABILITIES.has(input.capability)) {
    throw new Error('Dev command settlement requires an owner-issued physical capability.');
  }
  let receipt: ProcessResourceSessionReceipt | undefined;
  let sessionClosed = false;
  try {
    settlePhysicalResources({
      ...(input.executionFailure === undefined ? {} : {
        primary: { label: 'dev-command-execution', error: input.executionFailure.error }
      }),
      cleanup: [
        ...devCommandCleanup(input.capability, () => { receipt = input.session.close(); sessionClosed = true; }),
        {
          label: 'dev-command-terminal-receipt-readback',
          settle: () => {
            if (!sessionClosed) return; // close already contributed its own failure
            if (receipt === undefined) throw new Error('Dev command process session did not issue a terminal receipt.');
            assertDevCommandResourceReceipt(receipt, input.operation, input.completed, input.expectedInputBytes);
          }
        }
      ]
    });
  } catch (error) {
    if (input.executionFailure === undefined || !Object.is(error, input.executionFailure.error)) throw error;
  }
}

export function runDevCommand<TOptions extends DevCommandOptions | undefined = undefined>(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options?: TOptions
): Promise<DevCommandResult<TOptions>> {
  if (command !== 'bun') {
    return Promise.reject(new Error('Dev command owner accepts only the canonical Bun runtime.'));
  }
  const captured = captureDevCommandInput(args, env, options, compilerRoot);
  const { observed, input: commandInput, inputBytes, environment, workingDirectory,
    auxiliaryOrdinaryFilePaths, deadlineAtUnixMs, timeoutMs, maximumNativeProcessResources, signal } = captured;
  const effectiveArgs = applyDefaultFastTestConcurrency(
    command, [...captured.args], DEFAULT_FAST_TEST_MAX_CONCURRENCY
  );
  const effectiveArgv = Object.freeze([command, ...effectiveArgs]);

  const execute = async (): Promise<number | DevCommandObservation> => {
    const capability = issueDevCommandPhysicalCapability({
      auxiliaryOrdinaryFilePaths,
      workingDirectory
    });
    let operation: SecBoundSemanticOperation;
    let session: ProcessResourceSession;
    try {
      operation = compileDevCommandOperation({
        auxiliaryOrdinaryFilePaths,
        deadlineAtUnixMs,
        effectiveArgv,
        environment,
        inputBytes,
        inputDigest: rawSha256(commandInput ?? new Uint8Array()),
        maximumNativeProcessResources,
        providerIdentityDigest: capability.providerIdentityDigest,
        timeoutMs,
        workingDirectory
      });
      session = openProcessResourceSession({
        operation,
        requirementBindingContext: issueSecOperationRequirementBindingContext({
          operation,
          requirementId: DEV_COMMAND_REQUIREMENT_ID,
          resourceCeilings: [
            { resource: 'duration-ms', maximum: timeoutMs },
            { resource: 'input-bytes', maximum: inputBytes },
            {
              resource: 'output-bytes',
              maximum: DEV_COMMAND_MAX_STDOUT_BYTES + DEV_COMMAND_MAX_STDERR_BYTES
            },
            { resource: 'processes', maximum: maximumNativeProcessResources }
          ]
        }),
        signal
      });
    } catch (error) {
      settlePhysicalResources({
        primary: { label: 'dev-command-process-session-admission', error },
        cleanup: devCommandCleanup(capability)
      });
      throw new Error('Unreachable Dev command session admission state.');
    }
    const startedAt = performance.now();
    let result: Awaited<ReturnType<ProcessResourceSession['run']>> | undefined;
    let executionFailure: Readonly<{ error: unknown }> | undefined;
    let forwardingFailure: string | null = null;
    let stdoutTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    try {
      result = await session.run(capability.boundary, effectiveArgs, {
        admitProgress: (chunk, stream) => {
          if (stream === 'stdout') stdoutTail = appendOutputTail(stdoutTail, chunk);
          else stderrTail = appendOutputTail(stderrTail, chunk);
          try {
            (stream === 'stdout' ? process.stdout : process.stderr).write(chunk);
          } catch (error) {
            forwardingFailure ??= `${stream} forwarding failed: ${failureMessage(error)}`;
          }
          return true;
        },
        env: environment,
        envMode: 'replace',
        ...(commandInput === undefined ? {} : {
          input: commandInput,
          maxStdinBytes: commandInput.byteLength
        }),
        maxStderrBytes: DEV_COMMAND_MAX_STDERR_BYTES,
        maxStdoutBytes: DEV_COMMAND_MAX_STDOUT_BYTES
      });
    } catch (error) {
      executionFailure = { error };
    }
    settleDevCommandExecution({
      capability,
      completed: result !== undefined,
      executionFailure,
      expectedInputBytes: inputBytes,
      operation,
      session
    });

    if (result === undefined) {
      const executionError = executionFailure?.error;
      const transport = transportFailure(executionError);
      if (!observed) {
        if (transport !== null && transport.outcome.status !== 'spawn-failed') {
          return 1;
        }
        throw executionError;
      }
      const terminal = transport !== null
        ? physicalOutcomeTerminal(transport.outcome)
        : { kind: 'unresolved' as const, reason: 'close-without-status' as const };
      const integrityError = forwardingFailure ?? failureMessage(executionError);
      const observation = Object.freeze({
        schema: 'sec-dev-command-observation-v1' as const,
        effectiveArgv,
        terminal: Object.freeze(terminal),
        observationIntegrity: Object.freeze({
          kind: 'failed' as const,
          error: integrityError
        }),
        durationMs: transport !== null
          ? Math.max(0, transport.outcome.durationMs)
          : Math.max(0, performance.now() - startedAt),
        stdoutTail: boundedUtf8TextTail(stdoutTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES),
        stderrTail: boundedUtf8TextTail(stderrTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)
      });
      return observation;
    }

    if (!observed) {
      if (forwardingFailure !== null) throw new Error(forwardingFailure);
      return requireCommandExitCode(result.result.code, 'Dev command result');
    }
    return Object.freeze({
      schema: 'sec-dev-command-observation-v1' as const,
      effectiveArgv,
      terminal: Object.freeze({ kind: 'exited' as const, exitCode: requireCommandExitCode(result.result.code, 'Dev command result') }),
      observationIntegrity: Object.freeze(forwardingFailure === null
        ? { kind: 'complete' as const }
        : { kind: 'failed' as const, error: forwardingFailure }),
      durationMs: Math.max(0, performance.now() - startedAt),
      stdoutTail: boundedUtf8TextTail(stdoutTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES),
      stderrTail: boundedUtf8TextTail(stderrTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)
    });
  };

  return execute() as Promise<DevCommandResult<TOptions>>;
}
