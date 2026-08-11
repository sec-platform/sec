import { parse as parseYaml } from 'yaml';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest,
  type CodexDevelopmentWorkPackageManifest
} from './work-package-contract.ts';

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
  | {
      state: 'invalid';
      reason: 'candidate-digest-mismatch' | 'manifest-path-already-on-default';
    }
  | { state: 'none'; reason: 'matching-default-blob' }
  | {
      state: 'unresolved';
      reason:
        | 'default-ref-stale'
        | 'default-ref-unavailable'
        | 'activation-in-progress'
        | 'activation-observation-raced';
    };

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

export const CodexDevelopmentDocumentControlRecoveryTargetKeysV1 = Object.freeze([
  'freeze-journal',
  'git-index',
  'active-pointer',
  'rolling-plan'
] as const);

export type CodexDevelopmentDocumentControlRecoveryTargetKeyV1 =
  typeof CodexDevelopmentDocumentControlRecoveryTargetKeysV1[number];

/**
 * Stable recovery namespace identity. Physical paths remain effect-time safety
 * inputs and are deliberately excluded from this semantic key.
 */
export function CodexDevelopmentDocumentControlRecoveryEntryStemV1(input: Readonly<{
  operationId: string;
  targetKey: CodexDevelopmentDocumentControlRecoveryTargetKeyV1;
}>): `.entry-${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.operationId)) {
    throw new Error('Document-control recovery operationId must be one SHA-256 digest.');
  }
  if (!CodexDevelopmentDocumentControlRecoveryTargetKeysV1.includes(input.targetKey)) {
    throw new Error('Document-control recovery targetKey is outside the closed target set.');
  }
  const identity = sha256({
    schema: 'sec-document-control-entry-recovery-key-v2',
    operationId: input.operationId,
    targetKey: input.targetKey
  }).slice('sha256:'.length);
  return `.entry-${identity}`;
}

export function CodexDevelopmentClassifyTerminalRetirementPrefixV1(
  presence: readonly boolean[]
): Readonly<
  | { status: 'valid'; deletedPrefixCount: number }
  | { status: 'invalid'; reason: 'non-prefix-hole' }
> {
  if (presence.length === 0 || presence.length > 1_024
      || presence.some((value) => typeof value !== 'boolean')) {
    throw new Error('Terminal retirement presence must be one non-empty bounded boolean sequence.');
  }
  const firstPresent = presence.findIndex(Boolean);
  if (firstPresent < 0) {
    return Object.freeze({ status: 'valid', deletedPrefixCount: presence.length });
  }
  if (presence.slice(firstPresent).some((value) => !value)) {
    return Object.freeze({ status: 'invalid', reason: 'non-prefix-hole' });
  }
  return Object.freeze({ status: 'valid', deletedPrefixCount: firstPresent });
}

/** Pure platform-neutral vocabulary for the initially-absent T/N/R recovery tuple. */
export type CodexDevelopmentInitiallyAbsentTuplePlatformV1 = 'win32' | 'linux';
export type CodexDevelopmentInitiallyAbsentTupleByteClassV1 = 'absent' | 'exact-next' | 'unknown';
export type CodexDevelopmentInitiallyAbsentTupleStateV1 =
  | 'win32-w0' | 'win32-w1' | 'win32-w2'
  | 'linux-l0' | 'linux-l1' | 'linux-l2' | 'linux-l3';
export type CodexDevelopmentInitiallyAbsentTupleInvalidReasonV1 =
  | 'unsupported-platform'
  | 'malformed-observation'
  | 'unknown-bytes'
  | 'illegal-topology'
  | 'identity-mismatch';
export type CodexDevelopmentInitiallyAbsentTupleEdgeV1 =
  | 'win32-w0->win32-w1'
  | 'win32-w1->win32-w2'
  | 'linux-l0->linux-l1'
  | 'linux-l1->linux-l2'
  | 'linux-l2->linux-l3';

export interface CodexDevelopmentInitiallyAbsentTupleEntryV1 {
  readonly byteClass: CodexDevelopmentInitiallyAbsentTupleByteClassV1;
  /** Adapter-provided opaque identity. The contract only compares the string. */
  readonly identity: string | null;
}

export interface CodexDevelopmentInitiallyAbsentTupleV1 {
  readonly target: CodexDevelopmentInitiallyAbsentTupleEntryV1;
  readonly next: CodexDevelopmentInitiallyAbsentTupleEntryV1;
  readonly retiredNext: CodexDevelopmentInitiallyAbsentTupleEntryV1;
}

export type CodexDevelopmentInitiallyAbsentTupleResolutionV1 =
  | Readonly<{ status: 'legal'; state: CodexDevelopmentInitiallyAbsentTupleStateV1 }>
  | Readonly<{ status: 'invalid'; reason: CodexDevelopmentInitiallyAbsentTupleInvalidReasonV1 }>;

const InitiallyAbsentTupleKeysV1 = ['target', 'next', 'retiredNext'] as const;
const InitiallyAbsentTupleEntryKeysV1 = ['byteClass', 'identity'] as const;

function initiallyAbsentExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function initiallyAbsentMalformedTuple(tuple: unknown): boolean {
  if (!initiallyAbsentExactKeys(tuple, InitiallyAbsentTupleKeysV1)) return true;
  return InitiallyAbsentTupleKeysV1.some((key) => {
    const entry = tuple[key];
    if (!initiallyAbsentExactKeys(entry, InitiallyAbsentTupleEntryKeysV1)) return true;
    const byteClass = entry.byteClass;
    const identity = entry.identity;
    if (byteClass !== 'absent' && byteClass !== 'exact-next' && byteClass !== 'unknown') return true;
    if (identity !== null && typeof identity !== 'string') return true;
    if ((byteClass === 'exact-next' || byteClass === 'unknown') && identity === '') return true;
    return (byteClass === 'absent') !== (identity === null);
  });
}

function initiallyAbsentInvalid(
  reason: CodexDevelopmentInitiallyAbsentTupleInvalidReasonV1
): CodexDevelopmentInitiallyAbsentTupleResolutionV1 {
  return Object.freeze({ status: 'invalid', reason });
}

function initiallyAbsentLegal(
  state: CodexDevelopmentInitiallyAbsentTupleStateV1
): CodexDevelopmentInitiallyAbsentTupleResolutionV1 {
  return Object.freeze({ status: 'legal', state });
}

/**
 * Sole pure grammar for initial publication. Invalid reasons are selected in
 * the declared order: platform, observation shape, bytes, topology, identity.
 */
export function CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1(
  input: Readonly<{
    platform: CodexDevelopmentInitiallyAbsentTuplePlatformV1;
    tuple: CodexDevelopmentInitiallyAbsentTupleV1;
  }>
): CodexDevelopmentInitiallyAbsentTupleResolutionV1 {
  const rawInput = input !== null && typeof input === 'object'
    ? input as unknown as Record<string, unknown>
    : {};
  if (rawInput.platform !== 'win32' && rawInput.platform !== 'linux') {
    return initiallyAbsentInvalid('unsupported-platform');
  }
  if (initiallyAbsentMalformedTuple(rawInput.tuple)) {
    return initiallyAbsentInvalid('malformed-observation');
  }
  const tuple = rawInput.tuple as CodexDevelopmentInitiallyAbsentTupleV1;
  const { target, next, retiredNext } = tuple;
  if ([target, next, retiredNext].some((entry) => entry.byteClass === 'unknown')) {
    return initiallyAbsentInvalid('unknown-bytes');
  }
  const topology = [target.byteClass, next.byteClass, retiredNext.byteClass].join('/');
  if (rawInput.platform === 'win32') {
    if (topology === 'absent/absent/absent') return initiallyAbsentLegal('win32-w0');
    if (topology === 'absent/exact-next/absent') return initiallyAbsentLegal('win32-w1');
    if (topology === 'exact-next/absent/absent') return initiallyAbsentLegal('win32-w2');
    return initiallyAbsentInvalid('illegal-topology');
  }
  if (topology === 'absent/absent/absent') return initiallyAbsentLegal('linux-l0');
  if (topology === 'absent/exact-next/absent') return initiallyAbsentLegal('linux-l1');
  if (topology === 'exact-next/exact-next/absent') {
    return target.identity === next.identity
      ? initiallyAbsentLegal('linux-l2')
      : initiallyAbsentInvalid('identity-mismatch');
  }
  if (topology === 'exact-next/absent/exact-next') {
    return target.identity === retiredNext.identity
      ? initiallyAbsentLegal('linux-l3')
      : initiallyAbsentInvalid('identity-mismatch');
  }
  return initiallyAbsentInvalid('illegal-topology');
}

/** Validates one explicitly selected adjacent edge and its cross-observation object continuity. */
export function CodexDevelopmentAssertInitiallyAbsentEntryTransitionV1(input: Readonly<{
  platform: CodexDevelopmentInitiallyAbsentTuplePlatformV1;
  predecessor: CodexDevelopmentInitiallyAbsentTupleV1;
  successor: CodexDevelopmentInitiallyAbsentTupleV1;
  expectedEdge: CodexDevelopmentInitiallyAbsentTupleEdgeV1;
}>): CodexDevelopmentInitiallyAbsentTupleResolutionV1 {
  const predecessor = CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({
    platform: input.platform,
    tuple: input.predecessor
  });
  if (predecessor.status === 'invalid') return predecessor;
  const successor = CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({
    platform: input.platform,
    tuple: input.successor
  });
  if (successor.status === 'invalid') return successor;
  const actualEdge = `${predecessor.state}->${successor.state}`;
  if (actualEdge !== input.expectedEdge) return initiallyAbsentInvalid('illegal-topology');
  const { predecessor: before, successor: after } = input;
  switch (input.expectedEdge) {
    case 'win32-w0->win32-w1':
    case 'linux-l0->linux-l1':
      return successor;
    case 'win32-w1->win32-w2':
    case 'linux-l1->linux-l2':
      return before.next.identity === after.target.identity
        ? successor
        : initiallyAbsentInvalid('identity-mismatch');
    case 'linux-l2->linux-l3':
      return before.target.identity === after.target.identity
        && before.next.identity === after.retiredNext.identity
        ? successor
        : initiallyAbsentInvalid('identity-mismatch');
  }
}

export interface CodexDevelopmentFreezeProjectionV1 {
  readonly manifest: CodexDevelopmentWorkPackageManifest;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly pointerSource: string;
  readonly rollingPlanSource: string;
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

function uniqueHeadingMatch(source: string, pattern: RegExp, label: string): RegExpMatchArray {
  const matches = [...source.matchAll(pattern)];
  const match = matches[0];
  if (matches.length !== 1 || match?.index === undefined) {
    throw new Error(`${label} must occur exactly once.`);
  }
  return match;
}

function sourceLineEnding(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Promote one already-reviewed rolling-plan candidate without interpreting or
 * regenerating its prose. Only the candidate heading loses its ordinal and the
 * remaining ordinals are rewritten; candidate bodies and every unrelated byte
 * are retained exactly.
 */
export function CodexDevelopmentPromoteRollingPlanV1(input: {
  source: string;
  packageId: string;
}): string {
  const parsed = CodexDevelopmentParseRollingPlanV1(input.source);
  const packageId = stringValue(input.packageId, 'Rolling plan promotion packageId');
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(packageId)) {
    throw new Error('Rolling plan promotion packageId must be a canonical Work Package ID.');
  }
  if (parsed.activePackageId === packageId) return input.source;
  if (!parsed.candidatePackageIds.includes(packageId)) {
    throw new Error('Rolling plan promotion target must be the active package or one unique candidate.');
  }

  const activeMarker = uniqueHeadingMatch(
    input.source,
    /^## 当前唯一 Work Package[ \t]*\r?$/gmu,
    'Rolling plan active marker'
  );
  const candidateMarker = uniqueHeadingMatch(
    input.source,
    /^## 候选 Work Package[ \t]*\r?$/gmu,
    'Rolling plan candidate marker'
  );
  const activeMarkerEnd = activeMarker.index! + activeMarker[0].length;
  const candidateMarkerStart = candidateMarker.index!;
  const candidateMarkerEnd = candidateMarkerStart + candidateMarker[0].length;
  const followingSectionPattern = /^## (?!候选 Work Package[ \t]*\r?$).+\r?$/gmu;
  followingSectionPattern.lastIndex = candidateMarkerEnd;
  const followingSection = followingSectionPattern.exec(input.source);
  const candidateSectionEnd = followingSection?.index ?? input.source.length;
  const candidateSection = input.source.slice(candidateMarkerEnd, candidateSectionEnd);
  const headingPattern = /^### ([1-9][0-9]*)\. ([a-z0-9][a-z0-9-]*)([ \t]*)(\r?\n|$)/gmu;
  const headings = [...candidateSection.matchAll(headingPattern)];
  const targetIndex = headings.findIndex((heading) => heading[2] === packageId);
  if (targetIndex < 0 || headings.filter((heading) => heading[2] === packageId).length !== 1) {
    throw new Error('Rolling plan promotion target must occur exactly once in the candidate section.');
  }
  const remaining = headings.filter((_, index) => index !== targetIndex);
  if (remaining.length < 2 || remaining.length > 5) {
    throw new Error('Rolling plan promotion must retain two to five candidate packages.');
  }

  const sectionOffset = candidateMarkerEnd;
  const firstHeadingStart = sectionOffset + headings[0]!.index!;
  const candidatePrefix = input.source.slice(candidateMarkerEnd, firstHeadingStart);
  const blocks = headings.map((heading, index) => {
    const start = sectionOffset + heading.index!;
    const end = index + 1 < headings.length
      ? sectionOffset + headings[index + 1]!.index!
      : candidateSectionEnd;
    const headingEnd = start + heading[0].length;
    return {
      id: heading[2]!,
      heading: heading[0],
      body: input.source.slice(headingEnd, end)
    };
  });
  const promoted = blocks[targetIndex]!;
  const eol = sourceLineEnding(input.source);
  const promotedHeading = promoted.heading.replace(
    /^### [1-9][0-9]*\. /u,
    '### '
  );
  const nextActiveSection = `${eol}${eol}${promotedHeading}${promoted.body}`;
  const nextCandidateSection = candidatePrefix + blocks
    .filter((_, index) => index !== targetIndex)
    .map((block, index) => (
      block.heading.replace(/^### [1-9][0-9]*\. /u, `### ${index + 1}. `) + block.body
    ))
    .join('');
  const next = input.source.slice(0, activeMarkerEnd)
    + nextActiveSection
    + input.source.slice(candidateMarkerStart, candidateMarkerEnd)
    + nextCandidateSection
    + input.source.slice(candidateSectionEnd);
  const nextParsed = CodexDevelopmentParseRollingPlanV1(next);
  if (nextParsed.activePackageId !== packageId) {
    throw new Error('Rolling plan promotion readback did not select the requested package.');
  }
  return next;
}

