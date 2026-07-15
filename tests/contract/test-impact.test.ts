import { expect, test } from 'bun:test';

import {
  classifyTestImpactSource,
  resolveTestOwnership,
  selectTestsForSources
} from '../../platform/shared/test-impact-contract.ts';

test('test impact classifies every P0-7 source category deterministically', () => {
  expect(classifyTestImpactSource('platform/compiler/semantic-linker.ts')).toBe('typescript');
  expect(classifyTestImpactSource('platform/registry/official/ticket.basic/block.manifest.yaml')).toBe('manifest');
  expect(classifyTestImpactSource('platform/registry/official/ticket.basic/contracts/ticket.yaml')).toBe('semantic-contract');
  expect(classifyTestImpactSource('source/model/app.plan.yaml')).toBe('source-model');
});

test('test impact selector includes tests that directly import changed sources', () => {
  const selection = selectTestsForSources(['platform/shared/test-impact-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.fast).toContain('tests/contract/test-impact.test.ts');
  expect(selection.slow).not.toContain('tests/contract/test-impact.test.ts');
});

test('test impact assigns focused governance and frozen work-package ownership', () => {
  const agentGovernance = selectTestsForSources([
    'AGENTS.md',
    '.codex/agents/implementation-worker.toml',
    '.codex/agents/verification-evidence-reviewer.toml'
  ]);
  expect(agentGovernance.owners).toEqual(['agent-governance']);
  expect(agentGovernance.fast).toEqual(expect.arrayContaining([
    'tests/unit/ci-pr-risk-selection.test.ts',
    'tests/contract/test-impact.test.ts'
  ]));
  expect(agentGovernance.slow).toEqual([]);

  const workPackageEvidenceSources = [
    'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json',
    'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json'
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

test('test impact selector includes tests that dynamically import changed sources', () => {
  const selection = selectTestsForSources(['platform/dev-runner/test-runner.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.fast).toContain('tests/unit/test-runner.test.ts');
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
  for (const source of sourceFiles) {
    expect(resolveTestOwnership([source]).filter((entry) => entry.owner === 'semantic-mutation'))
      .toEqual([{
        source,
        owner: 'semantic-mutation',
        identity: { kind: 'architecture-owner', id: 'semantic-mutation' }
      }]);
  }
});

test('test impact selector owns the SM-3 lease and isolated AppContainer execution boundary', () => {
  const sourceFiles = [
    'platform/shared/semantic-mutation-staging-boundary.ts',
    'platform/shared/workspace-write-lease.ts',
    'platform/shared/windows-appcontainer-executor.ts',
    'platform/shared/windows-appcontainer-native-helper.ts',
    'platform/compiler/verify/run-semantic-mutation-isolated-child.ts',
    'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts'
  ];
  const selection = selectTestsForSources(sourceFiles);

  expect(selection.owners).toContain('semantic-mutation');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    'tests/unit/windows-appcontainer-executor.test.ts',
    'tests/unit/workspace-write-lease.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts',
    'tests/integration/project-runtime.test.ts',
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

test('test impact selector gives the runner build protocol a focused semantic-mutation owner', () => {
  for (const source of [
    'platform/compiler/verify/semantic-mutation-runner-build-child.ts',
    'platform/compiler/verify/semantic-mutation-runner-build-protocol.ts'
  ]) {
    const selection = selectTestsForSources([source]);
    expect(selection.owners).toEqual(['auto-reference', 'semantic-mutation']);
    expect(selection.fast).toEqual([
      'tests/contract/semantic-mutation-apply-contract.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/integration/project-runtime.test.ts',
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
    expect(resolveTestOwnership([source])).toEqual([{
      source,
      owner: 'pipeline-orchestrator',
      identity: { kind: 'pass', id: 'resolve' }
    }]);
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
