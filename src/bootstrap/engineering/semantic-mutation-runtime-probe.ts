import { assertWorkspaceWriteLease } from '../../adapters/filesystem/write-lease.ts';
import { observeCompilerDependencyExecutionGenerationAuthority } from '../../adapters/toolchain/dependencies/runtime.ts';
import { assertIsolatedStagingTree } from '../../adapters/verification/assert-isolated-staging-tree.ts';
import { probeSemanticMutationIsolatedRuntimeCapability } from '../../adapters/verification/run-semantic-mutation-isolated-child.ts';
import type { SemanticMutationIsolationCapabilityProbeFactory } from '../../adapters/verification/semantic-mutation-planning-adapter.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import { probePreparedSemanticMutationRuntime } from '../../application/semantic-mutation-runtime-probe.ts';
import { CodedFailure } from '../../contracts/failure.ts';
import { isSemanticMutationStagingWorkspace } from '../../workspace/contract/semantic-mutation-staging.ts';

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
      async ensureCompilerReady() {
        if (await observeCompilerDependencyExecutionGenerationAuthority({}, compilerRoot) === null) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Prepared compiler dependency source is unavailable for the runtime probe');
        }
      },
      probeRuntime: probeSemanticMutationIsolatedRuntimeCapability
    });
