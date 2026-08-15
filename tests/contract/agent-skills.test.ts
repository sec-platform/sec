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
  resolveSecRepositoryBehaviorRoute,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_AGENT_SKILL_STANDARD_SECTIONS,
  SEC_REPOSITORY_BEHAVIOR_IDS,
  SEC_REPOSITORY_BEHAVIOR_ROUTES,
  type SecAgentSkillId
} from '../../platform/shared/agent-skill-contract.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import {
  activeDocumentationPaths,
  parseDocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import { projectRepositorySourceGovernance } from '../../scripts/codex/repository-audit.ts';

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
    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'name']);
    expect(frontmatter.name).toBe(skillId);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    expect((frontmatter.description as string).length).toBeLessThanOrEqual(1024);
    expect(descriptions.has(frontmatter.description as string)).toBe(false);
    descriptions.add(frontmatter.description as string);
    expect(body.match(/^#\s+/gmu)).toHaveLength(1);
    let previousIndex = -1;
    for (const section of SEC_AGENT_SKILL_STANDARD_SECTIONS) {
      const index = body.indexOf(section);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
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
  const tracked = trackedRepositoryFiles();
  expect(Object.keys(SEC_REPOSITORY_BEHAVIOR_ROUTES).sort()).toEqual(
    [...SEC_REPOSITORY_BEHAVIOR_IDS].sort()
  );
  const routes = SEC_REPOSITORY_BEHAVIOR_IDS.map(resolveSecRepositoryBehaviorRoute);
  const skillOwners = routes
    .filter((route) => route.kind === 'skill')
    .map((route) => route.owner);
  expect(new Set(skillOwners)).toEqual(new Set(SEC_AGENT_SKILL_IDS));
  expect(routes.filter((route) => route.kind === 'deterministic').length).toBeGreaterThan(0);
  expect(SEC_REPOSITORY_BEHAVIOR_IDS.length).toBeGreaterThan(SEC_AGENT_SKILL_IDS.length);
  expect(SEC_AGENT_SKILL_IDS).toHaveLength(7);
  expect(SEC_AGENT_SKILL_IDS).not.toContain('sec-task-delegation');
  expect(resolveSecRepositoryBehaviorRoute('task-delegation')).toEqual({
    kind: 'deterministic',
    owner: 'agent-task-capsule',
    authorityRef: 'platform/shared/agent-task-capsule-contract.ts'
  });
  for (const route of routes) {
    expect(route.owner.length).toBeGreaterThan(0);
    expect(route.authorityRef.length).toBeGreaterThan(0);
    expect(tracked).toContain(route.authorityRef);
  }
});

test('skills preserve decisive boundaries without retaining retired documentation routes', async () => {
  const sources = Object.fromEntries(await Promise.all(SEC_AGENT_SKILL_IDS.map(async (skillId) => [
    skillId,
    await readFile(path.join(SKILLS_ROOT, skillId, 'SKILL.md'), 'utf8')
  ]))) as Record<SecAgentSkillId, string>;
  const agentsSource = await readFile(path.join(REPOSITORY_ROOT, 'AGENTS.md'), 'utf8');
  const tracked = trackedRepositoryFiles();

  for (const source of Object.values(sources)) {
    const executableGuidance = executableSkillGuidance(source);
    expect(executableGuidance).not.toMatch(/git reset --hard/iu);
    expect(executableGuidance).not.toMatch(/git push\s+(?:-f|--force)/iu);
    expect(executableGuidance).not.toContain('sec-work-package-manifest-v1');
    for (const retired of [
      'docs/00-文档索引与一致性规则.md',
      'docs/04-AI自主实现执行蓝图.md',
      'docs/07-Pass状态机、错误码与恢复机制.md',
      'docs/14-Engineering IR与语义事实规范.md',
      'docs/test-feedback-and-ci-lanes.md',
      'docs/test-architecture.md',
      'docs/governance/agent-skills-and-development-run-kernel.md'
    ]) expect(executableGuidance).not.toContain(retired);
  }

  expect(sources['sec-worker-development']).toContain('RequiredClosure ∩ MissingOrStale');
  expect(sources['sec-worker-development']).not.toContain('imports:freeze');
  expect(sources['sec-worker-development']).not.toContain('check:affected');
  expect(sources['sec-repository-audit']).toContain('全部 tracked paths');
  expect(sources['sec-heuristic-governance']).toContain('确定性行为必须有 machine owner 且 Skill 为零');
  expect(sources['sec-heuristic-governance']).toContain('identity/owner/current-spec census');
  expect(sources['sec-heuristic-governance']).toContain('规范化 work identity、owner、current spec');
  expect(sources['sec-heuristic-governance']).toContain('聊天中没有唯一剩余副本');
  expect(sources['sec-architecture-evolution']).toContain('authority first');
  expect(agentsSource).toContain('document-control-plane.ts status --json');
  expect(sources['sec-failure-recovery']).toContain('输入与failure tail未变时复用失败证据并停止');
  expect(sources['sec-failure-recovery']).toContain('自动从exact new main运行canonical document-control status');
  expect(sources['sec-failure-recovery']).toContain('信任代际变化本身不是用户交互点');
  expect(sources['sec-failure-recovery']).toContain('不得把`TASK_RESTART_REQUIRED`当作普通停止理由');
  expect(sources['sec-failure-recovery']).toContain('status unresolved/invalid');
  expect(agentsSource).toContain('不得仅因代际变化返回历史性的 `TASK_RESTART_REQUIRED`');
  expect(agentsSource).not.toContain('GitNexus upstream impact');

  const retiredIds = [
    'sec-a0-integrator',
    'sec-ci-and-merge',
    'sec-context-resume',
    'sec-documentation-governance',
    'sec-impact-and-validation',
    'sec-repository-orientation',
    'sec-task-delegation',
    'sec-toolchain-and-dependencies',
    'sec-trust-root-bootstrap',
    'sec-work-package-lifecycle'
  ];
  for (const retiredId of retiredIds) {
    expect(tracked).not.toContain(`.agents/skills/${retiredId}/SKILL.md`);
    expect(agentsSource).not.toContain(retiredId);
  }
});

test('heuristic discovery guidance covers existing identity, new identity, and no-write boundaries', async () => {
  const source = await readFile(
    path.join(SKILLS_ROOT, 'sec-heuristic-governance', 'SKILL.md'),
    'utf8'
  );
  expect(source).toContain('命中已有 identity 时只更新或引用该 owner');
  expect(source).toContain('确认没有现存 identity 且问题形成独立验收闭包时');
  expect(source).toContain('返回包含既有workId与目标owner的 Reconciliation Delta');
  expect(source).toContain('不得声称已经同步');
  expect(source).toContain('不以新建 Issue/计划文档代替已有identity census');
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
  ]) expect(resolveSecMarkdownSkillCoverage(unknown)).toBeNull();
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
      'sec-repository-audit'
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
  expect(resolveSecRepositoryHeuristicSkills(
    'docs/governance/nexus-absorption-ledger.yaml'
  )).toEqual([
    'sec-external-capability-governance',
    'sec-repository-audit'
  ]);
  expect(resolveSecRepositoryHeuristicSkills('scripts/codex/ci-orchestration-core.ts')).toEqual([
  ]);
  expect(resolveSecRepositoryHeuristicSkills('package.json')).toEqual([
  ]);
});

