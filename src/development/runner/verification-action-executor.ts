import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { ProcessResourceRunResult } from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary
} from '../../runtime-state/physical/runtime/process.ts';
import type { VerificationActionPlan } from '../../verification/action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget, type CiVerificationActionPlanClosure } from '../../verification/action/contract/ci.ts';
import type { VerificationActionProcessExecutionContext } from '../../verification/action/runner.ts';

/**
 * Execute one producer-normalized local Verification Action through the
 * already-bound physical process session. This adapter owns no fallback,
 * injectable command provider, budget, deadline, or terminal authority.
 */
export async function executeVerifiedCiActionPlan(options: Readonly<{
  readonly plan: VerificationActionPlan;
  readonly authorizedClosure: CiVerificationActionPlanClosure;
  readonly repositoryRoot: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly process: VerificationActionProcessExecutionContext;
}>): Promise<ProcessResourceRunResult> {
  const operation = resolveCiVerificationDevRunnerTarget(options);
  const [runtime, ...args] = ciVerificationNormalizedOperationArgv(operation);
  if (runtime !== 'bun') {
    throw new Error('Verification Action physical executor accepts only the canonical Bun runtime.');
  }
  const repositoryRoot = path.resolve(options.repositoryRoot);
  if (repositoryRoot !== options.repositoryRoot) {
    throw new Error('Verification Action repository root must be canonical.');
  }
  const executablePath = path.resolve(process.execPath);
  const executable = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(
      path.dirname(executablePath),
      'Verification Action executable parent'
    ),
    path.basename(executablePath),
    undefined,
    'Verification Action executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(
      repositoryRoot,
      'Verification Action working directory'
    ),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'Verification Action working directory'
  );
  try {
    return await options.process.session.run(issueRetainedCommandBoundary({
      executable,
      workingDirectory
    }), args, {
      env: options.environment,
      envMode: options.environment === undefined ? 'inherit' : 'replace',
      maxStderrBytes: options.process.maxStderrBytes,
      maxStdoutBytes: options.process.maxStdoutBytes
    });
  } finally {
    workingDirectory.dispose();
    executable.dispose();
  }
}
