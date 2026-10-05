import type { SecBoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import type { ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { isAffectedSelectionFailClosed } from '../../../verification/platform/test-impact/contract/selection-boundary.ts';
import { affectedGitSelectionDigest, issueAffectedGitSelectionSource, type IssuedAffectedGitSelectionSource } from '../../../verification/platform/test-impact/runtime/affected-git-source.ts';
import { compilerRoot } from '../../../workspace-context.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import { boundedAffectedBaseRef, createAffectedGitRevalidationLedger, reobserveAffectedGitSelectionState, sameGitSelectionObservation } from './affected-git-observation.ts';
import {
  affectedTestPlanExitCode,
  buildLocalAffectedCheckPlan,
  gitOnlyAffectedTestPlan,
  isDocumentationOnlyAffectedSelection,
  type LocalAffectedGateStep
} from './affected-plan-contract.ts';
import { assertMaterializedOperationDependencyBootstrapResult, type MaterializedOperationDependencyBootstrapResult } from './dependency-bootstrap.ts';
import { retainOperationDependencyReadGeneration } from './dependency-read-generation.ts';
import { executeFastCheckStages } from './fast-check-stages.ts';
import {
  type ResolvedAffectedTestExecution
} from './test-runner.ts';

interface LocalAffectedCheckExecutionOptions {
  readonly operation: SecBoundSemanticOperation;
  readonly preparedGitSelection?: IssuedAffectedGitSelectionSource;
  readonly expectedSelectionDigest?: `sha256:${string}`;
  /** Borrowed by the repository fence; no selector may open a second ledger. */
  readonly processSession?: ProcessResourceSession;
  readonly prepareCompilerDependencies?: () => Promise<MaterializedOperationDependencyBootstrapResult>;
}


export interface PreparedLocalAffectedCheck {
  readonly operation: SecBoundSemanticOperation;
  readonly selection: IssuedAffectedGitSelectionSource;
  readonly selectionDigest: `sha256:${string}`;
  readonly needsDependencies: boolean;
}

/** Git-only discovery settles its zero-write fence before dependency effects. */
export async function prepareLocalAffectedCheck(input: Readonly<{
  operation: SecBoundSemanticOperation;
  expectedSelectionDigest?: `sha256:${string}`;
}>): Promise<PreparedLocalAffectedCheck | null> {
  const { operation, expectedSelectionDigest } = input;
  const rawBase = process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
  const baseRef = boundedAffectedBaseRef(rawBase);
  if (rawBase !== undefined && baseRef === null) return null;
  let selection: IssuedAffectedGitSelectionSource | null = null;
  const { runRepositoryZeroWriteOperation } = await import('./repository-mutation-fence.ts');
  const exitCode = await runRepositoryZeroWriteOperation('check:affected:selection', async processSession => {
    selection = await withAuthorityGitReadSession({ cwd: compilerRoot, operation,
      processSession, budget: GIT_READ_OPERATION_BUDGET }, session =>
      issueAffectedGitSelectionSource({ session, baseRef }));
    return selection === null ? 1 : 0;
  }, { operation });
  if (exitCode !== 0 || selection === null) return null;
  const selected = selection as IssuedAffectedGitSelectionSource;
  const selectionDigest = affectedGitSelectionDigest(selected);
  if (expectedSelectionDigest !== undefined && expectedSelectionDigest !== selectionDigest) {
    throw new Error('Affected Git selection changed across dependency handoff');
  }
  return Object.freeze({ operation, selection: selected, selectionDigest,
    needsDependencies: selected.files.length !== 0 });
}

/** Consume the prepared selection. Only source-relevant work loads the compiler/test closure. */
export async function runPreparedLocalAffectedCheck(
  prepared: PreparedLocalAffectedCheck,
  dependencies?: MaterializedOperationDependencyBootstrapResult
): Promise<number> {
  if (affectedGitSelectionDigest(prepared.selection) !== prepared.selectionDigest) {
    throw new Error('Affected preparation is not bound to its owner-issued selection');
  }
  const needsDependencies = prepared.selection.files.length !== 0;
  if (needsDependencies !== prepared.needsDependencies) throw new Error('Affected preparation demand changed');
  if (needsDependencies) {
    if (dependencies === undefined) throw new Error('Selected affected Gates require their runtime dependencies');
    assertMaterializedOperationDependencyBootstrapResult(dependencies);
  }
  if (needsDependencies && !isDocumentationOnlyAffectedSelection(prepared.selection.files)) {
    return runLocalAffectedCheck([], { operation: prepared.operation,
      preparedGitSelection: prepared.selection, expectedSelectionDigest: prepared.selectionDigest,
      prepareCompilerDependencies: async () => dependencies! });
  }
  const ledger = createAffectedGitRevalidationLedger(prepared.operation.plan.attempt.deadlineAtUnixMs);
  const plan = gitOnlyAffectedTestPlan(prepared.selection.files, prepared.selection.gitObservation,
    process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK === '1');
  const execution: ResolvedAffectedTestExecution = Object.freeze({ plan, projectGenerationEvidence: null,
    assertCurrent: async () => {
      const current = await reobserveAffectedGitSelectionState(prepared.selection.gitObservation, ledger);
      return current !== null && sameGitSelectionObservation(prepared.selection.gitObservation, current);
    },
    run: async () => { throw new Error('Git-only selection has no test execution'); }
  });
  return executeSelectedLocalAffectedCheck(execution, dependencies);
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
    console.error('check:affected accepts only --plan.');
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
        preparedGitSelection: options.preparedGitSelection,
        expectedSelectionDigest: options.expectedSelectionDigest,
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
        'check:affected:selection',
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
  if (args.length === 1) {
    const plan = buildLocalAffectedCheckPlan(affectedPlan);
    console.log(JSON.stringify(plan, null, 2));
    return affectedTestPlanExitCode(affectedPlan);
  }
  return executeSelectedLocalAffectedCheck(affectedExecution, compilerDependencies);
}

async function executeSelectedLocalAffectedCheck(
  affectedExecution: ResolvedAffectedTestExecution,
  compilerDependencies: MaterializedOperationDependencyBootstrapResult | undefined
): Promise<number> {
  const affectedPlan = affectedExecution.plan;
  const plan = buildLocalAffectedCheckPlan(affectedPlan);
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

  // Revalidate the retained selection before entering the selected Gate union.
  if (!(await assertAffectedExecutionCurrent(affectedExecution, 'gate admission'))) {
    return 1;
  }

  const compilerGateSelected = plan.gates.some(({ id }) => (
    id === 'imports:check' || id === 'typecheck'
  ));
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
    {
      id: 'source-program-audit',
      args: ['run', 'audit', '--', '--worktree-source-program', '--enforce']
    },
    { id: 'unused', args: ['run', 'unused'] },
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
