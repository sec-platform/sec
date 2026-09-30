/** VerificationSession physical owner recovered from current-main semantics. */
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../../filesystem/write-lease.ts';
import { authorizeBranchCloseout } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-authorization.ts';
import { BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME, createBranchCloseoutOperationBinding, parseBranchCloseoutRecoveryArtifact } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { parsePreparedBranchCloseoutEnvelope, type PreparedBranchCloseoutEnvelope } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { collectBranchLifecycleInventory } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY, type BranchLifecycleInventory } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import { verifyRecoveryAuthorityLive } from '../../../../self-hosting/control/branch-lifecycle/branch-recovery.ts';
import { assertTrustedCompletedWorktreePhysicalCloseout, executeWorktreePhysicalCloseout, prepareTrustedWorktreePhysicalCloseout, type WorktreePhysicalCloseoutConsumptionToken } from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { loadProviderBranchCloseoutRecoveryArtifact } from './session-hosted-artifacts.ts';
import { requireCommand } from './session-local-repository.ts';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export async function evaluateHostedCloseoutEffectPreconditionsUnderLease(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  lease: WorkspaceWriteLeaseToken;
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
}>): Promise<Readonly<{
  current: BranchLifecycleInventory;
  authorization: ReturnType<typeof authorizeBranchCloseout>;
}>> {
  const preparation = input.prepared.preparation;
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  const observedCurrent = collectBranchLifecycleInventory(input.ctx);
  const recoveryReadback = verifyRecoveryAuthorityLive({
    inventory: observedCurrent,
    recovery: preparation.recovery
  });
  const current: BranchLifecycleInventory = {
    ...observedCurrent,
    unknowns: [...new Set([
      ...observedCurrent.unknowns,
      ...(recoveryReadback.status === 'success' ? [] : [recoveryReadback.detail])
    ])].sort((left, right) => left.localeCompare(right))
  };
  const expectedHeadTreeSha = requireCommand(
    input.ctx,
    'git',
    ['rev-parse', `${preparation.expectedHeadSha}^{tree}`],
    'branch closeout immediate effect prepared head tree'
  );
  const authorization = authorizeBranchCloseout({
    preparation,
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${input.binding.newMainSha}` }
    },
    before: input.prepared.before,
    current,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    expectedHeadTreeSha,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  return Object.freeze({ current, authorization });
}

/**
 * Pure routing only: neither a caller-supplied value nor this function is a
 * cleanup authority.  The sole production callback is the private opaque
 * token bridge below.  Keeping the foreign decision here makes it testable
 * without manufacturing a physical token or widening an effect API.
 */

export async function routePreparedWorktreeCleanupAttempt<T>(input: Readonly<{
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
  targetCount: number;
  consumeLocalPreparedTargets: () => Promise<readonly T[]>;
}>): Promise<readonly T[]> {
  if (input.foreignWorktreeObservationDigests.length !== 0 || input.targetCount === 0) {
    return Object.freeze([]);
  }
  const consumed = await input.consumeLocalPreparedTargets();
  if (consumed.length !== input.targetCount || consumed.length === 0) {
    throw new Error('same-host-worktree-closeout-required: exact physical completion token set is unavailable.');
  }
  return Object.freeze([...consumed]);
}

/**
 * Reads the pre-merge, same-job artifact only after its full canonical bytes
 * match the provider-authenticated artifact selected for the authorization.
 * The local file is a host observation, never a replacement authority.
 */

export function loadOriginalHostPreparedCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  outputPath: string;
  providerRecovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
}>): PreparedBranchCloseoutEnvelope {
  const artifactPath = path.join(path.dirname(path.resolve(input.outputPath)),
    BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME);
  if (!existsSync(artifactPath)) {
    throw new Error('external-maintainer-disposition-required: original-host recovery artifact is unavailable.');
  }
  const source = readFileSync(artifactPath, 'utf8');
  const localArtifact = parseBranchCloseoutRecoveryArtifact(source);
  if (`${encodeVerificationActionData(localArtifact)}\n` !== source
    || encodeVerificationActionData(localArtifact) !== encodeVerificationActionData(input.providerRecovery.artifact)) {
    throw new Error('external-maintainer-disposition-required: local/provider recovery artifact mismatch.');
  }
  const prepared = parsePreparedBranchCloseoutEnvelope(
    Buffer.from(localArtifact.preparedEnvelopeBase64, 'base64').toString('utf8')
  );
  if (encodeVerificationActionData(prepared) !== encodeVerificationActionData(input.providerRecovery.remotePrepared)
    || prepared.foreignWorktreeObservations.length !== 0) {
    throw new Error('external-maintainer-disposition-required: original local preparation is not exact.');
  }
  const live = collectBranchLifecycleInventory(input.ctx);
  if (live.repository.root !== prepared.preparation.repository.root
    || live.repository.commonDir !== prepared.preparation.repository.commonDir) {
    throw new Error('external-maintainer-disposition-required: original host repository binding drifted.');
  }
  const expectedTargets = [...new Set(prepared.preparation.worktreePathsAtPreparation)].sort();
  const liveTargets = live.worktrees.filter(({ branch }) => branch === prepared.preparation.branch)
    .map(({ path: targetPath }) => targetPath).sort();
  if (expectedTargets.length !== liveTargets.length
    || expectedTargets.some((targetPath, index) => targetPath !== liveTargets[index])) {
    throw new Error('external-maintainer-disposition-required: original host worktree inventory drifted.');
  }
  return prepared;
}

/**
 * This is the sole production bridge from Issue 186 to Issue 313.  It is
 * deliberately private and only callable in the original host process: each
 * opaque token remains live from physical completion through branch CAS.
 * A fresh hosted recovery may not substitute an artifact, receipt locator, or
 * empty post-cleanup preparation for this sequence.
 */

export async function consumeSameHostWorktreeCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
}>): Promise<readonly WorktreePhysicalCloseoutConsumptionToken[]> {
  const preparation = input.prepared.preparation;
  const targets = [...new Set(preparation.worktreePathsAtPreparation)]
    .sort((left, right) => left.localeCompare(right));
  if (targets.length === 0) {
    throw new Error('same-host-worktree-closeout-required: no immutable locally registered target is available.');
  }
  const expectedTreeSha = requireCommand(
    input.ctx,
    'git',
    ['rev-parse', `${preparation.expectedHeadSha}^{tree}`],
    'same-host worktree closeout prepared head tree'
  );
  const tokens: WorktreePhysicalCloseoutConsumptionToken[] = [];
  for (const targetPath of targets) {
    const trusted = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: preparation.repository.root,
      targetPath,
      expectedBranch: preparation.branch,
      expectedHeadSha: preparation.expectedHeadSha,
      expectedTreeSha,
      expectedRecoveryAuthorityDigest: preparation.recovery.sha256
    });
    await executeWorktreePhysicalCloseout({
      repositoryRoot: preparation.repository.root,
      targetPath,
      expectedBranch: preparation.branch,
      expectedHeadSha: preparation.expectedHeadSha,
      expectedTreeSha,
      expectedRecoveryAuthorityDigest: preparation.recovery.sha256,
      authorizationPath: trusted.authorization.authorizationPath
    });
    assertTrustedCompletedWorktreePhysicalCloseout({
      token: trusted.token,
      repositoryRoot: preparation.repository.root,
      targetPath,
      branch: preparation.branch,
      headSha: preparation.expectedHeadSha,
      treeSha: expectedTreeSha,
      recoveryAuthorityDigest: preparation.recovery.sha256
    });
    tokens.push(trusted.token);
  }
  if (tokens.length !== targets.length || tokens.length === 0) {
    throw new Error('same-host-worktree-closeout-required: exact physical completion token set is unavailable.');
  }
  return Object.freeze(tokens);
}
