import { ensureDevDependencies } from './dev-runner/dependency-bootstrap.ts';
import { cleanTestWorkspaces } from './dev-runner/env-manager.ts';
import {
  ciVerificationNormalizedOperationArgvV2,
  resolveCiVerificationDevRunnerTargetV1,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationNormalizedOperationV2
} from './shared/verification-action-ci-contract.ts';
import type { VerificationActionPlanV2 } from './shared/verification-action-contract.ts';

export async function executeVerifiedCiActionPlanV1(options: {
  readonly plan: VerificationActionPlanV2;
  readonly authorizedClosure: CiVerificationActionPlanClosureV1;
  readonly repositoryRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly executeNormalizedOperation?: (
    operation: CiVerificationNormalizedOperationV2
  ) => Promise<number> | number;
}): Promise<number> {
  const operation = resolveCiVerificationDevRunnerTargetV1(options);
  if (options.executeNormalizedOperation !== undefined) {
    return options.executeNormalizedOperation(operation);
  }
  const [, ...args] = ciVerificationNormalizedOperationArgvV2(operation);
  const argv = [process.execPath, ...args];
  const child = Bun.spawn(
    argv,
    {
      cwd: options.repositoryRoot,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: options.environment ?? process.env
    }
  );
  return child.exited;
}

function usage(): never {
  console.error('Usage: bun ./platform/dev-runner.ts <deps:ensure|typecheck|check:fast|check:affected [--plan]|test|test:affected|test:fast|test:slow|test:full|contract-freeze|imports:check [--remove-unused]|imports:transform [--remove-unused]|imports:remove-unused|imports:freeze|imports:staged [--candidate-base <sha>]|clean-test-workspaces> [args...]');
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

  if (target === 'check:affected') {
    if (args.length > 0 && (args.length !== 1 || args[0] !== '--plan')) usage();
    const { runLocalAffectedCheck } = await import('./dev-runner/check-runner.ts');
    process.exitCode = await runLocalAffectedCheck(args, {
      prepareCompilerNodeModulesPath: async () => {
        const dependencies = await ensureDevDependencies({ hookPolicy: 'if-installed' });
        return dependencies.nodeModulesPath;
      }
    });
    return;
  }

  if (target === 'check:fast') {
    if (args.length > 0) usage();
    const { runFastCheck } = await import('./dev-runner/check-runner.ts');
    process.exitCode = await runFastCheck({
      prepareCompilerNodeModulesPath: async () => {
        const dependencies = await ensureDevDependencies({ hookPolicy: 'if-installed' });
        return dependencies.nodeModulesPath;
      }
    });
    return;
  }

  if (target === 'test:affected') {
    const { runAffectedTests } = await import('./dev-runner/test-runner.ts');
    if (args.length === 1 && args[0] === '--plan') {
      process.exitCode = await runAffectedTests(args);
      return;
    }
    const { withHeavyVerificationGateLease } = await import('./shared/heavy-verification-gate-lease.ts');
    process.exitCode = await withHeavyVerificationGateLease(
      'test:affected',
      () => runAffectedTests(args),
      { namespace: 'test:affected', waitTimeoutMs: 5000 }
    );
    return;
  }

  const dependencies = await ensureDevDependencies({
    hookPolicy: target === 'deps:ensure' ? 'always' : 'if-installed'
  });
  if (target === 'deps:ensure') {
    console.log(`Compiler dependencies ready (${dependencies.source}, ${dependencies.manifestHash}).`);
    return;
  }

  if (
    target === 'imports:check' || target === 'imports:transform' || target === 'imports:remove-unused' ||
    target === 'imports:freeze' || target === 'imports:staged'
  ) {
    const {
      runCandidateImportCheck,
      runImportCheck,
      runImportTransform,
      runStagedImportOrganizer
    } = await import('./dev-runner/import-organizer.ts');
    if (target === 'imports:check' || target === 'imports:transform' || target === 'imports:remove-unused') {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--remove-unused')) usage();
      const intent = target === 'imports:remove-unused' || args[0] === '--remove-unused'
        ? 'remove-unused' as const
        : 'sort-and-combine' as const;
      if (target === 'imports:check') {
        const outcome = await runImportCheck({ intent });
        if (outcome.status === 'canonical') {
          console.log('Imports are canonical (zero writes).');
          process.exitCode = 0;
        } else {
          const recoveryCommand = intent === 'remove-unused'
            ? 'bun run imports:remove-unused'
            : 'bun run imports:transform';
          console.error(
            `Imports need transform (needs-import-transform) in ${outcome.files.length} file(s):\n`
            + `${outcome.files.map((file) => `- ${file}`).join('\n')}\nRun ${recoveryCommand}.`
          );
          process.exitCode = 1;
        }
      } else {
        const outcome = await runImportTransform({ intent });
        if (outcome.status === 'noop') {
          console.log('Imports are canonical; transform published no bytes.');
          process.exitCode = 0;
        } else if (outcome.status === 'accepted') {
          console.log(`Accepted import transform transaction ${outcome.transactionId} in ${outcome.files.length} file(s):\n${outcome.files.map((file) => `- ${file}`).join('\n')}`);
          process.exitCode = 0;
        } else {
          console.error(
            `Import transform ${outcome.status} (${outcome.reasonCode}); transaction ${outcome.transactionId}; recovery journal: ${outcome.journalPath}`
          );
          process.exitCode = 1;
        }
      }
      return;
    }
    if (target === 'imports:freeze') {
      if (args.length !== 0) usage();
      const outcome = await runCandidateImportCheck();
      if (outcome.status === 'canonical') {
        console.log('Candidate imports identity sealed (canonical).');
        process.exitCode = 0;
      } else {
        console.error(
          `Candidate imports are non-canonical (needs-import-transform) in ${outcome.files.length} file(s):\n`
          + `${outcome.files.map((file) => `- ${file}`).join('\n')}\n`
          + 'Run bun run imports:transform, stage the exact files, rebuild the exact candidate, then rerun bun run imports:freeze.'
        );
        process.exitCode = 1;
      }
      return;
    }
    if (args.length !== 0 && (
      args.length !== 2 || args[0] !== '--candidate-base' || !/^[0-9a-f]{40,64}$/u.test(args[1] ?? '')
    )) usage();
    process.exitCode = await runStagedImportOrganizer(
      undefined,
      undefined,
      args.length === 0 ? {} : { candidateBase: args[1] }
    );
    return;
  }

  if (target === 'typecheck') {
    const { runTypecheck } = await import('./dev-runner/typecheck-runner.ts');
    process.exitCode = await runTypecheck(args);
    return;
  }

  const {
    runContractFreeze,
    runFastTests,
    runSlowTests,
    runTests
  } = await import('./dev-runner/test-runner.ts');
  process.exitCode = target === 'contract-freeze'
    ? await runContractFreeze()
    : target === 'test'
      ? await runTests(args)
      : target === 'test:fast'
          ? await runFastTests(args)
          : target === 'test:slow'
            ? await runSlowTests(args)
            : usage();
}

if (import.meta.main) await main();
