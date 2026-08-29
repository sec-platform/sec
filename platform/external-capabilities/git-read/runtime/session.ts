import { devNull } from 'node:os';
import path from 'node:path';

import { rawSha256 } from '../../../foundation/canonical.ts';
import {
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  scanNoFollowDirectoryTreeMetadataV1,
  PhysicalNoFollowError,
  type PhysicalDirectoryChainV1
} from '../../../runtime-physical/index.ts';
import { runCommandBytes, type ByteCommandResult } from '../../../runtime-physical/index.ts';
import {
  resolveWindowsControlCliSessionV1,
  type WindowsControlCliLiveSessionV1,
  type WindowsControlCliSessionRequestV1,
  type WindowsControlCliSessionResolutionReasonV1,
  type WindowsControlCliTerminalReceiptV1
} from '../../windows-control-cli/index.ts';

/**
 * Value bound to GIT_CONFIG_GLOBAL so trusted Git children ignore the
 * user-global config. `os.devNull` resolves to `/dev/null` on POSIX but to
 * `\\.\nul` on Windows, which Git cannot open as a configuration file
 * (`invalid argument`), so Windows binds the `NUL` device name instead. Both
 * values are accepted by Git as an empty configuration source and do not fall
 * back to reading the real user-global config.
 */
const GIT_NULL_CONFIG_GLOBAL_SINK = process.platform === 'win32' ? 'NUL' : devNull;

const AMBIENT_GIT_ENV_KEYS = [
  'GH_PROMPT_DISABLED',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_ATTR_SOURCE',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
  'GIT_LITERAL_PATHSPECS',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_EXEC_PATH',
  'GIT_GRAFT_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_NO_LAZY_FETCH',
  'GIT_OPTIONAL_LOCKS',
  'GIT_QUARANTINE_PATH',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_ASKPASS',
  'GIT_ASKPASS_REQUIRE',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TEMPLATE_DIR',
  'GIT_TERMINAL_PROMPT',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE'
] as const;

// These variables are not repository selectors; they are executable helper,
// pager, tracing, or diff authority. They must never cross a trusted read
// boundary, including through an explicit override on Windows where casing is
// not stable.
const GIT_HELPER_ENV_KEYS = [
  'GIT_EXTERNAL_DIFF',
  'GIT_DIFF_OPTS',
  'GIT_PAGER',
  'PAGER',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_TRACE',
  'GIT_TRACE2',
  'GIT_TRACE2_EVENT',
  'GIT_TRACE2_PERF',
  'GIT_TRACE_PERFORMANCE',
  'GIT_TRACE_PACKET',
  'GIT_CURL_VERBOSE',
  'GIT_SSH_VARIANT',
  'GIT_ATTR_NOSYSTEM',
  'GIT_FS_MONITOR'
] as const;

const MANDATORY_GIT_READ_ENV_KEYS = [
  'GH_PROMPT_DISABLED',
  'GIT_TERMINAL_PROMPT',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_NO_LAZY_FETCH',
  'GIT_OPTIONAL_LOCKS',
  'GIT_LITERAL_PATHSPECS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  ...GIT_HELPER_ENV_KEYS
] as const;

function deleteCaseInsensitiveEnvironmentKey(env: NodeJS.ProcessEnv, key: string): void {
  const canonicalKey = key.toUpperCase();
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === canonicalKey) delete env[name];
  }
}

function readCaseInsensitiveEnvironmentValueV1(
  env: Readonly<Record<string, string>>,
  key: string
): string | undefined {
  const canonicalKey = key.toUpperCase();
  for (const [name, value] of Object.entries(env)) {
    if (name.toUpperCase() === canonicalKey) return value;
  }
  return undefined;
}

function enforceMandatoryGitReadIsolation(env: NodeJS.ProcessEnv): void {
  for (const key of MANDATORY_GIT_READ_ENV_KEYS) {
    deleteCaseInsensitiveEnvironmentKey(env, key);
  }
  env.GH_PROMPT_DISABLED = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_LITERAL_PATHSPECS = '1';
  env.GIT_CONFIG_GLOBAL = GIT_NULL_CONFIG_GLOBAL_SINK;
  env.GIT_CONFIG_NOSYSTEM = '1';
}

/**
 * Build the single canonical SEC environment for trusted local Git
 * observations. Repository selection is supplied by cwd/argv, never inherited
 * from ambient Git redirection, replacement-object, config-injection,
 * credential-prompt, SSH-command or repository-discovery state.
 *
 * Repository-local config remains observable. User-global and system config
 * are excluded by default so HOME/XDG state cannot silently change a trusted
 * observation. Explicit overrides may bind a narrower subject/environment, but
 * mandatory no-prompt/no-replace/no-global-config guards are reasserted after
 * overrides and therefore cannot be weakened by a caller, including through
 * case-variant environment names on Windows.
 */
export function isolatedGitReadEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  const retainedNames = new Set<string>();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const canonicalName = name.toUpperCase();
    if (AMBIENT_GIT_ENV_KEYS.includes(canonicalName as typeof AMBIENT_GIT_ENV_KEYS[number]) ||
        /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(canonicalName)) {
      continue;
    }
    if (retainedNames.has(canonicalName)) continue;
    retainedNames.add(canonicalName);
    env[name] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  enforceMandatoryGitReadIsolation(env);
  return env;
}

/** Historical child-process callers use the same mechanics as Git reads. */
export function isolatedGitChildEnvironment(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return isolatedGitReadEnvironment({}, source);
}

export type GitReadSessionBudgetV1 = Readonly<{
  deadlineMs: number;
  maxProcesses: number;
  maxTotalArgumentBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxRecords: number;
  maxRootObservedBytes: number;
  maxReopenRefreshes: number;
  maxSettlementAttempts: number;
  maxCommandStdoutBytes: number;
  maxCommandStderrBytes: number;
  /** Aggregate bytes retained while binding/rechecking the Git executable. */
  maxExecutableBytes: number;
}>;

/**
 * Git has two deliberately disjoint provider routes.  The local route is
 * usable only on non-Windows hosts.  Windows authority-sensitive reads must
 * first pass the official retained control-CLI resolver; they may never
 * silently fall back to PATH or a caller-provided executable.
 */
