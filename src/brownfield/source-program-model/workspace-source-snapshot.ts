import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CodexDevelopmentListExactGitTreeEntries,
  CodexDevelopmentReadExactGitTextBlobsBatch
} from '../../external-capabilities/git-read/exact-blob.ts';
import {
  assertProductionGitReadSession,
  type GitReadSession
} from '../../external-capabilities/git-read/runtime/session.ts';
import { compareCodeUnits, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  compileSecRepositoryModuleGraph,
  compileSecRepositoryModuleMembershipSnapshot,
  normalizeSecRepositoryPath,
  type SecRepositoryModuleGraph,
  type SecRepositoryModuleMembership
} from '../../system-architecture/repository-modules/contract.ts';
import {
  isSourceProgramInputPath,
  type SourceProgramFileInput,
  type SourceProgramModel
} from './contract.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_SNAPSHOT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SOURCE_SNAPSHOT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const workspaceSourceSnapshotBrand: unique symbol = Symbol('workspace-source-snapshot');
const issuedWorkspaceSourceSnapshots = new WeakSet<object>();
const workspaceTypeScriptProjectInputBrand: unique symbol = Symbol('workspace-typescript-project-input');
const issuedWorkspaceTypeScriptProjectInputs = new WeakSet<object>();

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

export type PhysicalObservationReceipt = Extract<
  WorkspaceSourceSnapshotSubject,
  { kind: 'physical-repository' }
>['provenance'];

type WorkspaceSourceSnapshotMatchInput = Readonly<{
  sourceRevision?: string;
  productionModel?: SourceProgramModel;
  files: readonly SourceProgramFileInput[];
  moduleMembership: SecRepositoryModuleMembership;
}>;

export type WorkspaceSourceFileMode = '100644' | '100755';

export type WorkspaceSourceFile = SourceProgramFileInput & Readonly<{
  mode: WorkspaceSourceFileMode;
}>;

type IssueWorkspaceSourceSnapshotInput = Readonly<{
  subject: WorkspaceSourceSnapshotSubject;
  files: readonly WorkspaceSourceFile[];
  moduleMembership: SecRepositoryModuleMembership;
}>;

export type CompileVirtualWorkspaceSourceSnapshotInput = Readonly<{
  subject: Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>;
  files: readonly (SourceProgramFileInput & Readonly<{ mode?: WorkspaceSourceFileMode }>)[];
  moduleMembership: SecRepositoryModuleMembership;
}>;

type IssuePhysicalWorkspaceSourceSnapshotInput = Omit<
  IssueWorkspaceSourceSnapshotInput,
  'subject'
> & Readonly<{
  session: GitReadSession;
  provenance: Readonly<{
    kind: 'working-tree-observation';
    identityDigest: `sha256:${string}`;
  }>;
}>;

export type AcquireWorkingTreeWorkspaceSourceSnapshotInput = Readonly<{
  session: GitReadSession;
}>;

export type AcquireExactGitTreeWorkspaceSourceSnapshotInput = Readonly<{
  commitSha: string;
  repositoryRoot: string;
}>;

/**
 * One immutable, process-local capability for every semantic projection of an
 * exact workspace subject. Consumers receive repository-relative paths and
 * exact source text only; physical paths and transport encodings are not part
 * of the public input.
 */
export interface WorkspaceSourceSnapshot {
  readonly [workspaceSourceSnapshotBrand]: true;
  readonly subject: WorkspaceSourceSnapshotSubject;
  readonly subjectDigest: `sha256:${string}`;
  readonly sourceRevision: `sha256:${string}`;
  readonly physicalObservationReceipt: PhysicalObservationReceipt | null;
  readonly files: readonly WorkspaceSourceFile[];
  readonly moduleMembership: SecRepositoryModuleMembership;
  readonly snapshotDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly identityDigest: `sha256:${string}`;
  readonly moduleGraphCompilationCount: 1;
  readonly moduleGraph: SecRepositoryModuleGraph;
  file(repositoryPath: string): WorkspaceSourceFile | null;
  assertMatches(input: WorkspaceSourceSnapshotMatchInput): void;
}

