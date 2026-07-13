import { writeJson, type CommitFence } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import { runPolicyGate } from './run-policy-gate.ts';

export async function writePolicySnapshot(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<PolicyReport> {
  const report = await runPolicyGate(workspaceRoot);
  const { policyReportPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(policyReportPath, report, commitFence);
  return report;
}
