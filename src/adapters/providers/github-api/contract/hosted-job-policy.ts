import { parseYamlValue } from '../../../formats/yaml.ts';

import { canonicalEquals, deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../linux-verification/contract.ts';
import { HOSTED_OWNED_ENTRY_RECIPES } from './hosted-owned-entry-recipes.ts';
import { HOSTED_RESUME_DISPATCH_EVENT } from './hosted-resume-dispatch.ts';

/** A closed source policy, never evidence that a workflow or runner satisfies it. */
export const CI_VERIFICATION_PER_JOB_HOSTED_POLICY_REVISION =
  'sec-ci-verification-per-job-hosted-policy-v1' as const;
export const CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_REVISION =
  'sec-ci-verification-hosted-job-launcher-v1' as const;
export const CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_PATH =
  'src/bootstrap/development/hosted-job-runtime.ts' as const;

const COMPILER = '.github/workflows/compiler-pr-validation.yml' as const;
const MERGE = '.github/workflows/merge-gate.yml' as const;
const BOOTSTRAP = '.github/workflows/trusted-bootstrap.yml' as const;
const RELEASE = '.github/workflows/compiler-release-validation.yml' as const;

type HostedWorkflowPath = typeof COMPILER | typeof MERGE | typeof BOOTSTRAP | typeof RELEASE;

/** Exact reviewed API-only programs, including their job conditions, outputs,
 * steps, script bytes and explicit permissions. Only allocation changes from
 * their historical source. These are policy inputs, never source-supplied hashes. */
const API_ONLY_JOB_SOURCE_DIGESTS: Readonly<Record<string, `sha256:${string}`>> = Object.freeze({
  'validate-hosted-request': 'sha256:911502f8995b79933932f8114c3f0f68d29bcb26f02fdc3e0604731074da7f16',
  'validate-agent-operation-activation-request': 'sha256:69d50d5e82ffe2ab9089089a9b56f16fe4057d5a2a2ba05953d30882163ea681',
  plan: 'sha256:a70899c7d07a73a06a62361e49db337fd3ad665ba02796399a5b174defaf28e3',
  'terminal-status': 'sha256:e8161177eb11b6f2549fd997548a8390662491e45813628f8565697a3ce125f8',
  resolve: 'sha256:a231db61b0c1dfe5e6c96d3f9019700d3e06302f2965d36fee35a11e85ffe98b'
});
const WORKFLOW_PERMISSIONS = Object.freeze({
  [COMPILER]: Object.freeze({ actions: 'read', contents: 'read', 'pull-requests': 'read' }),
  [MERGE]: Object.freeze({ actions: 'read', contents: 'read' }),
  [BOOTSTRAP]: Object.freeze({ contents: 'read', 'pull-requests': 'read' }),
  [RELEASE]: Object.freeze({ contents: 'read' })
});
type HostedJobRole = 'control' | 'trusted' | 'sut';
type HostedJobTrigger = Readonly<{
  eventName: 'repository_dispatch';
  actions: readonly string[];
}> | Readonly<{
  eventName: 'workflow_run';
  actions: readonly ['completed'];
  sourceWorkflowPath: typeof COMPILER;
}>;

const SESSION = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze(['sec-verify-session-v2']) });
const SESSION_RESUME = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze([HOSTED_RESUME_DISPATCH_EVENT]) });
const ACTION = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze(['sec-produce-verification-action-v2']) });
const ACTIVATION = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze(['sec-produce-agent-operation-activation-v1']) });
const MAIN_HEALTH = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze(['sec-produce-main-health-v1']) });
const COMPILER_REQUEST = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze([...SESSION.actions, ...ACTION.actions]) });
const BOOTSTRAP_REQUEST = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze(['sec-trusted-bootstrap-v1']) });
const RELEASE_REQUEST = Object.freeze({ eventName: 'repository_dispatch' as const,
  actions: Object.freeze(['sec-verify-release-main-v1']) });
const COMPILER_COMPLETION = Object.freeze({ eventName: 'workflow_run' as const,
  actions: Object.freeze(['completed'] as const), sourceWorkflowPath: COMPILER });

export const CI_VERIFICATION_PER_JOB_HOSTED_WORKFLOW_SHAPE_REVISION =
  'sec-ci-verification-per-job-workflow-shape-v1' as const;

/** Accepted trust assumptions; OIDC is job provenance, not hardware attestation. */
export const CI_VERIFICATION_PER_JOB_HOSTED_TRUST_BOUNDARY = Object.freeze({
  trusted: Object.freeze(['github-managed-kernel', 'github-managed-administrator',
    'exact-authenticated-trusted-bootstrap'] as const),
  excluded: Object.freeze(['trusted-substrate-or-bootstrap-compromise',
    'stolen-or-deliberately-relayed-job-credentials'] as const),
  candidate: 'never-host-execution-or-host-uid-root-write-capability' as const,
  credentials: 'trusted-launcher-only-never-candidate-env-descriptors-or-files' as const,
  lifetime: 'original-api-job-start-deadline-never-renewed-by-another-phase' as const
});

const CHECKOUT_ACTION = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_BUN_ACTION = 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6';
const UPLOAD_ACTION = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const DOWNLOAD_ACTION = 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';

type HostedLauncherPhase = Readonly<{ kind: 'phase'; phase: string; stepId: string; stepName: string;
  lane: 'session' | 'action-terminal' | 'activation-created' | 'terminal-assembly' | 'terminal-anchor' | null }>;
type HostedArtifactTransfer = Readonly<{
  slot: string; stepId: string; stepName: string;
  artifactName: string; producerStepId: string | null; retentionDays: number | null;
  lane: HostedLauncherPhase['lane'];
}> & (Readonly<{ kind: 'upload' }> | Readonly<{ kind: 'download' }>);
type HostedCandidateCheckout = Readonly<{ kind: 'candidate-checkout'; source: 'activation' | 'verification-action' }>;
export type CiVerificationPerJobHostedStage = HostedLauncherPhase | HostedArtifactTransfer | HostedCandidateCheckout;

