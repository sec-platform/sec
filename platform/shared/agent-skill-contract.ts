export const SEC_AGENT_SKILL_IDS = [
  'sec-a0-integrator',
  'sec-architecture-evolution',
  'sec-ci-and-merge',
  'sec-context-resume',
  'sec-documentation-governance',
  'sec-exact-head-review',
  'sec-external-capability-governance',
  'sec-failure-recovery',
  'sec-heuristic-governance',
  'sec-impact-and-validation',
  'sec-repository-audit',
  'sec-repository-orientation',
  'sec-task-delegation',
  'sec-toolchain-and-dependencies',
  'sec-trust-root-bootstrap',
  'sec-work-package-lifecycle',
  'sec-worker-development'
] as const;

export type SecAgentSkillId = (typeof SEC_AGENT_SKILL_IDS)[number];

export const SEC_REPOSITORY_BEHAVIOR_IDS = [
  'a0-integration',
  'architecture-evolution',
  'ci-and-merge',
  'context-resume',
  'documentation-governance',
  'exact-head-review',
  'external-capability-governance',
  'failure-recovery',
  'heuristic-governance',
  'impact-and-validation',
  'repository-audit',
  'repository-orientation',
  'task-delegation',
  'toolchain-and-dependencies',
  'trust-root-bootstrap',
  'work-package-lifecycle',
  'worker-development'
] as const;

export type SecRepositoryBehaviorId = (typeof SEC_REPOSITORY_BEHAVIOR_IDS)[number];

export const SEC_REPOSITORY_BEHAVIOR_OWNERS = {
  'a0-integration': 'sec-a0-integrator',
  'architecture-evolution': 'sec-architecture-evolution',
  'ci-and-merge': 'sec-ci-and-merge',
  'context-resume': 'sec-context-resume',
  'documentation-governance': 'sec-documentation-governance',
  'exact-head-review': 'sec-exact-head-review',
  'external-capability-governance': 'sec-external-capability-governance',
  'failure-recovery': 'sec-failure-recovery',
  'heuristic-governance': 'sec-heuristic-governance',
  'impact-and-validation': 'sec-impact-and-validation',
  'repository-audit': 'sec-repository-audit',
  'repository-orientation': 'sec-repository-orientation',
  'task-delegation': 'sec-task-delegation',
  'toolchain-and-dependencies': 'sec-toolchain-and-dependencies',
  'trust-root-bootstrap': 'sec-trust-root-bootstrap',
  'work-package-lifecycle': 'sec-work-package-lifecycle',
  'worker-development': 'sec-worker-development'
} as const satisfies Record<SecRepositoryBehaviorId, SecAgentSkillId>;

export const SEC_AGENT_SKILL_STANDARD_SECTIONS = [
  '## 触发',
  '## 不触发',
  '## 输入',
  '## 权限与路径',
  '## 允许工具与操作',
  '## 前置门禁',
  '## 执行',
  '## 完成证据',
  '## 停止与恢复',
  '## 禁止捷径',
  '## 权威'
] as const;

export type SecMarkdownSurfaceKind =
  | 'skill-definition'
  | 'agent-projection'
  | 'active-authority'
  | 'frozen-work-package'
  | 'evidence'
  | 'historical'
  | 'verification-fixture'
  | 'repository-content';

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

export function resolveSecRepositoryBehaviorOwner(
  behavior: SecRepositoryBehaviorId
): SecAgentSkillId {
  return SEC_REPOSITORY_BEHAVIOR_OWNERS[behavior];
}

