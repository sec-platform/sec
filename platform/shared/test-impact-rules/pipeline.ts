import type { TestImpactRule } from '../test-impact-contract.ts';

export const pipelineTestImpactRules: TestImpactRule[] = [
  {
    owner: 'pipeline-kernel',
    sourcePattern: /^platform\/shared\/(?:pipeline-(?:types|pass-registry|journal|kernel)\.ts|test-impact-rules\/pipeline\.ts)$/,
    fast: [
      'tests/unit/pipeline-pass-registry.test.ts',
      'tests/integration/pipeline-kernel.test.ts'
    ],
    slow: [
      'tests/e2e/pipeline.test.ts',
      'tests/e2e/end-to-end.test.ts'
    ]
  },
  {
    owner: 'pipeline-orchestrator',
    sourcePattern: /^platform\/orchestrator\/(?:pipeline-orchestrator|block-orchestrator|compose-orchestrator|verify-orchestrator|emit-orchestrator)\.ts$/,
    fast: [
      'tests/integration/pipeline-kernel.test.ts',
      'tests/integration/project-runtime.test.ts'
    ],
    slow: [
      'tests/e2e/pipeline.test.ts',
      'tests/e2e/end-to-end.test.ts'
    ]
  },
  {
    owner: 'workbench-pipeline',
    sourcePattern: /^platform\/orchestrator\/workbench-(?:compile-handler|http-support|server-v2)\.ts$/,
    fast: [
      'tests/unit/workbench-server.test.ts',
      'tests/integration/workbench-pipeline.test.ts'
    ],
    slow: []
  },
  {
    owner: 'upgrade-pipeline',
    sourcePattern: /^platform\/upgrade\/upgrade-workspace\.ts$/,
    fast: [
      'tests/integration/upgrade-pipeline-kernel.test.ts',
      'tests/unit/upgrade-summary.test.ts'
    ],
    slow: [
      'tests/e2e/upgrade.test.ts',
      'tests/e2e/dry-run-plan.test.ts'
    ]
  }
];
