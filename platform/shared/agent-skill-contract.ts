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

export const SEC_PRODUCT_AUTHORITY_MARKDOWN_PATHS = [
  'docs/01-用户能力模块化开发-主题整理稿.md',
  'docs/02-工程编译器-MVP-PRD与架构稿.md',
  'docs/03-MVP实施计划与路线图.md',
  'docs/05-编译器核心实现规格.md',
  'docs/06-Registry与Block协议规范.md',
  'docs/07-Pass状态机、错误码与恢复机制.md',
  'docs/08-Verification、Provenance与Graph规范.md',
  'docs/09-AI Runtime、任务信封与治理规范.md',
  'docs/10-升级迁移与Override规范.md',
  'docs/11-Workbench与可视化规范.md',
  'docs/12-编译管道与行为流图示.md',
  'docs/13-独立工具分发与打包规划.md',
  'docs/14-Engineering IR与语义事实规范.md',
  'docs/goals/SEC-Engineering-Workspace-Compiler.md',
  'docs/architecture/sec-ts-ir-layers.md',
  'docs/architecture/engineering-workspace-ir.md',
  'docs/architecture/brownfield-import.md'
] as const;

const PRODUCT_AUTHORITY_MARKDOWN = new Set<string>(SEC_PRODUCT_AUTHORITY_MARKDOWN_PATHS);

const OPERATIONAL_MARKDOWN_COVERAGE = new Map<string, SecMarkdownSkillCoverage>([
  [
    'docs/00-文档索引与一致性规则.md',
    {
      kind: 'active-authority',
      skills: skills('sec-documentation-governance', 'sec-heuristic-governance')
    }
  ],
  [
    'docs/04-AI自主实现执行蓝图.md',
    {
      kind: 'active-authority',
      skills: skills(
        'sec-repository-orientation',
        'sec-a0-integrator',
        'sec-work-package-lifecycle',
        'sec-heuristic-governance'
      )
    }
  ],
  [
    'docs/governance/agent-skills-and-development-run-kernel.md',
    {
      kind: 'active-authority',
      skills: skills(
        'sec-context-resume',
        'sec-repository-audit',
        'sec-heuristic-governance'
      )
    }
  ],
  [
    'docs/governance/external-capability-and-provider-policy.md',
    {
      kind: 'active-authority',
      skills: skills('sec-external-capability-governance')
    }
  ],
  [
    'docs/governance/nexus-absorption-and-conformance.md',
    {
      kind: 'active-authority',
      skills: skills('sec-external-capability-governance', 'sec-repository-audit')
    }
  ],
  [
    'docs/governance/nexus-absorption-report.md',
    {
      kind: 'active-authority',
      skills: skills('sec-external-capability-governance', 'sec-repository-audit')
    }
  ],
  [
    'docs/work/README.md',
    {
      kind: 'active-authority',
      skills: skills('sec-documentation-governance', 'sec-work-package-lifecycle')
    }
  ],
  [
    'docs/work/rolling-plan.md',
    {
      kind: 'active-authority',
      skills: skills('sec-a0-integrator', 'sec-work-package-lifecycle')
    }
  ],
  [
    'docs/work/active-work-package.md',
    {
      kind: 'active-authority',
      skills: skills('sec-repository-orientation', 'sec-work-package-lifecycle')
    }
  ],
  [
    'docs/test-architecture.md',
    {
      kind: 'active-authority',
      skills: skills('sec-impact-and-validation')
    }
  ],
  [
    'docs/test-feedback-and-ci-lanes.md',
    {
      kind: 'active-authority',
      skills: skills('sec-ci-and-merge', 'sec-impact-and-validation', 'sec-trust-root-bootstrap')
    }
  ],
  [
    'docs/slow-suite-registry.md',
    {
      kind: 'active-authority',
      skills: skills('sec-impact-and-validation')
    }
  ]
]);

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
        'sec-a0-integrator',
        'sec-heuristic-governance'
      )
    };
  }
  if (path === 'README.md') {
    return {
      kind: 'active-authority',
      skills: skills('sec-documentation-governance', 'sec-repository-orientation')
    };
  }
  if (/^[^/]+\.md$/u.test(path)) {
    return {
      kind: 'repository-content',
      skills: skills('sec-documentation-governance')
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
  const operational = OPERATIONAL_MARKDOWN_COVERAGE.get(path);
  if (operational) {
    return {
      kind: operational.kind,
      skills: [...operational.skills]
    };
  }
  if (PRODUCT_AUTHORITY_MARKDOWN.has(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-architecture-evolution',
        'sec-documentation-governance',
        'sec-repository-audit'
      )
    };
  }
  if (/^docs\/.*\.md$/u.test(path)) return null;
  return path.endsWith('.md')
    ? {
        kind: 'repository-content',
        skills: skills('sec-documentation-governance')
      }
    : null;
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
      'sec-a0-integrator',
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