function phase(phase: string, stepId: string, stepName: string, lane: HostedLauncherPhase['lane'] = null): HostedLauncherPhase {
  return Object.freeze({ kind: 'phase', phase, stepId, stepName, lane });
}
function upload(slot: string, producerStepId: string, stepName: string,
  retentionDays: number = 90, lane: HostedLauncherPhase['lane'] = null): HostedArtifactTransfer {
  return Object.freeze({ kind: 'upload', slot, stepId: `upload-${slot}`, stepName,
    artifactName: `\${{ steps.${producerStepId}.outputs.${slot}-artifact-name }}`,
    producerStepId, retentionDays, lane });
}
function download(slot: string, artifactName: string, stepName: string, lane: HostedLauncherPhase['lane'] = null): HostedArtifactTransfer {
  return Object.freeze({ kind: 'download', slot, stepId: `download-${slot}`, stepName,
    artifactName, producerStepId: null, retentionDays: null, lane });
}
const RESOLUTION_INPUT = download('resolution',
  '${{ needs.resolve-verification-action.outputs.resolution-artifact-name }}',
  'Download trusted Action resolution transport');
const PREPARED_INPUT = download('prepared',
  '${{ needs.claim-verification-action.outputs.prepared-artifact-name }}',
  'Download exact prepared candidate ticket transport');

/** Phase selectors identify closed runtime handlers, never caller-supplied commands. */
const JOB_STAGES: Readonly<Record<string, readonly CiVerificationPerJobHostedStage[]>> = Object.freeze({
  'agent-operation-activation': Object.freeze([
    Object.freeze({ kind: 'candidate-checkout' as const, source: 'activation' as const }),
    phase('produce-hosted', 'produce', 'Compile exact hosted activation payload'),
    upload('activation', 'produce', 'Upload exact Agent operation activation receipt'),
    phase('publish-hosted', 'publish', 'Publish exact Agent operation activation receipt', 'activation-created')
  ]),
  'coordinate-verification-session': Object.freeze([
    phase('prepare-parent-plan', 'parent-plan', 'Prepare canonical parent Action dispatch plan'),
    upload('parent-plan', 'parent-plan', 'Upload canonical parent Action dispatch plan artifact'),
    phase('coordinate-session', 'coordinate', 'Complete original Action coordination and canonical Session'),
    upload('session', 'coordinate', 'Upload sole terminal Verification Session artifact')
  ]),
  'receive-verification-session-resume': Object.freeze([
    phase('receive-verification-session-resume', 'resume', 'Resume original authenticated Verification Session'),
    upload('resume-outcomes', 'resume', 'Upload complete original resume dispatch outcome observations'),
    upload('session', 'resume', 'Upload resumed terminal Verification Session artifact')
  ]),
  'resolve-verification-action': Object.freeze([
    phase('resolve-hosted-action', 'resolve', 'Rebuild trusted Session envelope and exact ActionKey member'),
    upload('resolution', 'resolve', 'Upload trusted Action resolution transport', 1)
  ]),
  'preflight-verification-action-sut': Object.freeze([
    RESOLUTION_INPUT,
    phase('self-test-hosted-action-sandbox', 'preflight', 'Prove hostile SUT sandbox on the executing job'),
    upload('capability', 'preflight', 'Upload exact SUT capability observation', 1)
  ]),
  'claim-verification-action': Object.freeze([
    RESOLUTION_INPUT,
    download('capability', '${{ needs.preflight-verification-action-sut.outputs.capability-artifact-name }}',
      'Download exact SUT capability observation'),
    Object.freeze({ kind: 'candidate-checkout' as const, source: 'verification-action' as const }),
    phase('prepare-start-marker', 'prepare', 'Create immutable Action start marker from fresh provider census'),
    upload('start', 'prepare', 'Upload immutable Action start marker'),
    phase('claim-start', 'claim', 'Publish durable start tombstone and issue execution ticket'),
    upload('prepared', 'claim', 'Upload exact prepared candidate and execution ticket transport', 1)
  ]),
  'execute-verification-action-sut': Object.freeze([
    RESOLUTION_INPUT, PREPARED_INPUT,
    phase('execute-hosted-action-sut', 'execute', 'Execute one normalized candidate operation without credentials'),
    upload('raw', 'execute', 'Upload untrusted raw SUT transport only', 1)
  ]),
  'assemble-verification-action-terminal': Object.freeze([
    RESOLUTION_INPUT, Object.freeze({ ...PREPARED_INPUT, lane: 'terminal-assembly' as const }),
    download('raw', '${{ needs.execute-verification-action-sut.outputs.raw-artifact-name }}',
      'Download raw SUT transport for terminal assembly', 'terminal-assembly'),
    phase('assemble-hosted-action-terminal', 'assemble', 'Assemble canonical five-state terminal artifact', 'terminal-assembly'),
    upload('terminal', 'assemble', 'Upload canonical terminal Action artifact', 90, 'terminal-assembly'),
    phase('prepare-terminal-anchor', 'anchor', 'Create exact post-upload terminal anchor', 'terminal-anchor'),
    upload('anchor', 'anchor', 'Upload exact post-upload terminal anchor', 90, 'terminal-anchor'),
    phase('anchor-terminal', 'publish', 'Publish neutral terminal provider tombstone')
  ]),
  authorize: Object.freeze([
    phase('prepare-integration-hosted', 'prepare', 'Prepare exact integration recovery artifact'),
    upload('recovery', 'prepare', 'Upload exact branch closeout recovery artifact'),
    phase('verify-integration-recovery', 'verify', 'Read back exact branch closeout recovery artifact')
  ]),
  integrate: Object.freeze([
    phase('resume-verification-session', 'resume', 'Resume canonical verification Session', 'action-terminal'),
    download('recovery', '${{ needs.authorize.outputs.recovery-artifact-name }}',
      'Download exact integration preflight and recovery artifact'),
    phase('integrate-hosted', 'integrate', 'Integrate exact hosted Session and publish live readback status', 'session'),
    phase('closeout-mutate-hosted', 'mutate', 'Close out exact integrated branch', 'session'),
    phase('closeout-publish-hosted', 'publish', 'Publish exact branch closeout receipt', 'session'),
  ]),
});

const READ_CONTROL = Object.freeze({ actions: 'read', checks: 'read', contents: 'read',
  issues: 'read', 'pull-requests': 'read', statuses: 'read' });
const WRITE_CONTROL = Object.freeze({ actions: 'read', checks: 'read', contents: 'write',
  issues: 'write', 'pull-requests': 'write', statuses: 'read' });
