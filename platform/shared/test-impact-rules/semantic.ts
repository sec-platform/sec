import type { TestImpactRule } from '../test-impact-contract.ts';

const SEMANTIC_IR_FAST_TESTS = [
  'tests/unit/canonical-ir-identity-revision.test.ts',
  'tests/unit/engineering-ir.test.ts',
  'tests/unit/predicate-signatures.test.ts',
  'tests/unit/semantic-contract-ir.test.ts',
  'tests/unit/semantic-contract-responsibility.test.ts',
  'tests/integration/semantic-contract.test.ts',
  'tests/integration/semantic-projections.test.ts',
  'tests/integration/workspace-engineering-ir.test.ts',
  'tests/integration/semantic-core-vertical.test.ts'
];

const SEMANTIC_PROJECTION_FAST_TESTS = [
  'tests/integration/semantic-projections.test.ts',
  'tests/integration/semantic-core-vertical.test.ts'
];

const SEMANTIC_LOWERING_FAST_TESTS = [
  'tests/unit/semantic-lowering.test.ts',
  'tests/unit/semantic-provenance.test.ts',
  'tests/integration/ticket-pipeline.test.ts',
  'tests/integration/semantic-core-vertical.test.ts'
];

export const semanticTestImpactRules: TestImpactRule[] = [
  {
    owner: 'semantic-ir',
    sourcePattern: /^platform\/compiler\/ir\//,
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: []
  },
  {
    owner: 'semantic-ir',
    sourcePattern: /^(?:platform\/compiler\/parse\/(?:load-semantic-contract|validate-semantic-manifest)\.ts|platform\/orchestrator\/(?:semantic-inputs|semantic-orchestrator)\.ts|platform\/shared\/(?:engineering-ir\/|(?:engineering-ir-types|semantic-contract-types)\.ts$))/,
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: ['tests/e2e/semantic-runtime-contract.test.ts']
  },
  {
    owner: 'policy-declarations',
    sourcePattern: /^platform\/compiler\/parse\/load-policy-declarations\.ts$/,
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: ['tests/e2e/policy.test.ts']
  },
  {
    owner: 'semantic-projection',
    sourcePattern: /^(?:platform\/compiler\/projection\/|platform\/shared\/semantic-view-types\.ts$)/,
    fast: SEMANTIC_PROJECTION_FAST_TESTS,
    slow: []
  },
  {
    owner: 'semantic-lowering',
    sourcePattern: /^(?:platform\/compiler\/(?:semantic-lowering|semantic-output-paths|semantic-plan|state-transition-plan)\.ts|platform\/shared\/semantic-generator-types\.ts)$/,
    fast: SEMANTIC_LOWERING_FAST_TESTS,
    slow: ['tests/e2e/semantic-runtime-contract.test.ts']
  }
];
