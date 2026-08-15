import { expect, test } from 'bun:test';

import {
  CodexDevelopmentCreateTestImpactTransitionObservationV1
} from '../../platform/shared/ci-git-changed-files.ts';
import {
  classifyTestImpactSource,
  resolveTestOwnership,
  selectTestsForSources,
  testImpactFallbackRules
} from '../../platform/shared/test-impact-contract.ts';
import {
  DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES,
  FROZEN_WORK_PACKAGE_TOMBSTONE_FILES,
  RETIRED_WORK_PACKAGE_EVIDENCE_TRANSITIONS
} from '../../platform/shared/test-impact-rules/governance.ts';
import { resolveTestOwnershipAutoReferenceMode } from '../../platform/shared/test-ownership-contract.ts';

test('test impact classifies current source categories deterministically', () => {
  expect(classifyTestImpactSource('platform/compiler/semantic-linker.ts')).toBe('typescript');
  expect(classifyTestImpactSource('platform/registry/official/ticket.basic/block.manifest.yaml')).toBe('manifest');
  expect(classifyTestImpactSource('platform/registry/official/ticket.basic/contracts/ticket.yaml')).toBe('semantic-contract');
  expect(classifyTestImpactSource('source/model/app.plan.yaml')).toBe('source-model');
  for (const file of [
    'README.md',
    'docs/roadmap.md',
    'docs/compiler-target-ir.md',
    'docs/work/current-state.yaml',
    'docs/work/active-work-package.md',
    'docs/governance/external-capability-ledger.yaml',
    'docs/governance/nexus-absorption-ledger.yaml'
  ]) expect(classifyTestImpactSource(file)).toBe('active-documentation');
  for (const file of [
    'docs/03-MVP实施计划与路线图.md',
    'docs/work/manifest.yaml',
    'docs/governance/contracts/policy.yaml',
    'docs/unregistered.manifest.yaml',
    'docs/evidence/unowned.yaml',
    'docs/project-state.json',
    'docs/architecture/unowned.yaml'
  ]) expect(classifyTestImpactSource(file)).toBeNull();
});

test('test impact selector includes tests that directly import changed sources', () => {
  const selection = selectTestsForSources(['platform/shared/test-impact-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.fast).toContain('tests/contract/test-impact.test.ts');
  expect(selection.slow).not.toContain('tests/contract/test-impact.test.ts');
});

test('local-main closeout routes to its focused authority and physical Risk closure', () => {
  const selection = selectTestsForSources(['scripts/codex/local-main-closeout.ts']);

  expect(selection.owners).toContain('verification-session-branch-closeout-authority');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/local-main-closeout.test.ts',
    'tests/unit/verification-session-runtime.test.ts'
  ]));
  expect(selection.slow).toEqual(['tests/e2e/verification-session-closeout-cli.test.ts']);
});

test('IssueDisposition sources select the bounded lifecycle and merge seams only', () => {
  const sourceFiles = [
    'platform/shared/issue-disposition-contract.ts',
    'scripts/codex/issue-disposition-github.ts',
    'scripts/codex/issue-disposition.ts'
  ];
  const expected = {
    fast: [
      'tests/contract/sec-merge-gate.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/issue-disposition-contract.test.ts',
      'tests/unit/issue-disposition-github.test.ts',
      'tests/unit/verification-session-runtime.test.ts'
    ],
    slow: [],
    owners: ['issue-disposition']
  };
  for (const source of sourceFiles) {
    expect(selectTestsForSources([source])).toEqual(expected);
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'issue-disposition',
      identity: { kind: 'contract', id: 'issue-disposition' }
    }]);
  }
});

test('repository and documentation changes select registry-backed owner contracts', () => {
  for (const source of [
    'README.md',
    'docs/roadmap.md',
    'docs/compiler-target-ir.md'
  ]) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toContain('documentation-authority');
    expect(selection.fast).toEqual(expect.arrayContaining([
      'tests/contract/documentation-authority.test.ts',
      'tests/contract/docs-doctor.test.ts',
      'tests/contract/test-impact.test.ts'
    ]));
    expect(selection.slow).toEqual([]);
  }
  expect(selectTestsForSources(['package.json'])).toEqual({
    fast: [
      'tests/contract/benchmark-budget.test.ts',
      'tests/contract/repository-runtime.test.ts',
      'tests/integration/compiler-dependency-installation.test.ts',
      'tests/integration/project-base.test.ts',
      'tests/integration/project-dependency-runtime.test.ts'
    ],
    slow: [],
    owners: ['repository-package-contract']
  });
  expect(selectTestsForSources(['bun.lock'])).toEqual({
    fast: ['tests/integration/compiler-dependency-installation.test.ts'],
    slow: [],
    owners: ['repository-lockfile-contract']
  });
});

test('non-active documentation lifecycles have explicit owners without a docs catch-all', () => {
  const historicalSources = [
    'docs/archive/authority-v5/00-文档索引与一致性规则.md',
    'docs/archive/authority-v5/work/current-state.yaml',
    'docs/archive/work-packages/workspace-write-lease-portability-v1.md',
    'docs/archive/example/block.manifest.yaml'
  ];
  for (const source of historicalSources) {
    expect(classifyTestImpactSource(source)).toBeNull();
    expect(selectTestsForSources([source])).toEqual({
      fast: [
        'tests/contract/agent-skills.test.ts',
        'tests/contract/docs-doctor-byte-exact.test.ts',
        'tests/contract/documentation-authority.test.ts',
        'tests/contract/documentation-corpus-census.test.ts',
        'tests/contract/documentation-ownership-closure.test.ts',
        'tests/contract/repository-audit.test.ts',
        'tests/contract/test-impact.test.ts',
        'tests/unit/active-documentation-contract.test.ts',
        'tests/unit/codex-work-package-contract.test.ts',
        'tests/unit/documentation-authority-registry-v2.test.ts'
      ],
      slow: [],
      owners: ['historical-documentation']
    });
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'historical-documentation',
      identity: { kind: 'contract', id: 'historical-documentation' }
    }]);
  }

  for (const evidenceSource of [
    'docs/evidence/documentation/active-documentation-corpus-v1.md',
    'docs/evidence/documentation/example.manifest.yaml',
    'docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md',
    'docs/evidence/2026-08-04-canonical-architecture-convergence.md',
    'docs/evidence/2026-08-04-full-architecture-asset-audit.md'
  ]) {
    expect(classifyTestImpactSource(evidenceSource)).toBeNull();
    expect(selectTestsForSources([evidenceSource])).toEqual({
      fast: [
        'tests/contract/agent-skills.test.ts',
        'tests/contract/docs-doctor-byte-exact.test.ts',
        'tests/contract/documentation-corpus-census.test.ts',
        'tests/contract/documentation-ownership-closure.test.ts',
        'tests/contract/repository-audit.test.ts',
        'tests/contract/test-impact.test.ts',
        'tests/unit/active-documentation-contract.test.ts',
        'tests/unit/documentation-authority-registry-v2.test.ts'
      ],
      slow: [],
      owners: ['documentation-evidence']
    });
    expect(resolveTestOwnership([evidenceSource])).toEqual([{
      source: evidenceSource,
      owner: 'documentation-evidence',
      identity: { kind: 'contract', id: 'documentation-evidence' }
    }]);
  }

  for (const source of [
    'docs/architecture/unowned.md',
    'docs/new-unregistered-authority.md',
    'docs/work/manifest.yaml',
    'docs/governance/contracts/policy.yaml',
    'docs/unregistered.manifest.yaml',
    'docs/evidence/unowned.yaml'
  ]) {
    expect(classifyTestImpactSource(source)).toBeNull();
    expect(selectTestsForSources([source])).toEqual({
      fast: [],
      slow: [],
      owners: []
    });
    expect(resolveTestOwnership([source])).toEqual([]);
  }
});

