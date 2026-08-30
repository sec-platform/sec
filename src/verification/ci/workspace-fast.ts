import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspace } from '../../compiler/orchestration/block-orchestrator.ts';
import {
  adaptWorkspace,
  composeWorkspace
} from '../../compiler/orchestration/compose-orchestrator.ts';
import { verifyWorkspace } from '../../compiler/orchestration/verify-orchestrator.ts';
import { initWorkspace } from '../../compiler/orchestration/workspace-orchestrator.ts';
import { compilerRoot } from '../../workspace/paths.ts';

async function createCiWorkspaceFastRoot(): Promise<string> {
  const parent = path.join(compilerRoot, '.tmp');
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, 'ci-workspace-fast-'));
}

async function removeCiWorkspaceFastRoot(workspaceRoot: string): Promise<void> {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

export async function runCiWorkspaceFast(workspaceRoot?: string): Promise<number> {
  const ownedWorkspaceRoot = workspaceRoot ?? await createCiWorkspaceFastRoot();
  const shouldCleanup = workspaceRoot === undefined;

  if (workspaceRoot === undefined) {
    console.log('CI workspace fast: init explicit reference workspace');
    await initWorkspace(ownedWorkspaceRoot, {
      template: 'reference-customer'
    });
  }

  try {
    console.log('CI workspace fast: resolve graph');
    await resolveWorkspace(ownedWorkspaceRoot);

    console.log('CI workspace fast: compose project');
    await composeWorkspace(ownedWorkspaceRoot);

    console.log('CI workspace fast: adapt project');
    await adaptWorkspace(ownedWorkspaceRoot);

    console.log('CI workspace fast: verify fast lane');
    const { report } = await verifyWorkspace(ownedWorkspaceRoot, { lane: 'fast', emitTiming: false });
    console.log(JSON.stringify(report));

    if (report.summary.status !== 'passed') {
      console.error(`CI workspace fast failed: ${report.summary.status}`);
      return 1;
    }

    return 0;
  } finally {
    if (shouldCleanup) {
      await removeCiWorkspaceFastRoot(ownedWorkspaceRoot);
    }
  }
}

if (import.meta.main) {
  process.exitCode = await runCiWorkspaceFast();
}
