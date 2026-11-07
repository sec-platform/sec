import { afterAll, expect, test } from 'bun:test';
import {
  currentActiveDocumentationPaths,
  currentDocumentationVerificationBaseline,
  isDocumentationVerificationInputPath
} from '../../../src/adapters/self-hosting/control/documentation/active.ts';

import { bindDocumentationVerificationGateInput, CodexDevelopmentBuildVerificationPlan as buildVerificationPlanWithProvider, type CodexDevelopmentVerificationPlanProfile } from '../../../src/adapters/verification/platform/ci/contract/plan.ts';
import { compileTestBudgetProjection, slowTestPrRiskBaselineSuiteIds as snapshotBaselineSuiteIds } from '../../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { parseGitChangedFileOutput } from '../../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../../helpers/test-impact-provider.ts';
import { settleResources } from '../../../src/execution/resource-settlement.ts';

let testImpactFixture: Awaited<ReturnType<typeof acquireExactRepositoryTestImpactProviderFixture>> | null = null;
let testImpactProviderPromise: Promise<ReturnType<typeof bindDocumentationVerificationGateInput>> | null = null;
const testImpactProvider = (): Promise<ReturnType<typeof bindDocumentationVerificationGateInput>> => {
  if (testImpactProviderPromise !== null) return testImpactProviderPromise;
  const pending = (async () => {
    const acquired = await acquireExactRepositoryTestImpactProviderFixture();
    try {
      const bound = bindDocumentationVerificationGateInput(
        acquired.provider,
        currentDocumentationVerificationBaseline()
      );
      // Transfer the live lease to afterAll only after the binding is accepted.
      testImpactFixture = acquired;
      return bound;
    } catch (error) {
      // Failed binding must not strand the native compiler/tree fixture until
      // the end of unrelated CI-plan cases. Preserve both failures.
      settleResources({ primary: { label: 'CI TestImpact gate binding', error },
        cleanup: [{ label: 'exact TestImpact fixture lease', settle: acquired.dispose }] });
      throw error;
    }
  })();
  testImpactProviderPromise = pending;
  void pending.catch(() => {
    if (testImpactProviderPromise === pending) testImpactProviderPromise = null;
  });
  return pending;
};
afterAll(() => testImpactFixture?.dispose());
const testBudgetProjection = async () => compileTestBudgetProjection((await testImpactProvider()).testInventory);
const buildVerificationPlanForTest = async (
  profile: CodexDevelopmentVerificationPlanProfile,
  files: readonly string[] | null
) => buildVerificationPlanWithProvider(profile, files, await testImpactProvider());
const slowTestPrRiskBaselineSuiteIds = async () => snapshotBaselineSuiteIds(await testBudgetProjection());



test('CI translates owner-issued selection into executable plan gates', async () => {
  const pipeline = await buildVerificationPlanForTest('quick', [
    'src/adapters/compilation/compose/generate-runtime-library.ts'
  ]);
  expect(pipeline.selectionResolved).toBe(true);
  expect(pipeline.selectionReasons).toEqual(['ownership-impact']);
  expect(pipeline.affectedOwners).toContain('adapters.compilation');

  const runtime = await buildVerificationPlanForTest('quick', [
    'src/adapters/verification/run-runtime-verification.ts'
  ]);
  expect(runtime.selectionResolved).toBe(true);
  expect(runtime.selectionReasons).toEqual(['ownership-impact']);

  const directSlow = await buildVerificationPlanForTest('quick', [
    'tests/e2e/workspace/dry-run-plan.test.ts'
  ]);
  expect(directSlow).toMatchObject({
    selectionResolved: true,
    selectionReasons: ['direct-slow-test'],
    affectedSlowTests: ['tests/e2e/workspace/dry-run-plan.test.ts']
  });
  expect(directSlow.gates.map(({ id }) => id)).toContain('slow-suite-e2e-dry-run-plan');
}, 180_000);

test('Quick plan resolves the canonical active documentation corpus', async () => {
  const plan = await buildVerificationPlanForTest('quick', [...currentActiveDocumentationPaths()]);

  expect(plan.selectionResolved).toBe(true);
  expect(plan.affectedOwners).toContain('adapters.self-hosting.control.documentation');
  expect(plan.affectedOwners).not.toContain('bounded-slow-risk');
  expect(plan.gates.map((gate) => gate.id).filter((id) => !id.startsWith('slow-suite-'))).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests'
  ]);
});

test('Quick docs gate follows the canonical documentation lifecycle owner', async () => {
  const paths = currentActiveDocumentationPaths();
  const baseline = currentDocumentationVerificationBaseline();
  // Keep every corpus member's admission; the full-corpus and singleton
  // plans above and below observe actual selected owners.
  for (const file of paths) {
    expect(isDocumentationVerificationInputPath(file, baseline), file).toBe(true);
  }
  const singleton = await buildVerificationPlanForTest('quick', ['AGENTS.md']);
  expect(singleton.selectionResolved).toBe(true);
  expect(singleton.affectedOwners).toContain('adapters.self-hosting.control.documentation');
  expect(singleton.affectedOwners).not.toContain('bounded-slow-risk');
  expect(singleton.gates.map(({ id }) => id)).toContain('docs-doctor');

  const unknownDocsYaml = await buildVerificationPlanForTest('quick', [
    'docs/unregistered.manifest.yaml'
  ]);
  expect(unknownDocsYaml.selectionResolved).toBe(false);
  expect(unknownDocsYaml.affectedOwners).not.toContain('adapters.self-hosting.control.documentation');
  expect(unknownDocsYaml.gates.map(({ id }) => id)).toContain('docs-doctor');
  expect(unknownDocsYaml.gates.filter(({ id }) => id.startsWith('slow-suite-')))
    .toHaveLength((await slowTestPrRiskBaselineSuiteIds()).length);

  const documentationExample = await buildVerificationPlanForTest('quick', [
    'examples/documentation-example.ts'
  ]);
  expect(documentationExample.gates.map(({ id }) => id)).toContain('docs-doctor');
  expect(documentationExample.gates.map(({ id }) => id)).not.toContain('imports');
});



test('Git raw path identity reaches canonical validation without separator laundering', async () => {
  const raw = new TextEncoder().encode('M\0docs\\work\\current-state.yaml\0');
  const changedFiles = parseGitChangedFileOutput(raw);
  expect(changedFiles).toEqual(['docs\\work\\current-state.yaml']);
  await expect(buildVerificationPlanForTest('quick', changedFiles)).rejects.toThrow(
    'not canonical repository-relative POSIX'
  );
});

test('Ticket semantic Contract reaches CI through the owner-issued plan boundary', async () => {
  const selection = await buildVerificationPlanForTest('quick', [
    'catalog/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);
  expect(selection).toMatchObject({
    selectionReasons: ['ownership-impact'],
    selectionResolved: true
  });
  expect(selection.affectedOwners).toContain('compiler');
  expect(selection.affectedOwners).toContain('semantics.definitions');
  expect(selection.affectedOwners).not.toContain('bounded-slow-risk');
});
