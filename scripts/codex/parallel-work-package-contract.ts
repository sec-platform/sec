import { createHash } from 'node:crypto';

export const ParallelWorkPackageSchemaV3 = 'codex-development-work-package-v3' as const;
export const ParallelWorkPackageManifestStateFrozen = 'frozen' as const;

const TOP_LEVEL_KEYS_V3 = [
  'schema', 'id', 'tracking', 'base', 'manifestState',
  'scope', 'relations', 'verification',
  'acceptance', 'completion'
] as const;
const SCOPE_KEYS = ['authorityReads', 'authorityWrites', 'paths', 'resources'] as const;
const SCOPE_PATHS_KEYS = ['owned', 'permitted', 'forbidden'] as const;
const SCOPE_RESOURCES_KEYS = ['exclusive', 'sharedReadOnly'] as const;
const RELATIONS_KEYS = ['requires', 'orderedAfter', 'conflictsWith'] as const;
const VERIFICATION_KEYS = ['policyId'] as const;
const COMPLETION_KEYS = ['cleanup'] as const;

export type ParallelWorkPackageScopePathsV3 = {
  owned: string[];
  permitted: string[];
  forbidden: string[];
};

export type ParallelWorkPackageScopeResourcesV3 = {
  exclusive: string[];
  sharedReadOnly: string[];
};

export type ParallelWorkPackageScopeV3 = {
  authorityReads: string[];
  authorityWrites: string[];
  paths: ParallelWorkPackageScopePathsV3;
  resources: ParallelWorkPackageScopeResourcesV3;
};

export type ParallelWorkPackageRelationsV3 = {
  requires: string[];
  orderedAfter: string[];
  conflictsWith: string[];
};

export type ParallelWorkPackageManifestV3 = {
  schema: typeof ParallelWorkPackageSchemaV3;
  id: string;
  tracking: string;
  base: string;
  manifestState: typeof ParallelWorkPackageManifestStateFrozen;
  scope: ParallelWorkPackageScopeV3;
  relations: ParallelWorkPackageRelationsV3;
  verification: { policyId: string };
  acceptance: string[];
  completion: { cleanup: string[] };
};

export type ParallelConflictClassification =
  | 'parallel-safe'
  | 'ordered'
  | 'write-conflict'
  | 'authority-conflict'
  | 'resource-conflict'
  | 'unresolved';

export type ParallelConflictResult = {
  classification: ParallelConflictClassification;
  reason: string;
  step: number;
};

export type LegacyManifestInput = {
  schema: string;
  id: string;
};

export type ParallelConflictInput =
  | { kind: 'v3'; manifest: ParallelWorkPackageManifestV3 }
  | { kind: 'legacy'; manifest: LegacyManifestInput };

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

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.length === 0) return [];
  return stringArray(value, label);
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
    throw new Error('Work Package manifest exceeds the 128 KiB limit.');
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

