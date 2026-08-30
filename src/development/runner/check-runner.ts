import path from 'node:path';

import { isActiveDocumentationPath } from '../../control/documentation/active.ts';
import { isAffectedSelectionFailClosed } from '../../verification/test-impact/affected.ts';
import type { OperationDependencyBootstrapResult } from './dependency-bootstrap.ts';
import {
  affectedTestPlanExitCode,
  resolveAffectedTestExecution,
  type AffectedTestPlan,
  type ResolvedAffectedTestExecution
} from './test-runner.ts';

export type LocalAffectedGateId =
  | 'imports:check'
  | 'typecheck'
  | 'docs:doctor'
  | 'test:affected';

export interface LocalAffectedGateStep {
  readonly id: LocalAffectedGateId;
  readonly command: string;
}

export interface LocalAffectedCheckPlan {
  readonly schema: 'sec-local-affected-check-plan-v1';
  readonly resolved: boolean;
  readonly changedPaths: string[];
  readonly affectedPlan: AffectedTestPlan;
  readonly gates: LocalAffectedGateStep[];
  readonly umbrellaCommand: 'bun run check:affected';
  readonly subsumedStandaloneCommands: string[];
}

interface LocalAffectedCheckExecutionOptions {
  readonly prepareCompilerDependencies?: () => Promise<OperationDependencyBootstrapResult>;
}

const TYPECHECK_AUTHORITY_PATHS = new Set([
  'bun.lock',
  'bunfig.toml',
  'package.json',
  'tsconfig.json'
]);

function hasTypeScriptInput(paths: readonly string[]): boolean {
  return paths.some((file) => /\.[cm]?tsx?$/u.test(file));
}

function hasTypecheckAuthorityInput(paths: readonly string[]): boolean {
  return paths.some((file) => (
    TYPECHECK_AUTHORITY_PATHS.has(file)
    || /^tsconfig(?:\.[^/]+)?\.json$/u.test(file)
  ));
}

function gate(id: LocalAffectedGateId): LocalAffectedGateStep {
  return { id, command: `bun run ${id}` };
}

export function buildLocalAffectedCheckPlan(
  affectedPlan: AffectedTestPlan
): LocalAffectedCheckPlan {
  const changedPaths = [...affectedPlan.changedPaths];
  const activeDocsChanged = changedPaths.some(isActiveDocumentationPath);
  const activeDocsOnly = changedPaths.length > 0
    && changedPaths.every(isActiveDocumentationPath);
  const typescriptChanged = hasTypeScriptInput(changedPaths);
  const typecheckRequired = typescriptChanged || hasTypecheckAuthorityInput(changedPaths);
  // Issue #206: include test:affected gate whenever fast tests are selected OR
  // the selection trust boundary is fail-closed (but only when ownership is
  // resolved — when ownership itself is unresolved, plan.resolved is false and
  // runLocalAffectedCheck short-circuits before executing any gate, so we keep
  // gates empty to match the "no invented broad fallback" contract).
  // Previously, an empty selectedFastTests silently skipped test:affected even
  // when the empty closure was caused by an unresolved selection — a
  // false-green. Now the gate runs and fails closed via runAffectedTestPlan.
  const failClosed = affectedPlan.resolved
    && isAffectedSelectionFailClosed(affectedPlan.selectionTrustBoundary);
  const testAffectedRequired = affectedPlan.selectedFastTests.length > 0 || failClosed;
  const gates = activeDocsOnly
    ? [gate('docs:doctor')]
    : [
      ...(typescriptChanged ? [gate('imports:check')] : []),
      ...(typecheckRequired ? [gate('typecheck')] : []),
      ...(activeDocsChanged ? [gate('docs:doctor')] : []),
      ...(testAffectedRequired ? [gate('test:affected')] : [])
    ];

  return {
    schema: 'sec-local-affected-check-plan-v1',
    resolved: affectedPlan.resolved,
    changedPaths,
    affectedPlan,
    gates,
    umbrellaCommand: 'bun run check:affected',
    subsumedStandaloneCommands: gates.map(({ command }) => command)
  };
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
    const { runTypecheck, runTypecheckWithDependencyRoot } = await import('./typecheck-runner.ts');
    return compilerDependencies
      ? runTypecheckWithDependencyRoot(compilerDependencies)
      : runTypecheck();
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
  options: LocalAffectedCheckExecutionOptions = {}
): Promise<number> {
  if (args.length > 0 && !(args.length === 1 && args[0] === '--plan')) {
    console.error('check:affected accepts only --plan.');
    return 1;
  }
  const affectedExecution = await resolveAffectedTestExecution({
    // This owner performs the explicit admission immediately before compiler
    // dependency preparation and before every gate. Plan output keeps the
    // resolution-time fence; execution avoids an otherwise redundant full
    // source census before its own adjacent fence.
    verifyAtResolution: args.length === 1
  });
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
  const compilerDependencies = compilerGateSelected
    ? await options.prepareCompilerDependencies!()
    : undefined;

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
