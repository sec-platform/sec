import { parseDocument } from 'yaml';

import { canonicalEquals, sha256 } from '../../../../contracts/canonical.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../linux-verification/contract.ts';

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

type HostedLauncherPhase = Readonly<{ kind: 'phase'; phase: string; stepId: string; stepName: string }>;
type HostedArtifactTransfer = Readonly<{
  kind: 'upload' | 'download'; slot: string; stepId: string; stepName: string;
  artifactName: string; producerStepId: string | null; retentionDays: number | null;
}>;
export type CiVerificationPerJobHostedStage = HostedLauncherPhase | HostedArtifactTransfer;

function phase(phase: string, stepId: string, stepName: string): HostedLauncherPhase {
  return Object.freeze({ kind: 'phase', phase, stepId, stepName });
}
function upload(slot: string, producerStepId: string, stepName: string,
  retentionDays: number = 90): HostedArtifactTransfer {
  return Object.freeze({ kind: 'upload', slot, stepId: `upload-${slot}`, stepName,
    artifactName: `\${{ steps.${producerStepId}.outputs.${slot}-artifact-name }}`,
    producerStepId, retentionDays });
}
function download(slot: string, artifactName: string, stepName: string): HostedArtifactTransfer {
  return Object.freeze({ kind: 'download', slot, stepId: `download-${slot}`, stepName,
    artifactName, producerStepId: null, retentionDays: null });
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
    phase('produce-hosted', 'produce', 'Compile exact hosted activation payload'),
    upload('activation', 'produce', 'Upload exact Agent operation activation receipt'),
    phase('publish-hosted', 'publish', 'Publish exact Agent operation activation receipt')
  ]),
  'coordinate-verification-session': Object.freeze([
    phase('prepare-parent-plan', 'parent-plan', 'Prepare canonical parent Action dispatch plan'),
    upload('parent-plan', 'parent-plan', 'Upload canonical parent Action dispatch plan artifact'),
    phase('coordinate-session', 'coordinate', 'Reconcile canonical ActionKey producers once'),
    phase('compose-hosted-evidence', 'compose', 'Compose settled canonical Session evidence'),
    upload('session', 'compose', 'Upload sole terminal Verification Session artifact')
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
    RESOLUTION_INPUT, PREPARED_INPUT,
    download('raw', '${{ needs.execute-verification-action-sut.outputs.raw-artifact-name }}',
      'Download raw SUT transport for terminal assembly'),
    phase('assemble-hosted-action-terminal', 'assemble', 'Assemble canonical five-state terminal artifact'),
    upload('terminal', 'assemble', 'Upload canonical terminal Action artifact'),
    phase('prepare-terminal-anchor', 'anchor', 'Create exact post-upload terminal anchor'),
    upload('anchor', 'anchor', 'Upload exact post-upload terminal anchor'),
    phase('anchor-terminal', 'publish', 'Publish neutral terminal provider tombstone')
  ]),
  'main-health': Object.freeze([
    phase('imports:check', 'imports', 'Reject import organization drift'),
    phase('typecheck:verified', 'typecheck', 'Run exact-main TypeScript checks'),
    phase('audit', 'audit', 'Reject static architecture contradictions'),
    phase('docs:doctor', 'docs', 'Validate active documentation authority'),
    phase('test', 'test', 'Run the complete fast test inventory')
  ]),
  authorize: Object.freeze([
    phase('prepare-integration-hosted', 'prepare', 'Prepare exact integration recovery artifact'),
    upload('recovery', 'prepare', 'Upload exact branch closeout recovery artifact'),
    phase('verify-integration-recovery', 'verify', 'Read back exact branch closeout recovery artifact')
  ]),
  integrate: Object.freeze([
    download('recovery', '${{ needs.authorize.outputs.recovery-artifact-name }}',
      'Download exact integration preflight and recovery artifact'),
    phase('integrate-hosted', 'integrate', 'Close out exact integrated branch'),
    upload('closeout', 'integrate', 'Retain exact integration and closeout publication projections', 30)
  ]),
  'checker-pre': Object.freeze([
    phase('checker-pre', 'pre', 'Produce trusted-base PRE candidate-root receipt'),
    upload('pre', 'pre', 'Upload bounded checker PRE artifact', 1)
  ]),
  'candidate-sut': Object.freeze([
    phase('execute-trusted-bootstrap-sut', 'sut', 'Run candidate SUT through trusted private sandbox'),
    upload('sut', 'sut', 'Upload bounded candidate SUT artifact', 1)
  ]),
  'checker-post': Object.freeze([
    download('pre', '${{ needs.checker-pre.outputs.pre-artifact-name }}', 'Download bounded checker PRE artifact'),
    download('sut', '${{ needs.candidate-sut.outputs.sut-artifact-name }}', 'Download bounded candidate SUT artifact'),
    phase('checker-post', 'post', 'Reuse PRE Actions and reduce exact bootstrap evidence'),
    upload('bootstrap', 'post', 'Upload final canonical trusted bootstrap evidence')
  ]),
  'compiler-release-verification': Object.freeze([
    phase('verify-release', 'verify', 'Run exact-head full verification'),
    phase('release:build', 'build', 'Build and bind exact-head release set'),
    upload('release-manifests', 'build', 'Upload exact-head release manifests'),
    upload('release-set', 'build', 'Upload exact-head runtime and documentation release set', 7),
    upload('release-evidence', 'verify', 'Upload compact full verification evidence')
  ])
});

