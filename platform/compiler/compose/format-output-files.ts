import path from 'node:path';
import prettier from 'prettier';
import { pathExists, readText, writeText } from '../../shared/fs.ts';
import { createConcurrencyLimit } from '../../shared/concurrency.ts';

export async function formatOutputFiles(projectRoot: string, filePaths: string[]): Promise<void> {
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
            await writeText(fullPath, formatted);
          }
        } catch (e) {
          // Ignore formatting errors for unsupported file types or syntax errors
        }
      })
    )
  );
}
