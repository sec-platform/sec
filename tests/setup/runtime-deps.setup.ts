import { rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ensureTestDependencies } from '../../platform/dev-runner/dependency-bootstrap.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  acquireSecRuntimeCachePhysicalAuthorityV1,
  type SecRuntimeCachePhysicalAuthorityV1
} from '../../tooling/sec-dev/runtime-state-authority.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';

let testProcessTempAuthority: SecRuntimeCachePhysicalAuthorityV1 | null = null;

async function configureTestTempRoot(): Promise<void> {
  if (process.env.SEC_STATE_HOME === undefined || process.env.SEC_CACHE_HOME === undefined) {
    const hostTempRoot = path.resolve(tmpdir());
    const runtimeRoot = await fs.mkdtemp(path.join(hostTempRoot, 'sec-test-runtime-'));
    process.env.SEC_STATE_HOME ??= path.join(runtimeRoot, 'state');
    process.env.SEC_CACHE_HOME ??= path.join(runtimeRoot, 'cache');
    process.once('exit', () => {
      const resolved = path.resolve(runtimeRoot);
      if (path.dirname(resolved) === hostTempRoot && path.basename(resolved).startsWith('sec-test-runtime-')) {
        try { rmSync(resolved, { recursive: true, force: true }); } catch { /* best-effort exact temp cleanup */ }
      }
    });
  }
  const roots = resolveSecWorkspaceRuntimeRootsV1({
    repositoryRoot: compilerRoot,
    environment: process.env
  });
  const tempRoot = path.join(roots.cacheRoot, 'test-process-tmp');
  testProcessTempAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
    repositoryRoot: compilerRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [tempRoot]
  });
  testProcessTempAuthority.assertCurrent();
  process.env.TMPDIR = tempRoot;
  process.env.TMP = tempRoot;
  process.env.TEMP = tempRoot;
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
