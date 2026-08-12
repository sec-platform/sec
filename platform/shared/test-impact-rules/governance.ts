import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';
import { TRUSTED_VERIFIER_TCB_FAST_TESTS } from './verification.ts';

export const DOCUMENTATION_LIFECYCLE_TEST_OWNERS = {
  authority: 'documentation-authority',
  evidence: 'documentation-evidence',
  frozenWorkPackage: 'frozen-work-package',
  historical: 'historical-documentation'
} as const;

const DOCUMENTATION_CORPUS_FAST_TESTS = [
  'tests/contract/documentation-corpus-census.test.ts',
  'tests/contract/documentation-ownership-closure.test.ts',
  'tests/contract/docs-doctor-byte-exact.test.ts',
  'tests/unit/documentation-authority-registry-v2.test.ts'
];

const DOCUMENTATION_AUTHORITY_FAST_TESTS = [
  'tests/contract/agent-skills.test.ts',
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/document-control-plane-lifecycle.test.ts',
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
  'tests/contract/document-control-plane-lifecycle.test.ts',
  'tests/contract/documentation-authority.test.ts',
  'tests/contract/docs-doctor.test.ts',
  'tests/contract/operation-read-plan.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/agent-operation-activation.test.ts',
  'tests/unit/codex-work-package-contract.test.ts'
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
  'tests/contract/document-control-plane-lifecycle.test.ts',
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

const WORK_PACKAGE_SELECTOR_FAST_TESTS = [
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/contract/test-impact.test.ts'
];

const WORK_PACKAGE_EVIDENCE_FAST_TESTS = [
  ...WORK_PACKAGE_SELECTOR_FAST_TESTS,
  'tests/unit/work-package-gate-contract.test.ts',
  'tests/unit/work-package-gate-execution.test.ts'
];

const WORK_PACKAGE_FIXTURE_FAST_TESTS = [
  ...WORK_PACKAGE_SELECTOR_FAST_TESTS,
  'tests/unit/work-package-gate-execution.test.ts'
];

export const governanceTestOwnershipDeclarations: TestOwnershipDeclaration[] = [
  {
    owner: 'issue-disposition',
    identity: { kind: 'contract', id: 'issue-disposition' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/issue-disposition-contract.ts',
      'scripts/codex/issue-disposition-github.ts',
      'scripts/codex/issue-disposition.ts'
    ],
    fast: ISSUE_DISPOSITION_FAST_TESTS,
    slow: []
  },
  {
    owner: 'work-selection',
    identity: { kind: 'contract', id: 'work-selection' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/work-selection-contract.ts',
      'platform/shared/work-selection-live-contract.ts',
      'scripts/codex/work-selection.ts'
    ],
    fast: [
      'tests/unit/agent-operation-activation.test.ts',
      'tests/contract/document-control-plane-lifecycle.test.ts',
      'tests/unit/branch-lifecycle-contract.test.ts',
      'tests/unit/verification-candidate-tree.test.ts',
      'tests/unit/work-selection-contract.test.ts',
      'tests/unit/work-selection-live.test.ts',
      'tests/contract/test-impact.test.ts'
    ],
    slow: []
  },
  {
    owner: 'agent-operation-activation',
    identity: { kind: 'contract', id: 'agent-operation-activation' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/agent-operation-activation-contract.ts',
      'scripts/codex/agent-operation-activation.ts'
    ],
    fast: [
      ...TRUSTED_VERIFIER_TCB_FAST_TESTS,
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/skill-applicability.test.ts'
    ],
    slow: []
  },
  {
    owner: 'agent-task-capsule',
    identity: { kind: 'contract', id: 'agent-task-capsule' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/agent-task-capsule-contract.ts',
      'scripts/codex/task-capsule.ts'
    ],
    fast: [
      'tests/unit/agent-task-capsule.test.ts',
      'tests/unit/agent-operation-read-plan.test.ts',
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/skill-applicability.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/skill-applicability-decision.test.ts'
    ],
    slow: []
  },
  {
    owner: 'agent-operation-read-plan',
    identity: { kind: 'contract', id: 'agent-operation-read-plan' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/agent-operation-read-plan-contract.ts',
      'scripts/codex/operation-read-plan.ts'
    ],
    fast: [
      'tests/unit/agent-operation-read-plan.test.ts',
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/skill-applicability.test.ts',
      'tests/contract/test-impact.test.ts'
    ],
    slow: []
  },
  {
    owner: 'managed-git-hooks',
    identity: { kind: 'architecture-owner', id: 'managed-git-hooks' },
    sourceFiles: [
      'scripts/install-git-hooks.ts',
      'platform/dev-runner/dependency-bootstrap.ts'
    ],
    sourcePrefixes: ['.githooks/'],
    fast: [
      'tests/unit/install-git-hooks.test.ts',
      'tests/contract/test-impact.test.ts'
    ],
    slow: ['tests/e2e/install-git-hooks.test.ts']
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority },
    autoReferenceMode: 'declared-only',
    sourceKinds: ['active-documentation'],
    fast: DOCUMENTATION_AUTHORITY_FAST_TESTS,
    slow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.authority },
    autoReferenceMode: 'declared-only',
    sourceFiles: DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES,
    fast: ['tests/contract/documentation-authority.test.ts'],
    slow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.historical,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.historical },
    autoReferenceMode: 'declared-only',
    sourcePrefixes: [
      'docs/archive/',
      'docs/superpowers/',
      'tests/fixtures/documentation-history/'
    ],
    fast: HISTORICAL_DOCUMENTATION_FAST_TESTS,
    slow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.evidence,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.evidence },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'docs/evidence/2026-07-26-development-throughput-audit.md',
      'docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md',
      'docs/evidence/2026-08-04-canonical-architecture-convergence.md',
      'docs/evidence/2026-08-04-full-architecture-asset-audit.md'
    ],
    sourcePrefixes: ['docs/evidence/documentation/'],
    fast: NON_ACTIVE_DOCUMENTATION_FAST_TESTS,
    slow: []
  },
  {
    owner: 'agent-skill-authoring',
    identity: { kind: 'contract', id: 'agent-skill-authoring' },
    autoReferenceMode: 'declared-only',
    sourcePrefixes: ['.agents/skills/'],
    fast: AGENT_SKILL_AUTHORING_FAST_TESTS,
    slow: []
  },
  {
    owner: 'agent-governance',
    identity: { kind: 'architecture-owner', id: 'agent-governance' },
    autoReferenceMode: 'declared-only',
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
    fast: AGENT_GOVERNANCE_FAST_TESTS,
    slow: []
  },
  {
    owner: 'work-package-contract',
    identity: { kind: 'contract', id: 'work-package-contract' },
    autoReferenceMode: 'declared-only',
    sourceFiles: ['scripts/codex/work-package-contract.ts'],
    fast: WORK_PACKAGE_CONTRACT_FAST_TESTS,
    slow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage },
    autoReferenceMode: 'declared-only',
    sourceFiles: FROZEN_WORK_PACKAGE_TOMBSTONE_FILES,
    fast: ['tests/contract/documentation-authority.test.ts'],
    slow: []
  },
  {
    owner: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage,
    identity: { kind: 'contract', id: DOCUMENTATION_LIFECYCLE_TEST_OWNERS.frozenWorkPackage },
    autoReferenceMode: 'declared-only',
    excludedSourceFiles: FROZEN_WORK_PACKAGE_TOMBSTONE_FILES,
    sourcePrefixes: ['docs/work-packages/'],
    fast: FROZEN_WORK_PACKAGE_FAST_TESTS,
    slow: []
  },
  {
    owner: 'work-package-gate',
    identity: { kind: 'contract', id: 'work-package-gate' },
    sourceFiles: [
      'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json',
      'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json',
      'docs/evidence/v0-4-semantic-mutation-bounded-isolation-scan-exact-stop-record-2026-07-17.json',
      'docs/evidence/v0-4-semantic-mutation-browser-closure-exact-timeout-stop-record-2026-07-17.json',
      'docs/evidence/v0-4-semantic-mutation-local-child-exact-public-verification-2026-07-17.json',
      'docs/evidence/v0-4-semantic-mutation-local-child-host-alias-exact-public-stop-record-2026-07-17.json',
      'docs/evidence/v0-4-semantic-mutation-proof-reuse-exact-timeout-stop-record-2026-07-17.json',
      'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-durable-exact-stop-record-2026-07-18.json',
      'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-exact-result-loss-record-2026-07-18.json',
      'docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json'
    ],
    sourcePrefixes: ['tests/fixtures/work-package-gate-manifests/'],
    fast: WORK_PACKAGE_EVIDENCE_FAST_TESTS,
    slow: []
  },
  {
    owner: 'work-package-gate',
    identity: { kind: 'contract', id: 'work-package-gate' },
    sourceFiles: [
      'tests/fixtures/work-package-gate-retained-recovery/records/000001-prepared.json',
      'tests/fixtures/work-package-gate-retained-recovery/records/000002-authoring-committed.json',
      'tests/fixtures/work-package-gate-retained-recovery/records/000003-verified.json',
      'tests/fixtures/work-package-gate-retained-recovery/terminal-order/000000000002.json',
      'tests/fixtures/work-package-gate-retained-recovery/terminal-order/.sequence-head.json'
    ],
    fast: WORK_PACKAGE_FIXTURE_FAST_TESTS,
    slow: []
  }
];