export type GitReadProviderRouteV1 =
  | 'host-local-git-v1'
  | 'windows-control-cli-v1';

export type GitReadProviderStatusV1 =
  | 'unsupported'
  | 'unknown'
  | 'unavailable';

export type GitReadHostProviderResolutionReasonV1 =
  | 'git-executable-unavailable'
  | 'git-executable-identity-unavailable'
  | 'git-session-failed';

export type GitReadProviderFailureV1 = Readonly<{
  readonly kind: 'unresolved-git-read-provider';
  readonly route: 'windows-control-cli-v1';
  readonly status: GitReadProviderStatusV1;
  readonly reason: WindowsControlCliSessionResolutionReasonV1;
  readonly detailDigest: `sha256:${string}`;
}>;

export type GitReadHostProviderFailureV1 = Readonly<{
  readonly kind: 'unresolved-git-read-provider';
  readonly route: 'host-local-git-v1';
  readonly status: 'unavailable';
  readonly reason: GitReadHostProviderResolutionReasonV1;
  readonly detailDigest: `sha256:${string}`;
}>;

export type GitReadProviderResolutionFailureV1 =
  | GitReadProviderFailureV1
  | GitReadHostProviderFailureV1;

export type GitReadSessionResolutionV1 =
  | Readonly<{
    readonly status: 'ready';
    readonly route: GitReadProviderRouteV1;
    readonly session: GitReadSessionV1;
  }>
  | GitReadProviderResolutionFailureV1;

export type GitReadSessionFailureV1 = Readonly<{
  kind: 'unresolved-git-read-session';
  reason:
    | 'deadline-exhausted'
    | 'process-budget-exhausted'
    | 'stdout-budget-exhausted'
    | 'stderr-budget-exhausted'
    | 'record-budget-exhausted'
    | 'root-observation-budget-exhausted'
    | 'executable-budget-exhausted'
    | 'argument-budget-exhausted'
    | 'command-error';
  detail: string;
  /** Bounded digest for correlating a provider/transport failure. */
  detailDigest?: `sha256:${string}`;
  /** Provider admission failure, when the session was blocked before transport. */
  provider?: GitReadProviderResolutionFailureV1;
  /** Preserve a typed lower-level authority reason across the byte adapter. */
  providerReason?: WindowsControlCliSessionResolutionReasonV1;
}>;

export type GitReadSessionCommandV1 = Readonly<{
  kind: 'completed';
  result: ByteCommandResult;
}> | GitReadSessionFailureV1;

/**
 * Physical provider identity for the executable used by one read session.
 * The resolved path is retained only as a locator; the final path, native
 * stat identity and raw executable digest are the authority that guards the
 * plan's start/end fence.
 */
export type GitExecutableIdentityV1 = Readonly<{
  path: string;
  realPath: string;
  device: string;
  inode: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  digest: `sha256:${string}`;
  /** No-follow physical closure for the executable's lexical parent. */
  ancestorChain: readonly Readonly<{
    path: string;
    finalPath: string;
    device: string;
    inode: string;
    objectId: string;
  }>[];
}>;

export type GitReadProviderIdentityV1 =
  | Readonly<{
    readonly route: 'host-local-git-v1';
    readonly executable: GitExecutableIdentityV1;
  }>
  | Readonly<{
    readonly route: 'windows-control-cli-v1';
    readonly providerRevision: `sha256:${string}`;
    readonly profileId: string;
    readonly specDigest: `sha256:${string}`;
  }>;

export type GitReadSessionV1 = Readonly<{
  readonly cwd: string;
  readonly gitExecutable: string;
  readonly gitExecutableIdentity: GitExecutableIdentityV1 | null;
  readonly providerRoute: GitReadProviderRouteV1;
  readonly providerIdentity: GitReadProviderIdentityV1 | null;
  readonly env: Readonly<Record<string, string>>;
  readonly budget: GitReadSessionBudgetV1;
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly processCount: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly argumentBytes?: number;
  readonly executableBytes?: number;
  readonly recordCount: number;
  readonly rootObservedBytes?: number;
  readonly reopenRefreshes?: number;
  readonly settlementAttempts?: number;
  readonly failure: GitReadSessionFailureV1 | null;
  /** No-follow cwd identity retained for the lifetime of this read session. */
  readonly workingDirectoryIdentity?: PhysicalDirectoryChainV1 | null;
  /** Re-read and compare the executable's physical identity/digest. */
  verifyExecutable: () => boolean;
  /** Re-read and compare the cwd no-follow identity. */
  verifyWorkingDirectory?: () => boolean;
  run: (args: readonly string[]) => Promise<GitReadSessionCommandV1>;
  consumeRecords: (count: number) => GitReadSessionFailureV1 | null;
  /** Close an authority-owned provider session when one exists. */
  close?: () => Promise<WindowsControlCliTerminalReceiptV1 | void>;
}>;

const DEFAULT_GIT_READ_SESSION_BUDGET_V1: GitReadSessionBudgetV1 = Object.freeze({
  deadlineMs: 5_000,
  maxProcesses: 32,
  maxTotalArgumentBytes: 16 * 1024 * 1024,
  maxStdoutBytes: 64 * 1024 * 1024,
  maxStderrBytes: 2 * 1024 * 1024,
  maxRecords: 250_000,
  maxRootObservedBytes: 256 * 1024 * 1024,
  maxReopenRefreshes: 10_000,
  maxSettlementAttempts: 32,
  maxCommandStdoutBytes: 32 * 1024 * 1024,
  maxCommandStderrBytes: 512 * 1024,
  maxExecutableBytes: 64 * 1024 * 1024
});

/**
 * Absolute ceilings for every GitRead transport. Operation-specific callers
 * may narrow these values, but a caller cannot silently widen the canonical
 * envelope or use a fresh session to reset an aggregate owner budget.
 */
