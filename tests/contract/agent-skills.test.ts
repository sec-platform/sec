import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { scanDocumentation } from '../../docs/scripts/docs-doctor.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, '.agents', 'skills');
const SKILL_IDS = [
  'sec-a0-integrator',
  'sec-ci-and-merge',
  'sec-work-package-lifecycle',
  'sec-worker-development'
] as const;

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

test('SEC skill inventory conforms to the strict Agent Skills identity contract', async () => {
  const entries = (await readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  expect(entries).toEqual([...SKILL_IDS]);

  const descriptions = new Set<string>();
  for (const skillId of SKILL_IDS) {
    const source = await readFile(path.join(SKILLS_ROOT, skillId, 'SKILL.md'), 'utf8');
    const { frontmatter, body } = parseSkill(source);
    const keys = Object.keys(frontmatter).sort();

    expect(keys).toEqual(['compatibility', 'description', 'name']);
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
  }
});

test('SEC skills prohibit destructive shortcuts and preserve canonical command contracts', async () => {
  const sources = Object.fromEntries(await Promise.all(SKILL_IDS.map(async (skillId) => [
    skillId,
    await readFile(path.join(SKILLS_ROOT, skillId, 'SKILL.md'), 'utf8')
  ])));

  for (const source of Object.values(sources)) {
    expect(source).not.toMatch(/git reset --hard/iu);
    expect(source).not.toMatch(/git push\s+(?:-f|--force)/iu);
    expect(source).not.toContain('sec-work-package-manifest-v1');
  }

  expect(sources['sec-a0-integrator']).toContain('client_payload[pull_request]');
  expect(sources['sec-a0-integrator']).toContain('client_payload[expected_head]');
  expect(sources['sec-a0-integrator']).toContain('client_payload[expected_base]');
  expect(sources['sec-a0-integrator']).toContain('client_payload[manifest_digest]');
  expect(sources['sec-a0-integrator']).toContain('codex-development-frozen-verification-request-v1');
  expect(sources['sec-a0-integrator']).toContain('client_payload[manifest_path]');
  expect(sources['sec-a0-integrator']).toContain('client_payload[profile]');

  expect(sources['sec-ci-and-merge']).toContain('-f "sha=$EXPECTED_HEAD"');
  expect(sources['sec-ci-and-merge']).toContain('merged: true');
  expect(sources['sec-ci-and-merge']).toContain('manual bootstrap');

  expect(sources['sec-work-package-lifecycle']).toContain('codex-development-work-package-v1');
  expect(sources['sec-work-package-lifecycle']).toContain('codex-development-work-package-v2');
  expect(sources['sec-work-package-lifecycle']).toContain('禁止把仍被 pointer引用的 selected manifest移入 archive');
  expect(sources['sec-work-package-lifecycle']).toContain('matchingDefaultBlob');

  expect(sources['sec-worker-development']).toContain('bun run imports:freeze');
  expect(sources['sec-worker-development']).toContain('candidate invalidation');
  expect(sources['sec-worker-development']).toContain('STOP_PROOF_RESET');
  expect(sources['sec-worker-development']).not.toContain('bun run imports:check');
});

test('every SEC skill path has one agent-governance owner and focused contract', () => {
  for (const skillId of SKILL_IDS) {
    const source = `.agents/skills/${skillId}/SKILL.md`;
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

test('restored repository tooling and removed report have exact focused owners', () => {
  expect(selectTestsForSources(['.mcp.json'])).toEqual({
    fast: [
      'tests/contract/repository-runtime.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ],
    slow: [],
    owners: ['repository-tooling-config']
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

test('skill, tooling, and report changes remain resolved without slow fallback', () => {
  const sources = [
    ...SKILL_IDS.map((skillId) => `.agents/skills/${skillId}/SKILL.md`),
    '.mcp.json',
    'docs/evidence/2026-07-27-markdown-docs-analysis.md'
  ];
  const selection = selectCiPrRiskSlowSuites(sources);

  expect(selection.resolved).toBe(true);
  expect(selection.suites).toEqual([]);
  expect(selection.slowTests).toEqual([]);
  expect(selection.affectedSlowTests).toEqual([]);
  expect(selection.reasons).toEqual(['ownership-impact']);
  expect(selection.owners).toEqual([
    'agent-governance',
    'documentation-evidence-cleanup',
    'repository-tooling-config'
  ]);
});

test('repository documentation resolves one existing selected Work Package with no errors', async () => {
  const docsRoot = path.join(REPOSITORY_ROOT, 'docs');
  const result = await scanDocumentation({
    docsRoot,
    repositoryRoot: REPOSITORY_ROOT,
    readCandidateManifestBlob: (manifestPath) => readFile(path.join(REPOSITORY_ROOT, manifestPath))
  });

  expect(result.errors).toEqual([]);
});

test('AGENTS declares skills as tested projections rather than a second authority', async () => {
  const agents = await readFile(path.join(REPOSITORY_ROOT, 'AGENTS.md'), 'utf8');

  expect(agents).toContain('`.agents/skills/**` 只保存本合同与 canonical owner 的窄幅可执行投影');
  expect(agents).toContain('`tests/contract/agent-skills.test.ts`机器校验');
});
