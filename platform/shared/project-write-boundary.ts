import { isCanonicalPortableLogicalPathV1 } from './logical-path-identity.ts';
import { getWorkspacePaths } from './paths.ts';
import { readPipelineJournal } from './pipeline-journal.ts';
import { assertProjectBaseline, readProjectBaseline } from './project-baseline.ts';
import { checkProvenanceFallback } from './project-integrity.ts';
import { readOptionalRetainedJsonV1 } from './retained-file-read.ts';

function activeUpgradeImpacts(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Active UpgradePlan authorization must be one object');
  }
  const plan = value as Record<string, unknown>;
  if (plan.formatVersion !== '1') {
    throw new Error(`Active UpgradePlan authorization has unsupported formatVersion ${String(plan.formatVersion)}`);
  }
  if (plan.status !== 'planned') return [];
  if (!Array.isArray(plan.impacts)) {
    throw new Error('Active UpgradePlan authorization impacts must be an array');
  }

  const impacts: string[] = [];
  const seen = new Set<string>();
  for (const impact of plan.impacts) {
    if (typeof impact !== 'string' || !isCanonicalPortableLogicalPathV1(impact)) {
      throw new Error(`Active UpgradePlan authorization contains a non-canonical impact path: ${String(impact)}`);
    }
    if (seen.has(impact)) {
      throw new Error(`Active UpgradePlan authorization repeats impact path: ${impact}`);
    }
    seen.add(impact);
    impacts.push(impact);
  }
  return impacts;
}

function activeUpgradeImpactPaths(workspaceRoot: string): string[] {
  const journal = readPipelineJournal(workspaceRoot);
  const activeTransaction = journal.activeTransactionId
    ? journal.transactions.find((entry) => entry.id === journal.activeTransactionId)
    : undefined;
  if (!activeTransaction || activeTransaction.status !== 'running' || activeTransaction.source !== 'upgrade') {
    return [];
  }

  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const upgradePlan = readOptionalRetainedJsonV1<unknown>(
    upgradePlanPath,
    'Active UpgradePlan write-boundary authorization'
  );
  return upgradePlan === null ? [] : activeUpgradeImpacts(upgradePlan);
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