const CANONICAL_GIT_READ_BUDGET_CEILING_V1: GitReadSessionBudgetV1 = Object.freeze({
  deadlineMs: 120_000,
  maxProcesses: 128,
  maxTotalArgumentBytes: 16 * 1024 * 1024,
  maxStdoutBytes: 64 * 1024 * 1024,
  maxStderrBytes: 2 * 1024 * 1024,
  maxRecords: 250_000,
  maxRootObservedBytes: 256 * 1024 * 1024,
  maxReopenRefreshes: 10_000,
  maxSettlementAttempts: 10_000,
  maxCommandStdoutBytes: 32 * 1024 * 1024,
  maxCommandStderrBytes: 512 * 1024,
  maxExecutableBytes: 64 * 1024 * 1024
});

export class GitReadBudgetErrorV1 extends Error {
  readonly kind = 'git-read-budget-error' as const;

  constructor(
    readonly reason: 'unknown-field' | 'invalid-value' | 'canonical-ceiling-exceeded',
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'GitReadBudgetErrorV1';
  }
}

function gitReadCommandArgumentBytesV1(args: readonly string[]): number | null {
  if (!Array.isArray(args)) return null;
  let bytes = 0;
  for (const argument of args) {
    if (typeof argument !== 'string' || argument.includes('\0')) return null;
    bytes += Buffer.byteLength(argument, 'utf8') + 1;
    if (!Number.isSafeInteger(bytes)) return null;
  }
  return bytes;
}

function createGitReadBudget(
  input: Partial<GitReadSessionBudgetV1> | undefined
): GitReadSessionBudgetV1 {
  const requested = input ?? {};
  for (const [label, value] of Object.entries(requested)) {
    if (!(label in CANONICAL_GIT_READ_BUDGET_CEILING_V1)) {
      throw new GitReadBudgetErrorV1(
        'unknown-field',
        label,
        `Git read session budget field ${label} is not canonical.`
      );
    }
    validBudgetNumber(label, value as number);
    const ceiling = CANONICAL_GIT_READ_BUDGET_CEILING_V1[
      label as keyof GitReadSessionBudgetV1
    ];
    if ((value as number) > ceiling) {
      throw new GitReadBudgetErrorV1(
        'canonical-ceiling-exceeded',
        label,
        `Git read session ${label} exceeds its canonical ceiling.`
      );
    }
  }
  const budget = Object.freeze({
    ...DEFAULT_GIT_READ_SESSION_BUDGET_V1,
    ...requested
  });
  for (const [label, value] of Object.entries(budget)) validBudgetNumber(label, value);
  return budget;
}

function validBudgetNumber(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GitReadBudgetErrorV1(
      'invalid-value',
      label,
      `Git read session ${label} must be a positive safe integer.`
    );
  }
  return value;
}

function boundedGitReadDeadlineAtV1(
  startedAt: number,
  budget: GitReadSessionBudgetV1,
  parentDeadlineAt: number | undefined
): number {
  if (parentDeadlineAt !== undefined
      && (!Number.isSafeInteger(parentDeadlineAt) || parentDeadlineAt < 0)) {
    throw new GitReadBudgetErrorV1(
      'invalid-value',
      'deadlineAtUnixMs',
      'Git read parent deadline must be a non-negative safe integer.'
    );
  }
  return Math.min(
    parentDeadlineAt ?? startedAt + budget.deadlineMs,
    startedAt + budget.deadlineMs
  );
}

type GitExecutableInspectionV1 = Readonly<{
  identity: GitExecutableIdentityV1;
  bytes: number;
}>;

type GitExecutableInspectionResultV1 =
  | GitExecutableInspectionV1
  | Readonly<{ kind: 'unavailable'; reason: 'deadline' | 'budget' | 'identity' }>;

function executableAncestor(
  identity: PhysicalDirectoryChainV1['target']
): Readonly<{
  path: string;
  finalPath: string;
  device: string;
  inode: string;
  objectId: string;
}> {
  return Object.freeze({
    path: identity.path,
    finalPath: identity.finalPath,
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

/**
 * Bind Git to one retained no-follow parent/ordinary leaf read.  The old
 * realpath -> stat -> readFile sequence was path-based TOCTOU and followed
 * symlinks/reparse points.  Metadata is preflighted before the bounded retained
 * read, and the returned leaf bytes/identity plus every parent identity form
 * one observation domain for the session's start/end fence.
 */
function inspectGitExecutable(
  executable: string,
  input: Readonly<{ deadlineAtMs: number; maxBytes: number }>
): GitExecutableInspectionResultV1 {
  if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
  try {
    const executablePath = path.resolve(executable);
    const parentPath = path.dirname(executablePath);
    const leafName = path.basename(executablePath);
    const parent = inspectNoFollowDirectoryChainV1(parentPath, 'Git executable parent');
    if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
    // Read metadata for this lexical parent first so a custom executable-byte
    // budget rejects a large leaf before the retained byte reader allocates.
    const metadata = scanNoFollowDirectoryTreeMetadataV1(parent.target, {
      deadlineAtMs: input.deadlineAtMs,
      maximumEntries: 10_000
    }).find((entry) => entry.relativePath === leafName);
    if (metadata === undefined || metadata.kind !== 'file') {
      return { kind: 'unavailable', reason: 'identity' };
    }
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > input.maxBytes) {
      return { kind: 'unavailable', reason: 'budget' };
    }
    const entry = inspectNoFollowOrdinaryFileEntryV1(parent.target, leafName);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
      return { kind: 'unavailable', reason: 'identity' };
    }
    if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
    if (entry.bytes.byteLength > input.maxBytes || entry.bytes.byteLength !== metadata.size) {
      return { kind: 'unavailable', reason: 'budget' };
    }
    const identity = Object.freeze({
      path: executablePath,
      // This is a retained no-follow locator, not a realpath authority.  Keep
      // the historical field for callers while binding the physical identity
      // to the leaf and parent-chain values below.
      realPath: path.join(parent.target.finalPath, leafName),
      device: entry.device,
      inode: entry.inode,
      size: entry.size,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
      digest: rawSha256(entry.bytes),
      ancestorChain: Object.freeze(parent.ancestors.map(executableAncestor))
    });
    return Object.freeze({ identity, bytes: entry.bytes.byteLength });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError
        && error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') {
      return { kind: 'unavailable', reason: 'identity' };
    }
    if (performance.now() > input.deadlineAtMs) return { kind: 'unavailable', reason: 'deadline' };
    return { kind: 'unavailable', reason: 'identity' };
  }
}