export function CodexDevelopmentParseParallelWorkPackageManifestV3(
  source: string,
  expectedPath?: string
): ParallelWorkPackageManifestV3 {
  const raw = parseManifestRaw(source);
  assertExactKeys(raw, TOP_LEVEL_KEYS_V3, 'Parallel Work Package V3 manifest');

  if (raw.schema !== ParallelWorkPackageSchemaV3) {
    throw new Error('Parallel Work Package V3 manifest schema mismatch.');
  }
  const id = stringValue(raw.id, 'Parallel Work Package V3 manifest id');
  assertStableId(id, 'Parallel Work Package V3 manifest id');
  const tracking = stringValue(raw.tracking, 'Parallel Work Package V3 manifest tracking');
  if (tracking !== 'none' && !/^issue-[1-9]\d*$/u.test(tracking)) {
    throw new Error('Parallel Work Package V3 manifest tracking must be `none` or `issue-<positive integer>`.');
  }
  const base = stringValue(raw.base, 'Parallel Work Package V3 manifest base');
  if (!/^[0-9a-f]{40}$/u.test(base)) {
    throw new Error('Parallel Work Package V3 manifest base must be a lowercase 40-character Git SHA.');
  }
  if (raw.manifestState !== ParallelWorkPackageManifestStateFrozen) {
    throw new Error('Parallel Work Package V3 manifest must be frozen.');
  }

  assertPlainObject(raw.scope, 'Parallel Work Package V3 manifest scope');
  assertExactKeys(raw.scope, SCOPE_KEYS, 'Parallel Work Package V3 manifest scope');
  const authorityReads = optionalStringArray(raw.scope.authorityReads, 'Parallel Work Package V3 manifest scope.authorityReads');
  const authorityWrites = stringArray(raw.scope.authorityWrites, 'Parallel Work Package V3 manifest scope.authorityWrites');

  assertPlainObject(raw.scope.paths, 'Parallel Work Package V3 manifest scope.paths');
  assertExactKeys(raw.scope.paths, SCOPE_PATHS_KEYS, 'Parallel Work Package V3 manifest scope.paths');
  const ownedPaths = stringArray(raw.scope.paths.owned, 'Parallel Work Package V3 manifest scope.paths.owned');
  ownedPaths.forEach((ownedPath, index) => assertOwnershipPath(ownedPath, `Parallel Work Package V3 manifest scope.paths.owned[${index}]`));
  const permittedPaths = optionalStringArray(raw.scope.paths.permitted, 'Parallel Work Package V3 manifest scope.paths.permitted');
  permittedPaths.forEach((permittedPath, index) => assertOwnershipPath(permittedPath, `Parallel Work Package V3 manifest scope.paths.permitted[${index}]`));
  const forbiddenPaths = optionalStringArray(raw.scope.paths.forbidden, 'Parallel Work Package V3 manifest scope.paths.forbidden');
  forbiddenPaths.forEach((forbiddenPath, index) => assertOwnershipPath(forbiddenPath, `Parallel Work Package V3 manifest scope.paths.forbidden[${index}]`));

  assertPlainObject(raw.scope.resources, 'Parallel Work Package V3 manifest scope.resources');
  assertExactKeys(raw.scope.resources, SCOPE_RESOURCES_KEYS, 'Parallel Work Package V3 manifest scope.resources');
  const exclusiveResources = optionalStringArray(raw.scope.resources.exclusive, 'Parallel Work Package V3 manifest scope.resources.exclusive');
  const sharedReadOnlyResources = optionalStringArray(raw.scope.resources.sharedReadOnly, 'Parallel Work Package V3 manifest scope.resources.sharedReadOnly');

  const ownedEntries = ownedPaths.map((ownedPath) => ({ path: ownedPath, label: 'owned' }));
  assertNoOverlappingPaths(ownedEntries, 'Parallel Work Package V3 owned paths');
  const forbiddenEntries = forbiddenPaths.map((forbiddenPath) => ({ path: forbiddenPath, label: 'forbidden' }));
  assertNoOverlappingPaths([...ownedEntries, ...forbiddenEntries], 'Parallel Work Package V3 owned/forbidden paths');
  const allScopePaths = [...ownedEntries, ...forbiddenEntries].map((entry) => entry.path);
  const windowsScopeKeys = allScopePaths.map((entry) => entry.toLowerCase());
  if (new Set(windowsScopeKeys).size !== windowsScopeKeys.length) {
    throw new Error('Parallel Work Package V3 paths contain a case-insensitive Windows collision.');
  }

  assertPlainObject(raw.relations, 'Parallel Work Package V3 manifest relations');
  assertExactKeys(raw.relations, RELATIONS_KEYS, 'Parallel Work Package V3 manifest relations');
  const requires = optionalStringArray(raw.relations.requires, 'Parallel Work Package V3 manifest relations.requires');
  const orderedAfter = optionalStringArray(raw.relations.orderedAfter, 'Parallel Work Package V3 manifest relations.orderedAfter');
  const conflictsWith = optionalStringArray(raw.relations.conflictsWith, 'Parallel Work Package V3 manifest relations.conflictsWith');
  requires.forEach((requireId, index) => assertStableId(requireId, `Parallel Work Package V3 manifest relations.requires[${index}]`));
  orderedAfter.forEach((orderedAfterId, index) => assertStableId(orderedAfterId, `Parallel Work Package V3 manifest relations.orderedAfter[${index}]`));
  conflictsWith.forEach((conflictId, index) => assertStableId(conflictId, `Parallel Work Package V3 manifest relations.conflictsWith[${index}]`));

  assertPlainObject(raw.verification, 'Parallel Work Package V3 manifest verification');
  assertExactKeys(raw.verification, VERIFICATION_KEYS, 'Parallel Work Package V3 manifest verification');
  const policyId = stringValue(raw.verification.policyId, 'Parallel Work Package V3 manifest verification.policyId');
  assertStableId(policyId, 'Parallel Work Package V3 manifest verification.policyId');

  const acceptance = stringArray(raw.acceptance, 'Parallel Work Package V3 manifest acceptance');

  assertPlainObject(raw.completion, 'Parallel Work Package V3 manifest completion');
  assertExactKeys(raw.completion, COMPLETION_KEYS, 'Parallel Work Package V3 manifest completion');
  const cleanup = stringArray(raw.completion.cleanup, 'Parallel Work Package V3 manifest completion.cleanup');
  cleanup.forEach((item, index) => {
    if (item !== 'branch' && item !== 'worktree') {
      throw new Error(`Parallel Work Package V3 manifest completion.cleanup[${index}] must be 'branch' or 'worktree'.`);
    }
  });

  const manifest: ParallelWorkPackageManifestV3 = {
    schema: ParallelWorkPackageSchemaV3,
    id,
    tracking,
    base,
    manifestState: ParallelWorkPackageManifestStateFrozen,
    scope: {
      authorityReads,
      authorityWrites,
      paths: { owned: ownedPaths, permitted: permittedPaths, forbidden: forbiddenPaths },
      resources: { exclusive: exclusiveResources, sharedReadOnly: sharedReadOnlyResources }
    },
    relations: { requires, orderedAfter, conflictsWith },
    verification: { policyId },
    acceptance,
    completion: { cleanup }
  };
  const canonicalPath = `docs/work-packages/${manifest.id}.md`;
  if (expectedPath !== undefined && expectedPath !== canonicalPath) {
    throw new Error(`Parallel Work Package V3 manifest ID/path mismatch: expected ${canonicalPath}, received ${expectedPath}.`);
  }
  return manifest;
}

