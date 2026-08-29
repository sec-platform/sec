import type { VerificationStatus } from '../../../verification/index.ts';

export interface AcceptanceItem {
  id: string;
  dependsOn?: string[];
  covers?: {
    blocks?: string[];
    slots?: string[];
  };
}

export interface AcceptanceCoverageEntry {
  id: string;
  declaredAcceptance: string[];
  coveredBy: string[];
  uncovered: boolean;
}

export interface AcceptanceCoverageReport {
  formatVersion: string;
  status: VerificationStatus;
  acceptancePassed: string[];
  blocks: AcceptanceCoverageEntry[];
  slots: AcceptanceCoverageEntry[];
  uncoveredBlocks: string[];
  uncoveredSlots: string[];
}
