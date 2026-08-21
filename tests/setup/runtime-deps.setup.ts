import { tmpdir } from 'node:os';

import { ensureTestDependencies } from '../../platform/dev-runner/dependency-bootstrap.ts';
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

export default async function prewarmSharedRuntimeDeps(): Promise<void> {
  if (process.env.SEC_SKIP_RUNTIME_DEPS_SETUP !== '1') {
    const dependencies = await ensureTestDependencies();
    process.env.PLAYWRIGHT_BROWSERS_PATH = dependencies.browserCachePath;
  }
  await configureTestTempRoot();
}

// Bun test compat: execute immediately
await prewarmSharedRuntimeDeps();