export function ParallelWorkPackageManifestDigest(source: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

export const GLOBAL_EXCLUSIVE_RESOURCE_CLASSES = [
  'package-lock',
  'docs-control-plane',
  'agent-skill-registry',
  'workflow-trust-root',
  'repository-worktree',
  'host-profile',
  'browser-cache-writer',
  'release-publisher',
] as const;

export type GlobalExclusiveResourceClass = typeof GLOBAL_EXCLUSIVE_RESOURCE_CLASSES[number];

export function classifyGlobalExclusiveResource(path: string): GlobalExclusiveResourceClass | null {
  if (
    path === 'package.json'
    || path.endsWith('/package.json')
    || path === 'bun.lock'
    || path.endsWith('/bun.lock')
  ) {
    return 'package-lock';
  }
  if (path === 'docs/work' || path === 'docs/work/' || path.startsWith('docs/work/')) {
    return 'docs-control-plane';
  }
  if (
    path === '.agents/skills'
    || path === '.agents/skills/'
    || path.startsWith('.agents/skills/')
    || path === 'AGENTS.md'
  ) {
    return 'agent-skill-registry';
  }
  if (
    path === '.github/workflows'
    || path === '.github/workflows/'
    || path.startsWith('.github/workflows/')
  ) {
    return 'workflow-trust-root';
  }
  if (path.includes('worktree')) {
    return 'repository-worktree';
  }
  if (path.includes('host-profile')) {
    return 'host-profile';
  }
  if (path.includes('browser-cache')) {
    return 'browser-cache-writer';
  }
  if (path.includes('release')) {
    return 'release-publisher';
  }
  return null;
}

function authoritiesOverlap(left: string[], right: string[]): boolean {
  for (const leftAuthority of left) {
    for (const rightAuthority of right) {
      if (leftAuthority === rightAuthority) return true;
      if (leftAuthority.startsWith(`${rightAuthority}.`) || rightAuthority.startsWith(`${leftAuthority}.`)) return true;
    }
  }
  return false;
}

function resourcesCompatible(left: string, right: string): boolean {
  return left === right;
}

function intersectExact(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => rightSet.has(entry));
}

