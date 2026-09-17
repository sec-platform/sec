import { readOptionalRetainedJson } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { validatePolicyReport } from '../../assurance/policies/report.ts';
import type { PolicyReport } from '../../semantics/policies/types.ts';

export function readOptionalPolicyReport(filePath: string, label = 'Policy report'): PolicyReport | null {
  const raw = readOptionalRetainedJson<unknown>(filePath, label);
  return raw === null ? null : validatePolicyReport(raw);
}
