import type { LockFile } from '../../compiler/contract.ts';
import { canonicalEquals, compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import type { AcceptanceItem } from '../../semantics/acceptance/types.ts';
import { acceptanceIdsProvenByVerificationReports } from '../verification/acceptance/contract/proof.ts';
import { validateAcceptanceCoverageReport } from '../verification/acceptance/validation.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from '../verification/contract/types.ts';
import {
  ACCEPTANCE_COVERAGE_FORMAT_VERSION,
  type AcceptanceCoverageEntry,
  type AcceptanceCoverageReport
} from './coverage.ts';
import { acceptanceCoverageSource, validateAcceptanceCoverageSource, type AcceptanceCoverageSource } from './source.ts';

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

export interface AcceptanceCoverageBuildInput {
  readonly lock: LockFile;
  readonly runtime: RuntimeVerificationLaneReport;
  readonly fast: FastVerificationLaneReport;
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
  return buildAcceptanceCoverageFromSource(acceptanceCoverageSource(input.lock), input.fast, input.runtime);
}

/** Offline recomputation uses the same captured frame as the live builder. */
export function buildAcceptanceCoverageFromSource(
  sourceInput: AcceptanceCoverageSource,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): AcceptanceCoverageReport {
  const source = validateAcceptanceCoverageSource(sourceInput);
  const targets = source.declarations.map(({ declaringBlockId, acceptance }) => ({
    id: acceptance.id, acceptance, blockId: declaringBlockId
  }));
  const resolvedBlockIds = new Set(source.resolvedBlockIds);
  const targetIndex = buildCoverageTargetIndex(targets, resolvedBlockIds);
  const acceptanceById = buildAcceptanceDefinitions(targets);
  assertAcceptanceDependencyAcyclic(acceptanceById);

  for (const acceptanceId of source.acceptancePlan) {
    if (!acceptanceById.has(acceptanceId)) {
      throw new Error(`Acceptance plan references undeclared acceptance ID ${acceptanceId}`);
    }
    if ((targetIndex.participation.get(acceptanceId)?.size ?? 0) === 0) {
      throw new Error(`Acceptance plan ID ${acceptanceId} covers no resolved block`);
    }
  }

  const installed = new Set(source.tests.map(test => test.testPath));
  const missingSource = new Set(targets.filter(target => target.acceptance.source === undefined
    || target.acceptance.source.tests.some(test => !installed.has(test))).map(target => target.id));
  const bindings = targets.flatMap(target => (target.acceptance.source?.tests ?? []).map(testPath => ({
    testPath, acceptanceIds: [target.id]
  })));
  const acceptancePassed = acceptanceIdsProvenByVerificationReports(fast, runtime,
    source.acceptancePlan.filter(id => !missingSource.has(id)), bindings);
  const isSatisfied = buildAcceptanceSatisfaction(
    new Set(acceptancePassed),
    acceptanceById
  );
  const blockCoverage = source.resolvedBlockIds.map(id => {
    const declaredAcceptance = [...(targetIndex.byBlock.get(id) ?? [])];
    const coveredBy = declaredAcceptance.filter(isSatisfied);
    return buildCoverageEntry(id, declaredAcceptance, coveredBy);
  });
  const canonicalBlockCoverage = [...blockCoverage]
    .sort((left, right) => compareCodeUnits(left.id, right.id));

  return validateAcceptanceCoverageReport({
    formatVersion: ACCEPTANCE_COVERAGE_FORMAT_VERSION,
    source,
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
