import path from 'node:path';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext
} from '../../../../execution/operation/semantic.ts';
import type { GitHubApiCapability } from '../../../providers/github-api/operation-session.ts';
import { inspectExactNoFollowDirectoryPresence } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  acknowledgeClosedAbsentDevelopmentCommitJournalRetirement,
  JOURNAL_RETIREMENT_CONTRACT_DIGEST,
  JOURNAL_RETIREMENT_PROVIDER_DIGEST,
  JOURNAL_RETIREMENT_REQUIREMENT_ID,
  JOURNAL_RETIREMENT_RESOURCE_CEILINGS,
  prepareClosedAbsentDevelopmentCommitJournalRetirement
} from '../../development/commit/operation.ts';
import {
  assertPreparedBranchCloseoutEnvelope,
  parsePreparedBranchCloseoutEnvelope,
  type PreparedBranchCloseoutEnvelope
} from './branch-closeout.ts';
import {
  acquireBranchRecoveryStore,
  verifyRecoveryAuthorityLive,
  type BranchRecoveryStore
} from './branch-recovery.ts';
import {
  assertClosedUnmergedCloseoutCompletedSettlement,
  type ClosedUnmergedCloseoutExecutionResult,
  type ClosedUnmergedCloseoutOperation
} from './closed-unmerged-closeout.ts';

export type ClosedUnmergedRecoveryRetirementResult = Readonly<{
  status: 'completed' | 'already-retired' | 'partial';
  retired: readonly string[];
  retained: readonly string[];
  recoveryRootRetired: boolean;
  failure: string | null;
}>;

function expectedPreparationBytes(prepared: PreparedBranchCloseoutEnvelope): Buffer {
  return Buffer.from(`${JSON.stringify(prepared, null, 2)}\n`, 'utf8');
}

function remainingFamily(store: BranchRecoveryStore, names: readonly string[]): readonly string[] {
  return Object.freeze(names.filter((name) => store.inspectFile(name) !== null)
    .map((name) => path.join(store.root.path, name)));
}

function compileCommitJournalRetirementOperation(
  operation: ClosedUnmergedCloseoutOperation,
  completed: Extract<ClosedUnmergedCloseoutExecutionResult, { status: 'completed' }>
) {
  const deadlineAtUnixMs = Date.now()
    + JOURNAL_RETIREMENT_RESOURCE_CEILINGS
      .find(({ resource }) => resource === 'duration-ms')!.maximum;
  const plan = compileSemanticOperationPlan({
    operation: 'control.branch-lifecycle.closed-unmerged-commit-journal-retirement',
    intentDigest: operation.operationId,
    decisionDigest: JOURNAL_RETIREMENT_CONTRACT_DIGEST,
    deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: completed.receipt.publicationDigest
    }),
    aggregateBudgets: JOURNAL_RETIREMENT_RESOURCE_CEILINGS,
    requirements: [Object.freeze({
      id: JOURNAL_RETIREMENT_REQUIREMENT_ID,
      contractDigest: JOURNAL_RETIREMENT_CONTRACT_DIGEST,
      effectKinds: Object.freeze(['filesystem', 'process', 'provider'] as const),
      failureKinds: Object.freeze([
        'development.commit.readback-invalid',
        'development.commit.readback-unknown'
      ])
    })]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: JOURNAL_RETIREMENT_REQUIREMENT_ID,
    contractDigest: JOURNAL_RETIREMENT_CONTRACT_DIGEST,
    providerIdentityDigest:
      JOURNAL_RETIREMENT_PROVIDER_DIGEST
  })]);
}

async function retireCommitJournalConsumers(input: Readonly<{
  operation: ClosedUnmergedCloseoutOperation;
  completed: Extract<ClosedUnmergedCloseoutExecutionResult, { status: 'completed' }>;
  capability: GitHubApiCapability;
}>): Promise<void> {
  const semanticOperation = compileCommitJournalRetirementOperation(
    input.operation,
    input.completed
  );
  const plan = await prepareClosedAbsentDevelopmentCommitJournalRetirement({
    repositoryRoot: input.operation.prepared.preparation.repository.root,
    remote: input.operation.prepared.preparation.repository.remote,
    ref: `refs/heads/${input.operation.evidence.branch}`,
    capability: input.capability,
    pullRequestNumber: input.operation.evidence.pullRequestNumber,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation: semanticOperation,
      requirementId: JOURNAL_RETIREMENT_REQUIREMENT_ID,
      resourceCeilings:
        JOURNAL_RETIREMENT_RESOURCE_CEILINGS
    })
  });
  const settlement = await acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(plan);
  if (settlement.ref !== `refs/heads/${input.operation.evidence.branch}`
      || settlement.retired !== settlement.observed) {
    throw new Error('Closed-unmerged commit journal retirement settlement differs.');
  }
}