export function resolveParallelConflict(
  left: ParallelConflictInput,
  right: ParallelConflictInput
): ParallelConflictResult {
  if (left.kind === 'legacy' || right.kind === 'legacy') {
    return { classification: 'unresolved', reason: 'legacy-manifest-missing-parallel-contract', step: 1 };
  }
  const leftManifest = left.manifest;
  const rightManifest = right.manifest;

  if (leftManifest.base !== rightManifest.base) {
    if (
      rightManifest.relations.requires.includes(leftManifest.id)
      || leftManifest.relations.requires.includes(rightManifest.id)
    ) {
      return { classification: 'ordered', reason: 'base-mismatch', step: 1 };
    }
    return { classification: 'unresolved', reason: 'base-mismatch', step: 1 };
  }

  const leftOwned = leftManifest.scope.paths.owned;
  const leftForbidden = leftManifest.scope.paths.forbidden;
  const rightOwned = rightManifest.scope.paths.owned;
  const rightForbidden = rightManifest.scope.paths.forbidden;
  const pathIntersections: string[] = [];
  for (const leftPath of leftOwned) {
    for (const rightPath of rightOwned) {
      if (ownershipPathsOverlap(leftPath, rightPath) || ownershipPathsOverlap(leftPath.toLowerCase(), rightPath.toLowerCase())) {
        pathIntersections.push(`owned/owned: "${leftPath}" ~ "${rightPath}"`);
      }
    }
  }
  for (const leftPath of leftOwned) {
    for (const rightPath of rightForbidden) {
      if (ownershipPathsOverlap(leftPath, rightPath) || ownershipPathsOverlap(leftPath.toLowerCase(), rightPath.toLowerCase())) {
        pathIntersections.push(`left-owned/right-forbidden: "${leftPath}" ~ "${rightPath}"`);
      }
    }
  }
  for (const leftPath of leftForbidden) {
    for (const rightPath of rightOwned) {
      if (ownershipPathsOverlap(leftPath, rightPath) || ownershipPathsOverlap(leftPath.toLowerCase(), rightPath.toLowerCase())) {
        pathIntersections.push(`left-forbidden/right-owned: "${leftPath}" ~ "${rightPath}"`);
      }
    }
  }
  if (pathIntersections.length > 0) {
    return {
      classification: 'write-conflict',
      reason: `path-intersection: ${pathIntersections.join('; ')}`,
      step: 2
    };
  }

  const leftAuthorityWrites = leftManifest.scope.authorityWrites;
  const leftAuthorityReads = leftManifest.scope.authorityReads;
  const rightAuthorityWrites = rightManifest.scope.authorityWrites;
  const rightAuthorityReads = rightManifest.scope.authorityReads;

  const writeWriteOverlap = intersectExact(leftAuthorityWrites, rightAuthorityWrites);
  if (writeWriteOverlap.length > 0) {
    return {
      classification: 'authority-conflict',
      reason: `authority-write-overlap: ${writeWriteOverlap.join(', ')}`,
      step: 3
    };
  }
  const leftWriteRightRead = intersectExact(leftAuthorityWrites, rightAuthorityReads);
  if (leftWriteRightRead.length > 0 && !leftManifest.relations.requires.includes(rightManifest.id)) {
    return {
      classification: 'unresolved',
      reason: `producer/consumer: left writes ${leftWriteRightRead.join(', ')}, right reads`,
      step: 3
    };
  }
  const rightWriteLeftRead = intersectExact(rightAuthorityWrites, leftAuthorityReads);
  if (rightWriteLeftRead.length > 0 && !rightManifest.relations.requires.includes(leftManifest.id)) {
    return {
      classification: 'unresolved',
      reason: `producer/consumer: right writes ${rightWriteLeftRead.join(', ')}, left reads`,
      step: 3
    };
  }

  const leftExclusive = leftManifest.scope.resources.exclusive;
  const leftSharedReadOnly = leftManifest.scope.resources.sharedReadOnly;
  const rightExclusive = rightManifest.scope.resources.exclusive;
  const rightSharedReadOnly = rightManifest.scope.resources.sharedReadOnly;
  for (const leftResource of leftExclusive) {
    if (
      rightExclusive.some((rightResource) => resourcesCompatible(leftResource, rightResource))
      || rightSharedReadOnly.some((rightResource) => resourcesCompatible(leftResource, rightResource))
    ) {
      return {
        classification: 'resource-conflict',
        reason: `exclusive-resource-overlap: ${leftResource}`,
        step: 4
      };
    }
  }
  for (const rightResource of rightExclusive) {
    if (
      leftExclusive.some((leftResource) => resourcesCompatible(rightResource, leftResource))
      || leftSharedReadOnly.some((leftResource) => resourcesCompatible(rightResource, leftResource))
    ) {
      return {
        classification: 'resource-conflict',
        reason: `exclusive-resource-overlap: ${rightResource}`,
        step: 4
      };
    }
  }

  const leftGlobalClasses = new Set<GlobalExclusiveResourceClass>();
  for (const ownedPath of leftOwned) {
    const resourceClass = classifyGlobalExclusiveResource(ownedPath);
    if (resourceClass !== null) leftGlobalClasses.add(resourceClass);
  }
  const rightGlobalClasses = new Set<GlobalExclusiveResourceClass>();
  for (const ownedPath of rightOwned) {
    const resourceClass = classifyGlobalExclusiveResource(ownedPath);
    if (resourceClass !== null) rightGlobalClasses.add(resourceClass);
  }
  for (const resourceClass of leftGlobalClasses) {
    if (rightGlobalClasses.has(resourceClass)) {
      return {
        classification: 'resource-conflict',
        reason: `global-exclusive-resource-class: ${resourceClass}`,
        step: 5
      };
    }
  }

  if (authoritiesOverlap(leftAuthorityWrites, rightAuthorityWrites)) {
    const hasExactWrite = leftAuthorityWrites.some((entry) => rightAuthorityWrites.includes(entry));
    if (hasExactWrite) {
      return {
        classification: 'authority-conflict',
        reason: 'same-authority-writer-declared-by-both',
        step: 6
      };
    }
    return {
      classification: 'authority-conflict',
      reason: 'authority-write-semantic-overlap',
      step: 6
    };
  }

  if (leftManifest.verification.policyId === rightManifest.verification.policyId) {
    return {
      classification: 'unresolved',
      reason: 'shared-verification-policy',
      step: 7
    };
  }

  return { classification: 'parallel-safe', reason: 'no-conflict-detected', step: 7 };
}