function sameGitExecutableIdentity(
  left: GitExecutableIdentityV1 | null,
  right: GitExecutableIdentityV1 | null
): boolean {
  return left !== null && right !== null
    && left.path === right.path
    && left.realPath === right.realPath
    && left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs
    && left.digest === right.digest
    && JSON.stringify(left.ancestorChain) === JSON.stringify(right.ancestorChain);
}

function physicalDirectoryChainObservedBytesV1(chain: PhysicalDirectoryChainV1): number {
  return Buffer.byteLength(JSON.stringify(chain), 'utf8');
}

/**
 * Create one invocation-scoped Git read budget. The session deliberately
 * exposes no unbounded Promise fan-out: every command consumes one process,
 * the remaining absolute deadline, and the remaining aggregate byte budget.
 */
function createHostGitReadSessionV1(input: Readonly<{
  cwd: string;
  environment?: Readonly<Record<string, string | undefined>>;
  budget?: Partial<GitReadSessionBudgetV1>;
  source?: NodeJS.ProcessEnv;
  deadlineAtUnixMs?: number;
}>): GitReadSessionV1 {
  const budget = createGitReadBudget(input.budget);
  const startedAt = Date.now();
  const startedMonotonicAt = performance.now();
  const deadlineAt = boundedGitReadDeadlineAtV1(
    startedAt,
    budget,
    input.deadlineAtUnixMs
  );
  const deadlineMonotonicAt = startedMonotonicAt + Math.max(0, deadlineAt - startedAt);
  const env = Object.freeze(isolatedGitReadEnvironment(input.environment ?? {}, input.source));
  const admissionDeadlineExpired = Date.now() >= deadlineAt
    || performance.now() >= deadlineMonotonicAt;
  let workingDirectoryIdentity: PhysicalDirectoryChainV1 | null = null;
  let workingDirectoryObservationFailure: string | null = null;
  if (!admissionDeadlineExpired) {
    try {
      workingDirectoryIdentity = inspectNoFollowDirectoryChainV1(
        path.resolve(input.cwd),
        'Git read working directory'
      );
    } catch (error) {
      workingDirectoryObservationFailure = error instanceof Error ? error.message : String(error);
    }
  }
  // Do not even perform executable/PATH discovery when the cwd observation
  // cannot be proved. This keeps an unsafe or unavailable cwd from becoming a
  // transport authority through a later child-process check.
  const gitExecutable = workingDirectoryIdentity === null ? null : Bun.which('git', {
    PATH: readCaseInsensitiveEnvironmentValueV1(env, 'PATH') ?? '',
    cwd: path.resolve(input.cwd)
  });
  const initialExecutableObservation = gitExecutable === null ? null : inspectGitExecutable(gitExecutable, {
    deadlineAtMs: deadlineMonotonicAt,
    maxBytes: budget.maxExecutableBytes
  });
  const gitExecutableIdentity = initialExecutableObservation !== null
      && 'identity' in initialExecutableObservation
    ? initialExecutableObservation.identity
    : null;
  let processCount = 0;
  let activeProcesses = 0;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let argumentBytes = 0;
  let recordCount = 0;
  let rootObservedBytes = workingDirectoryIdentity === null
    ? 0
    : physicalDirectoryChainObservedBytesV1(workingDirectoryIdentity);
  let executableBytes = initialExecutableObservation !== null
      && 'bytes' in initialExecutableObservation
    ? initialExecutableObservation.bytes
    : 0;
  let failure: GitReadSessionFailureV1 | null = null;
  if (admissionDeadlineExpired) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'deadline-exhausted',
      detail: 'Git read session deadline elapsed before provider admission.'
    });
  } else if (workingDirectoryIdentity === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'command-error',
      detail: 'The trusted Git working-directory physical identity could not be observed.'
        + (workingDirectoryObservationFailure === null ? '' : ` ${workingDirectoryObservationFailure}`)
    });
  } else if (rootObservedBytes > budget.maxRootObservedBytes) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'root-observation-budget-exhausted',
      detail: 'The trusted Git working-directory observation exceeded the root-observation byte budget.'
    });
  } else if (gitExecutable === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'command-error',
      detail: 'The trusted Git executable could not be resolved.'
    });
  } else if (gitExecutableIdentity === null) {
    failure = Object.freeze({
      kind: 'unresolved-git-read-session',
      reason: 'command-error',
      detail: initialExecutableObservation !== null
          && 'reason' in initialExecutableObservation
          && initialExecutableObservation.reason === 'budget'
        ? 'The trusted Git executable exceeded the executable-byte budget.'
        : initialExecutableObservation !== null
          && 'reason' in initialExecutableObservation
          && initialExecutableObservation.reason === 'deadline'
          ? 'The trusted Git executable observation exceeded the read-session deadline.'
          : 'The trusted Git executable physical identity could not be observed.'
    });
  }

  const fail = (
    reason: GitReadSessionFailureV1['reason'],
    detail: string,
    providerReason?: WindowsControlCliSessionResolutionReasonV1
  ): GitReadSessionFailureV1 => {
    failure ??= Object.freeze({
      kind: 'unresolved-git-read-session',
      reason,
      detail,
      detailDigest: rawSha256(JSON.stringify({
        route: 'host-local-git-v1',
        reason,
        detail,
        providerReason: providerReason ?? null
      })),
      ...(providerReason === undefined ? {} : { providerReason })
    });
    return failure;
  };

  const verifyExecutable = (): boolean => {
    if (failure !== null) return false;
    if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
      fail('deadline-exhausted', 'Git read session deadline elapsed during executable verification.');
      return false;
    }
    const current = gitExecutable === null ? null : inspectGitExecutable(gitExecutable, {
      deadlineAtMs: deadlineMonotonicAt,
      maxBytes: budget.maxExecutableBytes - executableBytes
    });
    if (current !== null && 'bytes' in current) executableBytes += current.bytes;
    if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
      fail('deadline-exhausted', 'Git read session deadline elapsed after executable verification.');
      return false;
    }
    const stable = current !== null
      && 'identity' in current
      && sameGitExecutableIdentity(gitExecutableIdentity, current.identity);
    if (!stable) {
      if (current !== null && 'reason' in current && current.reason === 'budget') {
        fail('executable-budget-exhausted', 'Git executable verification exceeded the executable-byte budget.');
      } else if (current !== null && 'reason' in current && current.reason === 'deadline') {
        fail('deadline-exhausted', 'Git executable verification exceeded the read-session deadline.');
      } else {
        fail('command-error', 'The trusted Git executable physical identity or digest changed.');
      }
    }
    return stable;
  };

  const session: GitReadSessionV1 = {
    cwd: input.cwd,
    gitExecutable: gitExecutable ?? '',
    gitExecutableIdentity,
    providerRoute: 'host-local-git-v1',
    providerIdentity: gitExecutableIdentity === null
      ? null
      : Object.freeze({
          route: 'host-local-git-v1' as const,
          executable: gitExecutableIdentity
        }),
    env,
    budget,
    startedAt,
    deadlineAt,
    get processCount() { return processCount; },
    get stdoutBytes() { return stdoutBytes; },
    get stderrBytes() { return stderrBytes; },
    get argumentBytes() { return argumentBytes; },
    get executableBytes() { return executableBytes; },
    get recordCount() { return recordCount; },
    get rootObservedBytes() { return rootObservedBytes; },
    reopenRefreshes: 0,
    settlementAttempts: 0,
    get failure() { return failure; },
    workingDirectoryIdentity,
    verifyWorkingDirectory(): boolean {
      if (failure !== null || workingDirectoryIdentity === null) return false;
      if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
        fail('deadline-exhausted', 'Git read session deadline elapsed during cwd verification.');
        return false;
      }
      try {
        const current = inspectNoFollowDirectoryChainV1(
          path.resolve(input.cwd),
          'Git read working directory verification'
        );
        const observedBytes = physicalDirectoryChainObservedBytesV1(current);
        if (rootObservedBytes + observedBytes > budget.maxRootObservedBytes) {
          fail(
            'root-observation-budget-exhausted',
            'Git working-directory verification exceeded the root-observation byte budget.'
          );
          return false;
        }
        rootObservedBytes += observedBytes;
        if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
          fail('deadline-exhausted', 'Git read session deadline elapsed after cwd verification.');
          return false;
        }
        const stable = JSON.stringify(current) === JSON.stringify(workingDirectoryIdentity);
        if (!stable) fail('command-error', 'The trusted Git working-directory physical identity changed.');
        return stable;
      } catch (error) {
        fail(
          'command-error',
          'The trusted Git working-directory physical identity could not be re-observed.'
            + (error instanceof Error ? ` ${error.message}` : ` ${String(error)}`)
        );
        return false;
      }
    },
    verifyExecutable,
    async run(args: readonly string[]): Promise<GitReadSessionCommandV1> {
      if (failure !== null) return failure;
      const remainingWallMs = deadlineAt - Date.now();
      const remainingMonotonicMs = deadlineMonotonicAt - performance.now();
      const remainingMs = Math.min(remainingWallMs, remainingMonotonicMs);
      if (remainingMs < 1) return fail('deadline-exhausted', 'Git read session deadline elapsed.');
      // The executable fence belongs to this transport owner. Consumers may
      // add a later observation fence, but cannot be the only thing preventing
      // a replaced helper from serving this child process.
      if (!(session.verifyWorkingDirectory?.() ?? true)) return failure ?? fail(
        'command-error',
        'The trusted Git working-directory physical identity could not be verified before child execution.'
      );
      if (!verifyExecutable()) return failure ?? fail(
        'command-error',
        'The trusted Git executable physical identity could not be verified before child execution.'
      );
      if (Date.now() >= deadlineAt || performance.now() >= deadlineMonotonicAt) {
        return fail('deadline-exhausted', 'Git read session deadline elapsed before child execution.');
      }
      if (processCount >= budget.maxProcesses) {
        return fail('process-budget-exhausted', `Git read session exceeded ${budget.maxProcesses} processes.`);
      }
      if (activeProcesses !== 0) {
        return fail('process-budget-exhausted', 'Git read session does not permit unbounded concurrent processes.');
      }
      const commandArgumentBytes = gitReadCommandArgumentBytesV1(args);
      if (commandArgumentBytes === null) {
        return fail('command-error', 'Git read session command arguments are invalid.');
      }
      if (argumentBytes + commandArgumentBytes > budget.maxTotalArgumentBytes) {
        return fail('argument-budget-exhausted', 'Git read session argument-byte budget exhausted.');
      }
      const remainingStdout = budget.maxStdoutBytes - stdoutBytes;
      const remainingStderr = budget.maxStderrBytes - stderrBytes;
      if (remainingStdout < 1) return fail('stdout-budget-exhausted', 'Git read session stdout budget exhausted.');
      if (remainingStderr < 1) return fail('stderr-budget-exhausted', 'Git read session stderr budget exhausted.');
      processCount += 1;
      argumentBytes += commandArgumentBytes;
      activeProcesses += 1;
      try {
        const result = await runCommandBytes(gitExecutable!, [...args], {
          cwd: input.cwd,
          env,
          envMode: 'replace',
          timeoutMs: Math.max(1, remainingMs),
          maxStdoutBytes: Math.min(budget.maxCommandStdoutBytes, remainingStdout),
          maxStderrBytes: Math.min(budget.maxCommandStderrBytes, remainingStderr)
        });
        stdoutBytes += result.stdout.byteLength;
        stderrBytes += Buffer.byteLength(result.stderr, 'utf8');
        // Always close the child boundary with the same executable fence,
        // including when the child returned oversized output. A budget
        // failure must not bypass the helper-replacement check.
        if (!(session.verifyWorkingDirectory?.() ?? true)) return failure ?? fail(
          'command-error',
          'The trusted Git working-directory physical identity could not be verified after child execution.'
        );
        if (!verifyExecutable()) return failure ?? fail(
          'command-error',
          'The trusted Git executable physical identity could not be verified after child execution.'
        );
        if (stdoutBytes > budget.maxStdoutBytes) {
          return fail('stdout-budget-exhausted', 'Git read session stdout budget exceeded.');
        }
        if (stderrBytes > budget.maxStderrBytes) {
          return fail('stderr-budget-exhausted', 'Git read session stderr budget exceeded.');
        }
        if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
          return fail('deadline-exhausted', 'Git read session deadline elapsed after command completion.');
        }
        return { kind: 'completed', result };
      } catch (error) {
        // Even a transport error is an effect boundary: perform the same
        // post-child helper fence before preserving the transport failure.
        if (!(session.verifyWorkingDirectory?.() ?? true)) return failure ?? fail(
          'command-error',
          'The trusted Git working-directory physical identity could not be verified after child failure.'
        );
        if (!verifyExecutable()) return failure ?? fail(
          'command-error',
          'The trusted Git executable physical identity could not be verified after child failure.'
        );
        return fail('command-error', error instanceof Error ? error.message : String(error));
      } finally {
        activeProcesses -= 1;
      }
    },
    consumeRecords(count: number): GitReadSessionFailureV1 | null {
      if (failure !== null) return failure;
      if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
        return fail('deadline-exhausted', 'Git read session deadline elapsed while consuming records.');
      }
      if (!Number.isSafeInteger(count) || count < 0) {
        return fail('record-budget-exhausted', 'Git read session record count is invalid.');
      }
      if (recordCount + count > budget.maxRecords) {
        return fail('record-budget-exhausted', `Git read session exceeded ${budget.maxRecords} records.`);
      }
      recordCount += count;
      if (Date.now() >= deadlineAt || performance.now() > deadlineMonotonicAt) {
        return fail('deadline-exhausted', 'Git read session deadline elapsed after consuming records.');
      }
      return null;
    }
  };
  return Object.freeze(session);
}

