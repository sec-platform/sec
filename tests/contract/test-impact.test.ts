import { expect, test } from 'bun:test';

import {
  classifyTestImpactSource,
  resolveTestOwnership,
  selectTestsForSources,
  testImpactFallbackRules
} from '../../platform/shared/test-impact-contract.ts';
import {
  DOCUMENTATION_AUTHORITY_TOMBSTONE_FILES,
  FROZEN_WORK_PACKAGE_TOMBSTONE_FILES
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
        'tests/contract/documentation-authority.test.ts',
        'tests/contract/repository-audit.test.ts',
        'tests/contract/test-impact.test.ts',
        'tests/unit/active-documentation-contract.test.ts',
        'tests/unit/codex-work-package-contract.test.ts'
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
    'docs/evidence/documentation/example.manifest.yaml'
  ]) {
    expect(classifyTestImpactSource(evidenceSource)).toBeNull();
    expect(selectTestsForSources([evidenceSource])).toEqual({
      fast: [
        'tests/contract/agent-skills.test.ts',
        'tests/contract/repository-audit.test.ts',
        'tests/contract/test-impact.test.ts',
        'tests/unit/active-documentation-contract.test.ts'
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
      'tests/contract/ci-lanes.test.ts',
      'tests/contract/sec-merge-gate.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/ci-evidence-composition-policy-registry.test.ts',
      'tests/unit/ci-pr-risk-execution.test.ts',
      'tests/unit/ci-pr-risk-selection.test.ts',
      'tests/unit/ci-verification-composition-execution.test.ts',
      'tests/unit/ci-verification-execution.test.ts',
      'tests/unit/exact-git-blob.test.ts'
    ],
    slow: [],
    owners: ['verification-evidence-producers']
  };
  for (const source of [
    'scripts/codex/ci-orchestration-core.ts',
    'scripts/ci-pr-risk.ts',
    'scripts/ci-verification.ts',
    'scripts/codex/exact-git-blob.ts'
  ]) {
    expect(selectTestsForSources([source])).toEqual(expected);
  }
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

  const workPackageEvidenceSources = [
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
  ];
  const workPackageEvidence = selectTestsForSources(workPackageEvidenceSources);
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
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'work-package-gate',
      identity: { kind: 'contract', id: 'work-package-gate' }
    }]);
  }
});

test('test impact keeps managed Git hooks fast contract coverage and slow real-repository acceptance distinct', () => {
  const sources = [
    'scripts/install-git-hooks.ts',
    'platform/dev-runner/dependency-bootstrap.ts',
    '.githooks/pre-commit'
  ];
  const selection = selectTestsForSources(sources);

  expect(selection.owners).toEqual(['auto-reference', 'managed-git-hooks']);
  expect(selection.fast).toEqual([
    'tests/contract/test-impact.test.ts',
    'tests/unit/dev-runner-dependency-bootstrap.test.ts',
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
      'tests/unit/ci-pr-risk-selection.test.ts'
    ],
    slow: [],
    owners: ['dev-runner']
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

  expect(resolveTestOwnership(['platform/dev-runner/dependency-bootstrap.ts'])).toEqual([{
    source: 'platform/dev-runner/dependency-bootstrap.ts',
    owner: 'managed-git-hooks',
    identity: { kind: 'architecture-owner', id: 'managed-git-hooks' }
  }]);
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
    'platform/compiler/semantic-mutation/plan-semantic-mutation.ts'
  ];
  const selection = selectTestsForSources(sourceFiles);

  expect(selection.owners).toContain('semantic-mutation');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/semantic-mutation.test.ts',
    'tests/unit/semantic-mutation-source-adapter.test.ts',
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

test('test impact selector owns the SM-3 lease and local isolated child boundary', () => {
  const sourceFiles = [
    'platform/shared/semantic-mutation-staging-boundary.ts',
    'platform/shared/workspace-path-contract.ts',
    'platform/shared/workspace-write-lease.ts',
    'platform/compiler/verify/run-semantic-mutation-isolated-child.ts',
    'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts'
  ];
  const selection = selectTestsForSources(sourceFiles);

  expect(selection.owners).toContain('semantic-mutation');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    'tests/unit/workspace-write-lease.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts',
    'tests/contract/semantic-mutation-apply-contract.test.ts'
  ]));
  for (const source of sourceFiles) {
    expect(resolveTestOwnership([source]).filter((entry) => entry.owner === 'semantic-mutation'))
      .toEqual([{
        source,
        owner: 'semantic-mutation',
        identity: { kind: 'architecture-owner', id: 'semantic-mutation' }
      }]);
  }
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

  expect(selection.owners).toEqual(['observed-process-lifecycle']);
  expect(selection.fast).toEqual([
    'tests/contract/semantic-mutation-apply-contract.test.ts',
    'tests/contract/test-impact.test.ts',
    'tests/unit/observed-process-lifecycle.test.ts',
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/unit/work-package-profile-probe-diagnostic.test.ts'
  ]);
  expect(selection.slow).toEqual([]);
  for (const appContainerTest of [
    'tests/unit/windows-appcontainer-executor.test.ts',
    'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts'
  ]) expect(selection.fast).not.toContain(appContainerTest);
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