test('documentation and Agent trust roots have focused governance ownership', () => {
  for (const source of SEC_AGENT_SKILL_IDS.map((skillId) => `.agents/skills/${skillId}/SKILL.md`)) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toEqual(['agent-skill-authoring']);
    expect(selection.fast).toEqual([
      'tests/contract/agent-skills.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/agent-skill-markdown-classification.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ]);
  }

  const sources = [
    'docs/authority.json',
    'docs/scripts/docs-doctor.ts',
    'docs/scripts/docs-doctor-ledgers.ts',
    'docs/scripts/docs-doctor-shared.ts',
    'platform/shared/documentation-authority-contract.ts',
    'platform/shared/active-documentation-contract.ts',
    'platform/shared/agent-skill-contract.ts',
    'scripts/codex/repository-audit.ts'
  ];
  for (const source of sources) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toEqual(expect.arrayContaining(['agent-governance']));
    expect(selection.fast).toEqual(expect.arrayContaining([
      'tests/contract/agent-skills.test.ts',
      'tests/contract/docs-doctor.test.ts',
      'tests/contract/repository-audit.test.ts',
      'tests/contract/test-impact.test.ts'
    ]));
  }
});

test('trust-root changes retain mandatory Risk while ordinary Skill edits remain focused', () => {
  const focused = selectCiPrRiskSlowSuites([
    '.agents/skills/sec-worker-development/SKILL.md'
  ]);
  expect(focused.resolved).toBe(true);
  expect(focused.suites).toEqual([]);

  const trustRoot = selectCiPrRiskSlowSuites([
    'docs/scripts/docs-doctor.ts',
    'docs/scripts/docs-doctor-ledgers.ts',
    'docs/scripts/docs-doctor-shared.ts',
    'platform/shared/documentation-authority-contract.ts',
    'platform/shared/active-documentation-contract.ts',
    'platform/shared/agent-skill-contract.ts',
    'platform/shared/test-impact-rules/governance.ts'
  ]);
  expect(trustRoot.resolved).toBe(true);
  expect(trustRoot.suites.length).toBeGreaterThan(0);
  expect(trustRoot.reasons).toEqual([
    'mandatory-sentinel',
    'ownership-impact'
  ]);
});

