import path from 'node:path';

import prettier from 'prettier';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { portableLogicalPathCollisionKey } from '../../system-architecture/foundation/contract/logical-path.ts';
import { runTaskGroup } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { throwIfNativeAborted } from '../../system-architecture/foundation/runtime/native-abort.ts';
import { publishExpectedCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
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
  filePaths: readonly string[],
  commitFence?: CommitFence,
  signal?: AbortSignal
): Promise<void> {
  workspaceRoot = path.resolve(workspaceRoot);
  throwIfNativeAborted(signal);
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Formatter commit fence must be callable');
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
  // Complete path admission before loading a formatter or starting any write.
  const candidates = [...pathsByIdentity.values()].filter(isFormattableGeneratedPath).sort().map(relativePath => {
    const fullPath = isCanonicalWorkspaceArtifactPath(relativePath)
      ? resolveWorkspaceArtifactPath(workspaceRoot, relativePath)
      : resolvePathInside(workspaceRoot, relativePath);
    if (!fullPath) throw new CompilerError('COMPOSE-PATH-004',
      `Generated formatter path "${relativePath}" is outside the native workspace layout`);
    return { relativePath, fullPath };
  });
  if (candidates.length === 0) return;
  const config = { ...((await prettier.resolveConfig(workspaceRoot)) ?? {}) };
  throwIfNativeAborted(signal);
  // Joining is required even when a provider ignores cancellation. A failed
  // formatting batch cannot return into rollback with writes still in flight.
  await runTaskGroup(candidates.map(({ relativePath, fullPath }) => async (childSignal: AbortSignal) => {
    const bytes = readOptionalRetainedOrdinaryFile(fullPath, `Generated formatter input ${relativePath}`);
    if (bytes === null) return;
    const content = decodeExactUtf8(bytes, `Generated formatter input ${relativePath}`);
    const formatted = await prettier.format(content, { ...config, filepath: fullPath });
    throwIfNativeAborted(childSignal);
    if (formatted !== content) {
      await publishExpectedCanonicalWorkspaceFile({
        workspaceRoot, targetPath: fullPath, expectedBytes: bytes, bytes: Buffer.from(formatted, 'utf8'),
        label: `Generated formatter output ${relativePath}`,
        commitFence: async () => {
        throwIfNativeAborted(childSignal);
        await commitFence?.();
        throwIfNativeAborted(childSignal);
        }
      });
    }
  }), { concurrency: FORMAT_CONCURRENCY, signal });
}
