import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { projectRepositorySourceGovernance } from '../../src/brownfield/repository-audit/cli.ts';
import {
  classifySecRepositorySurface,
  isSecRepositoryHeuristicSurface,
  resolveSecMarkdownSkillCoverage,
  resolveSecRepositoryBehaviorRoute,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_BEHAVIOR_IDS
} from '../../src/control/agent/skill.ts';
import {
  activeDocumentationPaths,
  parseDocumentationAuthorityRegistry
} from '../../src/control/documentation/authority.ts';
import { selectTestsForSources } from '../../src/verification/test-impact/runtime/impact.ts';

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

function readGitBlob(repositoryRef: string, repositoryPath: string): Uint8Array;
function readGitBlob(repositoryRef: string, repositoryPath: string, allowMissing: true): Uint8Array | null;
function readGitBlob(
  repositoryRef: string,
  repositoryPath: string,
  allowMissing = false
): Uint8Array | null {
  if (repositoryRef !== 'HEAD'
      && !/^(?:[0-9a-f]{40}|refs\/remotes\/[A-Za-z0-9._-]+\/[A-Za-z0-9._\/-]+)$/u.test(repositoryRef)) {
    throw new Error(`Git fixture ref is noncanonical: ${repositoryRef}`);
  }
  if (!/^docs\/[A-Za-z0-9._\/-]+$/u.test(repositoryPath)) {
    throw new Error(`Git fixture path is noncanonical: ${repositoryPath}`);
  }
  const result = spawnSync('git', ['show', `${repositoryRef}:${repositoryPath}`], {
    cwd: REPOSITORY_ROOT,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowMissing) return null;
    throw new Error(`git show ${repositoryRef}:${repositoryPath} failed: ${result.stderr.toString().trim()}`);
  }
  return new Uint8Array(result.stdout);
}

function listGitWorkPackagePaths(repositoryRef: string): readonly string[] {
  const result = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', repositoryRef, '--', 'docs/work-packages'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ls-tree ${repositoryRef} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split('\n').filter(Boolean);
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

test('repository behaviors route to deterministic owners or one bounded Skill', () => {
  const routes = SEC_REPOSITORY_BEHAVIOR_IDS.map(resolveSecRepositoryBehaviorRoute);
  const skillOwners = routes
    .filter((route) => route.kind === 'skill')
    .map((route) => route.owner);
  expect(new Set(skillOwners)).toEqual(new Set(SEC_AGENT_SKILL_IDS));
  expect(routes.filter((route) => route.kind === 'deterministic').length).toBeGreaterThan(0);
  expect(SEC_REPOSITORY_BEHAVIOR_IDS.length).toBeGreaterThan(SEC_AGENT_SKILL_IDS.length);
  expect(resolveSecRepositoryBehaviorRoute('task-delegation')).toEqual({
    kind: 'skill',
    owner: 'sec-task-delegation',
    authorityRef: '.agents/skills/sec-task-delegation/SKILL.md'
  });
  expect(resolveSecRepositoryBehaviorRoute('governance-self-correction')).toEqual({
    kind: 'skill',
    owner: 'sec-heuristic-governance',
    authorityRef: '.agents/skills/sec-heuristic-governance/SKILL.md'
  });
  for (const route of routes) {
    expect(route.owner.length).toBeGreaterThan(0);
    if (route.kind === 'skill') {
      expect(route.authorityRef).toBe(`.agents/skills/${route.owner}/SKILL.md`);
    } else {
      expect(route.operation).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u);
    }
  }
});