const READ_CONTROL = Object.freeze({ actions: 'read', checks: 'read', contents: 'read',
  issues: 'read', 'pull-requests': 'read', statuses: 'read' });
const WRITE_CONTROL = Object.freeze({ actions: 'read', checks: 'read', contents: 'write',
  issues: 'write', 'pull-requests': 'write', statuses: 'read' });
const RUNTIME_PERMISSIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'agent-operation-activation': Object.freeze({ actions: 'read', checks: 'read', contents: 'read',
    issues: 'write', 'pull-requests': 'write' }),
  'coordinate-verification-session': WRITE_CONTROL,
  'resolve-verification-action': READ_CONTROL,
  'preflight-verification-action-sut': Object.freeze({ actions: 'read', contents: 'read' }),
  'claim-verification-action': Object.freeze({ actions: 'write', checks: 'read', contents: 'read', statuses: 'write' }),
  'execute-verification-action-sut': Object.freeze({ actions: 'read', contents: 'read' }),
  'assemble-verification-action-terminal': Object.freeze({ actions: 'write', checks: 'read', contents: 'read', statuses: 'write' }),
  // Own-job origin joins use the authenticated Actions run/job endpoints.
  // These requirements do not themselves grant any workflow permission.
  'main-health': Object.freeze({ actions: 'read', contents: 'read' }),
  authorize: READ_CONTROL,
  integrate: WRITE_CONTROL,
  'checker-pre': Object.freeze({ actions: 'read', contents: 'read', 'pull-requests': 'read' }),
  'candidate-sut': Object.freeze({ actions: 'read', contents: 'read', 'pull-requests': 'read' }),
  'checker-post': Object.freeze({ actions: 'read', contents: 'read', 'pull-requests': 'read' }),
  'compiler-release-verification': Object.freeze({ actions: 'read', contents: 'read' })
});

const API_ONLY = Object.freeze({ kind: 'api-only' as const, oidcPermission: null });
const PER_JOB_RUNTIME = Object.freeze({
  kind: 'per-job-runtime' as const,
  // This is a proposed requirement, not an authorized or active permission grant.
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

function job<Id extends string, Runtime extends typeof API_ONLY | typeof PER_JOB_RUNTIME>(
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
  return Object.freeze({ workflowPath, jobId, jobName, role, trigger, runtime, stages,
    requiredPermissions: permissions === null ? null : Object.freeze({ ...permissions, 'id-token': 'write' }),
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

function requiredHostedWorkflowSteps(policy: CiVerificationPerJobHostedJobPolicy): readonly unknown[] {
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
      steps.push({ name: stage.stepName, id: stage.stepId, shell: 'bash', env: environment,
        run: `exec bun --no-env-file ${policy.runtime.launcherPath} --job ${policy.jobId} --phase ${stage.phase}` });
    } else if (stage.kind === 'upload') {
      steps.push({ name: stage.stepName, id: stage.stepId,
        if: `\${{ always() && !cancelled() && steps.${stage.producerStepId}.outputs.${stage.slot}-ready == 'true' }}`,
        uses: UPLOAD_ACTION, with: { name: stage.artifactName,
          path: `\${{ runner.temp }}/sec-hosted-job/${policy.jobId}/out/${stage.slot}`,
          'if-no-files-found': 'error', 'retention-days': stage.retentionDays,
          'include-hidden-files': true, overwrite: false } });
    } else {
      steps.push({ name: stage.stepName, id: stage.stepId, uses: DOWNLOAD_ACTION,
        if: `\${{ ${stage.artifactName.slice(4, -3)} != '' }}`,
        with: { name: stage.artifactName,
          path: `\${{ runner.temp }}/sec-hosted-job/${policy.jobId}/in/${stage.slot}` } });
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
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 512 * 1024 || source.includes('\0')) {
    throw new Error('Hosted workflow shape: source is outside the bounded UTF-8 input.');
  }
  const document = parseDocument(source, { version: '1.2', uniqueKeys: true, strict: true });
  if (document.errors.length !== 0 || document.warnings.length !== 0) {
    throw new Error('Hosted workflow shape: YAML errors, duplicate keys or unresolved tags.');
  }
  const workflow = workflowRecord(document.toJS({ maxAliasCount: 128 }), 'workflow');
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
    for (const [key, value] of Object.entries(outputs)) {
      const match = typeof value === 'string'
        ? /^\$\{\{ steps\.([a-z][a-z0-9-]*)\.outputs\.([a-z][a-z0-9-]*) \}\}$/u.exec(value) : null;
      if (!/^[a-z][a-z0-9-]*$/u.test(key) || match === null || !phaseIds.includes(match[1]!)) {
        throw new Error('Hosted workflow shape: job output is not a closed launcher data output.');
      }
    }
  }
  if (!Array.isArray(selected.steps)) throw new Error('Hosted workflow shape: ordered steps are missing.');
  const steps = selected.steps.map((value, index) => {
    const step = workflowRecord(value, `step ${index}`);
    // A final YAML block-scalar newline does not change the shell program.
    return typeof step.run === 'string' ? { ...step, run: step.run.replace(/\n$/u, '') } : step;
  });
  if (!canonicalEquals(steps, requiredHostedWorkflowSteps(policy))) {
    throw new Error('Hosted workflow shape: setup, launcher phases or native artifact steps differ.');
  }
  return policy;
}
