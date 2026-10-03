/** Closed native bootstrap artifact projections; these names grant no authority. */
export const HOSTED_BOOTSTRAP_ARTIFACT_MEMBERS = Object.freeze({
  'bootstrap-pre': Object.freeze(['checker.mjs', 'pre-receipt.json', 'SHA256SUMS']),
  'bootstrap-sut': Object.freeze(['tcb-lock-pre.json', 'imports.log', 'docs-doctor.log', 'typecheck.log',
    'diff-check.log', 'focused-tests.log', 'repository-audit.json', 'affected-plan.json', 'affected-tests.log',
    'tcb-lock-post.json', 'SHA256SUMS', 'sut-receipt.json', 'hosted-job-runtime-receipt.json'])
});
export type HostedBootstrapArtifactProjection = keyof typeof HOSTED_BOOTSTRAP_ARTIFACT_MEMBERS;

/** Content diagnosis only. It never authenticates a producer or suppresses owner settlement errors. */
export class HostedArtifactProjectionDataError extends Error {
  readonly status: 'unavailable' | 'invalid';
  constructor(status: 'unavailable' | 'invalid', message: string) {
    super(message); this.name = 'HostedArtifactProjectionDataError'; this.status = status;
  }
}
