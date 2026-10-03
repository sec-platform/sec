import type { WorktreePhysicalCloseoutOperations } from '../../adapters/self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { compilerDependencyLocatorWorktreeRetirementProvider } from '../../adapters/toolchain/dependencies/runtime.ts';
import { createDependencyOperation } from '../toolchain/dependency-operation.ts';
import { createGeneratedStateRegistrationBootstrap } from './generated-state.ts';

export const worktreePhysicalCloseoutOperations: WorktreePhysicalCloseoutOperations = Object.freeze({
  retireSettledCompilerDependencyStageIntents: root => createDependencyOperation({ workspaceRoot: root })
    .retireSettledCompilerDependencyStageIntents(root),
  settleGeneratedStateForWorktreeRetirement: request => createGeneratedStateRegistrationBootstrap({
    workspaceRoot: request.workspaceRoot, worktreeRetirementProviders: [compilerDependencyLocatorWorktreeRetirementProvider]
  }).settleForWorktreeRetirement(request)
});
