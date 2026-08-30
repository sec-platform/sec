import { tmpdir } from 'node:os';

import { createTestProcessTempRootV1 } from '../../src/development/runner/test-process-temp.ts';
import { compilerRoot } from '../../src/workspace/paths.ts';

declare const afterAll: (callback: () => void) => void;

async function configureTestTempRoot(): Promise<void> {
  const processTemp = await createTestProcessTempRootV1({
    repositoryRoot: compilerRoot,
    hostTempRoot: tmpdir(),
    environment: process.env
  });
  // bunfig preloads this module only for `bun test`, whose ambient lifecycle
  // owns final settlement without adding bun:test to the TCB import closure.
  afterAll(processTemp.cleanup);
  process.once('exit', processTemp.cleanup);
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'warn';
}

export default async function configureBunTestRuntime(): Promise<void> {
  // Preload owns process-local isolation only. Dependency materialization
  // belongs to explicit dev-runner capability demand.
  await configureTestTempRoot();
}

await configureBunTestRuntime();
