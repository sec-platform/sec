import fs from 'node:fs/promises';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import type { LockFile, ProvenanceArtifact, ProvenanceFile } from '../../shared/types.ts';

function buildTaskGeneratorId(taskId: string): string {
  return `fill_slot_${taskId}`;
}

function inferGeneratedByPass(targetPath: string): string {
  if (targetPath === 'provenance.json') {
    return 'lock';
  }
  if (targetPath === 'generated/verification-report.json') {
    return 'verify';
  }
  if (targetPath === 'generated/runtime-report.json') {
    return 'verify';
  }
  if (targetPath === 'generated/policy-report.json') {
    return 'verify';
  }
  if (targetPath === 'generated/acceptance-coverage.json') {
    return 'verify';
  }
  if (targetPath === 'generated/explain-graph.json') {
    return 'explain';
  }
  if (targetPath === 'generated/review-summary.json') {
    return 'explain';
  }
  if (targetPath === 'generated/views/source-view.html' || targetPath === 'generated/views/slot-rule-view.html') {
    return 'explain';
  }
  if (targetPath === 'generated/repair-plan.json') {
    return 'repair';
  }
  if (targetPath === 'generated/upgrade-plan.json') {
    return 'upgrade';
  }
  return 'compose';
}

export async function buildProvenance(workspaceRoot: string, lock: LockFile): Promise<ProvenanceFile> {
  const artifacts = new Map<string, ProvenanceArtifact>();

  for (const step of lock.installPlan) {
    artifacts.set(step.to, {
      path: step.to,
      originType: 'block',
      originId: step.blockId,
      sourceBlock: step.blockId,
      generatedByPass: 'compose',
      verifiedBy: [],
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
    artifacts.set(task.target, {
      path: task.target,
      originType: 'slot',
      originId: task.id,
      sourceBlock: task.block,
      generatedByPass: task.status === 'generated' ? 'compose' : 'adapt',
      generatorTaskId: buildTaskGeneratorId(task.id),
      verifiedBy: [...task.provenanceHints.verifiedBy],
      overrideStatus: 'none'
    });
  }

  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  for (const entry of overrideManifest.overrides) {
    const existing = artifacts.get(entry.target);
    artifacts.set(entry.target, {
      path: entry.target,
      originType: 'override',
      originId: entry.id,
      sourceBlock: existing?.sourceBlock,
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
  if (!lock.generatedPaths.includes('provenance.json')) {
    lock.generatedPaths.push('provenance.json');
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  }

  const provenance = await buildProvenance(workspaceRoot, lock);
  await fs.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return provenance;
}
