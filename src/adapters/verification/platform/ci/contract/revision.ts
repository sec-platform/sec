import { createHash } from 'node:crypto';

import { LINUX_RUNTIME_TOOLS } from '../../../../providers/linux-verification/runtime-tools.ts';
import { VERIFICATION_SESSION_SCHEMA } from '../../session/contract/session.ts';

/** Active trusted hosted lane. */
export const CI_VERIFICATION_SESSION_CONTRACT_REVISION = 'ci-verification-session-v2' as const;
export const CI_VERIFICATION_SESSION_DISPATCH_TYPE = 'sec-verify-session-v2' as const;

export const CI_VERIFICATION_SESSION_ARTIFACT_PREFIX = VERIFICATION_SESSION_SCHEMA;
export const HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE = 'verification-session-resume-dispatch-outcomes.json' as const;

export function hostedResumeDispatchOutcomesArtifactName(runId: string, runAttempt: number): string {
  if (!/^[1-9][0-9]*$/u.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    throw new Error('Resume outcome artifact requires one exact receiver attempt.');
  }
  return `verification-session-resume-dispatch-outcomes-run-${runId}-attempt-${runAttempt}`;
}

export function hostedSessionArtifactName(input: {
  prNumber: number;
  sessionRevision: `sha256:${string}`;
  runId: string;
  runAttempt: number;
}): string {
  return `sec-verification-session-v2-pr-${input.prNumber}-session-${input.sessionRevision.slice(7)}-run-${input.runId}-attempt-${input.runAttempt}`;
}

/**
 * The hosted SUT isolation policy is part of Action identity through
 * CI_VERIFICATION_HOSTED_PROVIDER_REVISION. Capability self-tests are live
 * provider facts; this registry is the stable semantic policy they must prove.
 */
export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY = Object.freeze({
  schema: 'sec-ci-verification-hosted-sandbox-policy-v1' as const,
  policyRevision: 'sandbox-v7' as const,
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
  toolClosure: 'private-explicit-runtime-binaries-python-stdlib-and-dynamic-libraries-v3' as const,
  python: LINUX_RUNTIME_TOOLS.python,
  runtimeBinaries: LINUX_RUNTIME_TOOLS.binaries,
  runtimeDirectories: LINUX_RUNTIME_TOOLS.directories,
  runtimeAliases: LINUX_RUNTIME_TOOLS.aliases,
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
  teardown: 'physical-candidate-unit-settlement-and-independent-directory-cleanup' as const
});

export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST = `sha256:${createHash('sha256')
  .update(JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY))
  .digest('hex')}` as const;
