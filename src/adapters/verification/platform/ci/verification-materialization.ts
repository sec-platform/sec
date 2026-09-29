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
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry,
  type PhysicalDirectoryIdentity
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  CodexDevelopmentWorkPackageManifestDigest
} from '../../../self-hosting/control/task/contract/work-package.ts';
import { encodeVerificationActionData, type VerificationActionKeyDigest } from '../action/contract/action.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, type VerificationActionProviderOrigin } from '../action/contract/provider.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY
} from './contract/revision.ts';
import { CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, ciActionDigest, exactObject } from './verification-hosted-action-contract.ts';
import type { CodexDevelopmentHostedActionExecutionTicket, CodexDevelopmentHostedActionResolution } from './verification-hosted-action-contract.ts';
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
  try {
    const bytes = Buffer.from(retained.readBytes());
    retained.assertCurrent();
    return bytes;
  } finally {
    retained.dispose();
  }
}

export function hostedActionFileDigest(filePath: string): VerificationActionKeyDigest {
  const descriptor = openSync(path.resolve(filePath), 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
  return `sha256:${hash.digest('hex')}`;
}

export type CodexDevelopmentRetainedHostedSutArchive = Readonly<{
  fileDescriptor: number;
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}>;

function retainedHostedSutArchiveObservation(fileDescriptor: number): Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  identityDigest: VerificationActionKeyDigest;
}> {
  const before = fstatSync(fileDescriptor, { bigint: true });
  if (!before.isFile() || before.size < 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
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
    size: value.size.toString()
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
  const noFollow = process.platform === 'linux' ? fsConstants.O_NOFOLLOW : 0;
  const fileDescriptor = openSync(path.resolve(filePath), fsConstants.O_RDONLY | noFollow);
  try {
    const observed = retainedHostedSutArchiveObservation(fileDescriptor);
    if (observed.archiveDigest !== expectedDigest) {
      throw new Error('Hosted SUT retained archive differs from its authenticated digest.');
    }
    return Object.freeze({ fileDescriptor, ...observed });
  } catch (error) {
    closeSync(fileDescriptor);
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
export function CodexDevelopmentAssertPreparedHostedActionCandidate(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  candidateRoot: string;
}>): void {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const candidateIdentity = inspectNoFollowDirectoryChain(
    candidateRoot, 'Hosted Action prepared candidate root'
  ).target;
  const gitText = (...args: string[]): string => gitCandidateBytes(candidateRoot, args).toString('utf8').trim();
  if (gitText('rev-parse', 'HEAD') !== resolution.artifactInput.headSha ||
      gitText('rev-parse', 'HEAD^{tree}') !== resolution.artifactInput.headTreeSha ||
      gitText('status', '--porcelain=v1', '--untracked-files=all') !== '') {
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
    const trackedBytes = gitCandidateBytes(candidateRoot, ['show', `${resolution.artifactInput.headSha}:${entry.path}`]);
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
}

export type CodexDevelopmentHostedActionArchiveInventory = Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  inventoryDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyClosureDigest: VerificationActionKeyDigest;
  gitBundleDigest: VerificationActionKeyDigest;
}>;

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
    const candidateFile = retainNoFollowOrdinaryFile(
      candidateRootChain, relativePath, undefined, `Hosted dependency candidate authority ${relativePath}`
    );
    try {
      const baseBytes = Buffer.from(baseFile.readBytes());
      const candidateBytes = Buffer.from(candidateFile.readBytes());
      baseFile.assertCurrent();
      candidateFile.assertCurrent();
      if (!baseBytes.equals(candidateBytes)) {
        throw new Error(`Hosted Action candidate dependency authority drifted from exact base: ${relativePath}.`);
      }
      return Object.freeze({
        path: relativePath,
        bytesDigest: `sha256:${createHash('sha256').update(baseBytes).digest('hex')}`
      });
    } finally {
      try {
        candidateFile.dispose();
      } finally {
        baseFile.dispose();
      }
    }
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

export type CodexDevelopmentHostedDependencyArchiveProjection = Readonly<{
  schema: 'sec-hosted-dependency-archive-projection-v1';
  entriesObserved: number;
  linksProjected: number;
  sourceSnapshotDigest: VerificationActionKeyDigest;
  archiveProjectionDigest: VerificationActionKeyDigest;
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
}>): CodexDevelopmentHostedDependencyArchiveProjection {
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

export function CodexDevelopmentMaterializeTrustedBootstrapArchive(input: Readonly<{
  candidateRoot: string;
  expectedCandidateRoot?: PhysicalDirectoryIdentity;
  dependencySnapshot: CodexDevelopmentHostedDependencyPhysicalSnapshot;
  outputDirectory: string;
}>): string {
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
  runHostedMaterializerCommand('/usr/bin/python3', [
    '-c', HOSTED_ACTION_ARCHIVE_MATERIALIZER_SCRIPT,
    candidate.path, dependency.path, output.path, archiveName,
    candidate.device, candidate.inode, dependency.device, dependency.inode,
    output.device, output.inode,
    String(HOSTED_ACTION_ARCHIVE_MAX_ENTRIES),
    String(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes)
  ], 'Trusted bootstrap retained archive projection');
  assertSameNoFollowDirectoryIdentity(candidate, 'Trusted bootstrap archive candidate root');
  assertSameNoFollowDirectoryIdentity(dependency, 'Trusted bootstrap archive dependency root');
  assertSameNoFollowDirectoryIdentity(output, 'Trusted bootstrap archive output root');
  const archive = lstatSync(archivePath);
  if (!archive.isFile() || archive.isSymbolicLink() || realpathSync.native(archivePath) !== archivePath) {
    throw new Error('Trusted bootstrap retained archive projection did not publish one ordinary output.');
  }
  return archivePath;
}

const HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT = [
  'import hashlib, json, sys, tarfile',
  'result=[]',
  'with tarfile.open(sys.argv[1], mode="r:*") as archive:',
  '  for member in archive.getmembers():',
  '    kind = "file" if member.isreg() else "directory" if member.isdir() else "symlink" if member.issym() else "hardlink" if member.islnk() else "unsupported"',
  '    digest = None; physical_digest = None',
  '    normalized = member.name[2:] if member.name.startswith("./") else member.name',
  '    if member.isreg() or member.islnk():',
  '      stream = archive.extractfile(member)',
  '      hasher = hashlib.sha256(); physical_hasher = hashlib.sha256(); physical_hasher.update(b\'{"bytes":"\')',
  '      while True:',
  '        chunk = stream.read(1048576) if stream is not None else b""',
  '        if not chunk: break',
  '        hasher.update(chunk); physical_hasher.update(chunk.hex().encode("ascii"))',
  '      physical_hasher.update(b\'"}\'); physical_digest = "sha256:" + physical_hasher.hexdigest()',
  '      if member.isreg() and normalized in (".sec-trusted-input/candidate.bundle", ".sec-trusted-input/dependency-closure.json"): digest = "sha256:" + hasher.hexdigest()',
  '    result.append({"path": member.name, "type": kind, "linkTarget": member.linkname if member.issym() or member.islnk() else None, "size": member.size, "mode": member.mode, "physicalContentDigest": physical_digest, "contentDigest": digest})',
  'sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":"), sort_keys=True))'
].join('\n');

function inspectHostedActionArchiveMetadata(archive: string, label: string): unknown {
  const inventory = spawnSync(
    '/usr/bin/python3',
    ['-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT, archive],
    {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
    }
  );
  if (inventory.status !== 0 || typeof inventory.stdout !== 'string') {
    throw new Error(`${label} metadata is unreadable without extraction.`);
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
    if (linkTarget !== null && Number(value.size) !== 0) {
      throw new Error(`Hosted Action archive link has nonzero payload bytes: ${entryPath}.`);
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
    const seen = new Set<string>([entry.path]);
    let cursor: HostedActionArchiveInventoryEntry | undefined = target;
    while (cursor?.linkTarget !== null) {
      if (seen.has(cursor.path)) throw new Error(`Hosted Action archive link cycle is forbidden: ${entry.path}.`);
      seen.add(cursor.path);
      cursor = byPath.get(cursor.linkTarget);
      if (cursor === undefined) throw new Error(`Hosted Action archive link chain is incomplete: ${entry.path}.`);
    }
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
  return CodexDevelopmentValidateHostedActionArchiveInventory(
    inspectHostedActionArchiveMetadata(archive, label)
  );
}

type HostedActionArchiveInspectionInput = Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  preparedCandidateArchive: string;
  baseDependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  inspectArchive?: (archive: string) => unknown;
}>;

function inspectHostedActionArchiveDetailed(
  input: HostedActionArchiveInspectionInput
): Readonly<{
  inventory: CodexDevelopmentHostedActionArchiveInventory;
  entries: readonly HostedActionArchiveInventoryEntry[];
}> {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.baseDependencyClosureDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.authenticatedGitClosureDigest)) {
    throw new Error('Hosted Action archive expected Git or dependency closure digest is invalid.');
  }
  const archive = realpathSync.native(path.resolve(input.preparedCandidateArchive));
  const archiveStat = lstatSync(archive);
  const archiveDigest = hostedActionFileDigest(archive);
  if (!archiveStat.isFile()) {
    throw new Error('Hosted Action prepared candidate archive is not one ordinary file.');
  }
  let rawInventory: unknown;
  if (input.inspectArchive !== undefined) {
    rawInventory = input.inspectArchive(archive);
  } else {
    rawInventory = inspectHostedActionArchiveMetadata(
      archive,
      'Hosted Action prepared candidate archive'
    );
  }
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
): CodexDevelopmentHostedActionArchiveInventory {
  return inspectHostedActionArchiveDetailed(input).inventory;
}

export type CodexDevelopmentPreparedHostedActionInputs = Readonly<{
  preparedCandidateArchive: string;
  archiveInventory: CodexDevelopmentHostedActionArchiveInventory;
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

export type CodexDevelopmentDependencyMaterializationRecovery = Readonly<{
  attempts: 1 | 2;
  recoveredFrom: 'none' | 'bun-tarball-extraction';
}>;

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
): CodexDevelopmentDependencyMaterializationRecovery {
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

export function CodexDevelopmentPrepareHostedActionInputs(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
}>): CodexDevelopmentPreparedHostedActionInputs {
  if (process.platform !== 'linux') {
    throw new Error('Hosted Action input preparation requires the pinned ubuntu-24.04 runner.');
  }
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const candidateRootIdentity = inspectNoFollowDirectoryChain(
    candidateRoot, 'Hosted Action preparation candidate root'
  ).target;
  const baseHead = gitCandidateBytes(baseRoot, ['rev-parse', 'HEAD']).toString('utf8').trim();
  const baseTree = gitCandidateBytes(baseRoot, ['rev-parse', 'HEAD^{tree}']).toString('utf8').trim();
  if (baseHead !== resolution.artifactInput.baseSha || baseTree !== resolution.artifactInput.baseTreeSha) {
    throw new Error('Hosted Action dependency materializer is not the exact resolved base/tree.');
  }
  CodexDevelopmentAssertPreparedHostedActionCandidate({ resolution, candidateRoot });
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
  for (const revision of [resolution.artifactInput.baseSha, resolution.artifactInput.headSha]) {
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'cat-file', '-e', `${revision}^{commit}`],
      `Hosted Action Git object readback ${revision}`
    );
  }
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/base', resolution.artifactInput.baseSha],
    'Hosted Action exact base ref materialization'
  );
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/head', resolution.artifactInput.headSha],
    'Hosted Action exact head ref materialization'
  );
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'create', gitBundlePath, 'refs/sec/base', 'refs/sec/head'],
    'Hosted Action authenticated candidate Git bundle materialization'
  );
  runHostedMaterializerCommand(
    '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'verify', gitBundlePath],
    'Hosted Action authenticated candidate Git bundle verification'
  );
  const authenticatedGitClosureDigest = hostedActionFileDigest(gitBundlePath);
  const preparedCandidateArchive = path.resolve(outputDirectory, 'prepared-candidate.tar');
  try {
    lstatSync(preparedCandidateArchive);
    throw new Error('Hosted Action prepared candidate archive already exists.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
  }
  const dependencyRoot = path.resolve(candidateRoot, 'node_modules');
  const dependencyPhysicalBefore = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
  const materializedArchive = CodexDevelopmentMaterializeTrustedBootstrapArchive({
    candidateRoot,
    expectedCandidateRoot: candidateRootIdentity,
    dependencySnapshot: dependencyPhysicalBefore,
    outputDirectory
  });
  if (materializedArchive !== preparedCandidateArchive) {
    throw new Error('Hosted Action retained archive projection returned the wrong output identity.');
  }
  const inspectedArchive = inspectHostedActionArchiveDetailed({
    resolution,
    preparedCandidateArchive,
    baseDependencyClosureDigest,
    authenticatedGitClosureDigest
  });
  const archiveInventory = inspectedArchive.inventory;
  const dependencyPhysicalAfter = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
  CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before: dependencyPhysicalBefore,
    after: dependencyPhysicalAfter,
    archiveEntries: inspectedArchive.entries
  });
  assertSameNoFollowDirectoryIdentity(candidateRootIdentity, 'Hosted Action preparation candidate root');
  return Object.freeze({
    preparedCandidateArchive,
    archiveInventory,
    baseDependencyClosureDigest,
    authenticatedGitClosureDigest
  });
}

