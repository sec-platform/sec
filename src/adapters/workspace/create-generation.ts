import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { CodedFailure } from '../../contracts/failure.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { settleResources } from '../../execution/resource-settlement.ts';
import { snapshotWorkspaceCreateRequest, type WorkspaceCreateIntent, type WorkspaceCreateSession, type WorkspaceCreateTemplate, type WorkspaceTemplateBlueprint } from '../../execution/workspace-create.ts';
import { workspaceConfigRelativePath } from '../../workspace/paths.ts';
import { assertWorkspaceWriteLease, WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, type WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import { observePhysicalJournalMutationEntry } from '../runtime-state/physical/runtime/mutation-lease.ts';
import {
  assertSameNoFollowDirectoryIdentity, createExclusiveNoFollowDirectory,
  deleteRetainedNoFollowEntry, flushNoFollowDirectory,
  inspectNoFollowDirectoryLeaf,
  relocateRetainedNoFollowDirectoryAcrossParents,
  retainNoFollowFileTransaction,
  scanNoFollowDirectoryDirectMetadata, scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry, type PhysicalDirectoryIdentity,
  type RetainedNoFollowFileObservation, type RetainedNoFollowFileTransactionTestActor
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem, prepareRuntimeStateJournalMutation, type PreparedRuntimeStateJournalMutation } from '../runtime-state/workspace-state/journal-filesystem.ts';
import { assertWorkspaceCreateSurfaceEmpty } from './create-surface.ts';

const JOURNAL = '.sec/workspace-create.json';
const STAGE_PREFIX = '.workspace-create-';
const SCHEMA = 'sec-workspace-create-generation-v2';
const LIMIT = 2048;
const bounds = () => ({ deadlineAtMs: performance.now() + 30_000, maximumEntries: LIMIT, maximumBytes: 16 * 1024 * 1024, includePermissionMode: true });
type Identity = Readonly<{ device: string; inode: string }>;
type Entry = Readonly<{
  relativePath: string; kind: 'file' | 'directory'; device: string; inode: string;
  size: number | null; contentDigest: string | null; permissionMode: number | null;
}>;
interface Journal {
  schema: typeof SCHEMA;
  phase: 'prepared' | 'settling' | 'completed';
  generation: string;
  template: WorkspaceCreateTemplate;
  blueprintDigest: string;
  root: Identity;
  localState: Identity;
  stage: Identity;
  stageName: string;
  entries: readonly Entry[];
}
function conflict(reason: string): never {
  throw new CodedFailure('WORKSPACE-INIT-003', 'Workspace creation requires lifecycle recovery; existing objects were preserved', { reason });
}
function identity(value: Identity): Identity { return { device: value.device, inode: value.inode }; }
function sameIdentity(left: Identity, right: Identity): boolean { return left.device === right.device && left.inode === right.inode; }
function hash(bytes: Uint8Array): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }
function contentHash(bytes: Uint8Array): string { return hash(Buffer.from(JSON.stringify({ bytes: Buffer.from(bytes).toString('hex') }))); }
function assertBlueprint(journal: Journal, blueprint: WorkspaceTemplateBlueprint): void {
  const expected = new Map<string, Readonly<{ kind: 'directory' | 'file'; size: number | null; contentDigest: string | null }>>();
  for (const directory of blueprint.directories) expected.set(directory, { kind: 'directory', size: null, contentDigest: null });
  for (const file of blueprint.files) expected.set(file.relativePath, { kind: 'file', size: file.bytes.byteLength, contentDigest: contentHash(file.bytes) });
  if (journal.entries.length !== expected.size) conflict('template-shape-mismatch');
  for (const entry of journal.entries) {
    const desired = expected.get(entry.relativePath);
    if (!desired || entry.kind !== desired.kind || entry.size !== desired.size || entry.contentDigest !== desired.contentDigest) conflict('template-content-mismatch');
  }
}
function inventory(root: PhysicalDirectoryIdentity): readonly Entry[] {
  return scanNoFollowDirectoryTreeInventory(root, bounds()).map(projectEntry).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
function projectEntry(entry: NoFollowDirectoryTreeInventoryEntry): Entry {
  if (entry.kind === 'link') conflict('unexpected-link');
  return { relativePath: entry.relativePath, kind: entry.kind, ...identity(entry),
    size: entry.kind === 'file' ? entry.size : null,
    contentDigest: entry.kind === 'file' ? entry.contentDigest : null,
    permissionMode: entry.permissionMode ?? null };
}
function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function keys(value: object, expected: readonly string[]): boolean { return exact(Object.keys(value).sort(), [...expected].sort()); }
function parseJournal(bytes: Uint8Array): Journal {
  if (bytes.byteLength > 2 * 1024 * 1024) conflict('journal-too-large');
  let value: Journal;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Journal; }
  catch { conflict('invalid-journal'); }
  const validIdentity = (id: Identity) => id && typeof id.device === 'string' && id.device.length > 0 && typeof id.inode === 'string' && id.inode.length > 0;
  if (!value || !keys(value, ['schema', 'phase', 'generation', 'template', 'blueprintDigest', 'root', 'localState', 'stage', 'stageName', 'entries']) || value.schema !== SCHEMA || !['prepared', 'settling', 'completed'].includes(value.phase) || !/^[0-9a-f-]{36}$/u.test(value.generation)
      || value.stageName !== `${STAGE_PREFIX}${value.generation}` || !/^sha256:[a-f0-9]{64}$/u.test(value.blueprintDigest)
      || !['minimal', 'reference-customer'].includes(value.template)
      || !validIdentity(value.root) || !validIdentity(value.localState) || !validIdentity(value.stage)
      || ![value.root, value.localState, value.stage].every(id => keys(id, ['device', 'inode']))
      || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > LIMIT
      || formatJsonFile(value) !== Buffer.from(bytes).toString('utf8')) conflict('invalid-journal');
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (!entry || !keys(entry, ['relativePath', 'kind', 'device', 'inode', 'size', 'contentDigest', 'permissionMode']) || typeof entry.relativePath !== 'string' || /[\\\0:]/u.test(entry.relativePath)
        || entry.relativePath.split('/').some((part: string) => !part || part === '.' || part === '..')
        || seen.has(entry.relativePath) || !validIdentity(entry)
        || !['file', 'directory'].includes(entry.kind)
        || (entry.kind === 'file' ? !Number.isSafeInteger(entry.size) || entry.size! < 0 || !/^sha256:[a-f0-9]{64}$/u.test(entry.contentDigest ?? '')
          : entry.size !== null || entry.contentDigest !== null)
        || (entry.permissionMode !== null && (!Number.isSafeInteger(entry.permissionMode) || entry.permissionMode < 0 || entry.permissionMode > 0o7777))) conflict('invalid-journal-entry');
    seen.add(entry.relativePath);
  }
  for (const entry of value.entries) {
    const parent = path.posix.dirname(entry.relativePath);
    if (parent !== '.' && !value.entries.some(item => item.relativePath === parent && item.kind === 'directory')) conflict('incomplete-journal-tree');
  }
  if (!value.entries.some(entry => entry.relativePath === workspaceConfigRelativePath && entry.kind === 'file')
      || !value.entries.some(entry => entry.relativePath === '.sec' && entry.kind === 'directory')) conflict('invalid-publication-frontier');
  return value;
}
function frontier(journal: Journal): readonly Entry[] {
  return journal.entries.filter(entry => {
    const parts = entry.relativePath.split('/');
    return parts.length === 1 && parts[0] !== '.sec'
      || parts.length === 2 && parts[0] === '.sec' && parts[1] !== WORKSPACE_WRITE_LEASE_DIRECTORY_NAME;
  }).sort((a, b) => a.relativePath === workspaceConfigRelativePath ? 1 : b.relativePath === workspaceConfigRelativePath ? -1 : a.relativePath.localeCompare(b.relativePath));
}
function directoryAt(root: PhysicalDirectoryIdentity, relativePath: string): PhysicalDirectoryIdentity | null {
  let current: PhysicalDirectoryIdentity | null = root;
  for (const part of relativePath.split('/')) {
    current = inspectNoFollowDirectoryLeaf(current, part, 'Workspace generation directory');
    if (current === null) return null;
  }
  return current;
}
function freshFile(root: PhysicalDirectoryIdentity, relativePath: string): RetainedNoFollowFileObservation | null {
  const reader = retainNoFollowFileTransaction(root.path, 'Workspace creation fresh readback');
  let primary: { label: string; error: unknown } | undefined;
  try {
    if (!sameIdentity(reader.rootIdentity, root)) conflict('changed-root');
    return reader.observe(relativePath, 'Workspace creation fresh file');
  } catch (error) { primary = { label: 'workspace create fresh readback', error }; throw error; }
  finally { settleResources({ ...(primary === undefined ? {} : { primary }), cleanup: [{ label: 'workspace create reader dispose', settle: () => reader.dispose() }] }); }
}
function assertCurrentFile(root: PhysicalDirectoryIdentity, relativePath: string, expected: RetainedNoFollowFileObservation, reason: string): void {
  const current = freshFile(root, relativePath);
  if (!current || !sameIdentity(current.identity, expected.identity) || current.permissionMode !== expected.permissionMode
      || !Buffer.from(current.bytes).equals(expected.bytes)) conflict(reason);
}
function observeEntry(root: PhysicalDirectoryIdentity, relativePath: string, expected: Entry, journal: Journal): boolean {
  if (expected.kind === 'directory') {
    const directory = directoryAt(root, relativePath);
    if (directory === null) return false;
    if (!sameIdentity(directory, expected)) conflict(`changed-identity:${expected.relativePath}`);
    const parentPath = path.posix.dirname(relativePath);
    const parent = parentPath === '.' ? root : directoryAt(root, parentPath)!;
    const self = scanNoFollowDirectoryDirectMetadata(parent, bounds()).find(entry => entry.relativePath === path.posix.basename(relativePath));
    if (!self || self.kind !== 'directory' || !sameIdentity(self, expected) || (self.permissionMode ?? null) !== expected.permissionMode) conflict(`changed-directory-mode:${expected.relativePath}`);
    const descendants = journal.entries.filter(entry => entry.relativePath.startsWith(`${expected.relativePath}/`))
      .map(entry => ({ ...entry, relativePath: entry.relativePath.slice(expected.relativePath.length + 1) }));
    if (!exact(inventory(directory), descendants)) conflict(`changed-tree:${expected.relativePath}`);
  } else {
    const file = freshFile(root, relativePath);
    if (file === null) return false;
    const contentDigest = contentHash(file.bytes);
    if (!sameIdentity(file.identity, expected) || file.bytes.byteLength !== expected.size
        || contentDigest !== expected.contentDigest || file.permissionMode !== expected.permissionMode) conflict(`changed-file:${expected.relativePath}`);
  }
  return true;
}
function assertFrontierSurface(root: PhysicalDirectoryIdentity, local: PhysicalDirectoryIdentity, journal: Journal, guardedNames: readonly string[]): void {
  const entries = frontier(journal);
  const rootNames = new Set(['.sec', ...entries.filter(entry => !entry.relativePath.includes('/')).map(entry => entry.relativePath)]);
  const localNames = new Set([WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, path.basename(JOURNAL), journal.stageName,
    ...entries.filter(entry => entry.relativePath.startsWith('.sec/')).map(entry => path.posix.basename(entry.relativePath))]);
  for (const name of guardedNames) localNames.add(name);
  for (const [directory, names] of [[root, rootNames], [local, localNames]] as const) {
    if (scanNoFollowDirectoryDirectMetadata(directory, bounds()).some(entry => !names.has(entry.relativePath))) conflict('external-create');
  }
}


