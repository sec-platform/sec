import { createHash } from 'node:crypto';

import { parse as parseYaml } from 'yaml';

export const CodexDevelopmentCurrentStateSchemaV1 = 'sec-current-state-live-v1' as const;
export const CodexDevelopmentActivePointerSchemaV2 = 'sec-active-work-package-pointer-v2' as const;
const CURRENT_STATE_KEYS = ['schema', 'resolver', 'stableFacts'];
const CURRENT_STATE_RESOLVER_KEYS = [
  'command', 'repository', 'remote', 'defaultBranch', 'defaultRef', 'requireRemoteMatch'
];
const ACTIVE_POINTER_KEYS = [
  'selectionMode', 'defaultBranchRef', 'defaultRefFreshness', 'manifest',
  'manifestDigest', 'digestBytes', 'unavailableDefaultRef', 'matchingDefaultBlob'
];
const LIVE_RESOLVER_COMMAND = 'bun scripts/codex/document-control-plane.ts status --json';

export type CodexDevelopmentDefaultRefState = 'fresh' | 'stale' | 'unavailable';
export type CodexDevelopmentActiveWorkPackageResolution =
  | { state: 'active'; manifest: string; manifestDigest: string }
  | { state: 'invalid'; reason: 'candidate-digest-mismatch' }
  | { state: 'none'; reason: 'matching-default-blob' }
  | { state: 'unresolved'; reason: 'default-ref-stale' | 'default-ref-unavailable' };

export interface CodexDevelopmentCurrentStateSpecV1 {
  schema: typeof CodexDevelopmentCurrentStateSchemaV1;
  resolver: {
    command: string;
    repository: string;
    remote: string;
    defaultBranch: string;
    defaultRef: string;
    requireRemoteMatch: boolean;
  };
  stableFacts: Record<string, unknown>;
}

export interface CodexDevelopmentActivePointerV2 {
  schema: typeof CodexDevelopmentActivePointerSchemaV2;
  selectionMode: 'exact-manifest-not-on-default-branch-v1';
  defaultBranchRef: string;
  defaultRefFreshness: 'live-platform-match-required';
  manifest: string;
  manifestDigest: `sha256:${string}`;
  digestBytes: 'git-blob';
  unavailableDefaultRef: 'unresolved';
  matchingDefaultBlob: 'none';
}

export interface CodexDevelopmentRollingPlanV1 {
  activePackageId: string;
  candidatePackageIds: string[];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function repositoryValue(value: unknown, label: string): string {
  const repository = stringValue(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(repository)) {
    throw new Error(`${label} must be one bounded owner/name repository.`);
  }
  return repository;
}

function remoteNameValue(value: unknown, label: string): string {
  const remote = stringValue(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(remote)) {
    throw new Error(`${label} must be one bounded option-safe Git remote name.`);
  }
  return remote;
}

function branchNameValue(value: unknown, label: string): string {
  const branch = stringValue(value, label);
  if (
    branch.length > 255
    || branch === '@'
    || branch.startsWith('-')
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.endsWith('.')
    || branch.includes('..')
    || branch.includes('@{')
    || branch.includes('//')
    || /[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(branch)
    || branch.split('/').some((segment) => segment.startsWith('.') || segment.endsWith('.lock'))
  ) {
    throw new Error(`${label} must be one bounded option-safe Git branch name.`);
  }
  return branch;
}

function manifestPathValue(value: unknown, label: string): string {
  const manifest = stringValue(value, label);
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifest)) {
    throw new Error(`${label} must be one canonical Work Package manifest path.`);
  }
  return manifest;
}

function parseMarkdownFrontmatter(source: string): Record<string, unknown> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new Error('Markdown frontmatter is required.');
  const parsed = parseYaml(match[1]);
  assertRecord(parsed, 'Markdown frontmatter');
  return parsed;
}

function parsePointerBlock(source: string): Record<string, unknown> {
  const matches = [...source.matchAll(/```yaml\r?\n([\s\S]*?)\r?\n```/gu)];
  const [match] = matches;
  if (matches.length !== 1 || !match) {
    throw new Error('Active pointer must contain exactly one YAML selector block.');
  }
  const parsed = parseYaml(match[1]);
  assertRecord(parsed, 'Active pointer YAML block');
  return parsed;
}

