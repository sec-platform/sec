import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  SEC_AGENT_KNOWLEDGE_CLOSURE_SCHEMA,
  type SecAgentKnowledgeClosureV1,
  type SecAgentKnowledgeSourceV1
} from '../../platform/shared/agent-knowledge-closure-contract.ts';
import {
  bindSecAgentKnowledgeReadinessV1,
  type SecAgentKnowledgeExpectedBindingV1
} from '../../platform/shared/agent-knowledge-readiness-contract.ts';
import { parseDocumentationAuthorityRegistry } from '../../platform/shared/documentation-authority-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

function digest(seed: string): `sha256:${string}` {
  const nibble = seed.charCodeAt(0).toString(16).slice(-1);
  return `sha256:${nibble.repeat(64)}`;
}

function source(
  role: SecAgentKnowledgeSourceV1['role'],
  repositoryPath: string,
  authorityId: string | null,
  provenance: SecAgentKnowledgeSourceV1['provenance'],
  seed: string
): SecAgentKnowledgeSourceV1 {
  return { role, path: repositoryPath, authorityId, provenance, digest: digest(seed) };
}

function closure(): SecAgentKnowledgeClosureV1 {
  return {
    schema: SEC_AGENT_KNOWLEDGE_CLOSURE_SCHEMA,
    repository: 'sec-platform/sec',
    trustedDefaultSha: '1'.repeat(40),
    candidateHeadSha: '2'.repeat(40),
    mode: 'write-candidate',
    primarySkill: 'sec-worker-development',
    requiredAuthorityIds: ['semantic-model'],
    workPackageManifestPath: 'docs/work-packages/knowledge-closure-v1.md',
    sources: [
      source('foundation', 'AGENTS.md', null, 'trusted-default', 'a'),
      source('foundation', 'docs/authority.json', 'documentation-registry', 'trusted-default', 'b'),
      source('foundation', 'docs/development-governance.md', 'development-governance', 'trusted-default', 'c'),
      source('foundation', 'docs/product.md', 'product', 'trusted-default', 'd'),
      source('foundation', 'docs/roadmap.md', 'roadmap', 'trusted-default', 'e'),
      source('foundation', 'docs/system-architecture.md', 'system-architecture', 'trusted-default', 'f'),
      source('foundation', 'docs/verification-governance.md', 'verification-governance', 'trusted-default', 'g'),
      source('domain-authority', 'docs/semantic-model.md', 'semantic-model', 'trusted-default', 'h'),
      source('control', 'docs/work/active-work-package.md', null, 'trusted-default', 'i'),
      source('control', 'docs/work/current-state.yaml', null, 'trusted-default', 'j'),
      source('control', 'docs/work/rolling-plan.md', null, 'trusted-default', 'k'),
      source('primary-skill', '.agents/skills/sec-worker-development/SKILL.md', null, 'trusted-default', 'l'),
      source('work-package', 'docs/work-packages/knowledge-closure-v1.md', null, 'maintainer-frozen', 'm'),
      source('implementation-anchor', 'platform/compiler/example.ts', null, 'candidate-data', 'n'),
      source('verification-anchor', 'tests/unit/example.test.ts', null, 'candidate-data', 'o')
    ],
    unresolved: [],
    status: 'ready'
  };
}

function expected(value = closure()): SecAgentKnowledgeExpectedBindingV1 {
  return {
    repository: value.repository,
    trustedDefaultSha: value.trustedDefaultSha,
    candidateHeadSha: value.candidateHeadSha,
    mode: value.mode,
    primarySkill: value.primarySkill,
    workPackageManifestPath: value.workPackageManifestPath,
    requiredAuthorityIds: value.requiredAuthorityIds
  };
}

function digestMap(value = closure()): ReadonlyMap<string, string> {
  return new Map(value.sources.map((entry) => [entry.path, entry.digest]));
}

