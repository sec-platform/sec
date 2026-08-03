import type {
  AcceptanceCoverageEntry,
  AcceptanceCoverageReport,
  AcceptanceItem
} from '../../shared/acceptance-types.ts';
import {
  acceptanceIdsProvenByVerificationReportsV1
} from '../../shared/acceptance-proof-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { readJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../../shared/verification-types.ts';
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

function isAcceptanceSatisfied(
  acceptanceId: string,
  accepted: Set<string>,
  acceptanceById: ReadonlyMap<string, AcceptanceDefinition>,
  visited = new Set<string>()
): boolean {
  if (!accepted.has(acceptanceId) || visited.has(acceptanceId)) return false;
  const definition = acceptanceById.get(acceptanceId);
  if (!definition) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(acceptanceId);
  return definition.dependsOn.every((dependency) =>
    isAcceptanceSatisfied(dependency, accepted, acceptanceById, nextVisited)
  );
}

function acceptanceBlockTargets(target: AcceptanceCoverageTarget): string[] {
  return target.acceptance.covers?.blocks ?? [target.blockId];
}

function acceptanceSlotTargets(target: AcceptanceCoverageTarget): string[] {
  return target.acceptance.covers?.slots ?? [];
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

function assertCoverageTargetClosure(
  targets: readonly AcceptanceCoverageTarget[],
  resolvedBlockIds: ReadonlySet<string>,
  resolvedSlotIds: ReadonlySet<string>
): ReadonlyMap<string, ReadonlySet<string>> {
  const participation = new Map<string, Set<string>>();
  for (const target of targets) {
    for (const blockId of acceptanceBlockTargets(target)) {
      if (!resolvedBlockIds.has(blockId)) {
        throw new Error(`Acceptance ${target.id} references unknown resolved block ${blockId}`);
      }
      const entries = participation.get(target.id) ?? new Set<string>();
      entries.add(`block:${blockId}`);
      participation.set(target.id, entries);
    }
    for (const slotId of acceptanceSlotTargets(target)) {
      if (!resolvedSlotIds.has(slotId)) {
        throw new Error(`Acceptance ${target.id} references unknown resolved slot ${slotId}`);
      }
      const entries = participation.get(target.id) ?? new Set<string>();
      entries.add(`slot:${slotId}`);
      participation.set(target.id, entries);
    }
  }
  return participation;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function resolveFastVerificationLane(
  workspaceRoot: string,
  runtime: RuntimeVerificationLaneReport,
  fast: FastVerificationLaneReport | undefined
): Promise<FastVerificationLaneReport> {
  if (fast !== undefined) return fast;
  const report = await readJson<VerificationReport>(getWorkspacePaths(workspaceRoot).verificationReportPath);
  if (!report || typeof report !== 'object' || !report.fast ||
    !sameCanonicalValue(report.runtime, runtime)) {
    throw new Error('Acceptance Coverage readback requires the canonical matching fast/runtime report');
  }
  return report.fast;
}

export async function buildAcceptanceCoverage(
  workspaceRoot: string,
  lock: LockFile,
  runtime: RuntimeVerificationLaneReport,
  fast?: FastVerificationLaneReport
): Promise<AcceptanceCoverageReport> {
  const fastLane = await resolveFastVerificationLane(workspaceRoot, runtime, fast);
  const blockCoverage: AcceptanceCoverageEntry[] = [];
  const slotCoverage: AcceptanceCoverageEntry[] = [];
  const targets: AcceptanceCoverageTarget[] = [];

  const manifestEntries = await Promise.all(
    lock.resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );
  manifestEntries.forEach((manifestEntry, index) => {
    targets.push(...buildAcceptanceTargets(lock.resolvedBlocks[index]!.id, manifestEntry.manifest));
  });

  const resolvedBlockIds = new Set(lock.resolvedBlocks.map((block) => block.id));
  const resolvedSlotIds = new Set(lock.slotTasks.map((task) => task.id));
  const participation = assertCoverageTargetClosure(targets, resolvedBlockIds, resolvedSlotIds);

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
  for (const acceptanceId of lock.acceptancePlan) {
    if (!acceptanceById.has(acceptanceId)) {
      throw new Error(`Acceptance plan references undeclared acceptance ID ${acceptanceId}`);
    }
    if ((participation.get(acceptanceId)?.size ?? 0) === 0) {
      throw new Error(`Acceptance plan ID ${acceptanceId} covers no resolved block or slot`);
    }
  }

  const acceptancePassed = acceptanceIdsProvenByVerificationReportsV1(
    fastLane,
    runtime,
    lock.acceptancePlan
  );
  const accepted = new Set(acceptancePassed);

  for (const block of lock.resolvedBlocks) {
    const declaredAcceptance = targets
      .filter((target) => acceptanceBlockTargets(target).includes(block.id))
      .map((target) => target.id);
    const coveredBy = uniqueSorted(declaredAcceptance.filter((acceptanceId) =>
      isAcceptanceSatisfied(acceptanceId, accepted, acceptanceById)
    ));
    blockCoverage.push(buildCoverageEntry(block.id, declaredAcceptance, coveredBy));
  }

  for (const task of lock.slotTasks) {
    const declaredAcceptance = targets
      .filter((target) => acceptanceSlotTargets(target).includes(task.id))
      .map((target) => target.id);
    const coveredBy = uniqueSorted(declaredAcceptance.filter((acceptanceId) =>
      isAcceptanceSatisfied(acceptanceId, accepted, acceptanceById)
    ));
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
