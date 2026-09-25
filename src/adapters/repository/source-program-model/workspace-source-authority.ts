import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, compareCodeUnits, rawSha256 } from '../../../contracts/canonical.ts';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { mapTaskGroup } from '../../../execution/task-group.ts';
import { type ExactGitTreeEntry, type ExactGitTextBlob, ListExactGitTreeEntriesFromSession, ReadExactGitTextBlobsBatchFromSession } from '../../providers/git-read/exact-blob.ts';
import { type GitReadSession, assertProductionGitReadSession } from '../../providers/git-read/runtime/session.ts';
import type { RepositoryModuleGraph } from '../architecture/contract.ts';
import { type RepositoryModuleMembership, normalizeRepositoryModulePath, compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import { type SourceProgramFileInput, type SourceProgramCompilation, isSourceProgramInputPath, type SourceProgramCompilationMatchInput } from './contract.ts';
import { sourceProgramModuleImports } from './embedded-programs.ts';
import { compileRepositoryModuleGraph } from './typescript.ts';
import { canonicalFiles, sourceGeneration, type WorkspaceSourceFile, type WorkspaceSourceFileMode } from './workspace-source-content.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

const SOURCE_SNAPSHOT_MAX_FILE_BYTES = 2 * 1024 * 1024;

const SOURCE_SNAPSHOT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

const workspaceSourceSnapshotBrand: unique symbol = Symbol('workspace-source-snapshot');

const issuedWorkspaceSourceSnapshots = new WeakSet<object>();

const stagedWorkspaceSourceSelectionBrand: unique symbol = Symbol(
  'staged-workspace-source-selection'
);

const issuedStagedWorkspaceSourceSelections = new WeakSet<object>();

export type WorkspaceSourceSnapshotSubject =
  | Readonly<{
      kind: 'physical-repository';
      provenance:
        | Readonly<{
            kind: 'git-tree';
            commitSha: string;
            identityDigest: `sha256:${string}`;
            objectCensusDigest: `sha256:${string}`;
          }>
        | Readonly<{
            kind: 'working-tree-observation';
            identityDigest: `sha256:${string}`;
            providerIdentityDigest: `sha256:${string}`;
            repositoryRootIdentityDigest: `sha256:${string}`;
          }>
        | Readonly<{
            kind: 'staged-index-observation';
            identityDigest: `sha256:${string}`;
            indexDigest: `sha256:${string}`;
            indexTreeDigest: `sha256:${string}`;
            indexPhysicalIdentityDigest: `sha256:${string}`;
            providerIdentityDigest: `sha256:${string}`;
            repositoryRootIdentityDigest: `sha256:${string}`;
          }>;
    }>
  | Readonly<{
      kind: 'virtual-mutation';
      provenance: Readonly<{
        kind: 'source-program-virtual-mutation';
        baseSnapshotDigest: `sha256:${string}`;
        mutationDigest: `sha256:${string}`;
      }>;
    }>;

type PhysicalObservationReceipt = Extract<
  WorkspaceSourceSnapshotSubject,
  { kind: 'physical-repository' }
>['provenance'];

type IssueWorkspaceSourceSnapshotInput = Readonly<{
  subject: WorkspaceSourceSnapshotSubject;
  files: readonly WorkspaceSourceFile[];
  moduleMembership: RepositoryModuleMembership;
  sourceByteLength: number | null;
}>;

export type CompileVirtualSnapshotInput = Readonly<{
  subject: Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>;
  files: readonly (SourceProgramFileInput & Readonly<{ mode?: WorkspaceSourceFileMode }>)[];
  moduleMembership: RepositoryModuleMembership;
}>;

type IssuePhysicalWorkspaceSourceSnapshotInput = Omit<
  IssueWorkspaceSourceSnapshotInput,
  'subject'
> & Readonly<{
  session: GitReadSession;
  provenance:
    | Readonly<{
        kind: 'working-tree-observation';
        identityDigest: `sha256:${string}`;
      }>
    | Readonly<{
        kind: 'staged-index-observation';
        identityDigest: `sha256:${string}`;
        indexDigest: `sha256:${string}`;
        indexTreeDigest: `sha256:${string}`;
        indexPhysicalIdentityDigest: `sha256:${string}`;
      }>;
}>;

export type AcquireWorkingTreeSnapshotInput = Readonly<{
  session: GitReadSession;
}>;

export type AcquireStagedIndexSnapshotInput = Readonly<{
  session: GitReadSession;
}>;

export interface StagedSourceSelection {
  readonly [stagedWorkspaceSourceSelectionBrand]: true;
  readonly candidateBase: string;
  readonly snapshotSubjectDigest: `sha256:${string}`;
  readonly selectedPaths: readonly string[];
  readonly selectionDigest: `sha256:${string}`;
}

export type AcquireExactGitTreeSnapshotInput = Readonly<{
  commitSha: string;
  session: GitReadSession;
}>;

/**
 * One immutable, process-local capability for every semantic projection of an
 * exact workspace subject. Consumers receive repository-relative paths and
 * exact source text only; physical paths and transport encodings are not part
 * of the public input.
 */
export interface WorkspaceSourceSnapshot extends SourceProgramCompilation {
  readonly [workspaceSourceSnapshotBrand]: true;
  readonly subject: WorkspaceSourceSnapshotSubject;
  readonly subjectDigest: `sha256:${string}`;
  readonly sourceRevision: `sha256:${string}`;
  readonly physicalObservationReceipt: PhysicalObservationReceipt | null;
  readonly files: readonly WorkspaceSourceFile[];
  /** Physical provider observation reused by resource admission; never semantic identity. */
  readonly sourceByteLength: number | null;
  readonly moduleMembership: RepositoryModuleMembership;
  readonly snapshotDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphCompilationCount: 1;
  file(repositoryPath: string): WorkspaceSourceFile | null;
}

export type PhysicalWorkspaceSourceSnapshot = WorkspaceSourceSnapshot & Readonly<{
  subject: Extract<WorkspaceSourceSnapshotSubject, { kind: 'physical-repository' }>;
}>;

export type VirtualWorkspaceSourceSnapshot = WorkspaceSourceSnapshot & Readonly<{
  subject: Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>;
}>;

export function assertWorkspaceSourceSnapshot(
  snapshot: WorkspaceSourceSnapshot
): void {
  if (!issuedWorkspaceSourceSnapshots.has(snapshot)) {
    throw new Error('Workspace source snapshot was not issued by the Source Program owner');
  }
}

export function assertPhysicalWorkspaceSourceSnapshot(
  snapshot: WorkspaceSourceSnapshot
): asserts snapshot is PhysicalWorkspaceSourceSnapshot {
  assertWorkspaceSourceSnapshot(snapshot);
  if (snapshot.subject.kind !== 'physical-repository') {
    throw new Error('Production Source Program compilation requires a physical workspace snapshot');
  }
}

function exactDigest(value: string, label: string): asserts value is `sha256:${string}` {
  if (!DIGEST.test(value)) throw new Error(`${label} must be one exact sha256 digest`);
}

function canonicalSubject(
  subject: WorkspaceSourceSnapshotSubject
): WorkspaceSourceSnapshotSubject {
  if (subject.kind === 'physical-repository') {
    if (subject.provenance.kind !== 'git-tree'
        && subject.provenance.kind !== 'working-tree-observation'
        && subject.provenance.kind !== 'staged-index-observation') {
      throw new Error('Workspace source snapshot physical provenance is invalid');
    }
    exactDigest(subject.provenance.identityDigest, 'Workspace source snapshot physical provenance');
    if (subject.provenance.kind === 'git-tree') {
      if (!/^[0-9a-f]{40,64}$/u.test(subject.provenance.commitSha)) {
        throw new Error('Workspace source snapshot Git provenance commit is invalid');
      }
      exactDigest(subject.provenance.objectCensusDigest, 'Workspace source snapshot object census');
    } else {
      exactDigest(subject.provenance.providerIdentityDigest, 'Workspace source snapshot provider');
      exactDigest(subject.provenance.repositoryRootIdentityDigest, 'Workspace source snapshot root');
      if (subject.provenance.kind === 'staged-index-observation') {
        exactDigest(subject.provenance.indexDigest, 'Workspace source snapshot staged index');
        exactDigest(subject.provenance.indexTreeDigest, 'Workspace source snapshot staged tree');
        exactDigest(
          subject.provenance.indexPhysicalIdentityDigest,
          'Workspace source snapshot staged index physical identity'
        );
      }
    }
    return Object.freeze({ kind: subject.kind, provenance: Object.freeze({ ...subject.provenance }) });
  }
  if (subject.provenance.kind !== 'source-program-virtual-mutation') {
    throw new Error('Workspace source snapshot virtual provenance is invalid');
  }
  exactDigest(subject.provenance.baseSnapshotDigest, 'Workspace source snapshot virtual base');
  exactDigest(subject.provenance.mutationDigest, 'Workspace source snapshot virtual mutation');
  return Object.freeze({ kind: subject.kind, provenance: Object.freeze({ ...subject.provenance }) });
}

function membershipDigest(
  files: readonly SourceProgramFileInput[],
  membership: RepositoryModuleMembership
): `sha256:${string}` {
  return sha256({
    graphRoots: [...membership.graphRoots].sort(compareCodeUnits),
    moduleRoots: [...membership.moduleRoots].sort(compareCodeUnits),
    fileBindings: files.map(({ path }) => ({ path, module: membership.moduleForPath(path) }))
  }) as `sha256:${string}`;
}

function graphDigest(graph: RepositoryModuleGraph): `sha256:${string}` {
  return sha256({
    files: graph.files,
    references: graph.references,
    unresolvedFiles: graph.unresolvedFiles
  }) as `sha256:${string}`;
}

function emptyModuleMembership(): RepositoryModuleMembership {
  return Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
}

function issueWorkspaceSourceSnapshot(
  input: IssueWorkspaceSourceSnapshotInput
): WorkspaceSourceSnapshot {
  if (input.sourceByteLength !== null
      && (!Number.isSafeInteger(input.sourceByteLength) || input.sourceByteLength < 0)) {
    throw new Error('Workspace source snapshot physical byte observation is invalid');
  }
  const subject = canonicalSubject(input.subject);
  const files = canonicalFiles(input.files);
  const sourceRevision = sourceGeneration(files);
  const exactMembershipDigest = membershipDigest(files, input.moduleMembership);
  const sourceByPath = new Map(files.map((file) => [file.path, file] as const));
  const subjectDigest = sha256(subject) as `sha256:${string}`;
  let semanticProjection: Readonly<{
    moduleGraph: RepositoryModuleGraph;
    moduleGraphDigest: `sha256:${string}`;
    snapshotDigest: `sha256:${string}`;
    identityDigest: `sha256:${string}`;
  }> | null = null;
  const requireSemanticProjection = () => {
    if (semanticProjection !== null) return semanticProjection;
    const moduleGraph = compileRepositoryModuleGraph({
      files: files.filter(({ path }) => isSourceProgramInputPath(path)).map(({ path }) => path),
      readSource: (repositoryPath) => sourceByPath.get(repositoryPath)?.source ?? null,
      readImports: (repositoryPath, source) => sourceProgramModuleImports(repositoryPath, source)
    });
    const moduleGraphDigest = graphDigest(moduleGraph);
    const snapshotDigest = sha256({
      sourceRevision,
      moduleMembershipDigest: exactMembershipDigest,
      moduleGraphDigest
    }) as `sha256:${string}`;
    semanticProjection = Object.freeze({
      moduleGraph,
      moduleGraphDigest,
      snapshotDigest,
      identityDigest: sha256({
        subjectDigest,
        sourceRevision,
        snapshotDigest,
        moduleMembershipDigest: exactMembershipDigest,
        moduleGraphDigest
      }) as `sha256:${string}`
    });
    return semanticProjection;
  };
  const assertMatches = (candidate: SourceProgramCompilationMatchInput): void => {
    const candidateFiles = canonicalFiles(candidate.files);
    const candidateRevision = candidate.sourceRevision ?? candidate.productionModel?.sourceRevision;
    const projection = requireSemanticProjection();
    if (candidateRevision !== sourceRevision
        || sourceGeneration(candidateFiles) !== sourceRevision
        || membershipDigest(candidateFiles, candidate.moduleMembership) !== exactMembershipDigest
        || graphDigest(projection.moduleGraph) !== projection.moduleGraphDigest) {
      throw new Error('Workspace source snapshot does not bind the supplied exact input');
    }
  };
  const snapshot: WorkspaceSourceSnapshot = Object.freeze({
    [workspaceSourceSnapshotBrand]: true as const,
    subject,
    subjectDigest,
    sourceRevision,
    physicalObservationReceipt: subject.kind === 'physical-repository'
      ? subject.provenance
      : null,
    files,
    sourceByteLength: input.sourceByteLength,
    moduleMembership: input.moduleMembership,
    moduleMembershipDigest: exactMembershipDigest,
    get snapshotDigest() { return requireSemanticProjection().snapshotDigest; },
    get moduleGraphDigest() { return requireSemanticProjection().moduleGraphDigest; },
    get identityDigest() { return requireSemanticProjection().identityDigest; },
    get moduleGraphCompilationCount() {
      requireSemanticProjection();
      return 1 as const;
    },
    get moduleGraph() { return requireSemanticProjection().moduleGraph; },
    file: (repositoryPath: string) => sourceByPath.get(repositoryPath) ?? null,
    assertMatches
  });
  issuedWorkspaceSourceSnapshots.add(snapshot);
  return snapshot;
}

/** Pure, explicitly unbound input for virtual reductions and synthetic tests. */
export function compileVirtualSnapshot(
  input: CompileVirtualSnapshotInput
): VirtualWorkspaceSourceSnapshot {
  return issueWorkspaceSourceSnapshot({
    subject: input.subject,
    files: canonicalFiles(input.files),
    moduleMembership: input.moduleMembership,
    sourceByteLength: null
  }) as VirtualWorkspaceSourceSnapshot;
}

/**
 * Production admission requires the canonical Git-read issuer and its retained
 * provider/cwd identities. Caller bytes remain exact inputs, but a structural
 * object or test session cannot promote them to a physical repository fact.
 */
function issuePhysicalWorkspaceSourceSnapshot(
  input: IssuePhysicalWorkspaceSourceSnapshotInput
): PhysicalWorkspaceSourceSnapshot {
  assertProductionGitReadSession(input.session);
  if (input.session.failure !== null
      || input.session.providerIdentity === null
      || input.session.workingDirectoryIdentity == null
      || !input.session.verifyExecutable()
      || input.session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Physical workspace source snapshot requires a current retained Git session');
  }
  const providerIdentityDigest = sha256(input.session.providerIdentity) as `sha256:${string}`;
  const repositoryRootIdentityDigest = sha256(
    input.session.workingDirectoryIdentity
  ) as `sha256:${string}`;
  const snapshot = issueWorkspaceSourceSnapshot({
    subject: Object.freeze({
      kind: 'physical-repository' as const,
      provenance: Object.freeze({
        ...input.provenance,
        providerIdentityDigest,
        repositoryRootIdentityDigest
      })
    }),
    files: input.files,
    moduleMembership: input.moduleMembership,
    sourceByteLength: input.sourceByteLength
  });
  if (input.session.failure !== null
      || !input.session.verifyExecutable()
      || input.session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Physical workspace source snapshot provider changed during admission');
  }
  return snapshot as PhysicalWorkspaceSourceSnapshot;
}

function exactUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not exact UTF-8`, { cause: error });
  }
}

function exactCompletedGitOutput(
  command: Awaited<ReturnType<GitReadSession['run']>>,
  label: string
): Uint8Array {
  if (command.kind !== 'completed') {
    throw new Error(
      `Workspace source snapshot could not ${label}: ${command.reason}: ${command.detail}`,
      { cause: command }
    );
  }
  if (command.result.code !== 0) {
    const stderr = command.result.stderr.trim();
    throw new Error(
      `Workspace source snapshot could not ${label} (git exit ${command.result.code})`
      + `${stderr.length === 0 ? '' : `: ${stderr}`}`,
      { cause: command }
    );
  }
  return command.result.stdout;
}

function nulSeparatedRepositoryPaths(bytes: Uint8Array, label: string): readonly string[] {
  const source = exactUtf8(bytes, label);
  if (source.length > 0 && !source.endsWith('\0')) {
    throw new Error(`${label} is not NUL terminated`);
  }
  const paths = source.length === 0 ? [] : source.slice(0, -1).split('\0');
  const canonical = paths.map((repositoryPath) => {
    const normalized = normalizeRepositoryModulePath(repositoryPath);
    if (normalized !== repositoryPath || normalized.length === 0) {
      throw new Error(`${label} path is not canonical: ${repositoryPath}`);
    }
    return normalized;
  }).sort(compareCodeUnits);
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1] === canonical[index]) {
      throw new Error(`${label} contains a duplicate path: ${canonical[index]}`);
    }
  }
  return Object.freeze(canonical);
}

type WorkingTreeMembershipEntry = Readonly<{
  path: string;
  mode: WorkspaceSourceFileMode | null;
}>;

type StagedIndexEntry = Readonly<{
  path: string;
  mode: string;
  objectId: string;
}>;

type StagedIndexObservation = Readonly<{
  entries: readonly StagedIndexEntry[];
  indexDigest: `sha256:${string}`;
  indexTreeDigest: `sha256:${string}`;
  indexPhysicalIdentityDigest: `sha256:${string}`;
  identityDigest: `sha256:${string}`;
}>;

function exactSingleLine(bytes: Uint8Array, label: string): string {
  const source = exactUtf8(bytes, label);
  const value = source.endsWith('\r\n')
    ? source.slice(0, -2)
    : source.endsWith('\n')
      ? source.slice(0, -1)
      : source;
  if (value.length === 0 || /[\r\n\0]/u.test(value)) {
    throw new Error(`${label} is not one exact line`);
  }
  return value;
}

async function observeStagedIndex(
  session: GitReadSession
): Promise<StagedIndexObservation> {
  const repositoryRootCommand = await session.run([
    'rev-parse', '--path-format=absolute', '--show-toplevel'
  ]);
  const indexPathCommand = await session.run([
    'rev-parse', '--path-format=absolute', '--git-path', 'index'
  ]);
  const repositoryRoot = path.resolve(exactSingleLine(
    exactCompletedGitOutput(repositoryRootCommand, 'resolve the staged repository root'),
    'Staged repository root'
  ));
  const indexPath = path.resolve(exactSingleLine(
    exactCompletedGitOutput(indexPathCommand, 'resolve the staged index path'),
    'Staged index path'
  ));
  if (repositoryRoot !== path.resolve(session.cwd)) {
    throw new Error('Staged index repository root differs from the retained Git working directory');
  }
  const before = await lstat(indexPath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Staged index is not one ordinary file');
  }
  const indexBytes = await readFile(indexPath);
  const membershipCommand = await session.run([
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    'ls-files', '--stage', '-z'
  ]);
  const records = nulSeparatedRepositoryPathsWithIndexMetadata(
    exactCompletedGitOutput(membershipCommand, 'observe staged index membership')
  );
  const after = await lstat(indexPath);
  const readbackBytes = await readFile(indexPath);
  if (!after.isFile() || after.isSymbolicLink()
      || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || !Buffer.from(indexBytes).equals(Buffer.from(readbackBytes))) {
    throw new Error('Staged index changed while its membership was observed');
  }
  if (session.consumeRecords(records.length) !== null) {
    throw new Error('Staged index membership exceeded the Git session record budget');
  }
  const indexDigest = rawSha256(indexBytes);
  const indexPhysicalIdentityDigest = sha256({
    path: indexPath,
    device: String(before.dev),
    inode: String(before.ino),
    size: before.size,
    mtimeMs: before.mtimeMs
  }) as `sha256:${string}`;
  const indexTreeDigest = sha256(records.map(({ path: repositoryPath, mode, objectId }) => ({
    repositoryPath,
    mode,
    objectId
  }))) as `sha256:${string}`;
  return Object.freeze({
    entries: records,
    indexDigest,
    indexTreeDigest,
    indexPhysicalIdentityDigest,
    identityDigest: sha256({
      indexDigest,
      indexTreeDigest,
      indexPhysicalIdentityDigest
    }) as `sha256:${string}`
  });
}

function nulSeparatedRepositoryPathsWithIndexMetadata(
  bytes: Uint8Array
): readonly StagedIndexEntry[] {
  const source = exactUtf8(bytes, 'Staged index membership');
  if (source.length > 0 && !source.endsWith('\0')) {
    throw new Error('Staged index membership is not NUL terminated');
  }
  const entries = (source.length === 0 ? [] : source.slice(0, -1).split('\0')).map((record) => {
    const match = /^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-3])\t([\s\S]+)$/u.exec(record);
    if (match === null || match[3] !== '0') {
      throw new Error('Staged index membership contains a noncanonical or unmerged entry');
    }
    const repositoryPath = normalizeRepositoryModulePath(match[4]!);
    if (repositoryPath.length === 0 || repositoryPath !== match[4]) {
      throw new Error(`Staged index path is not canonical: ${match[4]}`);
    }
    return Object.freeze({ path: repositoryPath, mode: match[1]!, objectId: match[2]! });
  }).sort((left, right) => compareCodeUnits(left.path, right.path));
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.path === entries[index]!.path) {
      throw new Error(`Staged index contains a duplicate path: ${entries[index]!.path}`);
    }
  }
  return Object.freeze(entries);
}

async function readStagedSourceBlobs(
  session: GitReadSession,
  entries: readonly StagedIndexEntry[]
): Promise<ReadonlyMap<string, Uint8Array>> {
  const objectIds = [...new Set(entries.map(({ objectId }) => objectId))];
  if (objectIds.length === 0) return new Map();
  const command = await session.run(['cat-file', '--batch'], {
    input: Buffer.from(`${objectIds.join('\n')}\n`, 'ascii')
  });
  const output = exactCompletedGitOutput(command, 'read staged source blobs');
  const blobs = new Map<string, Uint8Array>();
  let offset = 0;
  let totalBytes = 0;
  for (const objectId of objectIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error(`Staged blob ${objectId} has no complete header`);
    const header = new TextDecoder('utf-8', { fatal: true }).decode(
      output.subarray(offset, headerEnd)
    );
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) blob ([0-9]+)$/u.exec(header);
    if (match === null || match[1] !== objectId) {
      throw new Error(`Staged blob ${objectId} has a noncanonical batch header`);
    }
    const byteLength = Number(match[2]);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0
        || byteLength > SOURCE_SNAPSHOT_MAX_FILE_BYTES) {
      throw new Error(`Staged blob ${objectId} exceeds its byte ceiling`);
    }
    totalBytes += byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > SOURCE_SNAPSHOT_MAX_TOTAL_BYTES) {
      throw new Error('Staged workspace source snapshot exceeds its aggregate byte ceiling');
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + byteLength;
    if (contentEnd >= output.byteLength || output[contentEnd] !== 0x0a) {
      throw new Error(`Staged blob ${objectId} has incomplete bytes`);
    }
    blobs.set(objectId, output.slice(contentStart, contentEnd));
    offset = contentEnd + 1;
  }
  if (offset !== output.byteLength) {
    throw new Error('Staged blob batch contains trailing bytes');
  }
  if (session.consumeRecords(objectIds.length) !== null) {
    throw new Error('Staged blob batch exceeded the Git session record budget');
  }
  return blobs;
}

async function observeWorkingTreeMembership(
  session: GitReadSession
): Promise<readonly WorkingTreeMembershipEntry[]> {
  const listed = await session.run([
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    'ls-files', '--cached', '--others', '--exclude-standard', '--stage', '-z'
  ]);
  const deleted = await session.run([
    '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    'ls-files', '--deleted', '-z'
  ]);
  const listedSource = exactUtf8(
    exactCompletedGitOutput(listed, 'list current repository membership'),
    'Workspace current membership'
  );
  if (listedSource.length > 0 && !listedSource.endsWith('\0')) {
    throw new Error('Workspace current membership is not NUL terminated');
  }
  const listedEntries = (listedSource.length === 0 ? [] : listedSource.slice(0, -1).split('\0'))
    .map((record): WorkingTreeMembershipEntry => {
      const match = /^([0-7]{6}) [0-9a-f]{40,64} 0\t([\s\S]+)$/u.exec(record);
      if (match === null) {
        const repositoryPath = normalizeRepositoryModulePath(record);
        if (repositoryPath !== record || repositoryPath.length === 0) {
          throw new Error(`Workspace untracked membership path is not canonical: ${record}`);
        }
        return Object.freeze({ path: repositoryPath, mode: null });
      }
      const repositoryPath = normalizeRepositoryModulePath(match[2]!);
      if (repositoryPath !== match[2] || repositoryPath.length === 0) {
        throw new Error(`Workspace tracked membership path is not canonical: ${match[2]}`);
      }
      const mode = match[1] === '100644' || match[1] === '100755'
        ? match[1]
        : null;
      return Object.freeze({ path: repositoryPath, mode });
    });
  const deletedPaths = new Set(nulSeparatedRepositoryPaths(
    exactCompletedGitOutput(deleted, 'list deleted repository paths'),
    'Workspace deleted membership'
  ));
  const currentEntries = listedEntries
    .filter(({ path: repositoryPath }) => !deletedPaths.has(repositoryPath))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  for (let index = 1; index < currentEntries.length; index += 1) {
    if (currentEntries[index - 1]!.path === currentEntries[index]!.path) {
      throw new Error(`Workspace source membership contains a duplicate path: ${currentEntries[index]!.path}`);
    }
  }
  if (session.consumeRecords(listedEntries.length + deletedPaths.size) !== null) {
    throw new Error('Workspace source membership exceeded the Git session record budget');
  }
  return Object.freeze(currentEntries);
}

/**
 * The only working-tree acquisition path. Membership, exact bytes and source
 * identity are derived inside the live production Git session; callers cannot
 * report paths, bytes, membership or a working-tree identity.
 */
export async function acquireWorkingTreeSnapshot(
  input: AcquireWorkingTreeSnapshotInput
): Promise<PhysicalWorkspaceSourceSnapshot> {
  assertProductionGitReadSession(input.session);
  const session = input.session;
  if (session.failure !== null || session.providerIdentity === null
      || session.workingDirectoryIdentity == null
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Working-tree workspace snapshot requires a current production Git session');
  }
  const membershipEntries = await observeWorkingTreeMembership(session);
  const sourceMembershipEntries = membershipEntries.filter(({ path: repositoryPath }) => (
    isSourceProgramInputPath(repositoryPath)
  ));
  const admittedEntries = await mapTaskGroup(sourceMembershipEntries, async (membershipEntry) => {
    const repositoryPath = membershipEntry.path;
    const canonicalPath = normalizeRepositoryModulePath(repositoryPath);
    if (canonicalPath !== repositoryPath || canonicalPath.length === 0) {
      throw new Error(`Workspace source membership path is not canonical: ${repositoryPath}`);
    }
    const absolutePath = path.resolve(session.cwd, ...repositoryPath.split('/'));
    const relativePath = path.relative(session.cwd, absolutePath);
    if (relativePath.length === 0 || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Workspace source path escapes the retained repository root: ${repositoryPath}`);
    }
    const before = await lstat(absolutePath);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(`Workspace source path is not one ordinary file: ${repositoryPath}`);
    }
    if (before.size > SOURCE_SNAPSHOT_MAX_FILE_BYTES) {
      throw new Error(`Workspace source file exceeds its byte ceiling: ${repositoryPath}`);
    }
    return Object.freeze({ absolutePath, before, membershipEntry, repositoryPath });
  });
  const totalBytes = admittedEntries.reduce((total, { before }) => total + before.size, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > SOURCE_SNAPSHOT_MAX_TOTAL_BYTES) {
    throw new Error('Workspace source snapshot exceeds its aggregate byte ceiling');
  }
  const observedEntries = await mapTaskGroup(admittedEntries, async (entry, _index, signal) => {
    const { absolutePath, before, membershipEntry, repositoryPath } = entry;
    const bytes = await readFile(absolutePath);
    throwIfNativeAborted(signal);
    const after = await lstat(absolutePath);
    if (bytes.length !== before.size || bytes.includes(0)
        || !after.isFile() || after.isSymbolicLink()
        || after.dev !== before.dev || after.ino !== before.ino
        || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`Workspace source file changed during acquisition: ${repositoryPath}`);
    }
    return Object.freeze({
      file: Object.freeze({
      path: repositoryPath,
      mode: membershipEntry.mode ?? ((before.mode & 0o111) === 0 ? '100644' : '100755'),
      source: exactUtf8(bytes, `Workspace source file ${repositoryPath}`),
      contentDigest: rawSha256(bytes)
      }),
      physical: Object.freeze({
        path: repositoryPath,
        device: String(before.dev),
        inode: String(before.ino),
        size: before.size,
        mtimeMs: before.mtimeMs
      })
    });
  });
  const files = observedEntries.map(({ file }) => file);
  const physicalFileObservations = observedEntries.map(({ physical }) => physical);
  const descriptorSources = files
    .filter(({ path: repositoryPath }) => repositoryPath.endsWith('/module.json'))
    .map(({ path: descriptorPath, source }) => ({ descriptorPath, source }));
  const moduleMembership = descriptorSources.length === 0
    ? emptyModuleMembership()
    : compileRepositoryModuleMembershipSnapshot({
        repositoryFiles: files.map(({ path: repositoryPath }) => repositoryPath),
        descriptorSources
      });
  const identityDigest = sha256({
    provider: session.providerIdentity,
    repositoryRoot: session.workingDirectoryIdentity,
    membership: membershipEntries,
    files: physicalFileObservations
  }) as `sha256:${string}`;
  const membershipReadback = await observeWorkingTreeMembership(session);
  if (JSON.stringify(membershipReadback) !== JSON.stringify(membershipEntries)) {
    throw new Error('Workspace source membership changed during acquisition');
  }
  return issuePhysicalWorkspaceSourceSnapshot({
    session,
    provenance: Object.freeze({ kind: 'working-tree-observation', identityDigest }),
    files,
    moduleMembership,
    sourceByteLength: totalBytes
  });
}

