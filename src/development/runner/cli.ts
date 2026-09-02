import path from 'node:path';

import { compileSecOperationDemandGraph } from '../../control/operation/demand.ts';
import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';
import { WORKSPACE_TRANSITION_DEADLINE_ENV } from '../workspace-transition/contract.ts';
import { DEV_RUNNER_ENTRYPOINT_PATH } from './contract.ts';
import {
  assertMaterializedOperationDependencyBootstrapResult,
  createDependencyFreshProcessHandoff,
  DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV,
  ensureOperationDependencies,
  reuseOperationDependencies,
  type MaterializedOperationDependencyBootstrapResult
} from './dependency-bootstrap.ts';

export function shouldReportDevRunnerSuccess(
  environment: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return environment.SEC_GIT_HOOK_ACTIVE !== '1';
}

export async function handoffDevRunnerToFreshProcess(
  dependencies: MaterializedOperationDependencyBootstrapResult,
  standardInput?: Uint8Array,
  workspaceTransitionDeadlineAtUnixMs?: number
): Promise<number | null> {
  assertMaterializedOperationDependencyBootstrapResult(dependencies);
  const handoff = createDependencyFreshProcessHandoff(dependencies);
  if (handoff === null) return null;
  const entrypoint = process.argv[1];
  const canonicalEntrypoint = path.resolve(process.cwd(), DEV_RUNNER_ENTRYPOINT_PATH);
  if (entrypoint === undefined || path.relative(canonicalEntrypoint, path.resolve(entrypoint)) !== '') {
    throw new Error('Dev runner fresh-process handoff has no exact entrypoint identity.');
  }
  const { runDevCommand } = await import('./command-runner.ts');
  return runDevCommand('bun', [entrypoint, ...process.argv.slice(2)], {
      [DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV]: handoff.transitionDigest,
      ...(workspaceTransitionDeadlineAtUnixMs === undefined ? {} : {
        [WORKSPACE_TRANSITION_DEADLINE_ENV]:
          String(workspaceTransitionDeadlineAtUnixMs)
      })
  }, {
    workingDirectory: process.cwd(),
    ...(workspaceTransitionDeadlineAtUnixMs === undefined ? {} : {
      deadlineAtUnixMs: workspaceTransitionDeadlineAtUnixMs
    }),
    ...(standardInput === undefined ? {} : {
      input: standardInput
    })
  });
}

type CheckAffectedDemand = ReturnType<typeof compileSecOperationDemandGraph>;

export interface CheckAffectedCommandOperations {
  readonly runPlan: () => Promise<number>;
  readonly ensureDependencies: (
    demand: CheckAffectedDemand
  ) => Promise<MaterializedOperationDependencyBootstrapResult>;
  readonly handoff: (
    dependencies: MaterializedOperationDependencyBootstrapResult
  ) => Promise<number | null>;
  readonly runExecution: (
    dependencies: MaterializedOperationDependencyBootstrapResult,
    demand: CheckAffectedDemand
  ) => Promise<number>;
}

/**
 * The `--plan` surface is a pure selector observation. Its admission precedes
 * dependency materialization and fresh-process handoff, so a plan query cannot
 * acquire an installation lock, publish a generation/locator, or spawn a
 * successor process.
 */
export async function runCheckAffectedCommand(
  args: readonly string[],
  operations: CheckAffectedCommandOperations
): Promise<number> {
  if (args.length > 0 && (args.length !== 1 || args[0] !== '--plan')) {
    throw new Error('check:affected accepts only --plan');
  }
  if (args.length === 1) return operations.runPlan();
  const demand = compileSecOperationDemandGraph({
    operation: 'check-affected',
    terminalWorkIds: []
  });
  const dependencies = await operations.ensureDependencies(demand);
  const handoffExitCode = await operations.handoff(dependencies);
  return handoffExitCode ?? operations.runExecution(dependencies, demand);
}

/**
 * TypeScript is itself part of the compiler dependency generation.  The CLI
 * therefore admits and reads back that generation before it loads any module
 * in the TypeScript execution closure.  The materialized result is passed to
 * the runner unchanged; the runner may not bootstrap a second generation.
 */
export async function runTypecheckCommand(args: readonly string[]): Promise<number> {
  const demand = compileSecOperationDemandGraph({
    operation: 'typecheck',
    terminalWorkIds: []
  });
  const dependencies = await ensureOperationDependencies(demand);
  const admittedDependencies = reuseOperationDependencies(dependencies, demand);
  const { runTypecheckWithDependencyAuthority } = await import('./typecheck-runner.ts');
  return runTypecheckWithDependencyAuthority(admittedDependencies, [...args]);
}

