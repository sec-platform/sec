import type { VerificationStatus } from '../verification/contract/types.ts';

export const ACCEPTANCE_COVERAGE_FORMAT_VERSION = '1' as const;

export interface AcceptanceCoverageEntry {
  id: string;
  declaredAcceptance: string[];
  coveredBy: string[];
  uncovered: boolean;
}

export interface AcceptanceCoverageReport {
  formatVersion: typeof ACCEPTANCE_COVERAGE_FORMAT_VERSION;
  status: VerificationStatus;
  acceptancePassed: string[];
  blocks: AcceptanceCoverageEntry[];
  uncoveredBlocks: string[];
}
