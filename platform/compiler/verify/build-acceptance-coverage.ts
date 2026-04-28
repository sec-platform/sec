import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import type { BlockManifest, LockFile } from '../../shared/types.ts';
import type {
  AcceptanceCoverageEntry,
  AcceptanceCoverageReport,
  AcceptanceItem
} from '../../shared/acceptance-types.ts';
import type { RuntimeVerificationLaneReport } from '../../shared/verification-types.ts';

interface AcceptanceCoverageTarget {
  id: string;
  acceptance: AcceptanceItem;
  blockId: string;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function buildCoverageEntry(id: string, declaredAcceptance: string[], coveredBy: string[]): AcceptanceCoverageEntry {
  const normalizedCoveredBy = uniqueSorted(coveredBy);
  return {
    id,
    declaredAcceptance: uniqueSorted(declaredAcceptance),
    coveredBy: normalizedCoveredBy,
    uncovered: normalizedCoveredBy.length === 0
  };
}

function isAcceptanceSatisfied(
  acceptance: AcceptanceItem,
  accepted: Set<string>,
  acceptanceById: Map<string, AcceptanceItem>,
  visited = new Set<string>()
): boolean {
  if (!accepted.has(acceptance.id)) {
    return false;
  }
  if (visited.has(acceptance.id)) {
    return true;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(acceptance.id);
  return (acceptance.dependsOn ?? []).every((dependency) => {
    if (!accepted.has(dependency)) {
      return false;
    }
    const dependencyAcceptance = acceptanceById.get(dependency);
    return dependencyAcceptance ? isAcceptanceSatisfied(dependencyAcceptance, accepted, acceptanceById, nextVisited) : true;
  });
}

function acceptanceCoversBlock(acceptance: AcceptanceItem, blockId: string, declaringBlockId: string): boolean {
  return acceptance.covers?.blocks?.includes(blockId) ?? declaringBlockId === blockId;
}

function acceptanceCoversSlot(acceptance: AcceptanceItem, slotId: string): boolean {
  return acceptance.covers?.slots?.includes(slotId) ?? false;
}

function buildAcceptanceTargets(blockId: string, manifest: BlockManifest): AcceptanceCoverageTarget[] {
  return manifest.acceptance.map((acceptance) => ({
    id: acceptance.id,
    acceptance,
    blockId
  }));
}

export async function buildAcceptanceCoverage(
  workspaceRoot: string,
  lock: LockFile,
  runtime: RuntimeVerificationLaneReport
): Promise<AcceptanceCoverageReport> {
  const runtimeAccepted = new Set(runtime.acceptance.status === 'passed' ? runtime.acceptance.passed : []);
  const runtimeAcceptancePassed = lock.acceptancePlan.filter((acceptanceId) => runtimeAccepted.has(acceptanceId));
  const acceptancePassed = runtimeAcceptancePassed.length > 0
    ? runtimeAcceptancePassed
    : runtime.acceptance.status === 'passed'
      ? [...lock.acceptancePlan]
      : [];
  const accepted = new Set(acceptancePassed);
  const blockCoverage: AcceptanceCoverageEntry[] = [];
  const slotCoverage: AcceptanceCoverageEntry[] = [];
  const targets: AcceptanceCoverageTarget[] = [];

  for (const block of lock.resolvedBlocks) {
    const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
    targets.push(...buildAcceptanceTargets(block.id, manifestEntry.manifest));
  }

  const acceptanceById = new Map<string, AcceptanceItem>();
  for (const target of targets) {
    if (!acceptanceById.has(target.id)) {
      acceptanceById.set(target.id, target.acceptance);
    }
  }

  for (const block of lock.resolvedBlocks) {
    const declaredAcceptance = targets
      .filter((target) => acceptanceCoversBlock(target.acceptance, block.id, target.blockId))
      .map((target) => target.id);
    const coveredBy = targets
      .filter(
        (target) =>
          acceptanceCoversBlock(target.acceptance, block.id, target.blockId) && isAcceptanceSatisfied(target.acceptance, accepted, acceptanceById)
      )
      .map((target) => target.id);
    blockCoverage.push(buildCoverageEntry(block.id, declaredAcceptance, coveredBy));
  }

  for (const task of lock.slotTasks) {
    const declaredAcceptance = targets
      .filter((target) => acceptanceCoversSlot(target.acceptance, task.id))
      .map((target) => target.id);
    const coveredBy = targets
      .filter((target) => acceptanceCoversSlot(target.acceptance, task.id) && isAcceptanceSatisfied(target.acceptance, accepted, acceptanceById))
      .map((target) => target.id);
    slotCoverage.push(buildCoverageEntry(task.id, declaredAcceptance, coveredBy));
  }

  return {
    formatVersion: '1',
    status: runtime.status,
    acceptancePassed,
    blocks: blockCoverage,
    slots: slotCoverage,
    uncoveredBlocks: blockCoverage.filter((entry) => entry.uncovered).map((entry) => entry.id),
    uncoveredSlots: slotCoverage.filter((entry) => entry.uncovered).map((entry) => entry.id)
  };
}