const RUNTIME_PERMISSIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'agent-operation-activation': Object.freeze({ actions: 'read', checks: 'read', contents: 'read',
    issues: 'write', 'pull-requests': 'write' }),
  'coordinate-verification-session': WRITE_CONTROL,
  'receive-verification-session-resume': WRITE_CONTROL,
  'resolve-verification-action': READ_CONTROL,
  'preflight-verification-action-sut': Object.freeze({ actions: 'read', contents: 'read' }),
  'claim-verification-action': Object.freeze({ actions: 'write', checks: 'read', contents: 'read', statuses: 'write' }),
  'execute-verification-action-sut': Object.freeze({ actions: 'read', contents: 'read' }),
  'assemble-verification-action-terminal': Object.freeze({ actions: 'write', checks: 'read', contents: 'read', statuses: 'write' }),
  authorize: READ_CONTROL,
  integrate: WRITE_CONTROL,
});

const API_ONLY = Object.freeze({ kind: 'api-only' as const, oidcPermission: null });
/** Exact source scheduling barriers; these values never issue runtime admission. */
const WORKFLOW_HEADERS = deepFreeze({
  ".github/workflows/compiler-pr-validation.yml": {
    "name": "compiler-pr-validation",
    "run-name": "${{ github.event.action == 'sec-produce-main-health-v1' && format('SEC main health {0} operation {1}', github.event.client_payload.payload.mainSha, github.event.client_payload.payload.requestOperationId) || github.event.action == 'sec-produce-agent-operation-activation-v1' && format('activate {0} PR #{1}', github.event.client_payload.payload.phase, github.event.client_payload.payload.pullRequestNumber) || github.event.action == 'sec-produce-verification-action-v2' && format('produce Action {0}', github.event.client_payload.payload.proposal.proposedActionKey) || github.event.action == 'sec-resume-verification-session-v1' && format('verify session PR #{0} session {1}', github.event.client_payload.payload.completedAction.providerEnvelope.proposal.sessionRequest.prNumber, github.event.client_payload.payload.completedAction.providerEnvelope.proposal.sessionRequest.expectedSessionRevision) || format('verify session PR #{0} session {1}', github.event.client_payload.payload.prNumber, github.event.client_payload.payload.expectedSessionRevision) }}",
    "on": {
      "repository_dispatch": {
        "types": [
          "sec-verify-session-v2",
          "sec-produce-verification-action-v2",
          "sec-produce-main-health-v1",
          "sec-produce-agent-operation-activation-v1",
          "sec-resume-verification-session-v1"
        ]
      }
    },
    "permissions": {
      "actions": "read",
      "contents": "read",
      "pull-requests": "read"
    },
    "env": {
      "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24": "true"
    }
  },
  ".github/workflows/merge-gate.yml": {
    "name": "merge-gate",
    "run-name": "${{ format('integrate compiler session run {0} attempt {1}', github.event.workflow_run.id, github.event.workflow_run.run_attempt) }}",
    "on": {
      "workflow_run": {
        "workflows": [
          "compiler-pr-validation"
        ],
        "types": [
          "completed"
        ]
      }
    },
    "permissions": {
      "actions": "read",
      "contents": "read"
    },
    "env": {
      "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24": "true"
    },
    "concurrency": {
      "group": "sec-integration-${{ github.repository_id }}-${{ github.event.repository.default_branch }}",
      "cancel-in-progress": false,
      "queue": "max"
    }
  },
  ".github/workflows/compiler-release-validation.yml": {
    "name": "compiler-release-validation",
    "run-name": "release verify exact main ${{ github.sha }}",
    "on": {
      "repository_dispatch": {
        "types": [
          "sec-verify-release-main-v1"
        ]
      }
    },
    "permissions": {
      "contents": "read"
    },
    "concurrency": {
      "group": "${{ github.workflow }}-${{ github.sha }}",
      "cancel-in-progress": true
    },
    "env": {
      "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24": "true"
    }
  },
  ".github/workflows/trusted-bootstrap.yml": {
    "name": "trusted-bootstrap",
    "run-name": "trusted bootstrap PR #${{ github.event.client_payload.pull_request }} @ ${{ github.event.client_payload.expected_head }} base ${{ github.event.client_payload.expected_base }}",
    "on": {
      "repository_dispatch": {
        "types": [
          "sec-trusted-bootstrap-v1"
        ]
      }
    },
    "permissions": {
      "contents": "read",
      "pull-requests": "read"
    },
    "concurrency": {
      "group": "sec-trusted-bootstrap-${{ github.event.client_payload.pull_request }}",
      "cancel-in-progress": true
    },
    "env": {
      "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24": "true"
    }
  }
} as const);
const JOB_SCHEDULING = deepFreeze({
  "receive-verification-session-resume": {
    "if": "${{ github.event_name == 'repository_dispatch' && github.event.action == 'sec-resume-verification-session-v1' }}"
  },
  "agent-operation-activation": {
    "if": "${{ github.event_name == 'repository_dispatch' && github.event.action == 'sec-produce-agent-operation-activation-v1' }}",
    "needs": "validate-agent-operation-activation-request",
    "concurrency": {
      "group": "sec-agent-operation-activation-${{ github.repository_id }}-${{ needs.validate-agent-operation-activation-request.outputs.request-operation-hex }}",
      "cancel-in-progress": false
    }
  },
  "coordinate-verification-session": {
    "if": "${{ needs.validate-hosted-request.outputs.request-kind == 'session' }}",
    "needs": "validate-hosted-request",
    "concurrency": {
      "group": "sec-verification-session-${{ github.repository_id }}-${{ needs.validate-hosted-request.outputs.session-revision-hex }}",
      "cancel-in-progress": false,
      "queue": "max"
    }
  },
  "resolve-verification-action": {
    "if": "${{ needs.validate-hosted-request.outputs.request-kind == 'action' }}",
    "needs": "validate-hosted-request"
  },
  "preflight-verification-action-sut": {
    "if": "${{ needs.resolve-verification-action.outputs.provider-disposition == 'start-allowed' }}",
    "needs": [
      "validate-hosted-request",
      "resolve-verification-action"
    ]
  },
  "claim-verification-action": {
    "if": "${{ needs.resolve-verification-action.outputs.provider-disposition == 'start-allowed' }}",
    "needs": [
      "validate-hosted-request",
      "resolve-verification-action",
      "preflight-verification-action-sut"
    ],
    "concurrency": {
      "group": "sec-verification-action-${{ github.repository_id }}-${{ needs.resolve-verification-action.outputs.action-key-hex }}",
      "cancel-in-progress": false,
      "queue": "max"
    }
  },
  "execute-verification-action-sut": {
    "if": "${{ needs.claim-verification-action.result == 'success' &&\n    needs.claim-verification-action.outputs.ticket-issued == 'true' }}",
    "needs": [
      "validate-hosted-request",
      "resolve-verification-action",
      "claim-verification-action"
    ]
  },
  "assemble-verification-action-terminal": {
    "if": "${{ always() && needs.resolve-verification-action.result == 'success' &&\n    (needs.resolve-verification-action.outputs.provider-disposition == 'repair-terminal-anchor' ||\n     needs.resolve-verification-action.outputs.provider-disposition == 'repair-terminal-status' ||\n     (needs.resolve-verification-action.outputs.provider-disposition == 'start-allowed' &&\n      needs.execute-verification-action-sut.result == 'success')) }}",
    "needs": [
      "validate-hosted-request",
      "resolve-verification-action",
      "claim-verification-action",
      "execute-verification-action-sut"
    ],
    "concurrency": {
      "group": "sec-verification-action-${{ github.repository_id }}-${{ needs.resolve-verification-action.outputs.action-key-hex }}",
      "cancel-in-progress": false,
      "queue": "max"
    }
  },
  "authorize": {
    "needs": "plan",
    "if": "${{ needs.plan.outputs.ready == 'true' }}"
  },
  "integrate": {
    "needs": [
      "plan",
      "authorize",
      "terminal-status"
    ],
    "if": "${{ always() && needs.plan.result == 'success' && (needs.plan.outputs.resume-ready == 'true' ||\n    (needs.authorize.result == 'success' && (needs.authorize.outputs.integration-lane == 'merged-recovery' ||\n     needs.terminal-status.result == 'success'))) }}"
  }
} as const);
const OWNED_ENTRY = Object.freeze({ kind: 'retained-owned-entry' as const, oidcPermission: null });
/** Required data edges between the real job producers and their consumers. */
const JOB_OUTPUTS = Object.freeze({
  'resolve-verification-action': Object.freeze({
    'action-key-hex': '${{ steps.resolve.outputs.action-key-hex }}',
    'provider-disposition': '${{ steps.resolve.outputs.provider-disposition }}',
    'resolution-artifact-name': '${{ steps.resolve.outputs.resolution-artifact-name }}'
  }),
  'preflight-verification-action-sut': Object.freeze({
    'capability-artifact-name': '${{ steps.preflight.outputs.capability-artifact-name }}',
    'capability-artifact-id': '${{ steps.upload-capability.outputs.artifact-id }}'
  }),
  'claim-verification-action': Object.freeze({
    'prepared-artifact-name': '${{ steps.claim.outputs.prepared-artifact-name }}',
    'ticket-digest': '${{ steps.claim.outputs.ticket-digest }}',
    'ticket-issued': '${{ steps.claim.outputs.ticket-issued }}'
  }),
  'execute-verification-action-sut': Object.freeze({
    'raw-artifact-name': '${{ steps.execute.outputs.raw-artifact-name }}',
    'raw-result-digest': '${{ steps.execute.outputs.raw-result-digest }}'
  }),
  authorize: Object.freeze({
    'recovery-artifact-name': '${{ steps.prepare.outputs.recovery-artifact-name }}',
    'integration-lane': '${{ steps.prepare.outputs.integration-lane }}',
    'head-sha': '${{ steps.prepare.outputs.head-sha }}',
    'preflight-result-digest': '${{ steps.prepare.outputs.preflight-result-digest }}',
    'ruleset-digest': '${{ steps.prepare.outputs.ruleset-digest }}'
  })
});

