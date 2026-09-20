import { GitReadAuthorityError, withAuthorityGitReadSession } from '../providers/git-read/authority.ts';
import { type ByteCommandResult } from '../runtime-state/physical/runtime/process.ts';
import {
  sha256,
  uniqueSorted
} from '../../contracts/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../execution/operation/semantic.ts';
export type ReferenceDriftScan = {
  exitCode: number;
  trackedExitCode: number;
  untrackedExitCode: number;
  changedPaths: string[];
};

const REFERENCE_GIT_DURATION_MS = 30_000;
const REFERENCE_GIT_PROCESS_MAXIMUM = 2;
const REFERENCE_GIT_STDOUT_MAX_BYTES = 64 * 1024 * 1024;
const REFERENCE_GIT_STDERR_MAX_BYTES = 1024 * 1024;
const REFERENCE_GIT_COMMAND_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
const REFERENCE_GIT_COMMAND_STDERR_MAX_BYTES = 512 * 1024;
const REFERENCE_GIT_RECORD_MAXIMUM = 250_000;
export type ReferenceDriftCommands = Readonly<{
  tracked: readonly string[];
  untracked: readonly string[];
}>;

export function buildReferenceDriftCommands(
  referencePaths: readonly string[]
): ReferenceDriftCommands {
  if (referencePaths.length === 0 ||
      referencePaths.some(value => typeof value !== 'string' || value.length === 0 || value.includes('\0'))) {
    throw new TypeError('Reference drift scan requires non-empty NUL-free relative paths');
  }
  const paths = uniqueSorted(referencePaths);
  return Object.freeze({
    tracked: Object.freeze(['diff', '--name-only', '--exit-code', '-z', '--', ...paths]),
    untracked: Object.freeze(['ls-files', '-z', '--others', '--exclude-standard', '--', ...paths])
  });
}

function compileReferenceDriftOperation(
  root: string,
  commands: ReferenceDriftCommands
): SecBoundSemanticOperation {
  const contractDigest = sha256({
    operation: 'reference.scan-drift',
    provider: 'external-capabilities.git-read',
    records: 'tracked-and-untracked-reference-workspace-paths'
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'reference.scan-drift',
    intentDigest: sha256({
      root,
      trackedCommand: commands.tracked,
      untrackedCommand: commands.untracked
    }) as SecOperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + REFERENCE_GIT_DURATION_MS,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: REFERENCE_GIT_DURATION_MS },
      { resource: 'input-bytes', maximum: 0 },
      {
        resource: 'output-bytes',
        maximum: REFERENCE_GIT_PROCESS_MAXIMUM * (
          REFERENCE_GIT_COMMAND_OUTPUT_MAX_BYTES + REFERENCE_GIT_COMMAND_STDERR_MAX_BYTES
        )
      },
      { resource: 'processes', maximum: REFERENCE_GIT_PROCESS_MAXIMUM },
      { resource: 'records', maximum: REFERENCE_GIT_RECORD_MAXIMUM }
    ],
    requirements: [{
      id: 'reference.drift-observation',
      contractDigest,
      effectKinds: ['process'],
      failureKinds: [
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.drift',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: 'reference.drift-observation',
    contractDigest,
    providerIdentityDigest: contractDigest
  })]);
}

export function parseReferenceGitPathRecords(stdout: Uint8Array, label: string): string[] {
  const bytes = Buffer.from(stdout);
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) {
    throw new Error(`${label} did not return NUL-terminated path records`);
  }
  const payload = bytes.subarray(0, -1);
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) {
    throw new Error(`${label} returned a non-UTF-8 path record`);
  }
  return uniqueSorted(text.split('\0'));
}

function aggregateExitCode(
  tracked: ByteCommandResult,
  untracked: ByteCommandResult,
  untrackedPaths: string[]
): number {
  if (tracked.code !== 0 && tracked.code !== 1) return tracked.code;
  if (untracked.code !== 0) return untracked.code;
  return tracked.code === 1 || untrackedPaths.length > 0 ? 1 : 0;
}

export async function scanReferenceDrift(
  root: string,
  commands: ReferenceDriftCommands
): Promise<ReferenceDriftScan> {
  const operation = compileReferenceDriftOperation(root, commands);
  return withAuthorityGitReadSession({
      cwd: root,
      environment: { LANG: 'C', LC_ALL: 'C' },
      operation,
      deadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs,
      budget: {
        deadlineMs: REFERENCE_GIT_DURATION_MS,
        maxProcesses: REFERENCE_GIT_PROCESS_MAXIMUM,
        maxStdoutBytes: REFERENCE_GIT_STDOUT_MAX_BYTES,
        maxStderrBytes: REFERENCE_GIT_STDERR_MAX_BYTES,
        maxRecords: REFERENCE_GIT_RECORD_MAXIMUM,
        maxCommandStdoutBytes: REFERENCE_GIT_COMMAND_OUTPUT_MAX_BYTES,
        maxCommandStderrBytes: REFERENCE_GIT_COMMAND_STDERR_MAX_BYTES
      }
    }, async (session) => {
      const run = async (args: readonly string[]): Promise<ByteCommandResult> => {
        const command = await session.run(args);
        if (command.kind !== 'completed') {
          throw new GitReadAuthorityError('Reference Git observation failed.', command);
        }
        return command.result;
      };
      const tracked = await run(commands.tracked);
      if (tracked.code !== 0 && tracked.code !== 1) {
        return {
          exitCode: tracked.code,
          trackedExitCode: tracked.code,
          untrackedExitCode: -1,
          changedPaths: []
        };
      }
      const trackedPaths = parseReferenceGitPathRecords(tracked.stdout, 'git diff');
      const untracked = await run(commands.untracked);
      const untrackedPaths = untracked.code === 0
        ? parseReferenceGitPathRecords(untracked.stdout, 'git ls-files')
        : [];
      const recordFailure = session.consumeRecords(trackedPaths.length + untrackedPaths.length);
      if (recordFailure !== null) {
        throw new GitReadAuthorityError('Reference Git record budget failed.', recordFailure);
      }
      return {
        exitCode: aggregateExitCode(tracked, untracked, untrackedPaths),
        trackedExitCode: tracked.code,
        untrackedExitCode: untracked.code,
        changedPaths: uniqueSorted([...trackedPaths, ...untrackedPaths])
      };
    });
}
