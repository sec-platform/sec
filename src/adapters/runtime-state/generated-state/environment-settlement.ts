import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import type {
  GitReadProviderResolutionFailure,
  GitReadSessionFailure
} from '../../providers/git-read/runtime/session.ts';
import { generatedStateDigest } from './contract.ts';
import { inspectGeneratedState, settleGeneratedState } from './lifecycle.ts';

const ENVIRONMENT_SETTLEMENT_SCHEMA = 'sec-environment-settlement-v1' as const;
const WORKSPACE_ENVIRONMENT_SETTLEMENT_OPERATION = 'runtime-state.workspace-environment-settlement' as const;

const WORKSPACE_GIT_STATUS_REQUIREMENT = 'runtime-state.workspace-git-status';
const WORKSPACE_GIT_STATUS_DURATION_MS = 5_000;
const WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES = 16 * 1024 * 1024;
const WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES = 512 * 1024;
const WORKSPACE_GIT_STATUS_RECORD_MAXIMUM = 250_000;

type WorkspaceGitStatusFailureReason =
  | GitReadProviderResolutionFailure['reason']
  | GitReadSessionFailure['reason']
  | 'command-failed'
  | 'malformed-output';

export type WorkspaceGitStatusObservation =
  | Readonly<{
      status: 'resolved';
      records: readonly string[];
      recordsDigest: string;
    }>
  | Readonly<{
      status: 'unresolved';
      reason: WorkspaceGitStatusFailureReason;
      detailDigest: string;
    }>;

function compileWorkspaceGitStatusOperation(input: Readonly<{
  workspaceRoot: string;
  fixRequested: boolean;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  const contractDigest = sha256({
    operation: WORKSPACE_ENVIRONMENT_SETTLEMENT_OPERATION,
    requirement: WORKSPACE_GIT_STATUS_REQUIREMENT,
    provider: 'external-capabilities.git-read',
    observation: 'nul-terminated-worktree-status'
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: WORKSPACE_ENVIRONMENT_SETTLEMENT_OPERATION,
    intentDigest: sha256({
      workspaceRoot: input.workspaceRoot,
      fixRequested: input.fixRequested,
      command: ['status', '--porcelain=v1', '-z', '--untracked-files=all']
    }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: WORKSPACE_GIT_STATUS_DURATION_MS },
      { resource: 'input-bytes', maximum: 0 },
      {
        resource: 'output-bytes',
        maximum: WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES + WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES
      },
      { resource: 'processes', maximum: 1 },
      { resource: 'records', maximum: WORKSPACE_GIT_STATUS_RECORD_MAXIMUM }
    ],
    requirements: [{
      id: WORKSPACE_GIT_STATUS_REQUIREMENT,
      contractDigest,
      effectKinds: ['process'],
      failureKinds: [
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.drift',
        'provider.execution-failed',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: WORKSPACE_GIT_STATUS_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: sha256({
      provider: 'external-capabilities.git-read',
      capability: 'exact-worktree-status'
    }) as OperationDigest
  })]);
}

function parseGitStatusRecords(bytes: Uint8Array): readonly string[] {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0) return Object.freeze([]);
  if (buffer[buffer.byteLength - 1] !== 0) {
    throw new Error('Git status returned a non-terminated record inventory.');
  }
  const payload = buffer.subarray(0, -1);
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) {
    throw new Error('Git status returned non-UTF-8 path bytes.');
  }
  return Object.freeze(text.split('\0').sort());
}

