import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';
import { isAffectedSelectionFailClosed } from '../../verification/test-impact/affected.ts';
import {
  affectedTestPlanExitCode,
  buildLocalAffectedCheckPlan,
  type LocalAffectedGateStep
} from './affected-plan-contract.ts';
import {
  retainOperationDependencyReadGeneration,
  type OperationDependencyBootstrapResult
} from './dependency-bootstrap.ts';
import {
  type ResolvedAffectedTestExecution
} from './test-runner.ts';

interface LocalAffectedCheckExecutionOptions {
  readonly operation: SecBoundSemanticOperation;
  readonly prepareCompilerDependencies?: () => Promise<OperationDependencyBootstrapResult>;
}


async function executeLocalAffectedGate(
  step: LocalAffectedGateStep,
  affectedExecution: ResolvedAffectedTestExecution,
  compilerDependencies: OperationDependencyBootstrapResult | undefined
): Promise<number> {
  if (step.id === 'imports:check') {
    const { runImportCheck } = await import('./import-organizer.ts');
    const outcome = await runImportCheck({});
    if (outcome.status === 'canonical') return 0;
    console.error(
      `Imports need transform (needs-import-transform) in ${outcome.files.length} file(s):\n`
      + `${outcome.files.map((file) => `- ${file}`).join('\n')}\nRun bun run imports:apply.`
    );
    return 1;
  }
  if (step.id === 'typecheck') {
    if (compilerDependencies === undefined) {
      console.error('Local affected typecheck requires completed compiler dependency admission.');
      return 1;
    }
    const { runTypecheckWithDependencyRootAndProjectGenerationEvidence } = await import(
      './typecheck-runner.ts'
    );
    return runTypecheckWithDependencyRootAndProjectGenerationEvidence(
      compilerDependencies,
      affectedExecution.projectGenerationEvidence
    );
  }
  if (step.id === 'docs:doctor') {
    const { runDevCommand } = await import('./command-runner.ts');
    return runDevCommand('bun', ['src/control/documentation/doctor/cli.ts'], {});
  }

  const { withHeavyVerificationGateLease } = await import('../../verification/gate/state/heavy-lease.ts');
  return withHeavyVerificationGateLease(
    'test:affected',
    () => affectedExecution.run(compilerDependencies)
  );
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
  let affectedExecution: ResolvedAffectedTestExecution | null;
  try {
    affectedExecution = await resolveAffectedTestExecution({
      dependencyGeneration: dependencyResolution?.generation,
      operation: options.operation,
      issueTestImpactProjection: issueCheckAffectedTestImpactProjection,
      // This owner performs the explicit admission immediately before compiler
      // dependency preparation and before every gate. Plan output keeps the
      // resolution-time fence; execution avoids an otherwise redundant full
      // source census before its own adjacent fence.
      verifyAtResolution: args.length === 1
    });
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
  readonly prepareCompilerDependencies?: () => Promise<OperationDependencyBootstrapResult>;
}

export async function runFastCheck(options: FastCheckExecutionOptions = {}): Promise<number> {
  if (!options.prepareCompilerDependencies) {
    console.error('Fast check requires the canonical dependency preparation capability.');
    return 1;
  }

  const compilerDependencies = await options.prepareCompilerDependencies();

  console.log('Running fast check: imports:check -> docs:doctor + typecheck (parallel) -> test:fast');

  const { runImportCheck } = await import('./import-organizer.ts');
  const importsOutcome = await runImportCheck({});
  if (importsOutcome.status !== 'canonical') {
    console.error(
      `Imports need transform (needs-import-transform) in ${importsOutcome.files.length} file(s):\n`
      + `${importsOutcome.files.map((file) => `- ${file}`).join('\n')}\nRun bun run imports:apply.`
    );
    return 1;
  }

  const { runDevCommand } = await import('./command-runner.ts');
  const { runTypecheckWithDependencyRoot } = await import('./typecheck-runner.ts');
  const typecheck = () => runTypecheckWithDependencyRoot(compilerDependencies);

  const [docsCode, typecheckCode] = await Promise.all([
    runDevCommand('bun', ['src/control/documentation/doctor/cli.ts'], {}),
    typecheck()
  ]);
  if (docsCode !== 0) return docsCode;
  if (typecheckCode !== 0) return typecheckCode;

  const { withHeavyVerificationGateLease } = await import('../../verification/gate/state/heavy-lease.ts');
  const { runFastTests } = await import('./test-runner.ts');
  return withHeavyVerificationGateLease('test:fast', () => runFastTests([], compilerDependencies), {
    namespace: 'test:fast',
    waitTimeoutMs: 5000
  });
}