export function CodexDevelopmentRenderActivePointerV2(input: {
  spec: CodexDevelopmentCurrentStateSpecV1;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  reviewedOn: string;
}): string {
  const manifestPath = manifestPathValue(input.manifestPath, 'Active pointer manifest');
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.manifestDigest)) {
    throw new Error('Active pointer manifestDigest must be a SHA-256 digest.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.reviewedOn)) {
    throw new Error('Active pointer reviewedOn must be an ISO calendar date.');
  }
  const source = `---
schema: ${CodexDevelopmentActivePointerSchemaV2}
status: conditional
last-reviewed: ${input.reviewedOn}
---

# 当前唯一 Active Work Package

\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: ${input.spec.resolver.defaultRef}
defaultRefFreshness: live-platform-match-required
manifest: ${manifestPath}
manifestDigest: ${input.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  const pointer = CodexDevelopmentParseActivePointerV2(source);
  CodexDevelopmentAssertControlPlaneBindingV1({ spec: input.spec, pointer });
  return source;
}

/**
 * A staged prior projection may retain previously accepted non-selection
 * rolling-plan bytes, but it never becomes a selection authority. The exact
 * pointer remains compiler-rendered for the indexed manifest, while active and
 * ordered candidate identity are re-derived from immutable HEAD.
 */
export function CodexDevelopmentAssertPriorFreezeProjectionV1(input: {
  spec: CodexDevelopmentCurrentStateSpecV1;
  immutableRollingPlanSource: string;
  pointerSource: string;
  rollingPlanSource: string;
  manifestPath: string;
  manifestBytes: Uint8Array;
}): void {
  const manifestPath = manifestPathValue(input.manifestPath, 'Prior projection manifest path');
  const pointer = CodexDevelopmentParseActivePointerV2(input.pointerSource);
  CodexDevelopmentAssertControlPlaneBindingV1({ spec: input.spec, pointer });
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.manifestBytes
  ) as `sha256:${string}`;
  if (pointer.manifest !== manifestPath || pointer.manifestDigest !== manifestDigest) {
    throw new Error('Prior projection pointer must bind the exact indexed manifest bytes.');
  }
  const frontmatter = parseMarkdownFrontmatter(input.pointerSource);
  const reviewedOn = stringValue(frontmatter['last-reviewed'], 'Prior projection pointer last-reviewed');
  const expectedPointerSource = CodexDevelopmentRenderActivePointerV2({
    spec: input.spec,
    manifestPath,
    manifestDigest,
    reviewedOn
  });
  if (input.pointerSource !== expectedPointerSource) {
    throw new Error('Prior projection pointer must be the exact compiler-rendered source.');
  }

  const packageId = manifestPath.slice('docs/work-packages/'.length, -'.md'.length);
  const expectedTopology = CodexDevelopmentParseRollingPlanV1(
    CodexDevelopmentPromoteRollingPlanV1({
      source: input.immutableRollingPlanSource,
      packageId
    })
  );
  const observedTopology = CodexDevelopmentParseRollingPlanV1(input.rollingPlanSource);
  if (observedTopology.activePackageId !== expectedTopology.activePackageId
      || JSON.stringify(observedTopology.candidatePackageIds)
        !== JSON.stringify(expectedTopology.candidatePackageIds)) {
    throw new Error(
      'Prior projection rolling plan must preserve immutable active and ordered candidate topology.'
    );
  }
}

export function CodexDevelopmentCreateFreezeProjectionV1(input: {
  spec: CodexDevelopmentCurrentStateSpecV1;
  currentPointerSource: string;
  currentRollingPlanSource: string;
  requestedRollingPlanSource?: string;
  manifestPath: string;
  manifestBytes: Uint8Array;
  baseSha: string;
  reviewedOn: string;
}): CodexDevelopmentFreezeProjectionV1 {
  const manifestPath = manifestPathValue(input.manifestPath, 'Freeze manifest path');
  let manifestSource: string;
  try {
    manifestSource = new TextDecoder('utf-8', { fatal: true }).decode(input.manifestBytes);
  } catch (error) {
    throw new Error('Work Package manifest bytes must be valid UTF-8.', { cause: error });
  }
  const manifest = CodexDevelopmentParseWorkPackageManifest(manifestSource, manifestPath);
  if (manifest.base !== input.baseSha) {
    throw new Error('Work Package manifest base must equal the exact live default revision.');
  }
  const currentPointer = CodexDevelopmentParseActivePointerV2(input.currentPointerSource);
  CodexDevelopmentAssertControlPlaneBindingV1({ spec: input.spec, pointer: currentPointer });
  const currentRollingPlan = CodexDevelopmentParseRollingPlanV1(input.currentRollingPlanSource);
  if (currentRollingPlan.activePackageId !== currentPointer.manifest.slice(
    'docs/work-packages/'.length,
    -'.md'.length
  )) {
    throw new Error('Current rolling plan and active pointer are not bound to the same package.');
  }
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.manifestBytes
  ) as `sha256:${string}`;
  const pointerSource = CodexDevelopmentRenderActivePointerV2({
    spec: input.spec,
    manifestPath,
    manifestDigest,
    reviewedOn: input.reviewedOn
  });
  const promotedRollingPlanSource = CodexDevelopmentPromoteRollingPlanV1({
    source: input.currentRollingPlanSource,
    packageId: manifest.id
  });
  let rollingPlanSource = promotedRollingPlanSource;
  if (input.requestedRollingPlanSource !== undefined) {
    const promoted = CodexDevelopmentParseRollingPlanV1(promotedRollingPlanSource);
    const requested = CodexDevelopmentParseRollingPlanV1(input.requestedRollingPlanSource);
    if (requested.activePackageId !== promoted.activePackageId
        || JSON.stringify(requested.candidatePackageIds) !== JSON.stringify(promoted.candidatePackageIds)) {
      throw new Error(
        'Requested rolling-plan projection must preserve the exact deterministic promotion topology.'
      );
    }
    rollingPlanSource = input.requestedRollingPlanSource;
  }
  if (CodexDevelopmentParseRollingPlanV1(rollingPlanSource).activePackageId !== manifest.id) {
    throw new Error('Freeze projection rolling-plan readback failed.');
  }
  return Object.freeze({ manifest, manifestPath, manifestDigest, pointerSource, rollingPlanSource });
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
  if (CodexDevelopmentWorkPackageManifestDigest(input.candidateManifestBlob) !== input.pointer.manifestDigest) {
    return { state: 'invalid', reason: 'candidate-digest-mismatch' };
  }
  if (input.defaultManifestBlob !== null) {
    if (CodexDevelopmentWorkPackageManifestDigest(input.defaultManifestBlob) === input.pointer.manifestDigest) {
      return { state: 'none', reason: 'matching-default-blob' };
    }
    return { state: 'invalid', reason: 'manifest-path-already-on-default' };
  }
  return { state: 'active', manifest: input.pointer.manifest, manifestDigest: input.pointer.manifestDigest };
}
