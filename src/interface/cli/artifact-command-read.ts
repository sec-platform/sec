import type { LockFile } from '../../compiler/contract.ts';
import { readLockFile } from '../../compiler/lock.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { parseRepairPlanJson, type RepairPlan } from '../../semantic/repair/contract/types.ts';
import { isCiContractArtifactPath } from '../../verification/ci-artifacts/contract/manifest.ts';
import { parseReviewSummaryJson } from '../../verification/review/contract/summary.ts';
import type { ReviewSummary } from '../../verification/review/contract/types.ts';
import { pathExists, readJson } from '../../workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace/runtime/paths.ts';
import { printJsonOrText } from './format-utils.ts';
import type { JsonOpts } from './command-options.ts';

export async function readRequiredJson<T>(filePath: string, missingMessage: string): Promise<T> {
  if (!(await pathExists(filePath))) throw new Error(missingMessage);
  return readJson<T>(filePath);
}

export function readRequiredReviewSummary(filePath: string, missingMessage: string): ReviewSummary {
  const bytes = readOptionalRetainedOrdinaryFile(filePath, 'Review summary');
  if (bytes === null) throw new Error(missingMessage);
  return parseReviewSummaryJson(decodeExactUtf8(bytes, 'Review summary'));
}

export function readRequiredRepairPlan(filePath: string, missingMessage: string): RepairPlan {
  const bytes = readOptionalRetainedOrdinaryFile(filePath, 'Repair plan');
  if (bytes === null) throw new Error(missingMessage);
  return parseRepairPlanJson(decodeExactUtf8(bytes, 'Repair plan'));
}

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
  let lock: LockFile;
  try {
    lock = readLockFile(workspaceRoot);
  } catch {
    throw new Error(missingMessage);
  }
  const candidatePaths = lock.generatedPaths.filter(isCiContractArtifactPath);
  const candidates: T[] = [];
  for (const artifactPath of candidatePaths) {
    const absolutePath = resolveWorkspaceArtifactPath(workspaceRoot, artifactPath);
    if (!(await pathExists(absolutePath))) continue;
    const value = await readJson<T>(absolutePath);
    if (matches(value)) candidates.push(value);
  }
  if (candidates.length !== 1) throw new Error(missingMessage);
  printJsonOrText(candidates[0]!, output, formatText);
}
