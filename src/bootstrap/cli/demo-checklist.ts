import { buildDemoChecklist as buildApplicationDemoChecklist, createDemoChecklistPlan, type DemoChecklist } from '../../application/demo-checklist.ts';
import { pathExists } from '../../adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../adapters/workspace-context.ts';
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
  const presentArtifactPaths = new Set<string>();
  await Promise.all(plan.items.map(async (item) => {
    const absolutePath = resolveWorkspaceArtifactPath(workspaceRoot, item.artifactPath);
    if (await pathExists(absolutePath)) presentArtifactPaths.add(item.artifactPath);
  }));
  return buildApplicationDemoChecklist(plan, presentArtifactPaths);
}
