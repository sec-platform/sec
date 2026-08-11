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
  console.error('Usage: bun ./platform/dev-runner.ts <deps:ensure|typecheck|check:fast|check:affected [--plan]|test|test:affected|test:fast|test:slow|test:full|contract-freeze|imports:check [--all|--candidate-base <sha>] [--remove-unused]|imports:apply [--all|--candidate-base <sha>] [--remove-unused]|imports:apply --staged [--candidate-base <sha>]|imports:freeze|clean-test-workspaces> [args...]');
  process.exit(1);
}

type ParsedImportOperationArgs = Readonly<{
  scope: 'candidate' | 'all';
  candidateBase?: string;
  intent: 'sort-and-combine' | 'remove-unused';
  staged: boolean;
}>;

function parseImportOperationArgs(
  args: readonly string[],
  options: { allowStaged: boolean }
): ParsedImportOperationArgs {
  let scope: 'candidate' | 'all' = 'candidate';
  let candidateBase: string | undefined;
  let intent: 'sort-and-combine' | 'remove-unused' = 'sort-and-combine';
  let staged = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (seen.has(argument)) usage();
    seen.add(argument);
    if (argument === '--all') {
      scope = 'all';
      continue;
    }
    if (argument === '--remove-unused') {
      intent = 'remove-unused';
      continue;
    }
    if (argument === '--staged' && options.allowStaged) {
      staged = true;
      continue;
    }
    if (argument === '--candidate-base') {
      const value = args[index + 1];
      if (value === undefined || !/^[0-9a-f]{40,64}$/u.test(value)) usage();
      candidateBase = value;
      index += 1;
      continue;
    }
    usage();
  }
  if (scope === 'all' && candidateBase !== undefined) usage();
  if (staged && (scope === 'all' || intent === 'remove-unused')) usage();
  return Object.freeze({ scope, ...(candidateBase === undefined ? {} : { candidateBase }), intent, staged });
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
    target === 'imports:check' || target === 'imports:apply' || target === 'imports:freeze'
  ) {
    const {
      runCandidateImportCheck,
      runImportCheck,
      runImportApply,
      runStagedImportOrganizer,
      resolveCandidateImportBase
    } = await import('./dev-runner/import-organizer.ts');
    if (target === 'imports:check' || target === 'imports:apply') {
      const operation = parseImportOperationArgs(args, { allowStaged: target === 'imports:apply' });
      if (operation.staged) {
        const candidateBase = resolveCandidateImportBase(undefined, operation.candidateBase);
        process.exitCode = await runStagedImportOrganizer(undefined, undefined, { candidateBase });
        return;
      }
      if (target === 'imports:check') {
        const outcome = await runImportCheck(operation);
        if (outcome.status === 'canonical') {
          console.log('Imports are canonical (zero writes).');
          process.exitCode = 0;
        } else {
          const recoveryCommand = [
            'bun run imports:apply',
            operation.scope === 'all' ? '--all' : undefined,
            operation.candidateBase === undefined ? undefined : `--candidate-base ${operation.candidateBase}`,
            operation.intent === 'remove-unused' ? '--remove-unused' : undefined
          ].filter(Boolean).join(' ');
          console.error(
            `Imports need apply (needs-import-transform) in ${outcome.files.length} file(s):\n`
            + `${outcome.files.map((file) => `- ${file}`).join('\n')}\nRun ${recoveryCommand}.`
          );
          process.exitCode = 1;
        }
      } else {
        const outcome = await runImportApply(operation);
        if (outcome.status === 'noop') {
          console.log(`Imports are canonical; plan ${outcome.planDigest} published no bytes.`);
          process.exitCode = 0;
        } else if (outcome.status === 'accepted') {
          console.log(`Accepted import apply plan ${outcome.planDigest} as transaction ${outcome.transactionId} in ${outcome.files.length} file(s):\n${outcome.files.map((file) => `- ${file}`).join('\n')}`);
          process.exitCode = 0;
        } else {
          console.error(
            `Import apply ${outcome.status} (${outcome.reasonCode}); plan ${outcome.planDigest}; transaction ${outcome.transactionId}; recovery journal: ${outcome.journalPath}`
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
          + 'Run bun run imports:apply, stage the exact files, rebuild the exact candidate, then rerun bun run imports:freeze.'
        );
        process.exitCode = 1;
      }
      return;
    }
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
