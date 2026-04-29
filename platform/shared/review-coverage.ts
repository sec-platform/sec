import type { VerificationStatus } from './verification-types.ts';

export interface ReviewCoverageTargetSummary {
  id: string;
  declaredAcceptanceCount: number;
  coveredByCount: number;
  declaredAcceptance: string[];
  coveredBy: string[];
}

export interface ReviewCoverageSummary {
  status: VerificationStatus;
  acceptancePassedCount: number;
  blockCount: number;
  slotCount: number;
  coveredBlockCount: number;
  coveredSlotCount: number;
  uncoveredBlockCount: number;
  uncoveredSlotCount: number;
  acceptancePassed: string[];
  uncoveredBlocks: string[];
  uncoveredSlots: string[];
  blockSummaries: ReviewCoverageTargetSummary[];
  slotSummaries: ReviewCoverageTargetSummary[];
}
