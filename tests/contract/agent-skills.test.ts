import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { projectRepositorySourceGovernance } from '../../src/adapters/repository/repository-audit/cli.ts';
import {
  classifyRepositorySurface,
  isRepositoryHeuristicSurface,
  resolveMarkdownSkillCoverage,
  resolveRepositoryHeuristicRoute,
  resolveRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_HEURISTIC_BEHAVIOR_IDS
} from '../../src/adapters/self-hosting/control/agent/skill.ts';
import {
  activeDocumentationPaths,
  isActiveDocumentationPath,
  parseDocumentationIdentityRegistry
} from '../../src/adapters/self-hosting/control/documentation/active.ts';
import {
  classifyTestImpactSource,
  testImpactModuleIdsForSourceKind
} from '../../src/adapters/verification/platform/test-impact/contract/ownership.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, '.agents', 'skills');

interface SkillFrontmatter {
  description?: unknown;
  name?: unknown;
}

function parseSkill(source: string): { body: string; frontmatter: SkillFrontmatter } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (!match) throw new Error('Skill must contain one leading YAML frontmatter block.');
  const raw = parseYaml(match[1]!) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Skill frontmatter must be a mapping.');
  }
  return { body: match[2]!, frontmatter: raw as SkillFrontmatter };
}

function trackedRepositoryFiles(): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter(Boolean).sort();
}

test('SEC skill inventory conforms to one strict AgentOperation contract', async () => {
  const tracked = trackedRepositoryFiles();
  const skillFiles = tracked.filter((file) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/u.test(file));
  expect(skillFiles).toEqual(
    SEC_AGENT_SKILL_IDS.map((skillId) => `.agents/skills/${skillId}/SKILL.md`)
  );

  const descriptions = new Set<string>();
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const source = await readFile(path.join(SKILLS_ROOT, skillId, 'SKILL.md'), 'utf8');
    const { body, frontmatter } = parseSkill(source);
    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'name']);
    expect(frontmatter.name).toBe(skillId);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    expect((frontmatter.description as string).length).toBeLessThanOrEqual(1024);
    expect(descriptions.has(frontmatter.description as string)).toBe(false);
    descriptions.add(frontmatter.description as string);
    expect(body.match(/^#\s+/gmu)).toHaveLength(1);
  }
});

test('every exact Skill source passes the production blocking governance projection', async () => {
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const repositoryPath = `.agents/skills/${skillId}/SKILL.md`;
    const source = await readFile(path.join(REPOSITORY_ROOT, repositoryPath), 'utf8');
    const projection = projectRepositorySourceGovernance(repositoryPath, source);
    expect(projection.blockingFindings).toEqual([]);
    for (const candidate of projection.candidates) {
      expect(candidate.skills).toEqual([skillId]);
    }
  }
});

test('heuristic registry maps each irreducible behavior to exactly one Skill', () => {
  const routes = SEC_REPOSITORY_HEURISTIC_BEHAVIOR_IDS.map(
    resolveRepositoryHeuristicRoute
  );
  expect(new Set(routes.map((route) => route.owner))).toEqual(new Set(SEC_AGENT_SKILL_IDS));
  expect(SEC_REPOSITORY_HEURISTIC_BEHAVIOR_IDS).toHaveLength(SEC_AGENT_SKILL_IDS.length);
  expect(resolveRepositoryHeuristicRoute('task-delegation')).toEqual({
    kind: 'skill',
    owner: 'sec-task-delegation',
    authorityRef: '.agents/skills/sec-task-delegation/SKILL.md'
  });
  for (const route of routes) {
    expect(route.authorityRef).toBe(`.agents/skills/${route.owner}/SKILL.md`);
    expect('operation' in route).toBeFalse();
  }
});

test('all tracked Markdown is explicitly classified and current document identities have coverage', async () => {
  const tracked = trackedRepositoryFiles();
  const registry = parseDocumentationIdentityRegistry(
    await readFile(path.join(REPOSITORY_ROOT, '.documentation/documents.json'), 'utf8')
  );
  const active = new Set(activeDocumentationPaths(registry));

  for (const file of tracked.filter((candidate) => candidate.endsWith('.md'))) {
    const coverage = resolveMarkdownSkillCoverage(file);
    if (!coverage) throw new Error(`Tracked Markdown is unclassified: ${file}`);
    if (active.has(file)) expect(coverage.kind).toBeDefined();
  }
  for (const { path: file } of registry.documents) {
    expect(resolveMarkdownSkillCoverage(file)).not.toBeNull();
    if (/^(?:examples|alternatives)\//u.test(file)) {
      expect(resolveMarkdownSkillCoverage(file)?.kind).toBe('repository-content');
    }
  }

  for (const unknown of [
    'docs/00-文档索引与一致性规则.md',
    'docs/architecture/unowned.md',
    'docs/new-unregistered-authority.md'
  ]) expect(resolveMarkdownSkillCoverage(unknown)).toEqual({
    kind: 'repository-content',
    skills: []
  });
});

