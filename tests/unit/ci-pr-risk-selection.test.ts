import { expect, test } from 'bun:test';

import { CodexDevelopmentCreateTestImpactTransitionObservationV1 } from '../../platform/shared/ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { slowTestPrRiskBaselineSuiteIds } from '../../platform/shared/test-budget-contract.ts';
import {
  DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES,
  RETIRED_WORK_PACKAGE_EVIDENCE_TRANSITIONS
} from '../../platform/shared/test-impact-rules/governance.ts';

const baselineSuites = slowTestPrRiskBaselineSuiteIds();

test('bounded slow baseline is owned by shared execution lifecycle surfaces', () => {
  for (const file of [
    'platform/orchestrator.ts',
    'tests/helpers/semantic-mutation-runtime-target-swap-runner.ts',
    'tests/helpers/workspace-fixtures.ts',
    'tests/setup/test-runtime.setup.ts',
    'tests/testkit/workspace.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
    expect(selection.slowTests).toEqual([]);
    expect(selection.owners).toContain('bounded-slow-risk');
    expect(selection.resolved).toBe(true);
    expect(selection.reasons).toContain('bounded-baseline');
  }
});

test('package and lock changes use their exact provider contracts instead of business baselines', () => {
  for (const file of ['package.json', 'bun.lock']) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.owners).not.toContain('bounded-slow-risk');
    expect(selection.reasons).not.toContain('bounded-baseline');
    expect(selection.resolved).toBe(true);
  }
});

test('selector trust roots use exact owner sentinels instead of unrelated slow business baselines', () => {
  for (const file of [
    'scripts/ci-pr-risk.ts',
    'platform/shared/ci-pr-risk-selection.ts',
    'platform/shared/test-budget-contract.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.suites).toEqual([]);
    expect(selection.owners).not.toContain('bounded-slow-risk');
    expect(selection.reasons).toContain('ownership-impact');
    expect(selection.resolved).toBe(true);
  }
});

test('documentation authority trust roots use exact owner sentinels', () => {
  for (const file of [
    'docs/authority.json',
    'docs/scripts/docs-doctor.ts',
    'docs/scripts/docs-doctor-ledgers.ts',
    'docs/scripts/docs-doctor-shared.ts',
    'platform/shared/active-documentation-contract.ts',
    'platform/shared/documentation-authority-contract.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.suites).toEqual([]);
    expect(selection.owners).not.toContain('bounded-slow-risk');
    expect(selection.reasons).toContain('ownership-impact');
    expect(selection.resolved).toBe(true);
  }
});

test('staged runtime helper bounded ownership rejects path prefix collisions', () => {
  for (const file of [
    'tests/helpers/semantic-mutation-runtime-target-swap-runner.tsx',
    'tests/helpers/semantic-mutation-runtime-target-swap-runner.ts/evil',
    'tests/helpers/semantic-mutation-runtime-target-swap-runner-copy.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.resolved).toBe(false);
    expect(selection.reasons).toContain('changed-files-unresolved');
    expect(selection.reasons).not.toContain('bounded-baseline');
  }
});

test('dev-runner mandatory ownership rejects CLI prefix collisions', () => {
  for (const file of [
    'platform/dev-runner.tsx',
    'platform/dev-runner.ts/evil',
    'platform/dev-runner.ts-anything',
    'platform/dev-runner/new-unowned-module.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.resolved).toBe(false);
    expect(selection.reasons).toContain('changed-files-unresolved');
    expect(selection.reasons).toContain('changed-files-unresolved');
  }
});

test('assertion-only testkit helpers rely on direct test impact instead of broad slow baseline', () => {
  const selection = selectCiPrRiskSlowSuites(['tests/testkit/contracts.ts']);
  expect(selection.suites).toEqual([]);
  expect(selection.slowTests).toEqual([]);
  expect(selection.affectedSlowTests).toEqual([]);
  expect(selection.owners).toContain('module-graph');
  expect(selection.reasons).toContain('ownership-impact');
  expect(selection.resolved).toBe(true);
});

test('package and direct slow changes form a stable exact union instead of returning early', () => {
  const selection = selectCiPrRiskSlowSuites([
    'package.json',
    'tests/e2e/dry-run-plan.test.ts',
    'platform/compiler/verify/run-runtime-verification.ts'
  ]);
  expect(selection.suites).toEqual(expect.arrayContaining([
    'e2e-dry-run-plan',
    'e2e-verify-lock'
  ]));
  expect(selection.affectedSlowTests).toEqual(expect.arrayContaining([
    'tests/e2e/dry-run-plan.test.ts',
    'tests/e2e/verification.test.ts'
  ]));
  expect(selection.reasons).toEqual([
    'direct-slow-test',
    'ownership-impact'
  ]);
  expect(selection.resolved).toBe(true);
});

test('unresolved file discovery selects bounded sentinels but is never exact selection success', () => {
  expect(selectCiPrRiskSlowSuites(null)).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reasons: ['bounded-baseline', 'changed-files-unresolved'],
    resolved: false
  });
});

test('every unmapped changed path fails closed even when another path has known impact', () => {
  for (const file of ['assets/new.bin', 'platform/new-unreferenced.ts']) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.resolved).toBe(false);
    expect(selection.reasons).toContain('changed-files-unresolved');
    expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
  }

  const mixed = selectCiPrRiskSlowSuites([
    'platform/compiler/verify/run-runtime-verification.ts',
    'assets/new.bin'
  ]);
  expect(mixed.resolved).toBe(false);
  expect(mixed.reasons).toEqual(expect.arrayContaining([
    'changed-files-unresolved',
    'ownership-impact'
  ]));
  expect(mixed.suites).toEqual(expect.arrayContaining([
    ...baselineSuites,
    'e2e-verify-lock'
  ]));
});