test('documentation migrations retain exact tombstone ownership without reactivation', () => {
  for (const source of DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES) {
    expect(classifyTestImpactSource(source)).toBeNull();
  }
  expect(selectTestsForSources([...DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES])).toEqual({
    fast: ['tests/contract/documentation-authority.test.ts'],
    slow: [],
    owners: ['documentation-authority']
  });
  expect(resolveTestOwnership([...DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES])).toEqual(
    DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES.map((source) => ({
      source,
      owner: 'documentation-authority',
      identity: { kind: 'contract', id: 'documentation-authority' }
    }))
  );
});

test('runtime dependency authorities select only their exact fast and slow owners', () => {
  expect(selectTestsForSources(['platform/shared/project-runtime.ts'])).toEqual({
    fast: [
      'tests/contract/project-runtime-contract.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/integration/compiler-dependency-installation.test.ts',
      'tests/integration/project-dependency-runtime.test.ts',
      'tests/unit/dependency-environment.test.ts',
      'tests/unit/playwright-browser-cache.test.ts',
      'tests/unit/runtime-verification.test.ts',
      'tests/unit/semantic-mutation-isolated-child-fence.test.ts'
    ],
    slow: ['tests/e2e/runtime-host.test.ts'],
    owners: ['project-runtime-authority']
  });
  expect(selectTestsForSources(['platform/shared/runtime-dependency-spec.ts'])).toEqual({
    fast: [
      'tests/contract/test-impact.test.ts',
      'tests/integration/project-base.test.ts',
      'tests/integration/project-dependency-runtime.test.ts',
      'tests/unit/playwright-browser-cache.test.ts',
      'tests/unit/runtime-dependency-spec.test.ts',
      'tests/unit/runtime-verification.test.ts',
      'tests/unit/semantic-mutation-isolated-child-fence.test.ts'
    ],
    slow: ['tests/e2e/runtime-host.test.ts'],
    owners: ['runtime-dependency-spec']
  });
  expect(selectTestsForSources(['platform/shared/project-base.ts'])).toEqual({
    fast: [
      'tests/contract/test-impact.test.ts',
      'tests/integration/project-base.test.ts',
      'tests/integration/project-dependency-runtime.test.ts'
    ],
    slow: ['tests/e2e/runtime-host.test.ts'],
    owners: ['project-base']
  });
});

test('trusted verifier TCB surfaces select the causal trust-root contracts', () => {
  const expected = {
    fast: [
      'tests/contract/ci-contract.test.ts',
      'tests/contract/ci-lanes.test.ts',
      'tests/contract/sec-merge-gate.test.ts',
      'tests/contract/tcb-closure-lock.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/agent-operation-activation.test.ts',
      'tests/unit/local-github-actions-runner.test.ts',
      'tests/unit/tcb-trust-root-contract.test.ts'
    ],
    slow: [],
    owners: ['trusted-verifier-tcb']
  };
  for (const source of [
    '.github/workflows/compiler-pr-validation.yml',
    '.github/workflows/compiler-release-validation.yml',
    '.github/workflows/sec-trusted-bootstrap.yml',
    'platform/shared/ci-trust-root-registry.json',
    'platform/shared/tcb-closure-lock.ts',
    'platform/shared/tcb-trust-root-contract.ts',
    'scripts/codex/local-github-actions-runner.ts',
    'scripts/codex/merge-gate.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual(expected);
  }
});

test('Task Envelope changes select behavior instead of source-text assertions', () => {
  for (const source of [
    'platform/compiler/synthesize/build-task-envelope.ts',
    'platform/shared/task-envelope-types.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual({
      fast: [
        'tests/contract/test-impact.test.ts',
        'tests/integration/repair.test.ts',
        'tests/unit/task-envelope.test.ts'
      ],
      slow: ['tests/e2e/repair.test.ts'],
      owners: ['task-envelope']
    });
  }
  expect(selectTestsForSources(['platform/shared/contract-freeze-contract.ts'])).toEqual({
    fast: ['tests/contract/contract-freeze.test.ts'],
    slow: [],
    owners: ['auto-reference', 'contract-freeze']
  });
});

test('test impact scanner uses pinned Bun syntax scanning without import-like text false positives', () => {
  const selected = 'tests/unit/virtual-import-impact.test.ts';
  const ignored = 'tests/unit/virtual-import-text.test.ts';
  const provider = {
    testFiles: [selected, ignored],
    readTestSource: (testFile: string): string | null => {
      if (testFile === selected) {
        return [
          "import type {} from '../../platform/shared/test-impact-contract.ts';",
          "export { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';",
          "void import('../../platform/shared/test-impact-contract.ts');"
        ].join('\n');
      }
      if (testFile === ignored) {
        return "const text = \"import '../../platform/shared/test-impact-contract.ts'\"; void text;";
      }
      return null;
    }
  };
  const selection = selectTestsForSources(['platform/shared/test-impact-contract.ts'], provider);

  expect(selection.fast).toContain(selected);
  expect(selection.fast).not.toContain(ignored);
});

test('test ownership auto-reference mode defaults to include and rejects conflicting owners', () => {
  const declaration = {
    owner: 'owner-a',
    identity: { kind: 'contract' as const, id: 'owner-a' },
    sourceFiles: ['source.ts'],
    fast: [],
    slow: []
  };
  expect(resolveTestOwnershipAutoReferenceMode([])).toBe('include');
  expect(resolveTestOwnershipAutoReferenceMode([declaration])).toBe('include');
  expect(resolveTestOwnershipAutoReferenceMode([{
    ...declaration,
    autoReferenceMode: 'declared-only'
  }])).toBe('declared-only');
  expect(() => resolveTestOwnershipAutoReferenceMode([
    declaration,
    { ...declaration, owner: 'owner-b', autoReferenceMode: 'declared-only' }
  ])).toThrow('conflicting auto-reference modes');
});

test('test-impact rule files remain verification infrastructure rather than product owners', () => {
  for (const [source, productOwner] of [
    ['platform/shared/test-impact-rules/semantic.ts', 'semantic-mutation'],
    ['platform/shared/test-impact-rules/pipeline.ts', 'pipeline-kernel']
  ] as const) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toContain('verification-infrastructure');
    expect(selection.owners).not.toContain(productOwner);
    expect(selection.slow).toEqual([]);
  }
});

