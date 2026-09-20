import { readOptionalRetainedJson } from '../../../../runtime-state/physical/runtime/retained-file-read.ts';
import type { AcceptanceCoverageReport } from '../../../../../assurance/acceptance/coverage.ts';
import { validateAcceptanceCoverageReport } from '../../../../../assurance/verification/acceptance/validation.ts';


export function readOptionalAcceptanceCoverageReport(
  filePath: string,
  label = 'Acceptance Coverage report'
): AcceptanceCoverageReport | null {
  const raw = readOptionalRetainedJson<unknown>(filePath, label);
  return raw === null ? null : validateAcceptanceCoverageReport(raw);
}
