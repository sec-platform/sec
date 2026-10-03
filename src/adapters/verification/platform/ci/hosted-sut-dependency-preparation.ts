/** Trusted pre-candidate data import. This module's static closure uses no package code. */
import { createHash } from 'node:crypto';
import { fstatSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from '../../../../contracts/canonical.ts';
import { isNativeAborted } from '../../../../contracts/native-abort.ts';
import { issueSecOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext, type SecOperationDigest
} from '../../../../execution/operation/semantic.ts';
import { settleResourcesAsync, type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import {
  assertPhysicalGenerationRetirementReceipt,
  assertPhysicallyDisjointDirectoryChains,
  assertRetainedNoFollowCapability,
  assertSameNoFollowDirectoryIdentity,
  copyNoFollowDirectoryTreesBulk, deleteRetainedNoFollowEntry, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryLeaf,
  materializeRetainedNoFollowProvenDirectoryGeneration, publishExclusiveDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata,
  type NoFollowDirectoryTreeInventoryEntry, type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory, type RetainedNoFollowOrdinaryFile,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt, openProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { issueRetainedCommandBoundary } from '../../../runtime-state/physical/runtime/process.ts';
import type { CompilerDepsReadyState } from '../../../toolchain/dependencies/runtime/project-runtime.ts';
import type { VerificationActionKeyDigest } from '../action/contract/action.ts';

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be one object.`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}.`);
  }
  return record;
}

export type HostedActionArchiveInventoryEntry = Readonly<{
  path: string;
  type: 'directory' | 'file' | 'hardlink' | 'symlink';
  linkTarget: string | null;
  size: number;
  mode: number;
  physicalContentDigest: VerificationActionKeyDigest | null;
  contentDigest: VerificationActionKeyDigest | null;
}>;

export const HOSTED_ACTION_ARCHIVE_MAX_ENTRIES = 250_000;

export const HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT = [
  'import hashlib, json, os, stat, sys, tarfile',
  'result=[]; members=[]; total=0; read_bytes=0',
  'max_entries, max_bytes = int(sys.argv[2]), int(sys.argv[3])',
  'source=open(sys.argv[1], "rb")',
  'before=os.fstat(source.fileno())',
  'if not stat.S_ISREG(before.st_mode) or before.st_size < 0 or before.st_size > max_bytes + max_entries * 8192: raise RuntimeError("archive ordinary-file bound exceeded")',
  'archive_hash=hashlib.sha256(); archive_bytes=0',
  'while True:',
  '  chunk=source.read(1048576)',
  '  if not chunk: break',
  '  archive_bytes += len(chunk)',
  '  if archive_bytes > before.st_size: raise RuntimeError("archive grew while retained")',
  '  archive_hash.update(chunk)',
  'if archive_bytes != before.st_size: raise RuntimeError("archive size changed while retained")',
  'archive_digest="sha256:" + archive_hash.hexdigest()',
  'if len(sys.argv) > 4 and archive_digest != sys.argv[4]: raise RuntimeError("archive differs from authenticated supervisor digest")',
  'source.seek(0)',
  'with tarfile.open(fileobj=source, mode="r:*") as archive:',
  '  for member in archive:',
  '    if len(members) >= max_entries: raise RuntimeError("archive entry bound exceeded")',
  '    if member.size < 0 or member.size > max_bytes: raise RuntimeError("archive member size invalid")',
  '    total += member.size if member.isreg() else 0',
  '    if total > max_bytes: raise RuntimeError("archive byte bound exceeded")',
  '    members.append(member)',
  '  for member in members:',
  '    kind = "file" if member.isreg() else "directory" if member.isdir() else "symlink" if member.issym() else "hardlink" if member.islnk() else "unsupported"',
  '    digest = None; physical_digest = None',
  '    normalized = member.name[2:] if member.name.startswith("./") else member.name',
  '    if member.isreg() or member.islnk():',
  '      stream = archive.extractfile(member)',
  '      hasher = hashlib.sha256(); physical_hasher = hashlib.sha256(); physical_hasher.update(b\'{"bytes":"\')',
  '      observed=0',
  '      while True:',
  '        chunk = stream.read(1048576) if stream is not None else b""',
  '        if not chunk: break',
  '        observed += len(chunk); read_bytes += len(chunk)',
  '        if read_bytes > max_bytes: raise RuntimeError("archive total content read bound exceeded")',
  '        if observed > max_bytes: raise RuntimeError("archive linked content byte bound exceeded")',
  '        hasher.update(chunk); physical_hasher.update(chunk.hex().encode("ascii"))',
  '      physical_hasher.update(b\'"}\'); physical_digest = "sha256:" + physical_hasher.hexdigest()',
  '      if member.isreg() and normalized in (".sec-trusted-input/candidate.bundle", ".sec-trusted-input/dependency-closure.json"): digest = "sha256:" + hasher.hexdigest()',
  '    result.append({"path": member.name, "type": kind, "linkTarget": member.linkname if member.issym() or member.islnk() else None, "size": member.size, "mode": member.mode, "physicalContentDigest": physical_digest, "contentDigest": digest})',
  'after=os.fstat(source.fileno())',
  'identity=lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_mtime_ns, value.st_ctime_ns)',
  'if identity(before) != identity(after): raise RuntimeError("archive changed during retained inventory")',
  'source.close()',
  'sys.stdout.write(json.dumps({"archiveDigest": archive_digest, "entries": result}, ensure_ascii=True, separators=(",", ":"), sort_keys=True))'
].join('\n');