test('agent role profiles retain current authority references without retired numbered paths', async () => {
  const profileRoot = path.join(REPOSITORY_ROOT, '.codex', 'agents');
  const profileNames = [
    'architecture-reviewer.toml',
    'implementation-worker.toml',
    'integration-reviewer.toml',
    'repo-state-auditor.toml',
    'verification-evidence-reviewer.toml'
  ];
  const profiles = await Promise.all(profileNames.map(async (name) => ({
    name,
    source: await readFile(path.join(profileRoot, name), 'utf8')
  })));
  expect(profiles.find(({ name }) => name === 'architecture-reviewer.toml')?.source)
    .toContain('docs/authority.json');
  for (const { source } of profiles) {
    expect(source).not.toMatch(/docs\/(?:0[0-9]|1[0-9])[-_]/u);
    expect(source).not.toContain('sec-task-delegation');
    expect(source).not.toContain('current hosted capability');
  }
});

test('external capability ledger binds current package authority without a self-referential main SHA', async () => {
  const [ledgerSource, packageSource] = await Promise.all([
    readFile(path.join(REPOSITORY_ROOT, 'docs/governance/external-capability-ledger.yaml'), 'utf8'),
    readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8')
  ]);
  const ledger = parseYaml(ledgerSource) as {
    binding?: { lockAuthority?: string; packageAuthority?: string; repository?: string };
    providers?: Array<{
      decision?: string;
      id?: string;
      lifecycle?: string;
      observedVersion?: string | null;
      versionAuthority?: {
        kind: 'package';
        dependency: string;
        section: 'dependencies' | 'devDependencies' | 'optionalDependencies';
        declaredSpec: string;
      } | null;
      surfaces?: { cli?: string[]; standingMcp?: string[] };
    }>;
  };
  const packageJson = JSON.parse(packageSource) as { devDependencies?: Record<string, string> };
  const gitnexus = ledger.providers?.find((provider) => provider.id === 'gitnexus');
  const graphItLive = ledger.providers?.find((provider) => provider.id === 'graph-it-live-mcp');
  expect(ledger.binding).toEqual({
    repository: 'sec-platform/sec',
    packageAuthority: 'package.json',
    lockAuthority: 'bun.lock'
  });
  expect(ledgerSource).not.toMatch(/\b[0-9a-f]{40}\b/u);
  expect(gitnexus?.observedVersion).toBe(packageJson.devDependencies?.gitnexus);
  expect(gitnexus?.versionAuthority).toEqual({
    kind: 'package',
    dependency: 'gitnexus',
    section: 'devDependencies',
    declaredSpec: '1.6.3'
  });
  expect(gitnexus?.surfaces?.cli).toEqual(['analyze', 'status']);
  expect(gitnexus?.surfaces?.standingMcp).toEqual([]);
  expect(graphItLive?.decision).toBe('reject-with-rationale');
  expect(graphItLive?.lifecycle).toBe('retired');
});

test('repository documentation resolves registry, the exact package census, and zero docs errors', async () => {
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

test('AGENTS remains a short router and rejects prose-only hard metrics', async () => {
  const agents = await readFile(path.join(REPOSITORY_ROOT, 'AGENTS.md'), 'utf8');
  expect(agents).toContain('docs/authority.json');
  expect(agents).toContain('`.agents/skills/**`');
  expect(agents).toContain('sec');
  expect(agents).not.toContain('产品实现占主动工作时间至少');
  expect(agents).not.toContain('完全重复工具调用 `0`');
  expect(agents.split(/\r?\n/u).length).toBeLessThanOrEqual(24);
});
