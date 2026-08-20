#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { compileWorkspace } from '../platform/orchestrator/pipeline-orchestrator.ts';
import { initWorkspace } from '../platform/orchestrator/workspace-orchestrator.ts';
import { compilerRoot } from '../platform/shared/paths.ts';

type ReferenceDemoMode = 'quickstart' | 'governance' | 'closed-loop';

function mode(value: unknown): ReferenceDemoMode {
  if (value === 'quickstart' || value === 'governance' || value === 'closed-loop') return value;
  throw new Error('Usage: bun scripts/run-reference-demo.ts <quickstart|governance|closed-loop>');
}

function runCli(workspaceRoot: string, args: readonly string[]): void {
  const result = spawnSync(process.execPath, [path.join(compilerRoot, 'platform', 'cli', 'index.ts'), ...args], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Reference demo CLI failed: sec ${args.join(' ')}`, { cause: result.error });
  }
}

export async function runReferenceDemo(selectedMode: ReferenceDemoMode): Promise<void> {
  const demoParent = path.join(compilerRoot, '.tmp');
  await mkdir(demoParent, { recursive: true });
  const workspaceRoot = await mkdtemp(path.join(demoParent, 'reference-demo-'));
  try {
    console.log(`Reference demo: isolated workspace ${workspaceRoot}`);
    await initWorkspace(workspaceRoot, { template: 'reference-customer' });
    await compileWorkspace(workspaceRoot, {
      source: 'reference',
      ...(selectedMode === 'closed-loop' ? {} : { through: 'adapt' as const })
    });
    if (selectedMode === 'governance' || selectedMode === 'closed-loop') {
      if (selectedMode === 'closed-loop') runCli(workspaceRoot, ['verify', '--lane', 'all']);
      runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'governance']);
    }
    if (selectedMode === 'closed-loop') {
      runCli(workspaceRoot, ['explain', '--json', '--compact']);
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) await runReferenceDemo(mode(process.argv[2]));
