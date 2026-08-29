import { getWorkspacePaths } from './paths.ts';
import { readPipelineJournal } from '../../compiler/pipeline/journal.ts';
import { assertProjectBaseline, readProjectBaseline } from './project-baseline.ts';
import { checkProvenanceFallback } from '../application/project-integrity.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { parseUpgradePlanJson } from '../../change-management/upgrade/contract/types.ts';

function activeUpgradeImpactPaths(workspaceRoot: string): string[] {
  const journal = readPipelineJournal(workspaceRoot);
  const activeTransaction = journal.activeTransactionId
    ? journal.transactions.find((entry) => entry.id === journal.activeTransactionId)
    : undefined;
  if (!activeTransaction || activeTransaction.status !== 'running' || activeTransaction.source !== 'upgrade') {
    return [];
  }

  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const label = 'Active UpgradePlan write-boundary authorization';
  const bytes = readOptionalRetainedOrdinaryFile(upgradePlanPath, label);
  if (bytes === null) return [];

  const upgradePlan = parseUpgradePlanJson(decodeExactUtf8(bytes, label));
  return upgradePlan.status === 'planned' ? upgradePlan.impacts : [];
}

export async function checkProjectWriteBoundary(workspaceRoot: string): Promise<void> {
  const baseline = readProjectBaseline(workspaceRoot);
  if (!baseline) {
    await checkProvenanceFallback(workspaceRoot);
    return;
  }
  assertProjectBaseline(workspaceRoot, baseline, {
    allowedChangedPaths: activeUpgradeImpactPaths(workspaceRoot)
  });
}