export function ciVerificationHostedJobOutputs(jobId: string): Readonly<Record<string, string>> {
  return Object.hasOwn(JOB_OUTPUTS, jobId) ? JOB_OUTPUTS[jobId as keyof typeof JOB_OUTPUTS] : Object.freeze({});
}
const PER_JOB_RUNTIME = Object.freeze({
  kind: 'per-job-runtime' as const,
  // Source requirement; only the authored workflow can grant this permission.
  oidcPermission: 'id-token:write' as const,
  launcherPath: CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_PATH,
  launcherRevision: CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_REVISION,
  workflowShapeRevision: CI_VERIFICATION_PER_JOB_HOSTED_WORKFLOW_SHAPE_REVISION,
  trustBoundary: CI_VERIFICATION_PER_JOB_HOSTED_TRUST_BOUNDARY,
  sourceAdmission: 'authenticated-current-default-at-issuance' as const,
  sourceRetention: 'exact-original-source-through-operation-settlement' as const,
  originContinuity: 'fresh-token-at-admission-original-job-deadline-abort-or-finally-close' as const,
  candidateCredentialBoundary: 'no-host-credentials-descriptors-sockets-or-actions-files' as const
});

function job<Id extends string, Runtime extends typeof API_ONLY | typeof PER_JOB_RUNTIME | typeof OWNED_ENTRY>(
  workflowPath: HostedWorkflowPath,
  jobId: Id,
  role: HostedJobRole,
  trigger: HostedJobTrigger,
  runtime: Runtime,
  timeoutMinutes: number,
  jobName: string = jobId
) {
  const stages = runtime.kind === 'per-job-runtime' ? JOB_STAGES[jobId] : Object.freeze([]);
  const permissions = runtime.kind === 'per-job-runtime' ? RUNTIME_PERMISSIONS[jobId] : null;
  if (stages === undefined || permissions === undefined) throw new Error('Hosted job policy has no closed runtime stages.');
  const ownedRecipe = runtime.kind === 'retained-owned-entry'
    ? HOSTED_OWNED_ENTRY_RECIPES.find(recipe => recipe.workflowPath === workflowPath && recipe.jobId === jobId) : null;
  if (runtime.kind === 'retained-owned-entry' && ownedRecipe == null) throw new Error('Mature entry has no exact source recipe.');
  return Object.freeze({ workflowPath, jobId, jobName, role, trigger, runtime, stages,
    requiredPermissions: ownedRecipe != null ? ('permissions' in ownedRecipe.job ? ownedRecipe.job.permissions : null)
      : permissions === null ? null : Object.freeze({ ...permissions, 'id-token': 'write' }),
    runnerLabel: ownedRecipe != null ? ownedRecipe.job['runs-on'] : 'ubuntu-24.04' as const,
    allocation: ownedRecipe != null ? 'retained-owned-entry' as const : 'github-managed-per-job' as const,
    maximumJobDurationMs: timeoutMinutes * 60_000 });
}

