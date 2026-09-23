import {
  CI_ARTIFACT_KINDS,
  isCiArtifactKind,
  type CiArtifactKind
} from '../assurance/verification/ci-artifacts/contract/types.ts';

const ARTIFACT_KIND_CHOICES = CI_ARTIFACT_KINDS;

export type ArtifactKindAdmission =
  | Readonly<{ accepted: true; kind: CiArtifactKind | undefined }>
  | Readonly<{ accepted: false; choices: readonly CiArtifactKind[] }>;

/** Application owns the artifact-kind vocabulary; entry owns CLI spelling and rejection presentation. */
export function admitArtifactKind(value: unknown): ArtifactKindAdmission {
  if (value === undefined) return Object.freeze({ accepted: true, kind: undefined });
  return isCiArtifactKind(value)
    ? Object.freeze({ accepted: true, kind: value })
    : Object.freeze({ accepted: false, choices: ARTIFACT_KIND_CHOICES });
}
