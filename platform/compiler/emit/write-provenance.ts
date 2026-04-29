import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_ARTIFACT_PATHS
} from '../../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { readOptionalJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { addGeneratedPaths } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { ProvenanceArtifact, ProvenanceFile } from '../../shared/provenance-types.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';

function buildTaskGeneratorId(taskId: string): string {
  return `fill_slot_${taskId}`;
}

function buildSlotArtifact(task: LockFile['slotTasks'][number], artifactPath: string): ProvenanceArtifact {
  return {
    path: artifactPath,
    originType: 'slot',
    originId: task.id,
    sourceBlock: task.block,
    ...(task.sourcePath ? { sourcePath: task.sourcePath, runtimeTarget: task.target } : {}),
    generatedByPass: task.status === 'generated' ? 'compose' : 'adapt',
    generatorTaskId: buildTaskGeneratorId(task.id),
    verifiedBy: uniqueSorted(task.provenanceHints.verifiedBy),
    overrideStatus: 'none'
  };
}

function inferGeneratedByPass(targetPath: string): string {
  if (targetPath === CI_ARTIFACT_FILES.provenance) {
    return 'lock';
  }
  if (targetPath.startsWith('control/evidence/')) {
    return targetPath === CI_ARTIFACT_FILES.blockUsageMap || targetPath === CI_ARTIFACT_FILES.installManifest
      ? 'compose'
      : 'verify';
  }
  if (targetPath === CI_ARTIFACT_FILES.explainGraph) {
    return 'explain';
  }
  if (targetPath === CI_ARTIFACT_MANIFEST_PATH) {
    return 'artifacts';
  }
  if ((CI_ARTIFACT_PATHS.view as readonly string[]).includes(targetPath)) {
    return 'explain';
  }
  if (targetPath === CI_ARTIFACT_FILES.repairPlan) {
    return 'repair';
  }
  if (targetPath === CI_ARTIFACT_FILES.upgradePlan || targetPath === CI_ARTIFACT_FILES.upgradeDiagnostics) {
    return 'upgrade';
  }
  if (targetPath === 'provenance.json') {
    return 'lock';
  }
  if (targetPath.startsWith('generated/')) {
    if (
      targetPath.includes('verification-report') ||
      targetPath.includes('runtime-report') ||
      targetPath.includes('policy-report') ||
      targetPath.includes('acceptance-coverage')
    ) {
      return 'verify';
    }
    if (
      targetPath.includes('explain-graph') ||
      targetPath.includes('review-summary') ||
      targetPath.startsWith('generated/views/')
    ) {
      return 'explain';
    }
    if (targetPath.includes('repair-plan')) {
      return 'repair';
    }
    if (targetPath.includes('upgrade-plan') || targetPath.includes('upgrade-diagnostics')) {
      return 'upgrade';
    }
  }
  return 'compose';
}

function passedVerificationPaths(report: VerificationReport | null): string[] {
  if (!report || report.summary.status !== 'passed') {
    return [];
  }

  return uniqueSorted([
    ...report.unit.passed.map((file) => `tests/unit/${file}`),
    ...report.acceptance.passed.map((file) => `tests/acceptance/${file}`),
    ...report.runtime.unit.passed,
    ...report.runtime.acceptance.passed
  ]);
}

function buildBlockVerificationMap(lock: LockFile, report: VerificationReport | null): Map<string, string[]> {
  const installedTestBlocks = new Map<string, string>();
  for (const step of lock.installPlan) {
    if (step.to.startsWith('tests/')) {
      installedTestBlocks.set(step.to, step.blockId);
    }
  }

  const byBlock = new Map<string, string[]>();
  for (const testPath of passedVerificationPaths(report)) {
    const blockId = installedTestBlocks.get(testPath);
    if (!blockId) {
      continue;
    }
    byBlock.set(blockId, uniqueSorted([...(byBlock.get(blockId) ?? []), testPath]));
  }
  return byBlock;
}

async function readVerificationReport(workspaceRoot: string): Promise<VerificationReport | null> {
  const { verificationReportPath } = getWorkspacePaths(workspaceRoot);
  return readOptionalJson<VerificationReport>(verificationReportPath);
}

export async function buildProvenance(workspaceRoot: string, lock: LockFile): Promise<ProvenanceFile> {
  const artifacts = new Map<string, ProvenanceArtifact>();
  const blockVerificationMap = buildBlockVerificationMap(lock, await readVerificationReport(workspaceRoot));

  for (const step of lock.installPlan) {
    artifacts.set(step.to, {
      path: step.to,
      originType: 'block',
      originId: step.blockId,
      sourceBlock: step.blockId,
      registrySourceId: step.registrySourceId,
      registryKind: step.registryKind,
      registryLocation: step.registryLocation,
      registryPath: step.registryPath,
      generatedByPass: 'compose',
      verifiedBy: blockVerificationMap.get(step.blockId) ?? [],
      overrideStatus: 'none'
    });
  }

  for (const generatedPath of lock.generatedPaths) {
    artifacts.set(generatedPath, {
      path: generatedPath,
      originType: 'generated',
      originId: generatedPath,
      generatedByPass: inferGeneratedByPass(generatedPath),
      verifiedBy: [],
      overrideStatus: 'none'
    });
  }

  for (const task of lock.slotTasks) {
    if (task.sourcePath) {
      artifacts.set(task.sourcePath, buildSlotArtifact(task, task.sourcePath));
    }
    artifacts.set(task.target, buildSlotArtifact(task, task.target));
  }

  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  for (const entry of overrideManifest.overrides) {
    const existing = artifacts.get(entry.target);
    artifacts.set(entry.target, {
      path: entry.target,
      originType: 'override',
      originId: entry.id,
      sourceBlock: existing?.sourceBlock,
      registrySourceId: existing?.registrySourceId,
      registryKind: existing?.registryKind,
      registryLocation: existing?.registryLocation,
      registryPath: existing?.registryPath,
      ...(existing?.sourcePath ? { sourcePath: existing.sourcePath } : {}),
      ...(existing?.runtimeTarget ? { runtimeTarget: existing.runtimeTarget } : {}),
      generatedByPass: entry.appliesAfter[entry.appliesAfter.length - 1] ?? existing?.generatedByPass,
      generatorTaskId: existing?.generatorTaskId,
      verifiedBy: existing?.verifiedBy ?? [],
      overrideStatus: entry.source
    });
  }

  return {
    formatVersion: '1',
    artifacts: [...artifacts.values()].sort((left, right) => left.path.localeCompare(right.path))
  };
}

export async function writeProvenance(workspaceRoot: string, lock: LockFile): Promise<ProvenanceFile> {
  const { provenancePath, lockPath } = getWorkspacePaths(workspaceRoot);
  addGeneratedPaths(lock, [CI_ARTIFACT_FILES.provenance]);

  const provenance = await buildProvenance(workspaceRoot, lock);
  await fs.mkdir(path.dirname(provenancePath), { recursive: true });
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return provenance;
}