function projectWindowsProviderFailure(
  resolution: Exclude<ReturnType<typeof resolveWindowsControlCliSessionV1>, { status: 'ready' }>
): GitReadProviderFailureV1 {
  return Object.freeze({
    kind: 'unresolved-git-read-provider',
    route: 'windows-control-cli-v1',
    status: resolution.status,
    reason: resolution.reason,
    detailDigest: resolution.detailDigest
  });
}

function projectHostProviderFailure(
  session: GitReadSessionV1
): GitReadHostProviderFailureV1 {
  const reason: GitReadHostProviderResolutionReasonV1 = session.workingDirectoryIdentity === null
    ? 'git-executable-identity-unavailable'
    : session.gitExecutable.length === 0
      ? 'git-executable-unavailable'
      : session.gitExecutableIdentity === null || session.providerIdentity === null
        ? 'git-executable-identity-unavailable'
        : 'git-session-failed';
  return Object.freeze({
    kind: 'unresolved-git-read-provider',
    route: 'host-local-git-v1',
    status: 'unavailable',
    reason,
    // Keep the provider result typed and bounded while preserving enough
    // evidence to correlate the failure. The raw executable path and failure
    // detail remain local to the session and are never promoted to authority.
    detailDigest: rawSha256(JSON.stringify({
      route: 'host-local-git-v1',
      reason,
      executablePresent: session.gitExecutable.length > 0,
      executableIdentityPresent: session.gitExecutableIdentity !== null,
      providerIdentityPresent: session.providerIdentity !== null,
      sessionFailure: session.failure
        ? { reason: session.failure.reason, detail: session.failure.detail }
        : null
    }))
  });
}