/**
 * All authored routes have one policy owner. The origin requirements and
 * five API-only exclusions are derived from these same members. A YAML id is
 * the operation selector; a display name is only an additional API join check.
 * Callers cannot add a policy, choose a source digest, or turn this data into a
 * live capability. The origin/runtime owner must authenticate the actual job,
 * trusted source, workflow shape and physical boundary independently.
 */
export const CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES = Object.freeze([
  job(COMPILER, 'validate-hosted-request', 'trusted', COMPILER_REQUEST, API_ONLY, 10),
  job(COMPILER, 'validate-agent-operation-activation-request', 'trusted', ACTIVATION, API_ONLY, 5),
  job(COMPILER, 'agent-operation-activation', 'trusted', ACTIVATION, PER_JOB_RUNTIME, 10),
  job(COMPILER, 'coordinate-verification-session', 'control', SESSION, PER_JOB_RUNTIME, 205),
  job(COMPILER, 'receive-verification-session-resume', 'control', SESSION_RESUME, PER_JOB_RUNTIME, 205),
  job(COMPILER, 'resolve-verification-action', 'trusted', ACTION, PER_JOB_RUNTIME, 20),
  job(COMPILER, 'preflight-verification-action-sut', 'sut', ACTION, PER_JOB_RUNTIME, 10),
  job(COMPILER, 'claim-verification-action', 'trusted', ACTION, PER_JOB_RUNTIME, 35),
  job(COMPILER, 'execute-verification-action-sut', 'sut', ACTION, PER_JOB_RUNTIME, 75),
  job(COMPILER, 'assemble-verification-action-terminal', 'trusted', ACTION, PER_JOB_RUNTIME, 30),
  job(COMPILER, 'main-health', 'trusted', MAIN_HEALTH, OWNED_ENTRY, 30, 'sec/main-health'),
  job(MERGE, 'plan', 'trusted', COMPILER_COMPLETION, API_ONLY, 10),
  job(MERGE, 'authorize', 'control', COMPILER_COMPLETION, PER_JOB_RUNTIME, 116),
  job(MERGE, 'terminal-status', 'trusted', COMPILER_COMPLETION, API_ONLY, 10),
  job(MERGE, 'integrate', 'control', COMPILER_COMPLETION, PER_JOB_RUNTIME, 116),
  job(BOOTSTRAP, 'resolve', 'trusted', BOOTSTRAP_REQUEST, API_ONLY, 15),
  job(BOOTSTRAP, 'checker-pre', 'trusted', BOOTSTRAP_REQUEST, OWNED_ENTRY, 30),
  job(BOOTSTRAP, 'candidate-sut', 'sut', BOOTSTRAP_REQUEST, OWNED_ENTRY, 90),
  job(BOOTSTRAP, 'checker-post', 'trusted', BOOTSTRAP_REQUEST, OWNED_ENTRY, 30),
  job(RELEASE, 'compiler-release-verification', 'sut', RELEASE_REQUEST, OWNED_ENTRY, 90)
]);

/** Original coordinator windows, shared by the application and mechanical
 * workflow projection. The original job deadline remains the hard ceiling. */
export const HOSTED_SESSION_COORDINATION_WINDOWS = Object.freeze({
  reviewWindowMs: 20 * 60_000,
  reviewPollIntervalMs: 20_000,
  actionPollIntervalMs: 15_000,
  actionOverheadMs: 5 * 60_000,
  coordinatorOverheadMs: 10 * 60_000
});

export function hostedSessionCoordinationBudget() {
  const actionJobs = ['resolve-verification-action', 'preflight-verification-action-sut',
    'claim-verification-action', 'execute-verification-action-sut', 'assemble-verification-action-terminal'];
  let actionWindowMs = HOSTED_SESSION_COORDINATION_WINDOWS.actionOverheadMs;
  for (const jobId of actionJobs) {
    const matches = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.filter(policy => policy.workflowPath === COMPILER && policy.jobId === jobId);
    if (matches.length !== 1) throw new Error('Coordinator budget requires one exact original Action job.');
    actionWindowMs += matches[0]!.maximumJobDurationMs;
  }
  const coordinator = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.find(policy => policy.workflowPath === COMPILER && policy.jobId === 'coordinate-verification-session');
  if (coordinator === undefined || actionWindowMs + HOSTED_SESSION_COORDINATION_WINDOWS.reviewWindowMs
      + HOSTED_SESSION_COORDINATION_WINDOWS.coordinatorOverheadMs !== coordinator.maximumJobDurationMs) {
    throw new Error('Coordinator job ceiling differs from its original complete Action and Review windows.');
  }
  return Object.freeze({ ...HOSTED_SESSION_COORDINATION_WINDOWS, actionWindowMs,
    reviewMaximumAttempts: Math.floor(HOSTED_SESSION_COORDINATION_WINDOWS.reviewWindowMs / HOSTED_SESSION_COORDINATION_WINDOWS.reviewPollIntervalMs) + 1,
    actionMaximumAttempts: Math.floor(actionWindowMs / HOSTED_SESSION_COORDINATION_WINDOWS.actionPollIntervalMs) + 1 });
}

export type CiVerificationPerJobHostedJobPolicy =
  typeof CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES[number];

export const CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST = sha256({
  revision: CI_VERIFICATION_PER_JOB_HOSTED_POLICY_REVISION,
  jobs: CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES,
  coordinationWindows: HOSTED_SESSION_COORDINATION_WINDOWS,
  ownedEntryRecipes: HOSTED_OWNED_ENTRY_RECIPES,
  jobOutputs: JOB_OUTPUTS,
  workflowHeaders: WORKFLOW_HEADERS,
  jobScheduling: JOB_SCHEDULING,
  apiOnlyJobSourceDigests: API_ONLY_JOB_SOURCE_DIGESTS,
  workflowPermissions: WORKFLOW_PERMISSIONS
}) as `sha256:${string}`;

