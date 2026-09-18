import path from 'node:path';
import type { LockFile } from '../../compiler/contract.ts';
import { getErrorCode } from '../../compiler/errors.ts';
import { readLockFile } from "../../adapters/workspace/lock.ts";
import { isCiContractArtifactPath } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { readJson } from "../../adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../adapters/workspace-context.ts";
import type { JsonOpts } from '../../entry/cli/command-options.ts';
import { printJsonOrText } from '../../entry/cli/format-utils.ts';
import { readRequiredJson } from '../../adapters/workspace/required-artifact-read.ts';

export async function printRequiredJson<T>(
  filePath: string, missingMessage: string, output: JsonOpts, formatText: (v: T) => string
): Promise<void> {
  const value = await readRequiredJson<T>(filePath, missingMessage);
  printJsonOrText(value, output, formatText);
}

export async function printWorkspaceJson<T>(
  cwd: string, selectPath: (workspaceRoot: string) => string,
  missingMessage: string, output: JsonOpts, formatText: (v: T) => string
): Promise<void> {
  await printRequiredJson<T>(selectPath(cwd), missingMessage, output, formatText);
}

/**
 * Dynamic generated contracts are enumerated by the graph lock. The CLI only
 * selects the contract by its decoded semantic payload; it never mirrors a
 * producer's generated filename or invents a second artifact path owner.
 */
export async function printGeneratedContract<T>(
  workspaceRoot: string,
  missingMessage: string,
  output: JsonOpts,
  formatText: (value: T) => string,
  matches: (value: T) => boolean
): Promise<void> {
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
  printJsonOrText(candidates[0]!, output, formatText);
}