export function CodexDevelopmentGitBlobSha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function CodexDevelopmentParseCurrentStateSpecV1(
  source: string
): CodexDevelopmentCurrentStateSpecV1 {
  const parsed = parseYaml(source);
  assertRecord(parsed, 'Current-state spec');
  if (parsed.schema !== CodexDevelopmentCurrentStateSchemaV1) {
    throw new Error(`Current-state schema must be ${CodexDevelopmentCurrentStateSchemaV1}.`);
  }
  assertExactKeys(parsed, CURRENT_STATE_KEYS, 'Current-state spec');
  assertRecord(parsed.resolver, 'Current-state resolver');
  assertExactKeys(parsed.resolver, CURRENT_STATE_RESOLVER_KEYS, 'Current-state resolver');
  assertRecord(parsed.stableFacts, 'Current-state stableFacts');
  const command = stringValue(parsed.resolver.command, 'Current-state resolver.command');
  if (command !== LIVE_RESOLVER_COMMAND) {
    throw new Error('Current-state resolver.command must select the canonical live resolver.');
  }
  const repository = repositoryValue(parsed.resolver.repository, 'Current-state resolver.repository');
  const remote = remoteNameValue(parsed.resolver.remote, 'Current-state resolver.remote');
  const defaultBranch = branchNameValue(parsed.resolver.defaultBranch, 'Current-state resolver.defaultBranch');
  const defaultRef = stringValue(parsed.resolver.defaultRef, 'Current-state resolver.defaultRef');
  if (defaultRef !== `refs/remotes/${remote}/${defaultBranch}`) {
    throw new Error('Current-state resolver.defaultRef must match remote and defaultBranch.');
  }
  const requireRemoteMatch = booleanValue(parsed.resolver.requireRemoteMatch, 'Current-state resolver.requireRemoteMatch');
  if (!requireRemoteMatch) {
    throw new Error('Current-state resolver.requireRemoteMatch must be true.');
  }
  return {
    schema: CodexDevelopmentCurrentStateSchemaV1,
    resolver: { command, repository, remote, defaultBranch, defaultRef, requireRemoteMatch },
    stableFacts: parsed.stableFacts
  };
}

export function CodexDevelopmentParseActivePointerV2(
  source: string
): CodexDevelopmentActivePointerV2 {
  const frontmatter = parseMarkdownFrontmatter(source);
  if (frontmatter.schema !== CodexDevelopmentActivePointerSchemaV2) {
    throw new Error(`Active pointer schema must be ${CodexDevelopmentActivePointerSchemaV2}.`);
  }
  assertExactKeys(frontmatter, ['schema', 'status', 'last-reviewed'], 'Active pointer frontmatter');
  const pointer = parsePointerBlock(source);
  assertExactKeys(pointer, ACTIVE_POINTER_KEYS, 'Active pointer');
  if (frontmatter.status !== 'conditional') {
    throw new Error('Active pointer status must be conditional.');
  }
  if (
    typeof frontmatter['last-reviewed'] !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(frontmatter['last-reviewed'])
  ) {
    throw new Error('Active pointer last-reviewed must be an ISO calendar date.');
  }
  if (pointer.selectionMode !== 'exact-manifest-not-on-default-branch-v1') {
    throw new Error('Active pointer selectionMode is unsupported.');
  }
  if (pointer.defaultRefFreshness !== 'live-platform-match-required') {
    throw new Error('Active pointer must require a live platform-matched default ref.');
  }
  if (pointer.digestBytes !== 'git-blob') {
    throw new Error('Active pointer digestBytes must be git-blob.');
  }
  if (pointer.unavailableDefaultRef !== 'unresolved' || pointer.matchingDefaultBlob !== 'none') {
    throw new Error('Active pointer fail-closed outcomes are invalid.');
  }
  const manifestDigest = stringValue(pointer.manifestDigest, 'Active pointer manifestDigest');
  if (!/^sha256:[0-9a-f]{64}$/u.test(manifestDigest)) {
    throw new Error('Active pointer manifestDigest must be a SHA-256 digest.');
  }
  return {
    schema: CodexDevelopmentActivePointerSchemaV2,
    selectionMode: 'exact-manifest-not-on-default-branch-v1',
    defaultBranchRef: stringValue(pointer.defaultBranchRef, 'Active pointer defaultBranchRef'),
    defaultRefFreshness: 'live-platform-match-required',
    manifest: manifestPathValue(pointer.manifest, 'Active pointer manifest'),
    manifestDigest: manifestDigest as `sha256:${string}`,
    digestBytes: 'git-blob',
    unavailableDefaultRef: 'unresolved',
    matchingDefaultBlob: 'none'
  };
}

