import { createHash } from 'node:crypto';

import { parseDocument } from 'yaml';

export const CodexDevelopmentWorkPackageSchemaV1 = 'codex-development-work-package-v1' as const;
export const CodexDevelopmentWorkPackageSchemaV2 = 'codex-development-work-package-v2' as const;
export const CodexDevelopmentWorkPackageManifestStateFrozen = 'frozen' as const;

export type CodexDevelopmentCiVerificationRevision = `ci-verification-v${number}`;

export type CodexDevelopmentWorkPackageTaskV1 = {
  id: string;
  owner: string;
  ownedPaths: string[];
};

export type CodexDevelopmentWorkPackageManifestV1 = {
  schema: typeof CodexDevelopmentWorkPackageSchemaV1;
  id: string;
  tracking: string;
  base: string;
  manifestState: typeof CodexDevelopmentWorkPackageManifestStateFrozen;
  requiredProfile: 'quick' | 'full';
  ciRevision: CodexDevelopmentCiVerificationRevision;
  tasks: CodexDevelopmentWorkPackageTaskV1[];
  forbiddenPaths: string[];
  acceptance: string[];
  tests: string[];
};

export type CodexDevelopmentWorkPackageManifestV2 = {
  schema: typeof CodexDevelopmentWorkPackageSchemaV2;
  id: string;
  tracking: string;
  base: string;
  manifestState: typeof CodexDevelopmentWorkPackageManifestStateFrozen;
  evidenceComposition: { policyId: string };
  tasks: CodexDevelopmentWorkPackageTaskV1[];
  forbiddenPaths: string[];
  acceptance: string[];
};

export type CodexDevelopmentWorkPackageManifest =
  | CodexDevelopmentWorkPackageManifestV1
  | CodexDevelopmentWorkPackageManifestV2;

export type CodexDevelopmentWorkPackageOwnershipResult = {
  changedPathOwners: Array<{ path: string; taskId: string; owner: string }>;
};

export type CodexDevelopmentWorkPackageChangedRecordV1 = {
  status: 'added' | 'changed' | 'removed' | 'renamed' | 'copied';
  path: string;
  previousPath?: string;
};

const TOP_LEVEL_KEYS = [
  'schema',
  'id',
  'tracking',
  'base',
  'manifestState',
  'requiredProfile',
  'ciRevision',
  'tasks',
  'forbiddenPaths',
  'acceptance',
  'tests'
] as const;
const TOP_LEVEL_KEYS_V2 = [
  'schema',
  'id',
  'tracking',
  'base',
  'manifestState',
  'evidenceComposition',
  'tasks',
  'forbiddenPaths',
  'acceptance'
] as const;
const EVIDENCE_COMPOSITION_KEYS = ['policyId'] as const;

const TASK_KEYS = ['id', 'owner', 'ownedPaths'] as const;

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}; received: ${actual.join(', ')}.`);
  }
}

function stringValue(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 4_096
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    throw new Error(`${label} must be a non-empty trimmed control-character-free string.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) {
    throw new Error(`${label} must be a non-empty bounded array.`);
  }
  const entries = value.map((entry, index) => stringValue(entry, `${label}[${index}]`));
  if (new Set(entries).size !== entries.length) throw new Error(`${label} contains duplicate entries.`);
  return entries;
}

function assertStableId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) throw new Error(`${label} must be a lowercase kebab-case ID.`);
}

function assertOwnershipPath(value: string, label: string): void {
  stringValue(value, label);
  const pathWithoutDirectoryMarker = value.endsWith('/') ? value.slice(0, -1) : value;
  const segments = pathWithoutDirectoryMarker.split('/');
  if (
    value.includes('\\')
    || value.startsWith('/')
    || value.startsWith('./')
    || value.includes('//')
    || pathWithoutDirectoryMarker.length === 0
    || pathWithoutDirectoryMarker.split('/').some((segment) => segment === '.' || segment === '..' || segment.length === 0)
    || /[*?{}\u0000]/u.test(value)
    || /(?:^|[/])(?:@|!|\+|\?|\*)\(/u.test(value)
    || segments.some((segment) => (
      segment.endsWith('.')
      || segment.endsWith(' ')
      || segment.includes(':')
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment)
    ))
  ) {
    throw new Error(`${label} must be a normalized POSIX exact file or trailing-slash directory path.`);
  }
}

