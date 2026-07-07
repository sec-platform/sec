import { readOptionalJson } from './fs.ts';
import { getWorkspacePaths } from './paths.ts';
import { assertProjectBaseline, readProjectBaseline } from './project-baseline.ts';
import { checkProvenanceFallback } from './project-integrity.ts';
import { readPipelineJournal } from './pipeline-journal.ts';
import type { UpgradePlan } from './upgrade-types.ts';

async function activeUpgradeImpactPaths(workspaceRoot: string): Promise<string[]> {
  const journal = await readPipelineJournal(workspaceRoot);
  const activeTransaction = journal.activeTransactionId
    ? journal.transactions.find((entry) => entry.id === journal.activeTransactionId)
    : undefined;
  if (!activeTransaction || activeTransaction.status !== 'running' || activeTransaction.source !== 'upgrade') {
    return [];
  }

  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const upgradePlan = await readOptionalJson<UpgradePlan>(upgradePlanPath);
  return upgradePlan?.status === 'planned' ? upgradePlan.impacts : [];
}

export async function checkProjectWriteBoundary(workspaceRoot: string): Promise<void> {
  const baseline = await readProjectBaseline(workspaceRoot);
  if (!baseline) {
    await checkProvenanceFallback(workspaceRoot);
    return;
  }
  await assertProjectBaseline(workspaceRoot, baseline, {
    allowedChangedPaths: await activeUpgradeImpactPaths(workspaceRoot)
  });
}
