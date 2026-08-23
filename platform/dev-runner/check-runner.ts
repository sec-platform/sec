import path from 'node:path';

import { CodexDevelopmentIsActiveDocumentationPathV1 } from '../shared/active-documentation-contract.ts';
import { isAffectedSelectionFailClosed } from '../shared/affected-test-inventory.ts';
import type { OperationDependencyBootstrapResult } from './dependency-bootstrap.ts';
import {
  type AffectedTestPlanV1,
  type ResolvedAffectedTestExecutionV1,
  resolveAffectedTestExecution
} from './test-runner.ts';

export type LocalAffectedGateId =
  | 'imports:check'
  | 'typecheck'
  | 'docs:doctor'
  | 'test:affected';

export interface LocalAffectedGateStepV1 {
  readonly id: LocalAffectedGateId;
  readonly command: string;
}

export interface LocalAffectedCheckPlanV1 {
  readonly schema: 'sec-local-affected-check-plan-v1';
  readonly resolved: boolean;
  readonly changedPaths: string[];
  readonly affectedPlan: AffectedTestPlanV1;
  readonly gates: LocalAffectedGateStepV1[];
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

function gate(id: LocalAffectedGateId): LocalAffectedGateStepV1 {
  return { id, command: `bun run ${id}` };
}

export function buildLocalAffectedCheckPlan(
  affectedPlan: AffectedTestPlanV1
): LocalAffectedCheckPlanV1 {
  const changedPaths = [...affectedPlan.changedPaths];
  const activeDocsChanged = changedPaths.some(CodexDevelopmentIsActiveDocumentationPathV1);
  const activeDocsOnly = changedPaths.length > 0
    && changedPaths.every(CodexDevelopmentIsActiveDocumentationPathV1);
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
  step: LocalAffectedGateStepV1,
  affectedExecution: ResolvedAffectedTestExecutionV1,
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
    const { runTypecheck, runTypecheckWithBinPath } = await import('./typecheck-runner.ts');
    return compilerDependencies
      ? runTypecheckWithBinPath(path.join(compilerDependencies.nodeModulesPath, '.bin'))
      : runTypecheck();
  }
  if (step.id === 'docs:doctor') {
    const { runDevCommand } = await import('./command-runner.ts');
    return runDevCommand('bun', ['docs/scripts/docs-doctor.ts'], {});
  }

  const { withHeavyVerificationGateLease } = await import('../shared/heavy-verification-gate-lease.ts');
  return withHeavyVerificationGateLease(
    'test:affected',
    () => affectedExecution.run(compilerDependencies)
  );
}

export async function runLocalAffectedCheck(
  args: string[] = [],
  options: LocalAffectedCheckExecutionOptions = {}
): Promise<number> {
  if (args.length > 0 && !(args.length === 1 && args[0] === '--plan')) {
    console.error('check:affected accepts only --plan.');
    return 1;
  }
  const affectedExecution = await resolveAffectedTestExecution();
  if (!affectedExecution) {
    console.error('Failed to detect affected test files.');
    return 1;
  }
  const affectedPlan = affectedExecution.plan;
  const plan = buildLocalAffectedCheckPlan(affectedPlan);
  if (args.length === 1) {
    console.log(JSON.stringify(plan, null, 2));
    return plan.resolved ? 0 : 1;
  }
  if (!plan.resolved) {
    console.error(
      `Local affected check ownership is unresolved for changed paths: ${affectedPlan.unresolvedPaths.join(', ')}`
    );
    return 1;
  }
  if (plan.gates.length === 0) {
    console.log('No local affected gates selected.');
    return 0;
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
  const { runTypecheckWithBinPath } = await import('./typecheck-runner.ts');
  const typecheck = () => runTypecheckWithBinPath(
    path.join(compilerDependencies.nodeModulesPath, '.bin')
  );

  const [docsCode, typecheckCode] = await Promise.all([
    runDevCommand('bun', ['docs/scripts/docs-doctor.ts'], {}),
    typecheck()
  ]);
  if (docsCode !== 0) return docsCode;
  if (typecheckCode !== 0) return typecheckCode;

  const { withHeavyVerificationGateLease } = await import('../shared/heavy-verification-gate-lease.ts');
  const { runFastTests } = await import('./test-runner.ts');
  return withHeavyVerificationGateLease('test:fast', () => runFastTests([], compilerDependencies), {
    namespace: 'test:fast',
    waitTimeoutMs: 5000
  });
}
