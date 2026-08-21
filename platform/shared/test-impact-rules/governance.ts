import { DOCUMENTATION_LIFECYCLE_TEST_OWNERS } from '../documentation-lifecycle-test-owner-contract.ts';
import { DOCUMENT_CONTROL_PLANE_LIFECYCLE_TEST_FILE } from '../test-budget-contract.ts';
import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';
import { TRUSTED_VERIFIER_TCB_FAST_TESTS } from './verification.ts';

export { DOCUMENTATION_LIFECYCLE_TEST_OWNERS } from '../documentation-lifecycle-test-owner-contract.ts';

const DOCUMENTATION_CORPUS_FAST_TESTS = [
  'tests/contract/documentation-corpus-census.test.ts',
  'tests/contract/documentation-ownership-closure.test.ts',
  'tests/contract/docs-doctor-byte-exact.test.ts',
  'tests/unit/documentation-authority-registry-v2.test.ts'
];

const DOCUMENTATION_AUTHORITY_FAST_TESTS = [
  'tests/contract/agent-skills.test.ts',
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/documentation-authority.test.ts',
  ...DOCUMENTATION_CORPUS_FAST_TESTS,
  'tests/contract/docs-doctor-ledgers.test.ts',
  'tests/contract/docs-doctor.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/active-documentation-contract.test.ts',
  'tests/unit/agent-skill-markdown-classification.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts'
];

const AGENT_GOVERNANCE_FAST_TESTS = [
  'tests/contract/agent-skills.test.ts',
  'tests/contract/discover-all.test.ts',
  ...DOCUMENTATION_CORPUS_FAST_TESTS,
  'tests/contract/docs-doctor-ledgers.test.ts',
  'tests/contract/docs-doctor.test.ts',
  'tests/contract/operation-read-plan.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/active-documentation-contract.test.ts',
  'tests/unit/agent-operation-activation.test.ts',
  'tests/unit/agent-skill-markdown-classification.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/unit/local-gate-union.test.ts'
];

const WORK_PACKAGE_CONTRACT_FAST_TESTS = [
  'tests/contract/documentation-authority.test.ts',
  'tests/contract/docs-doctor.test.ts',
  'tests/contract/operation-read-plan.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/agent-operation-activation.test.ts',
  'tests/unit/codex-work-package-contract.test.ts'
];

const DOCUMENT_CONTROL_PROJECTION_FAST_TESTS = [
  'tests/unit/document-control-plane-projection.test.ts',
  'tests/unit/document-control-plane-github-observation.test.ts'
];

const AGENT_SKILL_AUTHORING_FAST_TESTS = [
  'tests/contract/agent-skills.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/agent-skill-markdown-classification.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts'
];

const ISSUE_DISPOSITION_FAST_TESTS = [
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/issue-disposition-contract.test.ts',
  'tests/unit/issue-disposition-github.test.ts',
  'tests/unit/verification-session-runtime.test.ts'
];

const FROZEN_WORK_PACKAGE_FAST_TESTS = [
  'tests/contract/agent-skills.test.ts',
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/documentation-authority.test.ts',
  'tests/contract/docs-doctor.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/unit/codex-work-package-contract.test.ts'
];

const NON_ACTIVE_DOCUMENTATION_FAST_TESTS = [
  ...DOCUMENTATION_CORPUS_FAST_TESTS,
  'tests/contract/agent-skills.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/active-documentation-contract.test.ts'
];

const HISTORICAL_DOCUMENTATION_FAST_TESTS = [
  ...NON_ACTIVE_DOCUMENTATION_FAST_TESTS,
  'tests/contract/documentation-authority.test.ts',
  'tests/unit/codex-work-package-contract.test.ts'
];