/** Exact source member lookup only; no aliases, display-name lookup or admission. */
export function getCiVerificationPerJobHostedJobPolicy(
  workflowPath: string,
  jobId: string
): CiVerificationPerJobHostedJobPolicy | null {
  return CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.find((policy) => (
    policy.workflowPath === workflowPath && policy.jobId === jobId
  )) ?? null;
}

/** Fixed transport location, not job authority or a directory capability. */
export function ciVerificationHostedJobTransportSlot(jobId: string, direction: 'in' | 'out', slot: string): string {
  const policy = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.find(member => member.jobId === jobId);
  if (policy === undefined || !/^[a-z][a-z0-9-]*$/u.test(slot)
      || !policy.stages.some(stage => (stage.kind === 'download' || stage.kind === 'upload')
        && stage.kind === (direction === 'in' ? 'download' : 'upload') && stage.slot === slot)
        && !(direction === 'out' && slot === 'closeout' && jobId === 'integrate')) {
    throw new Error('Hosted transport slot has no canonical stage consumer.');
  }
  return `.tmp/codex/hosted-job/${jobId}/${direction}/${slot}`;
}

/** The coordinator's intermediate files never enter either uploaded sole-member archive. */
export function ciVerificationHostedCoordinatorFiles() {
  const root = '.tmp/codex/hosted-job/coordinate-verification-session/work';
  return Object.freeze({ root,
    requestPath: `${root}/hosted-request.json`, factsPath: `${root}/hosted-facts.json`,
    envelopePath: `${root}/hosted-envelope.json`, artifactIndexPath: `${root}/hosted-action-index.json`,
    evidencePath: `${root}/hosted-evidence.json`,
    parentPlanPath: `${ciVerificationHostedJobTransportSlot('coordinate-verification-session', 'out', 'parent-plan')}/verification-action-parent-dispatch-plan.json`,
    artifactPath: `${ciVerificationHostedJobTransportSlot('coordinate-verification-session', 'out', 'session')}/verification-session-artifact.json`
  });
}

export function ciVerificationHostedActionCandidateRoot(): string {
  return '.tmp/codex/candidate';
}

export function ciVerificationHostedActionResolverFiles() {
  const resolution = ciVerificationHostedJobTransportSlot('resolve-verification-action', 'out', 'resolution');
  const root = '.tmp/codex/hosted-job/resolve-verification-action/work';
  return Object.freeze({ root, requestPath: `${root}/hosted-request.json`, factsPath: `${root}/hosted-facts.json`,
    artifactIndexPath: `${root}/hosted-action-index.json`,
    providerEnvelopePath: `${resolution}/verification-action-provider-envelope.json`,
    envelopePath: `${resolution}/hosted-envelope.json`, resolutionPath: `${resolution}/hosted-action-resolution.json` });
}

export function ciVerificationHostedActionClaimFiles() {
  const resolution = ciVerificationHostedJobTransportSlot('claim-verification-action', 'in', 'resolution');
  const start = ciVerificationHostedJobTransportSlot('claim-verification-action', 'out', 'start');
  const prepared = ciVerificationHostedJobTransportSlot('claim-verification-action', 'out', 'prepared');
  return Object.freeze({
    providerEnvelopePath: `${resolution}/verification-action-provider-envelope.json`,
    envelopePath: `${resolution}/hosted-envelope.json`, resolutionPath: `${resolution}/hosted-action-resolution.json`,
    candidateRoot: ciVerificationHostedActionCandidateRoot(), archiveOutputDirectory: prepared,
    markerOutputPath: `${start}/verification-action-start-marker.json`,
    preparedCandidateArchive: `${prepared}/prepared-candidate.tar`,
    ticketOutputPath: `${prepared}/verification-action-execution-ticket.json`
  });
}

function workflowRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`Hosted workflow shape: ${label} must be an ordinary mapping.`);
  }
  return value as Record<string, unknown>;
}

function onlyWorkflowKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`Hosted workflow shape: ${label} has an unadmitted field.`);
  }
}

function parseHostedWorkflowSource(source: string): Record<string, unknown> {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 512 * 1024 || source.includes('\0')) {
    throw new Error('Hosted workflow shape: source is outside the bounded UTF-8 input.');
  }
  return workflowRecord(parseYamlValue(source, {
    label: 'Hosted workflow shape', maximumInputBytes: 512 * 1024, maximumAliasCount: 128
  }), 'workflow');
}

function assertHostedWorkflowHeader(workflow: Record<string, unknown>, workflowPath: HostedWorkflowPath): void {
  const header = Object.fromEntries(Object.entries(workflow).filter(([key]) => key !== 'jobs'));
  if (!canonicalEquals(header, WORKFLOW_HEADERS[workflowPath])) {
    throw new Error('Hosted workflow shape: complete workflow header scheduling differs.');
  }
}

/** Artifact metadata attributes a run, not a job. Authenticate this entire
 * executable source closure before deriving one writer from a fixed slot.
 * The provider still must bind the exact artifact bytes and successful target
 * job/launcher/upload readbacks. This predicate itself grants no authority. */
export function assertCiVerificationPerJobHostedWholeWorkflowShape(source: string): void {
  const workflow = parseHostedWorkflowSource(source);
  const policies = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.filter(policy => (
    workflow.name === policy.workflowPath.slice('.github/workflows/'.length, -'.yml'.length)
  ));
  if (policies.length === 0) throw new Error('Hosted workflow shape: unknown complete workflow.');
  const workflowPath = policies[0]!.workflowPath;
  assertHostedWorkflowHeader(workflow, workflowPath);
  if (!canonicalEquals(workflow.permissions, WORKFLOW_PERMISSIONS[workflowPath])) {
    throw new Error('Hosted workflow shape: inherited permissions differ.');
  }
  const jobs = workflowRecord(workflow.jobs, 'complete jobs');
  if (!canonicalEquals(Object.keys(jobs).sort(), policies.map(policy => policy.jobId).sort())) {
    throw new Error('Hosted workflow shape: complete job census differs.');
  }
  for (const policy of policies) {
    if (policy.runtime.kind === 'per-job-runtime') {
      assertCiVerificationPerJobHostedWorkflowShape(source, policy.jobId);
    } else if (policy.runtime.kind === 'retained-owned-entry') {
      const recipes = HOSTED_OWNED_ENTRY_RECIPES.filter(recipe => recipe.workflowPath === policy.workflowPath && recipe.jobId === policy.jobId);
      if (recipes.length !== 1 || !canonicalEquals(jobs[policy.jobId], recipes[0]!.job)) {
        throw new Error('Hosted workflow shape: mature entry recipe differs.');
      }
    } else {
      const apiJob = workflowRecord(jobs[policy.jobId], 'API-only job');
      if (sha256(apiJob) !== API_ONLY_JOB_SOURCE_DIGESTS[policy.jobId]) {
        throw new Error('Hosted workflow shape: API-only executable source differs.');
      }
    }
  }
}

