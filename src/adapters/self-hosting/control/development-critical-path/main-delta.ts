import { compareCodeUnits, deepFreeze } from '../../../../contracts/canonical.ts';
import {
  SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
  criticalPathRef,
  criticalPathTree,
  failCriticalPath,
  sortedUniqueCriticalPathDigests,
  uniqueSortedCriticalPathRefs,
  type CriticalPathDigest
} from './common.ts';

export interface MainDeltaOwnerObservationV1 {
  readonly ownerRef: string;
  readonly observationRef: string;
  readonly state: 'known' | 'unknown';
  readonly verifiedRevision: string;
  readonly currentRevision: string;
}

export interface MainDeltaProposalV1 {
  readonly schema: 'sec-critical-path-main-delta-proposal-v1';
  readonly revision: typeof SEC_DEVELOPMENT_CRITICAL_PATH_REVISION;
  /** Proposal only. #311/MainHealth remains the authority that may consume it. */
  readonly disposition: 'main-delta-eligible' | 'full-main-health-required';
  readonly mainOnlyActionKeys: readonly CriticalPathDigest[];
  readonly reasonCodes: readonly string[];
  readonly blockerRefs: readonly string[];
}

export function compileMainDeltaProposalV1(input: Readonly<{
  verifiedCandidateTree: string;
  mergedMainTree: string;
  equivalenceClosure: Readonly<{
    state: 'complete' | 'unknown';
    observationRef: string;
    owners: readonly MainDeltaOwnerObservationV1[];
  }>;
  mainOnlyClosure: Readonly<{
    state: 'known' | 'unknown';
    observationRef: string;
    actionKeys: readonly CriticalPathDigest[];
  }>;
}>): MainDeltaProposalV1 {
  const verifiedCandidateTree = criticalPathTree(input.verifiedCandidateTree, 'verifiedCandidateTree');
  const mergedMainTree = criticalPathTree(input.mergedMainTree, 'mergedMainTree');
  const equivalenceRef = criticalPathRef(
    input.equivalenceClosure.observationRef,
    'equivalenceClosure.observationRef'
  );
  const mainOnlyRef = criticalPathRef(input.mainOnlyClosure.observationRef, 'mainOnlyClosure.observationRef');
  const owners = input.equivalenceClosure.owners.map((value, index) => Object.freeze({
    ownerRef: criticalPathRef(value.ownerRef, `equivalenceClosure.owners[${index}].ownerRef`),
    observationRef: criticalPathRef(
      value.observationRef,
      `equivalenceClosure.owners[${index}].observationRef`
    ),
    state: value.state,
    verifiedRevision: criticalPathRef(
      value.verifiedRevision,
      `equivalenceClosure.owners[${index}].verifiedRevision`
    ),
    currentRevision: criticalPathRef(
      value.currentRevision,
      `equivalenceClosure.owners[${index}].currentRevision`
    )
  })).sort((left, right) => compareCodeUnits(left.ownerRef, right.ownerRef));
  if (new Set(owners.map(({ ownerRef }) => ownerRef)).size !== owners.length) {
    failCriticalPath('equivalenceClosure.owners contains a duplicate ownerRef.');
  }
  if (input.equivalenceClosure.state !== 'complete'
      && input.equivalenceClosure.state !== 'unknown') {
    failCriticalPath('equivalenceClosure.state is invalid.');
  }
  if (input.mainOnlyClosure.state !== 'known' && input.mainOnlyClosure.state !== 'unknown') {
    failCriticalPath('mainOnlyClosure.state is invalid.');
  }
  const mainOnlyActionKeys = sortedUniqueCriticalPathDigests(
    input.mainOnlyClosure.actionKeys,
    'mainOnlyClosure.actionKeys'
  );
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (verifiedCandidateTree !== mergedMainTree) {
    reasons.push('verified-tree-differs-from-merged-tree');
    blockers.push(equivalenceRef);
  }
  if (input.equivalenceClosure.state !== 'complete') {
    reasons.push('equivalence-closure-unknown');
    blockers.push(equivalenceRef);
  }
  for (const owner of owners) {
    if (owner.state === 'unknown') {
      reasons.push('owner-revision-unknown');
      blockers.push(owner.observationRef);
    } else if (owner.state !== 'known') {
      failCriticalPath(`owner ${owner.ownerRef} state is invalid.`);
    } else if (owner.verifiedRevision !== owner.currentRevision) {
      reasons.push('owner-revision-drift');
      blockers.push(owner.observationRef);
    }
  }
  if (input.mainOnlyClosure.state !== 'known') {
    reasons.push('main-only-closure-unknown');
    blockers.push(mainOnlyRef);
  }

  const eligible = reasons.length === 0;
  return deepFreeze({
    schema: 'sec-critical-path-main-delta-proposal-v1',
    revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
    disposition: eligible ? 'main-delta-eligible' : 'full-main-health-required',
    mainOnlyActionKeys: eligible ? mainOnlyActionKeys : [],
    reasonCodes: eligible ? ['main-delta-eligible'] : uniqueSortedCriticalPathRefs(reasons),
    blockerRefs: uniqueSortedCriticalPathRefs(blockers)
  });
}
