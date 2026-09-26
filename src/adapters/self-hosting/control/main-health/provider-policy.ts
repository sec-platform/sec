
import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { CI_COMPILER_WORKFLOW_RUN_IDENTITY, CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../verification/platform/action/contract/provider.ts';
import { DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY } from './contract.ts';

const CI_MAIN_HEALTH_REQUEST_SCHEMA = 'sec-produce-main-health-request-v1' as const;

export function createCiMainHealthRequestOperationId(mainSha: string): `sha256:${string}` {
  if (!/^[0-9a-f]{40}$/u.test(mainSha)) {
    throw new Error('MainHealth request operation identity requires an exact lowercase main SHA.');
  }
  return `sha256:${rawSha256Hex(JSON.stringify({
    schema: CI_MAIN_HEALTH_REQUEST_SCHEMA,
    mainSha
  }))}`;
}

/** The only exact-main health producer accepted by the ordinary Session lane. */
export const CI_MAIN_HEALTH_POLICY = Object.freeze({
  schema: 'sec-ci-main-health-policy-v6' as const,
  policyRevision: 'sec-ci-main-health-policy-v6' as const,
  context: 'sec/main-health' as const,
  app: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app,
  producer: Object.freeze({
    identity: DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY,
    sourceTransport: 'github-api' as const,
    workflowPath: CI_COMPILER_WORKFLOW_RUN_IDENTITY.workflowPath,
    workflowRefFormat: '.github/workflows/compiler-pr-validation.yml@<exact-main-sha>' as const,
    eventNames: Object.freeze(['repository_dispatch'] as const),
    runTitleFormats: Object.freeze({
      repositoryDispatch: 'SEC main health <exact-main-sha> operation <request-operation-id>' as const,
      requestOperationId: 'sha256:<64-lowercase-hex>' as const,
      requestSchema: CI_MAIN_HEALTH_REQUEST_SCHEMA,
      requestOperationIdentity: 'sha256-json-exact-main-v1' as const
    }),
    branch: 'main' as const
  }),
  terminal: Object.freeze({
    status: 'completed' as const,
    conclusion: 'success' as const,
    recognizedConclusions: Object.freeze([
      'success', 'failure', 'cancelled', 'skipped', 'timed_out',
      'action_required', 'neutral', 'stale', 'startup_failure'
    ] as const)
  }),
  convergence: Object.freeze({
    eventCardinality: 'at-most-one-per-allowed-event' as const,
    terminalOutcomeIdentity: 'status-conclusion' as const,
    failureFingerprintIdentity: 'policy-context-head-status-conclusion' as const,
    sourceDigestIdentity: 'policy-and-canonical-matching-subset' as const,
    ambiguousDisposition: 'locked' as const
  }),
  degraded: Object.freeze({
    owner: 'ci-verification-maintainer' as const,
    repairIdentityPolicy: 'exact-main-tree-failure-v1' as const,
    allowedLanes: Object.freeze(['repair'] as const)
  }),
  locked: Object.freeze({ allowedLanes: Object.freeze([] as const) })
});

export const CI_MAIN_HEALTH_POLICY_DIGEST = `sha256:${rawSha256Hex(JSON.stringify(CI_MAIN_HEALTH_POLICY))}` as const;