/**
 * Compiles the exact staged index into one physical Source Program snapshot.
 * The same production GitRead session owns repository/index discovery,
 * membership, immutable blob reads, resource accounting and terminal readback.
 */
export async function acquireStagedIndexSnapshot(
  input: AcquireStagedIndexSnapshotInput
): Promise<PhysicalWorkspaceSourceSnapshot> {
  assertProductionGitReadSession(input.session);
  const session = input.session;
  if (session.failure !== null || session.providerIdentity === null
      || session.workingDirectoryIdentity == null
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Staged workspace snapshot requires a current production Git session');
  }
  const before = await observeStagedIndex(session);
  const unsafeSource = before.entries.find(({ path: repositoryPath, mode }) => (
    isSourceProgramInputPath(repositoryPath)
      && mode !== '100644' && mode !== '100755'
  ));
  if (unsafeSource !== undefined) {
    throw new Error(`Staged workspace source is not one ordinary blob: ${unsafeSource.path}`);
  }
  const sourceEntries = before.entries.filter(({ path: repositoryPath, mode }) => (
    isSourceProgramInputPath(repositoryPath)
      && (mode === '100644' || mode === '100755')
  ));
  const blobs = await readStagedSourceBlobs(session, sourceEntries);
  let totalBytes = 0;
  const files = sourceEntries.map(({ path: repositoryPath, mode, objectId }) => {
    const bytes = blobs.get(objectId);
    if (bytes === undefined) {
      throw new Error(`Staged workspace source blob is absent: ${repositoryPath}`);
    }
    totalBytes += bytes.byteLength;
    return Object.freeze({
      path: repositoryPath,
      mode: mode as WorkspaceSourceFileMode,
      source: exactUtf8(bytes, `Staged workspace source file ${repositoryPath}`),
      contentDigest: rawSha256(bytes)
    });
  });
  if (!Number.isSafeInteger(totalBytes) || totalBytes > SOURCE_SNAPSHOT_MAX_TOTAL_BYTES) {
    throw new Error('Staged workspace source snapshot exceeds its aggregate byte ceiling');
  }
  const descriptorSources = files
    .filter(({ path: repositoryPath }) => repositoryPath.endsWith('/module.json'))
    .map(({ path: descriptorPath, source }) => ({ descriptorPath, source }));
  const moduleMembership = descriptorSources.length === 0
    ? emptyModuleMembership()
    : compileRepositoryModuleMembershipSnapshot({
        repositoryFiles: before.entries.map(({ path: repositoryPath }) => repositoryPath),
        descriptorSources
      });
  const after = await observeStagedIndex(session);
  if (after.identityDigest !== before.identityDigest
      || JSON.stringify(after.entries) !== JSON.stringify(before.entries)) {
    throw new Error('Staged index changed during workspace snapshot acquisition');
  }
  return issuePhysicalWorkspaceSourceSnapshot({
    session,
    provenance: Object.freeze({
      kind: 'staged-index-observation',
      identityDigest: before.identityDigest,
      indexDigest: before.indexDigest,
      indexTreeDigest: before.indexTreeDigest,
      indexPhysicalIdentityDigest: before.indexPhysicalIdentityDigest
    }),
    files,
    moduleMembership,
    sourceByteLength: totalBytes
  });
}

