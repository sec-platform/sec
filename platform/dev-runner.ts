import { cleanTestWorkspaces } from './dev-runner/env-manager.ts';
import { runImportOrganizer } from './dev-runner/import-organizer.ts';
import { runAffectedTests, runContractFreeze, runFastTests, runTests } from './dev-runner/test-runner.ts';
import { runTypecheck } from './dev-runner/typecheck-runner.ts';

function usage(): never {
  console.error('Usage: bun ./platform/dev-runner.ts <typecheck|test|test:affected|test:fast|contract-freeze|imports:check|imports:organize|clean-test-workspaces> [args...]');
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

  if (target === 'imports:check' || target === 'imports:organize') {
    process.exitCode = await runImportOrganizer({ check: target === 'imports:check' });
    return;
  }

  const code =
    target === 'typecheck'
      ? await runTypecheck(args)
      : target === 'test'
        ? await runTests(args)
        : target === 'test:affected'
          ? await runAffectedTests(args)
          : target === 'test:fast'
            ? await runFastTests(args)
            : usage();

  process.exitCode = code;
}

await main();
