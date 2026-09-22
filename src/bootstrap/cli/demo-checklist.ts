import { buildDemoChecklist as buildApplicationDemoChecklist, createDemoChecklistPlan, type DemoChecklist } from '../../application/demo-checklist.ts';
import { findPresentWorkspaceArtifacts } from '../../adapters/workspace/artifact-presence.ts';
import { platformCommand } from '../../adapters/verification/platform/sec-command.ts';

export async function buildDemoChecklist(workspaceRoot: string): Promise<DemoChecklist> {
  const plan = createDemoChecklistPlan({
    verifyAll: platformCommand('verify', '--lane', 'all'),
    verify: platformCommand('verify'),
    lock: platformCommand('lock'),
    compose: platformCommand('compose'),
    explain: platformCommand('explain'),
    passedNext: 'bun run demo:closed-loop',
    missingNext: 'bun run demo:quickstart'
  });
  const presentArtifactPaths = await findPresentWorkspaceArtifacts(
    workspaceRoot,
    plan.items.map(item => item.artifactPath)
  );
  return buildApplicationDemoChecklist(plan, presentArtifactPaths);
}
