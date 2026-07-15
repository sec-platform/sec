import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';

const AGENT_GOVERNANCE_FAST_TESTS = [
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/contract/test-impact.test.ts'
];

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
    owner: 'agent-governance',
    identity: { kind: 'architecture-owner', id: 'agent-governance' },
    sourceFiles: [
      'AGENTS.md',
      '.codex/agents/implementation-worker.toml',
      '.codex/agents/verification-evidence-reviewer.toml'
    ],
    fast: AGENT_GOVERNANCE_FAST_TESTS,
    slow: []
  },
  {
    owner: 'work-package-gate',
    identity: { kind: 'contract', id: 'work-package-gate' },
    sourceFiles: [
      'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json',
      'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json'
    ],
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
