import path from 'node:path';

import { sha256 } from '../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../execution/operation/semantic.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../providers/git-read/authority.ts';
import { decodeTrackedProjectPathInventory, isTrackedProjectRepositoryAbsent } from './tracked-path-inventory.ts';

const TRACKED_PROJECT_PATH_DURATION_MS = 30_000;
const TRACKED_PROJECT_PATH_PROCESS_MAXIMUM = 1;
const TRACKED_PROJECT_PATH_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
const TRACKED_PROJECT_PATH_STDERR_MAX_BYTES = 1024 * 1024;
const TRACKED_PROJECT_PATH_COMMAND_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
const TRACKED_PROJECT_PATH_COMMAND_STDERR_MAX_BYTES = 512 * 1024;
const TRACKED_PROJECT_PATH_RECORD_MAXIMUM = 250_000;

function compileTrackedProjectPathOperation(workspaceRoot: string): BoundSemanticOperation {
  const contractDigest = sha256({
    operation: 'workspace.list-tracked-project-paths',
    provider: 'external-capabilities.git-read',
    records: 'nul-terminated-canonical-workspace-paths'
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: 'workspace.list-tracked-project-paths',
    intentDigest: sha256({
      workspaceRoot,
      command: ['ls-files', '-z', '--']
    }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + TRACKED_PROJECT_PATH_DURATION_MS,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: TRACKED_PROJECT_PATH_DURATION_MS },
      { resource: 'input-bytes', maximum: 0 },
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
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'workspace.tracked-project-paths',
    contractDigest,
    providerIdentityDigest: contractDigest
  })]);
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
        if (isTrackedProjectRepositoryAbsent(command.result.code, command.result.stderr)) return null;
        throw new Error(
          `Unable to observe tracked project paths (git exit ${command.result.code}): ` +
          `${command.result.stderr.trim() || 'no stderr'}`
        );
      }
      const paths = decodeTrackedProjectPathInventory(command.result.stdout, count => {
        const recordFailure = session.consumeRecords(count);
        if (recordFailure !== null) {
          throw new GitReadAuthorityError('Tracked project path inventory exceeded its authority budget.', recordFailure);
        }
      });
      return new Set(paths);
    });
}
