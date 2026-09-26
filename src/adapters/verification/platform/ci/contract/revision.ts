import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../../providers/linux-verification/contract.ts';
import { VERIFICATION_SESSION_SCHEMA } from '../../session/contract/session.ts';

const HOSTED_SANDBOX_PYTHON_VERSION =
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.runtime.pythonVersion;
const hostedSandboxPythonVersion = /^(\d+)\.(\d+)\.\d+$/u.exec(HOSTED_SANDBOX_PYTHON_VERSION);
if (hostedSandboxPythonVersion === null) {
  throw new Error('Hosted sandbox Python authority must be one exact semantic version.');
}
const HOSTED_SANDBOX_PYTHON = Object.freeze({
  version: HOSTED_SANDBOX_PYTHON_VERSION,
  executablePath: '/usr/bin/python3' as const,
  stdlibDirectory: `/usr/lib/python${hostedSandboxPythonVersion[1]}.${hostedSandboxPythonVersion[2]}` as const
});

/** Active trusted hosted lane. */
export const CI_VERIFICATION_SESSION_CONTRACT_REVISION = 'ci-verification-session-v2' as const;
export const CI_VERIFICATION_SESSION_DISPATCH_TYPE = 'sec-verify-session-v2' as const;
export const CI_VERIFICATION_SESSION_REQUEST_SCHEMA = 'sec-verification-session-hosted-request-v1' as const;
export const CI_VERIFICATION_SESSION_ARTIFACT_PREFIX = VERIFICATION_SESSION_SCHEMA;

/**
 * The hosted SUT isolation policy is part of Action identity through
 * CI_VERIFICATION_HOSTED_PROVIDER_REVISION. Capability self-tests are live
 * provider facts; this registry is the stable semantic policy they must prove.
 */
export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY = Object.freeze({
  schema: 'sec-ci-verification-hosted-sandbox-policy-v1' as const,
  policyRevision: 'sandbox-v6' as const,
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
  python: HOSTED_SANDBOX_PYTHON,
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
    HOSTED_SANDBOX_PYTHON.executablePath,
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
    '/usr/lib/git-core',
    HOSTED_SANDBOX_PYTHON.stdlibDirectory
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

export const CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST = `sha256:${rawSha256Hex(JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY))}` as const;
