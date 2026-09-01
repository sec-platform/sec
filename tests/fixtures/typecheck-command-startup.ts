import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { mock } from 'bun:test';

const calls: string[] = [];
let dependencyReady = false;
const materializedDependencies = Object.freeze({
  executionGenerationAuthority: Object.freeze({ generationDigest: `sha256:${'a'.repeat(64)}` }),
  manifestHash: `sha256:${'b'.repeat(64)}`,
  nodeModulesPath: path.join(process.cwd(), 'node_modules'),
  requiresFreshProcess: false,
  source: 'existing',
  transitionDigest: `sha256:${'c'.repeat(64)}`
});
const retainedGeneration = Object.freeze({
  retire: async () => {
    calls.push('generation:retire');
  }
});

function moduleHref(repositoryPath: string): string {
  return pathToFileURL(path.resolve(repositoryPath)).href;
}

mock.module(moduleHref('src/development/runner/dependency-bootstrap.ts'), () => ({
  DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV: 'SEC_DEV_RUNNER_FRESH_PROCESS_TRANSITION_V1',
  createDependencyFreshProcessHandoff: () => null,
  ensureOperationDependencies: async () => {
    calls.push('dependency:ensure');
    dependencyReady = true;
    return materializedDependencies;
  },
  reuseOperationDependencies: (dependencies: unknown) => {
    if (!dependencyReady || dependencies !== materializedDependencies) {
      throw new Error('Dependency bootstrap readback did not observe the issued result.');
    }
    calls.push('dependency:readback');
    return dependencies;
  }
}));

mock.module(moduleHref('src/toolchain/dependencies/runtime.ts'), () => ({
  COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY: Object.freeze({ maximumDurationMs: 30_000 }),
  retainCompilerDependencyExecutionGeneration: async (authority: unknown) => {
    if (authority !== materializedDependencies.executionGenerationAuthority) {
      throw new Error('TypeScript startup retained another dependency generation.');
    }
    calls.push('generation:retain');
    return retainedGeneration;
  }
}));

mock.module(moduleHref('src/development/runner/typecheck-runner.ts'), () => {
  if (!dependencyReady) {
    throw new Error('TypeScript execution closure loaded before dependency bootstrap.');
  }
  calls.push('runner:load');
  return {
    runTypecheckWithRetainedDependencyGeneration: async (
      dependencies: unknown,
      generation: unknown,
      args: readonly string[]
    ) => {
      if (dependencies !== materializedDependencies) {
        throw new Error('TypeScript runner did not receive the admitted dependency result.');
      }
      if (generation !== retainedGeneration) {
        throw new Error('TypeScript runner did not receive the retained dependency generation.');
      }
      calls.push(`runner:execute:${args.join(',')}`);
      await retainedGeneration.retire();
      return 0;
    }
  };
});

const { runTypecheckCommand } = await import(
  `${moduleHref('src/development/runner/cli.ts')}?typecheck-startup-contract`
);
const exitCode = await runTypecheckCommand(['--diagnostic-only']);
process.stdout.write(JSON.stringify({ calls, exitCode }));
