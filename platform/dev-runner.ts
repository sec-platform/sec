import { runTypecheck } from './dev-runner/typecheck-runner.ts';
import { runTests, runFastTests, runContractFreeze } from './dev-runner/test-runner.ts';
import { cleanTestWorkspaces } from './dev-runner/env-manager.ts';

function usage(): never {
  console.error('Usage: bun ./platform/dev-runner.ts <typecheck|test|test:fast|contract-freeze|clean-test-workspaces> [args...]');
  process.exit(1);
}

async function main(): Promise<void> {
  const [target, ...args] = process.argv.slice(2);
  if (!target) {
    usage();
  }

  if (target === 'clean-test-workspaces') {
    await cleanTestWorkspaces();
    return;
  }

  if (target === 'contract-freeze') {
    process.exitCode = await runContractFreeze();
    return;
  }

  const code =
    target === 'typecheck'
      ? await runTypecheck(args)
      : target === 'test'
        ? await runTests(args)
        : target === 'test:fast'
          ? await runFastTests(args)
          : usage();

  process.exitCode = code;
}

await main();
