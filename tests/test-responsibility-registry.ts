import type { TestResponsibilityDeclaration } from '../platform/shared/test-responsibility-contract.ts';

function contractCase(input: Readonly<{
  failureMeaningCode: string;
  obligationId: string;
  testId: string;
  title: string;
}>): TestResponsibilityDeclaration {
  return {
    testId: input.testId,
    sourcePath: 'tests/contract/test-responsibility-contract.test.ts',
    case: { suitePath: [], title: input.title },
    owner: 'test-responsibility',
    layer: 'contract',
    role: 'primary',
    lifecycle: 'active',
    obligations: [{
      kind: 'contract',
      id: input.obligationId,
      owner: 'test-responsibility',
      failureMeaningCode: input.failureMeaningCode
    }],
    retirementCondition: { kind: 'persistent-invariant' }
  };
}

export const TEST_RESPONSIBILITY_DECLARATIONS: readonly TestResponsibilityDeclaration[] = [
  contractCase({
    testId: 'verification.test-responsibility.selection-round-trip',
    title: 'canonical test responsibility sources select focused proof through existing impact owner',
    obligationId: 'test-responsibility-selection-round-trip',
    failureMeaningCode: 'test-responsibility-selection-unprotected'
  }),
  contractCase({
    testId: 'verification.test-responsibility.determinism',
    title: 'test responsibility normalization is order-independent for non-semantic collections',
    obligationId: 'test-responsibility-determinism',
    failureMeaningCode: 'test-responsibility-nondeterministic'
  }),
  contractCase({
    testId: 'verification.test-responsibility.obligation-integrity',
    title: 'every registered proof binds a canonical obligation and failure meaning',
    obligationId: 'test-responsibility-obligation-integrity',
    failureMeaningCode: 'test-responsibility-obligation-unbound'
  }),
  contractCase({
    testId: 'verification.test-responsibility.calibration-role',
    title: 'calibration role is reserved for verifier-calibration obligations',
    obligationId: 'test-responsibility-calibration-role',
    failureMeaningCode: 'test-responsibility-calibration-role-invalid'
  }),
  contractCase({
    testId: 'verification.test-responsibility.mutation-layer',
    title: 'mutation layer is calibration or diagnostic evidence, never primary proof',
    obligationId: 'test-responsibility-mutation-layer',
    failureMeaningCode: 'test-responsibility-mutation-role-invalid'
  }),
  contractCase({
    testId: 'verification.test-responsibility.diagnostic-lifecycle',
    title: 'diagnostic proofs cannot masquerade as ordinary required proof',
    obligationId: 'test-responsibility-diagnostic-lifecycle',
    failureMeaningCode: 'test-responsibility-diagnostic-leakage'
  }),
  contractCase({
    testId: 'verification.test-responsibility.replacement-lifecycle',
    title: 'replacement proof has one direction and can only target active proof',
    obligationId: 'test-responsibility-replacement-lifecycle',
    failureMeaningCode: 'test-responsibility-replacement-lifecycle-invalid'
  }),
  contractCase({
    testId: 'verification.test-responsibility.replacement-coverage',
    title: 'replacement proof must preserve every canonical obligation identity',
    obligationId: 'test-responsibility-replacement-coverage',
    failureMeaningCode: 'test-responsibility-replacement-coverage-incomplete'
  }),
  contractCase({
    testId: 'verification.test-responsibility.calibration-replacement',
    title: 'calibration proof cannot replace an ordinary product or contract obligation',
    obligationId: 'test-responsibility-calibration-replacement-boundary',
    failureMeaningCode: 'test-responsibility-calibration-replacement-invalid'
  }),
  contractCase({
    testId: 'verification.test-responsibility.replacement-reference',
    title: 'replacement retirement cannot silently point to self or an unknown proof',
    obligationId: 'test-responsibility-replacement-reference-integrity',
    failureMeaningCode: 'test-responsibility-replacement-reference-invalid'
  }),
  contractCase({
    testId: 'verification.test-responsibility.owner-retirement',
    title: 'owner retirement cannot silently discard obligations owned elsewhere',
    obligationId: 'test-responsibility-owner-retirement',
    failureMeaningCode: 'test-responsibility-owner-retirement-incomplete'
  }),
  contractCase({
    testId: 'verification.test-responsibility.retiring-lifecycle',
    title: 'retiring lifecycle requires an actionable retirement owner',
    obligationId: 'test-responsibility-retiring-lifecycle',
    failureMeaningCode: 'test-responsibility-retiring-without-authority'
  }),
  {
    testId: 'repository.runtime.external-tool-exact-version',
    sourcePath: 'tests/contract/repository-runtime.test.ts',
    case: {
      suitePath: ['test budget and benchmark contracts'],
      title: 'external architecture tools are explicit, version-pinned package capabilities'
    },
    owner: 'repository-package-contract',
    layer: 'contract',
    role: 'primary',
    lifecycle: 'active',
    obligations: [{
      kind: 'contract',
      id: 'external-tool-exact-version-pin',
      owner: 'repository-package-contract',
      failureMeaningCode: 'external-tool-version-not-exactly-pinned'
    }],
    regressionRefs: ['github:issue/499'],
    retirementCondition: { kind: 'persistent-invariant' }
  },
  {
    testId: 'repository.runtime.retired-mcp-entrypoints',
    sourcePath: 'tests/contract/repository-runtime.test.ts',
    case: {
      suitePath: ['test budget and benchmark contracts'],
      title: 'retired MCP entrypoints stay absent while CLI analysis remains available'
    },
    owner: 'external-provider',
    layer: 'contract',
    role: 'primary',
    lifecycle: 'active',
    obligations: [{
      kind: 'contract',
      id: 'retired-mcp-entrypoints-remain-absent',
      owner: 'external-provider',
      failureMeaningCode: 'retired-mcp-entrypoint-regressed'
    }],
    retirementCondition: { kind: 'persistent-invariant' }
  },
  {
    testId: 'repository.runtime.contract-entrypoints-bypass-dev-runner',
    sourcePath: 'tests/contract/repository-runtime.test.ts',
    case: {
      suitePath: ['developer contract entrypoints'],
      title: 'contract scripts bypass dev-runner'
    },
    owner: 'dev-runner',
    layer: 'contract',
    role: 'primary',
    lifecycle: 'active',
    obligations: [{
      kind: 'contract',
      id: 'contract-entrypoints-bypass-dev-runner',
      owner: 'dev-runner',
      failureMeaningCode: 'contract-entrypoint-routed-through-dev-runner'
    }],
    retirementCondition: { kind: 'persistent-invariant' }
  }
] as const;