test('archived YAML remains non-Markdown repository content', () => {
  for (const archivedYaml of [
    'docs/archive/authority-v5/governance/external-capability-ledger.yaml',
    'docs/archive/authority-v5/governance/nexus-absorption-ledger.yaml',
    'docs/archive/authority-v5/work/current-state.yaml'
  ]) {
    expect(resolveMarkdownSkillCoverage(archivedYaml)).toBeNull();
    expect(isRepositoryHeuristicSurface(archivedYaml)).toBeFalse();
    expect(classifyRepositorySurface(archivedYaml)).toEqual({
      kind: 'repository-content',
      skills: []
    });
  }
});

test('GitHub collaboration Markdown remains non-authoritative repository content', () => {
  expect(resolveMarkdownSkillCoverage('.github/PULL_REQUEST_TEMPLATE.md')).toEqual({
    kind: 'repository-content',
    skills: []
  });
  expect(resolveMarkdownSkillCoverage('ARCHITECTURE.md')).toEqual({
    kind: 'repository-content',
    skills: []
  });
  expect(resolveMarkdownSkillCoverage('LICENSES/README.md')).toEqual({
    kind: 'repository-content',
    skills: []
  });
  expect(resolveMarkdownSkillCoverage('README.zh-CN.md')).toEqual({
    kind: 'navigation',
    skills: []
  });
});

test('repository surface classification follows canonical source and test identities', () => {
  expect(classifyRepositorySurface('src/compiler/compile.ts')).toEqual({
    kind: 'product-implementation',
    skills: []
  });
  for (const testPath of [
    'src/adapters/repository/architecture/dependency-policy.test.ts',
    'src/adapters/self-hosting/control/agent/example.test.ts'
  ]) expect(classifyRepositorySurface(testPath)).toEqual({
    kind: 'verification-test',
    skills: []
  });
  for (const retiredPath of ['platform/compiler/compile.ts', 'source/code/app.ts']) {
    expect(classifyRepositorySurface(retiredPath)).toEqual({
      kind: 'repository-content',
      skills: []
    });
  }
});

test('registered heuristic runtime surfaces resolve at least one Skill', () => {
  const files = trackedRepositoryFiles();
  for (const file of files.filter(isRepositoryHeuristicSurface)) {
    const skills = resolveRepositoryHeuristicSkills(file);
    if (skills.length === 0) throw new Error(`Heuristic surface has no Skill owner: ${file}`);
  }
  for (const file of files) expect(classifyRepositorySurface(file)).toBeDefined();

  const agentsCoverage = resolveMarkdownSkillCoverage('AGENTS.md');
  expect(agentsCoverage).toEqual({
    kind: 'agent-projection',
    skills: [
      'sec-heuristic-governance',
      'sec-repository-audit',
      'sec-task-delegation'
    ]
  });
  expect(resolveRepositoryHeuristicSkills('AGENTS.md')).toEqual(agentsCoverage!.skills);
  expect(resolveRepositoryHeuristicSkills('.documentation/documents.json')).toEqual([
    'sec-heuristic-governance',
    'sec-repository-audit'
  ]);
  expect(resolveRepositoryHeuristicSkills(
    'config/external-capabilities/ledger.yaml'
  )).toEqual(['sec-external-capability-governance', 'sec-heuristic-governance']);
  expect(resolveRepositoryHeuristicSkills('src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts')).toEqual([
  ]);
  expect(resolveRepositoryHeuristicSkills('package.json')).toEqual([
  ]);
});

test('documentation and Agent trust-root kinds have focused governance ownership', () => {
  // Repository-wide selection remains owned by the canonical affected-selection
  // operation; this contract fixes only the stable source-kind ownership relation.
  const skillKind = classifyTestImpactSource(
    '.agents/skills/sec-worker-development/SKILL.md',
    isActiveDocumentationPath
  );
  expect(skillKind).toBe('agent-skill');
  expect(testImpactModuleIdsForSourceKind(skillKind)).toEqual(['adapters.self-hosting.control.agent']);

  const documentationKind = classifyTestImpactSource(
    '.documentation/documents.json',
    isActiveDocumentationPath
  );
  expect(documentationKind).toBe('active-documentation');
  expect(testImpactModuleIdsForSourceKind(documentationKind)).toEqual(['adapters.self-hosting.control.documentation']);
});

test('external capability ledger binds repository authority and keeps rejected standing providers retired', async () => {
  const ledgerSource = await readFile(
    path.join(REPOSITORY_ROOT, 'config/external-capabilities/ledger.yaml'),
    'utf8'
  );
  const ledger = parseYaml(ledgerSource) as {
    binding?: { repository?: string };
    providers?: Array<{
      decision?: string;
      id?: string;
      lifecycle?: string;
    }>;
  };
  const graphItLive = ledger.providers?.find((provider) => provider.id === 'graph-it-live-mcp');
  expect(ledger.binding).toEqual({ repository: 'sec-platform/sec' });
  expect(graphItLive?.decision).toBe('reject-with-rationale');
  expect(graphItLive?.lifecycle).toBe('retired');
});
