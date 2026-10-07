import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  fstatSync, lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  rmSync
} from 'node:fs';
import path from 'node:path';
import { isResourceCompositeSettlementError, settleResources, type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import type { VerificationActionKeyDigest } from '../../../../execution/verification/action.ts';
import type { DependencyMaterializationRecovery, HostedActionExecutionTicket, HostedActionResolution, HostedDependencyArchiveProjection, HostedSutInventory, PreparedTrustedBootstrapSutInputs } from "../../../../execution/verification/hosted.ts";
import {
  assertGitCandidateCheckoutCurrent, gitCandidateCheckoutRecipeBinding,
  materializeGitCandidateCheckoutTransport, readGitCandidateCheckout, recordGitCandidateCheckoutCleanupUnknown, runGitCandidateCheckoutRecipe,
  type GitCandidateCheckout
} from '../../../providers/git-bundle/runtime.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowDirectory,
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { bindProcessResourceCommandIssuer, createProcessResourceCommandIssuer, runBoundProcessResourceCommand, type ProcessResourceCommandBinding, type ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { issueRetainedCommandBoundary } from '../../../runtime-state/physical/runtime/process.ts';
import {
  CodexDevelopmentWorkPackageManifestDigest
} from '../../../self-hosting/control/task/contract/work-package.ts';
import { encodeVerificationActionData } from '../action/contract/action.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, type VerificationActionProviderOrigin } from '../action/contract/provider.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY
} from './contract/revision.ts';

import { parseNativeHostedCandidatePreparation, type TrustedBootstrapCandidatePreparation } from './contract/hosted-sut-command-plan.ts';
import { CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, ciActionDigest, exactObject } from './verification-hosted-action-contract.ts';
import { positiveEnvironmentInteger, writeHostedActionJson } from './verification-shared.ts';

export function hostedActionRepositoryIdentity(): Readonly<{
  repositoryId: number;
  repository: string;
}> {
  const repositoryId = positiveEnvironmentInteger('GITHUB_REPOSITORY_ID');
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error('GITHUB_REPOSITORY must be one exact owner/name identity.');
  }
  return Object.freeze({ repositoryId, repository });
}

export function currentHostedActionProducer(): VerificationActionProviderOrigin {
  const identity = hostedActionRepositoryIdentity();
  const runId = process.env.GITHUB_RUN_ID ?? '';
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('GITHUB_RUN_ID must be a positive integer.');
  const runAttempt = positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT');
  const workflowSha = process.env.GITHUB_WORKFLOW_SHA ?? '';
  if (!/^[0-9a-f]{40}$/u.test(workflowSha)) throw new Error('GITHUB_WORKFLOW_SHA must be one full SHA.');
  return Object.freeze({
    ...identity,
    workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${workflowSha}`,
    workflowSha,
    runId,
    runAttempt,
    appId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id,
    appNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.nodeId,
    sourceEvent: 'repository_dispatch' as const
  });
}

function gitCandidateBytes(repositoryRoot: string, args: readonly string[]): Buffer {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Hosted Action candidate Git readback failed: ${String(result.stderr).slice(0, 512)}`);
  }
  return result.stdout;
}

function retainedHostedActionFileBytes(filePath: string, label: string): Buffer {
  const absolute = path.resolve(filePath);
  const parent = inspectNoFollowDirectoryChain(path.dirname(absolute), `${label} parent`);
  const retained = retainNoFollowOrdinaryFile(
    parent,
    path.basename(absolute),
    undefined,
    label
  );
  let bytes: Buffer | undefined;
  let primary: ResourceSettlementFailure | undefined;
  try {
    bytes = Buffer.from(retained.readBytes());
    retained.assertCurrent();
  } catch (error) { primary = { label: `${label} read`, error }; }
  settleResources({ primary, cleanup: [{ label: `${label} close`, settle: () => retained.dispose() }] });
  if (bytes === undefined) throw new Error('Hosted Action retained read produced no bytes.');
  return bytes;
}

export function hostedActionFileDigest(filePath: string): VerificationActionKeyDigest {
  const descriptor = openSync(path.resolve(filePath), 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let primary: ResourceSettlementFailure | undefined;
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } catch (error) { primary = { label: 'hosted-action-file-digest-read', error }; }
  settleResources({ primary, cleanup: [{ label: 'hosted-action-file-digest-close', settle: () => closeSync(descriptor) }] });
  return `sha256:${hash.digest('hex')}`;
}

export type CodexDevelopmentRetainedHostedSutArchive = Readonly<{
  fileDescriptor: number;
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}>;

function hostedActionArchiveMaximumBytes(): number {
  // Retain the archive owner's framing allowance for bounded PAX/long-name headers.
  return CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes +
    HOSTED_ACTION_ARCHIVE_MAX_ENTRIES * 8192;
}

function retainedHostedSutArchiveObservation(fileDescriptor: number): Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}> {
  const before = fstatSync(fileDescriptor, { bigint: true });
  if (!before.isFile() || before.size < 0n || before.size > BigInt(hostedActionArchiveMaximumBytes())) {
    throw new Error('Hosted SUT retained archive is not one bounded ordinary file.');
  }
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  while (offset < Number(before.size)) {
    const bytes = readSync(
      fileDescriptor,
      buffer,
      0,
      Math.min(buffer.byteLength, Number(before.size) - offset),
      offset
    );
    if (bytes === 0) throw new Error('Hosted SUT retained archive ended before its retained size.');
    hash.update(buffer.subarray(0, bytes));
    offset += bytes;
  }
  const after = fstatSync(fileDescriptor, { bigint: true });
  const identity = (value: typeof before) => Object.freeze({
    device: value.dev.toString(),
    inode: value.ino.toString(),
    mode: value.mode.toString(),
    size: value.size.toString(),
    modifiedAtNs: value.mtimeNs.toString(),
    changedAtNs: value.ctimeNs.toString()
  });
  const beforeIdentity = identity(before);
  const afterIdentity = identity(after);
  if (encodeVerificationActionData(beforeIdentity) !== encodeVerificationActionData(afterIdentity)) {
    throw new Error('Hosted SUT retained archive changed while its bytes were observed.');
  }
  return Object.freeze({
    archiveDigest: `sha256:${hash.digest('hex')}`,
    identityDigest: ciActionDigest(beforeIdentity)
  });
}

export function retainHostedSutArchive(
  filePath: string,
  expectedDigest: VerificationActionKeyDigest
): CodexDevelopmentRetainedHostedSutArchive {
  return retainObservedHostedSutArchive(filePath, expectedDigest);
}

function retainObservedHostedSutArchive(
  filePath: string,
  expectedDigest?: VerificationActionKeyDigest
): CodexDevelopmentRetainedHostedSutArchive {
  const fileDescriptor = openSync(path.resolve(filePath), fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | (process.platform === 'linux' ? fsConstants.O_NOFOLLOW : 0));
  try {
    const observed = retainedHostedSutArchiveObservation(fileDescriptor);
    if (expectedDigest !== undefined && observed.archiveDigest !== expectedDigest) {
      throw new Error('Hosted SUT retained archive differs from its authenticated digest.');
    }
    return Object.freeze({ fileDescriptor, ...observed });
  } catch (error) {
    settleResources({ primary: { label: 'hosted-sut-archive-observation', error }, cleanup: [{
      label: 'hosted-sut-archive-failed-acquisition-close', settle: () => closeSync(fileDescriptor)
    }] });
    throw error;
  }
}

export function assertRetainedHostedSutArchive(
  retained: CodexDevelopmentRetainedHostedSutArchive
): VerificationActionKeyDigest {
  const observed = retainedHostedSutArchiveObservation(retained.fileDescriptor);
  if (observed.archiveDigest !== retained.archiveDigest ||
      observed.identityDigest !== retained.identityDigest) {
    throw new Error('Hosted SUT retained archive changed after authentication.');
  }
  return observed.archiveDigest;
}

