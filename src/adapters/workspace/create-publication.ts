import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { WorkspaceCreateTemplate } from '../../application/workspace-create.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { snapshotByteView } from '../../contracts/byte-snapshot.ts';
import { compareCodeUnits, sha256 } from '../../contracts/canonical.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { isCanonicalPortableLogicalPath, portableLogicalPathCollisionKey } from '../../contracts/logical-path.ts';
import { settleResources } from '../../execution/resource-settlement.ts';
import { workspaceConfigRelativePath } from '../../workspace/paths.ts';
import { assertWorkspaceWriteLease, WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, type WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import { observePhysicalJournalMutationEntry } from '../runtime-state/physical/runtime/mutation-lease.ts';
import {
  assertSameNoFollowDirectoryIdentity, createExclusiveNoFollowDirectoryWithReceipt,
  deleteRetainedNoFollowEntry, flushNoFollowDirectory, inspectNoFollowDirectoryLeaf,
  relocateRetainedNoFollowDirectoryAcrossParents, retainNoFollowFileTransaction,
  scanNoFollowDirectoryDirectMetadata, scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry, type PhysicalDirectoryIdentity,
  type RetainedNoFollowFileObservation, type RetainedNoFollowFileTransactionTestActor
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem, prepareRuntimeStateJournalMutation, type PreparedRuntimeStateJournalMutation } from '../runtime-state/workspace-state/journal-filesystem.ts';
import { assertWorkspaceCreateSurfaceEmpty, WORKSPACE_CREATE_RECORD_NAME } from './create-surface.ts';

export interface WorkspaceCreateFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly creationMode?: number;
  /** Only the existing project-base materializer consumes this condition.
   * A new Create publishes every file into an absent destination. */
  readonly onlyIfAbsent?: true;
}
export interface WorkspaceCreateMaterial {
  readonly directories: readonly string[];
  readonly files: readonly WorkspaceCreateFile[];
}

const RECORD = `.sec/${WORKSPACE_CREATE_RECORD_NAME}`;
const STAGE_PREFIX = '.workspace-create-';
const SCHEMA = 'sec-workspace-create-publication-v1';
const LIMIT = 2048;
const MAX_BYTES = 16 * 1024 * 1024;
const bounds = () => ({ deadlineAtMs: performance.now() + 30_000, maximumEntries: LIMIT, maximumBytes: MAX_BYTES, includePermissionMode: true });
type Identity = Readonly<{ device: string; inode: string }>;
type DirectoryIdentity = Identity & Readonly<{ objectId: string }>;
type Entry = Readonly<{
  relativePath: string; kind: 'file' | 'directory'; device: string; inode: string;
  size: number | null; contentDigest: string | null; permissionMode: number | null;
}>;
interface Record {
  schema: typeof SCHEMA;
  phase: 'prepared' | 'settling' | 'completed';
  intent: string;
  root: DirectoryIdentity;
  local: DirectoryIdentity;
  stage: DirectoryIdentity & Readonly<{ permissionMode: number | null }>;
  stageName: string;
  entries: readonly Entry[];
}
function conflict(reason: string): never {
  throw new CompilerError('WORKSPACE-INIT-003', 'Workspace creation requires lifecycle recovery; existing objects were preserved', { reason });
}
const identity = ({ device, inode }: Identity): Identity => ({ device, inode });
const directoryIdentity = ({ device, inode, objectId }: PhysicalDirectoryIdentity): DirectoryIdentity => ({ device, inode, objectId });
const sameDirectory = (a: DirectoryIdentity, b: DirectoryIdentity) => same(a, b) && a.objectId === b.objectId;
const same = (a: Identity, b: Identity) => a.device === b.device && a.inode === b.inode;
const exact = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const contentDigest = (bytes: Uint8Array) => sha256({ bytes: Buffer.from(bytes).toString('hex') });