export function compileCiVerificationHostedWorkflowSteps(policy: CiVerificationPerJobHostedJobPolicy): readonly unknown[] {
  if (policy.runtime.kind === 'retained-owned-entry') {
    const recipes = HOSTED_OWNED_ENTRY_RECIPES.filter(recipe => recipe.workflowPath === policy.workflowPath && recipe.jobId === policy.jobId);
    if (recipes.length !== 1) throw new Error('Mature entry has no closed recipe.');
    return recipes[0]!.job.steps;
  }
  if (policy.runtime.kind !== 'per-job-runtime') throw new Error('API-only job has no hosted launcher.');
  const bunDigest = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunExecutableDigest.slice(7);
  const steps: unknown[] = [
    { name: 'Checkout exact trusted hosted launcher', uses: CHECKOUT_ACTION,
      with: { ref: '${{ github.workflow_sha }}', 'fetch-depth': 0, 'persist-credentials': false } },
    { name: 'Setup exact trusted bootstrap Bun', uses: SETUP_BUN_ACTION,
      with: { 'bun-version': SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunVersion } },
    { name: 'Verify exact bootstrap Bun bytes', shell: 'bash',
      run: `set -euo pipefail\nprintf '%s  %s\\n' '${bunDigest}' "$(command -v bun)" | sha256sum --check --strict` },
    { name: 'Install exact trusted launcher dependencies', shell: 'bash',
      run: 'exec bun --no-env-file install --frozen-lockfile --ignore-scripts' }
  ];
  for (const stage of policy.stages) {
    if (stage.kind === 'phase') {
      const environment: Record<string, string> = {
        GH_TOKEN: '${{ github.token }}',
        SEC_HOSTED_NEEDS_JSON: '${{ toJSON(needs) }}',
        SEC_HOSTED_STEPS_JSON: '${{ toJSON(steps) }}'
      };
      if (policy.jobId === 'authorize' || policy.jobId === 'integrate') {
        environment.SEC_GITHUB_RULESET_AUDITOR_TOKEN = '${{ secrets.SEC_GITHUB_RULESET_AUDITOR_TOKEN }}';
      }
      if (policy.jobId === 'agent-operation-activation') {
        environment.GITHUB_REPOSITORY_ID = '${{ github.repository_id }}';
        environment.SEC_ACTIVATION_ACTOR_LOGIN = '${{ github.actor }}';
        environment.SEC_ACTIVATION_ACTOR_NODE_ID = '${{ needs.validate-agent-operation-activation-request.outputs.actor-node-id }}';
        environment.SEC_ACTIVATION_ACTOR_PERMISSION = '${{ needs.validate-agent-operation-activation-request.outputs.actor-permission }}';
        environment.SEC_ACTIVATION_HEAD_REF = '${{ needs.validate-agent-operation-activation-request.outputs.head-ref }}';
        if (stage.phase === 'publish-hosted') {
          environment.ARTIFACT_ID = '${{ steps.upload-activation.outputs.artifact-id }}';
          environment.ARTIFACT_DIGEST = 'sha256:${{ steps.upload-activation.outputs.artifact-digest }}';
        }
      }
      const laneCondition = stage.lane === null ? {} : {
        if: stage.lane === 'action-terminal' ? "${{ needs.plan.outputs.resume-ready == 'true' }}"
          : stage.lane === 'activation-created' ? "${{ steps.produce.outputs.disposition == 'created' }}"
            : stage.lane === 'terminal-assembly' ? "${{ needs.resolve-verification-action.outputs.provider-disposition == 'start-allowed' }}"
              : stage.lane === 'terminal-anchor' ? "${{ needs.resolve-verification-action.outputs.provider-disposition != 'repair-terminal-status' }}"
            : "${{ needs.plan.outputs.ready == 'true' }}"
      };
      steps.push({ name: stage.stepName, id: stage.stepId, ...laneCondition, shell: 'bash', env: environment,
        run: `exec bun --no-env-file ${policy.runtime.launcherPath} --job ${policy.jobId} --phase ${stage.phase}` });
    } else if (stage.kind === 'upload') {
      steps.push({ name: stage.stepName, id: stage.stepId,
        if: policy.jobId === 'agent-operation-activation'
          ? "${{ steps.produce.outputs.disposition == 'created' && steps.produce.outputs.activation-ready == 'true' }}"
          : `\${{ always() && !cancelled() && steps.${stage.producerStepId}.outputs.${stage.slot}-ready == 'true'${stage.lane === 'terminal-assembly'
            ? " && needs.resolve-verification-action.outputs.provider-disposition == 'start-allowed'"
            : stage.lane === 'terminal-anchor' ? " && needs.resolve-verification-action.outputs.provider-disposition != 'repair-terminal-status'" : ''} }}`,
        uses: UPLOAD_ACTION, with: { name: stage.artifactName,
          path: stage.slot === 'recovery'
            ? `\${{ github.workspace }}/.tmp/codex/hosted-job/${policy.jobId}/out/recovery/branch-closeout-recovery.json\n\${{ github.workspace }}/.tmp/codex/hosted-job/${policy.jobId}/out/recovery/integration-preflight-result-v2.json`
            : stage.slot === 'prepared'
              ? `\${{ github.workspace }}/${ciVerificationHostedActionClaimFiles().preparedCandidateArchive}\n\${{ github.workspace }}/${ciVerificationHostedActionClaimFiles().ticketOutputPath}`
            : `\${{ github.workspace }}/${ciVerificationHostedJobTransportSlot(policy.jobId, 'out', stage.slot)}`,
          'if-no-files-found': 'error', 'retention-days': stage.retentionDays,
          'include-hidden-files': true, overwrite: false } });
    } else if (stage.kind === 'download') {
      steps.push({ name: stage.stepName, id: stage.stepId, uses: DOWNLOAD_ACTION,
        if: `\${{ ${stage.artifactName.slice(4, -3)} != ''${stage.lane === 'terminal-assembly'
          ? " && needs.resolve-verification-action.outputs.provider-disposition == 'start-allowed'" : ''} }}`,
        with: { name: stage.artifactName,
          path: `\${{ github.workspace }}/${ciVerificationHostedJobTransportSlot(policy.jobId, 'in', stage.slot)}` } });
    } else {
      steps.push({ name: stage.source === 'activation' ? 'Checkout exact candidate SUT'
        : 'Checkout exact candidate for trusted materialization only', uses: CHECKOUT_ACTION,
        with: { ref: stage.source === 'activation'
          ? '${{ needs.validate-agent-operation-activation-request.outputs.head-sha }}'
          : '${{ needs.validate-hosted-request.outputs.head-sha }}',
          'fetch-depth': 0, 'persist-credentials': false,
          path: stage.source === 'activation' ? 'candidate' : ciVerificationHostedActionCandidateRoot() } });
    }
  }
  return steps;
}