test('documentation ownership stays resolved without running the transaction lifecycle suite', () => {
  const documentation = selectCiPrRiskSlowSuites([
    'README.md',
    'docs/product.md',
    'docs/roadmap.md',
    'docs/work/current-state.yaml',
    'docs/governance/nexus-absorption-ledger.yaml'
  ]);
  expect(documentation.resolved).toBe(true);
  expect(documentation.reasons).not.toContain('changed-files-unresolved');
  expect(documentation.suites).toEqual([]);
  expect(documentation.affectedSlowTests).toEqual([]);

  const directSlowTest = selectCiPrRiskSlowSuites(['tests/e2e/dry-run-plan.test.ts']);
  expect(directSlowTest.resolved).toBe(true);
  expect(directSlowTest.reasons).toContain('direct-slow-test');
  expect(directSlowTest.suites).toContain('e2e-dry-run-plan');

  const importOrganizerAcceptance = selectCiPrRiskSlowSuites([
    'tests/e2e/import-organizer-staged.test.ts',
    'tests/e2e/import-organizer-worktree-isolation.test.ts'
  ]);
  expect(importOrganizerAcceptance.resolved).toBe(true);
  expect(importOrganizerAcceptance.reasons).toContain('direct-slow-test');
  expect(importOrganizerAcceptance.suites).toEqual(['e2e-import-organizer-staged']);
});

