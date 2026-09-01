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

function moduleHref(repositoryPath: string): string {
  return pathToFileURL(path.resolve(repositoryPath)).href;
}

mock.module(moduleHref('src/development/runner/dependency-bootstrap.ts'), () => ({
  DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV: 'SEC_DEV_RUNNER_FRESH_PROCESS_TRANSITION_V1',
  assertMaterializedOperationDependencyBootstrapResult: (dependencies: unknown) => {
    if (!dependencyReady || dependencies !== materializedDependencies) {
      throw new Error('Dependency bootstrap provenance did not observe the issued result.');
    }
  },
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
  retainCompilerDependencyExecutionGeneration: async () => {
    throw new Error('TypeScript startup retained a dependency generation before Action admission.');
  }
}));

mock.module(moduleHref('src/development/runner/typecheck-runner.ts'), () => {
  if (!dependencyReady) {
    throw new Error('TypeScript execution closure loaded before dependency bootstrap.');
  }
  calls.push('runner:load');
  return {
    runTypecheckWithDependencyAuthority: async (
      dependencies: unknown,
      args: readonly string[]
    ) => {
      if (dependencies !== materializedDependencies) {
        throw new Error('TypeScript runner did not receive the admitted dependency result.');
      }
      calls.push(`runner:execute:${args.join(',')}`);
      return 0;
    }
  };
});

const { runTypecheckCommand } = await import(
  `${moduleHref('src/development/runner/cli.ts')}?typecheck-startup-contract`
);
const exitCode = await runTypecheckCommand(['--diagnostic-only']);
process.stdout.write(JSON.stringify({ calls, exitCode }));