function snapshot(template: WorkspaceCreateTemplate, input: WorkspaceCreateMaterial) {
  if (template !== 'minimal' && template !== 'reference-customer') conflict('invalid-template');
  const directories = new Set<string>();
  const paths = new Set<string>();
  const spellings = new Map<string, string>();
  const admit = (name: string) => {
    if (typeof name !== 'string' || !isCanonicalPortableLogicalPath(name) || name === RECORD
        || name.startsWith('.sec/.workspace-create-') || name.startsWith('.sec/.journal-')
        || name.startsWith('.sec/.sec-journal-') || name.startsWith(`.sec/${WORKSPACE_WRITE_LEASE_DIRECTORY_NAME}/`)) conflict('invalid-template-path');
    const key = portableLogicalPathCollisionKey(name);
    if (spellings.has(key) && spellings.get(key) !== name) conflict('aliased-template-path');
    spellings.set(key, name);
  };
  const parents = (name: string) => {
    for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) {
      admit(parent); directories.add(parent);
    }
  };
  if (!input || !Array.isArray(input.directories) || !Array.isArray(input.files)
      || input.directories.length + input.files.length > LIMIT) conflict('invalid-template-shape');
  for (const name of input.directories) { admit(name); directories.add(name); parents(name); }
  let size = 0;
  const files = input.files.map(file => {
    admit(file.relativePath);
    if (paths.has(file.relativePath) || file.relativePath === `.sec/${WORKSPACE_WRITE_LEASE_DIRECTORY_NAME}`) conflict('duplicate-template-file');
    paths.add(file.relativePath); parents(file.relativePath);
    const bytes = snapshotByteView(file.bytes, 'Workspace initial file', MAX_BYTES - size);
    size += bytes.byteLength;
    const creationMode = file.creationMode ?? 0o666;
    if (!Number.isSafeInteger(creationMode) || creationMode < 0 || creationMode > 0o777) conflict('invalid-template-mode');
    return { relativePath: file.relativePath, bytes, creationMode };
  }).sort((a, b) => compareCodeUnits(a.relativePath, b.relativePath));
  if (directories.size + files.length > LIMIT || files.some(file => directories.has(file.relativePath))
      || [workspaceConfigRelativePath, CI_ARTIFACT_FILES.graphLock, CI_ARTIFACT_FILES.verificationReport].some(name => !paths.has(name))) conflict('incomplete-template');
  const ordered = [...directories].sort((a, b) => a.split('/').length - b.split('/').length || compareCodeUnits(a, b));
  const intent = sha256({ template, directories: ordered, files: files.map(file => ({ relativePath: file.relativePath, creationMode: file.creationMode, bytes: Buffer.from(file.bytes).toString('hex') })) });
  return { directories: ordered, files, intent };
}
function project(entry: NoFollowDirectoryTreeInventoryEntry): Entry {
  if (entry.kind === 'link') conflict('unexpected-link');
  return { relativePath: entry.relativePath, kind: entry.kind, ...identity(entry),
    size: entry.kind === 'file' ? entry.size : null, contentDigest: entry.kind === 'file' ? entry.contentDigest : null,
    permissionMode: entry.permissionMode ?? null };
}
const inventory = (root: PhysicalDirectoryIdentity) => scanNoFollowDirectoryTreeInventory(root, bounds()).map(project)
  .sort((a, b) => compareCodeUnits(a.relativePath, b.relativePath));
function directoryAt(root: PhysicalDirectoryIdentity, relative: string): PhysicalDirectoryIdentity | null {
  let current = root;
  for (const name of relative.split('/')) {
    const child = inspectNoFollowDirectoryLeaf(current, name, 'Workspace Create directory');
    if (child === null) return null;
    current = child;
  }
  return current;
}

/** One physical lifecycle owner, under the existing workspace writer. The
 * collection is recoverable, not globally atomic to filesystem observers.
 * Completed records remain as original-intent receipts for idempotent init;
 * only the recorded, empty stage is retired. Unknown residue is never adopted. */
