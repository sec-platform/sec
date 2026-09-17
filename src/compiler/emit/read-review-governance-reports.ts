import path from 'node:path';

import type { UpgradeDiagnostics, UpgradeExecutionTerminal, UpgradePlan } from '../../change-management/upgrade/contract/upgrade-artifact.ts';
import { readUpgradeArtifactSet } from '../../change-management/upgrade/runtime/artifact-readback.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryLeaf, retainOptionalDirectory } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace/runtime/paths.ts';
import type { PolicyReport } from '../policies/contract/types.ts';
import { readOptionalPolicyReport, validatePolicyReport } from '../policies/runtime/report-authority.ts';

export interface ReviewGovernanceReports {
  policyReport: PolicyReport | null;
  repairPlan: RepairPlan | null;
  upgradePlan: UpgradePlan | null;
  upgradeExecutionTerminal: UpgradeExecutionTerminal | null;
  upgradeDiagnostics: UpgradeDiagnostics | null;
}

function readOptionalCanonicalJson<T>(
  workflowParent: NonNullable<ReturnType<typeof retainOptionalDirectory>>,
  name: string,
  label: string,
  parse: (source: string) => T
): T | null {
  const bytes = readOptionalRetainedOrdinaryLeaf(workflowParent, name);
  return bytes === null ? null : parse(decodeExactUtf8(bytes, label));
}

/**
 * Reads optional Review workflow state. A caller that already owns one
 * canonical Policy snapshot may bind it here to avoid reopening policy-report;
 * the snapshot is revalidated, while Repair/Upgrade remain independently
 * retained under their shared workflow parent.
 */
export function readReviewGovernanceReports(
  workspaceRoot: string,
  policySnapshot?: PolicyReport
): ReviewGovernanceReports {
  const policyReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
  const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
  const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeDiagnostics);
  const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
  const upgradeExecutionTerminalPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeExecutionTerminal
  );
  const workflowRoot = path.dirname(repairPlanPath);
  if (
    path.dirname(upgradePlanPath) !== workflowRoot ||
    path.dirname(upgradeExecutionTerminalPath) !== workflowRoot ||
    path.dirname(upgradeDiagnosticsPath) !== workflowRoot
  ) {
    throw new Error('Review governance workflow artifacts must share one canonical parent');
  }

  const workflowParent = retainOptionalDirectory(workflowRoot, 'Review governance workflow parent');
  const policyReport = policySnapshot === undefined
    ? readOptionalPolicyReport(policyReportPath, 'Review Policy report')
    : validatePolicyReport(policySnapshot);
  const repairPlan = workflowParent === null
    ? null
    : readOptionalCanonicalJson(
        workflowParent,
        path.basename(repairPlanPath),
        'Review Repair plan',
        parseRepairPlanJson
      );
  const upgradeArtifacts = readUpgradeArtifactSet(workspaceRoot);
  return {
    policyReport,
    repairPlan,
    upgradePlan: upgradeArtifacts.plan,
    upgradeExecutionTerminal: upgradeArtifacts.executionTerminal,
    upgradeDiagnostics: upgradeArtifacts.diagnostics
  };
}
