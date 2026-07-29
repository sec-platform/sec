import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';

const AGENT_GOVERNANCE_FAST_TESTS = [
  'tests/contract/agent-skills.test.ts',
  'tests/contract/discover-all.test.ts',
  'tests/contract/docs-doctor.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/active-documentation-contract.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts'
];

const FROZEN_WORK_PACKAGE_FAST_TESTS = [
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/docs-doctor.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/unit/codex-work-package-contract.test.ts'
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
    sourcePrefixes: ['.agents/skills/'],
    fast: AGENT_GOVERNANCE_FAST_TESTS,
    slow: []
  },
  {
    owner: 'frozen-work-package',
    identity: { kind: 'contract', id: 'frozen-work-package' },
    autoReferenceMode: 'declared-only',
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
