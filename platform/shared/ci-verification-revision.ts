import { createHash } from 'node:crypto';

export const CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION = 'ci-verification-v8' as const;

/** Active trusted hosted lane. V2/V3 evidence revisions remain reader-only. */
export const CI_VERIFICATION_SESSION_CONTRACT_REVISION = 'ci-verification-session-v2' as const;
export const CI_VERIFICATION_SESSION_DISPATCH_TYPE = 'sec-verify-session-v2' as const;
export const CI_VERIFICATION_SESSION_REQUEST_SCHEMA = 'sec-verification-session-hosted-request-v1' as const;
export const CI_VERIFICATION_SESSION_ARTIFACT_PREFIX = 'sec-verification-session-v2' as const;

/** Internal proposal-only dispatch. Trusted workflow code reconstructs every field before use. */
export const CI_VERIFICATION_ACTION_DISPATCH_TYPE_V2 =
  'sec-produce-verification-action-v2' as const;
export const CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA_V2 =
  'sec-verification-action-proposal-v2' as const;
/** Compatibility export name; the internal request is now the proposal layer only. */
export const CI_VERIFICATION_ACTION_REQUEST_SCHEMA_V2 =
  CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA_V2;
export const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PROPOSAL_SET_SCHEMA_V2 =
  'sec-verification-action-parent-dispatch-proposal-set-v2' as const;
export const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA_V2 =
  'sec-verification-action-parent-dispatch-plan-v2' as const;
export const CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA_V2 =
  'sec-verification-action-provider-envelope-v2' as const;
export const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2 =
  'verification-action-parent-dispatch-plan.json' as const;
export const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX_V2 =
  'sec-verification-action-parent-dispatch-plan-v2' as const;
export const CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2 =
  'coordinate-verification-session' as const;
export const CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2 =
  'Prepare canonical parent Action dispatch plan' as const;
export const CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA_V2 =
  'sec-verification-action-terminal-artifact-v2' as const;
export const CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION_V2 =
  'sec-ci-verification-action-environment-v2' as const;
export const CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2 = Object.freeze([
  '.bun-version',
  'bun.lock',
  'bunfig.toml',
  'package.json'
] as const);
export const CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2 =
  'github-actions:ubuntu-24.04:x64:bun-1.3.14:action-producer-v2:sandbox-v2' as const;

/**
 * The hosted SUT isolation policy is part of Action identity through
 * CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2. Capability self-tests are live
 * provider facts; this registry is the stable semantic policy they must prove.
 */
export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1 = Object.freeze({
  schema: 'sec-ci-verification-hosted-sandbox-policy-v1' as const,
  policyRevision: 'sandbox-v2' as const,
  runnerImage: 'ubuntu-24.04' as const,
  substrate: 'util-linux-unshare' as const,
  namespaces: Object.freeze(['mount', 'pid', 'network'] as const),
  rootIsolation: 'private-tmpfs-pivot-root' as const,
  proc: 'new-proc-hidepid-2' as const,
  isolatedUid: 65532 as const,
  isolatedGid: 65532 as const,
  network: 'none' as const,
  noNewPrivileges: true as const,
  capabilitySet: 'empty' as const,
  inheritedFileDescriptors: 'stdio-only-at-exec' as const,
  inputMount: 'read-only-authenticated-canonical-tar-v1' as const,
  archiveValidation: Object.freeze({
    rejectAbsoluteOrParentPath: true as const,
    rejectDeviceFifoSocket: true as const,
    rejectUnsafeLink: true as const,
    rejectDuplicateOrCaseConflict: true as const,
    hostExtraction: false as const
  }),
  workspace: 'private-tmpfs-extract-after-pivot' as const,
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
    cpuSeconds: 1_800 as const,
    wallSeconds: 3_600 as const,
    addressSpaceBytes: 4_294_967_296 as const,
    fileSizeBytes: 268_435_456 as const,
    openFiles: 1_024 as const,
    processes: 256 as const,
    workspaceBytes: 4_294_967_296 as const
  }),
  resourceController: 'systemd-cgroup-v2-plus-prlimit' as const,
  capabilitySelfTest: 'pre-start-and-fresh-sut-host' as const,
  teardown: 'kill-child-reap-and-residue-readback' as const
});

export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1 = `sha256:${createHash('sha256')
  .update(JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1))
  .digest('hex')}` as const;

export const CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1 = Object.freeze({
  schema: 'sec-ci-github-actions-identity-policy-v1' as const,
  app: Object.freeze({
    id: 15368 as const,
    nodeId: 'MDM6QXBwMTUzNjg=' as const,
    slug: 'github-actions' as const
  }),
  bot: Object.freeze({
    login: 'github-actions[bot]' as const,
    id: 41898282 as const,
    nodeId: 'MDM6Qm90NDE4OTgyODI=' as const,
    type: 'Bot' as const
  })
});

export const CI_GITHUB_ACTIONS_IDENTITY_POLICY_DIGEST_V1 = `sha256:${createHash('sha256')
  .update(JSON.stringify(CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1))
  .digest('hex')}` as const;

export const CI_MAIN_HEALTH_REQUEST_SCHEMA_V1 = 'sec-produce-main-health-request-v1' as const;

export function createCiMainHealthRequestOperationIdV1(mainSha: string): `sha256:${string}` {
  if (!/^[0-9a-f]{40}$/u.test(mainSha)) {
    throw new Error('MainHealth request operation identity requires an exact lowercase main SHA.');
  }
  return `sha256:${createHash('sha256').update(JSON.stringify({
    schema: CI_MAIN_HEALTH_REQUEST_SCHEMA_V1,
    mainSha
  })).digest('hex')}`;
}

/** The only exact-main health producer accepted by the ordinary Session lane. */
export const CI_MAIN_HEALTH_POLICY_V1 = Object.freeze({
  schema: 'sec-ci-main-health-policy-v5' as const,
  policyRevision: 'sec-ci-main-health-policy-v5' as const,
  context: 'sec/main-health' as const,
  app: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app,
  producer: Object.freeze({
    identity: 'platform/shared/default-branch-revision-health.ts' as const,
    sourceTransport: 'github-api' as const,
    workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    workflowRefFormat: '.github/workflows/compiler-pr-validation.yml@<exact-main-sha>' as const,
    eventNames: Object.freeze(['push', 'repository_dispatch'] as const),
    runTitleFormats: Object.freeze({
      push: 'SEC main health <exact-main-sha>' as const,
      repositoryDispatch: 'SEC main health <exact-main-sha> operation <request-operation-id>' as const,
      requestOperationId: 'sha256:<64-lowercase-hex>' as const,
      requestSchema: CI_MAIN_HEALTH_REQUEST_SCHEMA_V1,
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

export const CI_MAIN_HEALTH_POLICY_DIGEST_V1 = `sha256:${createHash('sha256')
  .update(JSON.stringify(CI_MAIN_HEALTH_POLICY_V1))
  .digest('hex')}` as const;