/** Verify prepared candidate bytes before the durable start tombstone exists. */
export async function CodexDevelopmentAssertPreparedHostedActionCandidate(input: Readonly<{
  resolution: HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>;
  candidateRoot: string;
  checkout: GitCandidateCheckout;
}>): Promise<void> {
  const checkout = input.checkout;
  assertGitCandidateCheckoutCurrent(checkout);
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  if (checkout.purpose !== 'action-materialization' || candidateRoot !== checkout.candidateRoot) {
    throw new Error('Action candidate inspection requires its original private checkout.');
  }
  const candidateIdentity = inspectNoFollowDirectoryChain(
    candidateRoot, 'Hosted Action prepared candidate root'
  ).target;
  const gitText = async (...args: string[]): Promise<string> =>
    (await privateCandidateGitBytes(checkout, candidateRoot, args)).toString('utf8').trim();
  if ((await gitText('rev-parse', 'HEAD')) !== resolution.artifactInput.headSha ||
      (await gitText('rev-parse', 'HEAD^{tree}')) !== resolution.artifactInput.headTreeSha ||
      (await gitText('status', '--porcelain=v1', '--untracked-files=all')) !== '') {
    throw new Error('Hosted Action prepared candidate is not the exact clean resolved head/tree.');
  }
  for (const entry of resolution.actionPlan.action.inputClosure) {
    if (entry.path.includes('\\') || entry.path.startsWith('/') || entry.path.split('/').some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )) {
      throw new Error('Hosted Action input closure contains a non-canonical repository path.');
    }
    const absolute = path.resolve(candidateRoot, ...entry.path.split('/'));
    const relative = path.relative(candidateRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Hosted Action input closure escapes the exact candidate root: ${entry.path}.`);
    }
    const trackedBytes = await privateCandidateGitBytes(checkout, candidateRoot, ['show', `${resolution.artifactInput.headSha}:${entry.path}`]);
    const candidateBytes = retainedHostedActionFileBytes(
      absolute, `Hosted Action candidate input ${entry.path}`
    );
    if (!trackedBytes.equals(candidateBytes)) {
      throw new Error(`Hosted Action prepared candidate input bytes drifted: ${entry.path}.`);
    }
  }
  const manifestSource = new TextDecoder('utf-8', { fatal: true }).decode(
    retainedHostedActionFileBytes(
      path.resolve(candidateRoot, ...resolution.artifactInput.manifestPath.split('/')),
      'Hosted Action candidate Work Package manifest'
    )
  );
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== resolution.artifactInput.manifestDigest) {
    throw new Error('Hosted Action prepared candidate manifest bytes differ from the trusted resolution.');
  }
  assertSameNoFollowDirectoryIdentity(candidateIdentity, 'Hosted Action prepared candidate root');
  assertGitCandidateCheckoutCurrent(checkout);
}



const HOSTED_ACTION_DEPENDENCY_AUTHORITY_PATHS = Object.freeze([
  '.bun-version', 'bun.lock', 'bunfig.toml', 'package.json'
] as const);

export function CodexDevelopmentHostedDependencyMaterializerEnvironment(): NodeJS.ProcessEnv {
  return Object.freeze({
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/sec-hosted-dependency-home',
    TMPDIR: '/tmp/sec-hosted-dependency-tmp',
    LANG: 'C.UTF-8',
    // Cache transport may restore this runner-private path before the trusted
    // materializer runs. Candidate code never sees the host path; every install
    // is driven by the exact trusted-base closure with lifecycle scripts off.
    BUN_INSTALL_CACHE_DIR: '/tmp/sec-hosted-dependency-home/.bun/install/cache',
    CI: '1'
  });
}

function hostedActionDependencyClosure(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  baseSha: string;
}>): Readonly<{
  schema: 'sec-hosted-action-base-dependency-closure-v1';
  baseSha: string;
  authority: readonly Readonly<{ path: string; bytesDigest: string }>[];
  installArgv: readonly string[];
  materializerEnvironment: NodeJS.ProcessEnv;
}> {
  if (!/^[0-9a-f]{40}$/u.test(input.baseSha)) {
    throw new Error('Hosted Action dependency base SHA is invalid.');
  }
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseRootChain = inspectNoFollowDirectoryChain(baseRoot, 'Hosted dependency base root');
  const candidateRootChain = inspectNoFollowDirectoryChain(candidateRoot, 'Hosted dependency candidate root');
  for (const root of [baseRoot, candidateRoot]) {
    const npmrc = path.resolve(root, '.npmrc');
    try {
      if (lstatSync(npmrc).isFile() || lstatSync(npmrc).isSymbolicLink()) {
        throw new Error('Hosted Action dependency materializer forbids repository .npmrc authority.');
      }
    } catch (error) {
      if (error instanceof Error && !('code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw error;
      }
    }
  }
  const authority = HOSTED_ACTION_DEPENDENCY_AUTHORITY_PATHS.map((relativePath) => {
    const baseFile = retainNoFollowOrdinaryFile(
      baseRootChain, relativePath, undefined, `Hosted dependency base authority ${relativePath}`
    );
    let candidateFile: RetainedNoFollowOrdinaryFile | undefined;
    let observed: Readonly<{ path: string; bytesDigest: string }> | undefined;
    let primary: ResourceSettlementFailure | undefined;
    try {
      // Once baseFile is acquired, every later acquisition belongs to this
      // settlement scope, including a failed candidate acquisition.
      candidateFile = retainNoFollowOrdinaryFile(
        candidateRootChain, relativePath, undefined, `Hosted dependency candidate authority ${relativePath}`
      );
      const baseBytes = Buffer.from(baseFile.readBytes());
      const candidateBytes = Buffer.from(candidateFile.readBytes());
      baseFile.assertCurrent();
      candidateFile.assertCurrent();
      if (!baseBytes.equals(candidateBytes)) {
        throw new Error(`Hosted Action candidate dependency authority drifted from exact base: ${relativePath}.`);
      }
      observed = Object.freeze({
        path: relativePath,
        bytesDigest: `sha256:${createHash('sha256').update(baseBytes).digest('hex')}`
      });
    } catch (error) { primary = { label: `hosted-dependency-authority:${relativePath}`, error }; }
    settleResources({ primary, cleanup: [
      { label: `hosted-dependency-candidate-close:${relativePath}`, settle: () => candidateFile?.dispose() },
      { label: `hosted-dependency-base-close:${relativePath}`, settle: () => baseFile.dispose() }
    ] });
    if (observed === undefined) throw new Error('Hosted dependency authority observation is unavailable.');
    return observed;
  });
  assertSameNoFollowDirectoryIdentity(baseRootChain.target, 'Hosted dependency base root');
  assertSameNoFollowDirectoryIdentity(candidateRootChain.target, 'Hosted dependency candidate root');
  return Object.freeze({
    schema: 'sec-hosted-action-base-dependency-closure-v1',
    baseSha: input.baseSha,
    authority: Object.freeze(authority),
    installArgv: Object.freeze(['bun', 'install', '--frozen-lockfile', '--ignore-scripts']),
    materializerEnvironment: CodexDevelopmentHostedDependencyMaterializerEnvironment()
  });
}

export function CodexDevelopmentAssertHostedActionDependencyInputsV1(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  baseSha: string;
}>): VerificationActionKeyDigest {
  return ciActionDigest(hostedActionDependencyClosure(input));
}

type HostedActionArchiveInventoryEntry = Readonly<{
  path: string;
  type: 'directory' | 'file' | 'hardlink' | 'symlink';
  linkTarget: string | null;
  size: number;
  mode: number;
  physicalContentDigest: VerificationActionKeyDigest | null;
  contentDigest: VerificationActionKeyDigest | null;
}>;

const HOSTED_ACTION_ARCHIVE_COMMANDS = createProcessResourceCommandIssuer();

const HOSTED_ACTION_ARCHIVE_MAX_ENTRIES = 250_000;

function strictPosixDescendant(root: string, candidate: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative);
}

export type CodexDevelopmentHostedDependencyPhysicalSnapshot = Readonly<{
  schema: 'sec-hosted-dependency-physical-snapshot-v1';
  root: PhysicalDirectoryIdentity;
  entries: readonly NoFollowDirectoryTreeInventoryEntry[];
}>;



export function CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(
  dependencyRoot: string
): CodexDevelopmentHostedDependencyPhysicalSnapshot {
  const root = inspectNoFollowDirectoryChain(
    path.resolve(dependencyRoot), 'Hosted dependency physical snapshot root'
  ).target;
  const entries = scanNoFollowDirectoryTreeInventory(root);
  if (entries.length > HOSTED_ACTION_ARCHIVE_MAX_ENTRIES) {
    throw new Error('Hosted dependency tree exceeds the archive entry bound.');
  }
  return Object.freeze({
    schema: 'sec-hosted-dependency-physical-snapshot-v1',
    root,
    entries
  });
}

function dependencyArchiveTarget(
  dependencyRoot: string,
  relativeLinkPath: string,
  rawTarget: string
): string {
  if (!path.posix.isAbsolute(dependencyRoot) || path.posix.normalize(dependencyRoot) !== dependencyRoot ||
      rawTarget === '' || rawTarget.includes('\0') || rawTarget.includes('\\')) {
    throw new Error('Hosted dependency symlink target or root is not canonical POSIX material.');
  }
  const linkPath = path.posix.join(dependencyRoot, relativeLinkPath);
  const lexicalTarget = path.posix.isAbsolute(rawTarget)
    ? path.posix.normalize(rawTarget)
    : path.posix.resolve(path.posix.dirname(linkPath), rawTarget);
  if (!strictPosixDescendant(dependencyRoot, linkPath) ||
      !strictPosixDescendant(dependencyRoot, lexicalTarget)) {
    throw new Error('Hosted dependency symlink escapes the exact dependency root.');
  }
  if (lexicalTarget === linkPath || strictPosixDescendant(lexicalTarget, linkPath)) {
    throw new Error('Hosted dependency symlink targets itself or an ancestor directory.');
  }
  return `node_modules/${path.posix.relative(dependencyRoot, lexicalTarget)}`;
}

/**
 * Proves that archive projection was read from one unchanged physical
 * dependency generation.  The source tree is never rewritten: absolute
 * in-root links are normalized only in the archive header, then every
 * dependency archive entry is compared with the retained pre-read snapshot.
 */
export function CodexDevelopmentAssertHostedDependencyArchiveProjection(input: Readonly<{
  before: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  after: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  archiveEntries: readonly HostedActionArchiveInventoryEntry[];
}>): HostedDependencyArchiveProjection {
  if (input.before.schema !== 'sec-hosted-dependency-physical-snapshot-v1' ||
      input.after.schema !== 'sec-hosted-dependency-physical-snapshot-v1' ||
      JSON.stringify(input.before) !== JSON.stringify(input.after)) {
    throw new Error('Hosted dependency physical generation changed during archive projection.');
  }
  const dependencyRoot = input.before.root.path.split(path.sep).join('/');
  if (!path.posix.isAbsolute(dependencyRoot) || path.posix.normalize(dependencyRoot) !== dependencyRoot) {
    throw new Error('Hosted dependency physical root is not one canonical POSIX path.');
  }
  const sourceByPath = new Map<string, NoFollowDirectoryTreeInventoryEntry>();
  for (const entry of input.before.entries) {
    const canonical = canonicalHostedArchivePath(entry.relativePath, 'dependency snapshot path', false);
    if (canonical === null || canonical !== entry.relativePath || sourceByPath.has(canonical)) {
      throw new Error('Hosted dependency physical snapshot contains a duplicate or noncanonical path.');
    }
    sourceByPath.set(canonical, entry);
  }
  const archivedDependencies = input.archiveEntries.filter(
    (entry) => entry.path === 'node_modules' || entry.path.startsWith('node_modules/')
  );
  const archiveByPath = new Map(archivedDependencies.map((entry) => [entry.path, entry]));
  if (archiveByPath.size !== archivedDependencies.length ||
      archiveByPath.get('node_modules')?.type !== 'directory' ||
      archivedDependencies.length !== input.before.entries.length + 1) {
    throw new Error('Hosted dependency archive projection has a missing, duplicate, or foreign entry.');
  }
  let linksProjected = 0;
  for (const [relativePath, source] of sourceByPath) {
    const archivePath = `node_modules/${relativePath}`;
    const archived = archiveByPath.get(archivePath);
    if (archived === undefined) {
      throw new Error(`Hosted dependency archive omits frozen entry: ${relativePath}.`);
    }
    if (source.kind === 'directory') {
      if (archived.type !== 'directory' || archived.linkTarget !== null ||
          archived.physicalContentDigest !== null) {
        throw new Error(`Hosted dependency archive directory differs from frozen entry: ${relativePath}.`);
      }
      continue;
    }
    if (source.kind === 'file') {
      if ((archived.type !== 'file' && archived.type !== 'hardlink') ||
          source.contentDigest === null || archived.physicalContentDigest !== source.contentDigest ||
          (archived.type === 'file' && archived.size !== source.size)) {
        throw new Error(`Hosted dependency archive file differs from frozen entry: ${relativePath}.`);
      }
      continue;
    }
    const expectedTarget = dependencyArchiveTarget(
      dependencyRoot, relativePath, source.linkTarget ?? ''
    );
    const targetRelativePath = expectedTarget.slice('node_modules/'.length);
    if (archived.type !== 'symlink' || archived.linkTarget !== expectedTarget ||
        archived.physicalContentDigest !== null || !sourceByPath.has(targetRelativePath)) {
      throw new Error(`Hosted dependency archive link differs from frozen entry: ${relativePath}.`);
    }
    linksProjected += 1;
  }
  const sourceSnapshotDigest = ciActionDigest(Object.freeze({
    schema: 'sec-hosted-dependency-physical-generation-v1',
    root: Object.freeze({
      device: input.before.root.device,
      inode: input.before.root.inode,
      objectId: input.before.root.objectId
    }),
    entries: input.before.entries
  }));
  const canonicalArchiveProjection = Object.freeze([...archivedDependencies]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return Object.freeze({
    schema: 'sec-hosted-dependency-archive-projection-v1',
    entriesObserved: input.before.entries.length,
    linksProjected,
    sourceSnapshotDigest,
    archiveProjectionDigest: ciActionDigest(canonicalArchiveProjection)
  });
}

const HOSTED_ACTION_ARCHIVE_MATERIALIZER_SCRIPT = [
  'import os, posixpath, stat, sys, tarfile',
  'candidate_root, dependency_root, output_root, output_name = sys.argv[1:5]',
  'candidate_dev, candidate_ino, dependency_dev, dependency_ino, output_dev, output_ino = sys.argv[5:11]',
  'max_entries, max_bytes = int(sys.argv[11]), int(sys.argv[12])',
  'flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)',
  'candidate_fd = os.open(candidate_root, flags)',
  'dependency_fd = os.open(dependency_root, flags)',
  'output_fd = os.open(output_root, flags)',
  'output_leaf_fd = None',
  'output_identity = None',
  'completed = False',
  'entries = 0',
  'file_bytes = 0',
  'seen = {}',
  'def identity(fd):',
  '  value = os.fstat(fd)',
  '  return str(value.st_dev), str(value.st_ino)',
  'def require_identity(fd, expected_dev, expected_ino, label):',
  '  if identity(fd) != (expected_dev, expected_ino): raise RuntimeError(label + " identity changed")',
  'def tar_info(name, value, kind):',
  '  info = tarfile.TarInfo(name=name)',
  '  info.uid = 0; info.gid = 0; info.uname = ""; info.gname = ""; info.mtime = 0',
  '  info.mode = stat.S_IMODE(value.st_mode); info.type = kind; info.size = 0',
  '  return info',
  'def same_stat(left, right):',
  '  return (left.st_dev, left.st_ino, left.st_mode, left.st_size, left.st_mtime_ns, left.st_ctime_ns) == (right.st_dev, right.st_ino, right.st_mode, right.st_size, right.st_mtime_ns, right.st_ctime_ns)',
  'def normalized_dependency_link(archive_name, raw_target):',
  '  if "\\x00" in raw_target or "\\\\" in raw_target: raise RuntimeError("dependency link is non-POSIX")',
  '  root = dependency_root.rstrip("/")',
  '  if posixpath.isabs(raw_target):',
  '    normalized = posixpath.normpath(raw_target)',
  '    if normalized == root or not normalized.startswith(root + "/"): raise RuntimeError("dependency link escapes exact root")',
  '    target = "node_modules/" + posixpath.relpath(normalized, root)',
  '  else:',
  '    target = posixpath.normpath(posixpath.join(posixpath.dirname(archive_name), raw_target))',
  '    if target == "node_modules" or not target.startswith("node_modules/"): raise RuntimeError("dependency link escapes exact root")',
  '  if target == archive_name or archive_name.startswith(target.rstrip("/") + "/"): raise RuntimeError("dependency link targets itself or ancestor")',
  '  return posixpath.relpath(target, posixpath.dirname(archive_name) or ".") if posixpath.isabs(raw_target) else raw_target',
  'def add_tree(archive, directory_fd, archive_prefix, dependency, top_level):',
  '  global entries, file_bytes, seen',
  '  before_directory = os.fstat(directory_fd)',
  '  for name in sorted(os.listdir(directory_fd)):',
  '    if top_level and not dependency and name in (".git", "node_modules"): continue',
  '    if not name or "/" in name or "\\x00" in name: raise RuntimeError("invalid source leaf")',
  '    entries += 1',
  '    if entries > max_entries: raise RuntimeError("archive entry bound exceeded")',
  '    archive_name = archive_prefix + "/" + name if archive_prefix else name',
  '    observed = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)',
  '    if stat.S_ISDIR(observed.st_mode):',
  '      child = os.open(name, flags, dir_fd=directory_fd)',
  '      try:',
  '        if not same_stat(observed, os.fstat(child)): raise RuntimeError("directory changed before retained traversal")',
  '        archive.addfile(tar_info(archive_name, observed, tarfile.DIRTYPE))',
  '        add_tree(archive, child, archive_name, dependency, False)',
  '        if not same_stat(observed, os.fstat(child)): raise RuntimeError("directory changed during retained traversal")',
  '      finally: os.close(child)',
  '    elif stat.S_ISREG(observed.st_mode):',
  '      leaf = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0), dir_fd=directory_fd)',
  '      try:',
  '        retained = os.fstat(leaf)',
  '        if not same_stat(observed, retained): raise RuntimeError("file changed before retained read")',
  '        key = (retained.st_dev, retained.st_ino)',
  '        if key in seen:',
  '          info = tar_info(archive_name, retained, tarfile.LNKTYPE); info.linkname = seen[key]',
  '          archive.addfile(info)',
  '        else:',
  '          seen[key] = archive_name',
  '          file_bytes += retained.st_size',
  '          if file_bytes > max_bytes: raise RuntimeError("archive file byte bound exceeded")',
  '          info = tar_info(archive_name, retained, tarfile.REGTYPE); info.size = retained.st_size',
  '          with os.fdopen(os.dup(leaf), "rb", closefd=True) as stream: archive.addfile(info, stream)',
  '        if not same_stat(retained, os.fstat(leaf)): raise RuntimeError("file changed during retained read")',
  '      finally: os.close(leaf)',
  '    elif stat.S_ISLNK(observed.st_mode):',
  '      link_fd = os.open(name, os.O_PATH | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0), dir_fd=directory_fd)',
  '      try:',
  '        retained = os.fstat(link_fd)',
  '        if not same_stat(observed, retained): raise RuntimeError("link changed before retained read")',
  '        raw_target = os.readlink("", dir_fd=link_fd)',
  '        info = tar_info(archive_name, retained, tarfile.SYMTYPE)',
  '        info.linkname = normalized_dependency_link(archive_name, raw_target) if dependency else raw_target',
  '        archive.addfile(info)',
  '        if not same_stat(retained, os.fstat(link_fd)) or os.readlink("", dir_fd=link_fd) != raw_target: raise RuntimeError("link changed during retained read")',
  '      finally: os.close(link_fd)',
  '    else: raise RuntimeError("unsupported source entry")',
  '  if not same_stat(before_directory, os.fstat(directory_fd)): raise RuntimeError("directory changed during enumeration")',
  'try:',
  '  require_identity(candidate_fd, candidate_dev, candidate_ino, "candidate root")',
  '  require_identity(dependency_fd, dependency_dev, dependency_ino, "dependency root")',
  '  require_identity(output_fd, output_dev, output_ino, "output root")',
  '  output_leaf_fd = os.open(output_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o600, dir_fd=output_fd)',
  '  output_identity = identity(output_leaf_fd)',
  '  with os.fdopen(output_leaf_fd, "wb", closefd=True) as output_stream:',
  '    output_leaf_fd = None',
  '    with tarfile.open(fileobj=output_stream, mode="w:", format=tarfile.PAX_FORMAT, dereference=False) as archive:',
  '      seen = {}; add_tree(archive, candidate_fd, "", False, True)',
  '      dependency_stat = os.fstat(dependency_fd)',
  '      archive.addfile(tar_info("node_modules", dependency_stat, tarfile.DIRTYPE))',
  '      entries += 1',
  '      if entries > max_entries: raise RuntimeError("archive entry bound exceeded")',
  '      seen = {}; add_tree(archive, dependency_fd, "node_modules", True, True)',
  '    output_stream.flush(); os.fsync(output_stream.fileno())',
  '  os.fsync(output_fd)',
  '  require_identity(candidate_fd, candidate_dev, candidate_ino, "candidate root")',
  '  require_identity(dependency_fd, dependency_dev, dependency_ino, "dependency root")',
  '  require_identity(output_fd, output_dev, output_ino, "output root")',
  '  completed = True',
  'finally:',
  '  if output_leaf_fd is not None: os.close(output_leaf_fd)',
  '  if not completed and output_identity is not None:',
  '    try:',
  '      current = os.stat(output_name, dir_fd=output_fd, follow_symlinks=False)',
  '      if (str(current.st_dev), str(current.st_ino)) == output_identity:',
  '        os.unlink(output_name, dir_fd=output_fd); os.fsync(output_fd)',
  '    except FileNotFoundError: pass',
  '  os.close(output_fd); os.close(dependency_fd); os.close(candidate_fd)'
].join('\n');

function prepareHostedArchiveProjection(input: Readonly<{
  candidateRoot: string;
  expectedCandidateRoot?: PhysicalDirectoryIdentity;
  dependencySnapshot: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  outputDirectory: string;
}>) {
  if (process.platform !== 'linux') {
    throw new Error('Trusted bootstrap retained archive projection requires the Linux provider.');
  }
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const dependencyRoot = realpathSync.native(path.resolve(input.dependencySnapshot.root.path));
  const outputDirectory = realpathSync.native(path.resolve(input.outputDirectory));
  const candidate = input.expectedCandidateRoot === undefined
    ? inspectNoFollowDirectoryChain(
        candidateRoot, 'Trusted bootstrap archive candidate root'
      ).target
    : assertSameNoFollowDirectoryIdentity(
        input.expectedCandidateRoot, 'Trusted bootstrap archive candidate root'
      ).target;
  if (candidate.path !== candidateRoot) {
    throw new Error('Trusted bootstrap archive candidate root is not canonical.');
  }
  const dependency = assertSameNoFollowDirectoryIdentity(
    input.dependencySnapshot.root, 'Trusted bootstrap archive dependency root'
  ).target;
  const output = inspectNoFollowDirectoryChain(
    outputDirectory, 'Trusted bootstrap archive output root'
  ).target;
  if (dependency.path !== dependencyRoot) {
    throw new Error('Trusted bootstrap archive dependency snapshot root is not canonical.');
  }
  const archiveName = 'prepared-candidate.tar';
  const archivePath = path.resolve(outputDirectory, archiveName);
  if (existsSync(archivePath)) {
    throw new Error('Trusted bootstrap prepared candidate archive already exists.');
  }
  const args = Object.freeze([
    '-c', HOSTED_ACTION_ARCHIVE_MATERIALIZER_SCRIPT,
    candidate.path, dependency.path, output.path, archiveName,
    candidate.device, candidate.inode, dependency.device, dependency.inode,
    output.device, output.inode,
    String(HOSTED_ACTION_ARCHIVE_MAX_ENTRIES),
    String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes)
  ]);
  return Object.freeze({ cwd: candidateRoot, args, archivePath, readback: (): string => {
    assertSameNoFollowDirectoryIdentity(candidate, 'Trusted bootstrap archive candidate root');
    assertSameNoFollowDirectoryIdentity(dependency, 'Trusted bootstrap archive dependency root');
    assertSameNoFollowDirectoryIdentity(output, 'Trusted bootstrap archive output root');
    const archive = lstatSync(archivePath);
    if (!archive.isFile() || archive.isSymbolicLink() || realpathSync.native(archivePath) !== archivePath) {
      throw new Error('Trusted bootstrap retained archive projection did not publish one ordinary output.');
    }
    return archivePath;
  } });
}

export function CodexDevelopmentMaterializeTrustedBootstrapArchive(input: Readonly<{
  candidateRoot: string;
  expectedCandidateRoot?: PhysicalDirectoryIdentity;
  dependencySnapshot: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  outputDirectory: string;
}>): string {
  const plan = prepareHostedArchiveProjection(input);
  runHostedMaterializerCommand('/usr/bin/python3', plan.args, 'Trusted bootstrap retained archive projection');
  return plan.readback();
}

const HOSTED_ACTION_ARCHIVE_INVENTORY_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
/** Five subject reads, two loaded-source reads, four root/clean reads, six Git transport commands and
 * the two original retained archive recipes. No install/retry is admitted. */
export const TRUSTED_BOOTSTRAP_PREPARATION_COMMAND_BUDGET = Object.freeze({
  commands: 19,
  outputBytes: 18 * (1024 * 1024 + 64 * 1024) + HOSTED_ACTION_ARCHIVE_INVENTORY_MAX_OUTPUT_BYTES + 64 * 1024
});

// One source for the production decoded reader and finite in-memory boundary regressions.
export const HOSTED_ACTION_ARCHIVE_DECODED_READER_SCRIPT = [
  "class HostedArchiveDecodedBudget:",
  "  def __init__(self, ceiling, maximum_read_bytes, discard_chunk_bytes):",
  "    if any(type(value) is not int or value < 1 for value in (ceiling, maximum_read_bytes, discard_chunk_bytes)) or discard_chunk_bytes > maximum_read_bytes:",
  "      raise RuntimeError(\"archive decoded budget is invalid\")",
  "    self.remaining = ceiling",
  "    self.maximum_read_bytes = maximum_read_bytes",
  "    self.discard_chunk_bytes = discard_chunk_bytes",
  "  def reserve(self, size):",
  "    if type(size) is not int or size < 0 or size > self.remaining:",
  "      raise RuntimeError(\"archive decoded byte bound exceeded\")",
  "    self.remaining -= size",
  "class HostedArchiveDecodedReader:",
  "  def __init__(self, stream, budget):",
  "    if stream.tell() != 0: raise RuntimeError(\"archive decoded stream is not at its origin\")",
  "    # Retain headroom for one stdlib BufferedReader lookahead, including a failed format probe.",
  "    budget.reserve(io.DEFAULT_BUFFER_SIZE)",
  "    self.stream = stream; self.budget = budget; self.position = 0",
  "  def tell(self): return self.position",
  "  def seekable(self): return True",
  "  def read(self, size=-1):",
  "    if type(size) is not int or size < 0 or size > self.budget.maximum_read_bytes:",
  "      raise RuntimeError(\"archive decoded read allocation bound exceeded\")",
  "    # Reserve before decoding; failures/short reads do not renew the shared budget.",
  "    self.budget.reserve(size)",
  "    data = self.stream.read(size)",
  "    if not isinstance(data, bytes) or len(data) > size: raise RuntimeError(\"archive decoded read exceeded its request\")",
  "    self.position += len(data)",
  "    return data",
  "  def seek(self, offset, whence=0):",
  "    if type(offset) is not int or whence not in (0, 1): raise RuntimeError(\"archive decoded seek is unsupported\")",
  "    target = offset if whence == 0 else self.position + offset",
  "    if target < self.position: raise RuntimeError(\"archive decoded backward seek is unsupported\")",
  "    if target - self.position > self.budget.remaining: raise RuntimeError(\"archive decoded byte bound exceeded\")",
  "    # Never delegate seek: decompressor seeks discard bytes outside member-size accounting.",
  "    while self.position < target:",
  "      if not self.read(min(self.budget.discard_chunk_bytes, target - self.position)):",
  "        raise RuntimeError(\"archive decoded stream ended during forward seek\")",
  "    return self.position",
  "  def close(self): self.stream.close()"
].join('\n');

// TarInfo bounds extended headers before the stdlib allocates their payload.
const HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT = [
  "import hashlib, io, json, os, resource, stat, sys, tarfile, unicodedata",
  "max_entries, max_bytes, max_member_bytes, max_output_bytes, max_archive_bytes, max_memory_bytes, max_cpu_seconds = map(int, sys.argv[1:8])",
  "expected_digest = sys.argv[8]",
  "def narrow_limit(kind, ceiling):",
  "  inherited = resource.getrlimit(kind)",
  "  bound = min([ceiling] + [value for value in inherited if value != resource.RLIM_INFINITY])",
  "  resource.setrlimit(kind, (bound, bound))",
  "narrow_limit(resource.RLIMIT_AS, max_memory_bytes)",
  "narrow_limit(resource.RLIMIT_CPU, max_cpu_seconds)",
  "if len(sys.argv) not in (9, 10) or (len(sys.argv) == 10 and sys.argv[9] != '5'): raise RuntimeError(\"archive descriptor recipe is invalid\")",
  "source = os.fdopen(os.dup(3 if len(sys.argv) == 9 else 5), \"rb\")",
  "identity = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_mtime_ns, value.st_ctime_ns)",
  "before = os.fstat(source.fileno())",
  "if not stat.S_ISREG(before.st_mode) or before.st_size < 0 or before.st_size > max_archive_bytes: raise RuntimeError(\"archive ordinary-file bound exceeded\")",
  "def authenticate():",
  "  source.seek(0); hasher = hashlib.sha256(); observed = 0",
  "  while observed < before.st_size:",
  "    chunk = source.read(min(1048576, before.st_size - observed))",
  "    if not chunk: raise RuntimeError(\"archive ended before retained size\")",
  "    observed += len(chunk); hasher.update(chunk)",
  "  if identity(before) != identity(os.fstat(source.fileno())): raise RuntimeError(\"archive identity changed during retained inventory\")",
  "  if \"sha256:\" + hasher.hexdigest() != expected_digest: raise RuntimeError(\"archive differs from authenticated digest\")",
  "  source.seek(0)",
  "authenticate()",
  HOSTED_ACTION_ARCHIVE_DECODED_READER_SCRIPT,
  "decoded_budget = HostedArchiveDecodedBudget(max_archive_bytes, max_output_bytes, 1048576)",
  "class BoundedTarFile(tarfile.TarFile):",
  "  def __init__(self, name=None, mode=\"r\", fileobj=None, **kwargs):",
  "    if mode != \"r\" or fileobj is None: raise RuntimeError(\"archive reader requires one retained input\")",
  "    super().__init__(name, mode, HostedArchiveDecodedReader(fileobj, decoded_budget), **kwargs)",
  "metadata_bytes = 0",
  "class BoundedTarInfo(tarfile.TarInfo):",
  "  def _proc_member(self, archive):",
  "    global metadata_bytes",
  "    if self.size < 0: raise RuntimeError(\"archive member size invalid\")",
  "    if self.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE, tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK):",
  "      metadata_bytes += self._block(self.size)",
  "      if metadata_bytes > max_output_bytes: raise RuntimeError(\"archive metadata byte bound exceeded\")",
  "    elif self.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.CONTTYPE, tarfile.DIRTYPE, tarfile.SYMTYPE, tarfile.LNKTYPE):",
  "      raise RuntimeError(\"archive entry type is forbidden or unsupported\")",
  "    elif self.size > max_member_bytes: raise RuntimeError(\"archive member byte bound exceeded\")",
  "    return super()._proc_member(archive)",
  "  def _proc_gnusparse_00(self, *args): raise RuntimeError(\"archive sparse format is unsupported\")",
  "  def _proc_gnusparse_01(self, *args): raise RuntimeError(\"archive sparse format is unsupported\")",
  "  def _proc_gnusparse_10(self, *args): raise RuntimeError(\"archive sparse format is unsupported\")",
  "def canonical(value, root=False):",
  "  if \"\\0\" in value or \"\\\\\" in value or value.startswith(\"/\"): raise RuntimeError(\"archive path is unsafe\")",
  "  while value.startswith(\"./\"): value = value[2:]",
  "  value = value.rstrip(\"/\")",
  "  if root and value in (\"\", \".\"): return None",
  "  if not value or any(part in (\"\", \".\", \"..\") for part in value.split(\"/\")): raise RuntimeError(\"archive path is not canonical\")",
  "  return value",
  "def link_target(name, value, hardlink):",
  "  if \"\\0\" in value or \"\\\\\" in value or value.startswith(\"/\"): raise RuntimeError(\"archive link is unsafe\")",
  "  parts = [] if hardlink else name.split(\"/\")[:-1]",
  "  for part in value.split(\"/\"):",
  "    if part in (\"\", \".\"): continue",
  "    if part == \"..\":",
  "      if not parts: raise RuntimeError(\"archive link escapes its root\")",
  "      parts.pop()",
  "    else: parts.append(part)",
  "  if not parts: raise RuntimeError(\"archive link target is empty\")",
  "  return \"/\".join(parts)",
  "result = []; by_path = {}; folded_paths = set(); links = {}; total = 0; read_bytes = 0; output_bytes = 2",
  "with BoundedTarFile.open(fileobj=source, mode=\"r:*\", tarinfo=BoundedTarInfo) as archive:",
  "  for member in archive:",
  "    if len(result) >= max_entries: raise RuntimeError(\"archive entry bound exceeded\")",
  "    if member.size < 0 or member.size > max_member_bytes: raise RuntimeError(\"archive member byte bound exceeded\")",
  "    if member.issparse(): raise RuntimeError(\"archive sparse format is unsupported\")",
  "    kind = \"file\" if member.isreg() else \"directory\" if member.isdir() else \"symlink\" if member.issym() else \"hardlink\" if member.islnk() else \"unsupported\"",
  "    if kind == \"unsupported\" or member.mode < 0 or member.mode > 0o7777 or member.mode & 0o6000: raise RuntimeError(\"archive entry type or mode is forbidden\")",
  "    if kind != \"file\" and member.size != 0: raise RuntimeError(\"archive non-file has payload bytes\")",
  "    normalized = canonical(member.name, member.isdir())",
  "    if normalized is not None:",
  "      folded = unicodedata.normalize(\"NFC\", normalized).lower()",
  "      if folded in folded_paths: raise RuntimeError(\"archive duplicate or case-conflicting path\")",
  "      folded_paths.add(folded)",
  "    target = link_target(normalized, member.linkname, member.islnk()) if member.issym() or member.islnk() else None",
  "    total += member.size if member.isreg() else 0",
  "    if total > max_bytes: raise RuntimeError(\"archive aggregate file byte bound exceeded\")",
  "    digest = None; physical_digest = None",
  "    if member.isreg():",
  "      stream = archive.extractfile(member)",
  "      if stream is None: raise RuntimeError(\"archive ordinary payload is missing\")",
  "      hasher = hashlib.sha256(); physical_hasher = hashlib.sha256(); physical_hasher.update(b'{\"bytes\":\"'); observed = 0",
  "      with stream:",
  "        while observed < member.size:",
  "          chunk = stream.read(min(1048576, member.size - observed, max_bytes - read_bytes))",
  "          if not chunk: raise RuntimeError(\"archive ordinary payload is truncated\")",
  "          observed += len(chunk); read_bytes += len(chunk)",
  "          if observed > member.size or read_bytes > max_bytes: raise RuntimeError(\"archive content read bound exceeded\")",
  "          hasher.update(chunk); physical_hasher.update(chunk.hex().encode(\"ascii\"))",
  "      physical_hasher.update(b'\"}'); physical_digest = \"sha256:\" + physical_hasher.hexdigest()",
  "      if normalized in (\".sec-trusted-input/candidate.bundle\", \".sec-trusted-input/dependency-closure.json\"): digest = \"sha256:\" + hasher.hexdigest()",
  "    entry = {\"path\": member.name, \"type\": kind, \"linkTarget\": member.linkname if target is not None else None, \"size\": member.size, \"mode\": member.mode, \"physicalContentDigest\": physical_digest, \"contentDigest\": digest}",
  "    # Charge the final hardlink digest before retaining another result, not after json.dumps(result).",
  "    charged_entry = dict(entry)",
  "    if member.islnk(): charged_entry[\"physicalContentDigest\"] = \"sha256:\" + \"0\" * 64",
  "    output_bytes += len(json.dumps(charged_entry, ensure_ascii=True, separators=(\",\", \":\"), sort_keys=True)) + 1",
  "    if output_bytes > max_output_bytes: raise RuntimeError(\"archive inventory output byte bound exceeded\")",
  "    result.append(entry)",
  "    if normalized is not None: by_path[normalized] = entry",
  "    if target is not None: links[normalized] = target",
  "# Resolve hardlinks from already hashed ordinary entries, never reread their payloads.",
  "for name, entry in by_path.items():",
  "  if entry[\"type\"] != \"hardlink\" or entry[\"physicalContentDigest\"] is not None: continue",
  "  pending = []; seen = set(); cursor = name",
  "  while True:",
  "    if cursor in seen: raise RuntimeError(\"archive hardlink cycle\")",
  "    seen.add(cursor); target_entry = by_path.get(cursor)",
  "    if target_entry is None or target_entry[\"type\"] not in (\"file\", \"hardlink\"): raise RuntimeError(\"archive hardlink target is absent or invalid\")",
  "    if target_entry[\"physicalContentDigest\"] is not None: break",
  "    pending.append(target_entry); cursor = links[cursor]",
  "  for linked in pending: linked[\"physicalContentDigest\"] = target_entry[\"physicalContentDigest\"]",
  "authenticate()",
  "source.close()",
  "# iterencode bounds each serialization step; the caller independently caps the pipe.",
  "for chunk in json.JSONEncoder(ensure_ascii=True, separators=(\",\", \":\"), sort_keys=True).iterencode(result): sys.stdout.write(chunk)"
].join('\n');

function inspectHostedActionArchiveMetadata(
  retained: CodexDevelopmentRetainedHostedSutArchive,
  label: string
): unknown {
  assertRetainedHostedSutArchive(retained);
  const inventory = spawnSync(
    '/usr/bin/python3',
    ['-I', '-B', '-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT,
      String(HOSTED_ACTION_ARCHIVE_MAX_ENTRIES),
      String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes),
      String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes),
      String(HOSTED_ACTION_ARCHIVE_INVENTORY_MAX_OUTPUT_BYTES),
      String(hostedActionArchiveMaximumBytes()),
      String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes),
      String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds),
      retained.archiveDigest],
    {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: HOSTED_ACTION_ARCHIVE_INVENTORY_MAX_OUTPUT_BYTES,
      timeout: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds * 1_000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe', retained.fileDescriptor],
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
    }
  );
  assertRetainedHostedSutArchive(retained);
  if (inventory.error !== undefined || inventory.status !== 0 || typeof inventory.stdout !== 'string') {
    throw new Error(`${label} metadata is unreadable within retained archive bounds: ${String(inventory.stderr).slice(0, 1024)}`);
  }
  return JSON.parse(inventory.stdout) as unknown;
}

function canonicalHostedArchivePath(source: string, label: string, allowRoot: boolean): string | null {
  if (source.includes('\0') || source.includes('\\') || source.startsWith('/')) {
    throw new Error(`Hosted Action archive ${label} is absolute or non-POSIX.`);
  }
  let value = source;
  while (value.startsWith('./')) value = value.slice(2);
  while (value.endsWith('/')) value = value.slice(0, -1);
  if ((value === '' || value === '.') && allowRoot) return null;
  const segments = value.split('/');
  if (value === '' || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Hosted Action archive ${label} is not canonical.`);
  }
  return value;
}

