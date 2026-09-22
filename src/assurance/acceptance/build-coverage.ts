import { canonicalEquals, compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import type { BlockManifest, LockFile } from '../../compiler/contract.ts';
import type { AcceptanceItem } from '../../semantics/acceptance/types.ts';
import {
  ACCEPTANCE_COVERAGE_FORMAT_VERSION,
  type AcceptanceCoverageEntry,
  type AcceptanceCoverageReport
} from './coverage.ts';
import { acceptanceIdsProvenByVerificationReports } from '../verification/acceptance/contract/proof.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from '../verification/contract/types.ts';
import { validateAcceptanceCoverageReport } from '../verification/acceptance/validation.ts';

interface AcceptanceCoverageTarget {
  id: string;
  acceptance: AcceptanceItem;
  blockId: string;
}

interface AcceptanceDefinition {
  id: string;
  dependsOn: string[];
}

interface AcceptanceTargetIndex {
  readonly participation: ReadonlyMap<string, ReadonlySet<string>>;
  readonly byBlock: ReadonlyMap<string, readonly string[]>;
}

export type AcceptanceCoverageManifestInput = Readonly<{
  blockId: string;
  manifest: BlockManifest;
}>;

export interface AcceptanceCoverageBuildInput {
  readonly lock: LockFile;
  readonly runtime: RuntimeVerificationLaneReport;
  readonly fast: FastVerificationLaneReport;
  readonly manifests: readonly AcceptanceCoverageManifestInput[];
}

function buildCoverageEntry(
  id: string,
  declaredAcceptance: string[],
  coveredBy: string[]
): AcceptanceCoverageEntry {
  const normalizedDeclared = uniqueSorted(declaredAcceptance);
  const normalizedCoveredBy = uniqueSorted(coveredBy);
  return {
    id,
    declaredAcceptance: normalizedDeclared,
    coveredBy: normalizedCoveredBy,
    uncovered: normalizedDeclared.length === 0 ||
      normalizedCoveredBy.length !== normalizedDeclared.length
  };
}

function acceptanceBlockTargets(target: AcceptanceCoverageTarget): string[] {
  return target.acceptance.covers?.blocks ?? [target.blockId];
}

function buildAcceptanceTargets(
  blockId: string,
  manifest: BlockManifest
): AcceptanceCoverageTarget[] {
  return manifest.acceptance.map(acceptance => ({
    id: acceptance.id,
    acceptance,
    blockId
  }));
}

function addIndexedAcceptance(
  index: Map<string, Set<string>>,
  targetId: string,
  acceptanceId: string
): void {
  const values = index.get(targetId) ?? new Set<string>();
  values.add(acceptanceId);
  index.set(targetId, values);
}

function freezeTargetIndex(
  index: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlyMap<string, readonly string[]> {
  return new Map([...index].map(([targetId, acceptanceIds]) => [
    targetId,
    Object.freeze(uniqueSorted([...acceptanceIds]))
  ]));
}

function buildCoverageTargetIndex(
  targets: readonly AcceptanceCoverageTarget[],
  resolvedBlockIds: ReadonlySet<string>
): AcceptanceTargetIndex {
  const participation = new Map<string, Set<string>>();
  const byBlock = new Map<string, Set<string>>();

  for (const target of targets) {
    for (const blockId of acceptanceBlockTargets(target)) {
      if (!resolvedBlockIds.has(blockId)) {
        throw new Error(
          `Acceptance ${target.id} references unknown resolved block ${blockId}`
        );
      }
      const entries = participation.get(target.id) ?? new Set<string>();
      entries.add(`block:${blockId}`);
      participation.set(target.id, entries);
      addIndexedAcceptance(byBlock, blockId, target.id);
    }
  }

  return Object.freeze({
    participation,
    byBlock: freezeTargetIndex(byBlock)
  });
}

function buildAcceptanceDefinitions(
  targets: readonly AcceptanceCoverageTarget[]
): ReadonlyMap<string, AcceptanceDefinition> {
  const acceptanceById = new Map<string, AcceptanceDefinition>();
  for (const target of targets) {
    const current = acceptanceById.get(target.id);
    acceptanceById.set(target.id, {
      id: target.id,
      dependsOn: uniqueSorted([
        ...(current?.dependsOn ?? []),
        ...(target.acceptance.dependsOn ?? [])
      ])
    });
  }
  for (const [acceptanceId, definition] of acceptanceById) {
    for (const dependency of definition.dependsOn) {
      if (!acceptanceById.has(dependency)) {
        throw new Error(
          `Acceptance ${acceptanceId} depends on undeclared acceptance ID ${dependency}`
        );
      }
    }
  }
  return acceptanceById;
}

function assertAcceptanceDependencyAcyclic(
  acceptanceById: ReadonlyMap<string, AcceptanceDefinition>
): void {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (acceptanceId: string): void => {
    const current = state.get(acceptanceId);
    if (current === 'done') return;
    if (current === 'visiting') {
      const cycleStart = stack.indexOf(acceptanceId);
      const cycle = [...stack.slice(cycleStart), acceptanceId];
      throw new Error(`Acceptance dependency cycle detected: ${cycle.join(' -> ')}`);
    }
    state.set(acceptanceId, 'visiting');
    stack.push(acceptanceId);
    for (const dependency of acceptanceById.get(acceptanceId)?.dependsOn ?? []) {
      visit(dependency);
    }
    stack.pop();
    state.set(acceptanceId, 'done');
  };

  for (const acceptanceId of acceptanceById.keys()) visit(acceptanceId);
}

function buildAcceptanceSatisfaction(
  accepted: ReadonlySet<string>,
  acceptanceById: ReadonlyMap<string, AcceptanceDefinition>
): (acceptanceId: string) => boolean {
  const memo = new Map<string, boolean>();
  const satisfied = (acceptanceId: string): boolean => {
    const cached = memo.get(acceptanceId);
    if (cached !== undefined) return cached;
    const definition = acceptanceById.get(acceptanceId);
    const value = definition !== undefined &&
      accepted.has(acceptanceId) &&
      definition.dependsOn.every(satisfied);
    memo.set(acceptanceId, value);
    return value;
  };
  return satisfied;
}

/** Build canonical Acceptance Coverage from already captured manifests and
 * Verification evidence. Assurance owns proof-graph validity and coverage truth. */
export function buildAcceptanceCoverageReport(
  input: AcceptanceCoverageBuildInput
): AcceptanceCoverageReport {
  const { lock, runtime, fast, manifests } = input;
  const targets: AcceptanceCoverageTarget[] = [];
  const manifestsByBlock = new Map(manifests.map(entry => [entry.blockId, entry.manifest]));

  for (const block of lock.resolvedBlocks) {
    const manifest = manifestsByBlock.get(block.id);
    if (manifest === undefined) {
      throw new Error(`Acceptance Coverage is missing manifest for resolved block ${block.id}`);
    }
    targets.push(...buildAcceptanceTargets(block.id, manifest));
  }
  if (manifestsByBlock.size !== lock.resolvedBlocks.length) {
    const resolved = new Set(lock.resolvedBlocks.map(block => block.id));
    const extras = [...manifestsByBlock.keys()].filter(blockId => !resolved.has(blockId));
    if (extras.length > 0) {
      throw new Error(`Acceptance Coverage received manifest for unresolved block ${extras[0]}`);
    }
  }

  const resolvedBlockIds = new Set(lock.resolvedBlocks.map(block => block.id));
  const targetIndex = buildCoverageTargetIndex(targets, resolvedBlockIds);
  const acceptanceById = buildAcceptanceDefinitions(targets);
  assertAcceptanceDependencyAcyclic(acceptanceById);

  for (const acceptanceId of lock.acceptancePlan) {
    if (!acceptanceById.has(acceptanceId)) {
      throw new Error(`Acceptance plan references undeclared acceptance ID ${acceptanceId}`);
    }
    if ((targetIndex.participation.get(acceptanceId)?.size ?? 0) === 0) {
      throw new Error(`Acceptance plan ID ${acceptanceId} covers no resolved block`);
    }
  }

  const acceptancePassed = uniqueSorted(
    acceptanceIdsProvenByVerificationReports(fast, runtime, lock.acceptancePlan)
  );
  const isSatisfied = buildAcceptanceSatisfaction(
    new Set(acceptancePassed),
    acceptanceById
  );
  const blockCoverage = lock.resolvedBlocks.map(block => {
    const declaredAcceptance = [...(targetIndex.byBlock.get(block.id) ?? [])];
    const coveredBy = declaredAcceptance.filter(isSatisfied);
    return buildCoverageEntry(block.id, declaredAcceptance, coveredBy);
  });
  const canonicalBlockCoverage = [...blockCoverage]
    .sort((left, right) => compareCodeUnits(left.id, right.id));

  return validateAcceptanceCoverageReport({
    formatVersion: ACCEPTANCE_COVERAGE_FORMAT_VERSION,
    status: runtime.status,
    acceptancePassed,
    blocks: canonicalBlockCoverage,
    uncoveredBlocks: canonicalBlockCoverage
      .filter(entry => entry.uncovered)
      .map(entry => entry.id)
  });
}

/** Exact equality is required when fast evidence is recovered from a canonical
 * artifact set rather than supplied by the current Verification execution. */
export function assertMatchingRuntimeCoverageEvidence(
  expected: RuntimeVerificationLaneReport,
  observed: RuntimeVerificationLaneReport
): void {
  if (!canonicalEquals(observed, expected)) {
    throw new Error(
      'Acceptance Coverage readback requires the canonical matching fast/runtime artifact set'
    );
  }
}
