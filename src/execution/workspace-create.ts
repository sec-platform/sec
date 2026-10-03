import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import { sha256 } from '../contracts/canonical.ts';
import { CodedFailure } from '../contracts/failure.ts';
import { isCanonicalPortableLogicalPath } from '../contracts/logical-path.ts';
import { workspaceConfigRelativePath } from '../workspace/paths.ts';

export type WorkspaceCreateTemplate = 'minimal' | 'reference-customer';

export interface WorkspaceTemplateFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly creationMode?: number;
  readonly onlyIfAbsent?: true;
}
export interface WorkspaceTemplateBlueprint {
  readonly directories: readonly string[];
  readonly files: readonly WorkspaceTemplateFile[];
}
export interface WorkspaceCreateIntent {
  readonly template: WorkspaceCreateTemplate;
  readonly digest: string;
}

function invalid(reason: string): never {
  throw new CodedFailure('WORKSPACE-INIT-003', 'Workspace creation requires lifecycle recovery; existing objects were preserved', { reason });
}

/** Pure contract owner: each consumer receives its own byte snapshot. No
 * request-supplied digest, mutable array or omitted flush subset is authority. */
export function freezeWorkspaceCreateBlueprint(parts: readonly WorkspaceTemplateBlueprint[]): WorkspaceTemplateBlueprint {
  const directories = new Set<string>();
  const files: WorkspaceTemplateFile[] = [];
  const names = new Set<string>();
  let bytes = 0;
  const admit = (name: string) => {
    if (typeof name !== 'string' || !isCanonicalPortableLogicalPath(name) || name === '.sec/workspace-create.json'
        || name.startsWith('.sec/.workspace-create-') || name.startsWith('.sec/.journal-')
        || name.startsWith('.sec/.sec-journal-') || name.startsWith('.sec/workspace-write-lease/')) invalid('invalid-template-path');
  };
  const ancestors = (name: string) => {
    for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) {
      admit(parent);
      directories.add(parent);
    }
  };
  for (const part of parts) {
    if (!part || !Array.isArray(part.directories) || !Array.isArray(part.files)) invalid('invalid-template-shape');
    for (const name of part.directories) { admit(name); directories.add(name); ancestors(name); }
    for (const file of part.files) {
      if (!file || !(file.bytes instanceof Uint8Array)) invalid('invalid-template-bytes');
      admit(file.relativePath);
      if (file.relativePath === '.sec/workspace-write-lease') invalid('invalid-template-path');
      if (names.has(file.relativePath)) invalid('duplicate-template-file');
      const creationMode = file.creationMode ?? 0o666;
      if (!Number.isSafeInteger(creationMode) || creationMode < 0 || creationMode > 0o777) invalid('invalid-template-mode');
      const owned = Uint8Array.from(file.bytes);
      files.push(Object.freeze({ relativePath: file.relativePath, bytes: owned, creationMode }));
      names.add(file.relativePath); ancestors(file.relativePath); bytes += owned.byteLength;
    }
  }
  if (directories.size + files.length > 2048 || bytes > 16 * 1024 * 1024
      || files.some(file => directories.has(file.relativePath))
      || [workspaceConfigRelativePath, CI_ARTIFACT_FILES.graphLock, CI_ARTIFACT_FILES.verificationReport].some(name => !names.has(name))) invalid('invalid-template-shape');
  return Object.freeze({
    directories: Object.freeze([...directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))),
    files: Object.freeze(files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)))
  });
}

export function snapshotWorkspaceCreateRequest(
  template: WorkspaceCreateTemplate,
  blueprint: WorkspaceTemplateBlueprint,
  suppliedIntent?: WorkspaceCreateIntent
): Readonly<{ blueprint: WorkspaceTemplateBlueprint; intent: WorkspaceCreateIntent }> {
  if (template !== 'minimal' && template !== 'reference-customer') invalid('invalid-template');
  const snapshot = freezeWorkspaceCreateBlueprint([blueprint]);
  const intent = Object.freeze({ template, digest: sha256({ template, directories: snapshot.directories,
    files: snapshot.files.map(file => ({ relativePath: file.relativePath, creationMode: file.creationMode,
      bytes: Buffer.from(file.bytes).toString('hex') })) }) });
  if (suppliedIntent !== undefined && (!suppliedIntent || suppliedIntent.template !== intent.template || suppliedIntent.digest !== intent.digest)) invalid('template-request-mismatch');
  return Object.freeze({ blueprint: snapshot, intent });
}
export type WorkspaceCreateObservation =
  | Readonly<{ phase: 'absent' }>
  | Readonly<{ phase: 'prepared' | 'settling' | 'completed'; intent: WorkspaceCreateIntent }>;

/** The concrete adapter retains native ownership privately. These ports do not
 * turn caller facts into native authority: each effect checks its retained
 * resources and live writer lease again. Unknown preimages reject observation.
 * The application owns phase selection; this session owns bounded physical
 * effects and must settle before the surrounding writer lease is released. */
export interface WorkspaceCreateSession {
  observe(): Promise<WorkspaceCreateObservation>;
  prepare(blueprint: WorkspaceTemplateBlueprint, intent: WorkspaceCreateIntent): Promise<void>;
  resume(blueprint: WorkspaceTemplateBlueprint, intent: WorkspaceCreateIntent): Promise<void>;
  frontier(): readonly string[];
  observePublication(relativePath: string): Promise<'staged' | 'published'>;
  publish(relativePath: string): Promise<void>;
  beginSettlement(): Promise<void>;
  retireStage(): Promise<void>;
  flushPublished(): Promise<void>;
  complete(): Promise<void>;
  readCompleted(blueprint: WorkspaceTemplateBlueprint, intent: WorkspaceCreateIntent): Promise<void>;
  dispose(): void;
}
