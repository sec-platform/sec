import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';

export const pipelineTestOwnershipDeclarations: TestOwnershipDeclaration[] = [
  {
    owner: 'windows-browser-launch-path',
    identity: { kind: 'architecture-owner', id: 'windows-browser-launch-path' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/compiler/verify/windows-browser-launch-path.ts'
    ],
    fast: [
      'tests/contract/test-architecture.test.ts',
      'tests/contract/test-impact.test.ts',
      'tests/unit/runtime-verification.test.ts',
      'tests/unit/windows-browser-launch-path.test.ts'
    ],
    slow: [
      'tests/e2e/runtime-host.test.ts'
    ]
  },
  {
    owner: 'pipeline-kernel',
    identity: { kind: 'pass', id: 'build-ir' },
    sourceFiles: [
      'platform/shared/pipeline-types.ts',
      'platform/shared/pipeline-pass-registry.ts',
      'platform/shared/pipeline-journal.ts',
      'platform/shared/pipeline-kernel.ts',
      'platform/shared/pipeline-semantic-context.ts'
    ],
    fast: [
      'tests/unit/pipeline-pass-registry.test.ts',
      'tests/integration/pipeline-kernel.test.ts',
      'tests/integration/semantic-pipeline-spine.test.ts',
      'tests/integration/pipeline-workspace-write-lease.test.ts',
      'tests/contract/test-impact.test.ts'
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
      'platform/shared/verification-artifact-contract.ts',
      'platform/orchestrator/isolated-verification-capability.ts',
      'platform/orchestrator/pipeline-orchestrator.ts',
      'platform/orchestrator/block-orchestrator.ts',
      'platform/orchestrator/compose-orchestrator.ts',
      'platform/orchestrator/verify-orchestrator.ts',
      'platform/orchestrator/emit-orchestrator.ts',
      'platform/orchestrator/repair-orchestrator.ts',
      'platform/orchestrator/workspace-orchestrator.ts'
    ],
    fast: [
      'tests/integration/pipeline-kernel.test.ts',
      'tests/integration/project-runtime.test.ts',
      'tests/integration/semantic-pipeline-spine.test.ts',
      'tests/integration/pipeline-workspace-write-lease.test.ts',
      'tests/integration/repair.test.ts',
      'tests/unit/runtime-verification.test.ts',
      'tests/contract/semantic-mutation-apply-contract.test.ts'
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
      'platform/orchestrator/workbench-orchestrator.ts',
      'platform/orchestrator/workbench-server-v2.ts'
    ],
    fast: [
      'tests/unit/workbench-server.test.ts',
      'tests/integration/workbench-pipeline.test.ts',
      'tests/integration/workbench-writer-lease.test.ts'
    ],
    slow: []
  },
  {
    owner: 'upgrade-pipeline',
    identity: { kind: 'architecture-owner', id: 'upgrade-pipeline' },
    sourceFiles: [
      'platform/orchestrator/upgrade-orchestrator.ts',
      'platform/upgrade/upgrade-workspace.ts'
    ],
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