export function CodexDevelopmentAssertControlPlaneBindingV1(input: {
  spec: CodexDevelopmentCurrentStateSpecV1;
  pointer: CodexDevelopmentActivePointerV2;
}): void {
  if (input.pointer.defaultBranchRef !== input.spec.resolver.defaultRef) {
    throw new Error('Active pointer defaultBranchRef must match the current-state defaultRef.');
  }
}

export function CodexDevelopmentParseRollingPlanV1(
  source: string
): CodexDevelopmentRollingPlanV1 {
  const activeMarker = '## 当前唯一 Work Package';
  const candidateMarker = '## 候选 Work Package';
  const activeStart = source.indexOf(activeMarker);
  const candidateStart = source.indexOf(candidateMarker);
  if (
    activeStart < 0
    || candidateStart <= activeStart
    || source.indexOf(activeMarker, activeStart + activeMarker.length) >= 0
    || source.indexOf(candidateMarker, candidateStart + candidateMarker.length) >= 0
  ) {
    throw new Error('Rolling plan must contain one active and one candidate section.');
  }
  const nextSectionMatch = /^## (?!候选 Work Package\s*$).+$/gmu;
  nextSectionMatch.lastIndex = candidateStart + candidateMarker.length;
  const nextSection = nextSectionMatch.exec(source);
  const activeSection = source.slice(activeStart + activeMarker.length, candidateStart);
  const candidateSection = source.slice(
    candidateStart + candidateMarker.length,
    nextSection?.index ?? source.length
  );

  const activeHeadings = [...activeSection.matchAll(/^### ([a-z0-9][a-z0-9-]*)\s*$/gmu)];
  if (activeHeadings.length !== 1) {
    throw new Error('Rolling plan must select exactly one active package.');
  }
  const activePackageId = activeHeadings[0]![1]!;
  const candidateHeadings = [...candidateSection.matchAll(
    /^### ([1-9][0-9]*)\. ([a-z0-9][a-z0-9-]*)\s*$/gmu
  )];
  if (candidateHeadings.length < 2 || candidateHeadings.length > 5) {
    throw new Error('Rolling plan must contain two to five candidate packages.');
  }
  for (const [index, heading] of candidateHeadings.entries()) {
    if (Number(heading[1]) !== index + 1) {
      throw new Error('Rolling plan candidate ordinals must be contiguous from one.');
    }
  }
  const candidatePackageIds = candidateHeadings.map((heading) => heading[2]!);
  if (new Set(candidatePackageIds).size !== candidatePackageIds.length) {
    throw new Error('Rolling plan candidate package IDs must be unique.');
  }
  if (candidatePackageIds.includes(activePackageId)) {
    throw new Error('Rolling plan active package cannot also be a candidate.');
  }

  return { activePackageId, candidatePackageIds };
}

export function CodexDevelopmentResolveActiveWorkPackageV1(input: {
  pointer: CodexDevelopmentActivePointerV2;
  candidateManifestBlob: Uint8Array;
  defaultManifestBlob: Uint8Array | null;
  defaultRefState: CodexDevelopmentDefaultRefState;
}): CodexDevelopmentActiveWorkPackageResolution {
  if (input.defaultRefState !== 'fresh') {
    return {
      state: 'unresolved',
      reason: input.defaultRefState === 'stale'
        ? 'default-ref-stale'
        : 'default-ref-unavailable'
    };
  }
  if (CodexDevelopmentGitBlobSha256(input.candidateManifestBlob) !== input.pointer.manifestDigest) {
    return { state: 'invalid', reason: 'candidate-digest-mismatch' };
  }
  if (
    input.defaultManifestBlob !== null
    && CodexDevelopmentGitBlobSha256(input.defaultManifestBlob) === input.pointer.manifestDigest
  ) {
    return { state: 'none', reason: 'matching-default-blob' };
  }
  return { state: 'active', manifest: input.pointer.manifest, manifestDigest: input.pointer.manifestDigest };
}
