#!/usr/bin/env bun

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  runReferenceDemo,
  type ReferenceDemoOperations
} from '../../application/reference-demo.ts';
import { runDevCommand } from '../../adapters/self-hosting/development/runner/command-runner.ts';
import { compilerCliEntrypoint } from '../../adapters/toolchain/runtime/layout.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import {
  announceReferenceDemoWorkspace,
  readReferenceDemoMode
} from '../../entry/reference-demo.ts';
import { compileWorkspace } from '../engineering/pipeline-orchestrator.ts';
import { initWorkspace } from '../engineering/workspace-orchestrator.ts';

async function runCli(workspaceRoot: string, args: readonly string[]): Promise<void> {
  const code = await runDevCommand('bun', [compilerCliEntrypoint, ...args], process.env, {
    auxiliaryOrdinaryFilePaths: [compilerCliEntrypoint],
    workingDirectory: workspaceRoot
  });
  if (code !== 0) {
    throw new Error(`Reference demo CLI failed: sec ${args.join(' ')} (exit ${code})`);
  }
}

const operations: ReferenceDemoOperations = Object.freeze({
  createWorkspace: async () => {
    const demoParent = path.join(compilerRoot, '.tmp');
    await mkdir(demoParent, { recursive: true });
    return mkdtemp(path.join(demoParent, 'reference-demo-'));
  },
  announceWorkspace: announceReferenceDemoWorkspace,
  initializeWorkspace: workspaceRoot =>
    initWorkspace(workspaceRoot, { template: 'reference-customer' }).then(() => undefined),
  compileWorkspace: async (workspaceRoot, through) => {
    await compileWorkspace(workspaceRoot, {
      source: 'reference',
      ...(through === 'compose' ? { through: 'compose' as const } : {})
    });
  },
  verifyAll: workspaceRoot => runCli(workspaceRoot, ['verify', '--lane', 'all']),
  listGovernanceArtifacts: workspaceRoot =>
    runCli(workspaceRoot, ['artifacts', '--paths', '--kind', 'governance']),
  explainCompactJson: workspaceRoot => runCli(workspaceRoot, ['explain', '--json', '--compact']),
  removeWorkspace: workspaceRoot => rm(workspaceRoot, { recursive: true, force: true })
});

if (import.meta.main) {
  await runReferenceDemo(readReferenceDemoMode(), operations);
}