function resolveHostedArchiveLinkTarget(entryPath: string, target: string, hardlink: boolean): string {
  if (target.includes('\0') || target.includes('\\') || target.startsWith('/')) {
    throw new Error(`Hosted Action archive link target is unsafe: ${entryPath}.`);
  }
  const stack = hardlink ? [] : entryPath.split('/').slice(0, -1);
  let value = target;
  while (value.startsWith('./')) value = value.slice(2);
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) throw new Error(`Hosted Action archive link escapes its root: ${entryPath}.`);
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  if (stack.length === 0) throw new Error(`Hosted Action archive link target is empty: ${entryPath}.`);
  return stack.join('/');
}

export function CodexDevelopmentValidateHostedActionArchiveInventory(
  source: unknown
): Readonly<{
  entries: readonly HostedActionArchiveInventoryEntry[];
  inventoryDigest: VerificationActionKeyDigest;
  totalFileBytes: number;
}> {
  if (!Array.isArray(source) || source.length === 0 || source.length > HOSTED_ACTION_ARCHIVE_MAX_ENTRIES) {
    throw new Error('Hosted Action archive inventory is empty or exceeds its entry bound.');
  }
  const entries: HostedActionArchiveInventoryEntry[] = [];
  const exactPaths = new Set<string>();
  const casePaths = new Map<string, string>();
  for (const raw of source) {
    const value = exactObject(raw, [
      'contentDigest', 'linkTarget', 'mode', 'path', 'physicalContentDigest', 'size', 'type'
    ], 'Hosted Action archive entry');
    if (typeof value.path !== 'string' || typeof value.type !== 'string' ||
        !Number.isSafeInteger(value.size) || Number(value.size) < 0 ||
        !Number.isSafeInteger(value.mode) || Number(value.mode) < 0 || Number(value.mode) > 0o7777 ||
        (value.linkTarget !== null && typeof value.linkTarget !== 'string') ||
        (value.contentDigest !== null && (typeof value.contentDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.contentDigest))) ||
        (value.physicalContentDigest !== null &&
          (typeof value.physicalContentDigest !== 'string' ||
            !/^sha256:[0-9a-f]{64}$/u.test(value.physicalContentDigest)))) {
      throw new Error('Hosted Action archive metadata is invalid.');
    }
    if (!['directory', 'file', 'hardlink', 'symlink'].includes(value.type)) {
      throw new Error(`Hosted Action archive entry type is forbidden: ${value.type}.`);
    }
    if (Number(value.size) > CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes ||
        (value.type !== 'file' && Number(value.size) !== 0)) {
      throw new Error('Hosted Action archive member bytes exceed the file bound or non-file payload is present.');
    }
    const entryPath = canonicalHostedArchivePath(value.path, 'entry path', value.type === 'directory');
    if (entryPath === null) continue;
    if ((Number(value.mode) & 0o6000) !== 0) {
      throw new Error(`Hosted Action archive set-id mode is forbidden: ${entryPath}.`);
    }
    const folded = entryPath.normalize('NFC').toLowerCase();
    const conflict = casePaths.get(folded);
    if (exactPaths.has(entryPath) || (conflict !== undefined && conflict !== entryPath)) {
      throw new Error(`Hosted Action archive contains a duplicate or case-conflicting path: ${entryPath}.`);
    }
    exactPaths.add(entryPath);
    casePaths.set(folded, entryPath);
    const linkTarget = value.type === 'hardlink' || value.type === 'symlink'
      ? resolveHostedArchiveLinkTarget(entryPath, String(value.linkTarget ?? ''), value.type === 'hardlink')
      : null;
    if (linkTarget === null && value.linkTarget !== null) {
      throw new Error(`Hosted Action archive ordinary entry has a link target: ${entryPath}.`);
    }
    const trustedContentPath = entryPath === '.sec-trusted-input/candidate.bundle' ||
      entryPath === '.sec-trusted-input/dependency-closure.json';
    const physicalContentEntry = value.type === 'file' || value.type === 'hardlink';
    if ((trustedContentPath && (value.type !== 'file' || value.contentDigest === null)) ||
        (!trustedContentPath && value.contentDigest !== null) ||
        (physicalContentEntry !== (value.physicalContentDigest !== null))) {
      throw new Error(`Hosted Action archive trusted content digest placement is invalid: ${entryPath}.`);
    }
    entries.push(Object.freeze({
      path: entryPath,
      type: value.type as HostedActionArchiveInventoryEntry['type'],
      linkTarget,
      size: Number(value.size),
      mode: Number(value.mode),
      physicalContentDigest: value.physicalContentDigest as VerificationActionKeyDigest | null,
      contentDigest: value.contentDigest as VerificationActionKeyDigest | null
    }));
  }
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    if (entry.linkTarget === null) continue;
    const target = byPath.get(entry.linkTarget);
    if (target === undefined || (entry.type === 'hardlink' && target.type !== 'file' && target.type !== 'hardlink')) {
      throw new Error(`Hosted Action archive link target is absent or has the wrong type: ${entry.path}.`);
    }
    if (entry.type === 'symlink' &&
        (entry.path === target.path || entry.path.startsWith(`${target.path}/`))) {
      throw new Error(`Hosted Action archive symlink targets itself or an ancestor: ${entry.path}.`);
    }
    if (entry.type === 'hardlink' && entry.physicalContentDigest !== target.physicalContentDigest) {
      throw new Error(`Hosted Action archive hardlink content differs from its target: ${entry.path}.`);
    }
  }
  // Cache only this immutable inventory's node identities. Shared tails are
  // checked once; path-only or cross-inventory cache entries cannot bless a node.
  const complete = new Set<HostedActionArchiveInventoryEntry>();
  for (const entry of entries) {
    const pending: HostedActionArchiveInventoryEntry[] = [];
    const seen = new Set<HostedActionArchiveInventoryEntry>();
    let cursor = entry;
    while (cursor.linkTarget !== null && !complete.has(cursor)) {
      if (seen.has(cursor)) throw new Error(`Hosted Action archive link cycle is forbidden: ${entry.path}.`);
      seen.add(cursor);
      pending.push(cursor);
      const target = byPath.get(cursor.linkTarget);
      if (target === undefined) throw new Error(`Hosted Action archive link chain is incomplete: ${entry.path}.`);
      cursor = target;
    }
    for (const node of pending) complete.add(node);
  }
  const totalFileBytes = entries.reduce((total, entry) => total + (entry.type === 'file' ? entry.size : 0), 0);
  if (!Number.isSafeInteger(totalFileBytes) ||
      totalFileBytes > CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes) {
    throw new Error('Hosted Action archive file bytes exceed the private workspace bound.');
  }
  const canonicalEntries = Object.freeze([...entries].sort((left, right) => left.path.localeCompare(right.path)));
  return Object.freeze({
    entries: canonicalEntries,
    inventoryDigest: ciActionDigest(canonicalEntries),
    totalFileBytes
  });
}

