import fs from 'node:fs/promises';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { LockFile, ProvenanceArtifact, ProvenanceFile } from '../../shared/types.ts';

function buildTaskGeneratorId(taskId: string): string {
  return `fill_slot_${taskId}`;
}

function inferGeneratedByPass(targetPath: string): string {
  if (targetPath === 'provenance.json') {
    return 'lock';
  }
  if (targetPath === 'generated/explain-graph.json') {
    return 'explain';
  }
  if (targetPath === 'generated/repair-plan.json') {
    return 'repair';
  }
  return 'compose';
}

export function buildProvenance(lock: LockFile): ProvenanceFile {
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

  const provenance = buildProvenance(lock);
  await fs.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return provenance;
}
