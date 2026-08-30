import { runObservedCommand } from '../../runtime-state/physical/runtime/observed-process.ts';
import type { VerificationActionPlan } from '../../verification/action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget, type CiVerificationActionPlanClosure, type CiVerificationNormalizedOperation } from '../../verification/action/contract/ci.ts';

/**
 * Execute one producer-normalized Verification Action operation.
 *
 * This is the narrow physical executor consumed by CI and local SEC tooling.
 * The multi-command dev-runner CLI is deliberately not a library boundary:
 * importing it would pull its dynamic command-loading surface into the TCB.
 */
export async function executeVerifiedCiActionPlan(options: {
  readonly plan: VerificationActionPlan;
  readonly authorizedClosure: CiVerificationActionPlanClosure;
  readonly repositoryRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly executeNormalizedOperation?: (
    operation: CiVerificationNormalizedOperation
  ) => Promise<number> | number;
}): Promise<number> {
  const operation = resolveCiVerificationDevRunnerTarget(options);
  if (options.executeNormalizedOperation !== undefined) {
    return options.executeNormalizedOperation(operation);
  }
  const [, ...args] = ciVerificationNormalizedOperationArgv(operation);
  const outcome = await runObservedCommand(process.execPath, args, {
    cwd: options.repositoryRoot ?? process.cwd(),
    env: options.environment,
    envMode: options.environment === undefined ? 'inherit' : 'replace',
    stdio: 'inherit'
  });
  return outcome.status === 'exited' ? outcome.exitCode ?? 1 : 1;
}
