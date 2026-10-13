import { assertWorkspaceWriteLease } from '../../adapters/filesystem/write-lease.ts';
import { assertIsolatedStagingTree } from '../../adapters/verification/assert-isolated-staging-tree.ts';
import { probeSemanticMutationIsolatedRuntimeCapability } from '../../adapters/verification/run-semantic-mutation-isolated-child.ts';
import type { SemanticMutationIsolationCapabilityProbeFactory } from '../../adapters/verification/semantic-mutation-planning-adapter.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import { probePreparedSemanticMutationRuntime } from '../../application/semantic-mutation-runtime-probe.ts';
import { isSemanticMutationStagingWorkspace } from '../../workspace/contract/semantic-mutation-staging.ts';
import { createDependencyOperation } from '../toolchain/dependency-operation.ts';

export const DEFAULT_SEMANTIC_MUTATION_ISOLATION_CAPABILITY_PROBE:
  SemanticMutationIsolationCapabilityProbeFactory = request =>
    probePreparedSemanticMutationRuntime({
      stagingWorkspaceRoot: request.stagingWorkspaceRoot,
      async admitStagingWorkspace(stagingWorkspaceRoot) {
        await assertWorkspaceWriteLease(request.workspaceRoot, request.workspaceWriteLease);
        if (!isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)) {
          throw new Error('Isolated verification requires a controlled staging workspace');
        }
        await assertIsolatedStagingTree(stagingWorkspaceRoot);
      },
      ensureCompilerReady: () => createDependencyOperation({
        workspaceRoot: request.workspaceRoot,
        workspaceWriteLease: request.workspaceWriteLease
      }).ensureCompilerDepsReady({}, compilerRoot),
      probeRuntime: probeSemanticMutationIsolatedRuntimeCapability
    });