export type PhysicalWorkspaceSourceSnapshot = WorkspaceSourceSnapshot & Readonly<{
  subject: Extract<WorkspaceSourceSnapshotSubject, { kind: 'physical-repository' }>;
}>;

export type VirtualWorkspaceSourceSnapshot = WorkspaceSourceSnapshot & Readonly<{
  subject: Extract<WorkspaceSourceSnapshotSubject, { kind: 'virtual-mutation' }>;
}>;

export type WorkspaceTypeScriptSourceFact = Readonly<{
  path: string;
  contentDigest: `sha256:${string}`;
  moduleId: string | null;
  moduleDigest: `sha256:${string}`;
}>;

export interface WorkspaceTypeScriptProjectInput {
  readonly [workspaceTypeScriptProjectInputBrand]: true;
  readonly sourceRevision: string;
  readonly snapshotDigest: `sha256:${string}`;
  readonly workspaceSnapshotIdentityDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly projectConfigPath: string;
  readonly projectConfigDigest: `sha256:${string}`;
  readonly sourceFacts: readonly WorkspaceTypeScriptSourceFact[];
  readonly orderedSourceFactsDigest: `sha256:${string}`;
  readonly projectInputDigest: `sha256:${string}`;
  readonly observationDigest: `sha256:${string}`;
}

export function assertWorkspaceTypeScriptProjectInput(
  input: WorkspaceTypeScriptProjectInput
): void {
  if (!issuedWorkspaceTypeScriptProjectInputs.has(input)) {
    throw new Error('TypeScript ProjectInput was not issued by the Workspace Source Snapshot owner');
  }
}

export function assertWorkspaceTypeScriptProjectInputMatchesSnapshot(
  input: WorkspaceTypeScriptProjectInput,
  snapshot: WorkspaceSourceSnapshot
): void {
  assertWorkspaceTypeScriptProjectInput(input);
  assertWorkspaceSourceSnapshot(snapshot);
  if (input.sourceRevision !== snapshot.sourceRevision
      || input.snapshotDigest !== snapshot.snapshotDigest
      || input.workspaceSnapshotIdentityDigest !== snapshot.identityDigest
      || input.moduleMembershipDigest !== snapshot.moduleMembershipDigest
      || input.moduleGraphDigest !== snapshot.moduleGraphDigest) {
    throw new Error('TypeScript ProjectInput does not belong to the Workspace Source Snapshot');
  }
}

