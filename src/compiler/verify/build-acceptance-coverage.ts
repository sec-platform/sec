import { ACCEPTANCE_COVERAGE_FORMAT_VERSION, type AcceptanceCoverageEntry, type AcceptanceCoverageReport } from '../../assurance/acceptance/coverage.ts';
import { type AcceptanceItem } from '../../semantics/acceptance/types.ts';
import { canonicalEquals, compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import { acceptanceIdsProvenByVerificationReports } from '../../verification/acceptance/contract/proof.ts';
import { validateAcceptanceCoverageReport } from '../../verification/acceptance/runtime/coverage-authority.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../verification/artifact/runtime/authority.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport } from '../../verification/contract/types.ts';
import type { BlockManifest, LockFile } from '../contract.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';

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
  return manifest.acceptance.map((acceptance) => ({
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

function freezeTargetIndex(index: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyMap<string, readonly string[]> {
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
        throw new Error(`Acceptance ${target.id} references unknown resolved block ${blockId}`);
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
        throw new Error(`Acceptance ${acceptanceId} depends on undeclared acceptance ID ${dependency}`);
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

function resolveFastVerificationLane(
  workspaceRoot: string,
  runtime: RuntimeVerificationLaneReport,
  fast: FastVerificationLaneReport | undefined
): FastVerificationLaneReport {
  if (fast !== undefined) return fast;
  const artifacts = readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Acceptance Coverage Verification artifact set'
  );
  if (artifacts === null || !canonicalEquals(artifacts.runtimeReport, runtime)) {
    throw new Error('Acceptance Coverage readback requires the canonical matching fast/runtime artifact set');
  }
  return artifacts.verificationReport.fast;
}

export async function buildAcceptanceCoverage(
  workspaceRoot: string,
  lock: LockFile,
  runtime: RuntimeVerificationLaneReport,
  fast?: FastVerificationLaneReport
): Promise<AcceptanceCoverageReport> {
  const fastLane = resolveFastVerificationLane(workspaceRoot, runtime, fast);
  const blockCoverage: AcceptanceCoverageEntry[] = [];
  const targets: AcceptanceCoverageTarget[] = [];

  const manifestEntries = await Promise.all(
    lock.resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );
  manifestEntries.forEach((manifestEntry, index) => {
    targets.push(...buildAcceptanceTargets(lock.resolvedBlocks[index]!.id, manifestEntry.manifest));
  });

  const resolvedBlockIds = new Set(lock.resolvedBlocks.map((block) => block.id));
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

  const acceptancePassed = uniqueSorted(acceptanceIdsProvenByVerificationReports(
    fastLane,
    runtime,
    lock.acceptancePlan
  ));
  const isSatisfied = buildAcceptanceSatisfaction(new Set(acceptancePassed), acceptanceById);

  for (const block of lock.resolvedBlocks) {
    const declaredAcceptance = [...(targetIndex.byBlock.get(block.id) ?? [])];
    const coveredBy = declaredAcceptance.filter(isSatisfied);
    blockCoverage.push(buildCoverageEntry(block.id, declaredAcceptance, coveredBy));
  }

  const canonicalBlockCoverage = [...blockCoverage]
    .sort((left, right) => compareCodeUnits(left.id, right.id));

  return validateAcceptanceCoverageReport({
    formatVersion: ACCEPTANCE_COVERAGE_FORMAT_VERSION,
    status: runtime.status,
    acceptancePassed,
    blocks: canonicalBlockCoverage,
    uncoveredBlocks: canonicalBlockCoverage.filter((entry) => entry.uncovered).map((entry) => entry.id)
  });
}