test('affected selection authority has one explicit local and hosted verification owner', () => {
  for (const source of [
    'platform/shared/affected-test-inventory.ts',
    'platform/shared/verification-scope-inventory.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual({
      fast: [
        'tests/contract/ci-lanes.test.ts',
        'tests/contract/sec-merge-gate.test.ts',
        'tests/contract/test-impact.test.ts',
        'tests/unit/ci-pr-risk-selection.test.ts',
        'tests/unit/ci-verification-composition-execution.test.ts',
        'tests/unit/test-runner.test.ts'
      ],
      slow: [],
      owners: ['affected-test-selection']
    });
  }
});

test('exact blob reader and both Evidence producers share one direct execution owner', () => {
  const expected = {
    fast: [
      'tests/contract/ci-contract.test.ts',
      'tests/contract/ci-lanes.test.ts',
      'tests/contract/sec-merge-gate.test.ts',
      'tests/contract/tcb-closure-lock.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-evidence-contract-v4.test.ts',
      'tests/unit/ci-hosted-sut-observation-contract.test.ts',
      'tests/unit/ci-pr-risk-execution.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts',
      'tests/unit/ci-verification-composition-execution.test.ts',
      'tests/unit/ci-verification-execution.test.ts',
      'tests/unit/exact-git-blob.test.ts',
      'tests/unit/tcb-trust-root-contract.test.ts',
      'tests/unit/verification-action-github-provider.test.ts'
    ],
    slow: [],
    owners: ['verification-evidence-producers']
  };
  for (const source of [
    'platform/shared/ci-evidence-contract.ts',
    'platform/shared/ci-hosted-sut-observation-contract.ts',
    'scripts/codex/ci-orchestration-core.ts',
    'scripts/ci-verification.ts',
    'scripts/codex/exact-git-blob.ts',
    'scripts/codex/verification-action-github-provider.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual(expected);
  }
  expect(selectTestsForSources(['scripts/ci-pr-risk.ts'])).toEqual({
    ...expected,
    fast: [...expected.fast, 'tests/unit/heavy-verification-gate-lease.test.ts'].sort()
  });
});

test('canonical VerificationAction fixture selects only its direct consumer and selector contract', () => {
  expect(selectTestsForSources(['tests/helpers/verification-action-fixtures.ts'])).toEqual({
    fast: [
      'tests/contract/test-impact.test.ts',
      'tests/unit/verification-action-github-provider.test.ts'
    ],
    slow: [],
    owners: ['auto-reference', 'verification-action-test-fixture']
  });
});

test('branch closeout and VerificationSession authority select one exact fast closure', () => {
  const sourceLockSources = [
    'scripts/codex/sec-merge-bootstrap-contract.ts',
    'scripts/codex/sec-merge-bootstrap-runtime.ts',
    'scripts/codex/sec-merge-bootstrap.ts',
    'scripts/codex/integration-authorization-publication.ts',
    'scripts/codex/verification-session-github.ts',
    'scripts/codex/verification-session.ts'
  ];
  const otherSources = [
    'platform/shared/verification-session-contract.ts',
    'scripts/codex/branch-closeout-contract.ts',
    'scripts/codex/branch-closeout-receipt.ts',
    'scripts/codex/branch-closeout.ts',
    'scripts/codex/branch-lifecycle-audit.ts',
    'scripts/codex/branch-lifecycle-config.ts',
    'scripts/codex/branch-lifecycle-command.ts',
    'scripts/codex/branch-lifecycle-inventory.ts',
    'scripts/codex/branch-lifecycle.ts',
    'scripts/codex/branch-recovery.ts',
    'scripts/codex/local-main-closeout.ts',
    'scripts/codex/verification-candidate-tree.ts',
    'scripts/codex/verification-session-runtime.ts'
  ];
  const expected = {
    fast: [
      'tests/contract/ci-contract.test.ts',
      'tests/contract/document-control-plane-lifecycle.test.ts',
      'tests/contract/sec-merge-gate.test.ts',
      'tests/contract/tcb-closure-lock.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/agent-operation-activation.test.ts',
      'tests/unit/branch-closeout-receipt.test.ts',
      'tests/unit/branch-closeout-rest-comments.test.ts',
      'tests/unit/branch-lifecycle-contract.test.ts',
      'tests/unit/branch-lifecycle-temp-repo.test.ts',
      'tests/unit/integration-authorization-publication.test.ts',
      'tests/unit/local-main-closeout.test.ts',
      'tests/unit/tcb-trust-root-contract.test.ts',
      'tests/unit/verification-action-ci-contract.test.ts',
      'tests/unit/verification-candidate-tree.test.ts',
      'tests/unit/verification-session-contract.test.ts',
      'tests/unit/verification-session-runtime.test.ts',
      'tests/unit/work-selection-live.test.ts'
    ],
    slow: ['tests/e2e/verification-session-closeout-cli.test.ts'],
    owners: ['verification-session-branch-closeout-authority']
  };
  for (const source of otherSources) {
    expect(selectTestsForSources([source])).toEqual(expected);
  }
  for (const source of sourceLockSources) {
    expect(selectTestsForSources([source])).toEqual({
      ...expected,
      fast: [...expected.fast, 'tests/unit/sec-merge-bootstrap.test.ts'].sort()
    });
  }
  const sources = [...otherSources, ...sourceLockSources];
  expect(resolveTestOwnership(sources)).toEqual(sources.map((source) => ({
    source,
    owner: 'verification-session-branch-closeout-authority',
    identity: {
      kind: 'architecture-owner',
      id: 'verification-session-branch-closeout-authority'
    }
  })));
});

test('worktree physical closeout selects its focused owner closure', () => {
  const expected = {
    fast: [
      'tests/contract/test-impact.test.ts',
      'tests/unit/branch-lifecycle-contract.test.ts',
      'tests/unit/physical-no-follow.test.ts',
      'tests/unit/worktree-physical-closeout-contract.test.ts',
      'tests/unit/worktree-physical-closeout-crash-recovery.test.ts',
      'tests/unit/worktree-physical-closeout-temp-repo.test.ts'
    ],
    slow: [],
    owners: ['git-worktree-physical-closeout']
  };
  for (const source of [
    'platform/shared/physical-no-follow.ts',
    'scripts/codex/worktree-physical-closeout-contract.ts',
    'scripts/codex/worktree-physical-closeout.ts',
    'tests/unit/worktree-physical-closeout-crash-fixture.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual(expected);
  }
});

test('test impact keeps Task Capsule and Read Plan verification in direct fast owners', () => {
  const activationFast = [
    'tests/contract/ci-contract.test.ts',
    'tests/contract/ci-lanes.test.ts',
    'tests/contract/operation-read-plan.test.ts',
    'tests/contract/sec-merge-gate.test.ts',
    'tests/contract/skill-applicability.test.ts',
    'tests/contract/tcb-closure-lock.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/agent-operation-activation.test.ts',
    'tests/unit/local-github-actions-runner.test.ts',
    'tests/unit/tcb-trust-root-contract.test.ts'
  ].sort();
  for (const source of [
    'platform/shared/agent-operation-activation-contract.ts',
    'scripts/codex/agent-operation-activation-census.ts',
    'scripts/codex/agent-operation-activation.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual({
      fast: activationFast,
      slow: [],
      owners: ['agent-operation-activation']
    });
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'agent-operation-activation',
      identity: { kind: 'contract', id: 'agent-operation-activation' }
    }]);
  }

  const taskCapsuleFast = [
    'tests/contract/operation-read-plan.test.ts',
    'tests/contract/skill-applicability.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/agent-operation-read-plan.test.ts',
    'tests/unit/agent-task-capsule.test.ts',
    'tests/unit/skill-applicability-decision.test.ts'
  ].sort();
  for (const source of [
    'platform/shared/agent-task-capsule-contract.ts',
    'scripts/codex/task-capsule.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual({
      fast: taskCapsuleFast,
      slow: [],
      owners: ['agent-task-capsule']
    });
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'agent-task-capsule',
      identity: { kind: 'contract', id: 'agent-task-capsule' }
    }]);
  }

  const readPlanFast = [
    'tests/contract/operation-read-plan.test.ts',
    'tests/contract/skill-applicability.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/agent-operation-read-plan.test.ts'
  ].sort();
  for (const source of [
    'platform/shared/agent-operation-read-plan-contract.ts',
    'scripts/codex/operation-read-plan.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual({
      fast: readPlanFast,
      slow: [],
      owners: ['agent-operation-read-plan']
    });
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'agent-operation-read-plan',
      identity: { kind: 'contract', id: 'agent-operation-read-plan' }
    }]);
  }
});

