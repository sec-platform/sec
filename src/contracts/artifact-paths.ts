/** Shared logical artifact path identities; no host resolution or publication authority. */
export const CI_ARTIFACT_ROOT_RELATIVE_PATH = '.sec/artifacts' as const;

export const graphLockArtifactRelativePath = `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/state/graph.lock.json` as const;

export const verificationReportArtifactRelativePath = `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/verification-report.json` as const;
