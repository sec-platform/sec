import { createHash } from 'node:crypto';
import path from 'node:path';

import { inspectExactNoFollowDirectoryPresence } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
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
  readonly status: 'completed' | 'already-retired' | 'partial';
  readonly retired: readonly string[];
  readonly retained: readonly string[];
  readonly recoveryRootRetired: boolean;
  readonly failure: string | null;
}>;

function expectedPreparationBytes(prepared: PreparedBranchCloseoutEnvelope): Buffer {
  return Buffer.from(`${JSON.stringify(prepared, null, 2)}\n`, 'utf8');
}

function remainingFamily(
  store: BranchRecoveryStore,
  names: readonly string[]
): readonly string[] {
  return Object.freeze(names.filter((name) => store.inspectFile(name) !== null)
    .map((name) => path.join(store.root.path, name)));
}

/**
 * Retire only the recovery family consumed by one exact completed
 * closed-unmerged operation. The provider terminal remains the durable
 * recovery route if this ordered local deletion is interrupted.
 */
export function retireClosedUnmergedRecoveryFamily(input: Readonly<{
  readonly operation: ClosedUnmergedCloseoutOperation;
  readonly completed: ClosedUnmergedCloseoutExecutionResult;
  readonly recoveryRoot?: string;
}>): ClosedUnmergedRecoveryRetirementResult {
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
    return Object.freeze({
      status: 'already-retired',
      retired: Object.freeze([]),
      retained: Object.freeze([]),
      recoveryRootRetired: true,
      failure: null
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
  const sidecars = store.listOwnedFiles(`${bundleName}.`);
  const unexpected = sidecars.filter((name) => !allowedSidecars.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Closed-unmerged recovery family has active or unknown consumers: ${unexpected.join(', ')}`);
  }

  const bundle = store.inspectFile(bundleName);
  const checksum = store.inspectFile(checksumName);
  const prepared = store.inspectFile(preparationName);
  // Retirement order is bundle -> checksum -> preparation. The preparation
  // remains the durable same-operation continuation until the final delete.
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
        `${preparation.recovery.sha256.slice('sha256:'.length)}  ${bundleName}\n`,
        'utf8'
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

  const retired: string[] = [];
  let failure: string | null = null;
  const admittedEntries = new Map([
    [bundleName, bundle],
    [checksumName, checksum],
    [preparationName, prepared]
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
    retired: Object.freeze(retired),
    retained,
    recoveryRootRetired,
    failure
  });
}