/** Exact post-observation fence for a still-live staged snapshot/session pair. */
export async function readBackStagedIndexSnapshot(
  snapshot: PhysicalWorkspaceSourceSnapshot,
  session: GitReadSession
): Promise<`sha256:${string}`> {
  assertPhysicalWorkspaceSourceSnapshot(snapshot);
  assertProductionGitReadSession(session);
  const provenance = snapshot.subject.provenance;
  if (provenance.kind !== 'staged-index-observation') {
    throw new Error('Staged workspace snapshot readback requires staged-index provenance');
  }
  if (session.failure !== null || session.providerIdentity === null
      || session.workingDirectoryIdentity == null
      || sha256(session.providerIdentity) !== provenance.providerIdentityDigest
      || sha256(session.workingDirectoryIdentity) !== provenance.repositoryRootIdentityDigest
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Staged workspace snapshot provider changed before readback');
  }
  const current = await observeStagedIndex(session);
  if (current.identityDigest !== provenance.identityDigest
      || current.indexDigest !== provenance.indexDigest
      || current.indexTreeDigest !== provenance.indexTreeDigest
      || current.indexPhysicalIdentityDigest !== provenance.indexPhysicalIdentityDigest) {
    throw new Error('Staged workspace snapshot index changed before readback');
  }
  return snapshot.subjectDigest;
}