function ownershipPathMatches(pattern: string, changedPath: string): boolean {
  return pattern.endsWith('/') ? changedPath.startsWith(pattern) : changedPath === pattern;
}

function ownershipPathsOverlap(left: string, right: string): boolean {
  return ownershipPathMatches(left, right) || ownershipPathMatches(right, left);
}

function assertNoOverlappingPaths(entries: Array<{ path: string; label: string }>, groupLabel: string): void {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex]!;
      const right = entries[rightIndex]!;
      if (
        ownershipPathsOverlap(left.path, right.path)
        || ownershipPathsOverlap(left.path.toLowerCase(), right.path.toLowerCase())
      ) {
        throw new Error(`${groupLabel} overlap: ${left.label} "${left.path}" and ${right.label} "${right.path}".`);
      }
    }
  }
}

function extractFrontmatter(source: string): string {
  if (Buffer.byteLength(source, 'utf8') > 131_072 || source.length > 131_072) {
    throw new Error('Work Package manifest exceeds the 128 KiB V1 limit.');
  }
  const normalized = source.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) throw new Error('Work Package manifest must begin with frontmatter.');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('Work Package manifest frontmatter is unterminated.');
  const frontmatter = normalized.slice(4, end);
  if (/^\s*<<\s*:/mu.test(frontmatter) || /(?:^|[\s,[{])[&*][A-Za-z0-9_-]+/mu.test(frontmatter)) {
    throw new Error('Work Package manifest YAML anchors, aliases, and merge keys are forbidden.');
  }
  return frontmatter;
}

function assertNoExplicitYamlTags(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const value = node as { tag?: unknown; items?: unknown[]; key?: unknown; value?: unknown };
  if (typeof value.tag === 'string' && value.tag.length > 0) {
    throw new Error(`Work Package manifest explicit YAML tags are forbidden: ${value.tag}.`);
  }
  if (Array.isArray(value.items)) value.items.forEach(assertNoExplicitYamlTags);
  if (value.key !== undefined) assertNoExplicitYamlTags(value.key);
  if (value.value !== undefined) assertNoExplicitYamlTags(value.value);
}

function parseManifestRaw(source: string): Record<string, unknown> {
  const document = parseDocument(extractFrontmatter(source), {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true
  });
  assertNoExplicitYamlTags(document.contents);
  if (document.errors.length > 0 || document.warnings.length > 0) {
    const diagnostics = [...document.errors, ...document.warnings].map((error) => error.message).join('; ');
    throw new Error(`Work Package manifest YAML is invalid: ${diagnostics}`);
  }

  let raw: unknown;
  try {
    raw = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`Work Package manifest aliases are forbidden: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertPlainObject(raw, 'Work Package manifest');
  return raw;
}

export function CodexDevelopmentWorkPackageManifestDigest(source: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

export function CodexDevelopmentParseWorkPackageLocator(body: string): string {
  const locatorLines = body
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => line.startsWith('Work-Package:'));
  if (locatorLines.length !== 1) {
    throw new Error(`PR body must contain exactly one Work-Package locator line; found ${locatorLines.length}.`);
  }
  const match = /^Work-Package: (docs\/work-packages\/([a-z0-9][a-z0-9-]*)\.md)$/u.exec(locatorLines[0]!);
  if (!match) throw new Error('PR Work-Package locator must be exactly `Work-Package: docs/work-packages/<id>.md`.');
  return match[1]!;
}

export function CodexDevelopmentParseWorkPackageManifestV1(
  source: string,
  expectedPath?: string
): CodexDevelopmentWorkPackageManifestV1 {
  const raw = parseManifestRaw(source);
  assertExactKeys(raw, TOP_LEVEL_KEYS, 'Work Package manifest');

  const id = stringValue(raw.id, 'Work Package manifest id');
  assertStableId(id, 'Work Package manifest id');
  const tracking = stringValue(raw.tracking, 'Work Package manifest tracking');
  if (tracking !== 'none' && !/^issue-[1-9]\d*$/u.test(tracking)) {
    throw new Error('Work Package manifest tracking must be `none` or `issue-<positive integer>`.');
  }
  const base = stringValue(raw.base, 'Work Package manifest base');
  if (!/^[0-9a-f]{40}$/u.test(base)) throw new Error('Work Package manifest base must be a lowercase 40-character Git SHA.');
  if (raw.schema !== CodexDevelopmentWorkPackageSchemaV1) throw new Error('Work Package manifest schema mismatch.');
  if (raw.manifestState !== CodexDevelopmentWorkPackageManifestStateFrozen) {
    throw new Error('Work Package manifest must be frozen.');
  }
  if (raw.requiredProfile !== 'quick' && raw.requiredProfile !== 'full') {
    throw new Error('Work Package manifest requiredProfile must be quick or full.');
  }
  const ciRevision = stringValue(raw.ciRevision, 'Work Package manifest ciRevision');
  if (!/^ci-verification-v[1-9]\d*$/u.test(ciRevision)) {
    throw new Error('Work Package manifest ciRevision must be a stable positive verification revision.');
  }

  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0 || raw.tasks.length > 32) {
    throw new Error('Work Package manifest tasks must be a non-empty bounded array.');
  }
  const tasks = raw.tasks.map((task, taskIndex): CodexDevelopmentWorkPackageTaskV1 => {
    const label = `Work Package manifest tasks[${taskIndex}]`;
    assertPlainObject(task, label);
    assertExactKeys(task, TASK_KEYS, label);
    const taskId = stringValue(task.id, `${label}.id`);
    const owner = stringValue(task.owner, `${label}.owner`);
    assertStableId(taskId, `${label}.id`);
    assertStableId(owner, `${label}.owner`);
    const ownedPaths = stringArray(task.ownedPaths, `${label}.ownedPaths`);
    ownedPaths.forEach((ownedPath, index) => assertOwnershipPath(ownedPath, `${label}.ownedPaths[${index}]`));
    return { id: taskId, owner, ownedPaths };
  });
  const taskIds = tasks.map((task) => task.id);
  if (new Set(taskIds).size !== taskIds.length) throw new Error('Work Package manifest task IDs must be unique.');
  const ownedEntries = tasks.flatMap((task) => task.ownedPaths.map((ownedPath) => ({
    path: ownedPath,
    label: `${task.id}/${task.owner}`
  })));
  assertNoOverlappingPaths(ownedEntries, 'Work Package owned paths');

  const forbiddenPaths = stringArray(raw.forbiddenPaths, 'Work Package manifest forbiddenPaths');
  forbiddenPaths.forEach((forbiddenPath, index) => assertOwnershipPath(forbiddenPath, `forbiddenPaths[${index}]`));
  const forbiddenEntries = forbiddenPaths.map((forbiddenPath) => ({ path: forbiddenPath, label: 'forbidden' }));
  assertNoOverlappingPaths(forbiddenEntries, 'Work Package forbidden paths');
  assertNoOverlappingPaths([...ownedEntries, ...forbiddenEntries], 'Work Package owned/forbidden paths');
  const allPaths = [...ownedEntries, ...forbiddenEntries].map((entry) => entry.path);
  const windowsKeys = allPaths.map((entry) => entry.toLowerCase());
  if (new Set(windowsKeys).size !== windowsKeys.length) {
    throw new Error('Work Package paths contain a case-insensitive Windows collision.');
  }

  const acceptance = stringArray(raw.acceptance, 'Work Package manifest acceptance');
  const tests = stringArray(raw.tests, 'Work Package manifest tests');
  const manifest: CodexDevelopmentWorkPackageManifestV1 = {
    schema: CodexDevelopmentWorkPackageSchemaV1,
    id,
    tracking,
    base,
    manifestState: CodexDevelopmentWorkPackageManifestStateFrozen,
    requiredProfile: raw.requiredProfile,
    ciRevision: ciRevision as CodexDevelopmentCiVerificationRevision,
    tasks,
    forbiddenPaths,
    acceptance,
    tests
  };
  const canonicalPath = `docs/work-packages/${manifest.id}.md`;
  if (expectedPath !== undefined && expectedPath !== canonicalPath) {
    throw new Error(`Work Package manifest ID/path mismatch: expected ${canonicalPath}, received ${expectedPath}.`);
  }
  return manifest;
}

export function CodexDevelopmentParseWorkPackageManifestV2(
  source: string,
  expectedPath?: string
): CodexDevelopmentWorkPackageManifestV2 {
  const raw = parseManifestRaw(source);
  assertExactKeys(raw, TOP_LEVEL_KEYS_V2, 'Work Package V2 manifest');
  if (raw.schema !== CodexDevelopmentWorkPackageSchemaV2) throw new Error('Work Package V2 manifest schema mismatch.');
  const id = stringValue(raw.id, 'Work Package V2 manifest id');
  assertStableId(id, 'Work Package V2 manifest id');
  const tracking = stringValue(raw.tracking, 'Work Package V2 manifest tracking');
  if (tracking !== 'none' && !/^issue-[1-9]\d*$/u.test(tracking)) {
    throw new Error('Work Package V2 manifest tracking must be `none` or `issue-<positive integer>`.');
  }
  const base = stringValue(raw.base, 'Work Package V2 manifest base');
  if (!/^[0-9a-f]{40}$/u.test(base)) throw new Error('Work Package V2 manifest base must be a lowercase 40-character Git SHA.');
  if (raw.manifestState !== CodexDevelopmentWorkPackageManifestStateFrozen) {
    throw new Error('Work Package V2 manifest must be frozen.');
  }
  assertPlainObject(raw.evidenceComposition, 'Work Package V2 manifest evidenceComposition');
  assertExactKeys(
    raw.evidenceComposition,
    EVIDENCE_COMPOSITION_KEYS,
    'Work Package V2 manifest evidenceComposition'
  );
  const policyId = stringValue(
    raw.evidenceComposition.policyId,
    'Work Package V2 manifest evidenceComposition.policyId'
  );
  assertStableId(policyId, 'Work Package V2 manifest evidenceComposition.policyId');

  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0 || raw.tasks.length > 32) {
    throw new Error('Work Package V2 manifest tasks must be a non-empty bounded array.');
  }
  const tasks = raw.tasks.map((task, taskIndex): CodexDevelopmentWorkPackageTaskV1 => {
    const label = `Work Package V2 manifest tasks[${taskIndex}]`;
    assertPlainObject(task, label);
    assertExactKeys(task, TASK_KEYS, label);
    const taskId = stringValue(task.id, `${label}.id`);
    const owner = stringValue(task.owner, `${label}.owner`);
    assertStableId(taskId, `${label}.id`);
    assertStableId(owner, `${label}.owner`);
    const ownedPaths = stringArray(task.ownedPaths, `${label}.ownedPaths`);
    ownedPaths.forEach((ownedPath, index) => assertOwnershipPath(ownedPath, `${label}.ownedPaths[${index}]`));
    return { id: taskId, owner, ownedPaths };
  });
  const taskIds = tasks.map((task) => task.id);
  if (new Set(taskIds).size !== taskIds.length) throw new Error('Work Package V2 manifest task IDs must be unique.');
  const ownedEntries = tasks.flatMap((task) => task.ownedPaths.map((ownedPath) => ({
    path: ownedPath,
    label: `${task.id}/${task.owner}`
  })));
  assertNoOverlappingPaths(ownedEntries, 'Work Package V2 owned paths');
  const forbiddenPaths = stringArray(raw.forbiddenPaths, 'Work Package V2 manifest forbiddenPaths');
  forbiddenPaths.forEach((forbiddenPath, index) => assertOwnershipPath(forbiddenPath, `forbiddenPaths[${index}]`));
  const forbiddenEntries = forbiddenPaths.map((forbiddenPath) => ({ path: forbiddenPath, label: 'forbidden' }));
  assertNoOverlappingPaths(forbiddenEntries, 'Work Package V2 forbidden paths');
  assertNoOverlappingPaths([...ownedEntries, ...forbiddenEntries], 'Work Package V2 owned/forbidden paths');
  const allPaths = [...ownedEntries, ...forbiddenEntries].map((entry) => entry.path);
  const windowsKeys = allPaths.map((entry) => entry.toLowerCase());
  if (new Set(windowsKeys).size !== windowsKeys.length) {
    throw new Error('Work Package V2 paths contain a case-insensitive Windows collision.');
  }
  const acceptance = stringArray(raw.acceptance, 'Work Package V2 manifest acceptance');
  const manifest: CodexDevelopmentWorkPackageManifestV2 = {
    schema: CodexDevelopmentWorkPackageSchemaV2,
    id,
    tracking,
    base,
    manifestState: CodexDevelopmentWorkPackageManifestStateFrozen,
    evidenceComposition: { policyId },
    tasks,
    forbiddenPaths,
    acceptance
  };
  const canonicalPath = `docs/work-packages/${manifest.id}.md`;
  if (expectedPath !== undefined && expectedPath !== canonicalPath) {
    throw new Error(`Work Package V2 manifest ID/path mismatch: expected ${canonicalPath}, received ${expectedPath}.`);
  }
  return manifest;
}

export function CodexDevelopmentParseWorkPackageManifest(
  source: string,
  expectedPath?: string
): CodexDevelopmentWorkPackageManifest {
  const schema = parseManifestRaw(source).schema;
  if (schema === CodexDevelopmentWorkPackageSchemaV1) {
    return CodexDevelopmentParseWorkPackageManifestV1(source, expectedPath);
  }
  if (schema === CodexDevelopmentWorkPackageSchemaV2) {
    return CodexDevelopmentParseWorkPackageManifestV2(source, expectedPath);
  }
  throw new Error('Work Package manifest schema is unsupported.');
}

export function CodexDevelopmentAssertWorkPackageOwnership(
  manifest: CodexDevelopmentWorkPackageManifest,
  changedPaths: string[]
): CodexDevelopmentWorkPackageOwnershipResult {
  if (changedPaths.length === 0) throw new Error('Work Package ownership requires at least one changed path.');
  if (new Set(changedPaths).size !== changedPaths.length) throw new Error('Changed paths must be unique.');
  const changedPathOwners: CodexDevelopmentWorkPackageOwnershipResult['changedPathOwners'] = [];
  for (const changedPath of changedPaths) {
    assertOwnershipPath(changedPath, `changed path "${changedPath}"`);
    if (manifest.forbiddenPaths.some((forbiddenPath) => ownershipPathMatches(forbiddenPath, changedPath))) {
      throw new Error(`Changed path is forbidden by the Work Package: ${changedPath}.`);
    }
    const matches = manifest.tasks.flatMap((task) => (
      task.ownedPaths.some((ownedPath) => ownershipPathMatches(ownedPath, changedPath))
        ? [{ path: changedPath, taskId: task.id, owner: task.owner }]
        : []
    ));
    if (matches.length !== 1) {
      throw new Error(`Changed path must match exactly one Work Package task owner: ${changedPath}; matched ${matches.length}.`);
    }
    changedPathOwners.push(matches[0]!);
  }
  return { changedPathOwners };
}

export function CodexDevelopmentAssertWorkPackageChangedRecords(
  manifest: CodexDevelopmentWorkPackageManifest,
  records: CodexDevelopmentWorkPackageChangedRecordV1[]
): CodexDevelopmentWorkPackageOwnershipResult {
  if (records.length === 0 || records.length > 3_000) throw new Error('Changed-file records must be non-empty and bounded.');
  const flattenedPaths = records.flatMap((record, index) => {
    const label = `changed-file records[${index}]`;
    assertPlainObject(record, label);
    if (!['added', 'changed', 'removed', 'renamed', 'copied'].includes(record.status)) {
      throw new Error(`${label}.status is invalid.`);
    }
    const paired = record.status === 'renamed' || record.status === 'copied';
    assertExactKeys(record, paired ? ['status', 'path', 'previousPath'] : ['status', 'path'], label);
    assertOwnershipPath(record.path, `${label}.path`);
    if (paired !== (record.previousPath !== undefined)) {
      throw new Error(`${label} rename/copy shape is invalid.`);
    }
    if (record.previousPath !== undefined) assertOwnershipPath(record.previousPath, `${label}.previousPath`);
    return record.previousPath === undefined ? [record.path] : [record.previousPath, record.path];
  });
  const windowsKeys = flattenedPaths.map((changedPath) => changedPath.toLowerCase());
  if (new Set(windowsKeys).size !== windowsKeys.length) {
    throw new Error('Changed-file records contain duplicate or case-insensitive Windows-colliding paths.');
  }
  const ownership = CodexDevelopmentAssertWorkPackageOwnership(manifest, [...new Set(flattenedPaths)].sort());
  const ownerByPath = new Map(ownership.changedPathOwners.map((entry) => [entry.path, entry.taskId]));
  for (const record of records) {
    if (
      record.previousPath !== undefined
      && ownerByPath.get(record.previousPath) !== ownerByPath.get(record.path)
    ) {
      throw new Error(`Cross-task ${record.status} is forbidden: ${record.previousPath} -> ${record.path}.`);
    }
  }
  return ownership;
}
