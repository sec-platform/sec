export const SEC_AGENT_SKILL_IDS = [
  'sec-a0-integrator',
  'sec-ci-and-merge',
  'sec-context-resume',
  'sec-documentation-governance',
  'sec-exact-head-review',
  'sec-external-capability-governance',
  'sec-failure-recovery',
  'sec-impact-and-validation',
  'sec-repository-orientation',
  'sec-task-delegation',
  'sec-toolchain-and-dependencies',
  'sec-trust-root-bootstrap',
  'sec-work-package-lifecycle',
  'sec-worker-development'
] as const;

export type SecAgentSkillId = (typeof SEC_AGENT_SKILL_IDS)[number];

export const SEC_AGENT_SKILL_STANDARD_SECTIONS = [
  '## 触发',
  '## 不触发',
  '## 输入',
  '## 执行',
  '## 停止条件',
  '## 禁止捷径',
  '## 权威'
] as const;

export type SecMarkdownSurfaceKind =
  | 'skill-definition'
  | 'agent-projection'
  | 'active-authority'
  | 'frozen-work-package'
  | 'evidence'
  | 'historical';

export type SecMarkdownSkillCoverage = {
  kind: SecMarkdownSurfaceKind;
  skills: SecAgentSkillId[];
};

function skills(...ids: SecAgentSkillId[]): SecAgentSkillId[] {
  return [...new Set(ids)].sort();
}

function skillIdFromPath(path: string): SecAgentSkillId | null {
  const match = /^\.agents\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path);
  if (!match) return null;
  return SEC_AGENT_SKILL_IDS.includes(match[1] as SecAgentSkillId)
    ? match[1] as SecAgentSkillId
    : null;
}

export function resolveSecMarkdownSkillCoverage(path: string): SecMarkdownSkillCoverage | null {
  const skillId = skillIdFromPath(path);
  if (skillId) return { kind: 'skill-definition', skills: [skillId] };
  if (path === 'AGENTS.md') {
    return {
      kind: 'agent-projection',
      skills: skills('sec-repository-orientation', 'sec-a0-integrator', 'sec-context-resume')
    };
  }
  if (path === 'README.md') {
    return {
      kind: 'active-authority',
      skills: skills('sec-repository-orientation', 'sec-documentation-governance')
    };
  }
  if (/^docs\/work-packages\/[^/]+\.md$/u.test(path)) {
    return { kind: 'frozen-work-package', skills: [] };
  }
  if (/^docs\/evidence\//u.test(path)) return { kind: 'evidence', skills: [] };
  if (/^docs\/(?:archive|superpowers)\//u.test(path)) return { kind: 'historical', skills: [] };
  if (!/^docs\/.*\.md$/u.test(path)) return null;

  if (path === 'docs/00-文档索引与一致性规则.md'
    || path === 'docs/governance/agent-skills-and-development-run-kernel.md') {
    return {
      kind: 'active-authority',
      skills: skills('sec-documentation-governance', 'sec-context-resume')
    };
  }
  if (path === 'docs/04-AI自主实现执行蓝图.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-repository-orientation',
        'sec-a0-integrator',
        'sec-work-package-lifecycle',
        'sec-task-delegation',
        'sec-worker-development',
        'sec-impact-and-validation',
        'sec-exact-head-review',
        'sec-ci-and-merge',
        'sec-trust-root-bootstrap',
        'sec-context-resume',
        'sec-failure-recovery'
      )
    };
  }
  if (/^docs\/work\//u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills('sec-a0-integrator', 'sec-work-package-lifecycle', 'sec-documentation-governance')
    };
  }
  if (/^docs\/(?:test-architecture|test-feedback-and-ci-lanes|slow-suite-registry)\.md$/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills('sec-impact-and-validation', 'sec-ci-and-merge', 'sec-trust-root-bootstrap')
    };
  }
  if (/^docs\/governance\/(?:external-capability|nexus-)/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills('sec-external-capability-governance', 'sec-repository-orientation')
    };
  }
  if (/^docs\/(?:0[1-3]-|goals\/)/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills('sec-repository-orientation', 'sec-a0-integrator', 'sec-documentation-governance')
    };
  }
  if (/^docs\/(?:0[5-9]-|1[0-4]-|architecture\/)/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-worker-development',
        'sec-impact-and-validation',
        'sec-exact-head-review',
        'sec-documentation-governance'
      )
    };
  }
  return {
    kind: 'active-authority',
    skills: skills('sec-documentation-governance')
  };
}

export type SecRepositorySurfaceKind =
  | 'markdown'
  | 'heuristic-runtime'
  | 'product-implementation'
  | 'verification-test'
  | 'configuration'
  | 'repository-content';

export type SecRepositorySurface = {
  kind: SecRepositorySurfaceKind;
  skills: SecAgentSkillId[];
};

export function resolveSecRepositoryHeuristicSkills(path: string): SecAgentSkillId[] {
  const skillId = skillIdFromPath(path);
  if (skillId) return [skillId];
  if (path === 'AGENTS.md') {
    return skills('sec-repository-orientation', 'sec-a0-integrator', 'sec-context-resume');
  }
  if (/^\.codex\/agents\//u.test(path)) {
    return skills('sec-task-delegation', 'sec-worker-development', 'sec-exact-head-review');
  }
  if (/^\.github\/workflows\//u.test(path)) {
    return skills('sec-ci-and-merge', 'sec-trust-root-bootstrap');
  }
  if (/^\.githooks\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-toolchain-and-dependencies');
  }
  if (/^scripts\/codex\//u.test(path)) {
    return skills(
      'sec-a0-integrator',
      'sec-work-package-lifecycle',
      'sec-ci-and-merge',
      'sec-trust-root-bootstrap',
      'sec-context-resume',
      'sec-failure-recovery'
    );
  }
  if (/^docs\/scripts\//u.test(path)) {
    return skills('sec-documentation-governance', 'sec-trust-root-bootstrap');
  }
  if (path === 'platform/dev-runner.ts' || /^platform\/dev-runner\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-toolchain-and-dependencies');
  }
  if (/^scripts\/ci-[^/]+\.ts$/u.test(path) || path === 'scripts/run-work-package-gate.ts') {
    return skills('sec-ci-and-merge', 'sec-trust-root-bootstrap');
  }
  if (path === 'scripts/install-git-hooks.ts') {
    return skills('sec-impact-and-validation', 'sec-toolchain-and-dependencies');
  }
  if (/^platform\/shared\/(?:ci-|test-impact|test-ownership|affected-test|verification-scope)/u.test(path)
    || /^platform\/shared\/test-impact-rules\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-ci-and-merge', 'sec-trust-root-bootstrap');
  }
  if (/^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|\.bun-version)$/u.test(path)) {
    return skills('sec-toolchain-and-dependencies');
  }
  return [];
}

export function classifySecRepositorySurface(path: string): SecRepositorySurface {
  const markdown = resolveSecMarkdownSkillCoverage(path);
  if (markdown) return { kind: 'markdown', skills: markdown.skills };
  const heuristicSkills = resolveSecRepositoryHeuristicSkills(path);
  if (heuristicSkills.length > 0) return { kind: 'heuristic-runtime', skills: heuristicSkills };
  if (/^tests\//u.test(path)) return { kind: 'verification-test', skills: [] };
  if (/^(?:platform|source)\//u.test(path)) return { kind: 'product-implementation', skills: [] };
  if (/^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|\.bun-version|\.gitignore|\.gitattributes)$/u.test(path)) {
    return { kind: 'configuration', skills: [] };
  }
  return { kind: 'repository-content', skills: [] };
}
