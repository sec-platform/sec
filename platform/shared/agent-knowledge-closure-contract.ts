import {
  SEC_AGENT_SKILL_IDS,
  type SecAgentSkillId
} from './agent-skill-contract.ts';
import type {
  DocumentationAuthorityRecord,
  DocumentationAuthorityRegistry
} from './documentation-authority-contract.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

export const SEC_AGENT_KNOWLEDGE_CLOSURE_SCHEMA =
  'sec-agent-knowledge-closure-v1' as const;

export const SEC_AGENT_KNOWLEDGE_FOUNDATION = Object.freeze([
  { path: 'AGENTS.md', authorityId: null },
  { path: 'docs/authority.json', authorityId: 'documentation-registry' },
  { path: 'docs/development-governance.md', authorityId: 'development-governance' },
  { path: 'docs/product.md', authorityId: 'product' },
  { path: 'docs/roadmap.md', authorityId: 'roadmap' },
  { path: 'docs/system-architecture.md', authorityId: 'system-architecture' },
  { path: 'docs/verification-governance.md', authorityId: 'verification-governance' }
] as const);

export const SEC_AGENT_KNOWLEDGE_CONTROL_PATHS = Object.freeze([
  'docs/work/active-work-package.md',
  'docs/work/current-state.yaml',
  'docs/work/rolling-plan.md'
] as const);

export const SEC_AGENT_KNOWLEDGE_LIMITATION =
  'Knowledge closure proves authoritative source coverage and unresolved-state closure; it cannot prove hidden model comprehension.' as const;

export type SecAgentKnowledgeMode =
  | 'read-only'
  | 'write-candidate'
  | 'independent-review';

export type SecAgentKnowledgeSourceRole =
  | 'foundation'
  | 'domain-authority'
  | 'control'
  | 'primary-skill'
  | 'work-package'
  | 'implementation-anchor'
  | 'verification-anchor';

export type SecAgentKnowledgeSourceProvenance =
  | 'trusted-default'
  | 'maintainer-frozen'
  | 'candidate-data';

export interface SecAgentKnowledgeSourceV1 {
  readonly role: SecAgentKnowledgeSourceRole;
  readonly path: string;
  readonly authorityId: string | null;
  readonly digest: `sha256:${string}`;
  readonly provenance: SecAgentKnowledgeSourceProvenance;
}

export interface SecAgentKnowledgeClosureV1 {
  readonly schema: typeof SEC_AGENT_KNOWLEDGE_CLOSURE_SCHEMA;
  readonly repository: string;
  readonly trustedDefaultSha: string;
  readonly candidateHeadSha: string;
  readonly mode: SecAgentKnowledgeMode;
  readonly primarySkill: SecAgentSkillId;
  readonly requiredAuthorityIds: readonly string[];
  readonly workPackageManifestPath: string;
  readonly sources: readonly SecAgentKnowledgeSourceV1[];
  readonly unresolved: readonly string[];
  readonly status: 'ready' | 'blocked';
}

export type SecAgentKnowledgeClosureDraftV1 = Omit<
  SecAgentKnowledgeClosureV1,
  'schema' | 'status'
>;

const TOP_LEVEL_KEYS = new Set([
  'schema', 'repository', 'trustedDefaultSha', 'candidateHeadSha', 'mode',
  'primarySkill', 'requiredAuthorityIds', 'workPackageManifestPath', 'sources',
  'unresolved', 'status'
]);
const SOURCE_KEYS = new Set(['role', 'path', 'authorityId', 'digest', 'provenance']);
const MODES = new Set<SecAgentKnowledgeMode>(['read-only', 'write-candidate', 'independent-review']);
const ROLES = new Set<SecAgentKnowledgeSourceRole>([
  'foundation', 'domain-authority', 'control', 'primary-skill', 'work-package',
  'implementation-anchor', 'verification-anchor'
]);
const PROVENANCES = new Set<SecAgentKnowledgeSourceProvenance>([
  'trusted-default', 'maintainer-frozen', 'candidate-data'
]);
const ROLE_ORDER = new Map<SecAgentKnowledgeSourceRole, number>([
  ['foundation', 0], ['domain-authority', 1], ['control', 2],
  ['primary-skill', 3], ['work-package', 4], ['implementation-anchor', 5],
  ['verification-anchor', 6]
]);

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('\0')) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
}

