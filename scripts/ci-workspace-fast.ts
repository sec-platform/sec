import {
  adaptWorkspace,
  composeWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';

export async function runCiWorkspaceFast(workspaceRoot = process.cwd()): Promise<number> {
  console.log('CI workspace fast: resolve graph');
  await resolveWorkspace(workspaceRoot);

  console.log('CI workspace fast: compose project');
  await composeWorkspace(workspaceRoot);

  console.log('CI workspace fast: adapt project');
  await adaptWorkspace(workspaceRoot);

  console.log('CI workspace fast: verify fast lane');
  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast', emitTiming: false });
  console.log(JSON.stringify(report));

  if (report.summary.status !== 'passed') {
    console.error(`CI workspace fast failed: ${report.summary.status}`);
    return 1;
  }

  return 0;
}

if (import.meta.main) {
  process.exitCode = await runCiWorkspaceFast();
}
