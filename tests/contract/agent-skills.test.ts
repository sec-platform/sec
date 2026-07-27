import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { scanDocumentation } from '../../docs/scripts/docs-doctor.ts';
import {
  classifySecRepositorySurface,
  isSecRepositoryHeuristicSurface,
  resolveSecMarkdownSkillCoverage,
  resolveSecRepositoryBehaviorOwner,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_AGENT_SKILL_STANDARD_SECTIONS,
  SEC_REPOSITORY_BEHAVIOR_IDS,
  SEC_REPOSITORY_BEHAVIOR_OWNERS,
  type SecAgentSkillId
} from '../../platform/shared/agent-skill-contract.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, '.agents', 'skills');

interface SkillFrontmatter {
  compatibility?: unknown;
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
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split('\0').filter(Boolean).sort();
}

function readHeadBlob(repositoryPath: string): Uint8Array {
  const result = spawnSync('git', ['show', `HEAD:${repositoryPath}`], {
    cwd: REPOSITORY_ROOT,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git show HEAD:${repositoryPath} failed: ${result.stderr.toString().trim()}`);
  }
  return new Uint8Array(result.stdout);
}

function executableSkillGuidance(source: string): string {
  const prohibitedStart = source.indexOf('## 禁止捷径');
  if (prohibitedStart < 0) throw new Error('Skill is missing the prohibited-shortcuts section.');
  const prohibitedEnd = source.indexOf('\n## ', prohibitedStart + 1);
  return prohibitedEnd < 0
    ? source.slice(0, prohibitedStart)
    : source.slice(0, prohibitedStart) + source.slice(prohibitedEnd);
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

    expect(Object.keys(frontmatter).sort()).toEqual(['compatibility', 'description', 'name']);
    expect(frontmatter.name).toBe(skillId);
    expect(skillId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    expect((frontmatter.description as string).length).toBeLessThanOrEqual(1024);
    expect(frontmatter.description as string).toMatch(/用于|当.+时|Use when/u);
    expect(descriptions.has(frontmatter.description as string)).toBe(false);
    descriptions.add(frontmatter.description as string);
    expect(typeof frontmatter.compatibility).toBe('string');
    expect((frontmatter.compatibility as string).length).toBeLessThanOrEqual(500);
    expect(body.match(/^#\s+/gmu)).toHaveLength(1);

    let previousIndex = -1;
    for (const section of SEC_AGENT_SKILL_STANDARD_SECTIONS) {
      const index = body.indexOf(section);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  }
});

test('every repository behavior has one Skill owner and every Skill owns one behavior', () => {
  expect(Object.keys(SEC_REPOSITORY_BEHAVIOR_OWNERS).sort()).toEqual(
    [...SEC_REPOSITORY_BEHAVIOR_IDS].sort()
  );
  const owners = SEC_REPOSITORY_BEHAVIOR_IDS.map((behavior) =>
    resolveSecRepositoryBehaviorOwner(behavior));
  expect(new Set(owners)).toEqual(new Set(SEC_AGENT_SKILL_IDS));
  expect(owners).toHaveLength(SEC_AGENT_SKILL_IDS.length);
});

test('skills prohibit destructive shortcuts and preserve decisive boundaries', async () => {
  const sources = Object.fromEntries(await Promise.all(SEC_AGENT_SKILL_IDS.map(async (skillId) => [
    skillId,
    await readFile(path.join(SKILLS_ROOT, skillId, 'SKILL.md'), 'utf8')
  ]))) as Record<SecAgentSkillId, string>;

  for (const source of Object.values(sources)) {
    const executableGuidance = executableSkillGuidance(source);
    expect(executableGuidance).not.toMatch(/git reset --hard/iu);
    expect(executableGuidance).not.toMatch(/git push\s+(?:-f|--force)/iu);
    expect(executableGuidance).not.toContain('sec-work-package-manifest-v1');
  }

  expect(sources['sec-ci-and-merge']).toContain('client_payload[pull_request]');
  expect(sources['sec-ci-and-merge']).toContain('client_payload[expected_head]');
  expect(sources['sec-ci-and-merge']).toContain('client_payload[expected_base]');
  expect(sources['sec-ci-and-merge']).toContain('client_payload[manifest_digest]');
  expect(sources['sec-ci-and-merge']).toContain('codex-development-frozen-verification-request-v1');
  expect(sources['sec-ci-and-merge']).toContain('client_payload[manifest_path]');
  expect(sources['sec-ci-and-merge']).toContain('client_payload[profile]');
  expect(sources['sec-ci-and-merge']).toContain('sha=$EXPECTED_HEAD');
  expect(sources['sec-ci-and-merge']).toContain('merged: true');

  expect(sources['sec-work-package-lifecycle']).toContain('codex-development-work-package-v1');
  expect(sources['sec-work-package-lifecycle']).toContain('codex-development-work-package-v2');
  expect(sources['sec-work-package-lifecycle']).toContain('matchingDefaultBlob: none');

  expect(sources['sec-worker-development']).toContain('bun run check:affected --plan');
  expect(sources['sec-worker-development']).toContain('bun run check:affected');
  expect(sources['sec-worker-development']).toContain('bun run imports:freeze');
  expect(sources['sec-worker-development']).toContain('candidate invalidation');

  expect(sources['sec-context-resume']).toContain('validated deterministic resume');
  expect(sources['sec-context-resume']).toContain('Git common dir');
  expect(sources['sec-context-resume']).toContain('runId');
  expect(sources['sec-context-resume']).toContain('recoveryRequired');
  expect(sources['sec-context-resume']).toContain('manual-shadow');

  expect(sources['sec-repository-audit']).toContain('git ls-tree -r -z -l');
  expect(sources['sec-repository-audit']).toContain('全部 tracked paths');
  expect(sources['sec-repository-audit']).toContain('不得以搜索命中');
  expect(sources['sec-heuristic-governance']).toContain('确定性合同');
  expect(sources['sec-heuristic-governance']).toContain('唯一 Skill');
  expect(sources['sec-architecture-evolution']).toContain('authority first');
  expect(sources['sec-architecture-evolution']).toContain('第二pipeline');

  expect(sources['sec-external-capability-governance']).toContain('不保留无消费者的MCP配置');
  expect(sources['sec-toolchain-and-dependencies']).toContain('保留CLI不等于保留MCP入口');
});

test('all tracked Markdown is classified and active surfaces have Skill coverage', () => {
  const markdown = trackedRepositoryFiles().filter((file) => file.endsWith('.md'));
  expect(markdown.length).toBeGreaterThan(0);

  for (const file of markdown) {
    const coverage = resolveSecMarkdownSkillCoverage(file);
    if (!coverage) throw new Error(`Tracked Markdown is unclassified: ${file}`);
    if (coverage.kind === 'active-authority'
      || coverage.kind === 'agent-projection'
      || coverage.kind === 'repository-content') {
      if (coverage.skills.length === 0) {
        throw new Error(`Active Markdown has no Skill coverage: ${file}`);
      }
    }
  }

  for (const nonMarkdownEvidence of [
    'docs/evidence/result.json',
    'docs/archive/result.json',
    'docs/superpowers/result.yaml'
  ]) {
    expect(resolveSecMarkdownSkillCoverage(nonMarkdownEvidence)).toBeNull();
    expect(classifySecRepositorySurface(nonMarkdownEvidence).kind).not.toBe('markdown');
  }
});

test('every registered heuristic runtime surface resolves at least one Skill', () => {
  const files = trackedRepositoryFiles();
  for (const file of files.filter(isSecRepositoryHeuristicSurface)) {
    const skills = resolveSecRepositoryHeuristicSkills(file);
    if (skills.length === 0) throw new Error(`Heuristic surface has no Skill owner: ${file}`);
  }
  for (const file of files) expect(classifySecRepositorySurface(file)).toBeDefined();

  expect(resolveSecRepositoryHeuristicSkills('docs/work/current-state.yaml')).toEqual([
    'sec-a0-integrator',
    'sec-documentation-governance',
    'sec-repository-audit',
    'sec-repository-orientation',
    'sec-work-package-lifecycle'
  ]);
  expect(resolveSecRepositoryHeuristicSkills(
    'docs/governance/external-capability-ledger.yaml'
  )).toEqual(['sec-external-capability-governance', 'sec-heuristic-governance']);
  expect(resolveSecRepositoryHeuristicSkills(
    'docs/governance/nexus-absorption-ledger.yaml'
  )).toEqual([
    'sec-external-capability-governance',
    'sec-repository-audit',
    'sec-repository-orientation'
  ]);
  expect(resolveSecRepositoryHeuristicSkills('scripts/codex/repository-audit.ts')).toEqual([
    'sec-heuristic-governance',
    'sec-repository-audit'
  ]);
});

test('every Skill and audit authority source has focused agent-governance ownership', () => {
  const sources = [
    ...SEC_AGENT_SKILL_IDS.map((skillId) => `.agents/skills/${skillId}/SKILL.md`),
    'platform/shared/agent-skill-contract.ts',
    'scripts/codex/repository-audit.ts'
  ];
  for (const source of sources) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toEqual(['agent-governance']);
    expect(selection.fast).toEqual([
      'tests/contract/agent-skills.test.ts',
      'tests/contract/discover-all.test.ts',
      'tests/contract/repository-audit.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ]);
    expect(selection.slow).toEqual([]);
  }
});

test('focused Skill inputs avoid slow fallback while trust-root changes retain mandatory Risk', () => {
  const focused = selectCiPrRiskSlowSuites([
    ...SEC_AGENT_SKILL_IDS.map((skillId) => `.agents/skills/${skillId}/SKILL.md`),
    'scripts/codex/repository-audit.ts'
  ]);
  expect(focused.resolved).toBe(true);
  expect(focused.suites).toEqual([]);
  expect(focused.slowTests).toEqual([]);
  expect(focused.affectedSlowTests).toEqual([]);
  expect(focused.reasons).toEqual(['ownership-impact']);

  const trustRoot = selectCiPrRiskSlowSuites([
    'platform/shared/agent-skill-contract.ts',
    'platform/shared/test-impact-rules/governance.ts',
    'package.json'
  ]);
  expect(trustRoot.resolved).toBe(true);
  expect(trustRoot.suites.length).toBeGreaterThan(0);
  expect(trustRoot.reasons).toEqual(expect.arrayContaining([
    'bounded-baseline',
    'mandatory-sentinel',
    'ownership-impact'
  ]));
  expect(trustRoot.owners).toEqual(expect.arrayContaining([
    'bounded-slow-risk',
    'verification-infrastructure'
  ]));
});

test('MCP entrypoints are retired while GitNexus and Graphify CLI analysis remain', async () => {
  const packageJson = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(await Bun.file(path.join(REPOSITORY_ROOT, '.mcp.json')).exists()).toBe(false);
  expect(await Bun.file(path.join(REPOSITORY_ROOT, 'scripts/cleanup-mcp.ps1')).exists()).toBe(false);
  expect(packageJson.scripts['gitnexus:mcp']).toBeUndefined();
  expect(packageJson.scripts['gitnexus:analyze']).toBeDefined();
  expect(packageJson.scripts['gitnexus:status']).toBeDefined();
  expect(packageJson.scripts.graphify).toBeDefined();
  expect(packageJson.scripts['audit:repository']).toBeDefined();
});

test('external capability ledger freezes MCP retirement without retiring CLI analysis', async () => {
  const ledger = parseYaml(await readFile(
    path.join(REPOSITORY_ROOT, 'docs', 'governance', 'external-capability-ledger.yaml'),
    'utf8'
  )) as {
    providers?: Array<{
      decision?: { rationale?: string; value?: string };
      id?: string;
      lifecycle?: { state?: string };
      toolSurface?: { cliCommands?: string[]; mcpToolsExposedByDefault?: string[] };
    }>;
  };
  const gitnexus = ledger.providers?.find((provider) => provider.id === 'gitnexus');
  const graphItLive = ledger.providers?.find((provider) => provider.id === 'graph-it-live-mcp');

  expect(gitnexus?.toolSurface?.cliCommands).toEqual(['analyze', 'status']);
  expect(gitnexus?.toolSurface?.mcpToolsExposedByDefault).toEqual([]);
  expect(gitnexus?.decision?.rationale).toContain('standing GitNexus MCP server');
  expect(graphItLive?.decision?.value).toBe('reject-with-rationale');
  expect(graphItLive?.lifecycle?.state).toBe('retired');
});

test('repository documentation resolves one selected Work Package and audit authority', async () => {
  const docsRoot = path.join(REPOSITORY_ROOT, 'docs');
  const result = await scanDocumentation({
    docsRoot,
    repositoryRoot: REPOSITORY_ROOT,
    readCandidateManifestBlob: async (manifestPath) => readHeadBlob(manifestPath)
  });
  expect(result.errors).toEqual([]);

  const authority = await readFile(
    path.join(docsRoot, 'governance', 'agent-skills-and-development-run-kernel.md'),
    'utf8'
  );
  for (const marker of [
    'AgentOperation',
    '全仓库覆盖',
    '全 Markdown 覆盖',
    '全仓库审计',
    '启发式抽取',
    '架构演进',
    'V19 可验证确定性续跑',
    '<git-common-dir>/sec-codex/runs/<run-id>/',
    'repository-level intake spool',
    'PreCompact',
    'recoveryRequired',
    'WP-A Development Run Kernel Shadow',
    'WP-B Project Hook Activation'
  ]) expect(authority).toContain(marker);
});

test('AGENTS keeps Skills as compiled projections instead of a second authority', async () => {
  const agents = await readFile(path.join(REPOSITORY_ROOT, 'AGENTS.md'), 'utf8');
  expect(agents).toContain('`.agents/skills/**`');
  expect(agents).toContain('`platform/shared/agent-skill-contract.ts`');
  expect(agents).toContain('全部 tracked Markdown');
  expect(agents).toContain('sec-repository-audit');
  expect(agents).toContain('sec-heuristic-governance');
  expect(agents).toContain('sec-architecture-evolution');
  expect(agents).toContain('V19');
});
