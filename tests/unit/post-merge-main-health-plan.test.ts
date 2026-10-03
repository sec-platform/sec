import { expect, test } from 'bun:test';

import { assertMainHealthDriverPlanApplicable, assertMainHealthStaticBoundaryCovered, assertTrustedRuntimePostMergeMainHealthPlanCurrent, prepareTrustedRuntimePostMergeMainHealthPlan } from '../../src/adapters/self-hosting/control/main-health/post-merge-plan.ts';
import { createSecTrustedBootstrapTrustRoot, SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';

// Data-only applicability fixture. It does not issue an Origin, Engine, plan,
// MainHealth receipt or physical closeout authority.
const trustRoot = createSecTrustedBootstrapTrustRoot({ registry: SEC_TRUSTED_BOOTSTRAP_REGISTRY,
  causalRuntimePaths: [...new Set([...SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints,
    'src/adapters/self-hosting/control/main-health/post-merge-plan.ts',
    'src/adapters/providers/linux-verification/contract.ts',
    'src/adapters/providers/github-api/hosted-job-origin.ts',
    'src/adapters/providers/docker/runtime/container-engine-session.ts'])].sort() });

test('unchanged trusted plan admits ordinary subject changes without adopting new driver code', () => {
  expect(() => assertMainHealthDriverPlanApplicable([], trustRoot)).not.toThrow();
  expect(() => assertMainHealthDriverPlanApplicable(['docs/example.md', 'src/example-product.ts'], trustRoot)).not.toThrow();
});

for (const changedPath of ['package.json', 'bun.lock', '.github/workflows/merge-gate.yml',
  'src/adapters/self-hosting/development/runner/typecheck-feedback.ts',
  'src/adapters/providers/linux-verification/contract.ts',
  'src/adapters/providers/github-api/hosted-job-origin.ts',
  'src/adapters/providers/docker/runtime/container-engine-session.ts']) {
  test(`loaded MainHealth plan rejects changes to ${changedPath}`, () => {
    expect(() => assertMainHealthDriverPlanApplicable([changedPath], trustRoot)).toThrow('plan-changed');
    // The original Git owner disables rename detection, so the deletion of a
    // trusted file cannot disappear behind an untrusted new destination.
    expect(() => assertMainHealthDriverPlanApplicable([changedPath, 'moved/product.ts'], trustRoot)).toThrow('plan-changed');
  });
}

test('incomplete or noncanonical diff data never proves plan equivalence', () => {
  for (const paths of [['same.ts', 'same.ts'], ['../outside.ts'], ['/absolute.ts']]) {
    expect(() => assertMainHealthDriverPlanApplicable(paths, trustRoot)).toThrow('closure-unavailable');
  }
});

test('serialized plan or origin data cannot enter the live applicability owner', async () => {
  await expect(assertTrustedRuntimePostMergeMainHealthPlanCurrent({ plan: {} as never,
    origin: {} as never, mainSha: 'a'.repeat(40), mainTreeSha: 'b'.repeat(40) })).rejects.toThrow('unqualified (origin)');
  await expect(prepareTrustedRuntimePostMergeMainHealthPlan({ origin: {} as never,
    repository: 'sec-platform/sec', repositoryRoot: '/not-an-admitted-root',
    candidateSha: 'a'.repeat(40), candidateTreeSha: 'b'.repeat(40) })).rejects.toThrow('job origin unavailable');
});


test('the static boundary target and its executed dependencies remain protected', () => {
  expect(() => assertMainHealthDriverPlanApplicable([SEC_TCB_CLOSURE_RUNTIME_PATH], trustRoot))
    .toThrow('plan-changed');
  expect(() => assertMainHealthStaticBoundaryCovered([SEC_TCB_CLOSURE_RUNTIME_PATH,
    'src/adapters/providers/github-api/hosted-job-origin.ts'], trustRoot)).not.toThrow();
  expect(() => assertMainHealthStaticBoundaryCovered([SEC_TCB_CLOSURE_RUNTIME_PATH,
    'src/not-in-the-loaded-causal-closure.ts'], trustRoot)).toThrow('closure-unavailable');
  expect(() => createSecTrustedBootstrapTrustRoot({
    registry: { ...SEC_TRUSTED_BOOTSTRAP_REGISTRY, reviewedBoundaryEdges: [] },
    causalRuntimePaths: [...trustRoot.causalRuntimePaths, SEC_TCB_CLOSURE_RUNTIME_PATH].sort()
  })).toThrow('both staticExact and causalRuntime');
  expect(() => createSecTrustedBootstrapTrustRoot({
    registry: { ...SEC_TRUSTED_BOOTSTRAP_REGISTRY,
      staticExactPaths: SEC_TRUSTED_BOOTSTRAP_REGISTRY.staticExactPaths.filter(p => p !== SEC_TCB_CLOSURE_RUNTIME_PATH) },
    causalRuntimePaths: trustRoot.causalRuntimePaths
  })).toThrow();
});
