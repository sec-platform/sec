import { pathExists, readJson } from '../../shared/fs.ts';
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
  const policyReport = (await pathExists(policyReportPath))
    ? await readJson<PolicyReport>(policyReportPath)
    : null;
  const repairPlan = (await pathExists(repairPlanPath))
    ? await readJson<RepairPlan>(repairPlanPath)
    : null;
  const upgradePlan = (await pathExists(upgradePlanPath))
    ? await readJson<UpgradePlan>(upgradePlanPath)
    : null;
  const upgradeDiagnostics = (await pathExists(upgradeDiagnosticsPath))
    ? await readJson<UpgradeDiagnostics>(upgradeDiagnosticsPath)
    : null;

  return {
    policyReport,
    repairPlan,
    upgradePlan,
    upgradeDiagnostics
  };
}