export function CodexDevelopmentInspectHostedActionArchiveInventory(
  archive: string,
  label: string = 'Hosted Action archive inventory'
): ReturnType<typeof CodexDevelopmentValidateHostedActionArchiveInventory> {
  const retained = retainObservedHostedSutArchive(archive);
  try {
    return CodexDevelopmentValidateHostedActionArchiveInventory(
      inspectHostedActionArchiveMetadata(retained, label)
    );
  } finally {
    closeSync(retained.fileDescriptor);
  }
}

type HostedActionArchiveInspectionInput = Readonly<{
  resolution: HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>;
  preparedCandidateArchive: string;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  inspectArchive?: (archive: string) => unknown;
}>;

function inspectHostedActionArchiveDetailed(
  input: HostedActionArchiveInspectionInput
): Readonly<{
  inventory: HostedSutInventory;
  entries: readonly HostedActionArchiveInventoryEntry[];
}> {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.baseDependencyClosureDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.authenticatedGitClosureDigest)) {
    throw new Error('Hosted Action archive expected Git or dependency closure digest is invalid.');
  }
  const archive = path.resolve(input.preparedCandidateArchive);
  const retained = retainObservedHostedSutArchive(archive);
  const archiveDigest = retained.archiveDigest;
  let rawInventory: unknown;
  let primary: ResourceSettlementFailure | undefined;
  try {
    rawInventory = input.inspectArchive === undefined
      ? inspectHostedActionArchiveMetadata(retained, 'Hosted Action prepared candidate archive')
      : input.inspectArchive(archive);
    assertRetainedHostedSutArchive(retained);
  } catch (error) { primary = { label: 'hosted-action-archive-inventory-observation', error }; }
  settleResources({ primary, cleanup: [{ label: 'hosted-action-archive-inventory-close',
    settle: () => closeSync(retained.fileDescriptor) }] });
  const validated = CodexDevelopmentValidateHostedActionArchiveInventory(rawInventory);
  for (const required of [
    ...resolution.actionPlan.action.inputClosure.map((entry) => entry.path),
    resolution.artifactInput.manifestPath,
    '.sec-trusted-input/candidate.bundle',
    '.sec-trusted-input/dependency-closure.json'
  ]) {
    const entry = validated.entries.find((candidate) => candidate.path === required);
    if (entry?.type !== 'file') {
      throw new Error(`Hosted Action archive omits one required ordinary input: ${required}.`);
    }
  }
  const gitBundleDigest = validated.entries.find(
    (entry) => entry.path === '.sec-trusted-input/candidate.bundle'
  )?.contentDigest;
  const dependencyClosureDigest = validated.entries.find(
    (entry) => entry.path === '.sec-trusted-input/dependency-closure.json'
  )?.contentDigest;
  if (gitBundleDigest !== input.authenticatedGitClosureDigest ||
      dependencyClosureDigest !== input.baseDependencyClosureDigest) {
    throw new Error('Hosted Action archive Git or dependency closure differs from trusted pre-start inputs.');
  }
  return Object.freeze({
    inventory: Object.freeze({
      archiveDigest,
      inventoryDigest: validated.inventoryDigest,
      entryCount: validated.entries.length,
      totalFileBytes: validated.totalFileBytes,
      dependencyClosureDigest,
      gitBundleDigest
    }),
    entries: validated.entries
  });
}