export function compileWorkspaceTypeScriptProjectInput(
  snapshot: WorkspaceSourceSnapshot,
  projectConfigPath: string
): WorkspaceTypeScriptProjectInput {
  assertWorkspaceSourceSnapshot(snapshot);
  const canonicalConfigPath = normalizeSecRepositoryPath(projectConfigPath);
  if (canonicalConfigPath !== projectConfigPath || canonicalConfigPath.length === 0) {
    throw new Error('TypeScript ProjectInput config path is not canonical');
  }
  const projectConfig = snapshot.file(projectConfigPath);
  if (projectConfig === null) {
    throw new Error(`TypeScript ProjectInput config is absent: ${projectConfigPath}`);
  }
  const sourceFacts = Object.freeze(snapshot.files
    .filter(({ path: repositoryPath }) => /\.(?:[cm]?[jt]sx?|json)$/iu.test(repositoryPath))
    .map(({ path: repositoryPath, contentDigest }) => Object.freeze({
      path: repositoryPath,
      contentDigest: contentDigest as `sha256:${string}`,
      moduleId: snapshot.moduleMembership.moduleForPath(repositoryPath)?.moduleId ?? null,
      moduleDigest: sha256(snapshot.moduleMembership.moduleForPath(repositoryPath)) as `sha256:${string}`
    })));
  const orderedSourceFactsDigest = sha256(sourceFacts) as `sha256:${string}`;
  const canonical = Object.freeze({
    sourceRevision: snapshot.sourceRevision,
    snapshotDigest: snapshot.snapshotDigest,
    workspaceSnapshotIdentityDigest: snapshot.identityDigest,
    moduleMembershipDigest: snapshot.moduleMembershipDigest,
    moduleGraphDigest: snapshot.moduleGraphDigest,
    projectConfigPath,
    projectConfigDigest: projectConfig.contentDigest as `sha256:${string}`,
    sourceFacts,
    orderedSourceFactsDigest
  });
  const projectInputDigest = sha256(canonical) as `sha256:${string}`;
  const input: WorkspaceTypeScriptProjectInput = Object.freeze({
    [workspaceTypeScriptProjectInputBrand]: true as const,
    ...canonical,
    projectInputDigest,
    observationDigest: sha256({ projectInputDigest, snapshot: snapshot.subjectDigest }) as `sha256:${string}`
  });
  issuedWorkspaceTypeScriptProjectInputs.add(input);
  return input;
}

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
        && subject.provenance.kind !== 'working-tree-observation') {
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

function canonicalFiles(
  files: readonly (SourceProgramFileInput & Readonly<{ mode?: WorkspaceSourceFileMode }>)[]
): readonly WorkspaceSourceFile[] {
  const canonical = files.map((file) => {
    const repositoryPath = normalizeSecRepositoryPath(file.path);
    if (repositoryPath !== file.path || repositoryPath.length === 0) {
      throw new Error(`Workspace source snapshot path is not canonical: ${file.path}`);
    }
    if (rawSha256(file.source) !== file.contentDigest) {
      throw new Error(`Workspace source snapshot digest does not bind source bytes: ${file.path}`);
    }
    const mode = file.mode ?? '100644';
    if (mode !== '100644' && mode !== '100755') {
      throw new Error(`Workspace source snapshot mode is not canonical: ${file.path}`);
    }
    return Object.freeze({
      path: repositoryPath,
      mode,
      source: file.source,
      contentDigest: file.contentDigest
    });
  }).sort((left, right) => compareCodeUnits(left.path, right.path));
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1]!.path === canonical[index]!.path) {
      throw new Error(`Workspace source snapshot contains duplicate path: ${canonical[index]!.path}`);
    }
  }
  return Object.freeze(canonical);
}

function sourceGeneration(files: readonly WorkspaceSourceFile[]): `sha256:${string}` {
  return sha256({
    schema: 'sec-workspace-source-generation-v1',
    files: files.map(({ path, mode, contentDigest }) => ({ path, mode, contentDigest }))
  }) as `sha256:${string}`;
}

function membershipDigest(
  files: readonly SourceProgramFileInput[],
  membership: SecRepositoryModuleMembership
): `sha256:${string}` {
  return sha256({
    graphRoots: [...membership.graphRoots].sort(compareCodeUnits),
    moduleRoots: [...membership.moduleRoots].sort(compareCodeUnits),
    fileBindings: files.map(({ path }) => ({ path, module: membership.moduleForPath(path) }))
  }) as `sha256:${string}`;
}

function graphDigest(graph: SecRepositoryModuleGraph): `sha256:${string}` {
  return sha256({
    files: graph.files,
    references: graph.references,
    unresolvedFiles: graph.unresolvedFiles
  }) as `sha256:${string}`;
}

