import path from 'node:path';

import { getWorkspacePaths } from '../../shared/paths.ts';
import {
  readOptionalPolicyReportV1,
  validatePolicyReportV1
} from '../../shared/policy-report-authority.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import {
  readOptionalRetainedJsonLeafV1,
  retainOptionalDirectoryV1
} from '../../shared/retained-file-read.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../shared/upgrade-types.ts';

export interface ReviewGovernanceReports {
  policyReport: PolicyReport | null;
  repairPlan: RepairPlan | null;
  upgradePlan: UpgradePlan | null;
  upgradeDiagnostics: UpgradeDiagnostics | null;
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

  const workflowParent = retainOptionalDirectoryV1(workflowRoot, 'Review governance workflow parent');
  return {
    policyReport: policySnapshot === undefined
      ? readOptionalPolicyReportV1(policyReportPath, 'Review Policy report')
      : validatePolicyReportV1(policySnapshot),
    repairPlan: workflowParent === null
      ? null
      : readOptionalRetainedJsonLeafV1<RepairPlan>(
          workflowParent,
          path.basename(repairPlanPath),
          'Review Repair plan'
        ),
    upgradePlan: workflowParent === null
      ? null
      : readOptionalRetainedJsonLeafV1<UpgradePlan>(
          workflowParent,
          path.basename(upgradePlanPath),
          'Review Upgrade plan'
        ),
    upgradeDiagnostics: workflowParent === null
      ? null
      : readOptionalRetainedJsonLeafV1<UpgradeDiagnostics>(
          workflowParent,
          path.basename(upgradeDiagnosticsPath),
          'Review Upgrade diagnostics'
        )
  };
}
