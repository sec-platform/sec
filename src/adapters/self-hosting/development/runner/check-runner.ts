import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import type { ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { isAffectedSelectionFailClosed } from '../../../verification/platform/test-impact/affected.ts';
import {
  affectedTestPlanExitCode,
  buildLocalAffectedCheckPlan,
  type LocalAffectedGateStep
} from './affected-plan-contract.ts';
import type { MaterializedOperationDependencyBootstrapResult } from './dependency-bootstrap.ts';
import { retainOperationDependencyReadGeneration } from './dependency-read-generation.ts';
import { executeFastCheckStages } from './fast-check-stages.ts';
import {
  type ResolvedAffectedTestExecution
} from './test-runner.ts';

interface LocalAffectedCheckExecutionOptions {
  readonly operation: BoundSemanticOperation;
  /** Borrowed by the repository fence; no selector may open a second ledger. */
  readonly processSession?: ProcessResourceSession;
  readonly prepareCompilerDependencies?: () => Promise<MaterializedOperationDependencyBootstrapResult>;
}


async function executeLocalAffectedGate(
  step: LocalAffectedGateStep,
  affectedExecution: ResolvedAffectedTestExecution,
  compilerDependencies: MaterializedOperationDependencyBootstrapResult | undefined
): Promise<number> {
  if (step.id === 'imports:check') {
    return runObservedReadOnlyStage(step.id, async () => {
      const { runImportCheck } = await import('./import-organizer.ts');
      const outcome = await runImportCheck({});
      if (outcome.status === 'canonical') return 0;
      console.error(
        `Imports need transform (needs-import-transform) in ${outcome.files.length} file(s):\n`
        + `${outcome.files.map((file) => `- ${file}`).join('\n')}\nRun bun run imports:apply.`
      );
      return 1;
    });
  }
  if (step.id === 'typecheck') {
    const projectGenerationEvidence = affectedExecution.projectGenerationEvidence;
    if (compilerDependencies === undefined || projectGenerationEvidence === null) {
      console.error('Local affected native typecheck requires completed dependency and ProjectInput admission.');
      return 1;
    }
    return runObservedReadOnlyStage(step.id, async () => {
      const { runDevCommand } = await import('./command-runner.ts');
      return runDevCommand('bun', ['run', 'typecheck'], {});
    });
  }
  if (step.id === 'docs:doctor') {
    return runObservedReadOnlyStage(step.id, async () => {
      const { runDevCommand } = await import('./command-runner.ts');
      return runDevCommand('bun', ['run', 'docs:doctor'], {});
    });
  }

  const { withHeavyVerificationGateLease } = await import('../../../verification/platform/gate/state/heavy-lease.ts');
  return withHeavyVerificationGateLease(
    'test:affected',
    () => affectedExecution.run(compilerDependencies)
  );
}

async function runObservedReadOnlyStage(
  commandId: string,
  run: () => Promise<number>
): Promise<number> {
  const { runStandaloneRepositoryZeroWriteOperation } = await import('./repository-mutation-fence.ts');
  return runStandaloneRepositoryZeroWriteOperation(commandId, run);
}

async function assertAffectedExecutionCurrent(
  affectedExecution: ResolvedAffectedTestExecution,
  boundary: string
): Promise<boolean> {
  if (await affectedExecution.assertCurrent()) return true;
  console.error(`Affected plan observation drifted at ${boundary}; no further effect is authorized.`);
  return false;
}

export async function runLocalAffectedCheck(
  args: string[] = [],
  options: LocalAffectedCheckExecutionOptions
): Promise<number> {
  if (args.length > 0 && !(args.length === 1 && args[0] === '--plan')) {
    console.error('check --affected accepts only --plan.');
    return 1;
  }
  const { issueCheckAffectedTestImpactProjection } = await import('./check-affected-source.ts');
  const { resolveAffectedTestExecution } = await import('./test-runner.ts');
  if (args.length === 0 && !options.prepareCompilerDependencies) {
    console.error('Local affected execution requires completed compiler dependency admission.');
    return 1;
  }
  const compilerDependencies = args.length === 0
    ? await options.prepareCompilerDependencies!()
    : undefined;
  const dependencyResolution = compilerDependencies === undefined
    ? null
    : await retainOperationDependencyReadGeneration({
        dependencies: compilerDependencies,
        deadlineAtUnixMs: options.operation.plan.attempt.deadlineAtUnixMs
      });
  if (dependencyResolution?.status === 'unavailable') {
    console.error(`Affected ProjectInput dependency generation is unavailable: ${dependencyResolution.reason}`);
    return 1;
  }
  let affectedExecution: ResolvedAffectedTestExecution | null = null;
  try {
    const resolve = (processSession?: ProcessResourceSession) => resolveAffectedTestExecution({
        dependencyGeneration: dependencyResolution?.generation,
        operation: options.operation,
        processSession,
        issueTestImpactProjection: issueCheckAffectedTestImpactProjection,
        verifyAtResolution: args.length === 1
      });
    if (options.processSession !== undefined) {
      affectedExecution = await resolve(options.processSession);
    } else {
      const { runRepositoryZeroWriteOperation } = await import('./repository-mutation-fence.ts');
      const selectionCode = await runRepositoryZeroWriteOperation(
        'check:affected-selection',
        async (processSession) => {
          affectedExecution = await resolve(processSession);
          return affectedExecution === null ? 1 : 0;
        },
        { operation: options.operation }
      );
      if (selectionCode !== 0) return selectionCode;
    }
  } finally {
    if (dependencyResolution?.status === 'ready') {
      await dependencyResolution.generation.retire();
    }
  }
  if (!affectedExecution) {
    console.error('Failed to detect affected test files.');
    return 1;
  }
  const affectedPlan = affectedExecution.plan;
  const plan = buildLocalAffectedCheckPlan(affectedPlan);
  if (args.length === 1) {
    console.log(JSON.stringify(plan, null, 2));
    return affectedTestPlanExitCode(affectedPlan);
  }
  if (!plan.resolved || isAffectedSelectionFailClosed(affectedPlan.selectionTrustBoundary)) {
    console.error(
      `Local affected check ownership is unresolved for changed paths: ${affectedPlan.unresolvedPaths.join(', ')}`
    );
    return 1;
  }
  if (plan.gates.length === 0) {
    console.log('No local affected gates selected.');
    return 0;
  }

  // The plan may have been observed well before dependency preparation. Keep
  // this admission immediately adjacent to that effect boundary so source,
  // index, worktree and Git provider drift cannot authorize a bootstrap.
  if (!(await assertAffectedExecutionCurrent(affectedExecution, 'dependency preparation'))) {
    return 1;
  }

  const compilerGateSelected = plan.gates.some(({ id }) => (
    id === 'imports:check' || id === 'typecheck'
  ));
  if (compilerGateSelected && !options.prepareCompilerDependencies) {
    console.error('Local affected compiler Gates require the canonical dependency preparation capability.');
    return 1;
  }
  if (compilerGateSelected && compilerDependencies === undefined) {
    console.error('Local affected compiler Gates require completed dependency admission.');
    return 1;
  }

  console.log(`Running local affected Gate union once: ${plan.gates.map(({ id }) => id).join(' -> ')}`);
  for (const step of plan.gates) {
    if (!(await assertAffectedExecutionCurrent(affectedExecution, `gate ${step.id}`))) {
      return 1;
    }
    const code = await executeLocalAffectedGate(step, affectedExecution, compilerDependencies);
    if (code !== 0) return code;
  }
  return 0;
}

interface FastCheckExecutionOptions {
  readonly prepareCompilerDependencies?: () => Promise<MaterializedOperationDependencyBootstrapResult>;
}

export async function runFastCheck(options: FastCheckExecutionOptions = {}): Promise<number> {
  if (!options.prepareCompilerDependencies) {
    console.error('Fast check requires the canonical dependency preparation capability.');
    return 1;
  }

  const compilerDependencies = await options.prepareCompilerDependencies();

  console.log('Running check: imports:check -> docs:doctor + typecheck (parallel) -> fast tests');

  return executeFastCheckStages({
    imports: async () => {
      return runObservedReadOnlyStage('check:imports', async () => {
        const { runImportCheck } = await import('./import-organizer.ts');
        const outcome = await runImportCheck({});
        if (outcome.status === 'canonical') return 0;
        console.error(
          `Imports need transform (needs-import-transform) in ${outcome.files.length} file(s):\n`
          + `${outcome.files.map(file => `- ${file}`).join('\n')}\nRun bun run imports:apply.`
        );
        return 1;
      });
    },
    documentation: async () => {
      return runObservedReadOnlyStage('check:docs:doctor', async () => {
        const { runDevCommand } = await import('./command-runner.ts');
        return runDevCommand('bun', ['run', 'docs:doctor'], {});
      });
    },
    types: async () => {
      return runObservedReadOnlyStage('check:typecheck', async () => {
        const { runTypecheckWithDependencyRoot } = await import('./typecheck-runner.ts');
        return runTypecheckWithDependencyRoot(compilerDependencies);
      });
    },
    tests: async () => {
      const { withHeavyVerificationGateLease } = await import('../../../verification/platform/gate/state/heavy-lease.ts');
      const { runFastTests } = await import('./test-runner.ts');
      return withHeavyVerificationGateLease('test:fast', () => runFastTests([], compilerDependencies), {
        namespace: 'test:fast',
        waitTimeoutMs: 5000
      });
    }
  });
}

export async function runFullCheck(): Promise<number> {
  const { runDevCommand } = await import('./command-runner.ts');
  const steps: ReadonlyArray<Readonly<{ id: string; args: readonly string[] }>> = [
    { id: 'imports', args: ['run', 'imports:check', '--all'] },
    { id: 'source-program-audit', args: ['run', 'audit', '--', '--scope', 'source-program', '--enforce'] },
    { id: 'unused', args: ['run', 'unused'] },
    { id: 'duplication', args: ['run', 'duplicates:check'] },
    { id: 'typecheck', args: ['run', 'typecheck:verified'] },
    { id: 'documentation', args: ['run', 'docs:doctor'] },
    { id: 'tests', args: ['run', 'test', '--', '--scope', 'full'] }
  ];
  for (const step of steps) {
    const exitCode = await runDevCommand('bun', [...step.args], {});
    if (exitCode !== 0) {
      console.error(`Full check stopped at ${step.id} with exit code ${exitCode}.`);
      return exitCode;
    }
  }
  return 0;
}
