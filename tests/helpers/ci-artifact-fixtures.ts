import { emptyCiArtifactMissingReasonCounts } from '../../platform/shared/ci-artifact-contract.ts';
import type {
  CiArtifactKind,
  CiArtifactMissingReason,
  CiArtifactUploadGroup
} from '../../platform/shared/ci-artifact-types.ts';

export function buildArtifactMissingReasonCounts(
  overrides: Partial<Record<CiArtifactMissingReason, number>> = {}
): Record<CiArtifactMissingReason, number> {
  return {
    ...emptyCiArtifactMissingReasonCounts(),
    ...overrides
  };
}

export function buildArtifactUploadGroup(
  kind: CiArtifactKind,
  count: number,
  paths: string[]
): CiArtifactUploadGroup {
  return { kind, count, paths };
}
