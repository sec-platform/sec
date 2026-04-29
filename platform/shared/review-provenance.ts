import type {
  OverrideStatus,
  ProvenanceOriginType
} from './provenance-types.ts';
import type { RegistryKind, RegistryLocation } from './registry-types.ts';

export interface ReviewProvenanceOriginSummary {
  originType: ProvenanceOriginType;
  count: number;
  paths: string[];
}

export interface ReviewProvenanceOverrideSummary {
  overrideStatus: OverrideStatus;
  count: number;
  paths: string[];
}

export interface ReviewProvenanceRegistrySummary {
  registrySourceId: string;
  registryKind?: RegistryKind;
  registryLocation?: RegistryLocation;
  count: number;
  paths: string[];
}

export interface ReviewProvenancePassSummary {
  pass: string;
  count: number;
  paths: string[];
}

export interface ReviewProvenanceSummary {
  artifactCount: number;
  verifiedArtifactCount: number;
  unverifiedArtifactCount: number;
  overrideArtifactCount: number;
  registryArtifactCount: number;
  generatedArtifactCount: number;
  generatedPassCount: number;
  originSummaryCount: number;
  originSummaries: ReviewProvenanceOriginSummary[];
  overrideSummaryCount: number;
  overrideSummaries: ReviewProvenanceOverrideSummary[];
  registrySummaryCount: number;
  registrySummaries: ReviewProvenanceRegistrySummary[];
  generatedPassSummaries: ReviewProvenancePassSummary[];
  unverifiedArtifacts: string[];
}
