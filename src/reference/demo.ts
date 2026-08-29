#!/usr/bin/env bun

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { compileWorkspace } from '../compiler/orchestration/pipeline-orchestrator.ts';
import { initWorkspace } from '../compiler/orchestration/workspace-orchestrator.ts';
import { runCommand } from '../runtime-state/physical/runtime/process.ts';
import { compilerRoot } from '../workspace/paths.ts';

type ReferenceDemoMode = 'quickstart' | 'governance' | 'closed-loop';

function mode(value: unknown): ReferenceDemoMode {
  if (value === 'quickstart' || value === 'governance' || value === 'closed-loop') return value;
  throw new Error('Usage: bun src/reference/demo.ts <quickstart|governance|closed-loop>');
}

async function runCli(workspaceRoot: string, args: readonly string[]): Promise<void> {
  const result = await runCommand(process.execPath, [path.join(compilerRoot, 'platform', 'cli', 'index.ts'), ...args], {
    cwd: workspaceRoot,
    env: process.env,
    maxStderrBytes: 8 * 1024 * 1024,
    maxStdoutBytes: 64 * 1024 * 1024,
    timeoutMs: 5 * 60 * 1000
  });
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  if (result.code !== 0) {
    throw new Error(`Reference demo CLI failed: sec ${args.join(' ')} (exit ${result.code})`);
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
      if (selectedMode === 'closed-loop') await runCli(workspaceRoot, ['verify', '--lane', 'all']);
      await runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'governance']);
    }
    if (selectedMode === 'closed-loop') {
      await runCli(workspaceRoot, ['explain', '--json', '--compact']);
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) await runReferenceDemo(mode(process.argv[2]));
