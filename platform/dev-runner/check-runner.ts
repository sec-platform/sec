import path from 'node:path';

import { CodexDevelopmentIsActiveDocumentationPathV1 } from '../shared/active-documentation-contract.ts';
import {
  type AffectedTestPlanV1,
  type ResolvedAffectedTestExecutionV1,
  resolveAffectedTestExecution
} from './test-runner.ts';

export type LocalAffectedGateId =
  | 'imports:prepare'
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
  readonly prepareCompilerNodeModulesPath?: () => Promise<string>;
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
  const gates = activeDocsOnly
    ? [gate('docs:doctor')]
    : [
      ...(typescriptChanged ? [gate('imports:prepare')] : []),
      ...(typecheckRequired ? [gate('typecheck')] : []),
      ...(activeDocsChanged ? [gate('docs:doctor')] : []),
      ...(affectedPlan.selectedFastTests.length > 0 ? [gate('test:affected')] : [])
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
  compilerNodeModulesPath: string | undefined
): Promise<number> {
  if (step.id === 'imports:prepare') {
    const { runImportPreparation } = await import('./import-organizer.ts');
    return runImportPreparation();
  }
  if (step.id === 'typecheck') {
    const { runTypecheck, runTypecheckWithBinPath } = await import('./typecheck-runner.ts');
    return compilerNodeModulesPath
      ? runTypecheckWithBinPath(path.join(compilerNodeModulesPath, '.bin'))
      : runTypecheck();
  }
  if (step.id === 'docs:doctor') {
    const { runDevCommand } = await import('./command-runner.ts');
    return runDevCommand('bun', ['docs/scripts/docs-doctor.ts'], {});
  }

  const { withHeavyVerificationGateLease } = await import('../shared/heavy-verification-gate-lease.ts');
  return withHeavyVerificationGateLease(
    'test:affected',
    affectedExecution.run
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
    id === 'imports:prepare' || id === 'typecheck'
  ));
  if (compilerGateSelected && !options.prepareCompilerNodeModulesPath) {
    console.error('Local affected compiler Gates require the canonical dependency preparation capability.');
    return 1;
  }
  const compilerNodeModulesPath = compilerGateSelected
    ? await options.prepareCompilerNodeModulesPath!()
    : undefined;

  console.log(`Running local affected Gate union once: ${plan.gates.map(({ id }) => id).join(' -> ')}`);
  for (const step of plan.gates) {
    const code = await executeLocalAffectedGate(step, affectedExecution, compilerNodeModulesPath);
    if (code !== 0) return code;
  }
  return 0;
}

interface FastCheckExecutionOptions {
  readonly prepareCompilerNodeModulesPath?: () => Promise<string>;
}

export async function runFastCheck(options: FastCheckExecutionOptions = {}): Promise<number> {
  if (!options.prepareCompilerNodeModulesPath) {
    console.error('Fast check requires the canonical dependency preparation capability.');
    return 1;
  }

  const compilerNodeModulesPath = await options.prepareCompilerNodeModulesPath();

  console.log('Running fast check: imports:prepare + docs:doctor (parallel) -> typecheck -> test:fast');

  const { runImportPreparation } = await import('./import-organizer.ts');
  const { runDevCommand } = await import('./command-runner.ts');

  const [importsCode, docsCode] = await Promise.all([
    runImportPreparation(),
    runDevCommand('bun', ['docs/scripts/docs-doctor.ts'], {})
  ]);
  if (importsCode !== 0) return importsCode;
  if (docsCode !== 0) return docsCode;

  const { runTypecheck, runTypecheckWithBinPath } = await import('./typecheck-runner.ts');
  const typecheckCode = compilerNodeModulesPath
    ? await runTypecheckWithBinPath(path.join(compilerNodeModulesPath, '.bin'))
    : await runTypecheck();
  if (typecheckCode !== 0) return typecheckCode;

  const { withHeavyVerificationGateLease } = await import('../shared/heavy-verification-gate-lease.ts');
  const { runFastTests } = await import('./test-runner.ts');
  return withHeavyVerificationGateLease('test:fast', () => runFastTests());
}
