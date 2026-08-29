import path from 'node:path';

import { getWorkspacePaths } from '../../workspace/paths.ts';
import { readOptionalPolicyReport, validatePolicyReport } from '../policies/runtime/report-authority.ts';
import type { PolicyReport } from '../policies/contract/types.ts';
import { parseRepairPlanJson, type RepairPlan } from '../../semantic/repair/contract/types.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryLeaf, retainOptionalDirectory } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { parseUpgradeDiagnosticsJson, parseUpgradePlanJson, type UpgradeDiagnostics, type UpgradePlan } from '../../change-management/upgrade/contract/types.ts';

export interface ReviewGovernanceReports {
  policyReport: PolicyReport | null;
  repairPlan: RepairPlan | null;
  upgradePlan: UpgradePlan | null;
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
  const { policyReportPath, repairPlanPath, upgradeDiagnosticsPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const workflowRoot = path.dirname(repairPlanPath);
  if (
    path.dirname(upgradePlanPath) !== workflowRoot ||
    path.dirname(upgradeDiagnosticsPath) !== workflowRoot
  ) {
    throw new Error('Review governance workflow artifacts must share one canonical parent');
  }

  const workflowParent = retainOptionalDirectory(workflowRoot, 'Review governance workflow parent');
  return {
    policyReport: policySnapshot === undefined
      ? readOptionalPolicyReport(policyReportPath, 'Review Policy report')
      : validatePolicyReport(policySnapshot),
    repairPlan: workflowParent === null
      ? null
      : readOptionalCanonicalJson(
          workflowParent,
          path.basename(repairPlanPath),
          'Review Repair plan',
          parseRepairPlanJson
        ),
    upgradePlan: workflowParent === null
      ? null
      : readOptionalCanonicalJson(
          workflowParent,
          path.basename(upgradePlanPath),
          'Review Upgrade plan',
          parseUpgradePlanJson
        ),
    upgradeDiagnostics: workflowParent === null
      ? null
      : readOptionalCanonicalJson(
          workflowParent,
          path.basename(upgradeDiagnosticsPath),
          'Review Upgrade diagnostics',
          parseUpgradeDiagnosticsJson
        )
  };
}
