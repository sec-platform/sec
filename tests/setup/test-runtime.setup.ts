import { tmpdir } from 'node:os';

import { prepareTestInvocationRuntime } from '../../src/development/runner/test-process-temp.ts';
import { compilerRoot } from '../../src/workspace/runtime/paths.ts';

declare const afterAll: (callback: () => void | Promise<void>) => void;

async function configureTestTempRoot(): Promise<void> {
  const invocationRuntime = await prepareTestInvocationRuntime({
    repositoryRoot: compilerRoot,
    hostTempRoot: tmpdir(),
    environment: process.env
  });
  // bunfig preloads this module only for `bun test`, whose ambient lifecycle
  // owns final settlement without adding bun:test to the TCB import closure.
  afterAll(invocationRuntime.cleanup);
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'warn';
}

export default async function configureBunTestRuntime(): Promise<void> {
  // Preload owns process-local isolation only. Dependency materialization
  // belongs to explicit dev-runner capability demand.
  await configureTestTempRoot();
}

await configureBunTestRuntime();