export type CodexDevelopmentPreparedTrustedBootstrapSutInputs = Readonly<{
  preparedCandidateArchive: string;
  archiveDigest: VerificationActionKeyDigest;
  archiveInventoryDigest: VerificationActionKeyDigest;
  dependencyClosureDigest: VerificationActionKeyDigest;
  authenticatedGitClosureDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyMaterialization: CodexDevelopmentDependencyMaterializationRecovery;
  dependencyArchiveProjection: CodexDevelopmentHostedDependencyArchiveProjection;
}>;

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

export function CodexDevelopmentPrepareTrustedBootstrapSutInputs(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
  baseSha: string;
  headSha: string;
  treeSha: string;
}>): CodexDevelopmentPreparedTrustedBootstrapSutInputs {
  if (process.platform !== 'linux' || !/^[0-9a-f]{40}$/u.test(input.baseSha) ||
      !/^[0-9a-f]{40}$/u.test(input.headSha) || !/^[0-9a-f]{40}$/u.test(input.treeSha)) {
    throw new Error('Trusted bootstrap SUT input identity is invalid or unsupported on this host.');
  }
  const baseRoot = realpathSync.native(path.resolve(input.baseRoot));
  const candidateRoot = realpathSync.native(path.resolve(input.candidateRoot));
  const baseHead = gitCandidateBytes(baseRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    .toString('utf8').trim();
  const candidateHead = gitCandidateBytes(candidateRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    .toString('utf8').trim();
  const candidateTree = gitCandidateBytes(candidateRoot, ['rev-parse', '--verify', 'HEAD^{tree}'])
    .toString('utf8').trim();
  const candidateParents = gitCandidateBytes(candidateRoot, ['rev-list', '--parents', '-n', '1', 'HEAD'])
    .toString('utf8').trim().split(/\s+/u);
  if (baseHead !== input.baseSha || candidateHead !== input.headSha || candidateTree !== input.treeSha ||
      candidateParents.length !== 2 || candidateParents[0] !== input.headSha ||
      candidateParents[1] !== input.baseSha) {
    throw new Error('Trusted bootstrap SUT checkouts are not the exact base and single-parent candidate.');
  }
  CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({ baseRoot, candidateRoot });
  const dependencyClosure = hostedActionDependencyClosure({
    baseRoot, candidateRoot, baseSha: input.baseSha
  });
  const materializerEnvironment = CodexDevelopmentHostedDependencyMaterializerEnvironment();
  mkdirSync(materializerEnvironment.BUN_INSTALL_CACHE_DIR!, { recursive: true });
  mkdirSync(materializerEnvironment.HOME!, { recursive: true });
  mkdirSync(materializerEnvironment.TMPDIR!, { recursive: true });
  const dependencyMaterialization = CodexDevelopmentRunBoundedDependencyMaterialization(() => {
    runHostedMaterializerCommand(
      realpathSync.native(process.execPath),
      ['install', '--frozen-lockfile', '--ignore-scripts'],
      'Trusted bootstrap exact-base dependency materialization',
      { cwd: baseRoot, env: materializerEnvironment }
    );
  });
  const baseNodeModules = path.resolve(baseRoot, 'node_modules');
  const candidateNodeModules = path.resolve(candidateRoot, 'node_modules');
  if (!lstatSync(baseNodeModules).isDirectory() || realpathSync.native(baseNodeModules) !== baseNodeModules) {
    throw new Error('Trusted bootstrap exact-base dependency materialization has no ordinary node_modules.');
  }
  const dependencyPhysicalBefore =
    CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(baseNodeModules);
  if (existsSync(candidateNodeModules)) {
    throw new Error('Trusted bootstrap candidate node_modules already exists.');
  }
  const outputDirectory = path.resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  if (!lstatSync(outputDirectory).isDirectory() || realpathSync.native(outputDirectory) !== outputDirectory) {
    throw new Error('Trusted bootstrap transport root is not one ordinary directory.');
  }
  const trustedInputDirectory = path.resolve(candidateRoot, '.sec-trusted-input');
  if (existsSync(trustedInputDirectory)) {
    throw new Error('Trusted bootstrap candidate collides with the reserved trusted-input directory.');
  }
  mkdirSync(trustedInputDirectory, { recursive: false });
  const dependencyClosurePath = path.resolve(trustedInputDirectory, 'dependency-closure.json');
  const gitBundlePath = path.resolve(trustedInputDirectory, 'candidate.bundle');
  const preparedCandidateArchive = path.resolve(outputDirectory, 'prepared-candidate.tar');
  try {
    writeHostedActionJson(dependencyClosurePath, dependencyClosure);
    for (const revision of [input.baseSha, input.headSha]) {
      runHostedMaterializerCommand(
        '/usr/bin/git', ['-C', candidateRoot, 'cat-file', '-e', `${revision}^{commit}`],
        `Trusted bootstrap Git object readback ${revision}`
      );
    }
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/base', input.baseSha],
      'Trusted bootstrap exact base ref materialization'
    );
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'update-ref', 'refs/sec/head', input.headSha],
      'Trusted bootstrap exact head ref materialization'
    );
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'create', gitBundlePath, 'refs/sec/base', 'refs/sec/head'],
      'Trusted bootstrap authenticated candidate Git bundle materialization'
    );
    runHostedMaterializerCommand(
      '/usr/bin/git', ['-C', candidateRoot, 'bundle', 'verify', gitBundlePath],
      'Trusted bootstrap authenticated candidate Git bundle verification'
    );
    const materializedArchive = CodexDevelopmentMaterializeTrustedBootstrapArchive({
      candidateRoot,
      dependencySnapshot: dependencyPhysicalBefore,
      outputDirectory
    });
    if (materializedArchive !== preparedCandidateArchive) {
      throw new Error('Trusted bootstrap retained archive projection returned the wrong output identity.');
    }
    const validated = CodexDevelopmentInspectHostedActionArchiveInventory(
      preparedCandidateArchive,
      'Trusted bootstrap prepared candidate archive inventory'
    );
    const bundleEntry = validated.entries.find(
      (entry) => entry.path === '.sec-trusted-input/candidate.bundle'
    );
    const dependencyEntry = validated.entries.find(
      (entry) => entry.path === '.sec-trusted-input/dependency-closure.json'
    );
    const authenticatedGitClosureDigest = hostedActionFileDigest(gitBundlePath);
    const dependencyClosureDigest = hostedActionFileDigest(dependencyClosurePath);
    if (bundleEntry?.type !== 'file' || bundleEntry.contentDigest !== authenticatedGitClosureDigest ||
        dependencyEntry?.type !== 'file' || dependencyEntry.contentDigest !== dependencyClosureDigest) {
      throw new Error('Trusted bootstrap archive lost its authenticated Git or dependency closure.');
    }
    const dependencyPhysicalAfter =
      CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(baseNodeModules);
    const dependencyArchiveProjection = CodexDevelopmentAssertHostedDependencyArchiveProjection({
      before: dependencyPhysicalBefore,
      after: dependencyPhysicalAfter,
      archiveEntries: validated.entries
    });
    return Object.freeze({
      preparedCandidateArchive,
      archiveDigest: hostedActionFileDigest(preparedCandidateArchive),
      archiveInventoryDigest: validated.inventoryDigest,
      dependencyClosureDigest,
      authenticatedGitClosureDigest,
      entryCount: validated.entries.length,
      totalFileBytes: validated.totalFileBytes,
      dependencyMaterialization,
      dependencyArchiveProjection
    });
  } finally {
    rmSync(trustedInputDirectory, { recursive: true, force: true });
  }
}

export function CodexDevelopmentMaterializeHostedActionCandidate(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  ticket: CodexDevelopmentHostedActionExecutionTicket;
  preparedCandidateArchive: string;
  inspectArchive?: (archive: string) => unknown;
}>): CodexDevelopmentHostedActionArchiveInventory {
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
