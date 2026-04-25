import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import type {
  AcceptanceCoverageEntry,
  AcceptanceCoverageReport,
  AcceptanceItem,
  BlockManifest,
  LockFile,
  RuntimeVerificationLaneReport
} from '../../shared/types.ts';

interface AcceptanceCoverageTarget {
  id: string;
  acceptance: AcceptanceItem;
  blockId: string;
}

function buildCoverageEntry(id: string, declaredAcceptance: string[], coveredBy: string[]): AcceptanceCoverageEntry {
  return {
    id,
    declaredAcceptance,
    coveredBy,
    uncovered: coveredBy.length === 0
  };
}

function isAcceptanceSatisfied(acceptance: AcceptanceItem, accepted: Set<string>): boolean {
  return accepted.has(acceptance.id) && (acceptance.dependsOn ?? []).every((dependency) => accepted.has(dependency));
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

  for (const block of lock.resolvedBlocks) {
    const declaredAcceptance = targets
      .filter((target) => acceptanceCoversBlock(target.acceptance, block.id, target.blockId))
      .map((target) => target.id);
    const coveredBy = targets
      .filter(
        (target) =>
          acceptanceCoversBlock(target.acceptance, block.id, target.blockId) && isAcceptanceSatisfied(target.acceptance, accepted)
      )
      .map((target) => target.id);
    blockCoverage.push(buildCoverageEntry(block.id, declaredAcceptance, coveredBy));
  }

  for (const task of lock.slotTasks) {
    const declaredAcceptance = targets
      .filter((target) => acceptanceCoversSlot(target.acceptance, task.id))
      .map((target) => target.id);
    const coveredBy = targets
      .filter((target) => acceptanceCoversSlot(target.acceptance, task.id) && isAcceptanceSatisfied(target.acceptance, accepted))
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
