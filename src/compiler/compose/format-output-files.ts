import path from 'node:path';

import prettier from 'prettier';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { portableLogicalPathCollisionKey } from '../../system-architecture/foundation/contract/logical-path.ts';
import { createConcurrencyLimit } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { writeText, type CommitFence } from '../../workspace/files.ts';
import {
  isCanonicalWorkspaceArtifactPath,
  resolvePathInside,
  resolveWorkspaceArtifactPath
} from '../../workspace/runtime/paths.ts';
import { CompilerError } from '../errors.ts';

const FORMATTABLE_EXTENSIONS = new Set([
  '.css', '.gql', '.graphql', '.html', '.js', '.jsx', '.json', '.jsonc',
  '.less', '.md', '.mdx', '.scss', '.ts', '.tsx', '.yaml', '.yml'
]);
const FORMAT_CONCURRENCY = 10;

function isFormattableGeneratedPath(relativePath: string): boolean {
  return FORMATTABLE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

export async function formatOutputFiles(
  workspaceRoot: string,
  filePaths: string[],
  commitFence?: CommitFence
): Promise<void> {
  // Formatter operations are independent only after the generated path set is
  // deduplicated. Prettier CPU work still runs on the JS runtime; this bounded
  // fanout primarily overlaps provider loading and distinct-file write I/O.
  const pathsByIdentity = new Map<string, string>();
  for (const relativePath of filePaths) {
    const identity = portableLogicalPathCollisionKey(relativePath, 'Generated formatter path');
    const previous = pathsByIdentity.get(identity);
    if (previous !== undefined && previous !== relativePath) {
      throw new CompilerError(
        'COMPOSE-PATH-004',
        `Generated formatter paths alias one portable publication target: ${previous}, ${relativePath}`
      );
    }
    pathsByIdentity.set(identity, relativePath);
  }
  const candidates = [...pathsByIdentity.values()]
    .filter(isFormattableGeneratedPath)
    .sort();
  if (candidates.length === 0) return;

  const limit = createConcurrencyLimit(FORMAT_CONCURRENCY);
  const config = (await prettier.resolveConfig(workspaceRoot)) ?? {};

  await Promise.all(
    candidates.map((relativePath) =>
      limit(async () => {
        const fullPath = isCanonicalWorkspaceArtifactPath(relativePath)
          ? resolveWorkspaceArtifactPath(workspaceRoot, relativePath)
          : resolvePathInside(workspaceRoot, relativePath);
        if (!fullPath) {
          throw new CompilerError(
            'COMPOSE-PATH-004',
            `Generated formatter path "${relativePath}" is outside the native workspace layout`
          );
        }
        const bytes = readOptionalRetainedOrdinaryFile(
          fullPath,
          `Generated formatter input ${relativePath}`
        );
        if (bytes === null) return;
        const content = decodeExactUtf8(bytes, `Generated formatter input ${relativePath}`);
        // A supported generated text file that Prettier cannot parse is not a
        // cosmetic warning: it is evidence that Compose produced invalid or
        // provider-incompatible output and must block publication truth.
        const formatted = await prettier.format(content, {
          ...config,
          filepath: fullPath
        });
        if (formatted !== content) {
          await writeText(fullPath, formatted, commitFence);
        }
      })
    )
  );
}
