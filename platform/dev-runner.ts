import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { ensureDevDependencies } from './dev-runner/dependency-bootstrap.ts';

const DEPENDENCY_GENERATION_BOUND_ENV = 'SEC_DEPENDENCY_GENERATION_BOUND';

export type DevRunnerDependencyRelaunchV1 = Readonly<{
  args: readonly string[];
  command: string;
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

export function createDevRunnerDependencyRelaunchV1(input: Readonly<{
  dependencies: Awaited<ReturnType<typeof ensureDevDependencies>>;
  environment: Readonly<NodeJS.ProcessEnv>;
  executablePath: string;
  runnerPath: string;
  runnerArgs: readonly string[];
}>): DevRunnerDependencyRelaunchV1 | null {
  const generation = path.resolve(input.dependencies.nodeModulesPath);
  const localGeneration = path.join(path.resolve(input.dependencies.root), 'node_modules');
  if (!input.dependencies.requiresProcessRelaunch && generation === localGeneration) return null;
  if (input.environment[DEPENDENCY_GENERATION_BOUND_ENV] === generation
      && input.environment.NODE_PATH === generation) return null;
  const pathKey = Object.keys(input.environment)
    .find((key) => key.toLocaleLowerCase('en-US') === 'path') ?? 'PATH';
  return Object.freeze({
    args: Object.freeze([input.runnerPath, ...input.runnerArgs]),
    command: input.executablePath,
    environment: Object.freeze({
      ...input.environment,
      [DEPENDENCY_GENERATION_BOUND_ENV]: generation,
      NODE_PATH: generation,
      [pathKey]: `${path.join(generation, '.bin')}${path.delimiter}${input.environment[pathKey] ?? ''}`
    })
  });
}

function relaunchWithDependencyGenerationIfRequired(
  dependencies: Awaited<ReturnType<typeof ensureDevDependencies>>
): boolean {
  const relaunch = createDevRunnerDependencyRelaunchV1({
    dependencies,
    environment: process.env,
    executablePath: process.execPath,
    runnerPath: path.join(import.meta.dir, 'dev-runner.ts'),
    runnerArgs: process.argv.slice(2)
  });
  if (relaunch === null) return false;
  const result = spawnSync(
    relaunch.command,
    [...relaunch.args],
    {
      env: { ...relaunch.environment },
      stdio: 'inherit',
      windowsHide: true
    }
  );
  if (result.error !== undefined) throw result.error;
  process.exitCode = result.status ?? 1;
  return true;
}

export function shouldReportDevRunnerSuccessV1(
  environment: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return environment.SEC_GIT_HOOK_ACTIVE !== '1';
}

function usage(): never {
  console.error('Usage: bun ./platform/dev-runner.ts <deps:ensure|typecheck|check:fast|check:affected [--plan]|test|test:affected|test:fast|test:slow|test:full|contract-freeze|imports:check [--all|--candidate-base <sha>] [--remove-unused]|imports:apply [--all|--candidate-base <sha>] [--remove-unused]|imports:apply --staged [--candidate-base <sha>]|imports:freeze|generated-state:inspect|generated-state:plan|generated-state:cleanup|environment:workspace-settle> [args...]');
  process.exit(1);
}

type ParsedImportOperationArgs = Readonly<{
  scope: 'candidate' | 'all';
  candidateBase?: string;
  intent: 'sort-and-combine' | 'remove-unused';
  staged: boolean;
}>;

async function runRepositoryZeroWriteCommand(
  commandId: string,
  operation: () => Promise<number>
): Promise<number> {
  const { runRepositoryZeroWriteOperationV1 } = await import(
    './dev-runner/repository-mutation-fence.ts'
  );
  return runRepositoryZeroWriteOperationV1(commandId, operation);
}

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

  if (target === 'generated-state:inspect' || target === 'generated-state:plan'
      || target === 'generated-state:cleanup') {
    const { runGeneratedStateOperationV1 } = await import('../tooling/sec-dev/generated-state-operations.ts');
    const operation = target.slice('generated-state:'.length);
    const result = await runGeneratedStateOperationV1([operation, ...args]);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (target === 'environment:workspace-settle') {
    const unknown = args.filter((argument) => argument !== '--fix');
    if (unknown.length > 0) usage();
    const { settleEnvironmentV1 } = await import('../tooling/sec-dev/generated-state-operations.ts');
    const result = await settleEnvironmentV1({ fix: args.includes('--fix') });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'settled') process.exitCode = 1;
    return;
  }

  if (target === 'check:affected') {
    if (args.length > 0 && (args.length !== 1 || args[0] !== '--plan')) usage();
    const dependencies = await ensureDevDependencies({ hookPolicy: 'if-installed' });
    if (relaunchWithDependencyGenerationIfRequired(dependencies)) return;
    const { runLocalAffectedCheck } = await import('./dev-runner/check-runner.ts');
    process.exitCode = await runRepositoryZeroWriteCommand('check:affected', () =>
      runLocalAffectedCheck(args, {
        prepareCompilerNodeModulesPath: async () => dependencies.nodeModulesPath
      }));
    return;
  }

  if (target === 'check:fast') {
    if (args.length > 0) usage();
    const dependencies = await ensureDevDependencies({ hookPolicy: 'if-installed' });
    if (relaunchWithDependencyGenerationIfRequired(dependencies)) return;
    const { runFastCheck } = await import('./dev-runner/check-runner.ts');
    process.exitCode = await runRepositoryZeroWriteCommand('check:fast', () =>
      runFastCheck({
        prepareCompilerNodeModulesPath: async () => dependencies.nodeModulesPath
      }));
    return;
  }

  if (target === 'test:affected') {
    const { runAffectedTests } = await import('./dev-runner/test-runner.ts');
    if (args.length === 1 && args[0] === '--plan') {
      process.exitCode = await runRepositoryZeroWriteCommand(
        'test:affected',
        () => runAffectedTests(args)
      );
      return;
    }
    const { withHeavyVerificationGateLease } = await import('./shared/heavy-verification-gate-lease.ts');
    process.exitCode = await runRepositoryZeroWriteCommand('test:affected', () =>
      withHeavyVerificationGateLease(
        'test:affected',
        () => runAffectedTests(args),
        { namespace: 'test:affected', waitTimeoutMs: 5000 }
      ));
    return;
  }

  const dependencies = await ensureDevDependencies({
    hookPolicy: process.env.SEC_GIT_HOOK_ACTIVE === '1'
      ? 'never'
      : target === 'deps:ensure' ? 'always' : 'if-installed'
  });
  if (relaunchWithDependencyGenerationIfRequired(dependencies)) return;
  if (target === 'deps:ensure') {
    if (shouldReportDevRunnerSuccessV1()) {
      console.log(`Compiler dependencies ready (${dependencies.source}, ${dependencies.manifestHash}).`);
    }
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
        if (shouldReportDevRunnerSuccessV1()) {
          console.log('Candidate imports identity sealed (canonical).');
        }
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
  process.exitCode = await runRepositoryZeroWriteCommand(target, () => (
    target === 'contract-freeze'
      ? runContractFreeze()
      : target === 'test'
        ? runTests(args)
        : target === 'test:fast'
            ? runFastTests(args)
            : target === 'test:slow'
              ? runSlowTests(args)
              : usage()
  ));
}

if (import.meta.main) await main();