test('Work Package authorityRefs parser routes every direct activation and owner-closure consumer', () => {
  const source = 'scripts/codex/work-package-contract.ts';
  expect(selectTestsForSources([source])).toEqual({
    fast: [
      'tests/contract/docs-doctor.test.ts',
      'tests/contract/document-control-plane-lifecycle.test.ts',
      'tests/contract/documentation-authority.test.ts',
      'tests/contract/operation-read-plan.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/agent-operation-activation.test.ts',
      'tests/unit/codex-work-package-contract.test.ts'
    ],
    slow: [],
    owners: ['work-package-contract']
  });
  expect(resolveTestOwnership([source])).toEqual([{
    source,
    owner: 'work-package-contract',
    identity: { kind: 'contract', id: 'work-package-contract' }
  }]);
});

test('test impact keeps WorkDecision Phase A B C in one direct fast owner', () => {
  const fast = [
    'tests/contract/docs-doctor.test.ts',
    'tests/contract/document-control-plane-lifecycle.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/agent-operation-activation.test.ts',
    'tests/unit/branch-lifecycle-contract.test.ts',
    'tests/unit/verification-candidate-tree.test.ts',
    'tests/unit/work-selection-contract.test.ts',
    'tests/unit/work-selection-live.test.ts'
  ];
  for (const source of [
    'platform/shared/work-selection-contract.ts',
    'platform/shared/work-selection-live-contract.ts',
    'scripts/codex/work-selection.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual({
      fast,
      slow: [],
      owners: ['work-selection']
    });
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'work-selection',
      identity: { kind: 'contract', id: 'work-selection' }
    }]);
  }
});

test('MainHealth owner selects its Work Selection cross-owner consumer', () => {
  const fast = [
    'tests/contract/ci-contract.test.ts',
    'tests/contract/default-branch-revision-health.test.ts',
    'tests/contract/document-control-plane-lifecycle.test.ts',
    'tests/contract/sec-merge-gate.test.ts',
    'tests/contract/tcb-closure-lock.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/main-health-contract.test.ts',
    'tests/unit/main-health-repair-contract.test.ts',
    'tests/unit/tcb-trust-root-contract.test.ts',
    'tests/unit/verification-session-runtime.test.ts',
    'tests/unit/work-selection-live.test.ts'
  ];
  for (const source of [
    'platform/shared/default-branch-revision-health.ts',
    'platform/shared/main-health-contract.ts',
    'platform/shared/main-health-repair-contract.ts',
    'scripts/codex/main-health-observation.ts',
    'scripts/codex/main-health-repair.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual({
      fast,
      slow: [],
      owners: ['main-health']
    });
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'main-health',
      identity: { kind: 'architecture-owner', id: 'main-health' }
    }]);
  }
});

test('changed-file observation owns dynamic dev-runner and privileged TCB consumers', () => {
  const source = 'platform/shared/ci-git-changed-files.ts';
  expect(selectTestsForSources([source])).toEqual({
    fast: [
      'tests/contract/ci-contract.test.ts',
      'tests/contract/ci-lanes.test.ts',
      'tests/contract/dev-runner-contract.test.ts',
      'tests/contract/sec-merge-gate.test.ts',
      'tests/contract/tcb-closure-lock.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/agent-operation-activation.test.ts',
      'tests/unit/ci-git-changed-files.test.ts',
      'tests/unit/ci-pr-risk-execution.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts',
      'tests/unit/ci-verification-execution.test.ts',
      'tests/unit/local-github-actions-runner.test.ts',
      'tests/unit/tcb-trust-root-contract.test.ts',
      'tests/unit/verification-session-runtime.test.ts'
    ],
    slow: [],
    owners: ['auto-reference', 'git-changed-file-observation']
  });
  expect(resolveTestOwnership([source])).toEqual([{
    source,
    owner: 'git-changed-file-observation',
    identity: { kind: 'architecture-owner', id: 'git-changed-file-observation' }
  }]);
});

test('ordinary Skill authoring selects only its causal contract closure', () => {
  const source = '.agents/skills/sec-heuristic-governance/SKILL.md';
  expect(selectTestsForSources([source])).toEqual({
    fast: [
      'tests/contract/agent-skills.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/agent-skill-markdown-classification.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts'
    ],
    slow: [],
    owners: ['agent-skill-authoring']
  });
  expect(resolveTestOwnership([source])).toEqual([{
    source,
    owner: 'agent-skill-authoring',
    identity: { kind: 'contract', id: 'agent-skill-authoring' }
  }]);
});