async function observeWorkspaceGitStatus(input: Readonly<{
  workspaceRoot: string;
  fixRequested: boolean;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<WorkspaceGitStatusObservation> {
  const operation = compileWorkspaceGitStatusOperation(input);
  try {
    return await withAuthorityGitReadSession({
      cwd: input.workspaceRoot,
      environment: { LANG: 'C', LC_ALL: 'C' },
      operation,
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      budget: {
        deadlineMs: WORKSPACE_GIT_STATUS_DURATION_MS,
        maxProcesses: 1,
        maxStdoutBytes: WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES,
        maxStderrBytes: WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES,
        maxRecords: WORKSPACE_GIT_STATUS_RECORD_MAXIMUM,
        maxCommandStdoutBytes: WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES,
        maxCommandStderrBytes: WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES
      },
      ...(input.signal === undefined ? {} : { signal: input.signal })
    }, async (session) => {
      const command = await session.run([
        'status', '--porcelain=v1', '-z', '--untracked-files=all'
      ]);
      if (command.kind !== 'completed') {
        throw new GitReadAuthorityError('Workspace Git status did not complete.', command);
      }
      if (command.result.code !== 0) {
        return Object.freeze({
          status: 'unresolved' as const,
          reason: 'command-failed' as const,
          detailDigest: sha256({
            code: command.result.code,
            stderr: command.result.stderr
          })
        });
      }
      let records: readonly string[];
      try {
        records = parseGitStatusRecords(command.result.stdout);
      } catch (error) {
        return Object.freeze({
          status: 'unresolved' as const,
          reason: 'malformed-output' as const,
          detailDigest: sha256(error instanceof Error ? error.message : String(error))
        });
      }
      const recordFailure = session.consumeRecords(records.length);
      if (recordFailure !== null) {
        throw new GitReadAuthorityError('Workspace Git status exceeded its record budget.', recordFailure);
      }
      return Object.freeze({
        status: 'resolved' as const,
        records,
        recordsDigest: generatedStateDigest(records)
      });
    });
  } catch (error) {
    if (!(error instanceof GitReadAuthorityError)) throw error;
    return Object.freeze({
      status: 'unresolved',
      reason: error.failure.reason,
      detailDigest: sha256({
        kind: error.failure.kind,
        reason: error.failure.reason,
        ...('detailDigest' in error.failure ? { providerDetailDigest: error.failure.detailDigest } : {})
      })
    });
  }
}

export async function settleWorkspaceEnvironment(input: Readonly<{
  repositoryRoot?: string;
  workspaceRoot?: string;
  fix?: boolean;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}> = {}) {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? process.cwd());
  const workspaceRoot = path.resolve(input.workspaceRoot ?? repositoryRoot);
  const localDeadlineAtUnixMs = Date.now() + WORKSPACE_GIT_STATUS_DURATION_MS;
  const deadlineAtUnixMs = Math.min(input.deadlineAtUnixMs ?? localDeadlineAtUnixMs, localDeadlineAtUnixMs);
  const workingState = await observeWorkspaceGitStatus({
    workspaceRoot,
    fixRequested: input.fix === true,
    deadlineAtUnixMs,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  const cleanup = input.fix === true && workingState.status === 'resolved'
    ? await settleGeneratedState({ repositoryRoot, workspaceRoot, profile: 'safe' })
    : null;
  const generatedState = await inspectGeneratedState({ repositoryRoot, workspaceRoot });
  const blockers = [
    ...(workingState.status === 'unresolved'
      ? ['git-working-state-unresolved']
      : workingState.records.map((entry) => `git:${entry}`)),
    ...generatedState.blockers
  ].sort();
  const material = Object.freeze({
    schema: ENVIRONMENT_SETTLEMENT_SCHEMA,
    repositoryRoot,
    workspaceRoot,
    workingState,
    workingStateDigest: workingState.status === 'resolved' ? workingState.recordsDigest : null,
    generatedStateInventoryDigest: generatedState.inventoryDigest,
    cleanupDigest: cleanup?.settlementDigest ?? null,
    status: blockers.length === 0 ? 'settled' as const : 'blocked' as const,
    blockers: Object.freeze(blockers)
  });
  return Object.freeze({
    ...material,
    settlementDigest: generatedStateDigest(material)
  });
}
