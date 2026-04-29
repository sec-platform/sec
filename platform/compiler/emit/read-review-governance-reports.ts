import { readOptionalJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../shared/upgrade-types.ts';

export interface ReviewGovernanceReports {
  policyReport: PolicyReport | null;
  repairPlan: RepairPlan | null;
  upgradePlan: UpgradePlan | null;
  upgradeDiagnostics: UpgradeDiagnostics | null;
}

export async function readReviewGovernanceReports(workspaceRoot: string): Promise<ReviewGovernanceReports> {
  const { policyReportPath, repairPlanPath, upgradeDiagnosticsPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const policyReport = await readOptionalJson<PolicyReport>(policyReportPath);
  const repairPlan = await readOptionalJson<RepairPlan>(repairPlanPath);
  const upgradePlan = await readOptionalJson<UpgradePlan>(upgradePlanPath);
  const upgradeDiagnostics = await readOptionalJson<UpgradeDiagnostics>(upgradeDiagnosticsPath);

  return {
    policyReport,
    repairPlan,
    upgradePlan,
    upgradeDiagnostics
  };
}