/**
 * Validate bytes fetched by the origin owner from the authenticated workflow
 * path at its signed/current-default SHA. The returned source member is still
 * policy data, never a live capability. Callers must bind its workflowPath to
 * that authenticated blob locator, join the signed check-run to the actual job
 * and enforce every selected phase through its closed runtime handler.
 *
 * Existing self-hosted/direct-Bun workflows deliberately fail this predicate.
 * No predicate result permits dispatch, installs or unimplemented handlers.
 */
export function assertCiVerificationPerJobHostedWorkflowShape(
  source: string,
  jobId: string
): CiVerificationPerJobHostedJobPolicy {
  const matches = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.filter((policy) => (
    policy.jobId === jobId && policy.runtime.kind === 'per-job-runtime'
  ));
  if (matches.length !== 1) throw new Error('Hosted workflow shape: job is not one closed runtime member.');
  const policy = matches[0]!;
  const workflow = parseHostedWorkflowSource(source);
  assertHostedWorkflowHeader(workflow, policy.workflowPath);
  onlyWorkflowKeys(workflow, ['name', 'run-name', 'on', 'permissions', 'env', 'concurrency', 'jobs'], 'workflow');
  const workflowName = policy.workflowPath.slice('.github/workflows/'.length, -'.yml'.length);
  if (workflow.name !== workflowName || (workflow.env !== undefined && !canonicalEquals(workflow.env,
    { FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true' }))) {
    throw new Error('Hosted workflow shape: workflow name or inherited process environment differs.');
  }
  const trigger = workflowRecord(workflow.on, 'workflow triggers');
  onlyWorkflowKeys(trigger, [policy.trigger.eventName], 'workflow triggers');
  const event = workflowRecord(trigger[policy.trigger.eventName], 'selected event');
  if (policy.trigger.eventName === 'repository_dispatch') {
    onlyWorkflowKeys(event, ['types'], 'repository dispatch');
    const actions = [...new Set(CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES
      .filter((member) => member.workflowPath === policy.workflowPath)
      .flatMap((member) => member.trigger.actions))].sort();
    if (!Array.isArray(event.types) || !canonicalEquals([...event.types].sort(), actions)) {
      throw new Error('Hosted workflow shape: repository dispatch types are not closed.');
    }
  } else if (!canonicalEquals(event, { workflows: ['compiler-pr-validation'], types: ['completed'] })) {
    throw new Error('Hosted workflow shape: compiler completion trigger differs.');
  }
  const jobs = workflowRecord(workflow.jobs, 'jobs');
  const selected = workflowRecord(jobs[jobId], 'selected job');
  const schedule = Object.fromEntries(Object.entries(selected).filter(([key]) => ['if', 'needs', 'concurrency'].includes(key)));
  if (!Object.hasOwn(JOB_SCHEDULING, jobId) || !canonicalEquals(schedule, JOB_SCHEDULING[jobId as keyof typeof JOB_SCHEDULING])) {
    throw new Error('Hosted workflow shape: exact job scheduling barrier differs.');
  }
  onlyWorkflowKeys(selected, ['name', 'if', 'needs', 'runs-on', 'timeout-minutes',
    'permissions', 'concurrency', 'outputs', 'steps'], 'selected job');
  if ((selected.name ?? jobId) !== policy.jobName || selected['runs-on'] !== policy.runnerLabel
    || selected['timeout-minutes'] !== policy.maximumJobDurationMs / 60_000
    || !canonicalEquals(selected.permissions, policy.requiredPermissions)) {
    throw new Error('Hosted workflow shape: job identity, allocation, deadline or permissions differ.');
  }
  if (selected.outputs !== undefined) {
    const outputs = workflowRecord(selected.outputs, 'job outputs');
    const phaseIds = policy.stages.filter((stage) => stage.kind === 'phase').map((stage) => stage.stepId);
    const uploadIds = policy.stages.filter((stage) => stage.kind === 'upload').map((stage) => stage.stepId);
    for (const [key, value] of Object.entries(outputs)) {
      const match = typeof value === 'string'
        ? /^\$\{\{ steps\.([a-z][a-z0-9-]*)\.outputs\.([a-z][a-z0-9-]*) \}\}$/u.exec(value) : null;
      const nativeUploadData = match !== null && uploadIds.includes(match[1]!)
        && ['artifact-id', 'artifact-digest'].includes(match[2]!);
      if (!/^[a-z][a-z0-9-]*$/u.test(key) || match === null
          || !phaseIds.includes(match[1]!) && !nativeUploadData) {
        throw new Error('Hosted workflow shape: job output is not a closed launcher data output.');
      }
    }
  }
  if (!canonicalEquals(selected.outputs ?? {}, ciVerificationHostedJobOutputs(jobId))) {
    throw new Error('Hosted workflow shape: required producer output census differs.');
  }
  if (!Array.isArray(selected.steps)) throw new Error('Hosted workflow shape: ordered steps are missing.');
  const steps = selected.steps.map((value, index) => {
    const step = workflowRecord(value, `step ${index}`);
    // A final YAML block-scalar newline does not change the shell program.
    return typeof step.run === 'string' ? { ...step, run: step.run.replace(/\n$/u, '') } : step;
  });
  if (!canonicalEquals(steps, compileCiVerificationHostedWorkflowSteps(policy))) {
    throw new Error('Hosted workflow shape: setup, launcher phases or native artifact steps differ.');
  }
  return policy;
}