export function resolveSecMarkdownSkillCoverage(path: string): SecMarkdownSkillCoverage | null {
  const skillId = skillIdFromPath(path);
  if (skillId) return { kind: 'skill-definition', skills: [skillId] };
  if (path === 'AGENTS.md') {
    return {
      kind: 'agent-projection',
      skills: skills(
        'sec-repository-orientation',
        'sec-repository-audit',
        'sec-a0-integrator',
        'sec-context-resume',
        'sec-heuristic-governance'
      )
    };
  }
  if (path === 'README.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-repository-orientation',
        'sec-repository-audit',
        'sec-documentation-governance'
      )
    };
  }
  if (/^[^/]+\.md$/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-repository-orientation',
        'sec-repository-audit',
        'sec-documentation-governance',
        'sec-heuristic-governance'
      )
    };
  }
  if (/^tests\/.*\.md$/u.test(path)) {
    return { kind: 'verification-fixture', skills: [] };
  }
  if (/^docs\/work-packages\/[^/]+\.md$/u.test(path)) {
    return { kind: 'frozen-work-package', skills: [] };
  }
  if (/^docs\/evidence\/.*\.md$/u.test(path)) return { kind: 'evidence', skills: [] };
  if (/^docs\/(?:archive|superpowers)\/.*\.md$/u.test(path)) {
    return { kind: 'historical', skills: [] };
  }
  if (!/^docs\/.*\.md$/u.test(path)) {
    return path.endsWith('.md')
      ? {
          kind: 'repository-content',
          skills: skills('sec-documentation-governance', 'sec-heuristic-governance')
        }
      : null;
  }

  if (path === 'docs/00-文档索引与一致性规则.md'
    || path === 'docs/governance/agent-skills-and-development-run-kernel.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-documentation-governance',
        'sec-context-resume',
        'sec-repository-audit',
        'sec-heuristic-governance'
      )
    };
  }
  if (path === 'docs/04-AI自主实现执行蓝图.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-repository-orientation',
        'sec-repository-audit',
        'sec-architecture-evolution',
        'sec-a0-integrator',
        'sec-work-package-lifecycle',
        'sec-task-delegation',
        'sec-worker-development',
        'sec-impact-and-validation',
        'sec-exact-head-review',
        'sec-ci-and-merge',
        'sec-trust-root-bootstrap',
        'sec-context-resume',
        'sec-failure-recovery',
        'sec-heuristic-governance'
      )
    };
  }
  if (/^docs\/work\//u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-a0-integrator',
        'sec-work-package-lifecycle',
        'sec-documentation-governance',
        'sec-repository-orientation',
        'sec-repository-audit'
      )
    };
  }
  if (/^docs\/(?:test-architecture|test-feedback-and-ci-lanes|slow-suite-registry)\.md$/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-impact-and-validation',
        'sec-ci-and-merge',
        'sec-trust-root-bootstrap',
        'sec-repository-audit'
      )
    };
  }
  if (/^docs\/governance\/(?:external-capability|nexus-)/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-external-capability-governance',
        'sec-repository-orientation',
        'sec-repository-audit',
        'sec-heuristic-governance'
      )
    };
  }
  if (/^docs\/(?:0[1-3]-|goals\/)/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-repository-orientation',
        'sec-repository-audit',
        'sec-architecture-evolution',
        'sec-a0-integrator',
        'sec-documentation-governance'
      )
    };
  }
  if (/^docs\/(?:0[5-9]-|1[0-4]-|architecture\/)/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-architecture-evolution',
        'sec-worker-development',
        'sec-impact-and-validation',
        'sec-exact-head-review',
        'sec-documentation-governance',
        'sec-repository-audit'
      )
    };
  }
  return {
    kind: 'active-authority',
    skills: skills(
      'sec-documentation-governance',
      'sec-repository-audit',
      'sec-heuristic-governance'
    )
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
    return skills(
      'sec-repository-orientation',
      'sec-repository-audit',
      'sec-a0-integrator',
      'sec-context-resume',
      'sec-heuristic-governance'
    );
  }
  if (/^docs\/work\//u.test(path)) {
    return skills(
      'sec-a0-integrator',
      'sec-documentation-governance',
      'sec-repository-orientation',
      'sec-repository-audit',
      'sec-work-package-lifecycle'
    );
  }
  if (path === 'docs/governance/external-capability-ledger.yaml') {
    return skills('sec-external-capability-governance', 'sec-heuristic-governance');
  }
  if (path === 'docs/governance/nexus-absorption-ledger.yaml') {
    return skills(
      'sec-external-capability-governance',
      'sec-repository-orientation',
      'sec-repository-audit'
    );
  }
  if (path === 'platform/shared/agent-skill-contract.ts') {
    return skills(
      'sec-documentation-governance',
      'sec-context-resume',
      'sec-trust-root-bootstrap',
      'sec-repository-audit',
      'sec-heuristic-governance'
    );
  }
  if (/^\.codex\//u.test(path)) {
    return skills(
      'sec-task-delegation',
      'sec-worker-development',
      'sec-exact-head-review',
      'sec-context-resume',
      'sec-heuristic-governance'
    );
  }
  if (/^\.github\//u.test(path)) {
    return skills('sec-ci-and-merge', 'sec-trust-root-bootstrap', 'sec-documentation-governance');
  }
  if (/^\.githooks\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-toolchain-and-dependencies');
  }
  if (path === 'scripts/codex/repository-audit.ts') {
    return skills('sec-repository-audit', 'sec-heuristic-governance');
  }
  if (/^scripts\/codex\//u.test(path)) {
    return skills(
      'sec-a0-integrator',
      'sec-work-package-lifecycle',
      'sec-ci-and-merge',
      'sec-trust-root-bootstrap',
      'sec-context-resume',
      'sec-failure-recovery',
      'sec-heuristic-governance'
    );
  }
  if (/^docs\/scripts\//u.test(path)) {
    return skills(
      'sec-documentation-governance',
      'sec-trust-root-bootstrap',
      'sec-heuristic-governance'
    );
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
  if (path === 'scripts/discover-all.ts') {
    return skills(
      'sec-repository-audit',
      'sec-impact-and-validation',
      'sec-toolchain-and-dependencies'
    );
  }
  if (/^scripts\//u.test(path)) {
    return skills('sec-toolchain-and-dependencies', 'sec-impact-and-validation');
  }
  if (/^platform\/shared\/(?:active-documentation|affected-test|ci-|contract-freeze|heavy-verification|repository-path|runtime-dependency|test-|verification-scope)/u.test(path)
    || /^platform\/shared\/test-impact-rules\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-ci-and-merge', 'sec-trust-root-bootstrap');
  }
  if (/^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|\.bun-version|\.gitignore|\.gitattributes|\.npmrc|\.dependency-cruiser\.json)$/u.test(path)) {
    return skills('sec-toolchain-and-dependencies', 'sec-repository-audit');
  }
  return [];
}

export function isSecRepositoryHeuristicSurface(path: string): boolean {
  return resolveSecRepositoryHeuristicSkills(path).length > 0;
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
