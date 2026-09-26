
import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../../../../assurance/verification/contract/revision.ts';
import { isRepositoryTestModulePath } from '../../../../../contracts/repository-test-path.ts';

const WorkPackageSchema = 'codex-development-work-package-v1' as const;
const WorkPackageManifestStateFrozen = 'frozen' as const;

type CiVerificationRevision = `ci-verification-v${number}`;

type WorkPackageTask = {
  id: string;
  owner: string;
  ownedPaths: string[];
};

export type WorkPackageManifest = {
  schema: typeof WorkPackageSchema;
  id: string;
  tracking: string;
  base: string;
  manifestState: typeof WorkPackageManifestStateFrozen;
  requiredProfile: 'quick' | 'full';
  ciRevision: CiVerificationRevision;
  authorityRefs?: string[];
  tasks: WorkPackageTask[];
  forbiddenPaths: string[];
  acceptance: string[];
  tests: string[];
};

export type WorkPackageOwnershipResult = {
  changedPathOwners: Array<{ path: string; taskId: string; owner: string }>;
};

export type WorkPackageChangedRecord = {
  status: 'added' | 'changed' | 'removed' | 'renamed' | 'copied';
  path: string;
  previousPath?: string;
};

type WorkPackageChangedPathOccurrence = {
  status: WorkPackageChangedRecord['status'];
  path: string;
  role: 'direct' | 'source' | 'destination';
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
const TOP_LEVEL_KEYS_WITH_AUTHORITY_REFS = [...TOP_LEVEL_KEYS, 'authorityRefs'] as const;
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

function documentationIdArray(value: unknown, label: string): string[] {
  const entries = stringArray(value, label);
  entries.forEach((entry, index) => {
    if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(entry)) {
      throw new Error(`${label}[${index}] must be one lowercase document UUID URN.`);
    }
  });
  const canonical = [...entries].sort();
  if (canonical.some((entry, index) => entry !== entries[index])) {
    throw new Error(`${label} must be in canonical code-unit order.`);
  }
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
  return normalized.slice(4, end);
}