function usage(): never {
  console.error('Usage: bun ./src/development/runner/cli.ts <commit <message>|commit:recover <absolute-journal-path>|workspace-transition <post-checkout|post-merge|post-rewrite> [hook-args...]|deps:ensure|typecheck|check:fast|check:affected [--plan]|test|test:affected|test:fast|test:slow|test:full|contract-freeze|imports:check [--all|--candidate-base <sha>] [--remove-unused]|imports:check --staged [--candidate-base <sha>]|imports:apply [--all|--candidate-base <sha>] [--remove-unused]|imports:apply --staged [--candidate-base <sha>]|imports:freeze|generated-state:inspect|generated-state:plan|generated-state:cleanup|environment:workspace-settle> [args...]');
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
  operation: () => Promise<number>,
  semanticOperation?: SecBoundSemanticOperation
): Promise<number> {
  if (semanticOperation === undefined) {
    console.error(`${commandId} strict-zero-write-unproven: semantic operation authority is unavailable.`);
    return 1;
  }
  const { runRepositoryZeroWriteOperation: runRepositoryZeroWriteOperationV1 } = await import(
    './repository-mutation-fence.ts'
  );
  return runRepositoryZeroWriteOperationV1(commandId, operation, { operation: semanticOperation });
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
  const {
    assertCanonicalBunPackageRunner,
    readCanonicalBunRuntimeProjection
  } = await import('../../toolchain/runtime/bun-version.ts');
  const runtimeProjection = await readCanonicalBunRuntimeProjection();
  assertCanonicalBunPackageRunner(runtimeProjection.version);

  if (target === 'commit') {
    const { runDevelopmentCommitCommand } = await import('./commit-command.ts');
    process.exitCode = await runDevelopmentCommitCommand(args);
    return;
  }

  if (target === 'commit:recover') {
    const { runDevelopmentCommitRecoveryCommand } = await import('../commit/operation.ts');
    process.exitCode = await runDevelopmentCommitRecoveryCommand(args);
    return;
  }

  if (target === 'workspace-transition') {
    const [event, ...eventArguments] = args;
    if (event !== 'post-checkout' && event !== 'post-merge' && event !== 'post-rewrite') usage();
    const standardInput = event === 'post-rewrite' ? await Bun.stdin.bytes() : undefined;
    const { runWorkspaceTransitionOperation } = await import('../workspace-transition/operation.ts');
    process.exitCode = await runWorkspaceTransitionOperation({
      event,
      arguments: eventArguments,
      standardInput,
      repositoryRoot: process.cwd(),
      handoff: handoffDevRunnerToFreshProcess
    });
    return;
  }

  if (target === 'generated-state:inspect' || target === 'generated-state:plan'
      || target === 'generated-state:cleanup') {
    const { runGeneratedStateOperation } = await import('../../runtime-state/generated-state/operation.ts');
    const { compilerDependencyGeneratedStateSettlementOwner } = await import(
      '../../toolchain/dependencies/runtime.ts'
    );
    const operation = target.slice('generated-state:'.length);
    const result = await runGeneratedStateOperation(
      [operation, ...args],
      process.cwd(),
      [compilerDependencyGeneratedStateSettlementOwner]
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (target === 'environment:workspace-settle') {
    const unknown = args.filter((argument) => argument !== '--fix');
    if (unknown.length > 0) usage();
    const { settleWorkspaceEnvironment } = await import('../../runtime-state/generated-state/environment-settlement.ts');
    const result = await settleWorkspaceEnvironment({ fix: args.includes('--fix') });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'settled') process.exitCode = 1;
    return;
  }

  if (target === 'check:affected') {
    if (args.length > 0 && (args.length !== 1 || args[0] !== '--plan')) usage();
    process.exitCode = await runCheckAffectedCommand(args, {
      runPlan: async () => {
        const { runLocalAffectedCheck } = await import('./check-runner.ts');
        const { compileAffectedTestSelectionSemanticOperation } = await import('./affected-plan-contract.ts');
        const operation = compileAffectedTestSelectionSemanticOperation({
          purpose: 'check-affected'
        });
        return runRepositoryZeroWriteCommand(
          'check:affected',
          () => runLocalAffectedCheck(['--plan'], { operation }),
          operation
        );
      },
      ensureDependencies: ensureOperationDependencies,
      handoff: handoffDevRunnerToFreshProcess,
      runExecution: async (dependencies, demand) => {
        const { runLocalAffectedCheck } = await import('./check-runner.ts');
        const { compileAffectedTestSelectionSemanticOperation } = await import('./affected-plan-contract.ts');
        const operation = compileAffectedTestSelectionSemanticOperation({
          purpose: 'check-affected'
        });
        return runRepositoryZeroWriteCommand('check:affected', () =>
          runLocalAffectedCheck([], {
            operation,
            prepareCompilerDependencies: async () => reuseOperationDependencies(dependencies, demand)
          }), operation);
      }
    });
    return;
  }

  if (target === 'check:fast') {
    if (args.length > 0) usage();
    const demand = compileSecOperationDemandGraph({ operation: 'check-fast', terminalWorkIds: [] });
    const dependencies = await ensureOperationDependencies(demand);
    const handoffExitCode = await handoffDevRunnerToFreshProcess(dependencies);
    if (handoffExitCode !== null) {
      process.exitCode = handoffExitCode;
      return;
    }
    const { runFastCheck } = await import('./check-runner.ts');
    process.exitCode = await runRepositoryZeroWriteCommand('check:fast', () =>
      runFastCheck({
        prepareCompilerDependencies: async () => reuseOperationDependencies(dependencies, demand)
      }));
    return;
  }

  if (target === 'test:affected') {
    if (args.includes('--plan') && !(args.length === 1 && args[0] === '--plan')) {
      console.error('test:affected --plan cannot be combined with execution arguments.');
      process.exitCode = 1;
      return;
    }
    const { runAffectedTests } = await import('./test-runner.ts');
    const { issueCheckAffectedTestImpactProjection } = await import('./check-affected-source.ts');
    if (args.length === 1 && args[0] === '--plan') {
      process.exitCode = await runRepositoryZeroWriteCommand(
        'test:affected',
        () => runAffectedTests(issueCheckAffectedTestImpactProjection, args)
      );
      return;
    }
    const { withHeavyVerificationGateLease } = await import('../../verification/gate/state/heavy-lease.ts');
    process.exitCode = await runRepositoryZeroWriteCommand('test:affected', () =>
      withHeavyVerificationGateLease(
        'test:affected',
        () => runAffectedTests(issueCheckAffectedTestImpactProjection, args),
        { namespace: 'test:affected', waitTimeoutMs: 5000 }
      ));
    return;
  }

  if (target === 'deps:ensure') {
    const dependencies = await ensureOperationDependencies(compileSecOperationDemandGraph({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: process.env.SEC_GIT_HOOK_ACTIVE === '1' ? 'never' : 'always'
    }));
    if (shouldReportDevRunnerSuccess()) {
      console.log(`Compiler dependencies ready (${dependencies.source}, ${dependencies.manifestHash}).`);
    }
    return;
  }

  if (
    target === 'imports:check' || target === 'imports:apply' || target === 'imports:freeze'
  ) {
    const dependencies = await ensureOperationDependencies(compileSecOperationDemandGraph({
      operation: target === 'imports:check'
        ? 'imports-check'
        : target === 'imports:apply'
          ? 'imports-apply'
          : 'imports-freeze',
      terminalWorkIds: []
    }));
    const handoffExitCode = await handoffDevRunnerToFreshProcess(dependencies);
    if (handoffExitCode !== null) {
      process.exitCode = handoffExitCode;
      return;
    }
    const checkStagedImports = async (candidateBase?: string) => {
      const [{ withAuthorityGitReadSession }, { GIT_READ_OPERATION_BUDGET }, {
        checkStagedCandidateImportNormalization
      }] = await Promise.all([
        import('../../external-capabilities/git-read/authority.ts'),
        import('../tooling/git/git-read.ts'),
        import('../import-normalization/runtime.ts')
      ]);
      return withAuthorityGitReadSession({
        cwd: process.cwd(),
        budget: GIT_READ_OPERATION_BUDGET
      }, (session) => checkStagedCandidateImportNormalization({
        session,
        ...(candidateBase === undefined ? {} : { candidateBase })
      }));
    };
    if (target === 'imports:freeze') {
      if (args.length !== 0) usage();
      const outcome = await checkStagedImports(process.env.SEC_CHANGED_BASE);
      if (outcome.status === 'canonical') {
        if (shouldReportDevRunnerSuccess()) {
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
    const {
      runImportCheck,
      runImportApply,
      runSynchronizedStagedImportOrganizer
    } = await import('./import-organizer.ts');
    if (target === 'imports:check' || target === 'imports:apply') {
      const operation = parseImportOperationArgs(args, { allowStaged: true });
      if (operation.staged) {
        const selection = operation.candidateBase === undefined
          ? {}
          : { candidateBase: operation.candidateBase };
        if (target === 'imports:check') {
          const outcome = await checkStagedImports(operation.candidateBase);
          if (outcome.status === 'canonical') {
            process.exitCode = 0;
          } else {
            console.error(
              `Staged imports need apply (needs-import-transform) in ${outcome.files.length} file(s):\n`
              + `${outcome.files.map((file) => `- ${file}`).join('\n')}\n`
              + 'Run bun run imports:apply --staged before committing.'
            );
            process.exitCode = 1;
          }
        } else {
          process.exitCode = await runSynchronizedStagedImportOrganizer(undefined, undefined, selection);
        }
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
  }

  if (target === 'typecheck') {
    process.exitCode = await runTypecheckCommand(args);
    return;
  }

  const {
    runContractFreeze,
    runFastTests,
    runSlowTests,
    runTests
  } = await import('./test-runner.ts');
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