test('all tracked Markdown is explicitly classified and active registry paths have coverage', async () => {
  const tracked = trackedRepositoryFiles();
  const registry = parseDocumentationAuthorityRegistry(
    await readFile(path.join(REPOSITORY_ROOT, 'docs/authority.json'), 'utf8')
  );
  const active = new Set(activeDocumentationPaths(registry));

  for (const file of tracked.filter((candidate) => candidate.endsWith('.md'))) {
    const coverage = resolveSecMarkdownSkillCoverage(file);
    if (!coverage) throw new Error(`Tracked Markdown is unclassified: ${file}`);
    if (active.has(file)) expect(coverage.kind).toBeDefined();
  }

  for (const unknown of [
    'docs/00-文档索引与一致性规则.md',
    'docs/architecture/unowned.md',
    'docs/new-unregistered-authority.md'
  ]) expect(resolveSecMarkdownSkillCoverage(unknown)).toEqual({
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
    expect(resolveSecMarkdownSkillCoverage(archivedYaml)).toBeNull();
    expect(isSecRepositoryHeuristicSurface(archivedYaml)).toBeFalse();
    expect(classifySecRepositorySurface(archivedYaml)).toEqual({
      kind: 'repository-content',
      skills: []
    });
  }
});

test('registered heuristic runtime surfaces resolve at least one Skill', () => {
  const files = trackedRepositoryFiles();
  for (const file of files.filter(isSecRepositoryHeuristicSurface)) {
    const skills = resolveSecRepositoryHeuristicSkills(file);
    if (skills.length === 0) throw new Error(`Heuristic surface has no Skill owner: ${file}`);
  }
  for (const file of files) expect(classifySecRepositorySurface(file)).toBeDefined();

  const agentsCoverage = resolveSecMarkdownSkillCoverage('AGENTS.md');
  expect(agentsCoverage).toEqual({
    kind: 'agent-projection',
    skills: [
      'sec-heuristic-governance',
      'sec-repository-audit',
      'sec-task-delegation'
    ]
  });
  expect(resolveSecRepositoryHeuristicSkills('AGENTS.md')).toEqual(agentsCoverage!.skills);
  expect(resolveSecRepositoryHeuristicSkills('docs/authority.json')).toEqual([
    'sec-heuristic-governance',
    'sec-repository-audit'
  ]);
  expect(resolveSecRepositoryHeuristicSkills(
    'docs/governance/external-capability-ledger.yaml'
  )).toEqual(['sec-external-capability-governance', 'sec-heuristic-governance']);
  expect(resolveSecRepositoryHeuristicSkills('src/verification/ci/runtime/ci-orchestration-core.ts')).toEqual([
  ]);
  expect(resolveSecRepositoryHeuristicSkills('package.json')).toEqual([
  ]);
});

test('documentation and Agent trust roots have focused governance ownership', () => {
  const skillSelection = selectTestsForSources(['.agents/skills/sec-worker-development/SKILL.md']);
  expect(skillSelection.owners).toEqual(['control.agent']);
  expect(skillSelection.fast.length).toBeGreaterThan(0);

  const documentationSelection = selectTestsForSources(['docs/authority.json']);
  expect(documentationSelection.owners).toEqual(['control.documentation']);
  expect(documentationSelection.fast.length).toBeGreaterThan(0);
});

test('external capability ledger binds repository authority and keeps rejected standing providers retired', async () => {
  const ledgerSource = await readFile(
    path.join(REPOSITORY_ROOT, 'docs/governance/external-capability-ledger.yaml'),
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

test('repository documentation resolves registry, the exact package census, and zero docs errors', async () => {
  const { scanDocumentation } = await import('../../src/control/documentation/doctor/cli.ts');
  const result = await scanDocumentation({
    docsRoot: path.join(REPOSITORY_ROOT, 'docs'),
    repositoryRoot: REPOSITORY_ROOT,
    readControlPlaneBlob: async (repositoryPath) => readGitBlob('HEAD', repositoryPath),
    listControlPlanePackagePaths: async () => listGitWorkPackagePaths('HEAD'),
    readDefaultBranchBlob: async (defaultBranchRef, repositoryPath) =>
      readGitBlob(defaultBranchRef, repositoryPath, true)
  });
  expect(result.errors).toEqual([]);
});
