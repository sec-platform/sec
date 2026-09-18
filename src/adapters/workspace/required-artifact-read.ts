import { getErrorCode } from '../../compiler/errors.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../runtime-state/physical/runtime/retained-file-read.ts';
import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';
import { parseReviewSummaryJson } from '../../assurance/verification/review/contract/summary.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { readJson } from '../filesystem/files.ts';

export async function readRequiredJson<T>(filePath: string, missingMessage: string): Promise<T> {
  try { return await readJson<T>(filePath); }
  catch (error) {
    if (getErrorCode(error) === 'ENOENT') throw new Error(missingMessage, { cause: error });
    throw error;
  }
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