const WINDOWS_CONTROL_CLI_PROVIDER_REASONS_V1: ReadonlySet<string> = new Set([
  'unsupported-platform',
  'unsupported-architecture',
  'session-request-invalid',
  'working-directory-binding-drift',
  'retained-capability-unavailable',
  'provider-epoch-drift',
  'command-budget-exhausted',
  'command-arguments-invalid',
  'command-output-budget-exhausted',
  'command-settlement-unproven',
  'command-version-drift',
  'reentrant-command',
  'session-deadline-exhausted'
]);

function windowsControlCliProviderReason(
  error: unknown
): WindowsControlCliSessionResolutionReasonV1 | undefined {
  if (typeof error !== 'object' || error === null || !('reason' in error)) return undefined;
  const reason = (error as { readonly reason?: unknown }).reason;
  return typeof reason === 'string' && WINDOWS_CONTROL_CLI_PROVIDER_REASONS_V1.has(reason)
    ? reason as WindowsControlCliSessionResolutionReasonV1
    : undefined;
}

function mapWindowsControlCliFailureReason(
  reason: WindowsControlCliSessionResolutionReasonV1 | undefined
): GitReadSessionFailureV1['reason'] {
  switch (reason) {
    case 'session-deadline-exhausted':
      return 'deadline-exhausted';
    case 'command-budget-exhausted':
      return 'process-budget-exhausted';
    case 'command-output-budget-exhausted':
      return 'stdout-budget-exhausted';
    default:
      return 'command-error';
  }
}

function createWindowsControlCliSessionRequestV1(
  cwd: string,
  budget: GitReadSessionBudgetV1,
  deadlineAtUnixMs: number
): WindowsControlCliSessionRequestV1 {
  return Object.freeze({
    // This is an untrusted locator hint. The Windows provider must derive and
    // retain its own directory capability before it can run any command.
    workingDirectoryPathHint: cwd,
    deadlineAtUnixMs,
    maxCommandsPerSession: Math.min(128, budget.maxProcesses),
    maxTotalArgumentBytes: Math.min(16 * 1024 * 1024, budget.maxTotalArgumentBytes),
    maxTotalOutputBytes: Math.min(
      16 * 1024 * 1024,
      budget.maxStdoutBytes + budget.maxStderrBytes
    ),
    maxRootObservedBytes: Math.min(256 * 1024 * 1024, budget.maxRootObservedBytes),
    maxExecutableObservedBytes: Math.min(256 * 1024 * 1024, budget.maxExecutableBytes),
    maxRecords: Math.min(100_000, budget.maxRecords),
    maxReopenRefreshes: Math.min(10_000, budget.maxReopenRefreshes),
    maxSettlementAttempts: Math.min(10_000, budget.maxSettlementAttempts)
  });
}