function emptyModuleMembership(): SecRepositoryModuleMembership {
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
  const subject = canonicalSubject(input.subject);
  const files = canonicalFiles(input.files);
  const sourceRevision = sourceGeneration(files);
  const exactMembershipDigest = membershipDigest(files, input.moduleMembership);
  const sourceByPath = new Map(files.map((file) => [file.path, file] as const));
  const moduleGraph = compileSecRepositoryModuleGraph({
    files: files.filter(({ path }) => isSourceProgramInputPath(path)).map(({ path }) => path),
    readSource: (repositoryPath) => sourceByPath.get(repositoryPath)?.source ?? null
  });
  const exactModuleGraphDigest = graphDigest(moduleGraph);
  const exactSnapshotDigest = sha256({
    sourceRevision,
    moduleMembershipDigest: exactMembershipDigest,
    moduleGraphDigest: exactModuleGraphDigest
  }) as `sha256:${string}`;
  const subjectDigest = sha256(subject) as `sha256:${string}`;
  const identityDigest = sha256({
    subjectDigest,
    sourceRevision,
    snapshotDigest: exactSnapshotDigest,
    moduleMembershipDigest: exactMembershipDigest,
    moduleGraphDigest: exactModuleGraphDigest
  }) as `sha256:${string}`;
  const assertMatches = (candidate: WorkspaceSourceSnapshotMatchInput): void => {
    const candidateFiles = canonicalFiles(candidate.files);
    const candidateRevision = candidate.sourceRevision ?? candidate.productionModel?.sourceRevision;
    if (candidateRevision !== sourceRevision
        || sourceGeneration(candidateFiles) !== sourceRevision
        || membershipDigest(candidateFiles, candidate.moduleMembership) !== exactMembershipDigest
        || graphDigest(moduleGraph) !== exactModuleGraphDigest) {
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
    moduleMembership: input.moduleMembership,
    snapshotDigest: exactSnapshotDigest,
    moduleMembershipDigest: exactMembershipDigest,
    moduleGraphDigest: exactModuleGraphDigest,
    identityDigest,
    moduleGraphCompilationCount: 1 as const,
    moduleGraph,
    file: (repositoryPath: string) => sourceByPath.get(repositoryPath) ?? null,
    assertMatches
  });
  issuedWorkspaceSourceSnapshots.add(snapshot);
  return snapshot;
}