async function registry() {
  return parseDocumentationAuthorityRegistry(await readFile(
    path.join(REPOSITORY_ROOT, 'docs/authority.json'),
    'utf8'
  ));
}

test('ready binding is immutable and bound to external task identity', async () => {
  const value = closure();
  const ready = bindSecAgentKnowledgeReadinessV1(
    value,
    await registry(),
    digestMap(value),
    expected(value)
  );
  expect(Object.isFrozen(ready)).toBe(true);
  expect(Object.isFrozen(ready.sources)).toBe(true);
  expect(Object.isFrozen(ready.sources[0])).toBe(true);
});

test('self-declared repository, revisions, mode, Skill and owner set cannot authorize work', async () => {
  const value = closure();
  const authority = await registry();
  for (const binding of [
    { ...expected(value), repository: 'other/repository' },
    { ...expected(value), trustedDefaultSha: '3'.repeat(40) },
    { ...expected(value), candidateHeadSha: '4'.repeat(40) },
    { ...expected(value), mode: 'independent-review' as const },
    { ...expected(value), primarySkill: 'sec-exact-head-review' as const },
    { ...expected(value), workPackageManifestPath: 'docs/work-packages/other-v1.md' },
    { ...expected(value), requiredAuthorityIds: ['runtime-distribution'] }
  ]) {
    expect(() => bindSecAgentKnowledgeReadinessV1(
      value,
      authority,
      digestMap(value),
      binding
    )).toThrow('does not match the expected task binding');
  }
});

test('invalid expected enums, Skills and Work Package identities fail before comparison', async () => {
  const value = closure();
  const authority = await registry();
  const attacks: Array<[Record<string, unknown>, string]> = [
    [{ ...expected(value), mode: 'execute-everything' }, 'Expected knowledge mode is invalid'],
    [{ ...expected(value), primarySkill: 'sec-omnipotent-agent' }, 'Expected primary Skill is invalid'],
    [{ ...expected(value), workPackageManifestPath: 'docs/README.md' }, 'Expected Work Package path is invalid']
  ];
  for (const [binding, message] of attacks) {
    expect(() => bindSecAgentKnowledgeReadinessV1(
      value,
      authority,
      digestMap(value),
      binding as unknown as SecAgentKnowledgeExpectedBindingV1
    )).toThrow(message);
  }
});

test('unresolved knowledge and stale source bytes cannot become ready', async () => {
  const authority = await registry();
  const blocked = structuredClone(closure()) as SecAgentKnowledgeClosureV1 & {
    unresolved: string[];
    status: 'ready' | 'blocked';
  };
  blocked.unresolved = ['owner-unresolved'];
  blocked.status = 'blocked';
  expect(() => bindSecAgentKnowledgeReadinessV1(
    blocked,
    authority,
    digestMap(blocked),
    expected(blocked)
  )).toThrow('Agent knowledge is blocked');

  const stale = closure();
  const observed = new Map(digestMap(stale));
  observed.set('docs/product.md', digest('z'));
  expect(() => bindSecAgentKnowledgeReadinessV1(
    stale,
    authority,
    observed,
    expected(stale)
  )).toThrow('docs/product.md does not match its observed bytes');
});

test('repository entry, orientation and implementation worker require the same closure', async () => {
  const [agents, orientation, worker] = await Promise.all([
    readFile(path.join(REPOSITORY_ROOT, 'AGENTS.md'), 'utf8'),
    readFile(path.join(REPOSITORY_ROOT, '.agents/skills/sec-repository-orientation/SKILL.md'), 'utf8'),
    readFile(path.join(REPOSITORY_ROOT, '.codex/agents/implementation-worker.toml'), 'utf8')
  ]);
  for (const sourceText of [agents, orientation, worker]) {
    expect(sourceText).toContain('sec-agent-knowledge-closure-v1');
  }
  expect(agents).toContain('不声称证明模型隐藏理解');
  expect(orientation).toContain('不证明隐藏模型理解');
  expect(worker).toContain('does not prove hidden model comprehension');
});