test('test impact assigns focused governance and frozen work-package ownership', () => {
  const agentGovernance = selectTestsForSources([
    'AGENTS.md',
    '.codex/agents/implementation-worker.toml',
    '.codex/agents/verification-evidence-reviewer.toml'
  ]);
  expect(agentGovernance.owners).toEqual([
    'agent-governance',
    'documentation-authority'
  ]);
  expect(agentGovernance.fast).toEqual(expect.arrayContaining([
    'tests/unit/agent-skill-markdown-classification.test.ts',
    'tests/unit/ci-pr-risk-selection.test.ts',
    'tests/contract/documentation-authority.test.ts',
    'tests/contract/test-impact.test.ts'
  ]));
  expect(agentGovernance.slow).toEqual([]);
  for (const source of [
    'docs/authority.json',
    'platform/shared/active-documentation-contract.ts'
  ]) {
    expect(selectTestsForSources([source]).fast).toContain(
      'tests/unit/local-gate-union.test.ts'
    );
  }

  const frozenManifest = 'docs/work-packages/active-documentation-corpus-v1.md';
  const frozenSelection = selectTestsForSources([frozenManifest]);
  expect(frozenSelection.owners).toEqual(['frozen-work-package']);
  expect(frozenSelection.fast).toEqual(expect.arrayContaining([
    'tests/contract/document-control-plane-lifecycle.test.ts',
    'tests/contract/documentation-authority.test.ts',
    'tests/contract/docs-doctor.test.ts',
    'tests/unit/codex-work-package-contract.test.ts'
  ]));
  expect(resolveTestOwnership([frozenManifest])).toEqual([{
    source: frozenManifest,
    owner: 'frozen-work-package',
    identity: { kind: 'contract', id: 'frozen-work-package' }
  }]);

  for (const tombstone of FROZEN_WORK_PACKAGE_TOMBSTONE_FILES) {
    expect(selectTestsForSources([tombstone])).toEqual({
      fast: ['tests/contract/documentation-authority.test.ts'],
      slow: [],
      owners: ['frozen-work-package']
    });
    expect(resolveTestOwnership([tombstone])).toEqual([{
      source: tombstone,
      owner: 'frozen-work-package',
      identity: { kind: 'contract', id: 'frozen-work-package' }
    }]);
  }

  const retiredEvidence = RETIRED_WORK_PACKAGE_EVIDENCE_TRANSITIONS[0]!;
  const exactDeletion = CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha: retiredEvidence.baseSha,
    headSha: 'b'.repeat(40),
    records: [{ status: 'removed', path: retiredEvidence.path }],
    readPathBlob: (revision) => revision === retiredEvidence.baseSha
      ? { mode: retiredEvidence.baseMode, blobSha: retiredEvidence.baseBlobSha }
      : null
  });
  const workPackageEvidenceSources = [
    retiredEvidence.path,
    'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json',
    'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json',
    'docs/evidence/v0-4-semantic-mutation-bounded-isolation-scan-exact-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-browser-closure-exact-timeout-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-local-child-exact-public-verification-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-local-child-host-alias-exact-public-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-proof-reuse-exact-timeout-stop-record-2026-07-17.json',
    'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-durable-exact-stop-record-2026-07-18.json',
    'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-exact-result-loss-record-2026-07-18.json'
  ];
  const workPackageEvidence = selectTestsForSources(workPackageEvidenceSources, undefined, exactDeletion);
  expect(workPackageEvidence.owners).toEqual(['work-package-gate']);
  expect(workPackageEvidence.fast).toEqual(expect.arrayContaining([
    'tests/unit/ci-pr-risk-selection.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/work-package-gate-contract.test.ts',
    'tests/unit/work-package-gate-execution.test.ts'
  ]));
  expect(workPackageEvidence.slow).toEqual([]);

  const workPackageFixtureSources = [
    'tests/fixtures/work-package-gate-retained-recovery/records/000001-prepared.json',
    'tests/fixtures/work-package-gate-retained-recovery/records/000002-authoring-committed.json',
    'tests/fixtures/work-package-gate-retained-recovery/records/000003-verified.json',
    'tests/fixtures/work-package-gate-retained-recovery/terminal-order/000000000002.json',
    'tests/fixtures/work-package-gate-retained-recovery/terminal-order/.sequence-head.json'
  ];
  const workPackageFixtures = selectTestsForSources(workPackageFixtureSources);
  expect(workPackageFixtures.owners).toEqual(['work-package-gate']);
  expect(workPackageFixtures.fast).toEqual(expect.arrayContaining([
    'tests/unit/ci-pr-risk-selection.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/work-package-gate-execution.test.ts'
  ]));
  expect(workPackageFixtures.fast).not.toContain('tests/unit/work-package-gate-contract.test.ts');
  expect(workPackageFixtures.slow).toEqual([]);
  for (const source of [...workPackageEvidenceSources, ...workPackageFixtureSources]) {
    expect(resolveTestOwnership(
      [source],
      source === retiredEvidence.path ? exactDeletion : undefined
    )).toEqual([{
      source,
      owner: 'work-package-gate',
      identity: { kind: 'contract', id: 'work-package-gate' }
    }]);
  }
});

test('retired evidence transition ownership rejects path-only, re-add, modify, wrong-base, and wrong-blob inputs', () => {
  const retired = RETIRED_WORK_PACKAGE_EVIDENCE_TRANSITIONS[0]!;
  const headSha = 'b'.repeat(40);
  const observation = (
    status: 'added' | 'changed' | 'removed',
    baseSha: string = retired.baseSha,
    baseBlobSha: string = retired.baseBlobSha,
    baseMode: '100644' | '100755' = retired.baseMode
  ) => CodexDevelopmentCreateTestImpactTransitionObservationV1({
    baseSha,
    headSha,
    records: [{ status, path: retired.path }],
    readPathBlob: (revision) => status === 'removed' && revision === baseSha
      ? { mode: baseMode, blobSha: baseBlobSha }
      : null
  });
  expect(selectTestsForSources([retired.path])).toEqual({ fast: [], slow: [], owners: [] });
  for (const transition of [
    observation('added'),
    observation('changed'),
    observation('removed', 'c'.repeat(40)),
    observation('removed', retired.baseSha, 'd'.repeat(40)),
    observation('removed', retired.baseSha, retired.baseBlobSha, '100755')
  ]) {
    expect(selectTestsForSources([retired.path], undefined, transition))
      .toEqual({ fast: [], slow: [], owners: [] });
  }
  expect(selectTestsForSources(['docs/evidence/unowned.json'], undefined, observation('removed')))
    .toEqual({ fast: [], slow: [], owners: [] });
});

test('test impact keeps managed Git hooks fast contract coverage and slow real-repository acceptance distinct', () => {
  const sources = [
    'scripts/install-git-hooks.ts',
    '.githooks/pre-commit'
  ];
  const selection = selectTestsForSources(sources);

  expect(selection.owners).toEqual(['auto-reference', 'managed-git-hooks']);
  expect(selection.fast).toEqual([
    'tests/contract/test-impact.test.ts',
    'tests/unit/install-git-hooks.test.ts'
  ]);
  expect(selection.slow).toEqual(['tests/e2e/install-git-hooks.test.ts']);
});

