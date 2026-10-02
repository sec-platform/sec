import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type { WorkspaceCreateTemplate } from '../../application/workspace-create.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { workspaceConfigRelativePath } from '../../workspace/paths.ts';
import { assertWorkspaceWriteLease, WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, type WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
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
import { assertWorkspaceCreateSurfaceEmpty } from './create-surface.ts';
import type { WorkspaceTemplateBlueprint } from './project-base.ts';

const JOURNAL = '.sec/workspace-create.json';
const TERMINAL = '.sec/workspace-created.json';
const STAGE_PREFIX = '.workspace-create-';
const SCHEMA = 'sec-workspace-create-generation-v1';
const LIMIT = 2048;
const bounds = () => ({ deadlineAtMs: performance.now() + 30_000, maximumEntries: LIMIT, maximumBytes: 16 * 1024 * 1024, includePermissionMode: true });
type Identity = Readonly<{ device: string; inode: string }>;
type Entry = Readonly<{
  relativePath: string; kind: 'file' | 'directory'; device: string; inode: string;
  size: number | null; contentDigest: string | null; permissionMode: number | null;
}>;
interface Journal {
  schema: typeof SCHEMA;
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
  throw new CompilerError('WORKSPACE-INIT-003', 'Workspace creation requires lifecycle recovery; existing objects were preserved', { reason });
}
function identity(value: Identity): Identity { return { device: value.device, inode: value.inode }; }
function sameIdentity(left: Identity, right: Identity): boolean { return left.device === right.device && left.inode === right.inode; }
function hash(bytes: Uint8Array): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }
function contentHash(bytes: Uint8Array): string { return hash(Buffer.from(JSON.stringify({ bytes: Buffer.from(bytes).toString('hex') }))); }
function snapshotBlueprint(input: WorkspaceTemplateBlueprint): WorkspaceTemplateBlueprint {
  const directories = new Set<string>();
  const files = input.files.map(file => ({ relativePath: file.relativePath, bytes: Buffer.from(file.bytes), creationMode: file.creationMode ?? 0o666 }));
  const requirePath = (relative: string) => {
    if (!isCanonicalPortableLogicalPath(relative) || relative === JOURNAL || relative === TERMINAL
        || relative.startsWith(`.sec/${STAGE_PREFIX}`) || relative.startsWith(`.sec/${WORKSPACE_WRITE_LEASE_DIRECTORY_NAME}/`)) conflict('invalid-template-path');
  };
  const ancestors = (relative: string) => {
    for (let parent = path.posix.dirname(relative); parent !== '.'; parent = path.posix.dirname(parent)) directories.add(parent);
  };
  for (const directory of input.directories) { requirePath(directory); directories.add(directory); ancestors(directory); }
  const names = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    requirePath(file.relativePath);
    if (names.has(file.relativePath)) conflict('duplicate-template-file');
    if (!Number.isSafeInteger(file.creationMode) || file.creationMode < 0 || file.creationMode > 0o777) conflict('invalid-template-mode');
    names.add(file.relativePath); ancestors(file.relativePath); bytes += file.bytes.byteLength;
  }
  if (directories.size + files.length > LIMIT || bytes > 16 * 1024 * 1024
      || files.some(file => directories.has(file.relativePath))
      || [workspaceConfigRelativePath, CI_ARTIFACT_FILES.graphLock, CI_ARTIFACT_FILES.verificationReport].some(name => !names.has(name))) conflict('incomplete-template');
  return { directories: [...directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)), files };
}
/** Input compatibility with the trusted recipe, never journal authentication. */
function blueprintDigest(blueprint: WorkspaceTemplateBlueprint): string {
  return hash(Buffer.from(formatJsonFile({
    directories: blueprint.directories.map(relativePath => ({ relativePath, creationMode: 0o777 })),
    files: blueprint.files.map(file => ({ relativePath: file.relativePath, size: file.bytes.byteLength, contentDigest: contentHash(file.bytes), creationMode: file.creationMode ?? 0o666 }))
  })));
}
function assertBlueprint(journal: Journal, blueprint: WorkspaceTemplateBlueprint): void {
  if (journal.blueprintDigest !== blueprintDigest(blueprint)) conflict('template-request-mismatch');
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
  if (!value || !keys(value, ['schema', 'generation', 'template', 'blueprintDigest', 'root', 'localState', 'stage', 'stageName', 'entries']) || value.schema !== SCHEMA || !/^[0-9a-f-]{36}$/u.test(value.generation)
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
  try {
    if (!sameIdentity(reader.rootIdentity, root)) conflict('changed-root');
    return reader.observe(relativePath, 'Workspace creation fresh file');
  } finally { reader.dispose(); }
}
function assertCurrentFile(root: PhysicalDirectoryIdentity, relativePath: string, expected: RetainedNoFollowFileObservation, reason: string): void {
  const current = freshFile(root, relativePath);
  if (!current || !sameIdentity(current.identity, expected.identity) || current.permissionMode !== expected.permissionMode
      || !Buffer.from(current.bytes).equals(expected.bytes)) conflict(reason);
}
function completionBytes(journal: Journal, recorded: RetainedNoFollowFileObservation): Buffer {
  return Buffer.from(formatJsonFile({ schema: 'sec-workspace-created-v1', generation: journal.generation, journalDigest: hash(recorded.bytes) }));
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
function assertFrontierSurface(root: PhysicalDirectoryIdentity, local: PhysicalDirectoryIdentity, journal: Journal): void {
  const entries = frontier(journal);
  const rootNames = new Set(['.sec', ...entries.filter(entry => !entry.relativePath.includes('/')).map(entry => entry.relativePath)]);
  const localNames = new Set([WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, path.basename(JOURNAL), path.basename(TERMINAL), journal.stageName,
    ...entries.filter(entry => entry.relativePath.startsWith('.sec/')).map(entry => path.posix.basename(entry.relativePath))]);
  for (const [directory, names] of [[root, rootNames], [local, localNames]] as const) {
    if (scanNoFollowDirectoryDirectMetadata(directory, bounds()).some(entry => !names.has(entry.relativePath))) conflict('external-create');
  }
}

/** One create generation, with recoverable partial visibility. No rollback of
 * live user paths is attempted. The prepared inventory survives lease recovery;
 * unjournaled preparation residue is never adopted by a later invocation. */
export async function publishWorkspaceCreateGeneration(input: Readonly<{
  workspaceRoot: string;
  template: WorkspaceCreateTemplate;
  token: WorkspaceWriteLeaseToken;
  blueprint: WorkspaceTemplateBlueprint;
  testOnlyActor?: RetainedNoFollowFileTransactionTestActor;
}>): Promise<void> {
  const blueprint = snapshotBlueprint(input.blueprint);
  const files = retainNoFollowFileTransaction(input.workspaceRoot, 'Workspace initial generation', input.testOnlyActor);
  try {
    const root = files.rootIdentity;
    const local = inspectNoFollowDirectoryLeaf(root, '.sec', 'Workspace local state');
    if (local === null) conflict('missing-local-state');
    let recorded: RetainedNoFollowFileObservation | null = null;
    const fence = async () => {
      await assertWorkspaceWriteLease(input.workspaceRoot, input.token);
      files.assertCurrent();
      assertSameNoFollowDirectoryIdentity(local, 'Workspace create local state');
      if (recorded !== null) assertCurrentFile(root, JOURNAL, recorded, 'changed-journal');
    };
    await fence();
    const terminal = files.observe(TERMINAL, 'Workspace creation completion');
    recorded = files.observe(JOURNAL, 'Workspace creation journal');
    const recovered = recorded !== null;
    if (terminal !== null) {
      if (recorded === null) conflict('terminal-without-journal');
      const completedJournal = parseJournal(recorded.bytes);
      if (!sameIdentity(root, completedJournal.root) || !sameIdentity(local, completedJournal.localState)) conflict('changed-root');
      // Exact canonical bytes validate the complete terminal schema and its
      // generation/intent binding. A prepared stage cannot coexist with the
      // terminal emitted by this protocol; never let a marker skip recovery.
      if (!Buffer.from(terminal.bytes).equals(completionBytes(completedJournal, recorded))) conflict('invalid-terminal');
      if (directoryAt(root, `.sec/${completedJournal.stageName}`) !== null) conflict('terminal-before-stage-retirement');
      await fence();
      assertCurrentFile(root, TERMINAL, terminal, 'changed-terminal');
      await files.flushExact(JOURNAL, recorded, 'Workspace recovered intent barrier');
      await fence();
      assertCurrentFile(root, TERMINAL, terminal, 'changed-terminal');
      try {
        await files.flushExact(TERMINAL, terminal, 'Workspace recovered terminal barrier');
      } catch (error) {
        throw new CompilerError('WORKSPACE-INIT-003', 'Workspace completion requires lifecycle recovery; existing objects were preserved', { reason: 'terminal-durability' }, { cause: error });
      }
      await fence();
      assertCurrentFile(root, TERMINAL, terminal, 'changed-terminal');
      // A bound historical receipt must not reapply the initial scaffold or
      // require later author files to retain their initial bytes/identities.
      throw new CompilerError('WORKSPACE-INIT-001', 'Workspace is already initialized');
    }
    let journal: Journal;
    if (recorded === null) {
      const residues = scanNoFollowDirectoryDirectMetadata(local, bounds()).filter(entry => entry.relativePath.startsWith(STAGE_PREFIX));
      if (residues.length > 0) conflict('preparation-residue');
      await assertWorkspaceCreateSurfaceEmpty(input.workspaceRoot, input.token);
      await fence();
      const generation = randomUUID();
      const stageName = `${STAGE_PREFIX}${generation}`;
      const stage = createExclusiveNoFollowDirectory(local, stageName);
      const stageFence = async () => { await fence(); assertSameNoFollowDirectoryIdentity(stage, 'Workspace unpublished stage'); };
      try {
        for (const relative of blueprint.directories) {
          await stageFence();
          const parentPath = path.posix.dirname(relative);
          const parent = parentPath === '.' ? stage : directoryAt(stage, parentPath)!;
          createExclusiveNoFollowDirectory(parent, path.posix.basename(relative), undefined, 0o777);
        }
        for (const file of blueprint.files) {
          await stageFence();
          await files.createExclusive(`.sec/${stageName}/${file.relativePath}`, file.bytes, 'Workspace staged file', file.creationMode ?? 0o666);
        }
        await stageFence();
        journal = { schema: SCHEMA, generation, template: input.template, blueprintDigest: blueprintDigest(blueprint), root: identity(root), localState: identity(local), stage: identity(stage), stageName, entries: inventory(stage) };
        assertBlueprint(journal, blueprint);
        // Flush the exact staged files/directories before publishing the intent.
        for (const entry of journal.entries) {
          const relative = `.sec/${stageName}/${entry.relativePath}`;
          if (entry.kind === 'file') {
            const file = files.observe(relative, 'Workspace staged file');
            if (!file) conflict('missing-staged-file');
            await files.flushExact(relative, file, 'Workspace staged file durability');
          } else flushNoFollowDirectory(directoryAt(root, relative)!);
        }
        flushNoFollowDirectory(stage);
        await stageFence();
        recorded = await files.createExclusive(JOURNAL, Buffer.from(formatJsonFile(journal)), 'Workspace prepared generation');
      } catch (error) {
        throw new CompilerError('WORKSPACE-INIT-003', 'Workspace preparation did not complete; preserve its unpublished stage for lifecycle recovery', { reason: 'preparation-residue' }, { cause: error });
      }
    } else journal = parseJournal(recorded.bytes);
    if (!sameIdentity(root, journal.root) || !sameIdentity(local, journal.localState)) conflict('changed-root');
    if (input.template !== journal.template) conflict('template-mismatch');
    assertBlueprint(journal, blueprint);
    const stageRelative = `.sec/${journal.stageName}`;
    const stage = directoryAt(root, stageRelative);
    if (stage !== null && !sameIdentity(stage, journal.stage)) conflict('changed-stage');
    const entries = frontier(journal);
    const readState = (entry: Entry): 'staged' | 'published' => {
      const targetPresent = observeEntry(root, entry.relativePath, entry, journal);
      const sourcePresent = stage === null ? false : observeEntry(root, `${stageRelative}/${entry.relativePath}`, entry, journal);
      if (targetPresent === sourcePresent) conflict(`ambiguous-publication:${entry.relativePath}`);
      return targetPresent ? 'published' : 'staged';
    };
    // Validate every frontier before resuming any remaining effect.
    assertFrontierSurface(root, local, journal);
    for (const entry of entries) readState(entry);
    if (recovered) {
      // Readable intent bytes do not prove that the old attempt crossed
      // either durability barrier. Repair both before any move or retirement.
      await fence();
      await files.flushExact(JOURNAL, recorded, 'Workspace recovered intent barrier');
      await fence();
    }
    for (const entry of entries) {
      await fence();
      assertFrontierSurface(root, local, journal);
      if (readState(entry) === 'published') continue;
      const sourceRelative = `${stageRelative}/${entry.relativePath}`;
      if (entry.kind === 'directory') {
        relocateRetainedNoFollowDirectoryAcrossParents({ directory: directoryAt(root, sourceRelative)!,
          destinationParent: entry.relativePath.startsWith('.sec/') ? local : root,
          tombstoneName: path.posix.basename(entry.relativePath) });
      } else {
        const source = files.observe(sourceRelative, 'Workspace publication source');
        if (!source) conflict('missing-staged-file');
        await files.renameNoReplace(sourceRelative, entry.relativePath, source, 'Workspace exclusive publication');
      }
    }
    await fence();
    assertFrontierSurface(root, local, journal);
    for (const entry of entries) if (readState(entry) !== 'published') conflict('incomplete-publication');
    // Only the staging envelope and empty, journal-bound lease placeholder
    // remain. Empty-directory deletion cannot recursively remove unknown data.
    if (stage !== null) {
      const remaining = inventory(stage);
      const expected = journal.entries.filter(entry => entry.relativePath === '.sec' || entry.relativePath === `.sec/${WORKSPACE_WRITE_LEASE_DIRECTORY_NAME}`);
      if (remaining.some(entry => !expected.some(original => exact(entry, original)))) conflict('unexpected-stage-residue');
      for (const entry of [...remaining].sort((a, b) => b.relativePath.length - a.relativePath.length)) {
        await fence();
        const parentRelative = path.posix.dirname(entry.relativePath);
        const parent = parentRelative === '.' ? stage : directoryAt(stage, parentRelative)!;
        deleteRetainedNoFollowEntry({ root: parent, relativePath: path.posix.basename(entry.relativePath), kind: 'directory', ...identity(entry), ancestorDirectories: [] });
      }
      await fence();
      deleteRetainedNoFollowEntry({ root: local, relativePath: journal.stageName, kind: 'directory', ...journal.stage, ancestorDirectories: [] });
    }
    await fence();
    for (const entry of entries) if (!observeEntry(root, entry.relativePath, entry, journal)) conflict('incomplete-readback');
    // A recovered rename can be visible even when its old attempt never
    // crossed the file/parent barrier. Re-establish durability from this
    // attempt's exact retained destination handles before terminal publication.
    const durability = retainNoFollowFileTransaction(root.path, 'Workspace recovered publication durability', input.testOnlyActor);
    try {
      for (const file of blueprint.files) {
        await fence();
        const current = durability.observe(file.relativePath, 'Workspace recovered destination');
        const expected = journal.entries.find(entry => entry.relativePath === file.relativePath)!;
        if (!current || !sameIdentity(current.identity, expected) || !Buffer.from(current.bytes).equals(file.bytes)) conflict('changed-durability-target');
        await durability.flushExact(file.relativePath, current, 'Workspace recovered file barrier');
      }
      await fence();
      flushNoFollowDirectory(root);
      flushNoFollowDirectory(local);
    } finally { durability.dispose(); }
    await fence();
    assertFrontierSurface(root, local, journal);
    for (const entry of entries) if (!observeEntry(root, entry.relativePath, entry, journal)) conflict('incomplete-readback');
    const completion = completionBytes(journal, recorded);
    const published = await files.createExclusive(TERMINAL, completion, 'Workspace creation completion');
    await fence();
    assertCurrentFile(root, TERMINAL, published, 'terminal-readback');
  } finally { files.dispose(); }
}
