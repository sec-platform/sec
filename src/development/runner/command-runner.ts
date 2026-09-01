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

export const DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES = 8 * 1024;
export const DEV_COMMAND_MAX_DURATION_MS = 5 * 60 * 1000;
export const DEV_COMMAND_MAX_STDIN_BYTES = 1024 * 1024;
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

export type DevCommandTerminalOutcome =
  | { readonly kind: 'exited'; readonly exitCode: number }
  | { readonly kind: 'signaled'; readonly signal: NodeJS.Signals }
  | { readonly kind: 'spawn-failed'; readonly error: string }
  | {
      readonly kind: 'unresolved';
      readonly reason: 'close-without-status' | 'contradictory-close-status';
    };

export type DevCommandObservationIntegrity =
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: string };

export interface DevCommandObservation {
  readonly schema: 'sec-dev-command-observation-v1';
  readonly effectiveArgv: readonly string[];
  readonly terminal: DevCommandTerminalOutcome;
  readonly observationIntegrity: DevCommandObservationIntegrity;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export interface ObserveDevCommandOptions {
  readonly observe: true;
  /** Ordinary-file inputs that must remain physically identical for the child lifetime. */
  readonly auxiliaryOrdinaryFilePaths?: readonly string[];
  /** Narrows the owner ceiling; callers cannot widen it. */
  readonly timeoutMs?: number;
  /** Narrows the owner deadline without starting a new duration window. */
  readonly deadlineAtUnixMs?: number;
  /** Immutable bytes admitted to the single child stdin stream. */
  readonly input?: Uint8Array;
  readonly signal?: AbortSignal;
  /** Owner-admitted and retained cwd; defaults to the compiler root. */
  readonly workingDirectory?: string;
}

export interface ExecuteDevCommandOptions {
  readonly observe?: false;
  /** Ordinary-file inputs that must remain physically identical for the child lifetime. */
  readonly auxiliaryOrdinaryFilePaths?: readonly string[];
  /** Narrows the owner ceiling; callers cannot widen it. */
  readonly timeoutMs?: number;
  /** Narrows the owner deadline without starting a new duration window. */
  readonly deadlineAtUnixMs?: number;
  /** Immutable bytes admitted to the single child stdin stream. */
  readonly input?: Uint8Array;
  readonly signal?: AbortSignal;
  /** Owner-admitted and retained cwd; defaults to the compiler root. */
  readonly workingDirectory?: string;
}

type DevCommandOptions = ObserveDevCommandOptions | ExecuteDevCommandOptions;

type DevCommandResult<TOptions extends DevCommandOptions | undefined> =
  TOptions extends ObserveDevCommandOptions ? DevCommandObservation : number;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendOutputTail(
  current: Buffer<ArrayBufferLike>,
  chunk: Uint8Array
): Buffer<ArrayBufferLike> {
  const bytes = Buffer.from(chunk);
  if (bytes.byteLength >= DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES) {
    return Buffer.from(bytes.subarray(bytes.byteLength - DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES));
  }
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

function commandTiming(options: DevCommandOptions | undefined): Readonly<{
  deadlineAtUnixMs: number;
  timeoutMs: number;
}> {
  const timeoutMs = options?.timeoutMs ?? DEV_COMMAND_MAX_DURATION_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 2 || timeoutMs > DEV_COMMAND_MAX_DURATION_MS) {
    throw new Error('Dev command timeout must be a safe integer within the owner duration ceiling.');
  }
  const now = Date.now();
  const ownerDeadlineAtUnixMs = now + timeoutMs;
  const parentDeadlineAtUnixMs = options?.deadlineAtUnixMs ?? ownerDeadlineAtUnixMs;
  if (!Number.isSafeInteger(parentDeadlineAtUnixMs)) {
    throw new Error('Dev command parent deadline must be a safe integer.');
  }
  const deadlineAtUnixMs = Math.min(ownerDeadlineAtUnixMs, parentDeadlineAtUnixMs);
  const remainingMs = deadlineAtUnixMs - now;
  if (remainingMs < 2) {
    throw new Error('Dev command parent deadline is exhausted.');
  }
  return Object.freeze({ deadlineAtUnixMs, timeoutMs: remainingMs });
}

function exactCommandEnvironment(overrides: NodeJS.ProcessEnv): Readonly<NodeJS.ProcessEnv> {
  const entries = new Map<string, string>();
  const apply = (source: NodeJS.ProcessEnv): void => {
    for (const [rawKey, value] of Object.entries(source)) {
      if (rawKey.length === 0 || rawKey.includes('\0') || rawKey.includes('=')) {
        throw new Error('Dev command environment key is not canonical.');
      }
      if (value?.includes('\0')) {
        throw new Error('Dev command environment value is not canonical.');
      }
      const key = process.platform === 'win32' ? rawKey.toUpperCase() : rawKey;
      if (value === undefined) entries.delete(key);
      else entries.set(key, value);
    }
  };
  apply(process.env);
  apply(overrides);
  return Object.freeze(Object.fromEntries(
    [...entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  ));
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
      cleanup: [
        ...[...auxiliaryOrdinaryFiles].reverse().map((file, index) => ({
          label: `dev-command-auxiliary-file-dispose[${index}]`,
          settle: () => file.dispose()
        })),
        ...(workingDirectory === undefined ? [] : [{
          label: 'dev-command-working-directory-dispose',
          settle: () => workingDirectory!.dispose()
        }]),
        ...(executable === undefined ? [] : [{
          label: 'dev-command-executable-dispose',
          settle: () => executable!.dispose()
        }])
      ]
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
  executionError: unknown | null;
  completed: boolean;
  expectedInputBytes: number;
  operation: SecBoundSemanticOperation;
  session: ProcessResourceSession;
}>): void {
  if (!ISSUED_DEV_COMMAND_PHYSICAL_CAPABILITIES.has(input.capability)) {
    throw new Error('Dev command settlement requires an owner-issued physical capability.');
  }
  let receipt: ProcessResourceSessionReceipt | undefined;
  try {
    settlePhysicalResources({
      ...(input.executionError === null ? {} : {
        primary: { label: 'dev-command-execution', error: input.executionError }
      }),
      cleanup: [
        ...[...input.capability.auxiliaryOrdinaryFiles].reverse().map((file, index) => ({
          label: `dev-command-auxiliary-file-dispose[${index}]`,
          settle: () => file.dispose()
        })),
        {
          label: 'dev-command-process-session-close',
          settle: () => { receipt = input.session.close(); }
        },
        {
          label: 'dev-command-working-directory-dispose',
          settle: () => input.capability.workingDirectory.dispose()
        },
        {
          label: 'dev-command-executable-dispose',
          settle: () => input.capability.executable.dispose()
        }
      ]
    });
  } catch (error) {
    if (error !== input.executionError) throw error;
  }
  if (receipt === undefined) {
    throw new Error('Dev command process session did not issue a terminal receipt.');
  }
  assertDevCommandResourceReceipt(
    receipt,
    input.operation,
    input.completed,
    input.expectedInputBytes
  );
}

export function devCommandObservationExitCode(observation: DevCommandObservation): number {
  if (observation.observationIntegrity.kind === 'failed') return 1;
  return observation.terminal.kind === 'exited' ? observation.terminal.exitCode : 1;
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
  const observed = options?.observe === true;
  const effectiveArgs = applyDefaultFastTestConcurrency(
    command,
    args,
    DEFAULT_FAST_TEST_MAX_CONCURRENCY
  );
  const effectiveArgv = Object.freeze([command, ...effectiveArgs]);
  const { deadlineAtUnixMs, timeoutMs } = commandTiming(options);
  const commandInput = options?.input === undefined
    ? undefined
    : new Uint8Array(options.input);
  if (commandInput !== undefined && commandInput.byteLength > DEV_COMMAND_MAX_STDIN_BYTES) {
    throw new Error('Dev command stdin exceeds the owner input-byte ceiling.');
  }
  const inputBytes = commandInput?.byteLength ?? 0;
  const maximumNativeProcessResources =
    process.platform === 'win32' && commandInput !== undefined ? 2 : 1;
  const environment = exactCommandEnvironment(env);
  const workingDirectory = path.resolve(options?.workingDirectory ?? compilerRoot);
  const auxiliaryOrdinaryFilePaths = Object.freeze(
    [...(options?.auxiliaryOrdinaryFilePaths ?? [])]
      .map((filePath) => path.resolve(filePath))
      .sort()
  );
  if (new Set(auxiliaryOrdinaryFilePaths).size !== auxiliaryOrdinaryFilePaths.length) {
    throw new Error('Dev command auxiliary ordinary-file paths must be unique.');
  }

  const execute = async (): Promise<number | DevCommandObservation> => {
    const capability = issueDevCommandPhysicalCapability({
      auxiliaryOrdinaryFilePaths,
      workingDirectory
    });
    const operation = compileDevCommandOperation({
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
    let session: ProcessResourceSession;
    try {
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
        signal: options?.signal
      });
    } catch (error) {
      settlePhysicalResources({
        primary: { label: 'dev-command-process-session-admission', error },
        cleanup: [
          ...[...capability.auxiliaryOrdinaryFiles].reverse().map((file, index) => ({
            label: `dev-command-auxiliary-file-dispose[${index}]`,
            settle: () => file.dispose()
          })),
          {
            label: 'dev-command-working-directory-dispose',
            settle: () => capability.workingDirectory.dispose()
          },
          {
            label: 'dev-command-executable-dispose',
            settle: () => capability.executable.dispose()
          }
        ]
      });
      throw new Error('Unreachable Dev command session admission state.');
    }
    const startedAt = performance.now();
    let result: Awaited<ReturnType<ProcessResourceSession['run']>> | undefined;
    let executionError: unknown | null = null;
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
            forwardingFailure ??= `${stream} forwarding failed: ${errorMessage(error)}`;
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
      executionError = error;
    }
    settleDevCommandExecution({
      capability,
      completed: result !== undefined,
      executionError,
      expectedInputBytes: inputBytes,
      operation,
      session
    });

    if (result === undefined) {
      if (!observed) {
        if (executionError instanceof RetainedCommandTransportError
            && executionError.outcome.status !== 'spawn-failed') {
          return 1;
        }
        throw executionError;
      }
      const terminal = executionError instanceof RetainedCommandTransportError
        ? physicalOutcomeTerminal(executionError.outcome)
        : { kind: 'spawn-failed' as const, error: errorMessage(executionError) };
      const integrityError = forwardingFailure ?? errorMessage(executionError);
      const observation = Object.freeze({
        schema: 'sec-dev-command-observation-v1' as const,
        effectiveArgv,
        terminal: Object.freeze(terminal),
        observationIntegrity: Object.freeze({
          kind: 'failed' as const,
          error: integrityError
        }),
        durationMs: executionError instanceof RetainedCommandTransportError
          ? Math.max(0, executionError.outcome.durationMs)
          : Math.max(0, performance.now() - startedAt),
        stdoutTail: boundedUtf8TextTail(stdoutTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES),
        stderrTail: boundedUtf8TextTail(stderrTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)
      });
      return observation;
    }

    if (!observed) {
      if (forwardingFailure !== null) throw new Error(forwardingFailure);
      return result.result.code;
    }
    return Object.freeze({
      schema: 'sec-dev-command-observation-v1' as const,
      effectiveArgv,
      terminal: Object.freeze({ kind: 'exited' as const, exitCode: result.result.code }),
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
