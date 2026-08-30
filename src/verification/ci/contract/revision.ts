import { createHash } from 'node:crypto';

import { DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY } from '../../../control/main-health/default-branch-revision.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../action/contract/provider.ts';
import { VERIFICATION_SESSION_SCHEMA } from '../../session/contract/session.ts';

/** Active trusted hosted lane. */
export const CI_VERIFICATION_SESSION_CONTRACT_REVISION = 'ci-verification-session-v2' as const;
export const CI_VERIFICATION_SESSION_DISPATCH_TYPE = 'sec-verify-session-v2' as const;
export const CI_VERIFICATION_SESSION_REQUEST_SCHEMA = 'sec-verification-session-hosted-request-v1' as const;
export const CI_VERIFICATION_SESSION_ARTIFACT_PREFIX = VERIFICATION_SESSION_SCHEMA;
export const CI_VERIFICATION_WORKFLOW_PATH = 'src/verification/ci/verification.ts' as const;

/**
 * The hosted SUT isolation policy is part of Action identity through
 * CI_VERIFICATION_HOSTED_PROVIDER_REVISION. Capability self-tests are live
 * provider facts; this registry is the stable semantic policy they must prove.
 */
export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY = Object.freeze({
  schema: 'sec-ci-verification-hosted-sandbox-policy-v1' as const,
  policyRevision: 'sandbox-v5' as const,
  runnerImage: 'ubuntu-24.04' as const,
  substrate: 'util-linux-unshare' as const,
  namespaces: Object.freeze(['mount', 'pid', 'network'] as const),
  rootIsolation: 'private-tmpfs-chroot-retained-archive-fd-closed-before-candidate' as const,
  proc: 'new-proc-hidepid-2' as const,
  isolatedUid: 65532 as const,
  isolatedGid: 65532 as const,
  network: 'none' as const,
  noNewPrivileges: true as const,
  capabilitySet: 'empty' as const,
  outerSutContainerCapabilities: Object.freeze([
    'CHOWN', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_CHROOT'
  ] as const),
  inheritedFileDescriptors: 'stdio-plus-authenticated-archive-fd-until-private-copy' as const,
  inputMount: 'retained-ordinary-fd-private-tmpfs-authenticated-copy-v2' as const,
  archiveValidation: Object.freeze({
    rejectAbsoluteOrParentPath: true as const,
    rejectDeviceFifoSocket: true as const,
    rejectUnsafeLink: true as const,
    rejectDuplicateOrCaseConflict: true as const,
    retainedOrdinaryFileDescriptor: true as const,
    privateCopyDigestReadback: true as const,
    hostExtraction: false as const
  }),
  workspace: 'private-tmpfs-extract-inside-chroot' as const,
  toolClosure: 'private-explicit-runtime-binaries-and-dynamic-libraries-v2' as const,
  runtimeBinaries: Object.freeze([
    '/usr/bin/awk',
    '/usr/bin/bash',
    '/usr/bin/basename',
    '/usr/bin/cat',
    '/usr/bin/chmod',
    '/usr/bin/chown',
    '/usr/bin/cmp',
    '/usr/bin/cp',
    '/usr/bin/cut',
    '/usr/bin/date',
    '/usr/bin/diff',
    '/usr/bin/dirname',
    '/usr/bin/env',
    '/usr/bin/find',
    '/usr/bin/git',
    '/usr/bin/grep',
    '/usr/bin/head',
    '/usr/bin/ln',
    '/usr/bin/mkdir',
    '/usr/bin/mktemp',
    '/usr/bin/mount',
    '/usr/bin/prlimit',
    '/usr/bin/readlink',
    '/usr/bin/realpath',
    '/usr/bin/rm',
    '/usr/bin/rmdir',
    '/usr/bin/sed',
    '/usr/bin/setpriv',
    '/usr/bin/sha256sum',
    '/usr/bin/sleep',
    '/usr/bin/sort',
    '/usr/bin/stat',
    '/usr/bin/tail',
    '/usr/bin/tar',
    '/usr/bin/tee',
    '/usr/bin/timeout',
    '/usr/bin/touch',
    '/usr/bin/tr',
    '/usr/bin/umount',
    '/usr/bin/uname',
    '/usr/bin/wc',
    '/usr/bin/xargs'
  ] as const),
  runtimeDirectories: Object.freeze([
    '/usr/lib/git-core'
  ] as const),
  runtimeAliases: Object.freeze([
    Object.freeze({ path: '/bin', target: 'usr/bin' }),
    Object.freeze({ path: '/usr/bin/sh', target: 'bash' }),
    Object.freeze({ path: '/tool/bin/node', target: 'bun' })
  ] as const),
  hiddenHostRoots: Object.freeze([
    '/home', '/run', '/var/run', '/workspace', 'RUNNER_TEMP', 'github-command-files', 'provider-sockets'
  ] as const),
  outputTransport: 'stdout-stderr-pipes-only' as const,
  untrustedOutput: Object.freeze({
    actionsCommandInterpretation: false as const,
    maximumBytesPerStream: 8_388_608 as const,
    overflowDisposition: 'invalidated' as const
  }),
  limits: Object.freeze({
    // The outer SUT cgroup is capped at two CPUs and the unit is killed after
    // 3,600 wall seconds, so 7,200 is the aggregate CPU-time ceiling across
    // every descendant. RLIMIT_CPU uses the same value only as a redundant
    // per-process ceiling; it is not represented as aggregate enforcement.
    aggregateCpuSeconds: 7_200 as const,
    perProcessCpuSeconds: 7_200 as const,
    wallSeconds: 3_600 as const,
    addressSpaceBytes: 4_294_967_296 as const,
    fileSizeBytes: 268_435_456 as const,
    openFiles: 1_024 as const,
    processes: 256 as const,
    workspaceBytes: 4_294_967_296 as const
  }),
  resourceController: 'two-cpu-outer-cgroup-times-wall-aggregate-plus-per-process-prlimit' as const,
  capabilitySelfTest: 'dedicated-pre-start-sut-role' as const,
  teardown: 'unshare-kill-child-process-close-readback' as const
});

