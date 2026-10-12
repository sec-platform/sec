/** Closed native artifact projections; these names grant no authority. */
export const HOSTED_ARTIFACT_PROJECTION_MEMBERS = Object.freeze({
  'bootstrap-pre': Object.freeze(['checker.mjs', 'pre-receipt.json', 'SHA256SUMS']),
  'bootstrap-sut': Object.freeze(['tcb-lock-pre.json', 'imports.log', 'docs-doctor.log', 'typecheck.log',
    'diff-check.log', 'focused-tests.log', 'repository-audit.json', 'affected-plan.json', 'affected-tests.log',
    'tcb-lock-post.json', 'SHA256SUMS', 'sut-receipt.json', 'hosted-job-runtime-receipt.json']),
  'action-capability': Object.freeze(['hosted-job-runtime-receipt.json', 'hosted-sut-capability.json']),
  'action-raw': Object.freeze(['hosted-job-runtime-receipt.json', 'verification-action-raw-observation.json'])
});
export type HostedArtifactProjection = keyof typeof HOSTED_ARTIFACT_PROJECTION_MEMBERS;

/** Historical source archives have their own closed member grammar. Optional
 * provider digest is handled only by the source-archive native operation. */
export const HOSTED_SOURCE_ARTIFACT_PROJECTION_MEMBERS = Object.freeze({
  'session-terminal': Object.freeze(['verification-session-artifact.json']),
  'resume-dispatch-outcomes': Object.freeze(['verification-session-resume-dispatch-outcomes.json']),
  'action-parent-plan': Object.freeze(['verification-action-parent-dispatch-plan.json']),
  'action-start': Object.freeze(['verification-action-start-marker.json']),
  'action-terminal': Object.freeze(['verification-action-terminal-artifact.json']),
  'action-terminal-anchor': Object.freeze(['verification-action-terminal-status-anchor.json']),
  'action-resolution': Object.freeze(['verification-action-provider-envelope.json', 'hosted-action-resolution.json', 'hosted-envelope.json'])
});
export type HostedSourceArtifactProjection = keyof typeof HOSTED_SOURCE_ARTIFACT_PROJECTION_MEMBERS;

/** Content diagnosis only. It never authenticates a producer or suppresses owner settlement errors. */
export class HostedArtifactProjectionDataError extends Error {
  readonly status: 'unavailable' | 'invalid';
  constructor(status: 'unavailable' | 'invalid', message: string) {
    super(message); this.name = 'HostedArtifactProjectionDataError'; this.status = status;
  }
}
