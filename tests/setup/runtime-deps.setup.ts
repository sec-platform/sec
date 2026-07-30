import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureTestDependencies } from '../../platform/dev-runner/dependency-bootstrap.ts';

const STALE_DIR_THRESHOLD = 500; // 超过此数量触发清理
const STALE_MTIME_MS = 30 * 60 * 1000; // 30 分钟未修改视为陈旧
const CLEANUP_TTL_MS = 5 * 60 * 1000; // 5 分钟内不重复清理

async function configureTestTempRoot(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const tempRoot = path.join(repoRoot, '.tmp', 'test-workspaces');
  await fs.mkdir(tempRoot, { recursive: true });
  process.env.TMPDIR = tempRoot;
  process.env.TMP = tempRoot;
  process.env.TEMP = tempRoot;
  // 测试场景默认提升日志级别到 warn，减少 pino JSON 输出带来的 I/O 噪音和耗时；
  // 单测若需断言 logger 行为可显式覆盖 LOG_LEVEL。
  if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = 'warn';
  }
  // cleanStaleWorkspaces is no longer called in preload to avoid every bun test
  // subprocess doing I/O scans. It is called once by runFastTests before spawning.
}

/**
 * 清理陈旧工作区与孤儿 staging，保留 .templates/ 模板缓存。
 * 使用 mkdir 锁串行化，避免并发 bun test 进程同时清理。
 * 触发条件：目录数超过 STALE_DIR_THRESHOLD，或存在孤儿 staging。
 * 使用 marker file 节流，5 分钟内不重复 readdir+stat 扫描。
 *
 * 注意：此函数不再在 preload 中调用（避免每个 bun test 子进程都做 I/O 扫描）。
 * 改为由 runFastTests 启动时单次调用。
 */
export async function cleanStaleWorkspaces(tempRoot: string): Promise<void> {
  const markerPath = path.join(tempRoot, '.last-cleanup');
  try {
    const markerStat = await fs.stat(markerPath);
    if (Date.now() - markerStat.mtimeMs < CLEANUP_TTL_MS) return;
  } catch {} // marker 不存在，继续清理

  const lockPath = path.join(tempRoot, '.cleanup-lock');
  try {
    await fs.mkdir(lockPath);
  } catch {
    return; // 其他进程正在清理，跳过
  }

  try {
    const entries = await fs.readdir(tempRoot, { withFileTypes: true });
    const staleDirs: string[] = [];
    let activeCount = 0;
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.templates' || entry.name === '.cleanup-lock') continue;
      activeCount++;
      const entryPath = path.join(tempRoot, entry.name);
      try {
        const stat = await fs.stat(entryPath);
        if (now - stat.mtimeMs > STALE_MTIME_MS) {
          staleDirs.push(entryPath);
        }
      } catch {}
    }

    // 同时清理孤儿 staging（模板创建失败留下的）
    const templatesDir = path.join(tempRoot, '.templates');
    try {
      const templateEntries = await fs.readdir(templatesDir, { withFileTypes: true });
      for (const entry of templateEntries) {
        if (entry.isDirectory() && entry.name.includes('.staging-')) {
          staleDirs.push(path.join(templatesDir, entry.name));
        }
      }
    } catch {}

    // 触发条件：陈旧目录数 > 0 且总目录数超阈值，或存在孤儿 staging
    const hasOrphanStaging = staleDirs.some((d) => d.includes('.staging-'));
    const shouldClean = staleDirs.length > 0 && (activeCount > STALE_DIR_THRESHOLD || hasOrphanStaging);

    if (shouldClean) {
      for (const dir of staleDirs) {
        try {
          await fs.rm(dir, { recursive: true, force: true });
        } catch {}
      }
    }

    try {
      await fs.writeFile(markerPath, String(Date.now()));
    } catch {}
  } finally {
    try {
      await fs.rm(lockPath, { recursive: true, force: true });
    } catch {}
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