function windowsControlCliGitReadSession(
  input: Readonly<{ cwd: string }>,
  live: WindowsControlCliLiveSessionV1,
  admission: Readonly<{
    budget: GitReadSessionBudgetV1;
    startedAt: number;
    deadlineAt: number;
    deadlineMonotonicAt: number;
  }>
): GitReadSessionV1 {
  const startedAt = admission.startedAt;
  const deadlineAt = admission.deadlineAt;
  const maxTotalOutputBytes = Math.min(
    live.budget.maxTotalOutputBytes,
    admission.budget.maxStdoutBytes + admission.budget.maxStderrBytes
  );
  const budget = Object.freeze({
    deadlineMs: admission.budget.deadlineMs,
    maxProcesses: Math.min(live.budget.maxCommandsPerSession, admission.budget.maxProcesses),
    maxTotalArgumentBytes: Math.min(
      live.budget.maxTotalArgumentBytes,
      admission.budget.maxTotalArgumentBytes
    ),
    maxStdoutBytes: Math.min(live.budget.maxTotalOutputBytes, admission.budget.maxStdoutBytes),
    maxStderrBytes: Math.min(live.budget.maxTotalOutputBytes, admission.budget.maxStderrBytes),
    maxRecords: Math.min(live.budget.maxRecords, admission.budget.maxRecords),
    maxRootObservedBytes: Math.min(
      live.budget.maxRootObservedBytes,
      admission.budget.maxRootObservedBytes
    ),
    maxReopenRefreshes: Math.min(
      live.budget.maxReopenRefreshes,
      admission.budget.maxReopenRefreshes
    ),
    maxSettlementAttempts: Math.min(
      live.budget.maxSettlementAttempts,
      admission.budget.maxSettlementAttempts
    ),
    maxCommandStdoutBytes: Math.min(
      live.budget.maxTotalOutputBytes,
      admission.budget.maxCommandStdoutBytes
    ),
    maxCommandStderrBytes: Math.min(
      live.budget.maxTotalOutputBytes,
      admission.budget.maxCommandStderrBytes
    ),
    maxExecutableBytes: Math.min(
      live.budget.maxExecutableObservedBytes,
      admission.budget.maxExecutableBytes
    )
  });
  let failure: GitReadSessionFailureV1 | null = null;
  let processCount = live.counter.commandCount;
  let stdoutBytes = live.counter.stdoutBytes;
  let stderrBytes = live.counter.stderrBytes;
  let recordCount = live.counter.records;
  let argumentBytes = live.counter.argumentBytes;
  let closed = false;
  let terminalReceipt: WindowsControlCliTerminalReceiptV1 | undefined;
  let closePromise: Promise<WindowsControlCliTerminalReceiptV1> | undefined;
  const providerIdentity: GitReadProviderIdentityV1 = Object.freeze({
    route: 'windows-control-cli-v1',
    providerRevision: live.providerRevision,
    profileId: live.profileId,
    specDigest: live.specDigest
  });
  const fail = (
    reason: GitReadSessionFailureV1['reason'],
    detail: string,
    providerReason?: WindowsControlCliSessionResolutionReasonV1
  ): GitReadSessionFailureV1 => {
    failure ??= Object.freeze({
      kind: 'unresolved-git-read-session',
      reason,
      detail,
      detailDigest: rawSha256(JSON.stringify({
        route: 'windows-control-cli-v1',
        providerRevision: live.providerRevision,
        profileId: live.profileId,
        specDigest: live.specDigest,
        reason,
        detail,
        providerReason: providerReason ?? null
      })),
      ...(providerReason === undefined ? {} : { providerReason })
    });
    return failure;
  };
  const assertLive = (): GitReadSessionFailureV1 | null => {
    if (failure !== null) return failure;
    if (closed || live.lifecycleState === 'disposed' || live.lifecycleState === 'invalidated') {
      return fail('command-error', 'Windows control CLI provider session is no longer active.');
    }
    if (Date.now() >= deadlineAt || performance.now() >= admission.deadlineMonotonicAt) {
      return fail(
        'deadline-exhausted',
        'Windows control CLI provider session deadline elapsed.',
        'session-deadline-exhausted'
      );
    }
    if (processCount >= budget.maxProcesses) {
      return fail(
        'process-budget-exhausted',
        'Windows control CLI provider command budget exhausted.',
        'command-budget-exhausted'
      );
    }
    return null;
  };
  const session: GitReadSessionV1 = {
    cwd: input.cwd,
    // This is a route label, never a path or PATH-resolved executable.
    gitExecutable: 'windows-control-cli-v1:git',
    gitExecutableIdentity: null,
    providerRoute: 'windows-control-cli-v1',
    providerIdentity,
    env: Object.freeze({}),
    budget,
    startedAt,
    deadlineAt,
    get processCount() { return processCount; },
    get stdoutBytes() { return stdoutBytes; },
    get stderrBytes() { return stderrBytes; },
    get argumentBytes() { return argumentBytes; },
    get executableBytes() { return live.counter.executableObservedBytes; },
    get recordCount() { return recordCount; },
    get rootObservedBytes() { return live.counter.rootObservedBytes; },
    get reopenRefreshes() { return live.counter.reopenRefreshes; },
    get settlementAttempts() { return live.counter.settlementAttempts; },
    get failure() { return failure; },
    workingDirectoryIdentity: null,
    verifyWorkingDirectory: () => assertLive() === null,
    verifyExecutable: () => assertLive() === null,
    run: async (args: readonly string[]): Promise<GitReadSessionCommandV1> => {
      const admissionFailure = assertLive();
      if (admissionFailure !== null) return admissionFailure;
      const commandArgumentBytes = gitReadCommandArgumentBytesV1(args);
      if (commandArgumentBytes === null) {
        return fail(
          'command-error',
          'Windows control CLI Git arguments are invalid.',
          'command-arguments-invalid'
        );
      }
      if (argumentBytes + commandArgumentBytes > budget.maxTotalArgumentBytes) {
        return fail(
          'argument-budget-exhausted',
          'Windows control CLI Git argument-byte budget exhausted.',
          'command-budget-exhausted'
        );
      }
      argumentBytes += commandArgumentBytes;
      try {
        const result = await live.run('git', args);
        processCount = result.counter.commandCount;
        stdoutBytes = result.counter.stdoutBytes;
        stderrBytes = result.counter.stderrBytes;
        recordCount = result.counter.records;
        argumentBytes = Math.max(argumentBytes, result.counter.argumentBytes);
        // A live provider must not extend the semantic owner's absolute
        // deadline merely because its Promise settled after the command
        // started. Check both clocks after settlement, before projecting the
        // result to the Git byte transport.
        if (Date.now() >= deadlineAt || performance.now() >= admission.deadlineMonotonicAt) {
          return fail(
            'deadline-exhausted',
            'Windows control CLI provider result exceeded the Git read session deadline.',
            'session-deadline-exhausted'
          );
        }
        if (processCount > budget.maxProcesses) {
          return fail(
            'process-budget-exhausted',
            'Windows control CLI provider result exceeded the Git process budget.',
            'command-budget-exhausted'
          );
        }
        if (stdoutBytes > budget.maxStdoutBytes || stdoutBytes + stderrBytes > maxTotalOutputBytes) {
          return fail(
            'stdout-budget-exhausted',
            'Windows control CLI provider result exceeded the Git stdout/output budget.',
            'command-output-budget-exhausted'
          );
        }
        if (stderrBytes > budget.maxStderrBytes) {
          return fail(
            'stderr-budget-exhausted',
            'Windows control CLI provider result exceeded the Git stderr budget.',
            'command-output-budget-exhausted'
          );
        }
        if (argumentBytes > budget.maxTotalArgumentBytes) {
          return fail(
            'argument-budget-exhausted',
            'Windows control CLI provider result exceeded the Git argument budget.',
            'command-budget-exhausted'
          );
        }
        if (recordCount > budget.maxRecords) {
          return fail(
            'record-budget-exhausted',
            'Windows control CLI provider result exceeded the Git record budget.',
            'command-budget-exhausted'
          );
        }
        return {
          kind: 'completed',
          result: {
            code: result.code,
            stdout: new Uint8Array(result.stdout),
            stderr: new TextDecoder().decode(result.stderr)
          }
        };
      } catch (error) {
        const providerReason = windowsControlCliProviderReason(error);
        const reason = providerReason === 'session-deadline-exhausted'
          || Date.now() >= deadlineAt
          || performance.now() >= admission.deadlineMonotonicAt
          ? 'deadline-exhausted'
          : mapWindowsControlCliFailureReason(providerReason);
        return fail(
          reason,
          error instanceof Error ? error.message : String(error),
          providerReason
        );
      }
    },
    consumeRecords: (count: number): GitReadSessionFailureV1 | null => {
      const admissionFailure = assertLive();
      if (admissionFailure !== null) return admissionFailure;
      if (!Number.isSafeInteger(count) || count < 0 || recordCount + count > budget.maxRecords) {
        return fail('record-budget-exhausted', 'Windows control CLI provider record budget exhausted.');
      }
      recordCount += count;
      return null;
    },
    close: async () => {
      if (closePromise !== undefined) return closePromise;
      closePromise = (async (): Promise<WindowsControlCliTerminalReceiptV1> => {
        const receipt = await live.close();
        terminalReceipt = receipt;
        closed = true;
        if (receipt.status === 'invalidated') {
          const providerReason = receipt.reason ?? undefined;
          fail(
            mapWindowsControlCliFailureReason(providerReason),
            'Windows control CLI provider session closed with an invalidated terminal receipt.',
            providerReason
          );
        }
        return receipt;
      })();
      return closePromise;
    }
  };
  return Object.freeze(session);
}

