import path from 'node:path';
import type { LockFile } from '../../compiler/contract.ts';
import { getErrorCode } from '../../compiler/errors.ts';
import { isCiContractArtifactPath } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { readLockFile } from './lock.ts';
import { readJson } from '../filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../workspace-context.ts';

/** Read the unique matching contract declared by the canonical lock.
 * Path membership belongs to the artifact owner; meaning belongs to matches.
 * This adapter neither prints the result nor chooses a generated filename. */
export async function readGeneratedContract<T>(
  workspaceRoot: string,
  missingMessage: string,
  matches: (value: T) => boolean
): Promise<T> {
  const root = path.resolve(workspaceRoot);
  let lock: LockFile;
  try {
    lock = readLockFile(root);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') throw new Error(missingMessage, { cause: error });
    throw error;
  }
  // Resolve and deduplicate candidate paths before the first asynchronous read.
  // The existing path owner still decides where each artifact is located.
  const candidatePaths = new Set(lock.generatedPaths.filter(isCiContractArtifactPath)
    .map((artifactPath) => resolveWorkspaceArtifactPath(root, artifactPath)));
  const candidates: T[] = [];
  for (const absolutePath of candidatePaths) {
    let value: T;
    try { value = await readJson<T>(absolutePath); }
    catch (error) { if (getErrorCode(error) === 'ENOENT') continue; throw error; }
    if (matches(value)) {
      candidates.push(value);
      if (candidates.length > 1) throw new Error('Generated contract selection is ambiguous: more than one artifact matches');
    }
  }
  if (candidates.length !== 1) throw new Error(missingMessage);
  return candidates[0]!;
}
