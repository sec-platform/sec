import path from 'node:path';
import { workspaceGitStatusBackend } from '../../adapters/runtime-state/generated-state/environment-settlement.ts';
import { settleWorkspaceEnvironment } from '../../application/generated-state/environment-settlement.ts';
import { createGeneratedStateRegistrationBootstrap } from './generated-state.ts';

export function settleWorkspaceEnvironmentOperation(input: Parameters<typeof settleWorkspaceEnvironment>[0] = {}) {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? process.cwd());
  const workspaceRoot = path.resolve(input.workspaceRoot ?? repositoryRoot);
  const generatedState = createGeneratedStateRegistrationBootstrap({ workspaceRoot });
  return settleWorkspaceEnvironment(input, { git: workspaceGitStatusBackend,
    inspect: request => generatedState.inspect(request.repositoryRoot),
    settle: request => generatedState.settle(request) });
}