/**
 * Authority-sensitive Git admission.  The Windows resolver is the first
 * operation on that host: no PATH lookup, path scan, or child process can run
 * until its retained official control-CLI provider is ready.  POSIX hosts use
 * a separately named local provider route; that route is not a Windows
 * fallback and is never selected on win32.
 */
export function createAuthorityGitReadSessionV1(input: Readonly<{
  cwd: string;
  environment?: Readonly<Record<string, string | undefined>>;
  budget?: Partial<GitReadSessionBudgetV1>;
  source?: NodeJS.ProcessEnv;
  /** Optional parent absolute wall deadline; never broadens the local budget. */
  deadlineAtUnixMs?: number;
}>): GitReadSessionResolutionV1 {
  const budget = createGitReadBudget(input.budget);
  if (process.platform === 'win32') {
    const startedAt = Date.now();
    const startedMonotonicAt = performance.now();
    const deadlineAt = boundedGitReadDeadlineAtV1(
      startedAt,
      budget,
      input.deadlineAtUnixMs
    );
    const resolution = resolveWindowsControlCliSessionV1(
      createWindowsControlCliSessionRequestV1(input.cwd, budget, deadlineAt)
    );
    void startedMonotonicAt;
    return projectWindowsProviderFailure(resolution);
  }
  const session = createHostGitReadSessionV1(input);
  if (session.gitExecutable.length === 0
      || session.gitExecutableIdentity === null
      || session.providerIdentity === null
      || session.failure !== null) {
    return projectHostProviderFailure(session);
  }
  return Object.freeze({
    status: 'ready' as const,
    route: 'host-local-git-v1' as const,
    session
  });
}

/**
 * Explicit test-only host route.  Production affected-plan callers must use
 * createAuthorityGitReadSessionV1; this factory exists solely for unit tests
 * that exercise the host transport on a Windows development machine without
 * pretending that PATH Git is the Windows authority provider.
 */
export function createHostGitReadSessionForTestsV1(input: Readonly<{
  cwd: string;
  environment?: Readonly<Record<string, string | undefined>>;
  budget?: Partial<GitReadSessionBudgetV1>;
  source?: NodeJS.ProcessEnv;
  deadlineAtUnixMs?: number;
}>): GitReadSessionV1 {
  return createHostGitReadSessionV1(input);
}