test('dev-runner impact uses explicit lightweight ownership plus direct import sentinels', () => {
  expect(testImpactFallbackRules.filter((rule) => (
    rule.sourcePattern.test('platform/dev-runner/test-runner.ts')
  ))).toEqual([]);

  const rootSelection = selectTestsForSources(['platform/dev-runner.ts']);
  expect(rootSelection).toEqual({
    fast: [
      'tests/contract/dev-runner-contract.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts',
      'tests/unit/heavy-verification-gate-lease.test.ts',
      'tests/unit/verification-action-ci-contract.test.ts'
    ],
    slow: [],
    owners: ['auto-reference', 'dev-runner']
  });

  const moduleSelection = selectTestsForSources(['platform/dev-runner/test-runner.ts']);
  expect(moduleSelection.owners).toEqual(['auto-reference', 'dev-runner']);
  expect(moduleSelection.fast).toEqual([
    'tests/contract/dev-runner-contract.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/ci-pr-risk-selection.test.ts',
    'tests/unit/test-runner.test.ts'
  ]);
  expect(moduleSelection.fast).not.toEqual(expect.arrayContaining([
    'tests/contract/benchmark-budget.test.ts',
    'tests/contract/ci-contract.test.ts',
    'tests/contract/ci-lanes.test.ts',
    'tests/contract/slow-suite-resource-budget.test.ts',
    'tests/integration/compiler-dependency-installation.test.ts',
    'tests/integration/project-base.test.ts',
    'tests/integration/project-dependency-runtime.test.ts'
  ]));
  expect(moduleSelection.slow).toEqual([]);
  expect(resolveTestOwnership(['platform/dev-runner/test-runner.ts'])).toEqual([{
    source: 'platform/dev-runner/test-runner.ts',
    owner: 'dev-runner',
    identity: { kind: 'architecture-owner', id: 'dev-runner' }
  }]);

  expect(selectTestsForSources(['platform/dev-runner/typecheck-runner.ts']).fast).toEqual([
    'tests/contract/dev-runner-contract.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/ci-pr-risk-selection.test.ts'
  ]);

  const bootstrapSelection = selectTestsForSources([
    'platform/dev-runner/dependency-bootstrap.ts'
  ]);
  expect(bootstrapSelection).toEqual({
    fast: [
      'tests/contract/dev-runner-contract.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/dev-runner-dependency-bootstrap.test.ts',
      'tests/unit/test-runner.test.ts'
    ],
    slow: [],
    owners: ['auto-reference', 'dev-runner']
  });
  expect(resolveTestOwnership(['platform/dev-runner/dependency-bootstrap.ts'])).toEqual([{
    source: 'platform/dev-runner/dependency-bootstrap.ts',
    owner: 'dev-runner',
    identity: { kind: 'architecture-owner', id: 'dev-runner' }
  }]);

  const heavyGateSelection = selectTestsForSources([
    'platform/shared/heavy-verification-gate-lease.ts'
  ]);
  expect(heavyGateSelection).toEqual({
    fast: [
      'tests/contract/ci-contract.test.ts',
      'tests/contract/ci-lanes.test.ts',
      'tests/contract/dev-runner-contract.test.ts',
      'tests/contract/sec-merge-gate.test.ts',
      'tests/contract/tcb-closure-lock.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/agent-operation-activation.test.ts',
      'tests/unit/heavy-verification-gate-lease.test.ts',
      'tests/unit/local-github-actions-runner.test.ts',
      'tests/unit/tcb-trust-root-contract.test.ts'
    ],
    slow: [],
    owners: ['auto-reference', 'heavy-verification-gate']
  });
  expect(resolveTestOwnership(['platform/shared/heavy-verification-gate-lease.ts']))
    .toEqual([{
      source: 'platform/shared/heavy-verification-gate-lease.ts',
      owner: 'heavy-verification-gate',
      identity: { kind: 'architecture-owner', id: 'heavy-verification-gate' }
    }]);
  for (const unrelatedSource of [
    'platform/dev-runner/typecheck-runner.ts',
    'scripts/ci-verification.ts'
  ]) {
    expect(selectTestsForSources([unrelatedSource]).fast)
      .not.toContain('tests/unit/heavy-verification-gate-lease.test.ts');
  }
});

test('test impact selector uses auto-reference for CI contract coverage', () => {
  const selection = selectTestsForSources(['platform/shared/ci-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.owners).not.toContain('ci-contract');
  expect(selection.fast).toContain('tests/contract/ci-contract.test.ts');
  expect(selection.fast).toContain('tests/contract/ci-lanes.test.ts');
  expect(selection.slow).toEqual([]);
});

test('test impact selector uses auto-reference for test budget coverage', () => {
  const selection = selectTestsForSources(['platform/shared/test-budget-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.owners).not.toContain('test-budget');
  expect(selection.fast).toContain('tests/contract/benchmark-budget.test.ts');
});

test('test impact selector owns canonical IR changes as semantic core changes', () => {
  const selection = selectTestsForSources(['platform/compiler/ir/build-engineering-ir.ts']);

  expect(selection.owners).toContain('semantic-ir');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/canonical-ir-identity-revision.test.ts',
    'tests/unit/engineering-ir.test.ts',
    'tests/unit/semantic-contract-ir.test.ts',
    'tests/integration/semantic-projections.test.ts',
    'tests/integration/workspace-engineering-ir.test.ts',
    'tests/integration/semantic-core-vertical.test.ts'
  ]));
  for (const appContainerTest of [
    'tests/unit/windows-appcontainer-executor.test.ts',
    'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts'
  ]) expect(selection.fast).not.toContain(appContainerTest);
});

test('test impact selector gives Fact Delta a focused owner without dedicated slow coverage', () => {
  const selection = selectTestsForSources([
    'platform/compiler/ir/build-fact-delta.ts',
    'platform/shared/engineering-ir/delta-types.ts'
  ]);

  expect(selection.owners).toContain('fact-delta');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/fact-delta.test.ts',
    'tests/unit/fact-assertion-model.test.ts',
    'tests/unit/canonical-ir-identity-revision.test.ts',
    'tests/unit/validated-engineering-ir.test.ts',
    'tests/contract/fact-delta-contract.test.ts'
  ]));
  expect(resolveTestOwnership(['platform/compiler/ir/build-fact-delta.ts'])).toContainEqual({
    source: 'platform/compiler/ir/build-fact-delta.ts',
    owner: 'fact-delta',
    identity: { kind: 'architecture-owner', id: 'fact-delta' }
  });
  const dedicatedOwner = resolveTestOwnership(['platform/compiler/ir/build-fact-delta.ts'])
    .filter((entry) => entry.owner === 'fact-delta');
  expect(dedicatedOwner).toHaveLength(1);
});

test('test impact selector gives Semantic Impact a focused owner without dedicated slow coverage', () => {
  const sourceFiles = [
    'platform/shared/semantic-impact-types.ts',
    'platform/compiler/semantic-impact/propagation-rules.ts',
    'platform/compiler/semantic-impact/build-impact-propagation.ts'
  ];
  const selection = selectTestsForSources(sourceFiles);

  expect(selection.owners).toContain('impact-propagation');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/impact-propagation.test.ts',
    'tests/contract/impact-propagation-contract.test.ts',
    'tests/unit/fact-delta.test.ts',
    'tests/contract/fact-delta-contract.test.ts',
    'tests/unit/validated-engineering-ir.test.ts'
  ]));
  expect(selection.slow).toEqual([]);
  for (const source of sourceFiles) {
    expect(resolveTestOwnership([source]).filter((entry) => entry.owner === 'impact-propagation'))
      .toEqual([{
        source,
        owner: 'impact-propagation',
        identity: { kind: 'architecture-owner', id: 'impact-propagation' }
      }]);
  }
});