export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST = `sha256:${createHash('sha256')
  .update(JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY))
  .digest('hex')}` as const;

/**
 * GitHub REST exposes an evaluated workflow `run-name` through both `name` and
 * `display_title`.  The presentation `name` is deliberately absent here: only
 * the immutable workflow path plus the exact dispatch subject identify a
 * compiler workflow run across Session, Action, MainHealth, and merge consumers.
 */
export const CI_COMPILER_WORKFLOW_RUN_IDENTITY = Object.freeze({
  workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
  eventName: 'repository_dispatch' as const
});

export function matchesCiWorkflowRunIdentity(input: Readonly<{
  workflowPath: unknown;
  eventName: unknown;
  displayTitle: unknown;
  headSha: unknown;
  expectedWorkflowPath: string;
  expectedEventName: string;
  expectedDisplayTitle: string;
  expectedHeadSha: string;
}>): boolean {
  return /^[0-9a-f]{40}$/u.test(input.expectedHeadSha)
    && input.expectedWorkflowPath.startsWith('.github/workflows/')
    && input.expectedWorkflowPath.endsWith('.yml')
    && input.expectedEventName.length > 0
    && input.expectedDisplayTitle.length > 0
    && input.expectedDisplayTitle.length <= 256
    && input.workflowPath === input.expectedWorkflowPath
    && input.eventName === input.expectedEventName
    && input.displayTitle === input.expectedDisplayTitle
    && input.headSha === input.expectedHeadSha;
}

export function matchesCiCompilerWorkflowRunIdentity(input: Readonly<{
  workflowPath: unknown;
  eventName: unknown;
  displayTitle: unknown;
  headSha: unknown;
  expectedDisplayTitle: string;
  expectedHeadSha: string;
}>): boolean {
  return matchesCiWorkflowRunIdentity({
    ...input,
    expectedWorkflowPath: CI_COMPILER_WORKFLOW_RUN_IDENTITY.workflowPath,
    expectedEventName: CI_COMPILER_WORKFLOW_RUN_IDENTITY.eventName
  });
}

export const CI_MAIN_HEALTH_REQUEST_SCHEMA = 'sec-produce-main-health-request-v1' as const;

export function createCiMainHealthRequestOperationId(mainSha: string): `sha256:${string}` {
  if (!/^[0-9a-f]{40}$/u.test(mainSha)) {
    throw new Error('MainHealth request operation identity requires an exact lowercase main SHA.');
  }
  return `sha256:${createHash('sha256').update(JSON.stringify({
    schema: CI_MAIN_HEALTH_REQUEST_SCHEMA,
    mainSha
  })).digest('hex')}`;
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
    // Routing truth only. Document control remains the sole freeze effect owner.
    allowedLanes: Object.freeze(['repair'] as const)
  }),
  locked: Object.freeze({ allowedLanes: Object.freeze([] as const) })
});

export const CI_MAIN_HEALTH_POLICY_DIGEST = `sha256:${createHash('sha256')
  .update(JSON.stringify(CI_MAIN_HEALTH_POLICY))
  .digest('hex')}` as const;
