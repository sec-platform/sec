import {
  ciVerificationNormalizedOperationArgvV2,
  resolveCiVerificationDevRunnerTargetV1,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationNormalizedOperationV2
} from '../shared/verification-action-ci-contract.ts';
import type { VerificationActionPlanV2 } from '../shared/verification-action-contract.ts';

/**
 * Execute one producer-normalized Verification Action operation.
 *
 * This is the narrow physical executor consumed by CI and local SEC tooling.
 * The multi-command dev-runner CLI is deliberately not a library boundary:
 * importing it would pull its dynamic command-loading surface into the TCB.
 */
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
  const child = Bun.spawn(argv, {
    cwd: options.repositoryRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: options.environment ?? process.env
  });
  return child.exited;
}
