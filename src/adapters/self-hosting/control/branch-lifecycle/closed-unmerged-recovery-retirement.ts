import { createHash } from 'node:crypto';
import path from 'node:path';

import { issueSecOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext
} from '../../../../execution/operation/semantic.ts';
import type { GitHubApiCapability } from '../../../providers/github-api/operation-session.ts';
import { inspectExactNoFollowDirectoryPresence } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  acknowledgeClosedAbsentDevelopmentCommitJournalRetirement,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PROVIDER_IDENTITY_DIGEST,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS,
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
    + CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS
      .find(({ resource }) => resource === 'duration-ms')!.maximum;
  const plan = compileSecSemanticOperationPlan({
    operation: 'control.branch-lifecycle.closed-unmerged-commit-journal-retirement',
    intentDigest: operation.operationId,
    decisionDigest: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST,
    deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: completed.receipt.publicationDigest
    }),
    aggregateBudgets: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS,
    requirements: [Object.freeze({
      id: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
      contractDigest: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST,
      effectKinds: Object.freeze(['filesystem', 'process', 'provider'] as const),
      failureKinds: Object.freeze([
        'development.commit.readback-invalid',
        'development.commit.readback-unknown'
      ])
    })]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
    contractDigest: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST,
    providerIdentityDigest:
      CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PROVIDER_IDENTITY_DIGEST
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
    requirementBindingContext: issueSecOperationRequirementBindingContext({
      operation: semanticOperation,
      requirementId: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
      resourceCeilings:
        CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS
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
  const bundleName = path.basename(recoveryPath);
  if (path.join(store.root.path, bundleName) !== recoveryPath) {
    throw new Error('Closed-unmerged recovery bundle escapes its exact owner root.');
  }
  const checksumName = `${bundleName}.sha256`;
  const preparationName = `${bundleName}.preparation.json`;
  const orderedNames = Object.freeze([bundleName, checksumName, preparationName]);
  const allowedSidecars = new Set([checksumName, preparationName]);
  const unexpected = store.listOwnedFiles(`${bundleName}.`)
    .filter((name) => !allowedSidecars.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Closed-unmerged recovery family has active or unknown consumers: ${unexpected.join(', ')}`);
  }

  const bundle = store.inspectFile(bundleName);
  const checksum = store.inspectFile(checksumName);
  const prepared = store.inspectFile(preparationName);
  // Preparation remains the durable continuation until the final deletion.
  if ((bundle !== null && checksum === null) || (checksum !== null && prepared === null)) {
    throw new Error('Closed-unmerged recovery family is not one valid ordered retirement state.');
  }
  if (bundle !== null) {
    if (bundle.kind !== 'file' || bundle.bytes === null || bundle.linkTarget !== null
      || `sha256:${createHash('sha256').update(bundle.bytes).digest('hex')}`
        !== preparation.recovery.sha256) {
      throw new Error('Closed-unmerged recovery bundle differs from its prepared digest.');
    }
  }
  if (checksum !== null) {
    if (checksum.kind !== 'file' || checksum.bytes === null || checksum.linkTarget !== null
      || !Buffer.from(checksum.bytes).equals(Buffer.from(
        `${preparation.recovery.sha256.slice('sha256:'.length)}  ${bundleName}\n`, 'utf8'
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
  if (bundle !== null && checksum !== null) {
    const verification = verifyRecoveryAuthorityLive({
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
    [bundleName, bundle], [checksumName, checksum], [preparationName, prepared]
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
    || (input.recoveryRoot === undefined && recoveryRoot === canonicalDefaultRoot);
  const recoveryRootRetired = failure === null && retained.length === 0
    && mayRetireRoot && store.retireIfEmpty();
  return Object.freeze({
    status: failure === null && retained.length === 0 ? 'completed' : 'partial',
    retired: Object.freeze(retired), retained, recoveryRootRetired, failure
  });
}
