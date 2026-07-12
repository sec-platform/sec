import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';

export const pipelineTestOwnershipDeclarations: TestOwnershipDeclaration[] = [
  {
    owner: 'pipeline-kernel',
    identity: { kind: 'pass', id: 'build-ir' },
    sourceFiles: [
      'platform/shared/pipeline-types.ts',
      'platform/shared/pipeline-pass-registry.ts',
      'platform/shared/pipeline-journal.ts',
      'platform/shared/pipeline-kernel.ts',
      'platform/shared/pipeline-semantic-context.ts',
      'platform/shared/test-impact-rules/pipeline.ts'
    ],
    fast: [
      'tests/unit/pipeline-pass-registry.test.ts',
      'tests/integration/pipeline-kernel.test.ts',
      'tests/integration/semantic-pipeline-spine.test.ts'
    ],
    slow: [
      'tests/e2e/pipeline.test.ts',
      'tests/e2e/end-to-end.test.ts'
    ]
  },
  {
    owner: 'pipeline-orchestrator',
    identity: { kind: 'pass', id: 'resolve' },
    sourceFiles: [
      'platform/orchestrator/pipeline-orchestrator.ts',
      'platform/orchestrator/block-orchestrator.ts',
      'platform/orchestrator/compose-orchestrator.ts',
      'platform/orchestrator/verify-orchestrator.ts',
      'platform/orchestrator/emit-orchestrator.ts'
    ],
    fast: [
      'tests/integration/pipeline-kernel.test.ts',
      'tests/integration/project-runtime.test.ts',
      'tests/integration/semantic-pipeline-spine.test.ts'
    ],
    slow: [
      'tests/e2e/pipeline.test.ts',
      'tests/e2e/end-to-end.test.ts'
    ]
  },
  {
    owner: 'workbench-pipeline',
    identity: { kind: 'architecture-owner', id: 'workbench-pipeline' },
    sourceFiles: [
      'platform/orchestrator/workbench-compile-handler.ts',
      'platform/orchestrator/workbench-http-support.ts',
      'platform/orchestrator/workbench-server-v2.ts'
    ],
    fast: [
      'tests/unit/workbench-server.test.ts',
      'tests/integration/workbench-pipeline.test.ts'
    ],
    slow: []
  },
  {
    owner: 'upgrade-pipeline',
    identity: { kind: 'architecture-owner', id: 'upgrade-pipeline' },
    sourceFiles: ['platform/upgrade/upgrade-workspace.ts'],
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