export function canonicalHostedArchivePath(source: string, label: string, allowRoot: boolean): string | null {
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

export function validateHostedSutArchiveInventory(
  source: unknown,
  maximumFileBytes: number
): Readonly<{
  entries: readonly HostedActionArchiveInventoryEntry[];
  inventoryDigest: VerificationActionKeyDigest;
  totalFileBytes: number;
}> {
  if (!Number.isSafeInteger(maximumFileBytes) || maximumFileBytes < 1) throw new Error('Hosted Action archive file byte bound is invalid.');
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
      totalFileBytes > maximumFileBytes) {
    throw new Error('Hosted Action archive file bytes exceed the private workspace bound.');
  }
  const canonicalEntries = Object.freeze([...entries].sort((left, right) => left.path.localeCompare(right.path)));
  return Object.freeze({
    entries: canonicalEntries,
    inventoryDigest: sha256(canonicalEntries) as VerificationActionKeyDigest,
    totalFileBytes
  });
}

// These are narrower local data-import ceilings, not execution qualification.
const MAX_CONTENT_BYTES = 4_294_967_296;
const MAX_INVENTORY_BYTES = 128 * 1024 * 1024;
const MAX_PREPARATION_MS = 300_000;
const PREPARATION_REQUIREMENT = 'hosted-sut-dependency-content';
const PREPARATION_CONTRACT = sha256({ schema: 'sec-hosted-sut-dependency-content-v1' }) as SecOperationDigest;
const AUTHORITY_FILES = Object.freeze(['.bun-version', 'bun.lock', 'bunfig.toml', 'package.json'] as const);
const ARCHIVE_PATH = '/authenticated-input/prepared-candidate.tar';
const TRUSTED_ROOT = '/trusted-input-base';
const WORKSPACE_ROOT = '/workspace';
const CONTENT_ROOT = '/dependency-content';

export type HostedSutDependencyPreparationBinding = Readonly<{
  schema: 'sec-hosted-sut-dependency-preparation-v1';
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  archiveDigest: VerificationActionKeyDigest;
  inventoryDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyClosureDigest: VerificationActionKeyDigest;
  gitBundleDigest: VerificationActionKeyDigest;
  deadlineAtUnixMs: number;
}>;

