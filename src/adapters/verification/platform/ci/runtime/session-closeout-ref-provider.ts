/** VerificationSession physical owner recovered from current-main semantics. */
import { sha256 } from '../../../../../contracts/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../../../../execution/operation/requirement-binding-context.ts';
import { bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan, issueSecSemanticOperationAttemptContext, type SecOperationDigest } from '../../../../../execution/operation/semantic.ts';
import type { WorkspaceWriteLeaseToken } from '../../../../filesystem/write-lease.ts';
import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/budget.ts';
import { assertGitPhysicalProviderReceipt, closeGitPhysicalProvider, openGitPhysicalProvider } from '../../../../providers/git/physical-provider.ts';
import { assertGitLocalRefDeleteBatchReceipt, deleteExactLocalGitRefs, MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_OUTPUT_BYTES, MAXIMUM_LOCAL_REF_DELETE_PROCESS_COUNT, measureExactLocalGitRefDeleteBatchAggregateInputBytes } from '../../../../providers/git/ref-effect.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../../../runtime-state/physical/runtime/process-resource-session.ts';
import type { BranchCloseoutEffect } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { parsePreparedBranchCloseoutEnvelope } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { createBranchLifecycleGitHubCredentialArgs, decodeBranchLifecycleChildError } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import type { BranchCloseoutAttempt, BranchCloseoutPreparation } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { runVerificationSessionCommand } from './session-local-repository.ts';
import { observeTrustedRemoteExactRef } from './trusted-runtime-observation.ts';

const HOSTED_LOCAL_REF_REQUIREMENT = 'verification-session.hosted-closeout.local-ref-delete';

const HOSTED_LOCAL_REF_CONTRACT = sha256({ owner: 'verification.ci', operation: 'hosted-closeout-local-ref-delete', effect: 'exact-native-git-ref-cas' }) as SecOperationDigest;

const HOSTED_LOCAL_REF_PROVIDER = sha256({ provider: 'external-capabilities.git.physical-provider', operation: HOSTED_LOCAL_REF_REQUIREMENT }) as SecOperationDigest;

export function observeExactRemoteCloseoutBranch(
  ctx: VerificationSessionScope,
  prepared: ReturnType<typeof parsePreparedBranchCloseoutEnvelope>
): Readonly<{ state: 'present' | 'absent'; sha: string | null }> {
  const { preparation } = prepared;
  const ref = `refs/heads/${preparation.branch}`;
  return observeTrustedRemoteExactRef({
    ctx,
    remote: preparation.repository.remote,
    remoteRef: ref,
    label: 'hosted closeout remote branch readback',
    cwd: preparation.repository.root
  });
}

/**
 * The post-merge MainHealth dispatch/join belongs to the invocation that will
 * consume physical closeout tokens.  A later Workflow step is a new process
 * and therefore cannot retain those capabilities.
 */

export function closeoutAttempt(
  attempts: BranchCloseoutAttempt[],
  operation: BranchCloseoutAttempt['operation'],
  status: BranchCloseoutAttempt['status'],
  detail: string
): BranchCloseoutAttempt {
  const value = { operation, status, detail };
  attempts.push(value);
  return value;
}

export function closeoutEffect(attempt: BranchCloseoutAttempt): BranchCloseoutEffect {
  return Object.freeze({
    state: attempt.status === 'success' ? 'applied' : 'failed',
    detailDigest: branchLifecycleDigest({ detail: attempt.detail })
  });
}

export function deleteHostedRemoteRefCas(
  ctx: VerificationSessionScope,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): BranchCloseoutAttempt {
  const result = runVerificationSessionCommand(ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'push',
    '--porcelain',
    `--force-with-lease=refs/heads/${preparation.branch}:${preparation.expectedRemoteSha}`,
    preparation.repository.remote,
    `:refs/heads/${preparation.branch}`
  ], preparation.repository.root);
  return closeoutAttempt(
    attempts,
    'remote-delete',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `deleted refs/heads/${preparation.branch} at expected ${preparation.expectedRemoteSha}`
      : decodeBranchLifecycleChildError(result)
  );
}

