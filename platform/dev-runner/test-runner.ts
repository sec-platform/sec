import path from 'node:path';
import { buildContractFreezeRunnerInvocations } from '../shared/contract-freeze-contract.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import { getSlowTestFiles } from '../shared/test-budget-contract.ts';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

function fastTestArgs(args: string[]): string[] {
  return ['run', ...getSlowTestFiles().flatMap((file) => ['--exclude', file]), ...args];
}

function fastTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PJC_SKIP_RUNTIME_DEPS_SETUP: '1'
  };
}

export async function runTests(args: string[] = []): Promise<number> {
  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  let exitCode = 1;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    exitCode = await runDevCommand(commandPath(binPath, 'vitest'), ['run', ...args], env);
  });
  return exitCode;
}

export async function runFastTests(args: string[] = []): Promise<number> {
  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  let exitCode = 1;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    exitCode = await runDevCommand(commandPath(binPath, 'vitest'), fastTestArgs(args), fastTestEnv(env));
  });
  return exitCode;
}

export async function runContractFreeze(): Promise<number> {
  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  let exitCode = 0;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    for (const invocation of buildContractFreezeRunnerInvocations()) {
      const env = {
        [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
      };
      exitCode = await runDevCommand(commandPath(binPath, 'vitest'), invocation.args, env);
      if (exitCode !== 0) {
        return;
      }
    }
  });
  return exitCode;
}