function assertRepository(value: unknown, label: string): asserts value is string {
  assertText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    throw new Error(`${label} must be one bounded owner/name repository.`);
  }
}

function assertSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase commit SHA.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
}

function assertPath(value: unknown, label: string): asserts value is string {
  assertText(value, label);
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(value)) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  }
}

function canonicalStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const values = value.map((entry, index) => {
    assertText(entry, `${label}[${index}]`);
    return entry;
  });
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
  const sorted = [...values].sort();
  if (sorted.some((entry, index) => entry !== values[index])) {
    throw new Error(`${label} must be in canonical lexical order.`);
  }
  return values;
}

function sourceKey(source: SecAgentKnowledgeSourceV1): string {
  return `${String(ROLE_ORDER.get(source.role) ?? 99).padStart(2, '0')}\0${source.path}`;
}

function canonicalSources(
  sources: readonly SecAgentKnowledgeSourceV1[]
): SecAgentKnowledgeSourceV1[] {
  return [...sources].sort((left, right) => {
    const leftKey = sourceKey(left);
    const rightKey = sourceKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function parseSource(value: unknown, index: number): SecAgentKnowledgeSourceV1 {
  const label = `sources[${index}]`;
  assertObject(value, label);
  assertKeys(value, SOURCE_KEYS, label);
  if (!ROLES.has(value.role as SecAgentKnowledgeSourceRole)) throw new Error(`${label}.role is invalid.`);
  if (!PROVENANCES.has(value.provenance as SecAgentKnowledgeSourceProvenance)) {
    throw new Error(`${label}.provenance is invalid.`);
  }
  assertPath(value.path, `${label}.path`);
  if (value.authorityId !== null) assertText(value.authorityId, `${label}.authorityId`);
  assertDigest(value.digest, `${label}.digest`);
  return Object.freeze({
    role: value.role as SecAgentKnowledgeSourceRole,
    path: value.path,
    authorityId: value.authorityId as string | null,
    digest: value.digest,
    provenance: value.provenance as SecAgentKnowledgeSourceProvenance
  });
}

function recordById(registry: DocumentationAuthorityRegistry, id: string): DocumentationAuthorityRecord {
  const record = registry.documents.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Knowledge closure references unknown authority ${id}.`);
  return record;
}

function isOwning(record: DocumentationAuthorityRecord): boolean {
  return record.owns.length > 0
    && record.kind !== 'proposal'
    && record.kind !== 'navigation'
    && record.kind !== 'agent-projection';
}

function assertProvenance(source: SecAgentKnowledgeSourceV1): void {
  if (!['foundation', 'domain-authority'].includes(source.role) && source.authorityId !== null) {
    throw new Error(`${source.role} source ${source.path} cannot declare authorityId.`);
  }
  if (
    ['foundation', 'domain-authority', 'control', 'primary-skill'].includes(source.role)
    && source.provenance !== 'trusted-default'
  ) {
    throw new Error(`${source.role} source ${source.path} must come from trusted-default.`);
  }
  if (source.role === 'work-package' && source.provenance !== 'maintainer-frozen') {
    throw new Error(`Work Package source ${source.path} must be maintainer-frozen.`);
  }
  if (
    ['implementation-anchor', 'verification-anchor'].includes(source.role)
    && source.provenance === 'maintainer-frozen'
  ) {
    throw new Error(`${source.role} source ${source.path} cannot use maintainer-frozen provenance.`);
  }
}

function assertFoundation(
  sources: readonly SecAgentKnowledgeSourceV1[],
  registry: DocumentationAuthorityRegistry
): void {
  const foundationPaths = new Set(SEC_AGENT_KNOWLEDGE_FOUNDATION.map((entry) => entry.path));
  for (const source of sources.filter((candidate) => candidate.role === 'foundation')) {
    if (!foundationPaths.has(source.path as typeof SEC_AGENT_KNOWLEDGE_FOUNDATION[number]['path'])) {
      throw new Error(`Foundation source ${source.path} is not part of the canonical foundation.`);
    }
  }
  for (const required of SEC_AGENT_KNOWLEDGE_FOUNDATION) {
    const source = sources.find((candidate) => candidate.path === required.path);
    if (!source || source.role !== 'foundation') {
      throw new Error(`Knowledge closure is missing foundation source ${required.path}.`);
    }
    if (source.authorityId !== required.authorityId) {
      throw new Error(`Foundation source ${required.path} has the wrong authority identity.`);
    }
    if (required.authorityId !== null) {
      const record = recordById(registry, required.authorityId);
      if (record.path !== required.path || !isOwning(record)) {
        throw new Error(`Foundation authority ${required.authorityId} is not an owning canonical record.`);
      }
    }
  }
}

function assertAuthorities(
  sources: readonly SecAgentKnowledgeSourceV1[],
  registry: DocumentationAuthorityRegistry,
  requiredAuthorityIds: readonly string[]
): void {
  for (const id of requiredAuthorityIds) {
    const record = recordById(registry, id);
    if (!isOwning(record)) throw new Error(`Knowledge authority ${id} must be an owning canonical record.`);
    const matches = sources.filter((source) => source.authorityId === id);
    if (matches.length !== 1 || matches[0]!.path !== record.path) {
      throw new Error(`Knowledge closure must load exact authority ${id} from ${record.path}.`);
    }
    if (!['foundation', 'domain-authority'].includes(matches[0]!.role)) {
      throw new Error(`Authority ${id} must be loaded as foundation or domain-authority.`);
    }
  }
  for (const source of sources.filter((candidate) => candidate.role === 'domain-authority')) {
    if (source.authorityId === null || !requiredAuthorityIds.includes(source.authorityId)) {
      throw new Error(`Domain authority source ${source.path} is not required by this task.`);
    }
    const record = recordById(registry, source.authorityId);
    if (record.path !== source.path || !isOwning(record)) {
      throw new Error(`Domain authority source ${source.path} does not match its registry owner.`);
    }
  }
}

function assertControlsAndSkill(closure: SecAgentKnowledgeClosureV1): void {
  const controls = closure.sources.filter((source) => source.role === 'control');
  if (controls.length !== SEC_AGENT_KNOWLEDGE_CONTROL_PATHS.length) {
    throw new Error('Knowledge closure control source inventory is not exact.');
  }
  for (const path of SEC_AGENT_KNOWLEDGE_CONTROL_PATHS) {
    const matches = controls.filter((source) => source.path === path);
    if (matches.length !== 1 || matches[0]!.authorityId !== null) {
      throw new Error(`Knowledge closure must load control source ${path} exactly once.`);
    }
  }
  const skillPath = `.agents/skills/${closure.primarySkill}/SKILL.md`;
  const skills = closure.sources.filter((source) => source.role === 'primary-skill');
  if (skills.length !== 1 || skills[0]!.path !== skillPath || skills[0]!.authorityId !== null) {
    throw new Error(`Knowledge closure must load exactly one primary Skill: ${skillPath}.`);
  }
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(closure.workPackageManifestPath)) {
    throw new Error('Knowledge closure Work Package path is invalid.');
  }
  const workPackages = closure.sources.filter((source) => source.role === 'work-package');
  if (workPackages.length !== 1 || workPackages[0]!.path !== closure.workPackageManifestPath) {
    throw new Error('Knowledge closure must load the exact selected frozen Work Package once.');
  }
}

function assertMode(closure: SecAgentKnowledgeClosureV1): void {
  const implementation = closure.sources.filter((source) => source.role === 'implementation-anchor');
  const verification = closure.sources.filter((source) => source.role === 'verification-anchor');
  if (closure.mode === 'write-candidate' && (implementation.length === 0 || verification.length === 0)) {
    throw new Error('Write-candidate knowledge closure requires implementation and verification anchors.');
  }
  if (closure.mode === 'independent-review') {
    if (closure.primarySkill !== 'sec-exact-head-review') {
      throw new Error('Independent review knowledge closure requires sec-exact-head-review.');
    }
    if (!implementation.some((source) => source.provenance === 'candidate-data') || verification.length === 0) {
      throw new Error('Independent review knowledge closure requires candidate implementation and verification anchors.');
    }
  }
}

function freezeClosure(closure: SecAgentKnowledgeClosureV1): SecAgentKnowledgeClosureV1 {
  return Object.freeze({
    ...closure,
    requiredAuthorityIds: Object.freeze([...closure.requiredAuthorityIds]),
    sources: Object.freeze([...closure.sources]),
    unresolved: Object.freeze([...closure.unresolved])
  });
}

export function parseSecAgentKnowledgeClosureV1(
  value: unknown,
  registry: DocumentationAuthorityRegistry
): SecAgentKnowledgeClosureV1 {
  assertObject(value, 'knowledge closure');
  assertKeys(value, TOP_LEVEL_KEYS, 'knowledge closure');
  if (value.schema !== SEC_AGENT_KNOWLEDGE_CLOSURE_SCHEMA) {
    throw new Error('Knowledge closure schema is unsupported.');
  }
  assertRepository(value.repository, 'knowledge closure.repository');
  assertSha(value.trustedDefaultSha, 'knowledge closure.trustedDefaultSha');
  assertSha(value.candidateHeadSha, 'knowledge closure.candidateHeadSha');
  if (!MODES.has(value.mode as SecAgentKnowledgeMode)) throw new Error('Knowledge closure mode is invalid.');
  if (!SEC_AGENT_SKILL_IDS.includes(value.primarySkill as SecAgentSkillId)) {
    throw new Error('Knowledge closure primarySkill is invalid.');
  }
  const requiredAuthorityIds = canonicalStrings(
    value.requiredAuthorityIds,
    'knowledge closure.requiredAuthorityIds'
  );
  assertPath(value.workPackageManifestPath, 'knowledge closure.workPackageManifestPath');
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw new Error('Knowledge closure sources must be a non-empty array.');
  }
  const sources = value.sources.map(parseSource);
  if (new Set(sources.map((source) => source.path)).size !== sources.length) {
    throw new Error('Knowledge closure source paths must be unique.');
  }
  const sorted = canonicalSources(sources);
  if (sorted.some((source, index) => source !== sources[index])) {
    throw new Error('Knowledge closure sources must be in canonical role/path order.');
  }
  sources.forEach(assertProvenance);
  const unresolved = canonicalStrings(value.unresolved, 'knowledge closure.unresolved');
  if (value.status !== 'ready' && value.status !== 'blocked') {
    throw new Error('Knowledge closure status is invalid.');
  }
  if (value.status !== (unresolved.length === 0 ? 'ready' : 'blocked')) {
    throw new Error('Knowledge closure status contradicts unresolved knowledge state.');
  }
  const closure = freezeClosure({
    schema: SEC_AGENT_KNOWLEDGE_CLOSURE_SCHEMA,
    repository: value.repository,
    trustedDefaultSha: value.trustedDefaultSha,
    candidateHeadSha: value.candidateHeadSha,
    mode: value.mode as SecAgentKnowledgeMode,
    primarySkill: value.primarySkill as SecAgentSkillId,
    requiredAuthorityIds,
    workPackageManifestPath: value.workPackageManifestPath,
    sources,
    unresolved,
    status: value.status
  });
  assertFoundation(sources, registry);
  assertAuthorities(sources, registry, requiredAuthorityIds);
  assertControlsAndSkill(closure);
  assertMode(closure);
  return closure;
}

export function buildSecAgentKnowledgeClosureV1(
  draft: SecAgentKnowledgeClosureDraftV1,
  registry: DocumentationAuthorityRegistry
): SecAgentKnowledgeClosureV1 {
  const unresolved = [...new Set(draft.unresolved)].sort();
  return parseSecAgentKnowledgeClosureV1({
    schema: SEC_AGENT_KNOWLEDGE_CLOSURE_SCHEMA,
    repository: draft.repository,
    trustedDefaultSha: draft.trustedDefaultSha,
    candidateHeadSha: draft.candidateHeadSha,
    mode: draft.mode,
    primarySkill: draft.primarySkill,
    requiredAuthorityIds: [...new Set(draft.requiredAuthorityIds)].sort(),
    workPackageManifestPath: draft.workPackageManifestPath,
    sources: canonicalSources(draft.sources),
    unresolved,
    status: unresolved.length === 0 ? 'ready' : 'blocked'
  }, registry);
}