export async function deleteHostedLocalRefCas(
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[],
  coordinatedLease: WorkspaceWriteLeaseToken,
  closeoutOperationId: SecOperationDigest
): Promise<BranchCloseoutAttempt> {
  const expected = preparation.expectedLocalSha ?? preparation.expectedHeadSha;
  const localEntry = Object.freeze({ ref: `refs/heads/${preparation.branch}`, expectedOldSha: expected });
  const durationMs = 120_000;
  const plan = compileSecSemanticOperationPlan({
    operation: 'verification-session.hosted-closeout-local-ref-delete',
    intentDigest: closeoutOperationId,
    decisionDigest: HOSTED_LOCAL_REF_CONTRACT,
    deadlineAtUnixMs: Date.now() + durationMs,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: closeoutOperationId }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: measureExactLocalGitRefDeleteBatchAggregateInputBytes([localEntry]) },
      { resource: 'output-bytes', maximum: MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_OUTPUT_BYTES },
      { resource: 'processes', maximum: MAXIMUM_LOCAL_REF_DELETE_PROCESS_COUNT }
    ],
    requirements: [{ id: HOSTED_LOCAL_REF_REQUIREMENT, contractDigest: HOSTED_LOCAL_REF_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: ['filesystem.identity-drift', 'filesystem.write-failed', 'process.cancelled',
        'process.deadline-exhausted', 'process.output-budget-exhausted', 'process.settlement-unproven',
        'process.unavailable'] }]
  });
  const operation = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: HOSTED_LOCAL_REF_REQUIREMENT, contractDigest: HOSTED_LOCAL_REF_CONTRACT,
    providerIdentityDigest: HOSTED_LOCAL_REF_PROVIDER
  })]);
  const processSession = openProcessResourceSession({ operation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({ operation,
      requirementId: HOSTED_LOCAL_REF_REQUIREMENT, resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  let primaryError: unknown;
  try {
    await withAuthorityGitReadSession({ cwd: preparation.repository.root,
      budget: GIT_READ_DEFAULT_OPERATION_BUDGET }, async (session) => {
      const executablePath = session.gitExecutableIdentity?.realPath;
      if (executablePath === undefined) throw new Error('Git read owner did not retain an executable identity.');
      const resolution = openGitPhysicalProvider({ cwd: preparation.repository.root, executablePath,
        operation, processSession, environmentSource: process.env, maximumExecutableBytes: 128 * 1024 * 1024 });
      if (resolution.status !== 'ready') throw new Error(`Git physical provider unavailable: ${resolution.reason}`);
      let effectError: unknown;
      try {
        const receipt = await deleteExactLocalGitRefs({ provider: resolution.capability, coordinatedLease,
          entries: [localEntry] });
        assertGitLocalRefDeleteBatchReceipt(receipt);
      } catch (error) { effectError = error; }
      try { assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(resolution.capability), resolution.capability); }
      catch (error) { effectError ??= error; }
      if (effectError !== undefined) throw effectError;
    });
  } catch (error) { primaryError = error; }
  try {
    assertProcessResourceSessionReceipt(processSession.close(), { operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest, requirementId: HOSTED_LOCAL_REF_REQUIREMENT });
  } catch (error) { primaryError ??= error; }
  return closeoutAttempt(attempts, 'local-delete', primaryError === undefined ? 'success' : 'failed',
    primaryError === undefined
      ? `deleted refs/heads/${preparation.branch} at expected ${expected}`
      : primaryError instanceof Error ? primaryError.message : String(primaryError));
}

export function pruneHostedRemote(
  ctx: VerificationSessionScope,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): BranchCloseoutAttempt {
  const result = runVerificationSessionCommand(ctx, 'git', [
    'remote', 'prune', preparation.repository.remote
  ], preparation.repository.root);
  return closeoutAttempt(
    attempts,
    'prune',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `pruned ${preparation.repository.remote}`
      : decodeBranchLifecycleChildError(result)
  );
}

/**
 * A closeout authorization is a point-in-time deny gate, never a lease for a
 * later ref effect.  Every marker/ref/prune boundary therefore obtains this
 * under the canonical repository lease immediately before its effect.
 */