/** Retain one concrete Create scope. No user-path rollback or path-based
 * adoption is provided. The application selects all lifecycle phases. */
export async function openWorkspaceCreateSession(input: Readonly<{
  workspaceRoot: string;
  token: WorkspaceWriteLeaseToken;
  testOnlyActor?: RetainedNoFollowFileTransactionTestActor;
}>): Promise<WorkspaceCreateSession> {
  await assertWorkspaceWriteLease(input.workspaceRoot, input.token);
  const files = retainNoFollowFileTransaction(input.workspaceRoot, 'Workspace initial generation', input.testOnlyActor);
  let guard: PreparedRuntimeStateJournalMutation | null = null;
  let closed = false;
  let recorded: RetainedNoFollowFileObservation | null = null;
  let journal: Journal | null = null;
  let guardedNames: readonly string[] = [];
  let admitted = false;
  let observedOnce = false;
  let admittedBlueprint: WorkspaceTemplateBlueprint | null = null;
  let admittedIntent: WorkspaceCreateIntent | null = null;
  let publicationFlushed = false;
  const root = files.rootIdentity;
  let local: PhysicalDirectoryIdentity;
  try {
    const observed = inspectNoFollowDirectoryLeaf(root, '.sec', 'Workspace create local state');
    if (observed === null) conflict('missing-local-state');
    local = observed;
  } catch (error) {
    settleResources({ primary: { label: 'workspace create scope acquisition', error }, cleanup: [{ label: 'workspace create retained files', settle: () => files.dispose() }] });
    throw error;
  }
  const fs = createRuntimeStateJournalFileSystem(local);
  const journalPath = path.join(root.path, JOURNAL);
  const fence = async () => {
    if (closed) conflict('closed-session');
    await assertWorkspaceWriteLease(input.workspaceRoot, input.token);
    files.assertCurrent();
    assertSameNoFollowDirectoryIdentity(local, 'Workspace create local state');
    if (recorded !== null) assertCurrentFile(root, JOURNAL, recorded, 'changed-journal');
    if (admitted && guard !== null) guard.run(() => {});
  };
  const observeGuardNames = () => {
    for (const entry of scanNoFollowDirectoryDirectMetadata(local, bounds())) {
      if (entry.kind !== 'file') continue;
      const resource = observePhysicalJournalMutationEntry(local, entry.relativePath);
      if (resource?.resourceName === path.basename(JOURNAL)) {
        guardedNames = Object.freeze([resource.anchorName, resource.leaseName]);
        return;
      }
    }
    conflict('missing-guarded-journal-namespace');
  };
  const currentJournal = (): Journal => { if (journal === null) conflict('missing-admitted-generation'); return journal; };
  const assertIntent = (intent: WorkspaceCreateIntent) => {
    const value = currentJournal();
    if (value.template !== intent.template || value.blueprintDigest !== intent.digest) conflict('template-request-mismatch');
  };
  const effectFence = async () => {
    if (!admitted || admittedBlueprint === null || admittedIntent === null || guard === null || recorded === null) conflict('missing-intent-admission');
    assertIntent(admittedIntent);
    await fence();
  };
  const flushJournal = async (label: string) => {
    const reader = retainNoFollowFileTransaction(root.path, label, input.testOnlyActor);
    let primary: { label: string; error: unknown } | undefined;
    try {
      const observed = reader.observe(JOURNAL, label);
      if (!observed || !recorded || !sameIdentity(observed.identity, recorded.identity) || !Buffer.from(observed.bytes).equals(recorded.bytes)) conflict('changed-journal');
      await effectFence();
      await reader.flushExact(JOURNAL, observed, label);
    } catch (error) { primary = { label, error }; throw error; }
    finally { settleResources({ ...(primary === undefined ? {} : { primary }), cleanup: [{ label: 'workspace create journal reader dispose', settle: () => reader.dispose() }] }); }
  };
  const stageAt = (): PhysicalDirectoryIdentity | null => {
    const value = currentJournal();
    const stage = directoryAt(root, '.sec/' + value.stageName);
    if (stage !== null && !sameIdentity(stage, value.stage)) conflict('changed-stage');
    return stage;
  };
  const entryAt = (relative: string): Entry => {
    const value = frontier(currentJournal()).find(entry => entry.relativePath === relative);
    if (!value) conflict('outside-publication-scope');
    return value;
  };
  const readState = (entry: Entry): 'staged' | 'published' => {
    const value = currentJournal(), stage = stageAt();
    const target = observeEntry(root, entry.relativePath, entry, value);
    const source = stage !== null && observeEntry(root, '.sec/' + value.stageName + '/' + entry.relativePath, entry, value);
    if (target === source) conflict('ambiguous-publication:' + entry.relativePath);
    return target ? 'published' : 'staged';
  };
  const assertPayloadPublished = () => {
    const value = currentJournal();
    assertFrontierSurface(root, local, value, guardedNames);
    for (const entry of frontier(value)) if (readState(entry) !== 'published') conflict('incomplete-publication');
  };
  const replacePhase = (phase: Journal['phase']) => {
    const value = currentJournal();
    if (guard === null || recorded === null) conflict('missing-journal-admission');
    const next: Journal = { ...value, phase };
    if (!guard.run(() => fs.replaceFsyncCas(journalPath, Buffer.from(recorded!.bytes).toString('utf8'), formatJsonFile(next)))) conflict('journal-cas-conflict');
    journal = next;
    recorded = freshFile(root, JOURNAL);
    if (recorded === null || !Buffer.from(recorded.bytes).equals(Buffer.from(formatJsonFile(next)))) conflict('journal-cas-readback');
  };
  const dispose = () => {
    if (closed) return;
    closed = true;
    settleResources({ cleanup: [
      ...(guard === null ? [] : [{ label: 'workspace create journal guard', settle: () => guard!.dispose() }]),
      { label: 'workspace create retained files', settle: () => files.dispose() }
    ] });
  };
  return Object.freeze({
    async observe() {
      if (observedOnce || guard !== null || journal !== null) conflict('generation-already-observed');
      await fence();
      const observed = freshFile(root, JOURNAL);
      if (observed === null) {
        // A lost birth/publication window never turns residue into ownership.
        await assertWorkspaceCreateSurfaceEmpty(input.workspaceRoot, input.token);
        observedOnce = true;
        return { phase: 'absent' as const };
      }
      // Acquisition alone retains the predecessor. Do not run/acknowledge it
      // until the application accepts this exact request and recovery scope.
      try { guard = prepareRuntimeStateJournalMutation(fs, journalPath); }
      catch (error) {
        throw new CodedFailure('WORKSPACE-INIT-003', 'Workspace journal admission is unproven; existing objects were preserved', { reason: 'unqualified-journal' }, { cause: error });
      }
      if (guard === null) conflict('journal-contended');
      const guarded = fs.observeTextRetained(journalPath, { deadlineAtMonotonicMs: performance.now() + 30_000, maximumBytes: 2 * 1024 * 1024 });
      if (!guarded || !sameIdentity(guarded.physical, observed.identity) || guarded.text !== Buffer.from(observed.bytes).toString('utf8')) conflict('changed-journal');
      journal = parseJournal(observed.bytes);
      recorded = observed;
      observeGuardNames();
      if (!sameIdentity(root, journal.root) || !sameIdentity(local, journal.localState)) conflict('changed-root');
      await fence();
      observedOnce = true;
      return { phase: journal.phase, intent: { template: journal.template, digest: journal.blueprintDigest } };
    },
    async prepare(suppliedBlueprint, suppliedIntent) {
      const { blueprint, intent } = snapshotWorkspaceCreateRequest(suppliedIntent?.template, suppliedBlueprint, suppliedIntent);
      await fence();
      if (!observedOnce || journal !== null || recorded !== null || guard !== null) conflict('generation-already-observed');
      await assertWorkspaceCreateSurfaceEmpty(input.workspaceRoot, input.token);
      const generation = randomUUID(), stageName = STAGE_PREFIX + generation;
      const stage = createExclusiveNoFollowDirectory(local, stageName);
      const stageFence = async () => { await fence(); assertSameNoFollowDirectoryIdentity(stage, 'Workspace unpublished stage'); };
      const stageFiles = retainNoFollowFileTransaction(stage.path, 'Workspace staged generation', input.testOnlyActor);
      let primary: { label: string; error: unknown } | undefined;
      let prepared!: Journal;
      const births = new Map<string, Identity>();
      try {
      for (const relative of blueprint.directories) {
        await stageFence();
        const parentPath = path.posix.dirname(relative);
        const parent = parentPath === '.' ? stage : directoryAt(stage, parentPath)!;
        const created = createExclusiveNoFollowDirectory(parent, path.posix.basename(relative), undefined, 0o777);
        births.set(relative, identity(created));
      }
      for (const file of blueprint.files) {
        await stageFence();
        const created = await stageFiles.createExclusive(file.relativePath, file.bytes, 'Workspace staged file', file.creationMode ?? 0o666);
        births.set(file.relativePath, identity(created.identity));
      }
      await stageFence();
      prepared = { schema: SCHEMA, phase: 'prepared', generation, template: intent.template,
        blueprintDigest: intent.digest, root: identity(root), localState: identity(local), stage: identity(stage), stageName, entries: inventory(stage) };
      assertBlueprint(prepared, blueprint);
      // Both native exclusive creators return after their publication barriers.
      // Reuse those exact receipts, and reject a same-byte replacement before
      // journal birth instead of adopting the later inventory's identities.
      for (const entry of prepared.entries) {
        const born = births.get(entry.relativePath);
        if (!born || !sameIdentity(born, entry)) conflict('changed-staged-birth');
      }
      flushNoFollowDirectory(stage);
      } catch (error) { primary = { label: 'workspace create staging', error }; throw error; }
      finally { settleResources({ ...(primary === undefined ? {} : { primary }), cleanup: [{ label: 'workspace create staging handles', settle: () => stageFiles.dispose() }] }); }
      await stageFence();
      guard = prepareRuntimeStateJournalMutation(fs, journalPath, 'create-absent-data');
      if (guard === null) conflict('journal-contended');
      const bytes = Buffer.from(formatJsonFile(prepared));
      if (!guard.run(() => fs.createExclusiveFsync(journalPath, bytes.toString('utf8')))) conflict('journal-publication-conflict');
      journal = prepared;
      recorded = freshFile(root, JOURNAL);
      if (recorded === null || !Buffer.from(recorded.bytes).equals(bytes)) conflict('journal-publication-readback');
      observeGuardNames();
      admittedBlueprint = blueprint;
      admittedIntent = intent;
      admitted = true;
      await effectFence();
      assertFrontierSurface(root, local, prepared, guardedNames);
      for (const entry of frontier(prepared)) readState(entry);
    },
    async resume(suppliedBlueprint, suppliedIntent) {
      const { blueprint, intent } = snapshotWorkspaceCreateRequest(suppliedIntent?.template, suppliedBlueprint, suppliedIntent);
      await fence();
      const value = currentJournal();
      if (!observedOnce || admitted || guard === null) conflict('missing-journal-admission');
      assertIntent(intent);
      if (value.phase === 'completed') conflict('completed-generation-not-resumable');
      assertBlueprint(value, blueprint);
      assertFrontierSurface(root, local, value, guardedNames);
      for (const entry of frontier(value)) readState(entry);
      if (value.phase === 'prepared' && stageAt() === null) conflict('unsettled-stage-absence');
      if (value.phase === 'settling') assertPayloadPublished();
      // Same-intent classification and all frontiers precede acknowledgement.
      guard!.run(() => {});
      admittedBlueprint = blueprint;
      admittedIntent = intent;
      admitted = true;
      await flushJournal('Workspace recovered intent barrier');
      await fence();
    },
    frontier() {
      if (!admitted) conflict('missing-intent-admission');
      return Object.freeze(frontier(currentJournal()).map(entry => entry.relativePath));
    },
    async observePublication(relative) {
      await effectFence();
      assertFrontierSurface(root, local, currentJournal(), guardedNames);
      return readState(entryAt(relative));
    },
    async publish(relative) {
      await effectFence();
      const value = currentJournal();
      if (value.phase !== 'prepared') conflict('invalid-publication-phase');
      assertFrontierSurface(root, local, value, guardedNames);
      const entry = entryAt(relative);
      if (readState(entry) !== 'staged') conflict('publication-preimage-changed');
      const sourceRelative = '.sec/' + value.stageName + '/' + relative;
      if (entry.kind === 'directory') {
        relocateRetainedNoFollowDirectoryAcrossParents({ directory: directoryAt(root, sourceRelative)!,
          destinationParent: relative.startsWith('.sec/') ? local : root, tombstoneName: path.posix.basename(relative) });
      } else {
        const source = files.observe(sourceRelative, 'Workspace publication source');
        if (!source) conflict('missing-staged-file');
        await files.renameNoReplace(sourceRelative, relative, source, 'Workspace exclusive publication');
      }
      await fence();
      if (readState(entry) !== 'published') conflict('publication-readback');
    },
    async beginSettlement() {
      await effectFence();
      if (currentJournal().phase !== 'prepared') conflict('invalid-settlement-phase');
      assertPayloadPublished();
      if (stageAt() === null) conflict('unsettled-stage-absence');
      replacePhase('settling');
      await fence();
    },
    async retireStage() {
      await effectFence();
      const value = currentJournal();
      if (value.phase !== 'settling') conflict('invalid-retirement-phase');
      assertPayloadPublished();
      const stage = stageAt();
      if (stage === null) return; // The qualified settling record owns this absence.
      const remaining = inventory(stage);
      const expected = value.entries.filter(entry => entry.relativePath === '.sec' || entry.relativePath === '.sec/' + WORKSPACE_WRITE_LEASE_DIRECTORY_NAME);
      if (remaining.some(entry => !expected.some(original => exact(entry, original)))) conflict('unexpected-stage-residue');
      for (const entry of [...remaining].sort((a, b) => b.relativePath.length - a.relativePath.length)) {
        await fence();
        const parentRelative = path.posix.dirname(entry.relativePath);
        const parent = parentRelative === '.' ? stage : directoryAt(stage, parentRelative)!;
        const child = directoryAt(stage, entry.relativePath);
        if (child === null || !sameIdentity(child, entry) || scanNoFollowDirectoryDirectMetadata(child, bounds()).length !== 0) conflict('stage-child-not-owned-empty');
        deleteRetainedNoFollowEntry({ root: parent, relativePath: path.posix.basename(entry.relativePath), kind: 'directory', ...identity(entry), ancestorDirectories: [] });
      }
      await fence();
      if (scanNoFollowDirectoryDirectMetadata(stage, bounds()).length !== 0) conflict('stage-not-empty');
      deleteRetainedNoFollowEntry({ root: local, relativePath: value.stageName, kind: 'directory', ...value.stage, ancestorDirectories: [] });
      await fence();
      if (stageAt() !== null) conflict('stage-retirement-readback');
    },
    async flushPublished() {
      await effectFence();
      publicationFlushed = false;
      const value = currentJournal();
      if (value.phase !== 'settling' || stageAt() !== null) conflict('unsettled-stage');
      assertPayloadPublished();
      for (const file of admittedBlueprint!.files) {
        await effectFence();
        const current = files.observe(file.relativePath, 'Workspace recovered destination');
        const expected = value.entries.find(entry => entry.relativePath === file.relativePath)!;
        if (!current || !sameIdentity(current.identity, expected) || !Buffer.from(current.bytes).equals(file.bytes)) conflict('changed-durability-target');
        await files.flushExact(file.relativePath, current, 'Workspace recovered file barrier');
      }
      await fence();
      flushNoFollowDirectory(root); flushNoFollowDirectory(local);
      publicationFlushed = true;
    },
    async complete() {
      await effectFence();
      if (currentJournal().phase !== 'settling' || stageAt() !== null || !publicationFlushed) conflict('unsettled-stage');
      assertPayloadPublished();
      replacePhase('completed');
      await fence();
    },
    async readCompleted(suppliedBlueprint, suppliedIntent) {
      const { blueprint, intent } = snapshotWorkspaceCreateRequest(suppliedIntent?.template, suppliedBlueprint, suppliedIntent);
      await fence();
      if (!observedOnce || admitted || guard === null) conflict('missing-journal-admission');
      assertIntent(intent);
      assertBlueprint(currentJournal(), blueprint);
      if (currentJournal().phase !== 'completed' || stageAt() !== null) conflict('invalid-completion');
      // Both callers and the native session have matched original intent. No initial author
      // payload scan follows a historical completion; later edits stay owned.
      guard!.run(() => {});
      admittedBlueprint = blueprint;
      admittedIntent = intent;
      admitted = true;
      await flushJournal('Workspace recovered completion barrier');
      await fence();
    },
    dispose
  } satisfies WorkspaceCreateSession);
}