/**
 * Derive the exact candidate import surface from the same retained Git session
 * and staged snapshot. Callers may provide an exact base identity, but never a
 * path list; the Git index diff remains the sole selection authority.
 */
export async function selectStagedSnapshot(input: Readonly<{
  snapshot: PhysicalWorkspaceSourceSnapshot;
  session: GitReadSession;
  candidateBase?: string;
}>): Promise<StagedSourceSelection> {
  assertPhysicalWorkspaceSourceSnapshot(input.snapshot);
  assertProductionGitReadSession(input.session);
  const provenance = input.snapshot.subject.provenance;
  if (provenance.kind !== 'staged-index-observation') {
    throw new Error('Staged workspace source selection requires staged-index provenance');
  }
  const suppliedBase = input.candidateBase;
  if (suppliedBase !== undefined && !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(suppliedBase)) {
    throw new Error('Candidate import base must be one full Git object ID');
  }
  const baseCommand = suppliedBase === undefined
    ? await input.session.run(['merge-base', 'HEAD', 'refs/remotes/origin/main'])
    : await input.session.run(['rev-parse', '--verify', '--end-of-options', `${suppliedBase}^{commit}`]);
  const candidateBase = exactSingleLine(
    exactCompletedGitOutput(baseCommand, 'resolve the candidate import base'),
    'Candidate import base'
  );
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(candidateBase)
      || (suppliedBase !== undefined && candidateBase !== suppliedBase)) {
    throw new Error('Candidate import base did not resolve exactly');
  }
  const diff = await input.session.run([
    'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR', '--find-renames',
    candidateBase, '--'
  ]);
  const selectedPaths = nulSeparatedRepositoryPaths(
    exactCompletedGitOutput(diff, 'observe the staged candidate import surface'),
    'Staged candidate import surface'
  );
  if (input.session.consumeRecords(selectedPaths.length) !== null) {
    throw new Error('Staged candidate import surface exceeded the Git session record budget');
  }
  await readBackStagedIndexSnapshot(input.snapshot, input.session);
  const unsigned = Object.freeze({
    candidateBase,
    snapshotSubjectDigest: input.snapshot.subjectDigest,
    selectedPaths
  });
  const selection = Object.freeze({
    [stagedWorkspaceSourceSelectionBrand]: true as const,
    ...unsigned,
    selectionDigest: sha256(unsigned) as `sha256:${string}`
  });
  issuedStagedWorkspaceSourceSelections.add(selection);
  return selection;
}