/** Correlation only: this parser never issues source or execution authority. */
export function captureHostedSutDependencyPreparationBinding(source: string): HostedSutDependencyPreparationBinding {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 8192) throw new Error('Hosted SUT preparation binding is oversized.');
  const value = exactObject(JSON.parse(source), [
    'schema', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'archiveDigest',
    'inventoryDigest', 'entryCount', 'totalFileBytes', 'dependencyClosureDigest',
    'gitBundleDigest', 'deadlineAtUnixMs'
  ], 'Hosted SUT preparation correlation');
  if (value.schema !== 'sec-hosted-sut-dependency-preparation-v1'
    || !['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha'].every(key => typeof value[key] === 'string' && /^[0-9a-f]{40}$/u.test(value[key]))
    || !['archiveDigest', 'inventoryDigest', 'dependencyClosureDigest', 'gitBundleDigest'].every(key => typeof value[key] === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value[key]))
    || !Number.isSafeInteger(value.entryCount) || Number(value.entryCount) < 1 || Number(value.entryCount) > HOSTED_ACTION_ARCHIVE_MAX_ENTRIES
    || !Number.isSafeInteger(value.totalFileBytes) || Number(value.totalFileBytes) < 0 || Number(value.totalFileBytes) > MAX_CONTENT_BYTES
    || !Number.isSafeInteger(value.deadlineAtUnixMs) || Number(value.deadlineAtUnixMs) <= 0) {
    throw new Error('Hosted SUT preparation correlation is invalid.');
  }
  return Object.freeze(value) as HostedSutDependencyPreparationBinding;
}

/** Complete physical projection comparison; no supplied inventory creates authority. */
export function assertHostedSutExtractedArchiveProjection(
  archived: readonly HostedActionArchiveInventoryEntry[],
  observed: readonly NoFollowDirectoryTreeInventoryEntry[],
  hardlinkTopology: 'preserved' | 'copied-bytes' = 'preserved'
): void {
  const byPath = new Map(archived.map(entry => [entry.path, entry]));
  if (byPath.size !== archived.length || observed.length !== archived.length) {
    throw new Error('Hosted SUT extracted archive membership differs.');
  }
  const observedByPath = new Map(observed.map(entry => [entry.relativePath, entry]));
  const seen = new Set<string>();
  const resolvedFile = (entry: HostedActionArchiveInventoryEntry): HostedActionArchiveInventoryEntry => {
    const visited = new Set<string>();
    let current = entry;
    while (current.type === 'hardlink') {
      if (visited.has(current.path)) throw new Error('Hosted SUT extracted archive hardlink cycle.');
      visited.add(current.path);
      const next = byPath.get(current.linkTarget ?? '');
      if (next === undefined) throw new Error('Hosted SUT extracted archive hardlink target is missing.');
      current = next;
    }
    return current;
  };
  for (const actual of observed) {
    const expected = byPath.get(actual.relativePath);
    if (expected === undefined || seen.has(actual.relativePath)) throw new Error('Hosted SUT extracted archive has an extra or duplicate member.');
    seen.add(actual.relativePath);
    const parents = actual.relativePath.split('/');
    parents.pop();
    while (parents.length > 0) {
      if (byPath.get(parents.join('/'))?.type !== 'directory') throw new Error('Hosted SUT archive member ancestor is not an explicit directory.');
      parents.pop();
    }
    if (expected.path.startsWith('node_modules/') && expected.linkTarget !== null
      && !expected.linkTarget.startsWith('node_modules/')) throw new Error('Hosted SUT dependency link escapes its content root.');
    if (expected.type === 'directory') {
      if (actual.kind !== 'directory' || actual.linkTarget !== null) throw new Error(`Hosted SUT archive directory differs: ${expected.path}.`);
    } else if (expected.type === 'symlink') {
      if (actual.kind !== 'link' || actual.linkTarget === null
        || resolveHostedArchiveLinkTarget(actual.relativePath, actual.linkTarget, false) !== expected.linkTarget) {
        throw new Error(`Hosted SUT archive link differs: ${expected.path}.`);
      }
    } else {
      const content = resolvedFile(expected);
      if (expected.type === 'hardlink' && hardlinkTopology === 'preserved') {
        const target = observedByPath.get(content.path);
        if (target === undefined || target.device !== actual.device || target.inode !== actual.inode) {
          throw new Error(`Hosted SUT archive hardlink object differs: ${expected.path}.`);
        }
      }
      if (content.type !== 'file' || actual.kind !== 'file' || actual.size !== content.size
        || actual.contentDigest !== expected.physicalContentDigest || actual.linkTarget !== null
        || actual.permissionMode === undefined || actual.permissionMode === null
        || (actual.permissionMode & 0o111) !== (content.mode & 0o111)) {
        throw new Error(`Hosted SUT archive file differs: ${expected.path}.`);
      }
    }
  }
}