test('documentation tombstones resolve exactly while unknown docs YAML fails closed', () => {
  expect(selectCiPrRiskSlowSuites([...DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['documentation-authority'],
    reasons: ['ownership-impact'],
    resolved: true
  });

  for (const file of [
    'docs/work/manifest.yaml',
    'docs/governance/contracts/policy.yaml',
    'docs/unregistered.manifest.yaml'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.resolved).toBe(false);
    expect(selection.owners).toContain('bounded-slow-risk');
    expect(selection.owners).not.toContain('documentation-authority');
    expect(selection.reasons).toContain('changed-files-unresolved');
  }
});

test('agent governance remains focused without transaction lifecycle coverage', () => {
  const agentGovernance = selectCiPrRiskSlowSuites([
    'AGENTS.md',
    '.codex/agents/implementation-worker.toml',
    '.codex/agents/verification-evidence-reviewer.toml'
  ]);
  expect(agentGovernance.resolved).toBe(true);
  expect(agentGovernance.reasons).toContain('ownership-impact');
  expect(agentGovernance.owners).toEqual(['agent-governance', 'documentation-authority']);
  expect(agentGovernance.suites).toEqual([]);
  expect(agentGovernance.affectedSlowTests).toEqual([]);

  const retired = RETIRED_WORK_PACKAGE_EVIDENCE_TRANSITIONS[0]!;
  const exactDeletion = CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha: retired.baseSha,
    headSha: 'b'.repeat(40),
    records: [{ status: 'removed', path: retired.path }],
    readPathBlob: (revision) => revision === retired.baseSha
      ? { mode: retired.baseMode, blobSha: retired.baseBlobSha }
      : null
  });
  const workPackageGate = selectCiPrRiskSlowSuites([
    retired.path,
    'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json',
    'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json',
    'docs/evidence/v0-4-semantic-mutation-bounded-isolation-scan-exact-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-browser-closure-exact-timeout-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-local-child-exact-public-verification-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-local-child-host-alias-exact-public-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-proof-reuse-exact-timeout-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-durable-exact-stop-record-2026-07-18.json',
    'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-exact-result-loss-record-2026-07-18.json',
    'tests/fixtures/work-package-gate-retained-recovery/records/000001-prepared.json',
    'tests/fixtures/work-package-gate-retained-recovery/records/000002-authoring-committed.json',
    'tests/fixtures/work-package-gate-retained-recovery/records/000003-verified.json',
    'tests/fixtures/work-package-gate-retained-recovery/terminal-order/000000000002.json',
    'tests/fixtures/work-package-gate-retained-recovery/terminal-order/.sequence-head.json'
  ], undefined, exactDeletion);
  expect(workPackageGate.resolved).toBe(true);
  expect(workPackageGate.reasons).toContain('ownership-impact');
  expect(workPackageGate.owners).toEqual(['work-package-gate']);
  expect(workPackageGate.suites).toEqual([]);
  const pathOnlyRetirement = selectCiPrRiskSlowSuites([retired.path]);
  expect(pathOnlyRetirement.resolved).toBe(false);
  expect(pathOnlyRetirement.reasons).toContain('changed-files-unresolved');

  for (const file of [
    'docs/project-state.json',
    'docs/evidence/unowned.json',
    'docs/evidence/archive/probe.json',
    '.codex/agents/unowned.toml',
    'tests/fixtures/other/prepared.json',
    'tests/fixtures/work-package-gate-retained-recovery/runtime-hook.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.resolved).toBe(false);
    expect(selection.reasons).toContain('changed-files-unresolved');
  }
});

test('runner build changes select only the focused verification PR-risk suite', () => {
  for (const source of [
    'platform/compiler/verify/semantic-mutation-runner-build-child.ts',
    'platform/compiler/verify/semantic-mutation-runner-build-protocol.ts',
    'platform/compiler/verify/semantic-mutation-runner-build-settlement.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([source]);
    expect(selection.suites).toEqual(['e2e-verify-lock']);
    expect(selection.resolved).toBe(true);
    expect(selection.reasons).toEqual(['ownership-impact']);
  }
});

test('AppContainer settlement changes select only the native slow acceptance owner', () => {
  const selection = selectCiPrRiskSlowSuites([
    'platform/shared/windows-appcontainer-native-helper-settlement.ts'
  ]);
  expect(selection.suites).toEqual(['e2e-windows-appcontainer-executor']);
  expect(selection.slowTests).toEqual([]);
  expect(selection.affectedSlowTests).toEqual(['tests/e2e/windows-appcontainer-executor.test.ts']);
  expect(selection.owners).toEqual(['module-graph', 'windows-appcontainer-hardening']);
  expect(selection.reasons).toEqual(['ownership-impact']);
  expect(selection.resolved).toBe(true);
});
