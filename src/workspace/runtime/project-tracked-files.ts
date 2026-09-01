import path from 'node:path';

import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import {
  sha256,
  uniqueSorted
} from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import { posixPath } from './paths.ts';

const TRACKED_PROJECT_PATH_DURATION_MS = 30_000;
const TRACKED_PROJECT_PATH_PROCESS_MAXIMUM = 1;
const TRACKED_PROJECT_PATH_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
const TRACKED_PROJECT_PATH_STDERR_MAX_BYTES = 1024 * 1024;
const TRACKED_PROJECT_PATH_COMMAND_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
const TRACKED_PROJECT_PATH_COMMAND_STDERR_MAX_BYTES = 512 * 1024;
const TRACKED_PROJECT_PATH_RECORD_MAXIMUM = 250_000;

function compileTrackedProjectPathOperation(workspaceRoot: string): SecBoundSemanticOperation {
  const contractDigest = sha256({
    operation: 'workspace.list-tracked-project-paths',
    provider: 'external-capabilities.git-read',
    records: 'nul-terminated-canonical-workspace-paths'
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'workspace.list-tracked-project-paths',
    intentDigest: sha256({
      workspaceRoot,
      command: ['ls-files', '-z', '--']
    }) as SecOperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + TRACKED_PROJECT_PATH_DURATION_MS,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: TRACKED_PROJECT_PATH_DURATION_MS },
      {
        resource: 'output-bytes',
        maximum: TRACKED_PROJECT_PATH_COMMAND_OUTPUT_MAX_BYTES
          + TRACKED_PROJECT_PATH_COMMAND_STDERR_MAX_BYTES
      },
      { resource: 'processes', maximum: TRACKED_PROJECT_PATH_PROCESS_MAXIMUM },
      { resource: 'records', maximum: TRACKED_PROJECT_PATH_RECORD_MAXIMUM }
    ],
    requirements: [{
      id: 'workspace.tracked-project-paths',
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
    requirementId: 'workspace.tracked-project-paths',
    contractDigest,
    providerIdentityDigest: contractDigest
  })]);
}

function exactNulPaths(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0) return [];
  if (buffer[buffer.byteLength - 1] !== 0) {
    throw new Error('git ls-files returned a non-terminated tracked-path inventory');
  }
  const payload = buffer.subarray(0, -1);
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) {
    throw new Error('git ls-files returned a non-UTF-8 tracked path');
  }
  return text.split('\0');
}

/**
 * Returns null only when Git itself explicitly reports that the workspace is
 * not a repository. Process launch failures, permission/ownership failures,
 * index corruption, malformed path bytes and other observation errors are not
 * equivalent to "untracked" and must propagate to the integrity caller.
 */
export async function listTrackedProjectPaths(workspaceRoot: string): Promise<Set<string> | null> {
  const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
  const operation = compileTrackedProjectPathOperation(absoluteWorkspaceRoot);
  return withAuthorityGitReadSession({
      cwd: absoluteWorkspaceRoot,
      environment: { LANG: 'C', LC_ALL: 'C' },
      operation,
      deadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs,
      budget: {
        deadlineMs: TRACKED_PROJECT_PATH_DURATION_MS,
        maxProcesses: TRACKED_PROJECT_PATH_PROCESS_MAXIMUM,
        maxStdoutBytes: TRACKED_PROJECT_PATH_OUTPUT_MAX_BYTES,
        maxStderrBytes: TRACKED_PROJECT_PATH_STDERR_MAX_BYTES,
        maxRecords: TRACKED_PROJECT_PATH_RECORD_MAXIMUM,
        maxCommandStdoutBytes: TRACKED_PROJECT_PATH_COMMAND_OUTPUT_MAX_BYTES,
        maxCommandStderrBytes: TRACKED_PROJECT_PATH_COMMAND_STDERR_MAX_BYTES
      }
    }, async (session) => {
      const command = await session.run(['ls-files', '-z', '--']);
      if (command.kind !== 'completed') {
        throw new GitReadAuthorityError('Unable to observe tracked project paths.', command);
      }
      if (command.result.code !== 0) {
        if (/not a git repository/u.test(command.result.stderr)) return null;
        throw new Error(
          `Unable to observe tracked project paths (git exit ${command.result.code}): ` +
          `${command.result.stderr.trim() || 'no stderr'}`
        );
      }
      const paths = exactNulPaths(command.result.stdout);
      const recordFailure = session.consumeRecords(paths.length);
      if (recordFailure !== null) {
        throw new GitReadAuthorityError('Tracked project path inventory exceeded its authority budget.', recordFailure);
      }
      return new Set(uniqueSorted(paths.map(posixPath)));
    });
}