export async function publishWorkspaceCreate(input: Readonly<{
  workspaceRoot: string;
  token: WorkspaceWriteLeaseToken;
  template: WorkspaceCreateTemplate;
  material: WorkspaceCreateMaterial;
  testOnlyActor?: RetainedNoFollowFileTransactionTestActor;
}>): Promise<void> {
  const material = snapshot(input.template, input.material);
  await assertWorkspaceWriteLease(input.workspaceRoot, input.token);
  const files = retainNoFollowFileTransaction(input.workspaceRoot, 'Workspace Create publication', input.testOnlyActor);
  let guard: PreparedRuntimeStateJournalMutation | null = null;
  let primary: { label: string; error: unknown } | undefined;
  try {
    const root = files.rootIdentity;
    const local = inspectNoFollowDirectoryLeaf(root, '.sec', 'Workspace Create local state');
    if (local === null) conflict('missing-local-state');
    const fs = createRuntimeStateJournalFileSystem(local);
    const recordPath = path.join(root.path, RECORD);
    let recorded: RetainedNoFollowFileObservation | null = null;
    let record: Record;
    let admitted = false;
    const freshFile = (relative: string) => {
      const reader = retainNoFollowFileTransaction(root.path, 'Workspace Create fresh readback');
      let failure: { label: string; error: unknown } | undefined;
      try {
        if (!sameDirectory(reader.rootIdentity, root)) conflict('changed-root');
        return reader.observe(relative, 'Workspace Create fresh readback');
      } catch (error) { failure = { label: 'Create readback', error }; throw error; }
      finally { settleResources({ ...(failure ? { primary: failure } : {}), cleanup: [{ label: 'Create reader', settle: () => reader.dispose() }] }); }
    };
    const fence = async () => {
      await assertWorkspaceWriteLease(input.workspaceRoot, input.token);
      files.assertCurrent();
      assertSameNoFollowDirectoryIdentity(local, 'Workspace Create local state');
      if (recorded !== null) {
        const current = freshFile(RECORD);
        if (!current || !same(current.identity, recorded.identity) || current.permissionMode !== recorded.permissionMode
            || !Buffer.from(current.bytes).equals(recorded.bytes)) conflict('changed-record');
      }
      if (admitted) guard!.run(() => {});
    };
    const validateEntries = () => {
      const expected = new Map<string, { kind: string; size: number | null; contentDigest: string | null }>();
      for (const relative of material.directories) expected.set(relative, { kind: 'directory', size: null, contentDigest: null });
      for (const file of material.files) expected.set(file.relativePath, { kind: 'file', size: file.bytes.byteLength, contentDigest: contentDigest(file.bytes) });
      if (!Array.isArray(record.entries) || record.entries.length !== expected.size) conflict('invalid-record-entries');
      for (const entry of record.entries) {
        const wanted = expected.get(entry?.relativePath);
        if (!wanted || entry.kind !== wanted.kind || entry.size !== wanted.size || entry.contentDigest !== wanted.contentDigest
            || typeof entry.device !== 'string' || !entry.device || typeof entry.inode !== 'string' || !entry.inode
            || !(entry.permissionMode === null || Number.isSafeInteger(entry.permissionMode) && entry.permissionMode >= 0 && entry.permissionMode <= 0o7777)) conflict('invalid-record-entry');
        expected.delete(entry.relativePath);
      }
    };
    await fence();
    const observed = freshFile(RECORD);
    if (observed === null) {
      await assertWorkspaceCreateSurfaceEmpty(root.path, input.token);
      const stageName = STAGE_PREFIX + randomUUID();
      const stageBirth = createExclusiveNoFollowDirectoryWithReceipt(local, stageName);
      const stage = stageBirth.directory;
      const stagedFiles = retainNoFollowFileTransaction(stage.path, 'Workspace Create staging', input.testOnlyActor);
      const births = new Map<string, Entry>();
      let failure: { label: string; error: unknown } | undefined;
      try {
        for (const relative of material.directories) {
          await fence();
          const parentName = path.posix.dirname(relative);
          const parent = parentName === '.' ? stage : directoryAt(stage, parentName)!;
          const born = createExclusiveNoFollowDirectoryWithReceipt(parent, path.posix.basename(relative), undefined, 0o777);
          births.set(relative, { relativePath: relative, kind: 'directory', ...identity(born.directory), size: null, contentDigest: null, permissionMode: born.permissionMode });
        }
        for (const file of material.files) {
          await fence();
          const born = await stagedFiles.createExclusive(file.relativePath, file.bytes, 'Workspace Create staged file', file.creationMode);
          births.set(file.relativePath, { relativePath: file.relativePath, kind: 'file', ...identity(born.identity),
            size: born.bytes.byteLength, contentDigest: contentDigest(born.bytes), permissionMode: born.permissionMode });
        }
        record = { schema: SCHEMA, phase: 'prepared', intent: material.intent, root: directoryIdentity(root), local: directoryIdentity(local), stage: { ...directoryIdentity(stage), permissionMode: stageBirth.permissionMode }, stageName, entries: inventory(stage) };
        validateEntries();
        for (const entry of record.entries) if (!exact(entry, births.get(entry.relativePath))) conflict('changed-staged-birth');
        const currentStage = scanNoFollowDirectoryDirectMetadata(local, bounds()).find(entry => entry.relativePath === stageName);
        if (!currentStage || !same(currentStage, stage) || (currentStage.permissionMode ?? null) !== stageBirth.permissionMode) conflict('changed-staged-birth');
        flushNoFollowDirectory(stage);
      } catch (error) { failure = { label: 'Create staging', error }; throw error; }
      finally { settleResources({ ...(failure ? { primary: failure } : {}), cleanup: [{ label: 'Create stage files', settle: () => stagedFiles.dispose() }] }); }
      await fence();
      guard = prepareRuntimeStateJournalMutation(fs, recordPath, 'create-absent-data');
      if (guard === null) conflict('record-contended');
      if (!guard.run(() => fs.createExclusiveFsync(recordPath, formatJsonFile(record)))) conflict('record-publication-conflict');
      recorded = freshFile(RECORD);
      if (!recorded || Buffer.from(recorded.bytes).toString('utf8') !== formatJsonFile(record)) conflict('record-readback');
    } else {
      try { guard = prepareRuntimeStateJournalMutation(fs, recordPath); }
      catch (error) { throw new CompilerError('WORKSPACE-INIT-003', 'Workspace creation record is unqualified; existing objects were preserved', { reason: 'unqualified-record' }, { cause: error }); }
      if (guard === null) conflict('record-contended');
      const qualified = fs.observeTextRetained(recordPath, { deadlineAtMonotonicMs: performance.now() + 30_000, maximumBytes: 2 * 1024 * 1024 });
      if (!qualified || !same(qualified.physical, observed.identity) || qualified.text !== Buffer.from(observed.bytes).toString('utf8')) conflict('changed-record');
      try { record = JSON.parse(qualified.text) as Record; } catch { conflict('invalid-record'); }
      const validIdentity = (value: DirectoryIdentity) => value && typeof value.device === 'string' && value.device.length > 0
        && typeof value.inode === 'string' && value.inode.length > 0 && typeof value.objectId === 'string' && value.objectId.length > 0;
      if (!record || record.schema !== SCHEMA || !['prepared', 'settling', 'completed'].includes(record.phase)
          || typeof record.stageName !== 'string' || !/^\.workspace-create-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(record.stageName)
          || !validIdentity(record.root) || !validIdentity(record.local) || !validIdentity(record.stage)
          || !(record.stage.permissionMode === null || Number.isSafeInteger(record.stage.permissionMode) && record.stage.permissionMode >= 0 && record.stage.permissionMode <= 0o7777)
          || !sameDirectory(record.root, root) || !sameDirectory(record.local, local) || qualified.text !== formatJsonFile(record)) conflict('invalid-record');
      if (record.intent !== material.intent) conflict('template-request-mismatch');
      validateEntries();
      recorded = observed;
    }
    const stageAt = () => {
      const stage = directoryAt(local, record.stageName);
      if (stage !== null) {
        const current = scanNoFollowDirectoryDirectMetadata(local, bounds()).find(entry => entry.relativePath === record.stageName);
        if (!sameDirectory(stage, record.stage) || !current || (current.permissionMode ?? null) !== record.stage.permissionMode) conflict('changed-stage');
      }
      return stage;
    };
    const flushRecord = async () => {
      const reader = retainNoFollowFileTransaction(root.path, 'Workspace Create record barrier', input.testOnlyActor);
      let failure: { label: string; error: unknown } | undefined;
      try {
        const current = reader.observe(RECORD, 'Workspace Create record');
        if (!current || !recorded || !same(current.identity, recorded.identity) || !Buffer.from(current.bytes).equals(recorded.bytes)) conflict('changed-record');
        await fence();
        await reader.flushExact(RECORD, current, 'Workspace Create record barrier');
      } catch (error) { failure = { label: 'Create record barrier', error }; throw error; }
      finally { settleResources({ ...(failure ? { primary: failure } : {}), cleanup: [{ label: 'Create record reader', settle: () => reader.dispose() }] }); }
    };
    if (record.phase === 'completed') {
      if (stageAt() !== null) conflict('completed-stage-residue');
      admitted = true;
      await flushRecord(); // Historical intent, not later author bytes, proves no-op completion.
      await fence();
      return;
    }
    const frontier = record.entries.filter(entry => {
      const parts = entry.relativePath.split('/');
      return parts.length === 1 && parts[0] !== '.sec' || parts.length === 2 && parts[0] === '.sec' && parts[1] !== WORKSPACE_WRITE_LEASE_DIRECTORY_NAME;
    }).sort((a, b) => a.relativePath === workspaceConfigRelativePath ? 1 : b.relativePath === workspaceConfigRelativePath ? -1 : compareCodeUnits(a.relativePath, b.relativePath));
    const guardedNames: string[] = [];
    for (const entry of scanNoFollowDirectoryDirectMetadata(local, bounds())) {
      if (entry.kind !== 'file') continue;
      const resource = observePhysicalJournalMutationEntry(local, entry.relativePath);
      if (resource?.resourceName === WORKSPACE_CREATE_RECORD_NAME) guardedNames.push(resource.anchorName, resource.leaseName);
    }
    if (guardedNames.length === 0) conflict('missing-record-guard');
    const observeEntry = (base: PhysicalDirectoryIdentity, relative: string, expected: Entry): boolean => {
      if (expected.kind === 'file') {
        const file = freshFile(path.relative(root.path, path.join(base.path, relative)).split(path.sep).join('/'));
        if (file === null) return false;
        if (!same(file.identity, expected) || file.permissionMode !== expected.permissionMode || file.bytes.byteLength !== expected.size || contentDigest(file.bytes) !== expected.contentDigest) conflict('changed-file:' + expected.relativePath);
      } else {
        const directory = directoryAt(base, relative);
        if (directory === null) return false;
        const parentName = path.posix.dirname(relative), parent = parentName === '.' ? base : directoryAt(base, parentName)!;
        const self = scanNoFollowDirectoryDirectMetadata(parent, bounds()).find(entry => entry.relativePath === path.posix.basename(relative));
        if (!same(directory, expected) || !self || (self.permissionMode ?? null) !== expected.permissionMode) conflict('changed-directory:' + expected.relativePath);
        const descendants = record.entries.filter(entry => entry.relativePath.startsWith(expected.relativePath + '/'))
          .map(entry => ({ ...entry, relativePath: entry.relativePath.slice(expected.relativePath.length + 1) }));
        if (!exact(inventory(directory), descendants)) conflict('changed-tree:' + expected.relativePath);
      }
      return true;
    };
    const states = () => {
      const rootNames = new Set(['.sec', ...frontier.filter(entry => !entry.relativePath.includes('/')).map(entry => entry.relativePath)]);
      const localNames = new Set([WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, WORKSPACE_CREATE_RECORD_NAME, record.stageName, ...guardedNames,
        ...frontier.filter(entry => entry.relativePath.startsWith('.sec/')).map(entry => path.posix.basename(entry.relativePath))]);
      for (const [directory, names] of [[root, rootNames], [local, localNames]] as const)
        if (scanNoFollowDirectoryDirectMetadata(directory, bounds()).some(entry => !names.has(entry.relativePath))) conflict('external-create');
      const stage = stageAt();
      if (stage === null && record.phase === 'prepared') conflict('unsettled-stage-absence');
      return frontier.map(entry => {
        const target = observeEntry(root, entry.relativePath, entry);
        const source = stage !== null && observeEntry(stage, entry.relativePath, entry);
        if (target === source || record.phase === 'settling' && !target) conflict('ambiguous-publication:' + entry.relativePath);
        return target;
      });
    };
    states(); // All destinations are admitted before acknowledging the predecessor or moving anything.
    admitted = true;
    await flushRecord();
    const phase = async (next: Record['phase']) => {
      await fence();
      const successor = { ...record, phase: next };
      if (!guard!.run(() => fs.replaceFsyncCas(recordPath, formatJsonFile(record), formatJsonFile(successor)))) conflict('record-cas-conflict');
      record = successor;
      recorded = freshFile(RECORD);
      if (!recorded || Buffer.from(recorded.bytes).toString('utf8') !== formatJsonFile(record)) conflict('record-readback');
      await fence();
    };
    if (record.phase === 'prepared') {
      for (let index = 0; index < frontier.length; index++) {
        await fence();
        if (states()[index]) continue;
        const entry = frontier[index]!, source = `.sec/${record.stageName}/${entry.relativePath}`;
        if (entry.kind === 'directory') relocateRetainedNoFollowDirectoryAcrossParents({ directory: directoryAt(root, source)!, destinationParent: entry.relativePath.startsWith('.sec/') ? local : root, tombstoneName: path.posix.basename(entry.relativePath) });
        else {
          const retained = files.observe(source, 'Workspace Create publication source');
          if (!retained) conflict('missing-staged-file');
          await files.renameNoReplace(source, entry.relativePath, retained, 'Workspace Create exclusive publication');
        }
        await fence();
        if (!states()[index]) conflict('publication-readback');
      }
      if (states().some(published => !published)) conflict('incomplete-publication');
      await phase('settling');
    }
    const stage = stageAt();
    if (stage !== null) {
      const remaining = inventory(stage);
      const allowed = record.entries.filter(entry => entry.relativePath === '.sec' || entry.relativePath === `.sec/${WORKSPACE_WRITE_LEASE_DIRECTORY_NAME}`);
      if (remaining.some(entry => !allowed.some(original => exact(entry, original)))) conflict('unexpected-stage-residue');
      for (const entry of [...remaining].sort((a, b) => b.relativePath.length - a.relativePath.length)) {
        await fence();
        const parentName = path.posix.dirname(entry.relativePath), parent = parentName === '.' ? stage : directoryAt(stage, parentName)!;
        const child = directoryAt(stage, entry.relativePath);
        if (!child || !same(child, entry) || scanNoFollowDirectoryDirectMetadata(child, bounds()).length !== 0) conflict('stage-not-owned-empty');
        deleteRetainedNoFollowEntry({ root: parent, relativePath: path.posix.basename(entry.relativePath), kind: 'directory', ...identity(entry), ancestorDirectories: [] });
      }
      await fence();
      if (scanNoFollowDirectoryDirectMetadata(stage, bounds()).length !== 0) conflict('stage-not-empty');
      deleteRetainedNoFollowEntry({ root: local, relativePath: record.stageName, kind: 'directory', ...record.stage, ancestorDirectories: [] });
    }
    if (stageAt() !== null || states().some(published => !published)) conflict('unsettled-publication');
    for (const file of material.files) {
      await fence();
      const current = files.observe(file.relativePath, 'Workspace Create published barrier');
      const expected = record.entries.find(entry => entry.relativePath === file.relativePath)!;
      if (!current || !same(current.identity, expected) || !Buffer.from(current.bytes).equals(file.bytes)) conflict('changed-durability-target');
      await files.flushExact(file.relativePath, current, 'Workspace Create published barrier');
    }
    await fence();
    flushNoFollowDirectory(root); flushNoFollowDirectory(local);
    if (states().some(published => !published)) conflict('incomplete-publication');
    await phase('completed');
  } catch (error) { primary = { label: 'Workspace Create', error }; throw error; }
  finally { settleResources({ ...(primary ? { primary } : {}), cleanup: [
    ...(guard === null ? [] : [{ label: 'Create journal guard', settle: () => guard!.dispose() }]),
    { label: 'Create retained files', settle: () => files.dispose() }
  ] }); }
}