/** Retire one exact completed operation's recovery family, after journal consumers. */
export async function retireClosedUnmergedRecoveryFamily(input: Readonly<{
  operation: ClosedUnmergedCloseoutOperation;
  completed: ClosedUnmergedCloseoutExecutionResult;
  capability: GitHubApiCapability;
  recoveryRoot?: string;
}>): Promise<ClosedUnmergedRecoveryRetirementResult> {
  assertClosedUnmergedCloseoutCompletedSettlement(input.operation, input.completed);
  assertPreparedBranchCloseoutEnvelope(input.operation.prepared);
  const preparation = input.operation.prepared.preparation;
  const recoveryPath = path.resolve(preparation.recovery.path);
  const recoveryRoot = path.dirname(recoveryPath);
  if (input.recoveryRoot !== undefined && path.resolve(input.recoveryRoot) !== recoveryRoot) {
    throw new Error('Closed-unmerged recovery retirement root differs from the prepared recovery family.');
  }
  const rootPresence = inspectExactNoFollowDirectoryPresence(
    recoveryRoot,
    'Closed-unmerged recovery retirement root'
  );
  if (rootPresence.state === 'absent') {
    await retireCommitJournalConsumers({
      operation: input.operation,
      completed: input.completed,
      capability: input.capability
    });
    return Object.freeze({
      status: 'already-retired', retired: Object.freeze([]), retained: Object.freeze([]),
      recoveryRootRetired: true, failure: null
    });
  }
  const store = acquireBranchRecoveryStore({
    repositoryRoot: preparation.repository.root,
    commonDir: preparation.repository.commonDir,
    worktreeRoots: input.operation.prepared.before.worktrees.map(({ path: worktreePath }) => worktreePath),
    recoveryRoot
  });
  const recoveryName = path.basename(recoveryPath);
  if (path.join(store.root.path, recoveryName) !== recoveryPath) {
    throw new Error('Closed-unmerged recovery proof escapes its exact owner root.');
  }
  const bundleRecovery = preparation.recovery.kind === 'bundle';
  const checksumName = `${recoveryName}.sha256`;
  const preparationName = `${recoveryName}.preparation.json`;
  const orderedNames = Object.freeze(bundleRecovery
    ? [recoveryName, checksumName, preparationName] : [recoveryName, preparationName]);
  const allowedSidecars = new Set(bundleRecovery
    ? [checksumName, preparationName] : [preparationName]);
  const unexpected = store.listOwnedFiles(`${recoveryName}.`)
    .filter((name) => !allowedSidecars.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Closed-unmerged recovery family has active or unknown consumers: ${unexpected.join(', ')}`);
  }

  const proof = store.inspectFile(recoveryName);
  const checksum = bundleRecovery ? store.inspectFile(checksumName) : null;
  const prepared = store.inspectFile(preparationName);
  // Preparation remains the durable continuation until the final deletion.
  if ((bundleRecovery && proof !== null && checksum === null)
      || (checksum !== null && prepared === null)) {
    throw new Error('Closed-unmerged recovery family is not one valid ordered retirement state.');
  }
  if (proof !== null) {
    if (proof.kind !== 'file' || proof.bytes === null || proof.linkTarget !== null
      || `sha256:${rawSha256Hex(proof.bytes)}`
        !== preparation.recovery.sha256) {
      throw new Error('Closed-unmerged recovery proof differs from its prepared digest.');
    }
  }
  if (checksum !== null) {
    if (checksum.kind !== 'file' || checksum.bytes === null || checksum.linkTarget !== null
      || !Buffer.from(checksum.bytes).equals(Buffer.from(
        `${preparation.recovery.sha256.slice('sha256:'.length)}  ${recoveryName}\n`, 'utf8'
      ))) {
      throw new Error('Closed-unmerged recovery checksum differs from its exact bundle identity.');
    }
  }
  if (prepared !== null) {
    if (prepared.kind !== 'file' || prepared.bytes === null || prepared.linkTarget !== null
      || !Buffer.from(prepared.bytes).equals(expectedPreparationBytes(input.operation.prepared))) {
      throw new Error('Closed-unmerged recovery preparation bytes differ from the exact issued envelope.');
    }
    const parsed = parsePreparedBranchCloseoutEnvelope(Buffer.from(prepared.bytes).toString('utf8'));
    if (parsed.envelopeDigest !== input.operation.prepared.envelopeDigest) {
      throw new Error('Closed-unmerged recovery preparation identity differs from the exact issued envelope.');
    }
  }
  if (bundleRecovery && proof !== null && checksum !== null) {
    const verification = await verifyRecoveryAuthorityLive({
      inventory: input.operation.prepared.before,
      recovery: preparation.recovery
    });
    if (verification.status !== 'success') {
      throw new Error(`Closed-unmerged recovery bundle live verification failed: ${verification.detail}`);
    }
  }

  await retireCommitJournalConsumers({
    operation: input.operation,
    completed: input.completed,
    capability: input.capability
  });
  const retired: string[] = [];
  let failure: string | null = null;
  const admittedEntries = new Map([
    [recoveryName, proof], [checksumName, checksum], [preparationName, prepared]
  ] as const);
  for (const name of orderedNames) {
    const observed = admittedEntries.get(name) ?? null;
    if (observed === null) continue;
    try {
      store.removeExact(name, observed);
      retired.push(path.join(store.root.path, name));
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  const retained = remainingFamily(store, orderedNames);
  const canonicalDefaultRoot = path.join(
    path.dirname(preparation.repository.root),
    `${path.basename(preparation.repository.root)}-recovery`
  );
  const mayRetireRoot = store.createdByAcquisition
    || (input.recoveryRoot === undefined
      && process.env.SEC_BRANCH_RECOVERY_ROOT === undefined
      && recoveryRoot === canonicalDefaultRoot);
  const recoveryRootRetired = failure === null && retained.length === 0
    && mayRetireRoot && store.retireIfEmpty();
  return Object.freeze({
    status: failure === null && retained.length === 0 ? 'completed' : 'partial',
    retired: Object.freeze(retired), retained, recoveryRootRetired, failure
  });
}
