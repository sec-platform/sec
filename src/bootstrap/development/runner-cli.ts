import { runDevRunnerCli, type DevRunnerComposition } from '../../adapters/self-hosting/development/runner/cli.ts';
import { ensureOperationDependencies, type OperationDependencyBootstrapOptions } from '../../adapters/self-hosting/development/runner/dependency-bootstrap.ts';
import { enableDevExecutionProgress, reportDevExecutionProgress } from '../../adapters/self-hosting/development/runner/execution-progress.ts';
import { observeCompilerDependencyExecutionGenerationAuthority, projectCompilerDepsReadyState } from '../../adapters/toolchain/dependencies/runtime.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import { settleWorkspaceEnvironmentOperation } from '../runtime-state/environment-settlement.ts';
import { runGeneratedStateOperation } from '../runtime-state/generated-state-operation.ts';
import { createGeneratedStateRegistrationBootstrap } from '../runtime-state/generated-state.ts';
import { createDependencyOperation } from '../toolchain/dependency-operation.ts';

export function createDevRunnerComposition(repositoryRoot = process.cwd()): DevRunnerComposition {
  const dependencies = createDependencyOperation({ workspaceRoot: repositoryRoot });
  const bindDependencyBootstrap = (options: OperationDependencyBootstrapOptions = {}): OperationDependencyBootstrapOptions =>
    Object.freeze({ ...options, repositoryRoot,
      ensureCompilerDeps: () => dependencies.ensureCompilerDepsReady({ deadlineAtUnixMs: options.deadlineAtUnixMs, signal: options.signal }, repositoryRoot),
      readCompilerDeps: async () => {
        const observed = await observeCompilerDependencyExecutionGenerationAuthority(
          { deadlineAtUnixMs: options.deadlineAtUnixMs, signal: options.signal }, repositoryRoot);
        return observed === null ? null : projectCompilerDepsReadyState(observed);
      } });
  return Object.freeze({ dependencyBootstrap: bindDependencyBootstrap(),
    ensureDependencies: (demand, options) => ensureOperationDependencies(demand, bindDependencyBootstrap(options)),
    importOrganizer: Object.freeze({ generatedStateLifecycle: createGeneratedStateRegistrationBootstrap({
      workspaceRoot: compilerRoot }).createProducerHooks(compilerRoot) }),
    runGeneratedStateOperation: args => runGeneratedStateOperation(args, repositoryRoot),
    settleWorkspaceEnvironment: input => settleWorkspaceEnvironmentOperation({ ...input, repositoryRoot }) });
}

if (import.meta.main) {
  const command = process.argv[2] ?? 'unknown';
  enableDevExecutionProgress();
  reportDevExecutionProgress({ command, phase: 'command', state: 'start' });
  try {
    await runDevRunnerCli(createDevRunnerComposition());
    reportDevExecutionProgress({ command, phase: 'command',
      state: (process.exitCode ?? 0) === 0 ? 'complete' : 'failed', detail: { exitCode: process.exitCode ?? 0 } });
  } catch (error) {
    reportDevExecutionProgress({ command, phase: 'command', state: 'failed', detail: {
      error: error instanceof Error ? error.message : String(error), exitCode: 1 } });
    throw error;
  }
}
