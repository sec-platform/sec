import {
  adaptWorkspace,
  composeWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';
import { warmupDependencyEnvironment } from '../platform/shared/dependency-environment.ts';

export async function runCiFastGate(workspaceRoot = process.cwd()): Promise<number> {
  console.log('CI fast gate: warm runtime dependencies');
  await warmupDependencyEnvironment(workspaceRoot);

  console.log('CI fast gate: resolve graph');
  await resolveWorkspace(workspaceRoot);

  console.log('CI fast gate: compose project');
  await composeWorkspace(workspaceRoot);

  console.log('CI fast gate: adapt project');
  await adaptWorkspace(workspaceRoot);

  console.log('CI fast gate: verify fast lane');
  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast', emitTiming: false });
  console.log(JSON.stringify(report));

  if (report.summary.status !== 'passed') {
    console.error(`CI fast gate failed: ${report.summary.status}`);
    return 1;
  }

  return 0;
}

if (import.meta.main) {
  process.exitCode = await runCiFastGate();
}