/** Pure, explicitly unbound input for virtual reductions and synthetic tests. */
export function compileVirtualWorkspaceSourceSnapshot(
  input: CompileVirtualWorkspaceSourceSnapshotInput
): VirtualWorkspaceSourceSnapshot {
  return issueWorkspaceSourceSnapshot({
    subject: input.subject,
    files: canonicalFiles(input.files),
    moduleMembership: input.moduleMembership
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
    moduleMembership: input.moduleMembership
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
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new Error(`Workspace source snapshot could not ${label}`);
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
    const normalized = normalizeSecRepositoryPath(repositoryPath);
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
        const repositoryPath = normalizeSecRepositoryPath(record);
        if (repositoryPath !== record || repositoryPath.length === 0) {
          throw new Error(`Workspace untracked membership path is not canonical: ${record}`);
        }
        return Object.freeze({ path: repositoryPath, mode: null });
      }
      const repositoryPath = normalizeSecRepositoryPath(match[2]!);
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
export async function acquireWorkingTreeWorkspaceSourceSnapshot(
  input: AcquireWorkingTreeWorkspaceSourceSnapshotInput
): Promise<PhysicalWorkspaceSourceSnapshot> {
  assertProductionGitReadSession(input.session);
  const session = input.session;
  if (session.failure !== null || session.providerIdentity === null
      || session.workingDirectoryIdentity == null
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Working-tree workspace snapshot requires a current production Git session');
  }
  const membershipEntries = await observeWorkingTreeMembership(session);
  const repositoryPaths = membershipEntries.map(({ path: repositoryPath }) => repositoryPath);
  const files: WorkspaceSourceFile[] = [];
  const physicalFileObservations: Readonly<Record<string, string | number>>[] = [];
  let totalBytes = 0;
  for (const membershipEntry of membershipEntries) {
    const repositoryPath = membershipEntry.path;
    const canonicalPath = normalizeSecRepositoryPath(repositoryPath);
    if (canonicalPath !== repositoryPath || canonicalPath.length === 0) {
      throw new Error(`Workspace source membership path is not canonical: ${repositoryPath}`);
    }
    if (!isSourceProgramInputPath(repositoryPath)) continue;
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
    totalBytes += before.size;
    if (totalBytes > SOURCE_SNAPSHOT_MAX_TOTAL_BYTES) {
      throw new Error('Workspace source snapshot exceeds its aggregate byte ceiling');
    }
    const bytes = await readFile(absolutePath);
    const after = await lstat(absolutePath);
    if (bytes.length !== before.size || bytes.includes(0)
        || !after.isFile() || after.isSymbolicLink()
        || after.dev !== before.dev || after.ino !== before.ino
        || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`Workspace source file changed during acquisition: ${repositoryPath}`);
    }
    files.push(Object.freeze({
      path: repositoryPath,
      mode: membershipEntry.mode ?? ((before.mode & 0o111) === 0 ? '100644' : '100755'),
      source: exactUtf8(bytes, `Workspace source file ${repositoryPath}`),
      contentDigest: rawSha256(bytes)
    }));
    physicalFileObservations.push(Object.freeze({
      path: repositoryPath,
      device: String(before.dev),
      inode: String(before.ino),
      size: before.size,
      mtimeMs: before.mtimeMs
    }));
  }
  const descriptorSources = files
    .filter(({ path: repositoryPath }) => repositoryPath.endsWith('/sec.module.json'))
    .map(({ path: descriptorPath, source }) => ({ descriptorPath, source }));
  const moduleMembership = descriptorSources.length === 0
    ? emptyModuleMembership()
    : compileSecRepositoryModuleMembershipSnapshot({
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
    moduleMembership
  });
}

/**
 * The only exact-tree acquisition path. The Source Program owner invokes the
 * existing exact Git object reader itself, so callers supply only a repository
 * locator and immutable commit identity, never structural source facts.
 */
export function acquireExactGitTreeWorkspaceSourceSnapshot(
  input: AcquireExactGitTreeWorkspaceSourceSnapshotInput
): PhysicalWorkspaceSourceSnapshot {
  const treeEntries = CodexDevelopmentListExactGitTreeEntries({
    repositoryRoot: input.repositoryRoot,
    commitSha: input.commitSha
  });
  const ordinaryEntries = treeEntries.filter(({ mode, type }) => (
    (mode === '100644' || mode === '100755') && type === 'blob'
  ));
  const unsafeDescriptor = treeEntries.find(({ repositoryPath, mode, type }) => (
    isSourceProgramInputPath(repositoryPath)
      && repositoryPath.endsWith('/sec.module.json')
      && ((mode !== '100644' && mode !== '100755') || type !== 'blob')
  ));
  if (unsafeDescriptor !== undefined) {
    throw new Error(`Exact workspace module descriptor is not an ordinary blob: ${unsafeDescriptor.repositoryPath}`);
  }
  const sourceEntries = ordinaryEntries.filter(({ repositoryPath }) => (
    isSourceProgramInputPath(repositoryPath)
  ));
  const sourceBlobs = CodexDevelopmentReadExactGitTextBlobsBatch({
    repositoryRoot: input.repositoryRoot,
    entries: sourceEntries
  });
  let totalBytes = 0;
  for (const { repositoryPath, source } of sourceBlobs) {
    const bytes = Buffer.byteLength(source, 'utf8');
    if (bytes > SOURCE_SNAPSHOT_MAX_FILE_BYTES) {
      throw new Error(`Exact workspace source file exceeds its byte ceiling: ${repositoryPath}`);
    }
    totalBytes += bytes;
    if (totalBytes > SOURCE_SNAPSHOT_MAX_TOTAL_BYTES) {
      throw new Error('Exact workspace source snapshot exceeds its aggregate byte ceiling');
    }
  }
  const sourceByPath = new Map(sourceBlobs.map(({ repositoryPath, source }) => [repositoryPath, source]));
  const sourceEntryByPath = new Map(sourceEntries.map((entry) => [entry.repositoryPath, entry]));
  const descriptorSources = sourceEntries
    .filter(({ repositoryPath }) => repositoryPath.endsWith('/sec.module.json'))
    .map(({ repositoryPath: descriptorPath }) => ({
      descriptorPath,
      source: sourceByPath.get(descriptorPath)!
    }));
  if (descriptorSources.some(({ source }) => source === undefined)) {
    throw new Error('Exact workspace source snapshot has no complete module descriptor census');
  }
  const moduleMembership = descriptorSources.length === 0
    ? emptyModuleMembership()
    : compileSecRepositoryModuleMembershipSnapshot({
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
    moduleMembership
  }) as PhysicalWorkspaceSourceSnapshot;
}