export const DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES = [
  'docs/00-文档索引与一致性规则.md',
  'docs/01-用户能力模块化开发-主题整理稿.md',
  'docs/02-工程编译器-MVP-PRD与架构稿.md',
  'docs/03-MVP实施计划与路线图.md',
  'docs/04-AI自主实现执行蓝图.md',
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
  'docs/architecture/brownfield-import.md',
  'docs/architecture/engineering-workspace-ir.md',
  'docs/architecture/sec-ts-ir-layers.md',
  'docs/goals/SEC-Engineering-Workspace-Compiler.md',
  'docs/governance/agent-skills-and-development-run-kernel.md',
  'docs/governance/external-capability-and-provider-policy.md',
  'docs/governance/nexus-absorption-and-conformance.md',
  'docs/governance/nexus-absorption-report.md',
  'docs/slow-suite-registry.md',
  'docs/test-and-package-architecture.md',
  'docs/test-architecture.md',
  'docs/test-feedback-and-ci-lanes.md',
  'docs/代码库可视化流程图工具与编译原理综合指南.md'
] as const;

export const FROZEN_WORK_PACKAGE_TOMBSTONE_FILES = [
  'docs/work-packages/sm3-p0-local-isolated-runner-v1.md'
] as const;

const RETIRED_WORK_PACKAGE_GATE_TRANSITIONS = [
  ['scripts/diagnose-work-package-profile-probe.ts', 'c926e693d1976b94e7f6736308e43cc428c7a030'],
  ['scripts/run-work-package-gate.ts', '8094f3041a2d5a29d7e8fbe9d2895201c852d39a'],
  ['scripts/work-package-gate-contract.ts', '97dda35ef4b52d2266ebf370483924649ee1f526'],
  ['scripts/work-package-gate-custody-ledger.ts', '3476ab2701530e439fea7edeac94048704563f17'],
  ['scripts/work-package-profile-probe.ts', 'dc3b75e244af764da4121363b22bf5620d896137'],
  ['tests/fixtures/work-package-gate-retained-recovery/records/000001-prepared.json', '5bee4fff416d84f584fba40c2e6c4b8b6850dcf4'],
  ['tests/fixtures/work-package-gate-retained-recovery/records/000002-authoring-committed.json', '987a405b6d9b85187792b734337ebe8df0acfa7a'],
  ['tests/fixtures/work-package-gate-retained-recovery/records/000003-verified.json', 'd47099bbbb2ffb2baaecfb4a01902297e6e520e1'],
  ['tests/fixtures/work-package-gate-retained-recovery/terminal-order/.sequence-head.json', '9407ded37cd9da2526f2d36a627810278eb38535'],
  ['tests/fixtures/work-package-gate-retained-recovery/terminal-order/000000000002.json', 'f1278efa1e8d30497194fa675eb6a759538e58ff']
].map(([path, baseBlobSha]) => ({
  path: path!,
  baseSha: 'b6200c3a2ae821bc9ff8cf4fc751060fd391914f',
  baseMode: '100644' as const,
  baseBlobSha: baseBlobSha!
}));