function assertLauncherOwnedObject(filePath: string, directory: boolean): void {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
    || stat.uid !== 0 || (stat.mode & 0o222) !== 0 || realpathSync.native(filePath) !== filePath) {
    throw new Error(`Hosted SUT preparation requires its fixed immutable launcher object: ${filePath}.`);
  }
}

/**
 * Only the original fixed supervisor launcher calls this entry, before any
 * candidate instruction. Its root-owned base checkout and native FD 3 are the
 * origin boundary. JSON only narrows those actual objects; it cannot mint an
 * authenticated archive, and no data capability escapes this scope.
 */
export async function runHostedSutDependencyPreparationFromTrustedLauncher(
  bindingJson: string
): Promise<Readonly<{ ready: CompilerDepsReadyState; resources: ProcessResourceSessionReceipt }>> {
  const binding = captureHostedSutDependencyPreparationBinding(bindingJson);
  const started = Date.now();
  const deadlineAtUnixMs = Math.min(binding.deadlineAtUnixMs, started + MAX_PREPARATION_MS);
  const deadlineAtMonotonicMs = performance.now() + deadlineAtUnixMs - started;
  if (process.platform !== 'linux' || process.getuid?.() !== 65532 || process.getgid?.() !== 65532
    || process.cwd() !== TRUSTED_ROOT
    || fileURLToPath(import.meta.url) !== `${TRUSTED_ROOT}/src/adapters/verification/platform/ci/hosted-sut-dependency-preparation.ts`
    || deadlineAtUnixMs <= started) throw new Error('Hosted SUT preparation is outside the fixed trusted pre-candidate launcher.');
  assertLauncherOwnedObject(TRUSTED_ROOT, true);
  assertLauncherOwnedObject(ARCHIVE_PATH, false);
  assertLauncherOwnedObject(fileURLToPath(import.meta.url), false);
  const inherited = fstatSync(3, { bigint: true });
  if (!inherited.isFile() || inherited.uid !== 0n || (inherited.mode & 0o222n) !== 0n
    || inherited.nlink !== 1n || inherited.size > BigInt(MAX_CONTENT_BYTES + HOSTED_ACTION_ARCHIVE_MAX_ENTRIES * 8192)) {
    throw new Error('Hosted SUT preparation requires the original launcher ordinary archive descriptor.');
  }
  const trusted = inspectNoFollowDirectoryChain(TRUSTED_ROOT, 'Hosted SUT trusted base');
  const workspace = inspectNoFollowDirectoryChain(WORKSPACE_ROOT, 'Hosted SUT candidate data');
  const content = inspectNoFollowDirectoryChain(CONTENT_ROOT, 'Hosted SUT borrowed dependency content');
  assertPhysicallyDisjointDirectoryChains(workspace, content, 'Hosted SUT dependency content separation');
  assertPhysicallyDisjointDirectoryChains(trusted, content, 'Hosted SUT loader source separation');
  if (lstatSync(CONTENT_ROOT).uid !== 65532 || scanNoFollowDirectoryTreeMetadata(content.target, {
    deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: 1
  }).length !== 0) throw new Error('Hosted SUT dependency content must start as the empty launcher-owned transport directory.');
  const plan = compileSecSemanticOperationPlan({
    operation: PREPARATION_REQUIREMENT,
    intentDigest: sha256(binding) as SecOperationDigest,
    decisionDigest: PREPARATION_CONTRACT,
    deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: binding.archiveDigest as SecOperationDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: deadlineAtUnixMs - started },
      { resource: 'processes', maximum: 8 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: MAX_INVENTORY_BYTES + 1024 * 1024 }
    ],
    requirements: [{ id: PREPARATION_REQUIREMENT, contractDigest: PREPARATION_CONTRACT,
      effectKinds: ['filesystem', 'process'], failureKinds: ['provider.drift', 'provider.unavailable',
        'process.cancelled', 'process.deadline-exhausted', 'process.output-budget-exhausted', 'process.settlement-unproven'] }]
  });
  const operation = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: PREPARATION_REQUIREMENT, contractDigest: PREPARATION_CONTRACT,
    providerIdentityDigest: PREPARATION_CONTRACT
  })]);
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new Error('Hosted SUT preparation cancelled by launcher.'));
  const processes = openProcessResourceSession({ operation, signal: cancellation.signal,
    requirementBindingContext: issueSecOperationRequirementBindingContext({ operation,
      requirementId: PREPARATION_REQUIREMENT, resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  let archive: RetainedNoFollowOrdinaryFile | undefined;
  const executables: RetainedNoFollowOrdinaryFile[] = [];
  let workingDirectory: RetainedNoFollowChildProcessDirectory | undefined;
  let generation: RetainedNoFollowProvenDirectoryGeneration | undefined;
  let contentAdmitted = false;
  let contentReleased = false;
  let ready: CompilerDepsReadyState | undefined;
  let resources: ProcessResourceSessionReceipt | undefined;
  let primary: ResourceSettlementFailure | undefined;
  const assertCurrent = (): void => {
    if (isNativeAborted(processes.signal) || performance.now() >= deadlineAtMonotonicMs) throw new Error('Hosted SUT dependency preparation deadline or cancellation.');
    assertSameNoFollowDirectoryIdentity(trusted.target);
    assertSameNoFollowDirectoryIdentity(workspace.target);
    assertSameNoFollowDirectoryIdentity(content.target);
    archive?.assertCurrent();
  };
  const scan = (root: PhysicalDirectoryIdentity, excludeRelativePaths?: readonly string[]) => {
    assertCurrent();
    return scanNoFollowDirectoryTreeInventory(root, { deadlineAtMs: deadlineAtMonotonicMs,
      maximumEntries: HOSTED_ACTION_ARCHIVE_MAX_ENTRIES, maximumBytes: MAX_CONTENT_BYTES,
      includePermissionMode: true, signal: processes.signal, excludeRelativePaths });
  };
  try {
    archive = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(ARCHIVE_PATH)),
      path.basename(ARCHIVE_PATH), { device: String(inherited.dev), inode: String(inherited.ino) },
      'Hosted SUT original authenticated archive', 5);
    assertRetainedNoFollowCapability(archive, 'ordinary-file', 'Hosted SUT original archive');
    workingDirectory = retainNoFollowDirectoryForChildProcess(trusted, 4, 'Hosted SUT trusted preparation cwd');
    const run = async (executablePath: string, args: readonly string[], maximumOutputBytes: number): Promise<string> => {
      assertCurrent();
      const exact = realpathSync.native(executablePath);
      const executable = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(exact)),
        path.basename(exact), undefined, 'Hosted SUT preparation native executable', 3, 'executable');
      executables.push(executable);
      const result = await processes.run(issueRetainedCommandBoundary({ executable,
        workingDirectory: workingDirectory!, auxiliaryInputs: [{ capability: archive!, kind: 'ordinary-file' }] }), args,
      { envMode: 'replace', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: '/home/sut',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      maxStdoutBytes: maximumOutputBytes, maxStderrBytes: 64 * 1024 });
      assertCurrent();
      if (result.result.code !== 0) throw new Error(`Hosted SUT retained preparation command failed (${result.result.code}).`);
      return new TextDecoder('utf-8', { fatal: true }).decode(result.result.stdout);
    };
    const inspected = exactObject(JSON.parse(await run('/usr/bin/python3',
      ['-I', '-B', '-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT, archive.childPath,
        String(HOSTED_ACTION_ARCHIVE_MAX_ENTRIES), String(MAX_CONTENT_BYTES), binding.archiveDigest], MAX_INVENTORY_BYTES)),
    ['archiveDigest', 'entries'], 'Hosted SUT retained archive inspection');
    const inventory = validateHostedSutArchiveInventory(inspected.entries, MAX_CONTENT_BYTES);
    if (inspected.archiveDigest !== binding.archiveDigest || inventory.inventoryDigest !== binding.inventoryDigest
      || inventory.entries.length !== binding.entryCount || inventory.totalFileBytes !== binding.totalFileBytes
      || inventory.entries.find(entry => entry.path === '.sec-trusted-input/candidate.bundle')?.contentDigest !== binding.gitBundleDigest
      || inventory.entries.find(entry => entry.path === '.sec-trusted-input/dependency-closure.json')?.contentDigest !== binding.dependencyClosureDigest) {
      throw new Error('Hosted SUT archive complete inventory differs from the original supervisor binding.');
    }
    // Read base objects through the UID-owned workspace's authenticated bundle
    // database. The root-owned trusted base needs no safe.directory exception.
    for (const [revision, expected] of [[`${binding.baseSha}^{commit}`, binding.baseSha],
      [`${binding.baseSha}^{tree}`, binding.baseTreeSha], ['HEAD', binding.headSha],
      ['HEAD^{tree}', binding.headTreeSha]] as const) {
      const observed = await run('/usr/bin/git', ['-C', WORKSPACE_ROOT, '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false', 'rev-parse', '--verify', revision], 1024);
      if (observed !== `${expected}\n`) throw new Error('Hosted SUT trusted base or candidate Git identity differs.');
    }
    const baseObjects = await run('/usr/bin/git', ['-C', WORKSPACE_ROOT, '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false', 'ls-tree', '-z', binding.baseSha, '--', ...AUTHORITY_FILES], 4096);
    const baseBlobs = new Map<string, string>();
    for (const record of baseObjects.split('\0').filter(Boolean)) {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)$/u.exec(record);
      if (match === null || !(AUTHORITY_FILES as readonly string[]).includes(match[3]!) || baseBlobs.has(match[3]!)) {
        throw new Error('Hosted SUT base dependency object inventory is invalid.');
      }
      baseBlobs.set(match[3]!, match[2]!);
    }
    if (baseBlobs.size !== AUTHORITY_FILES.length) throw new Error('Hosted SUT base dependency objects are incomplete.');
    const extracted = scan(workspace.target, ['.git']);
    assertHostedSutExtractedArchiveProjection(inventory.entries, extracted);
    const authorityBytes = new Map<string, Uint8Array>();
    for (const name of AUTHORITY_FILES) {
      if (inventory.entries.find(entry => entry.path === name)?.type !== 'file') throw new Error(`Hosted SUT dependency authority is missing: ${name}.`);
      const base = retainNoFollowOrdinaryFile(trusted, name, undefined, 'Hosted SUT genuine base dependency input');
      let candidate: RetainedNoFollowOrdinaryFile | undefined;
      let failure: ResourceSettlementFailure | undefined;
      try {
        candidate = retainNoFollowOrdinaryFile(workspace, name, undefined, 'Hosted SUT candidate dependency input');
        const bytes = Buffer.from(base.readBytes());
        const blobDigest = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
        if (blobDigest !== baseBlobs.get(name)) throw new Error(`Hosted SUT genuine base input differs from its authenticated Git object: ${name}.`);
        if (!bytes.equals(Buffer.from(candidate.readBytes()))) throw new Error(`Hosted SUT dependency input differs from genuine base: ${name}.`);
        base.assertCurrent(); candidate.assertCurrent(); authorityBytes.set(name, bytes);
      } catch (error) { failure = { label: 'Hosted SUT dependency authority comparison', error }; }
      await settleResourcesAsync({ primary: failure, cleanup: [
        { label: 'Hosted SUT base dependency input', settle: () => base.dispose() },
        { label: 'Hosted SUT candidate dependency input', settle: () => candidate?.dispose() }
      ] });
    }
    const raw = inspectNoFollowDirectoryLeaf(workspace.target, 'node_modules', 'Hosted SUT raw dependencies');
    if (raw === null || inventory.entries.find(entry => entry.path === 'node_modules')?.type !== 'directory') throw new Error('Hosted SUT raw dependency content is absent.');
    const rawBefore = scan(raw);
    contentAdmitted = true;
    await copyNoFollowDirectoryTreesBulk([{ source: raw, target: `${CONTENT_ROOT}/node_modules` }], {
      assertCurrent, deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: HOSTED_ACTION_ARCHIVE_MAX_ENTRIES,
      maximumBytes: MAX_CONTENT_BYTES, preserveFilePermissionMode: true, signal: processes.signal
    });
    for (const [name, bytes] of authorityBytes) {
      assertCurrent();
      publishExclusiveDurableCanonicalFile({ parent: content.target, name, bytes,
        validate: observed => { if (!Buffer.from(observed).equals(Buffer.from(bytes))) throw new Error('Hosted SUT copied authority input differs.'); } });
    }
    const copied = scan(content.target);
    const projected = inventory.entries.filter(entry => (AUTHORITY_FILES as readonly string[]).includes(entry.path)
      || entry.path === 'node_modules' || entry.path.startsWith('node_modules/'));
    assertHostedSutExtractedArchiveProjection(projected, copied, 'copied-bytes');
    assertHostedSutExtractedArchiveProjection(inventory.entries, scan(workspace.target, ['.git']));
    if (sha256(scan(raw)) !== sha256(rawBefore)) throw new Error('Hosted SUT raw dependency source changed during retained copy.');
    // No candidate packages have loaded. Only now is the original producer's
    // exact authenticated dependency projection available to the trusted loader.
    const published = await materializeRetainedNoFollowProvenDirectoryGeneration({
      root: content.target, inventory: copied, proofText: null, releaseMode: 'restore-owner-write',
      binding: { generationDigest: sha256({ archiveDigest: binding.archiveDigest, content: copied }),
        treeDigest: sha256(copied), treeEntryCount: copied.length },
      deadlineAtUnixMs, signal: processes.signal
    });
    generation = published.generation;
    await generation.assertAuthorityCurrent();
    retireNoFollowDirectoryTree({ root: raw, parent: workspace.target, inventory: rawBefore, deadlineAtMonotonicMs });
    assertCurrent();
    const { ensureCompilerDepsReadyFromRetainedContent } = await import('../../../toolchain/dependencies/runtime/project-runtime.ts');
    ready = await ensureCompilerDepsReadyFromRetainedContent(generation, {
      installMode: 'offline-copy-only', deadlineAtUnixMs, signal: processes.signal
    }, WORKSPACE_ROOT);
    await generation.assertAuthorityCurrent();
    assertCurrent();
  } catch (error) { primary = { label: 'Hosted SUT dependency content preparation', error }; }
  try {
    await settleResourcesAsync({ primary, cleanup: [
    { label: 'Hosted SUT borrowed content generation', settle: async () => {
      if (generation === undefined) { contentReleased = true; return; }
      assertPhysicalGenerationRetirementReceipt(await generation.retire()); contentReleased = true;
    } },
    ...executables.map((executable, index) => ({ label: `Hosted SUT native executable ${index}`, settle: () => executable.dispose() })),
    { label: 'Hosted SUT preparation cwd', settle: () => workingDirectory?.dispose() },
    { label: 'Hosted SUT borrowed archive handle', settle: () => archive?.dispose() },
    { label: 'Hosted SUT preparation process resources', settle: () => {
      const closed = processes.close();
      assertProcessResourceSessionReceipt(closed, { operationIdentityDigest: operation.plan.identity.identityDigest,
        boundAttemptDigest: operation.boundAttemptDigest, requirementId: PREPARATION_REQUIREMENT });
      resources = closed;
    } },
    { label: 'Hosted SUT preparation cancellation listeners', settle: () => {
      process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    } },
    { label: 'Hosted SUT borrowed content transport', settle: async () => {
      if (!contentAdmitted) return;
      if (!contentReleased || resources === undefined) throw new Error('Hosted SUT content transport settlement is unresolved.');
      const inventory = scanNoFollowDirectoryTreeMetadata(content.target, {
        deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: HOSTED_ACTION_ARCHIVE_MAX_ENTRIES
      });
      // Keep the shell-owned empty root for the launcher's final retirement.
      await settleResourcesAsync({ cleanup: inventory.filter(entry => !entry.relativePath.includes('/')).map(entry => ({
        label: `Hosted SUT content transport member ${entry.relativePath}`,
        settle: () => {
          if (performance.now() >= deadlineAtMonotonicMs) throw new Error('Hosted SUT content retirement deadline exhausted.');
          if (entry.kind !== 'directory') {
            deleteRetainedNoFollowEntry({ root: content.target, relativePath: entry.relativePath,
              kind: entry.kind, device: entry.device, inode: entry.inode, ancestorDirectories: [],
              ...(entry.linkTarget === null ? {} : { expectedLinkTarget: entry.linkTarget }) });
            return;
          }
          const root = inspectNoFollowDirectoryLeaf(content.target, entry.relativePath);
          if (root === null || root.device !== entry.device || root.inode !== entry.inode) {
            throw new Error('Hosted SUT content transport retirement identity changed.');
          }
          retireNoFollowDirectoryTree({ root, parent: content.target,
            inventory: scanNoFollowDirectoryTreeMetadata(root, { deadlineAtMs: deadlineAtMonotonicMs,
              maximumEntries: HOSTED_ACTION_ARCHIVE_MAX_ENTRIES }), deadlineAtMonotonicMs });
        }
      })) });
      if (scanNoFollowDirectoryTreeMetadata(content.target, { deadlineAtMs: deadlineAtMonotonicMs,
        maximumEntries: 1 }).length !== 0) throw new Error('Hosted SUT content transport retirement is not empty.');
    } }
    ] });
  } catch (error) {
    if (ready !== undefined) {
      throw new HostedSutDependencyPreparationSettlementError(ready, error);
    }
    throw error;
  }
  if (ready === undefined || resources === undefined) throw new Error('Hosted SUT dependency preparation has no settled ready result.');
  return Object.freeze({ ready, resources });
}

/** A published dependency generation remains the original owner's obligation. */
export class HostedSutDependencyPreparationSettlementError extends Error {
  constructor(readonly ready: CompilerDepsReadyState, failure: unknown) {
    super('Hosted SUT dependencies were published, but preparation resource settlement failed.', { cause: failure });
    this.name = 'HostedSutDependencyPreparationSettlementError';
  }
}