export function CodexDevelopmentInspectHostedActionArchive(
  input: HostedActionArchiveInspectionInput
): HostedSutInventory {
  return inspectHostedActionArchiveDetailed(input).inventory;
}

export type CodexDevelopmentPreparedHostedActionInputs = Readonly<{
  preparedCandidateArchive: string;
  archiveInventory: HostedSutInventory;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
}>;

function runHostedMaterializerCommand(
  executable: string,
  args: readonly string[],
  label: string,
  options: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv }> = {}
): void {
  const result = spawnSync(executable, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    cwd: options.cwd,
    env: options.env ?? {
      PATH: '/usr/bin:/bin',
      HOME: '/tmp/sec-hosted-materializer-home',
      LANG: 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${String(result.stderr).slice(0, 1024)}`);
  }
}



function dependencyMaterializationFailureDiagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2048);
}

function isBunTarballExtractionFailure(error: unknown): boolean {
  const diagnostic = dependencyMaterializationFailureDiagnostic(error);
  return diagnostic.includes('error: Fail extracting tarball for "') &&
    diagnostic.includes('error: Fail extracting tarball from ');
}

export function CodexDevelopmentRunBoundedDependencyMaterialization(
  runExactMaterialization: () => void
): DependencyMaterializationRecovery {
  try {
    runExactMaterialization();
    return Object.freeze({ attempts: 1, recoveredFrom: 'none' as const });
  } catch (firstError) {
    if (!isBunTarballExtractionFailure(firstError)) throw firstError;
    try {
      runExactMaterialization();
      return Object.freeze({ attempts: 2, recoveredFrom: 'bun-tarball-extraction' as const });
    } catch (secondError) {
      const firstDiagnostic = dependencyMaterializationFailureDiagnostic(firstError);
      const secondDiagnostic = dependencyMaterializationFailureDiagnostic(secondError);
      const firstDigest = createHash('sha256').update(firstDiagnostic).digest('hex');
      const secondDigest = createHash('sha256').update(secondDiagnostic).digest('hex');
      throw new Error(
        'Trusted bootstrap exact-base dependency materialization failed after one bounded ' +
        `Bun tarball-extraction recovery retry: first=sha256:${firstDigest} ` +
        `second=sha256:${secondDigest}; ${secondDiagnostic}`
      );
    }
  }
}

export async function CodexDevelopmentPrepareHostedActionInputs(input: Readonly<{
  resolution: HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>;
  baseRoot: string;
  candidateRoot: string;
  checkout: GitCandidateCheckout;
  outputDirectory: string;
}>): Promise<CodexDevelopmentPreparedHostedActionInputs> {
  input = Object.freeze({ resolution: input.resolution, baseRoot: input.baseRoot,
    candidateRoot: input.candidateRoot, outputDirectory: input.outputDirectory, checkout: input.checkout });
  const checkout = input.checkout;
  try {
  assertGitCandidateCheckoutCurrent(checkout);
  if (checkout.purpose !== 'action-materialization' || input.candidateRoot !== checkout.candidateRoot) {
    throw new Error('Archive preparation requires its exact original private checkout.');
  }
  if (process.platform !== 'linux') {
    throw new Error('Hosted Action input preparation requires the pinned ubuntu-24.04 runner.');
  }
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseRootIdentity = inspectNoFollowDirectoryChain(
    baseRoot, 'Hosted Action preparation exact dependency base root'
  ).target;
  const candidateRootIdentity = inspectNoFollowDirectoryChain(
    candidateRoot, 'Hosted Action preparation candidate root'
  ).target;
  const baseHead = (await privateCandidateGitBytes(checkout, baseRoot, ['rev-parse', 'HEAD'])).toString('utf8').trim();
  const baseTree = (await privateCandidateGitBytes(checkout, baseRoot, ['rev-parse', 'HEAD^{tree}'])).toString('utf8').trim();
  if (baseHead !== resolution.artifactInput.baseSha || baseTree !== resolution.artifactInput.baseTreeSha) {
    throw new Error('Hosted Action dependency materializer is not the exact resolved base/tree.');
  }
  await CodexDevelopmentAssertPreparedHostedActionCandidate({ resolution, candidateRoot, checkout });
  const dependencyClosure = hostedActionDependencyClosure({
    baseRoot,
    candidateRoot,
    baseSha: resolution.artifactInput.baseSha
  });
  const outputDirectory = path.resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  if (!lstatSync(outputDirectory).isDirectory() || realpathSync.native(outputDirectory) !== outputDirectory) {
    throw new Error('Hosted Action prepared transport output is not one ordinary directory.');
  }
  const trustedInputDirectory = path.resolve(candidateRoot, '.sec-trusted-input');
  try {
    lstatSync(trustedInputDirectory);
    throw new Error('Hosted Action candidate collides with the reserved trusted-input directory.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
  }
  mkdirSync(trustedInputDirectory, { recursive: false });
  const dependencyClosurePath = path.resolve(trustedInputDirectory, 'dependency-closure.json');
  writeHostedActionJson(dependencyClosurePath, dependencyClosure);
  const baseDependencyClosureDigest = hostedActionFileDigest(dependencyClosurePath);
  const gitBundlePath = path.resolve(trustedInputDirectory, 'candidate.bundle');
  await materializeGitCandidateCheckoutTransport(checkout);
  const authenticatedGitClosureDigest = hostedActionFileDigest(gitBundlePath);
  const preparedCandidateArchive = path.resolve(outputDirectory, 'prepared-candidate.tar');
  try {
    lstatSync(preparedCandidateArchive);
    throw new Error('Hosted Action prepared candidate archive already exists.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
  }
  // Dependency authority is the exact trusted base. The retained archive
  // producer projects that source directly, including its bounded in-root
  // links; copying it into the untrusted candidate adds no independent fact.
  const dependencyRoot = path.resolve(baseRoot, 'node_modules');
  const dependencyPhysicalBefore = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
  const projection = prepareHostedArchiveProjection({
    candidateRoot,
    expectedCandidateRoot: candidateRootIdentity,
    dependencySnapshot: dependencyPhysicalBefore,
    outputDirectory
  });
  await runHostedActionArchiveRecipe({ checkout }, { kind: 'materialize', plan: projection });
  const materializedArchive = projection.readback();
  if (materializedArchive !== preparedCandidateArchive) {
    throw new Error('Hosted Action retained archive projection returned the wrong output identity.');
  }
  const retainedArchive = retainObservedHostedSutArchive(preparedCandidateArchive);
  let inspectedArchive: ReturnType<typeof inspectHostedActionArchiveDetailed> | undefined;
  let archiveFailure: ResourceSettlementFailure | undefined;
  try {
    const bytes = await runHostedActionArchiveRecipe({ checkout }, {
      kind: 'inventory', archivePath: preparedCandidateArchive, retained: retainedArchive
    });
    const rawInventory: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    assertRetainedHostedSutArchive(retainedArchive);
    inspectedArchive = inspectHostedActionArchiveDetailed({ resolution, preparedCandidateArchive,
      baseDependencyClosureDigest, authenticatedGitClosureDigest, inspectArchive: () => rawInventory });
    assertRetainedHostedSutArchive(retainedArchive);
  } catch (error) { archiveFailure = { label: 'private-archive-inventory', error }; }
  settleResources({ primary: archiveFailure, cleanup: [{ label: 'private-archive-inventory-file',
    settle: () => closeSync(retainedArchive.fileDescriptor) }] });
  if (inspectedArchive === undefined) throw new Error('Private archive inventory did not produce its original result.');
  const archiveInventory = inspectedArchive.inventory;
  const dependencyPhysicalAfter = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
  CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before: dependencyPhysicalBefore,
    after: dependencyPhysicalAfter,
    archiveEntries: inspectedArchive.entries
  });
  if (encodeVerificationActionData(hostedActionDependencyClosure({ baseRoot, candidateRoot,
    baseSha: resolution.artifactInput.baseSha })) !== encodeVerificationActionData(dependencyClosure)
      || (await privateCandidateGitBytes(checkout, baseRoot, ['rev-parse', 'HEAD'])).toString('utf8').trim() !== baseHead
      || (await privateCandidateGitBytes(checkout, baseRoot, ['rev-parse', 'HEAD^{tree}'])).toString('utf8').trim() !== baseTree) {
    throw new Error('Hosted Action exact base dependency authority changed during archive projection.');
  }
  assertSameNoFollowDirectoryIdentity(baseRootIdentity, 'Hosted Action preparation dependency base root');
  assertSameNoFollowDirectoryIdentity(candidateRootIdentity, 'Hosted Action preparation candidate root');
  const prepared = Object.freeze({
    preparedCandidateArchive,
    archiveInventory,
    baseDependencyClosureDigest,
    authenticatedGitClosureDigest
  });
  assertGitCandidateCheckoutCurrent(checkout);
  const observedArchive = observePreparedArchiveIdentity(preparedCandidateArchive);
  if (observedArchive.archiveDigest !== archiveInventory.archiveDigest
      || observedArchive.identityDigest !== retainedArchive.identityDigest) {
    throw new Error('Prepared archive changed after its original native inventory.');
  }
  PREPARED_HOSTED_ACTION_INPUTS.set(prepared, {
    operation: gitCandidateCheckoutRecipeBinding(checkout, HOSTED_ACTION_ARCHIVE_COMMANDS.identity),
    value: prepared, archive: observedArchive, status: 'prepared'
  });
  return prepared;  } catch (error) {
    if (isResourceCompositeSettlementError(error)) recordGitCandidateCheckoutCleanupUnknown(checkout, error);
    throw error;
  }
}



export function CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
}>): void {
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseTopLevel = realpathSync.native(gitCandidateBytes(
    baseRoot, ['rev-parse', '--show-toplevel']
  ).toString('utf8').trim());
  const candidateTopLevel = realpathSync.native(gitCandidateBytes(
    candidateRoot, ['rev-parse', '--show-toplevel']
  ).toString('utf8').trim());
  if (baseTopLevel !== baseRoot || candidateTopLevel !== candidateRoot || baseRoot === candidateRoot) {
    throw new Error('Trusted bootstrap SUT materialization requires two exact Git checkout roots.');
  }

  const relativeCandidateRoot = path.relative(baseRoot, candidateRoot);
  const candidateIsContained = relativeCandidateRoot !== '' && relativeCandidateRoot !== '..' &&
    !relativeCandidateRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeCandidateRoot);
  const baseStatusArgs = candidateIsContained
    ? [
        'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching', '--', '.',
        `:(top,exclude,literal)${relativeCandidateRoot.split(path.sep).join('/')}`
      ]
    : ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'];
  if (gitCandidateBytes(baseRoot, baseStatusArgs).length !== 0 ||
      gitCandidateBytes(candidateRoot, [
        'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'
      ]).length !== 0) {
    throw new Error('Trusted bootstrap SUT materialization requires clean base and candidate checkouts.');
  }
}

export async function CodexDevelopmentPrepareTrustedBootstrapSutInputs(input: Readonly<{
  baseRoot: string; candidateRoot: string; outputDirectory: string;
  baseSha: string; headSha: string; treeSha: string;
}>, session: ProcessResourceSession, trustedSourceRoot: string): Promise<PreparedTrustedBootstrapSutInputs> {
  input = JSON.parse(encodeVerificationActionData(input)) as typeof input;
  // The supervisor supplies its original retained native session. Neither
  // path strings nor this finite recipe closure issue an operation or grant.
  const binding = bindProcessResourceCommandIssuer(session, HOSTED_ACTION_ARCHIVE_COMMANDS.identity);
  if (process.platform !== 'linux' || ![input.baseSha, input.headSha, input.treeSha].every(value => /^[0-9a-f]{40}$/u.test(value))) {
    throw new Error('Trusted bootstrap SUT input identity is invalid or unsupported on this host.');
  }
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseIdentity = inspectNoFollowDirectoryChain(baseRoot).target;
  const candidateIdentity = inspectNoFollowDirectoryChain(candidateRoot).target;
  const trustedSourceIdentity = inspectNoFollowDirectoryChain(trustedSourceRoot).target;
  const identityForRoot = (root: string) => root === baseRoot ? baseIdentity : root === candidateRoot ? candidateIdentity : trustedSourceIdentity;
  const git = async (root: string, args: readonly string[]): Promise<Buffer> => {
    assertSameNoFollowDirectoryIdentity(identityForRoot(root));
    let executable: RetainedNoFollowOrdinaryFile | undefined;
    let cwd: RetainedNoFollowChildProcessDirectory | undefined;
    let issued = false;
    let primary: ResourceSettlementFailure | undefined;
    let output: Uint8Array | undefined;
    try {
      const gitPath = realpathSync.native('/usr/bin/git');
      executable = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(gitPath)), path.basename(gitPath), undefined,
        'Original bootstrap finite Git executable', 3, 'executable');
      if (executable.size > 64 * 1024 * 1024) throw new Error('Bootstrap Git executable exceeds retained bound.');
      cwd = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(root), 4, 'Original bootstrap finite Git root');
      const command = HOSTED_ACTION_ARCHIVE_COMMANDS.issue(binding, {
        boundary: issueRetainedCommandBoundary({ executable, workingDirectory: cwd }),
        args: ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null',
          '-c', 'core.logAllRefUpdates=false', ...args],
        options: { envMode: 'replace', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
          GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
          maxStdoutBytes: 1024 * 1024, maxStderrBytes: 64 * 1024 }
      });
      issued = true;
      const result = (await runBoundProcessResourceCommand(session, binding, command)).result;
      if (result.code !== 0) throw new Error(`Original bootstrap finite Git failed: ${result.stderr.slice(0, 1024)}`);
      output = result.stdout;
      assertSameNoFollowDirectoryIdentity(identityForRoot(root));
    } catch (error) { primary = { label: 'bootstrap-finite-git', error }; }
    settleResources({ primary, cleanup: issued ? [] : [
      { label: 'bootstrap-unissued-git-cwd', settle: () => cwd?.dispose() },
      { label: 'bootstrap-unissued-git-executable', settle: () => executable?.dispose() }
    ] });
    if (output === undefined) throw new Error('Original bootstrap finite Git has no settled result.');
    return Buffer.from(output);
  };
  const baseHead = (await git(baseRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])).toString('utf8').trim();
  const baseTreeSha = (await git(baseRoot, ['rev-parse', '--verify', 'HEAD^{tree}'])).toString('utf8').trim();
  if ((await git(trustedSourceRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])).toString('utf8').trim() !== input.baseSha
      || (await git(trustedSourceRoot, ['rev-parse', '--verify', 'HEAD^{tree}'])).toString('utf8').trim() !== baseTreeSha) {
    throw new Error('Bootstrap loaded trusted dependency producer differs from the exact base source.');
  }
  const candidateHead = (await git(candidateRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])).toString('utf8').trim();
  const candidateTree = (await git(candidateRoot, ['rev-parse', '--verify', 'HEAD^{tree}'])).toString('utf8').trim();
  const candidateParents = (await git(candidateRoot, ['rev-list', '--parents', '-n', '1', 'HEAD'])).toString('utf8').trim().split(/\s+/u);
  if (baseHead !== input.baseSha || candidateHead !== input.headSha || candidateTree !== input.treeSha
      || candidateParents.length !== 2 || candidateParents[0] !== input.headSha || candidateParents[1] !== input.baseSha) {
    throw new Error('Trusted bootstrap checkouts are not the exact base and single-parent candidate.');
  }
  for (const root of [baseRoot, candidateRoot]) {
    if (realpathSync.native((await git(root, ['rev-parse', '--show-toplevel'])).toString('utf8').trim()) !== root || baseRoot === candidateRoot) {
      throw new Error('Trusted bootstrap materialization requires two exact Git roots.');
    }
    const relative = path.relative(baseRoot, candidateRoot);
    const contained = relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    const args = ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
      ...(root === baseRoot && contained ? ['--', '.', `:(top,exclude,literal)${relative.split(path.sep).join('/')}`] : [])];
    if ((await git(root, args)).length !== 0) throw new Error('Trusted bootstrap materialization requires clean exact checkouts.');
  }
  const dependencyClosure = hostedActionDependencyClosure({ baseRoot, candidateRoot, baseSha: input.baseSha });
  if (encodeVerificationActionData(dependencyClosure) !== encodeVerificationActionData(hostedActionDependencyClosure({
    baseRoot: trustedSourceRoot, candidateRoot: baseRoot, baseSha: input.baseSha
  }))) throw new Error('Bootstrap loaded dependency authority differs from the actual exact base.');
  const baseNodeModules = path.resolve(trustedSourceRoot, 'node_modules');
  if (!lstatSync(baseNodeModules).isDirectory() || realpathSync.native(baseNodeModules) !== baseNodeModules
      || existsSync(path.resolve(candidateRoot, 'node_modules'))) {
    throw new Error('Trusted bootstrap requires the actual trusted dependency source and an unmaterialized candidate.');
  }
  const dependencyPhysicalBefore = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(baseNodeModules);
  const outputDirectory = path.resolve(input.outputDirectory);
  if (!lstatSync(outputDirectory).isDirectory() || realpathSync.native(outputDirectory) !== outputDirectory) throw new Error('Bootstrap transport root is not ordinary.');
  const trustedInputDirectory = path.resolve(candidateRoot, '.sec-trusted-input');
  if (existsSync(trustedInputDirectory)) throw new Error('Bootstrap candidate collides with its reserved trusted input.');
  const trustedInputIdentity = createExclusiveNoFollowDirectory(candidateIdentity, '.sec-trusted-input');
  let primary: ResourceSettlementFailure | undefined;
  let prepared: PreparedTrustedBootstrapSutInputs | undefined;
  try {
    const dependencyClosurePath = path.join(trustedInputDirectory, 'dependency-closure.json');
    const gitBundlePath = path.join(trustedInputDirectory, 'candidate.bundle');
    writeHostedActionJson(dependencyClosurePath, dependencyClosure);
    for (const revision of [input.baseSha, input.headSha]) await git(candidateRoot, ['cat-file', '-e', `${revision}^{commit}`]);
    await git(candidateRoot, ['update-ref', 'refs/sec/base', input.baseSha]);
    await git(candidateRoot, ['update-ref', 'refs/sec/head', input.headSha]);
    await git(candidateRoot, ['bundle', 'create', gitBundlePath, 'refs/sec/base', 'refs/sec/head']);
    await git(candidateRoot, ['bundle', 'verify', gitBundlePath]);
    const projection = prepareHostedArchiveProjection({ candidateRoot, expectedCandidateRoot: candidateIdentity,
      dependencySnapshot: dependencyPhysicalBefore, outputDirectory });
    await runHostedActionArchiveRecipe({ session }, { kind: 'materialize', plan: projection });
    const preparedCandidateArchive = projection.readback();
    const retained = retainObservedHostedSutArchive(preparedCandidateArchive);
    let inventoryFailure: ResourceSettlementFailure | undefined;
    let validated: ReturnType<typeof CodexDevelopmentValidateHostedActionArchiveInventory> | undefined;
    try {
      const bytes = await runHostedActionArchiveRecipe({ session }, { kind: 'inventory', archivePath: preparedCandidateArchive, retained });
      validated = CodexDevelopmentValidateHostedActionArchiveInventory(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      assertRetainedHostedSutArchive(retained);
    } catch (error) { inventoryFailure = { label: 'bootstrap-retained-inventory', error }; }
    settleResources({ primary: inventoryFailure, cleanup: [{ label: 'bootstrap-retained-inventory-close', settle: () => closeSync(retained.fileDescriptor) }] });
    if (validated === undefined) throw new Error('Bootstrap retained inventory is missing.');
    const dependencyClosureDigest = hostedActionFileDigest(dependencyClosurePath);
    const authenticatedGitClosureDigest = hostedActionFileDigest(gitBundlePath);
    for (const [name, digest] of [['dependency-closure.json', dependencyClosureDigest], ['candidate.bundle', authenticatedGitClosureDigest]]) {
      const entry = validated.entries.find(entry => entry.path === `.sec-trusted-input/${name}`);
      if (entry?.type !== 'file' || entry.contentDigest !== digest) throw new Error('Bootstrap archive lost exact authenticated inputs.');
    }
    const dependencyArchiveProjection = CodexDevelopmentAssertHostedDependencyArchiveProjection({ before: dependencyPhysicalBefore,
      after: CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(baseNodeModules), archiveEntries: validated.entries });
    assertSameNoFollowDirectoryIdentity(trustedSourceIdentity);
    assertSameNoFollowDirectoryIdentity(baseIdentity); assertSameNoFollowDirectoryIdentity(candidateIdentity);
    prepared = Object.freeze({ preparedCandidateArchive, archiveDigest: hostedActionFileDigest(preparedCandidateArchive),
      archiveInventoryDigest: validated.inventoryDigest, dependencyClosureDigest, authenticatedGitClosureDigest,
      entryCount: validated.entries.length, totalFileBytes: validated.totalFileBytes, dependencyArchiveProjection });
    TRUSTED_BOOTSTRAP_PREPARATIONS.set(prepared, { baseSha: input.baseSha, baseTreeSha, headSha: input.headSha,
      headTreeSha: input.treeSha, session, binding, archive: observePreparedArchiveIdentity(preparedCandidateArchive), status: 'prepared' });
  } catch (error) { primary = { label: 'bootstrap-original-preparation', error }; }
  settleResources({ primary, cleanup: [{ label: 'bootstrap-owned-trusted-input-retirement', settle: () => {
    assertSameNoFollowDirectoryIdentity(candidateIdentity); assertSameNoFollowDirectoryIdentity(trustedInputIdentity);
    rmSync(trustedInputDirectory, { recursive: true, force: false });
    if (existsSync(trustedInputDirectory)) throw new Error('Bootstrap owned trusted input retirement was not observed.');
  } }] });
  if (prepared === undefined) throw new Error('Bootstrap original preparation did not produce its physical output.');
  return prepared;
}

export function CodexDevelopmentMaterializeHostedActionCandidate(input: Readonly<{
  resolution: HostedActionResolution<import("../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>;
  ticket: HostedActionExecutionTicket<import("./contract/evidence.ts").CodexDevelopmentVerificationActionArtifactProducer, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA>;
  preparedCandidateArchive: string;
  inspectArchive?: (archive: string) => unknown;
}>): HostedSutInventory {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    encodeVerificationActionData(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest) {
    throw new Error('Hosted Action execution ticket differs from the trusted resolution.');
  }
  const inspected = CodexDevelopmentInspectHostedActionArchive({
    resolution,
    preparedCandidateArchive: input.preparedCandidateArchive,
    baseDependencyClosureDigest: ticket.baseDependencyClosureDigest,
    authenticatedGitClosureDigest: ticket.authenticatedGitClosureDigest,
    inspectArchive: input.inspectArchive
  });
  if (inspected.archiveDigest !== ticket.preparedCandidateArchiveDigest ||
      inspected.inventoryDigest !== ticket.preparedCandidateInventoryDigest ||
      inspected.entryCount !== ticket.preparedCandidateEntryCount ||
      inspected.totalFileBytes !== ticket.preparedCandidateTotalFileBytes ||
      inspected.dependencyClosureDigest !== ticket.baseDependencyClosureDigest ||
      inspected.gitBundleDigest !== ticket.authenticatedGitClosureDigest) {
    throw new Error('Hosted Action prepared candidate exact inventory differs from the execution ticket.');
  }
  return inspected;
}

/** The identity is public to trusted composition; its issue closure stays private. */
export function createHostedActionArchiveRecipeIssuer() {
  return HOSTED_ACTION_ARCHIVE_COMMANDS.identity;
}

async function privateCandidateGitBytes(checkout: GitCandidateCheckout, root: string, args: readonly string[]): Promise<Buffer> {
  const result = await readGitCandidateCheckout(checkout, root, args);
  if (result.code !== 0) throw new Error(`Private Action Git observation failed: ${result.stderr.slice(0, 512)}`);
  return Buffer.from(result.stdout);
}

async function runHostedActionArchiveRecipe(owner: Readonly<{ checkout: GitCandidateCheckout }> | Readonly<{ session: ProcessResourceSession }>, recipe:
  Readonly<{ kind: 'materialize'; plan: ReturnType<typeof prepareHostedArchiveProjection> }>
  | Readonly<{ kind: 'inventory'; archivePath: string; retained: CodexDevelopmentRetainedHostedSutArchive }>): Promise<Uint8Array> {
  if ('checkout' in owner) assertGitCandidateCheckoutCurrent(owner.checkout);
  const binding = 'checkout' in owner
    ? gitCandidateCheckoutRecipeBinding(owner.checkout, HOSTED_ACTION_ARCHIVE_COMMANDS.identity)
    : bindProcessResourceCommandIssuer(owner.session, HOSTED_ACTION_ARCHIVE_COMMANDS.identity);
  let executable: RetainedNoFollowOrdinaryFile | undefined;
  let cwd: RetainedNoFollowChildProcessDirectory | undefined;
  let archive: RetainedNoFollowOrdinaryFile | undefined;
  let issued = false;
  let output: Uint8Array | undefined;
  let primary: ResourceSettlementFailure | undefined;
  try {
    const python = realpathSync.native('/usr/bin/python3');
    executable = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(python)),
      path.basename(python), undefined, 'Original archive Python executable', 3, 'executable');
    if (executable.size > 64 * 1024 * 1024) throw new Error('Archive executable exceeds its retained byte bound.');
    const directory = recipe.kind === 'materialize' ? recipe.plan.cwd : path.dirname(recipe.archivePath);
    cwd = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(directory), 4, 'Original archive recipe cwd');
    let args: readonly string[];
    if (recipe.kind === 'materialize') {
      args = ['-I', '-B', ...recipe.plan.args];
    } else {
      assertRetainedHostedSutArchive(recipe.retained);
      const before = fstatSync(recipe.retained.fileDescriptor, { bigint: true });
      archive = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(recipe.archivePath)),
        path.basename(recipe.archivePath), { device: String(before.dev), inode: String(before.ino) }, 'Original archive recipe input', 5);
      args = ['-I', '-B', '-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT,
        String(HOSTED_ACTION_ARCHIVE_MAX_ENTRIES), String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes),
        String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes), String(HOSTED_ACTION_ARCHIVE_INVENTORY_MAX_OUTPUT_BYTES),
        String(hostedActionArchiveMaximumBytes()), String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes),
        String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds), recipe.retained.archiveDigest, '5'];
    }
    const command = HOSTED_ACTION_ARCHIVE_COMMANDS.issue(binding, {
      boundary: issueRetainedCommandBoundary({ executable, workingDirectory: cwd,
        auxiliaryInputs: archive === undefined ? [] : [{ capability: archive, kind: 'ordinary-file' }] }),
      args, options: { envMode: 'replace', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
        maxStdoutBytes: recipe.kind === 'inventory' ? HOSTED_ACTION_ARCHIVE_INVENTORY_MAX_OUTPUT_BYTES : 1024 * 1024,
        maxStderrBytes: 64 * 1024 }
    });
    issued = true;
    const result = 'checkout' in owner ? await runGitCandidateCheckoutRecipe(owner.checkout, command)
      : (await runBoundProcessResourceCommand(owner.session, binding, command)).result;
    if ('checkout' in owner) assertGitCandidateCheckoutCurrent(owner.checkout);
    if (result.code !== 0) throw new Error(`Original archive ${recipe.kind} failed: ${result.stderr.slice(0, 1024)}`);
    output = result.stdout;
  } catch (error) { primary = { label: 'private-archive-recipe', error }; }
  try {
    settleResources({ primary, cleanup: issued ? [] : [
      { label: 'private-archive-unissued-input', settle: () => archive?.dispose() },
      { label: 'private-archive-unissued-cwd', settle: () => cwd?.dispose() },
      { label: 'private-archive-unissued-executable', settle: () => executable?.dispose() }
    ] });
  } catch (error) {
    if ('checkout' in owner && isResourceCompositeSettlementError(error)) recordGitCandidateCheckoutCleanupUnknown(owner.checkout, error);
    throw error;
  }
  if (output === undefined) throw new Error('Original archive recipe did not produce settled output.');
  return output;
}

type PreparedArchiveIdentity = Readonly<{
  parent: PhysicalDirectoryIdentity;
  physical: Readonly<{ device: string; inode: string }>;
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}>;

const TRUSTED_BOOTSTRAP_PREPARATIONS = new WeakMap<object, {
  baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string;
  session: ProcessResourceSession; binding: ProcessResourceCommandBinding; archive: PreparedArchiveIdentity;
  status: 'prepared' | 'consumed';
}>();

/** Reads the original producer's retained publication. This wire correlation
 * grants no Action authorization, compiler generation or process session. */
export function trustedBootstrapCandidatePreparation(prepared: PreparedTrustedBootstrapSutInputs,
  session: ProcessResourceSession, bootstrapDigest: VerificationActionKeyDigest): TrustedBootstrapCandidatePreparation {
  const state = TRUSTED_BOOTSTRAP_PREPARATIONS.get(prepared);
  if (state === undefined || state.session !== session || state.status !== 'prepared'
      || bindProcessResourceCommandIssuer(session, HOSTED_ACTION_ARCHIVE_COMMANDS.identity) !== state.binding) {
    throw new Error('Bootstrap preparation requires the original supervisor and physical producer.');
  }
  observePreparedArchiveIdentity(prepared.preparedCandidateArchive, state.archive);
  const projection = parseNativeHostedCandidatePreparation({ schema: 'sec-trusted-bootstrap-candidate-preparation', bootstrapDigest,
    baseSha: state.baseSha, baseTreeSha: state.baseTreeSha, headSha: state.headSha, headTreeSha: state.headTreeSha,
    archiveDigest: prepared.archiveDigest, inventoryDigest: prepared.archiveInventoryDigest,
    dependencyClosureDigest: prepared.dependencyClosureDigest, gitBundleDigest: prepared.authenticatedGitClosureDigest,
    deadlineAtUnixMs: session.deadlineAtUnixMs, inputAccess: 'writable' }) as TrustedBootstrapCandidatePreparation;
  state.status = 'consumed';
  return projection;
}

type PreparedHostedActionState = {
  readonly operation: ProcessResourceCommandBinding;
  readonly value: CodexDevelopmentPreparedHostedActionInputs;
  readonly archive: PreparedArchiveIdentity;
  status: 'prepared' | 'consumed' | 'failed';
  failure?: unknown;
};
const PREPARED_HOSTED_ACTION_INPUTS = new WeakMap<object, PreparedHostedActionState>();

function observePreparedArchiveIdentity(file: string, expected?: PreparedArchiveIdentity): PreparedArchiveIdentity {
  const absolute = path.resolve(file);
  const parent = expected === undefined
    ? inspectNoFollowDirectoryChain(path.dirname(absolute), 'Prepared archive publication parent')
    : assertSameNoFollowDirectoryIdentity(expected.parent, 'Prepared archive original publication parent');
  if (parent.target.path !== path.dirname(absolute)) throw new Error('Prepared archive escaped its original output parent.');
  const retained = retainNoFollowOrdinaryFile(parent, path.basename(absolute), expected?.physical,
    'Prepared archive original physical generation');
  let value: PreparedArchiveIdentity | undefined;
  let primary: ResourceSettlementFailure | undefined;
  try {
    if (retained.stdioSourceDescriptor === null) throw new Error('Prepared archive requires its original Linux descriptor route.');
    const observation = retainedHostedSutArchiveObservation(retained.stdioSourceDescriptor);
    retained.assertCurrent();
    assertSameNoFollowDirectoryIdentity(parent.target);
    if (expected !== undefined && (observation.archiveDigest !== expected.archiveDigest
        || observation.identityDigest !== expected.identityDigest)) {
      throw new Error('Prepared archive bytes or physical generation changed.');
    }
    value = Object.freeze({ parent: parent.target, physical: retained.physical, ...observation });
  } catch (error) { primary = { label: 'prepared-archive-readback', error }; }
  settleResources({ primary, cleanup: [{ label: 'prepared-archive-readback-file', settle: () => retained.dispose() }] });
  return value!;
}

function originalPreparedAction(value: unknown, operation: ProcessResourceCommandBinding): PreparedHostedActionState {
  const state = value !== null && typeof value === 'object' ? PREPARED_HOSTED_ACTION_INPUTS.get(value) : undefined;
  if (state === undefined || state.value !== value || state.operation !== operation) {
    throw new Error('Prepared archive requires its original materializer object and process operation.');
  }
  if (state.status === 'failed') throw state.failure;
  return state;
}

/** One issuance consumption. Object copies, another operation and replay fail. */
export function consumePreparedHostedActionArchive(value: unknown, operation: ProcessResourceCommandBinding): HostedSutInventory {
  const state = originalPreparedAction(value, operation);
  if (state.status !== 'prepared') throw new Error('Prepared archive inventory was already consumed.');
  assertPreparedHostedActionArchiveCurrent(value, operation);
  state.status = 'consumed';
  return state.value.archiveInventory;
}

/** Same immutable output evidence after scope exit, with new physical/byte
 * readback but no second decoder process or renewed process authority. */
export function assertPreparedHostedActionArchiveCurrent(value: unknown, operation: ProcessResourceCommandBinding): void {
  const state = originalPreparedAction(value, operation);
  try { observePreparedArchiveIdentity(state.value.preparedCandidateArchive, state.archive); }
  catch (error) { state.status = 'failed'; state.failure = error; throw error; }
}