export function requireStagedSourceSelection(
  selection: StagedSourceSelection,
  snapshot: PhysicalWorkspaceSourceSnapshot
): StagedSourceSelection {
  if (!issuedStagedWorkspaceSourceSelections.has(selection)) {
    throw new Error('Staged workspace source selection is not owner-issued');
  }
  assertPhysicalWorkspaceSourceSnapshot(snapshot);
  const unsigned = Object.freeze({
    candidateBase: selection.candidateBase,
    snapshotSubjectDigest: selection.snapshotSubjectDigest,
    selectedPaths: selection.selectedPaths
  });
  if (selection.snapshotSubjectDigest !== snapshot.subjectDigest
      || selection.selectionDigest !== sha256(unsigned)) {
    throw new Error('Staged workspace source selection differs from its exact snapshot');
  }
  return selection;
}

/**
 * The only exact-tree acquisition path. The Source Program owner invokes the
 * existing exact Git object reader itself, so callers supply only a repository
 * locator and immutable commit identity, never structural source facts.
 */
function issueExactGitTreeWorkspaceSourceSnapshot(input: Readonly<{
  commitSha: string;
  treeEntries: readonly ExactGitTreeEntry[];
  sourceBlobs: readonly ExactGitTextBlob[];
}>): PhysicalWorkspaceSourceSnapshot {
  const { treeEntries, sourceBlobs } = input;
  const ordinaryEntries = treeEntries.filter(({ mode, type }) => (
    (mode === '100644' || mode === '100755') && type === 'blob'
  ));
  const unsafeDescriptor = treeEntries.find(({ repositoryPath, mode, type }) => (
    isSourceProgramInputPath(repositoryPath)
      && repositoryPath.endsWith('/module.json')
      && ((mode !== '100644' && mode !== '100755') || type !== 'blob')
  ));
  if (unsafeDescriptor !== undefined) {
    throw new Error(`Exact workspace module descriptor is not an ordinary blob: ${unsafeDescriptor.repositoryPath}`);
  }
  const sourceEntries = ordinaryEntries.filter(({ repositoryPath }) => (
    isSourceProgramInputPath(repositoryPath)
  ));
  let totalBytes = 0;
  for (const { repositoryPath, byteLength } of sourceBlobs) {
    if (byteLength > SOURCE_SNAPSHOT_MAX_FILE_BYTES) {
      throw new Error(`Exact workspace source file exceeds its byte ceiling: ${repositoryPath}`);
    }
    totalBytes += byteLength;
    if (totalBytes > SOURCE_SNAPSHOT_MAX_TOTAL_BYTES) {
      throw new Error('Exact workspace source snapshot exceeds its aggregate byte ceiling');
    }
  }
  const sourceByPath = new Map(sourceBlobs.map(({ repositoryPath, source }) => [repositoryPath, source]));
  const sourceEntryByPath = new Map(sourceEntries.map((entry) => [entry.repositoryPath, entry]));
  const descriptorSources = sourceEntries
    .filter(({ repositoryPath }) => repositoryPath.endsWith('/module.json'))
    .map(({ repositoryPath: descriptorPath }) => ({
      descriptorPath,
      source: sourceByPath.get(descriptorPath)!
    }));
  if (descriptorSources.some(({ source }) => source === undefined)) {
    throw new Error('Exact workspace source snapshot has no complete module descriptor census');
  }
  const moduleMembership = descriptorSources.length === 0
    ? emptyModuleMembership()
    : compileRepositoryModuleMembershipSnapshot({
        repositoryFiles: sourceEntries.map(({ repositoryPath }) => repositoryPath),
        descriptorSources
      });
  const files = sourceBlobs.map(({ repositoryPath, source }) => Object.freeze({
    path: repositoryPath,
    mode: sourceEntryByPath.get(repositoryPath)!.mode as WorkspaceSourceFileMode,
    source,
    contentDigest: rawSha256(source)
  }));
  const subject: WorkspaceSourceSnapshotSubject = Object.freeze({
    kind: 'physical-repository',
    provenance: Object.freeze({
      kind: 'git-tree',
      commitSha: input.commitSha,
      identityDigest: sha256(treeEntries) as `sha256:${string}`,
      objectCensusDigest: sha256(ordinaryEntries.map(({ blobSha, mode, repositoryPath }) => ({
        blobSha,
        mode,
        repositoryPath
      }))) as `sha256:${string}`
    })
  });
  return issueWorkspaceSourceSnapshot({
    subject,
    files,
    moduleMembership,
    sourceByteLength: totalBytes
  }) as PhysicalWorkspaceSourceSnapshot;
}

export async function acquireExactGitTreeSnapshot(
  input: AcquireExactGitTreeSnapshotInput
): Promise<PhysicalWorkspaceSourceSnapshot> {
  assertProductionGitReadSession(input.session);
  const treeEntries = await ListExactGitTreeEntriesFromSession(
    input.session,
    input.commitSha
  );
  const sourceEntries = treeEntries.filter(({ repositoryPath, mode, type }) => (
    isSourceProgramInputPath(repositoryPath)
      && (mode === '100644' || mode === '100755')
      && type === 'blob'
  ));
  return issueExactGitTreeWorkspaceSourceSnapshot({
    commitSha: input.commitSha,
    treeEntries,
    sourceBlobs: await ReadExactGitTextBlobsBatchFromSession(
      input.session,
      { entries: sourceEntries, maxTotalBytes: SOURCE_SNAPSHOT_MAX_TOTAL_BYTES }
    )
  });
}
