import path from 'node:path';

import prettier from 'prettier';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { portableLogicalPathCollisionKey } from '../../../contracts/logical-path.ts';
import { createTaskGroupEffectFence, mapTaskGroup } from '../../../execution/task-group.ts';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { publishExpectedCanonicalWorkspaceFile } from "../../filesystem/file-publication.ts";
import { type CommitFence } from "../../../contracts/commit-fence.ts";
import { isCanonicalWorkspaceArtifactPath, resolveWorkspaceArtifactPath } from "../../workspace-context.ts";
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import { CompilerError } from '../../../compiler/errors.ts';

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
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Formatter commit fence must be callable');
  throwIfNativeAborted(signal);
  const pathsByIdentity = new Map<string, string>();
  for (const relativePath of filePaths) {
    const identity = portableLogicalPathCollisionKey(relativePath, 'Generated formatter path');
    const previous = pathsByIdentity.get(identity);
    if (previous !== undefined && previous !== relativePath) {
      throw new CompilerError('COMPOSE-PATH-004',
        `Generated formatter paths alias one portable publication target: ${previous}, ${relativePath}`);
    }
    pathsByIdentity.set(identity, relativePath);
  }
  // Admit the entire target set before loading formatter configuration or
  // starting a write. Contents remain bounded by active workers, not all files.
  const candidates = [...pathsByIdentity.values()].filter(isFormattableGeneratedPath).sort().map(relativePath => {
    const fullPath = isCanonicalWorkspaceArtifactPath(relativePath)
      ? resolveWorkspaceArtifactPath(workspaceRoot, relativePath)
      : resolvePathInside(workspaceRoot, relativePath);
    if (!fullPath) throw new CompilerError('COMPOSE-PATH-004',
      `Generated formatter path "${relativePath}" is outside the native workspace layout`);
    return Object.freeze({ relativePath, fullPath });
  });
  if (candidates.length === 0) return;
  const resolveConfig = prettier.resolveConfig.bind(prettier);
  const format = prettier.format.bind(prettier);
  const config = Object.freeze({ ...((await resolveConfig(workspaceRoot)) ?? {}) });
  throwIfNativeAborted(signal);

  await mapTaskGroup(candidates, async ({ relativePath, fullPath }, _index, groupSignal) => {
    throwIfNativeAborted(groupSignal);
    const bytes = readOptionalRetainedOrdinaryFile(fullPath, `Generated formatter input ${relativePath}`);
    if (bytes === null) return;
    const content = decodeExactUtf8(bytes, `Generated formatter input ${relativePath}`);
    // Parse errors still fail composition. Already completed files are not
    // claimed rolled back, but no started writer outlives the returned failure.
    const formatted = await format(content, { ...config, filepath: fullPath });
    throwIfNativeAborted(groupSignal);
    if (typeof formatted !== 'string') throw new TypeError('Formatter did not return text');
    if (formatted !== content) {
      await publishExpectedCanonicalWorkspaceFile({
        workspaceRoot, targetPath: fullPath, expectedBytes: bytes,
        bytes: Buffer.from(formatted, 'utf8'), label: `Generated formatter output ${relativePath}`,
        commitFence: createTaskGroupEffectFence(groupSignal, commitFence)
      });
    }
  }, { concurrency: FORMAT_CONCURRENCY, signal });
}
