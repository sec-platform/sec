import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import type { AcceptanceCoverageEntry, AcceptanceCoverageReport, LockFile, RuntimeVerificationLaneReport } from '../../shared/types.ts';

function buildCoverageEntry(id: string, declaredAcceptance: string[], coveredBy: string[]): AcceptanceCoverageEntry {
  return {
    id,
    declaredAcceptance,
    coveredBy,
    uncovered: coveredBy.length === 0
  };
}

export async function buildAcceptanceCoverage(
  workspaceRoot: string,
  lock: LockFile,
  runtime: RuntimeVerificationLaneReport
): Promise<AcceptanceCoverageReport> {
  const runtimeAcceptancePassed = runtime.acceptance.status === 'passed' ? [...lock.acceptancePlan] : [];
  const accepted = new Set(runtimeAcceptancePassed);
  const blockCoverage: AcceptanceCoverageEntry[] = [];
  const slotCoverage: AcceptanceCoverageEntry[] = [];

  for (const block of lock.resolvedBlocks) {
    const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
    const declaredAcceptance = manifestEntry.manifest.acceptance.map((acceptance) => acceptance.id);
    const coveredBy = declaredAcceptance.filter((acceptanceId) => accepted.has(acceptanceId));
    blockCoverage.push(buildCoverageEntry(block.id, declaredAcceptance, coveredBy));
  }

  for (const task of lock.slotTasks) {
    const sourceBlock = lock.resolvedBlocks.find((block) => block.id === task.block);
    const manifestEntry = sourceBlock ? await loadManifestForResolvedBlock(workspaceRoot, sourceBlock) : null;
    const declaredAcceptance = manifestEntry?.manifest.acceptance.map((acceptance) => acceptance.id) ?? [];
    const coveredBy = declaredAcceptance.filter((acceptanceId) => accepted.has(acceptanceId));
    slotCoverage.push(buildCoverageEntry(task.id, declaredAcceptance, coveredBy));
  }

  return {
    formatVersion: '1',
    status: runtime.status,
    acceptancePassed: runtimeAcceptancePassed,
    blocks: blockCoverage,
    slots: slotCoverage,
    uncoveredBlocks: blockCoverage.filter((entry) => entry.uncovered).map((entry) => entry.id),
    uncoveredSlots: slotCoverage.filter((entry) => entry.uncovered).map((entry) => entry.id)
  };
}
