import {
  parseSecAgentKnowledgeClosureV1,
  type SecAgentKnowledgeClosureV1,
  type SecAgentKnowledgeMode
} from './agent-knowledge-closure-contract.ts';
import {
  SEC_AGENT_SKILL_IDS,
  type SecAgentSkillId
} from './agent-skill-contract.ts';
import type { DocumentationAuthorityRegistry } from './documentation-authority-contract.ts';

export interface SecAgentKnowledgeExpectedBindingV1 {
  readonly repository: string;
  readonly trustedDefaultSha: string;
  readonly candidateHeadSha: string;
  readonly mode: SecAgentKnowledgeMode;
  readonly primarySkill: SecAgentSkillId;
  readonly workPackageManifestPath: string;
  readonly requiredAuthorityIds: readonly string[];
}

const KNOWLEDGE_MODES = new Set<SecAgentKnowledgeMode>([
  'read-only',
  'write-candidate',
  'independent-review'
]);

function canonicalStringArray(values: readonly string[], label: string): string[] {
  if (values.some((value) => value.length === 0 || value.trim() !== value || value.includes('\0'))) {
    throw new Error(`${label} must contain only non-empty trimmed strings.`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
  const sorted = [...values].sort();
  if (sorted.some((value, index) => value !== values[index])) {
    throw new Error(`${label} must be in canonical lexical order.`);
  }
  return sorted;
}

function assertExpectedBindingShape(expected: SecAgentKnowledgeExpectedBindingV1): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(expected.repository)) {
    throw new Error('Expected knowledge repository must be one bounded owner/name repository.');
  }
  if (!/^[0-9a-f]{40}$/u.test(expected.trustedDefaultSha)) {
    throw new Error('Expected trusted default SHA must be exact lowercase Git identity.');
  }
  if (!/^[0-9a-f]{40}$/u.test(expected.candidateHeadSha)) {
    throw new Error('Expected candidate head SHA must be exact lowercase Git identity.');
  }
  if (!KNOWLEDGE_MODES.has(expected.mode)) {
    throw new Error('Expected knowledge mode is invalid.');
  }
  if (!SEC_AGENT_SKILL_IDS.includes(expected.primarySkill)) {
    throw new Error('Expected primary Skill is invalid.');
  }
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(expected.workPackageManifestPath)) {
    throw new Error('Expected Work Package path is invalid.');
  }
  canonicalStringArray(expected.requiredAuthorityIds, 'Expected authority IDs');
}

function assertExpectedBinding(
  closure: SecAgentKnowledgeClosureV1,
  expected: SecAgentKnowledgeExpectedBindingV1
): void {
  assertExpectedBindingShape(expected);
  if (
    closure.repository !== expected.repository
    || closure.trustedDefaultSha !== expected.trustedDefaultSha
    || closure.candidateHeadSha !== expected.candidateHeadSha
    || closure.mode !== expected.mode
    || closure.primarySkill !== expected.primarySkill
    || closure.workPackageManifestPath !== expected.workPackageManifestPath
    || JSON.stringify(closure.requiredAuthorityIds) !== JSON.stringify(expected.requiredAuthorityIds)
  ) {
    throw new Error('Agent knowledge closure does not match the expected task binding.');
  }
}

function freezeReadyClosure(closure: SecAgentKnowledgeClosureV1): SecAgentKnowledgeClosureV1 {
  const sources = closure.sources.map((source) => Object.freeze({ ...source }));
  return Object.freeze({
    ...closure,
    requiredAuthorityIds: Object.freeze([...closure.requiredAuthorityIds]),
    sources: Object.freeze(sources),
    unresolved: Object.freeze([...closure.unresolved])
  });
}

export function bindSecAgentKnowledgeReadinessV1(
  value: unknown,
  registry: DocumentationAuthorityRegistry,
  actualDigests: ReadonlyMap<string, string>,
  expected: SecAgentKnowledgeExpectedBindingV1
): SecAgentKnowledgeClosureV1 {
  const closure = parseSecAgentKnowledgeClosureV1(value, registry);
  assertExpectedBinding(closure, expected);
  if (closure.status !== 'ready' || closure.unresolved.length > 0) {
    throw new Error(`Agent knowledge is blocked by: ${closure.unresolved.join(', ')}.`);
  }
  for (const source of closure.sources) {
    if (actualDigests.get(source.path) !== source.digest) {
      throw new Error(`Agent knowledge source ${source.path} does not match its observed bytes.`);
    }
  }
  return freezeReadyClosure(closure);
}
