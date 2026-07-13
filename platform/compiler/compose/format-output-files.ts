import path from 'node:path';
import prettier from 'prettier';
import { createConcurrencyLimit } from '../../shared/concurrency.ts';
import { pathExists, readText, writeText, type CommitFence } from '../../shared/fs.ts';
import { defaultLogger } from '../../shared/logger.ts';

export async function formatOutputFiles(
  projectRoot: string,
  filePaths: string[],
  commitFence?: CommitFence
): Promise<void> {
  const limit = createConcurrencyLimit(10);
  await Promise.all(
    filePaths.map((relPath) =>
      limit(async () => {
        const fullPath = path.join(projectRoot, relPath);
        if (!(await pathExists(fullPath))) {
          return;
        }
        try {
          const content = await readText(fullPath);
          const config = (await prettier.resolveConfig(fullPath)) || {};
          const formatted = await prettier.format(content, {
            ...config,
            filepath: fullPath
          });
          if (formatted !== content) {
            await writeText(fullPath, formatted, commitFence);
          }
        } catch (e) {
          // 格式化失败通常由不支持的文件类型或语法错误引起，跳过该文件即可；
          // 但仍记录 warn 以便排查意外失败（如 prettier 配置错误）。
          defaultLogger.warn('Prettier formatting skipped for file', { filePath: relPath, error: e });
        }
      })
    )
  );
}
