import { tmpdir } from 'node:os';

import { createTestProcessTempRootV1 } from '../../platform/dev-runner/test-process-temp.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';

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
  // 测试场景默认提升日志级别到 warn，减少 pino JSON 输出带来的 I/O 噪音和耗时；
  // 单测若需断言 logger 行为可显式覆盖 LOG_LEVEL。
  if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = 'warn';
  }
}

export default async function configureBunTestRuntime(): Promise<void> {
  // A Bun preload owns process-local isolation only. Dependency and browser
  // materialization belong to the explicit dev-runner capability plan.
  await configureTestTempRoot();
}

// Bun test compat: execute immediately
await configureBunTestRuntime();
