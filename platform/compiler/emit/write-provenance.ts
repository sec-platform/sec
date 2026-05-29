import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_ARTIFACT_PATHS,
  CI_EXPLAIN_GRAPH_ARTIFACT_PATHS
} from '../../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { readOptionalJson, writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeGeneratedArtifactWithLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { ProvenanceArtifact, ProvenanceFile } from '../../shared/provenance-types.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

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

type PassRule = { test: (path: string) => boolean; pass: string };

const PASS_RULES: PassRule[] = [
  { test: (p) => p === CI_ARTIFACT_FILES.provenance || p === 'provenance.json', pass: 'lock' },
  { test: (p) => p === CI_ARTIFACT_FILES.blockUsageMap || p === CI_ARTIFACT_FILES.installManifest, pass: 'compose' },
  { test: (p) => p.startsWith('control/evidence/'), pass: 'verify' },
  { test: (p) => CI_EXPLAIN_GRAPH_ARTIFACT_PATHS.includes(p), pass: 'explain' },
  { test: (p) => p === CI_ARTIFACT_MANIFEST_PATH, pass: 'artifacts' },
  { test: (p) => (CI_ARTIFACT_PATHS.view as readonly string[]).includes(p), pass: 'explain' },
  { test: (p) => p === CI_ARTIFACT_FILES.repairPlan, pass: 'repair' },
  { test: (p) => p === CI_ARTIFACT_FILES.upgradePlan || p === CI_ARTIFACT_FILES.upgradeDiagnostics, pass: 'upgrade' },
  { test: (p) => p.startsWith('generated/') && (p.includes('verification-report') || p.includes('runtime-report') || p.includes('policy-report') || p.includes('acceptance-coverage')), pass: 'verify' },
  { test: (p) => p.startsWith('generated/') && (p.includes('explain-graph') || p.includes('review-summary') || p.startsWith('generated/views/')), pass: 'explain' },
  { test: (p) => p.startsWith('generated/') && p.includes('repair-plan'), pass: 'repair' },
  { test: (p) => p.startsWith('generated/') && (p.includes('upgrade-plan') || p.includes('upgrade-diagnostics')), pass: 'upgrade' }
];

function inferGeneratedByPass(targetPath: string): string {
  return PASS_RULES.find((rule) => rule.test(targetPath))?.pass ?? 'compose';
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

async function calculateFileHash(absolutePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(absolutePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return undefined;
  }
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

  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  for (const [artPath, artifact] of artifacts.entries()) {
    const absPath = artPath.startsWith('source/') || artPath.startsWith('control/')
      ? path.join(workspaceRoot, artPath)
      : path.join(projectRoot, artPath);
    const hash = await calculateFileHash(absPath);
    if (hash) {
      artifact.hash = hash;
    }
  }

  return {
    formatVersion: '1',
    artifacts: [...artifacts.values()].sort((left, right) => left.path.localeCompare(right.path))
  };
}

export async function writeProvenance(workspaceRoot: string, lock: LockFile): Promise<ProvenanceFile> {
  const { provenancePath, lockPath } = getWorkspacePaths(workspaceRoot);
  return writeGeneratedArtifactWithLock(
    lockPath,
    lock,
    [CI_ARTIFACT_FILES.provenance],
    async () => {
      const provenance = await buildProvenance(workspaceRoot, lock);
      await writeJson(provenancePath, provenance);
      return provenance;
    }
  );
}