test('test impact selector gives Semantic Mutation focused fast and notice-only slow coverage', () => {
  const sourceFiles = [
    'platform/shared/semantic-mutation-types.ts',
    'platform/compiler/semantic-mutation/plan-semantic-mutation.ts',
    'platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts',
    'platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts'
  ];
  const selection = selectTestsForSources(sourceFiles);

  expect(selection.owners).toContain('semantic-mutation');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/semantic-mutation.test.ts',
    'tests/unit/semantic-mutation-source-adapter.test.ts',
    'tests/unit/semantic-mutation-runtime-materialization.test.ts',
    'tests/contract/semantic-mutation-contract.test.ts',
    'tests/contract/semantic-mutation-source-adapter-contract.test.ts',
    'tests/unit/fact-delta.test.ts',
    'tests/contract/fact-delta-contract.test.ts',
    'tests/unit/impact-propagation.test.ts',
    'tests/contract/impact-propagation-contract.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/contract/contract-freeze.test.ts'
  ]));
  expect(selection.slow).toEqual([
    'tests/e2e/end-to-end.test.ts',
    'tests/e2e/graph.test.ts',
    'tests/e2e/local-views.test.ts',
    'tests/e2e/pipeline.test.ts',
    'tests/e2e/semantic-runtime-contract.test.ts',
    'tests/e2e/verification.test.ts'
  ]);
  for (const appContainerTest of [
    'tests/unit/windows-appcontainer-executor.test.ts',
    'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts'
  ]) expect(selection.fast).not.toContain(appContainerTest);
  for (const source of sourceFiles) {
    expect(resolveTestOwnership([source]).filter((entry) => entry.owner === 'semantic-mutation'))
      .toEqual([{
        source,
        owner: 'semantic-mutation',
        identity: { kind: 'architecture-owner', id: 'semantic-mutation' }
      }]);
  }
});

test('test impact selector separates the shared lease owner from the SM-3 local isolated child boundary', () => {
  const sourceFiles = [
    'platform/shared/semantic-mutation-staging-boundary.ts',
    'platform/shared/workspace-path-contract.ts',
    'platform/shared/workspace-write-lease.ts',
    'platform/compiler/verify/run-semantic-mutation-isolated-child.ts',
    'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts'
  ];
  const selection = selectTestsForSources(sourceFiles);

  expect(selection.owners).toContain('semantic-mutation');
  expect(selection.owners).toContain('workspace-write-lease');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/contract/repository-runtime.test.ts',
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    'tests/unit/workspace-write-lease.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts',
    'tests/contract/semantic-mutation-apply-contract.test.ts'
  ]));
  for (const source of sourceFiles.filter((source) => source !== 'platform/shared/workspace-write-lease.ts')) {
    expect(resolveTestOwnership([source]).filter((entry) => entry.owner === 'semantic-mutation'))
      .toEqual([{
        source,
        owner: 'semantic-mutation',
        identity: { kind: 'architecture-owner', id: 'semantic-mutation' }
      }]);
  }
  expect(resolveTestOwnership(['platform/shared/workspace-write-lease.ts'])).toEqual([{
    source: 'platform/shared/workspace-write-lease.ts',
    owner: 'workspace-write-lease',
    identity: { kind: 'architecture-owner', id: 'workspace-write-lease' }
  }]);
  const leaseOnly = selectTestsForSources(['platform/shared/workspace-write-lease.ts']);
  expect(leaseOnly.owners).toEqual(['workspace-write-lease']);
  expect(leaseOnly.fast).toEqual(expect.arrayContaining([
    'tests/contract/repository-runtime.test.ts',
    'tests/contract/semantic-mutation-apply-contract.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts',
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    'tests/unit/workspace-write-lease.test.ts',
    'tests/unit/worktree-physical-closeout-crash-recovery.test.ts'
  ]));
});

test('test impact selector gives runner build boundaries a focused semantic-mutation owner', () => {
  for (const source of [
    'platform/compiler/verify/semantic-mutation-runner-build-child.ts',
    'platform/compiler/verify/semantic-mutation-runner-build-protocol.ts',
    'platform/compiler/verify/semantic-mutation-runner-build-settlement.ts'
  ]) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toEqual(['semantic-mutation']);
    expect(selection.fast).toEqual([
      'tests/contract/semantic-mutation-apply-contract.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/semantic-mutation-isolated-child-fence.test.ts'
    ]);
    expect(selection.slow).toEqual(['tests/e2e/verification.test.ts']);
    expect(resolveTestOwnership([source]).filter((entry) => entry.owner === 'semantic-mutation'))
      .toEqual([{
        source,
        owner: 'semantic-mutation',
        identity: { kind: 'architecture-owner', id: 'semantic-mutation' }
      }]);
  }
});

test('test impact selector keeps Windows AppContainer as optional hardening coverage', () => {
  const sources = [
    'platform/shared/windows-appcontainer-native-helper-settlement.ts',
    'platform/shared/windows-appcontainer-executor.ts',
    'platform/shared/windows-appcontainer-native-helper.ts'
  ];
  const selection = selectTestsForSources(sources);

  expect(selection.owners).toEqual(['auto-reference', 'windows-appcontainer-hardening']);
  expect(selection.fast).toEqual([
    'tests/contract/test-impact.test.ts',
    'tests/unit/ci-pr-risk-selection.test.ts',
    'tests/unit/windows-appcontainer-executor.test.ts',
    'tests/unit/windows-appcontainer-hardening-static.test.ts',
    'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts'
  ]);
  expect(selection.slow).toEqual(['tests/e2e/windows-appcontainer-executor.test.ts']);
  for (const source of sources) {
    expect(resolveTestOwnership([source]).filter(
      (entry) => entry.owner === 'windows-appcontainer-hardening'
    )).toEqual([{
      source,
      owner: 'windows-appcontainer-hardening',
      identity: { kind: 'architecture-owner', id: 'windows-appcontainer-hardening' }
    }]);
  }
});

test('test impact selector binds Windows browser launch contracts to production host acceptance', () => {
  const source = 'platform/compiler/verify/windows-browser-launch-path.ts';
  const selection = selectTestsForSources([source]);

  expect(selection.owners).toEqual(['windows-browser-launch-path']);
  expect(selection.fast).toEqual([
    'tests/contract/test-architecture.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/runtime-verification.test.ts',
    'tests/unit/windows-browser-launch-path.test.ts'
  ]);
  expect(selection.slow).toEqual(['tests/e2e/runtime-host.test.ts']);
  expect(resolveTestOwnership([source])).toContainEqual({
    source,
    owner: 'windows-browser-launch-path',
    identity: { kind: 'architecture-owner', id: 'windows-browser-launch-path' }
  });
});

