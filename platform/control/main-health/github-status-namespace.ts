import { createHash } from 'node:crypto';

import { CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1 } from './ci-verification-revision.ts';
import { encodeVerificationActionDataV2 } from './verification-action-contract.ts';

export const SEC_GITHUB_STATUS_NAMESPACE_POLICY_SCHEMA_V1 =
  'sec-github-status-namespace-policy-v1' as const;
export const SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1 =
  'sec/integration-authorization' as const;
export const SEC_VERIFICATION_ACTION_STATUS_PREFIX_V1 = 'sec/action/' as const;

export const SEC_GITHUB_STATUS_NAMESPACE_POLICY_V1 = Object.freeze({
  schema: SEC_GITHUB_STATUS_NAMESPACE_POLICY_SCHEMA_V1,
  app: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app,
  namespaces: Object.freeze({
    verificationAction: Object.freeze({
      prefix: SEC_VERIFICATION_ACTION_STATUS_PREFIX_V1,
      workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
      writerJobs: Object.freeze([
        'claim-verification-action',
        'assemble-verification-action-terminal'
      ] as const),
      authority: Object.freeze({
        requiredCheck: false as const,
        mergeAuthorization: false as const,
        actionKeyTombstone: true as const
      })
    }),
    integrationAuthorization: Object.freeze({
      context: SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1,
      workflowPath: '.github/workflows/sec-merge-gate.yml' as const,
      writerJobs: Object.freeze(['terminal-status'] as const),
      authority: Object.freeze({
        requiredCheck: true as const,
        mergeAuthorization: true as const,
        semanticSource: 'merge-gate-result-plus-main-authority-ruleset-receipt' as const
      })
    })
  }),
  separation: Object.freeze({
    enforcement: 'trusted-base-tcb-plus-job-scoped-github-token-permissions' as const,
    sameGitHubApp: true as const,
    terminalWriterMayMutateRepository: false as const,
    integrationEffectMayWriteStatuses: false as const,
    actionWritersMayUseTerminalContext: false as const
  })
});

export const SEC_GITHUB_STATUS_NAMESPACE_POLICY_DIGEST_V1 = `sha256:${createHash('sha256')
  .update(encodeVerificationActionDataV2(SEC_GITHUB_STATUS_NAMESPACE_POLICY_V1))
  .digest('hex')}` as const;
