import path from 'node:path';
import { sha256 } from '../../contracts/canonical.ts';
import { generatedStateDigest, type GeneratedStateInventory, type GeneratedStateSettlement } from '../../execution/generated-state/contract.ts';
import { ENVIRONMENT_SETTLEMENT_SCHEMA, WORKSPACE_ENVIRONMENT_SETTLEMENT_OPERATION, WORKSPACE_GIT_STATUS_DURATION_MS, WORKSPACE_GIT_STATUS_RECORD_MAXIMUM, WORKSPACE_GIT_STATUS_REQUIREMENT, WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES, WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES, type WorkspaceGitStatusBackend } from '../../execution/generated-state/environment-port.ts';
import { bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan, issueSemanticOperationAttemptContext, type BoundSemanticOperation, type OperationDigest } from '../../execution/operation/semantic.ts';
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
export async function settleWorkspaceEnvironment(input: Readonly<{
  repositoryRoot?: string;
  workspaceRoot?: string;
  fix?: boolean;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}> , dependencies: Readonly<{ git: WorkspaceGitStatusBackend; inspect: (input: { repositoryRoot: string; workspaceRoot: string }) => Promise<GeneratedStateInventory>; settle: (input: { repositoryRoot: string; workspaceRoot: string; profile: 'safe' }) => Promise<GeneratedStateSettlement> }>) {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? process.cwd());
  const workspaceRoot = path.resolve(input.workspaceRoot ?? repositoryRoot);
  const localDeadlineAtUnixMs = Date.now() + WORKSPACE_GIT_STATUS_DURATION_MS;
  const deadlineAtUnixMs = Math.min(input.deadlineAtUnixMs ?? localDeadlineAtUnixMs, localDeadlineAtUnixMs);
  const workingState = await dependencies.git.observe({
    workspaceRoot,
    operation: compileWorkspaceGitStatusOperation({ workspaceRoot, fixRequested: input.fix === true, deadlineAtUnixMs }),
    deadlineAtUnixMs,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  const cleanup = input.fix === true && workingState.status === 'resolved'
    ? await dependencies.settle({ repositoryRoot, workspaceRoot, profile: 'safe' })
    : null;
  const generatedState = await dependencies.inspect({ repositoryRoot, workspaceRoot });
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
