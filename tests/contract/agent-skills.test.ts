import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { scanDocumentation } from '../../docs/scripts/docs-doctor.ts';
import {
  classifySecRepositorySurface,
  resolveSecMarkdownSkillCoverage,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_AGENT_SKILL_STANDARD_SECTIONS
} from '../../platform/shared/agent-skill-contract.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, '.agents', 'skills');
const WALK_SKIPS = new Set([
  '.git',
  '.next',
  '.shared-deps',
  '.tmp',
  'build',
  'dist',
  'node_modules',
  'playwright-report',
  'project',
  'report',
  'test-results'
]);

type SkillFrontmatter = {
  name?: unknown;
  description?: unknown;
  compatibility?: unknown;
};

function parseSkill(source: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (!match) throw new Error('Skill must contain one leading YAML frontmatter block.');
  const raw = parseYaml(match[1]!) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Skill frontmatter must be a mapping.');
  }
  return { frontmatter: raw as SkillFrontmatter, body: match[2]! };
}

async function walkRepository(dir = REPOSITORY_ROOT): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (WALK_SKIPS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkRepository(full));
    } else if (entry.isFile()) {
      files.push(path.relative(REPOSITORY_ROOT, full).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function isHeuristicSurface(path: string): boolean {
  return path === 'AGENTS.md'
    || path === 'platform/dev-runner.ts'
    || path === 'scripts/install-git-hooks.ts'
    || path === 'scripts/run-work-package-gate.ts'
    || /^\.agents\/skills\//u.test(path)
    || /^\.codex\/agents\//u.test(path)
    || /^\.github\/workflows\//u.test(path)
    || /^\.githooks\//u.test(path)
    || /^scripts\/codex\//u.test(path)
    || /^scripts\/ci-[^/]+\.ts$/u.test(path)
    || /^docs\/scripts\//u.test(path)
    || /^platform\/dev-runner\//u.test(path)
    || /^platform\/shared\/(?:ci-|test-impact|test-ownership|affected-test|verification-scope)/u.test(path)
    || /^platform\/shared\/test-impact-rules\//u.test(path)
    || /^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|\.bun-version)$/u.test(path);
}

test('SEC skill inventory conforms to one strict AgentOperation contract', async () => {
  const entries = (await readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  expect(entries).toEqual([...SEC_AGENT_SKILL_IDS]);

  const descriptions = new Set<string>();
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const source = await readFile(path.join(SKILLS_ROOT, skillId, 'SKILL.md'), 'utf8');
    const { frontmatter, body } = parseSkill(source);

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
    for (const section of SEC_AGENT_SKILL_STANDARD_SECTIONS) expect(body).toContain(section);
  }
});

test('skills prohibit destructive shortcuts and preserve decisive boundaries', async () => {
  const sources = Object.fromEntries(await Promise.all(SEC_AGENT_SKILL_IDS.map(async (skillId) => [
    skillId,
    await readFile(path.join(SKILLS_ROOT, skillId, 'SKILL.md'), 'utf8')
  ])));

  for (const source of Object.values(sources)) {
    expect(source).not.toMatch(/git reset --hard/iu);
    expect(source).not.toMatch(/git push\s+(?:-f|--force)/iu);
    expect(source).not.toContain('sec-work-package-manifest-v1');
  }

  expect(sources['sec-ci-and-merge']).toContain('pull_request');
  expect(sources['sec-ci-and-merge']).toContain('expected_head');
  expect(sources['sec-ci-and-merge']).toContain('expected_base');
  expect(sources['sec-ci-and-merge']).toContain('manifest_digest');
  expect(sources['sec-ci-and-merge']).toContain('manifest_path');
  expect(sources['sec-ci-and-merge']).toContain('profile');
  expect(sources['sec-ci-and-merge']).toContain('merged: true');

  expect(sources['sec-work-package-lifecycle']).toContain('codex-development-work-package-v1');
  expect(sources['sec-work-package-lifecycle']).toContain('codex-development-work-package-v2');
  expect(sources['sec-work-package-lifecycle']).toContain('matchingDefaultBlob: none');

  expect(sources['sec-worker-development']).toContain('bun run imports:freeze');
  expect(sources['sec-worker-development']).toContain('candidate invalidation');

  expect(sources['sec-context-resume']).toContain('validated deterministic resume');
  expect(sources['sec-context-resume']).toContain('Git common dir');
  expect(sources['sec-context-resume']).toContain('runId');
  expect(sources['sec-context-resume']).toContain('recoveryRequired');
  expect(sources['sec-context-resume']).toContain('manual-shadow');

  expect(sources['sec-external-capability-governance']).toContain('不保留无消费者的MCP配置');
  expect(sources['sec-toolchain-and-dependencies']).toContain('保留CLI不等于保留MCP入口');
});

test('all repository Markdown is classified and every active authority has skill coverage', async () => {
  const markdown = (await walkRepository()).filter((file) => file.endsWith('.md'));
  expect(markdown.length).toBeGreaterThan(0);

  for (const file of markdown) {
    const coverage = resolveSecMarkdownSkillCoverage(file);
    expect(coverage, file).not.toBeNull();
    if (coverage?.kind === 'active-authority' || coverage?.kind === 'agent-projection') {
      expect(coverage.skills.length, file).toBeGreaterThan(0);
    }
  }
});

test('every repository heuristic runtime surface resolves at least one skill', async () => {
  const files = await walkRepository();
  for (const file of files.filter(isHeuristicSurface)) {
    expect(resolveSecRepositoryHeuristicSkills(file).length, file).toBeGreaterThan(0);
  }
  for (const file of files) expect(classifySecRepositorySurface(file)).toBeDefined();
});

test('every Skill and skill authority source has focused agent-governance ownership', () => {
  const sources = [
    ...SEC_AGENT_SKILL_IDS.map((skillId) => `.agents/skills/${skillId}/SKILL.md`),
    'platform/shared/agent-skill-contract.ts'
  ];
  for (const source of sources) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toEqual(['agent-governance']);
    expect(selection.fast).toEqual([
      'tests/contract/agent-skills.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ]);
    expect(selection.slow).toEqual([]);
  }
});

test('retired MCP cleanup and unsupported report have exact focused owners', () => {
  expect(selectTestsForSources(['scripts/cleanup-mcp.ps1'])).toEqual({
    fast: [
      'tests/contract/agent-skills.test.ts',
      'tests/contract/repository-runtime.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ],
    slow: [],
    owners: ['external-capability-retirement']
  });

  expect(selectTestsForSources([
    'docs/evidence/2026-07-27-markdown-docs-analysis.md'
  ])).toEqual({
    fast: [
      'tests/contract/agent-skills.test.ts',
      'tests/contract/docs-doctor.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ],
    slow: [],
    owners: ['documentation-evidence-cleanup']
  });
});

test('focused skill inputs avoid slow fallback while trust-root changes retain mandatory Risk', () => {
  const focused = selectCiPrRiskSlowSuites([
    ...SEC_AGENT_SKILL_IDS.map((skillId) => `.agents/skills/${skillId}/SKILL.md`),
    'scripts/cleanup-mcp.ps1',
    'docs/evidence/2026-07-27-markdown-docs-analysis.md'
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
});

test('repository documentation resolves one selected Work Package and V19 authority', async () => {
  const docsRoot = path.join(REPOSITORY_ROOT, 'docs');
  const result = await scanDocumentation({
    docsRoot,
    repositoryRoot: REPOSITORY_ROOT,
    readCandidateManifestBlob: (manifestPath) => readFile(path.join(REPOSITORY_ROOT, manifestPath))
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
  expect(agents).toContain('V19');
});
