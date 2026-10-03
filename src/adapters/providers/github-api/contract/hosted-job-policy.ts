import { sha256 } from '../../../../contracts/canonical.ts';

/** A closed source policy, never evidence that a workflow or runner satisfies it. */
export const CI_VERIFICATION_PER_JOB_HOSTED_POLICY_REVISION =
  'sec-ci-verification-per-job-hosted-policy-v1' as const;
export const CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_REVISION =
  'sec-ci-verification-hosted-job-launcher-v1' as const;
export const CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_PATH =
  'src/adapters/verification/platform/ci/runtime/hosted-job-runtime.ts' as const;

const COMPILER = '.github/workflows/compiler-pr-validation.yml' as const;
const MERGE = '.github/workflows/merge-gate.yml' as const;
const BOOTSTRAP = '.github/workflows/trusted-bootstrap.yml' as const;
const RELEASE = '.github/workflows/compiler-release-validation.yml' as const;

type HostedWorkflowPath = typeof COMPILER | typeof MERGE | typeof BOOTSTRAP | typeof RELEASE;
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

const API_ONLY = Object.freeze({ kind: 'api-only' as const, oidcPermission: null });
const PER_JOB_RUNTIME = Object.freeze({
  kind: 'per-job-runtime' as const,
  // This is a proposed requirement, not an authorized or active permission grant.
  oidcPermission: 'id-token:write' as const,
  launcherPath: CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_PATH,
  launcherRevision: CI_VERIFICATION_PER_JOB_HOSTED_LAUNCHER_REVISION,
  sourceAdmission: 'authenticated-current-default-at-issuance' as const,
  sourceRetention: 'exact-original-source-through-operation-settlement' as const,
  candidateCredentialBoundary: 'no-host-credentials-descriptors-sockets-or-actions-files' as const
});

function job<Id extends string, Runtime extends typeof API_ONLY | typeof PER_JOB_RUNTIME>(
  workflowPath: HostedWorkflowPath,
  jobId: Id,
  role: HostedJobRole,
  trigger: HostedJobTrigger,
  runtime: Runtime,
  timeoutMinutes: number,
  jobName: string = jobId
) {
  return Object.freeze({ workflowPath, jobId, jobName, role, trigger, runtime,
    runnerLabel: 'ubuntu-24.04' as const, allocation: 'github-managed-per-job' as const,
    maximumJobDurationMs: timeoutMinutes * 60_000 });
}

/**
 * All authored routes have one policy owner. The 14 origin requirements and
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
  job(COMPILER, 'resolve-verification-action', 'trusted', ACTION, PER_JOB_RUNTIME, 20),
  job(COMPILER, 'preflight-verification-action-sut', 'sut', ACTION, PER_JOB_RUNTIME, 10),
  job(COMPILER, 'claim-verification-action', 'trusted', ACTION, PER_JOB_RUNTIME, 35),
  job(COMPILER, 'execute-verification-action-sut', 'sut', ACTION, PER_JOB_RUNTIME, 75),
  job(COMPILER, 'assemble-verification-action-terminal', 'trusted', ACTION, PER_JOB_RUNTIME, 30),
  job(COMPILER, 'main-health', 'trusted', MAIN_HEALTH, PER_JOB_RUNTIME, 30, 'sec/main-health'),
  job(MERGE, 'plan', 'trusted', COMPILER_COMPLETION, API_ONLY, 10),
  job(MERGE, 'authorize', 'control', COMPILER_COMPLETION, PER_JOB_RUNTIME, 116),
  job(MERGE, 'terminal-status', 'trusted', COMPILER_COMPLETION, API_ONLY, 10),
  job(MERGE, 'integrate', 'control', COMPILER_COMPLETION, PER_JOB_RUNTIME, 116),
  job(BOOTSTRAP, 'resolve', 'trusted', BOOTSTRAP_REQUEST, API_ONLY, 15),
  job(BOOTSTRAP, 'checker-pre', 'trusted', BOOTSTRAP_REQUEST, PER_JOB_RUNTIME, 30),
  job(BOOTSTRAP, 'candidate-sut', 'sut', BOOTSTRAP_REQUEST, PER_JOB_RUNTIME, 90),
  job(BOOTSTRAP, 'checker-post', 'trusted', BOOTSTRAP_REQUEST, PER_JOB_RUNTIME, 30),
  job(RELEASE, 'compiler-release-verification', 'sut', RELEASE_REQUEST, PER_JOB_RUNTIME, 90)
]);

export type CiVerificationPerJobHostedJobPolicy =
  typeof CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES[number];

export const CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST = sha256({
  revision: CI_VERIFICATION_PER_JOB_HOSTED_POLICY_REVISION,
  jobs: CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES
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