test('test impact selector gives the shared observed-process lifecycle a neutral owner', () => {
  const source = 'platform/shared/observed-process.ts';
  const selection = selectTestsForSources([source]);

  expect(selection.owners).toEqual(['auto-reference', 'observed-process-lifecycle']);
  expect(selection.fast).toEqual([
    'tests/contract/semantic-mutation-apply-contract.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/observed-process-lifecycle.test.ts',
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    'tests/unit/windows-appcontainer-hardening-static.test.ts',
    'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts',
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/unit/work-package-profile-probe-diagnostic.test.ts'
  ]);
  expect(selection.slow).toEqual([]);
  expect(selection.fast).not.toContain('tests/unit/windows-appcontainer-executor.test.ts');
  expect(resolveTestOwnership([source]).filter(
    (entry) => entry.owner === 'observed-process-lifecycle'
  )).toEqual([{
    source,
    owner: 'observed-process-lifecycle',
    identity: { kind: 'architecture-owner', id: 'observed-process-lifecycle' }
  }]);
});

test('test impact selector assigns neutral isolated Verification capabilities to Pipeline ownership', () => {
  const sourceFiles = [
    'platform/shared/verification-artifact-contract.ts',
    'platform/orchestrator/isolated-verification-capability.ts'
  ];
  const selection = selectTestsForSources(sourceFiles);

  expect(selection.owners).toContain('pipeline-orchestrator');
  expect(selection.owners).not.toContain('semantic-mutation');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/integration/pipeline-kernel.test.ts',
    'tests/unit/runtime-verification.test.ts',
    'tests/contract/semantic-mutation-apply-contract.test.ts'
  ]));
  for (const source of sourceFiles) {
    const expected: ReturnType<typeof resolveTestOwnership> = source === 'platform/shared/verification-artifact-contract.ts'
      ? [
          {
            source,
            owner: 'pipeline-orchestrator',
            identity: { kind: 'pass', id: 'resolve' }
          },
          {
            source,
            owner: 'verification-truth',
            identity: { kind: 'architecture-owner', id: 'verification-truth' }
          }
        ]
      : [{
          source,
          owner: 'pipeline-orchestrator',
          identity: { kind: 'pass', id: 'resolve' }
        }];
    expect(resolveTestOwnership([source])).toEqual(expected);
  }
});

test('test impact selector binds predicate signature authority to focused semantic IR coverage', () => {
  const selection = selectTestsForSources([
    'platform/shared/engineering-ir/predicate-signature-types.ts',
    'platform/compiler/ir/predicate-signatures.ts'
  ]);

  expect(selection.owners).toContain('semantic-ir');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/predicate-signatures.test.ts',
    'tests/unit/engineering-ir.test.ts',
    'tests/unit/semantic-contract-ir.test.ts'
  ]));
});

test('test impact selector binds Pipeline Semantic Context to the P0-3 vertical', () => {
  const selection = selectTestsForSources([
    'platform/shared/pipeline-semantic-context.ts',
    'platform/orchestrator/semantic-orchestrator.ts'
  ]);

  expect(selection.owners).toEqual(expect.arrayContaining(['pipeline-kernel', 'semantic-ir']));
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/pipeline-pass-registry.test.ts',
    'tests/unit/validated-engineering-ir.test.ts',
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/semantic-pipeline-spine.test.ts'
  ]));
});

test('test impact selector binds Workspace Semantic Linker to cross-Contract coverage', () => {
  const selection = selectTestsForSources([
    'platform/compiler/semantic-linker.ts',
    'platform/shared/semantic-contract-types.ts'
  ]);

  expect(selection.owners).toContain('semantic-ir');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/workspace-semantic-linker.test.ts',
    'tests/integration/semantic-contract.test.ts',
    'tests/integration/workspace-engineering-ir.test.ts',
    'tests/integration/semantic-pipeline-spine.test.ts'
  ]));
});

test('test impact selector binds policy declaration loading to revision and policy coverage', () => {
  const selection = selectTestsForSources(['platform/compiler/parse/load-policy-declarations.ts']);

  expect(selection.owners).toContain('policy-declarations');
  expect(selection.fast).toContain('tests/unit/canonical-ir-identity-revision.test.ts');
  expect(selection.slow).toContain('tests/e2e/policy.test.ts');
});

test('test impact selector isolates semantic projection ownership', () => {
  const selection = selectTestsForSources(['platform/compiler/projection/project-state-view.ts']);

  expect(selection.owners).toContain('semantic-projection');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/integration/semantic-projections.test.ts',
    'tests/integration/semantic-core-vertical.test.ts'
  ]));
  expect(selection.slow).toEqual([]);
});

test('test impact selector maps semantic lowering into runtime contract coverage', () => {
  const selection = selectTestsForSources(['platform/compiler/semantic-lowering.ts']);

  expect(selection.owners).toContain('semantic-lowering');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/semantic-lowering.test.ts',
    'tests/integration/semantic-core-vertical.test.ts'
  ]));
  expect(selection.slow).toContain('tests/e2e/semantic-runtime-contract.test.ts');
});

test('test impact selector keeps declarative registry files visible to registry rules', () => {
  const selection = selectTestsForSources([
    'platform/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);

  expect(selection.owners).toEqual(expect.arrayContaining(['semantic-contract', 'ticket-core']));
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/validated-engineering-ir.test.ts',
    'tests/integration/semantic-core-vertical.test.ts'
  ]));
  expect(selection.slow).toContain('tests/e2e/semantic-runtime-contract.test.ts');
  expect(resolveTestOwnership(['platform/registry/official/ticket.basic/contracts/ticket.yaml'])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ owner: 'ticket-core', identity: { kind: 'contract', id: 'ticket-core' } })
    ])
  );
});

test('test impact derives manifest and source-model ownership from explicit declarations', () => {
  const manifest = selectTestsForSources(['platform/registry/official/ticket.basic/block.manifest.yaml']);
  expect(manifest.owners).toContain('registry-manifest');
  expect(manifest.slow).toContain('tests/e2e/registry.test.ts');

  const sourceModel = selectTestsForSources(['source/model/app.plan.yaml']);
  expect(sourceModel.owners).toContain('source-model');
  expect(sourceModel.fast).toContain('tests/integration/semantic-pipeline-spine.test.ts');
  expect(sourceModel.slow).toContain('tests/e2e/semantic-runtime-contract.test.ts');
});

test('test impact selector keeps slow coverage as notice-only selection', () => {
  const selection = selectTestsForSources(['platform/compiler/upgrade/plan.ts']);

  expect(selection.owners).toContain('upgrade');
  expect(selection.fast).toContain('tests/integration/migration-files.test.ts');
  expect(selection.slow).toContain('tests/e2e/upgrade.test.ts');
  expect(selection.slow).toContain('tests/e2e/dry-run-plan.test.ts');
});

test('test impact selector does not invent broad fallback for unmapped sources', () => {
  const selection = selectTestsForSources(['platform/shared/unmapped-helper.ts']);

  expect(selection).toEqual({
    fast: [],
    slow: [],
    owners: []
  });
});