function yamlSyntaxWithoutQuotedScalarsOrComments(source: string): string {
  let result = '';
  let quote: "'" | '"' | null = null;
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (comment) {
      if (character === '\n') {
        comment = false;
        result += '\n';
      } else {
        result += ' ';
      }
      continue;
    }
    if (quote === '"') {
      if (character === '\\' && index + 1 < source.length) {
        result += ' ';
        index += 1;
        result += source[index] === '\n' ? '\n' : ' ';
        continue;
      }
      if (character === '"') quote = null;
      result += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote === "'") {
      if (character === "'" && source[index + 1] === "'") {
        result += '  ';
        index += 1;
        continue;
      }
      if (character === "'") quote = null;
      result += character === '\n' ? '\n' : ' ';
      continue;
    }
    const previous = index === 0 ? '\n' : source[index - 1]!;
    const tokenBoundary = index === 0 || /[\s:[{,\-]/u.test(previous);
    if ((character === '"' || character === "'") && tokenBoundary) {
      quote = character;
      result += ' ';
      continue;
    }
    if (character === '#' && (index === 0 || /\s/u.test(previous))) {
      comment = true;
      result += ' ';
      continue;
    }
    result += character;
  }
  if (quote !== null) {
    throw new Error('Work Package manifest YAML is invalid: unterminated quoted scalar.');
  }
  return result;
}

function assertUniqueYamlMappingKey(
  seenKeys: Map<string, Set<string>>,
  context: string,
  key: string
): void {
  const keys = seenKeys.get(context) ?? new Set<string>();
  if (keys.has(key)) {
    throw new Error(`Work Package manifest YAML is invalid: duplicate mapping key "${key}".`);
  }
  keys.add(key);
  seenKeys.set(context, keys);
}

function assertNoDuplicateYamlMappingKeys(source: string): void {
  const frames: Array<{ indent: number; context: string }> = [{ indent: -1, context: '$' }];
  const listItemCounters = new Map<string, number>();
  const seenKeys = new Map<string, Set<string>>();
  for (const line of source.split('\n')) {
    if (line.trim().length === 0) continue;
    const listMapping = /^( *)(?:-\s+)([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/u.exec(line);
    const mapping = /^( *)([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/u.exec(line);
    const matched = listMapping ?? mapping;
    if (!matched) continue;
    const indent = matched[1]!.length;
    while (frames.length > 1 && frames[frames.length - 1]!.indent >= indent) frames.pop();
    const parent = frames[frames.length - 1]!.context;
    const key = matched[2]!;
    const value = matched[3] ?? '';
    if (listMapping) {
      const counterKey = `${parent}@${indent}`;
      const itemIndex = listItemCounters.get(counterKey) ?? 0;
      listItemCounters.set(counterKey, itemIndex + 1);
      const context = `${parent}[${itemIndex}]`;
      assertUniqueYamlMappingKey(seenKeys, context, key);
      frames.push({ indent, context });
      continue;
    }
    const context = indent === 0 ? '$' : parent;
    assertUniqueYamlMappingKey(seenKeys, context, key);
    if (value.trim().length === 0) frames.push({ indent, context: `${context}.${key}` });
  }
}

function assertStrictManifestYamlSyntax(frontmatter: string): void {
  if (/^\s*["'][^"']+["']\s*:/mu.test(frontmatter) || /^\s*\?\s/mu.test(frontmatter)) {
    throw new Error('Work Package manifest YAML complex or quoted mapping keys are forbidden.');
  }
  const syntax = yamlSyntaxWithoutQuotedScalarsOrComments(frontmatter);
  if (syntax.includes('\t')) throw new Error('Work Package manifest YAML tabs are forbidden.');
  if (/^\s*<<\s*:/mu.test(syntax) || /(?:^|[\s,[{])[&*][A-Za-z0-9_-]+/mu.test(syntax)) {
    throw new Error('Work Package manifest YAML anchors, aliases, and merge keys are forbidden.');
  }
  if (/(?:^|[\s,[{,:])![^\s,[\]{}]+/mu.test(syntax)) {
    throw new Error('Work Package manifest explicit YAML tags are forbidden.');
  }
  if (/^(?:\s*(?:-\s*)?|[ ]*[A-Za-z][A-Za-z0-9_-]*:\s*)[\[{]/mu.test(syntax)) {
    throw new Error('Work Package manifest YAML flow collections are forbidden.');
  }
  if (/:\s*[|>][+-]?\s*$/mu.test(syntax) || /^\s*-\s*[|>][+-]?\s*$/mu.test(syntax)) {
    throw new Error('Work Package manifest YAML block scalars are forbidden.');
  }
  assertNoDuplicateYamlMappingKeys(syntax);
}

function parseManifestRaw(source: string): Record<string, unknown> {
  const frontmatter = extractFrontmatter(source);
  assertStrictManifestYamlSyntax(frontmatter);
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(frontmatter);
  } catch (error) {
    throw new Error(`Work Package manifest YAML is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertPlainObject(raw, 'Work Package manifest');
  return raw;
}

export function WorkPackageManifestDigest(source: string | Uint8Array): string {
  return `sha256:${rawSha256Hex(source)}`;
}

export function ParseWorkPackageLocator(body: string): string {
  const locatorLines = body
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => line.startsWith('Work-Package:'));
  if (locatorLines.length !== 1) {
    throw new Error(`PR body must contain exactly one Work-Package locator line; found ${locatorLines.length}.`);
  }
  const match = /^Work-Package: (config\/repository\/work-packages\/([a-z0-9][a-z0-9-]*)\.md)$/u.exec(locatorLines[0]!);
  if (!match) throw new Error('PR Work-Package locator must be exactly `Work-Package: config/repository/work-packages/<id>.md`.');
  return match[1]!;
}

export function DecodeWorkPackageManifest(
  source: string,
  expectedPath?: string
): WorkPackageManifest {
  const raw = parseManifestRaw(source);
  assertExactKeys(
    raw,
    raw.authorityRefs === undefined ? TOP_LEVEL_KEYS : TOP_LEVEL_KEYS_WITH_AUTHORITY_REFS,
    'Work Package manifest'
  );

  const id = stringValue(raw.id, 'Work Package manifest id');
  assertStableId(id, 'Work Package manifest id');
  const tracking = stringValue(raw.tracking, 'Work Package manifest tracking');
  if (tracking !== 'none' && !/^issue-[1-9]\d*$/u.test(tracking)) {
    throw new Error('Work Package manifest tracking must be `none` or `issue-<positive integer>`.');
  }
  const base = stringValue(raw.base, 'Work Package manifest base');
  if (!/^[0-9a-f]{40}$/u.test(base)) throw new Error('Work Package manifest base must be a lowercase 40-character Git SHA.');
  if (raw.schema !== WorkPackageSchema) throw new Error('Work Package manifest schema mismatch.');
  if (raw.manifestState !== WorkPackageManifestStateFrozen) {
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
  const tasks = raw.tasks.map((task, taskIndex): WorkPackageTask => {
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
  tests.forEach((testPath, index) => {
    const label = `Work Package manifest tests[${index}]`;
    assertOwnershipPath(testPath, label);
    if (!isRepositoryTestModulePath(testPath)) {
      throw new Error(`${label} must name one canonical repository test module.`);
    }
  });
  const authorityRefs = raw.authorityRefs === undefined
    ? undefined
    : documentationIdArray(raw.authorityRefs, 'Work Package manifest authorityRefs');
  const manifest: WorkPackageManifest = {
    schema: WorkPackageSchema,
    id,
    tracking,
    base,
    manifestState: WorkPackageManifestStateFrozen,
    requiredProfile: raw.requiredProfile,
    ciRevision: ciRevision as CiVerificationRevision,
    ...(authorityRefs === undefined ? {} : { authorityRefs }),
    tasks,
    forbiddenPaths,
    acceptance,
    tests
  };
  const canonicalPath = `config/repository/work-packages/${manifest.id}.md`;
  if (expectedPath !== undefined && expectedPath !== canonicalPath) {
    throw new Error(`Work Package manifest ID/path mismatch: expected ${canonicalPath}, received ${expectedPath}.`);
  }
  return manifest;
}

export function ParseWorkPackageManifest(
  source: string,
  expectedPath?: string
): WorkPackageManifest {
  const schema = parseManifestRaw(source).schema;
  if (schema === WorkPackageSchema) {
    return AssertCurrentWorkPackageRevision(
      DecodeWorkPackageManifest(source, expectedPath)
    );
  }
  throw new Error('Work Package manifest schema is unsupported.');
}

function AssertCurrentWorkPackageRevision(
  manifest: WorkPackageManifest
): WorkPackageManifest {
  if (manifest.ciRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
    throw new Error('Work Package manifest does not target the current CI verification revision.');
  }
  return manifest;
}

export function ParseCurrentWorkPackageManifest(
  source: string,
  expectedPath?: string
): WorkPackageManifest {
  return ParseWorkPackageManifest(source, expectedPath);
}

export function AssertWorkPackageOwnership(
  manifest: WorkPackageManifest,
  changedPaths: string[]
): WorkPackageOwnershipResult {
  if (changedPaths.length === 0) throw new Error('Work Package ownership requires at least one changed path.');
  if (new Set(changedPaths).size !== changedPaths.length) throw new Error('Changed paths must be unique.');
  const changedPathOwners: WorkPackageOwnershipResult['changedPathOwners'] = [];
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

export function AssertWorkPackageChangedRecords(
  manifest: WorkPackageManifest,
  records: readonly WorkPackageChangedRecord[]
): WorkPackageOwnershipResult {
  if (records.length === 0 || records.length > 3_000) throw new Error('Changed-file records must be non-empty and bounded.');
  const seenRecords = new Set<string>();
  const pathOccurrences = records.flatMap((record, index): WorkPackageChangedPathOccurrence[] => {
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
    if (record.previousPath === record.path) {
      throw new Error(`${label} source and destination paths must differ.`);
    }
    const recordKey = `${record.status}\0${record.previousPath ?? ''}\0${record.path}`;
    if (seenRecords.has(recordKey)) throw new Error(`${label} duplicates an earlier changed-file record.`);
    seenRecords.add(recordKey);
    return record.previousPath === undefined
      ? [{ path: record.path, role: 'direct' as const, status: record.status }]
      : [
          { path: record.previousPath, role: 'source' as const, status: record.status },
          { path: record.path, role: 'destination' as const, status: record.status }
        ];
  });
  const occurrencesByWindowsPath = new Map<string, typeof pathOccurrences>();
  for (const occurrence of pathOccurrences) {
    const windowsPath = occurrence.path.toLowerCase();
    const group = occurrencesByWindowsPath.get(windowsPath) ?? [];
    group.push(occurrence);
    occurrencesByWindowsPath.set(windowsPath, group);
  }
  for (const occurrences of occurrencesByWindowsPath.values()) {
    if (new Set(occurrences.map((occurrence) => occurrence.path)).size !== 1) {
      throw new Error('Changed-file records contain case-insensitive Windows-colliding paths.');
    }
    if (occurrences.length === 1) continue;
    const direct = occurrences.filter((occurrence) => occurrence.role === 'direct');
    const sources = occurrences.filter((occurrence) => occurrence.role === 'source');
    const destinations = occurrences.filter((occurrence) => occurrence.role === 'destination');
    if (
      destinations.length > 0
      || direct.length > 1
      || (
        direct.length === 1
        && (
          direct[0]!.status !== 'changed'
          || sources.length === 0
          || sources.some((occurrence) => occurrence.status !== 'copied')
        )
      )
      || (
        direct.length === 0
        && (
          sources.length !== occurrences.length
          || sources.filter((occurrence) => occurrence.status === 'renamed').length > 1
        )
      )
    ) {
      throw new Error('Changed-file records contain ambiguous duplicate path roles.');
    }
  }
  const flattenedPaths = pathOccurrences.map((occurrence) => occurrence.path);
  const ownership = AssertWorkPackageOwnership(manifest, [...new Set(flattenedPaths)].sort());
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