export const governanceTestOwnershipDeclarations: TestOwnershipDeclaration[] = [
  {
    owner: 'test-impact-governance-registry',
    identity: { kind: 'contract', id: 'test-impact-governance-registry' },
    closureMode: 'declared-only',
    sourceFiles: [
      'platform/shared/test-impact-rules/governance.ts',
      'platform/shared/test-impact-rules/semantic.ts',
      'platform/shared/test-impact-rules/verification.ts'
    ],
    supplementalFast: [
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'test-impact-control',
    identity: { kind: 'contract', id: 'test-impact-control' },
    closureMode: 'declared-only',
    sourceFiles: [
      'platform/shared/ci-pr-risk-selection.ts',
      'platform/shared/ci-verification-plan.ts',
      'platform/shared/documentation-lifecycle-test-owner-contract.ts',
      'platform/shared/test-budget-contract.ts',
      'platform/shared/test-impact-contract.ts',
      'platform/shared/test-ownership-contract.ts'
    ],
    supplementalFast: [
      'tests/contract/ci-lanes.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts',
      'tests/unit/ci-verification-execution.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'shared-boundary-classification',
    identity: { kind: 'contract', id: 'shared-boundary-classification' },
    closureMode: 'declared-only',
    sourceFiles: ['platform/shared/shared-boundary-contract.ts'],
    supplementalFast: ['tests/contract/shared-boundary-classification.test.ts'],
    supplementalSlow: []
  },
  {
    owner: 'retired-work-package-gate',
    identity: { kind: 'contract', id: 'retired-work-package-gate' },
    closureMode: 'declared-only',
    removedSourceTransitions: RETIRED_WORK_PACKAGE_GATE_TRANSITIONS,
    supplementalFast: [
      'tests/contract/repository-audit.test.ts',
      'tests/contract/test-impact.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'issue-disposition',
    identity: { kind: 'contract', id: 'issue-disposition' },
    closureMode: 'declared-only',
    sourceFiles: [
      'platform/shared/issue-disposition-contract.ts',
      'scripts/codex/issue-disposition-github.ts',
      'scripts/codex/issue-disposition.ts'
    ],
    supplementalFast: ISSUE_DISPOSITION_FAST_TESTS,
    supplementalSlow: []
  },
  {
    owner: 'work-selection',
    identity: { kind: 'contract', id: 'work-selection' },
    closureMode: 'declared-only',
    sourceFiles: [
      'platform/shared/work-selection-contract.ts',
      'platform/shared/work-selection-live-contract.ts',
      'scripts/codex/work-selection.ts'
    ],
    supplementalFast: [
      'tests/unit/agent-operation-activation.test.ts',
      'tests/contract/docs-doctor.test.ts',
      'tests/unit/branch-lifecycle-contract.test.ts',
      ...DOCUMENT_CONTROL_PROJECTION_FAST_TESTS,
      'tests/unit/verification-candidate-tree.test.ts',
      'tests/unit/work-selection-contract.test.ts',
      'tests/unit/work-selection-live.test.ts',
      'tests/contract/test-impact.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'document-control-plane-projection',
    identity: { kind: 'contract', id: 'document-control-plane-projection' },
    sourceFiles: [
      'scripts/codex/document-control-plane-contract.ts',
      'scripts/codex/document-control-plane-github-observation.ts'
    ],
    supplementalFast: DOCUMENT_CONTROL_PROJECTION_FAST_TESTS,
    supplementalSlow: []
  },
  {
    owner: 'document-control-plane-transaction',
    identity: { kind: 'contract', id: 'document-control-plane-transaction' },
    sourceFiles: ['scripts/codex/document-control-plane.ts'],
    supplementalFast: DOCUMENT_CONTROL_PROJECTION_FAST_TESTS,
    supplementalSlow: [DOCUMENT_CONTROL_PLANE_LIFECYCLE_TEST_FILE]
  },
  {
    owner: 'agent-operation-activation',
    identity: { kind: 'contract', id: 'agent-operation-activation' },
    closureMode: 'declared-only',
    sourceFiles: [
      'platform/shared/agent-operation-activation-contract.ts',
      'scripts/codex/agent-operation-activation-census.ts',
      'scripts/codex/agent-operation-activation.ts'
    ],
    supplementalFast: [
      ...TRUSTED_VERIFIER_TCB_FAST_TESTS,
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/skill-applicability.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'agent-task-capsule',
    identity: { kind: 'contract', id: 'agent-task-capsule' },
    closureMode: 'declared-only',
    sourceFiles: [
      'platform/shared/agent-task-capsule-contract.ts',
      'scripts/codex/task-capsule.ts'
    ],
    supplementalFast: [
      'tests/unit/agent-task-capsule.test.ts',
      'tests/unit/agent-operation-read-plan.test.ts',
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/skill-applicability.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/skill-applicability-decision.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'agent-operation-read-plan',
    identity: { kind: 'contract', id: 'agent-operation-read-plan' },
    closureMode: 'declared-only',
    sourceFiles: [
      'platform/shared/agent-operation-read-plan-contract.ts',
      'scripts/codex/operation-read-plan.ts'
    ],
    supplementalFast: [
      'tests/unit/agent-operation-read-plan.test.ts',
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/skill-applicability.test.ts',
      'tests/contract/test-impact.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'agent-operation-read-plan',
    identity: { kind: 'contract', id: 'agent-operation-read-plan' },
    sourceFiles: ['scripts/codex/skill-applicability.ts'],
    supplementalFast: [
      ...TRUSTED_VERIFIER_TCB_FAST_TESTS,
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/skill-applicability.test.ts'
    ],
    supplementalSlow: []
  },
  {
    owner: 'managed-git-hooks',
    identity: { kind: 'architecture-owner', id: 'managed-git-hooks' },
    sourceFiles: [
      'scripts/install-git-hooks.ts'
    ],
    sourcePrefixes: ['.githooks/'],
    supplementalFast: [
      'tests/unit/install-git-hooks.test.ts',
      'tests/contract/test-impact.test.ts'
    ],
    supplementalSlow: ['tests/e2e/install-git-hooks.test.ts']
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority },
    closureMode: 'declared-only',
    sourceKinds: ['active-documentation'],
    supplementalFast: [...DOCUMENTATION_AUTHORITY_FAST_TESTS, ...DOCUMENT_CONTROL_PROJECTION_FAST_TESTS],
    supplementalSlow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority },
    closureMode: 'declared-only',
    sourceFiles: DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES,
    supplementalFast: ['tests/contract/documentation-authority.test.ts'],
    supplementalSlow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.historical,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.historical },
    closureMode: 'declared-only',
    sourcePrefixes: [
      'docs/archive/',
      'docs/superpowers/',
      'tests/fixtures/documentation-history/'
    ],
    supplementalFast: HISTORICAL_DOCUMENTATION_FAST_TESTS,
    supplementalSlow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.evidence,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.evidence },
    closureMode: 'declared-only',
    sourceFiles: [
      'docs/evidence/2026-07-26-development-throughput-audit.md',
      'docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md',
      'docs/evidence/2026-08-04-canonical-architecture-convergence.md',
      'docs/evidence/2026-08-04-full-architecture-asset-audit.md'
    ],
    sourcePrefixes: ['docs/evidence/documentation/'],
    supplementalFast: NON_ACTIVE_DOCUMENTATION_FAST_TESTS,
    supplementalSlow: []
  },
  {
    owner: 'agent-skill-authoring',
    identity: { kind: 'contract', id: 'agent-skill-authoring' },
    closureMode: 'declared-only',
    sourcePrefixes: ['.agents/skills/'],
    supplementalFast: AGENT_SKILL_AUTHORING_FAST_TESTS,
    supplementalSlow: []
  },
  {
    owner: 'agent-governance',
    identity: { kind: 'architecture-owner', id: 'agent-governance' },
    closureMode: 'declared-only',
    sourceFiles: [
      'AGENTS.md',
      '.codex/agents/implementation-worker.toml',
      '.codex/agents/verification-evidence-reviewer.toml',
      'docs/authority.json',
      'docs/scripts/docs-doctor.ts',
      'docs/scripts/docs-doctor-ledgers.ts',
      'docs/scripts/docs-doctor-shared.ts',
      'platform/shared/active-documentation-contract.ts',
      'platform/shared/documentation-authority-contract.ts',
      'platform/shared/agent-skill-contract.ts',
      'scripts/codex/repository-audit.ts',
      'scripts/discover-all.ts'
    ],
    supplementalFast: AGENT_GOVERNANCE_FAST_TESTS,
    supplementalSlow: []
  },
  {
    owner: 'work-package-contract',
    identity: { kind: 'contract', id: 'work-package-contract' },
    closureMode: 'declared-only',
    sourceFiles: ['scripts/codex/work-package-contract.ts'],
    supplementalFast: [...WORK_PACKAGE_CONTRACT_FAST_TESTS, ...DOCUMENT_CONTROL_PROJECTION_FAST_TESTS],
    supplementalSlow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage },
    closureMode: 'declared-only',
    sourceFiles: FROZEN_WORK_PACKAGE_TOMBSTONE_FILES,
    supplementalFast: ['tests/contract/documentation-authority.test.ts'],
    supplementalSlow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage },
    closureMode: 'declared-only',
    excludedSourceFiles: FROZEN_WORK_PACKAGE_TOMBSTONE_FILES,
    sourcePrefixes: ['docs/work-packages/'],
    supplementalFast: [...FROZEN_WORK_PACKAGE_FAST_TESTS, ...DOCUMENT_CONTROL_PROJECTION_FAST_TESTS],
    supplementalSlow: []
  }
];
