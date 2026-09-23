import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import type { ProcessResourceRunResult } from '../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import type { VerificationActionProcessExecutionContext } from '../../src/adapters/verification/platform/action/runner.ts';

/** Test-only physical child used to exercise the real retained process owner. */
export async function runRetainedBunTestProcess(
  context: VerificationActionProcessExecutionContext,
  workingDirectory: string,
  options: Readonly<{
    script?: string;
    maxStderrBytes?: number;
    maxStdoutBytes?: number;
  }> = {}
): Promise<ProcessResourceRunResult> {
  const executablePath = path.resolve(process.execPath);
  const executable = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(executablePath), 'Test executable parent'),
    path.basename(executablePath),
    undefined,
    'Test executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const cwd = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(workingDirectory, 'Test working directory'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'Test working directory'
  );
  try {
    return await context.session.run(issueRetainedCommandBoundary({
      executable,
      workingDirectory: cwd
    }), [
      '--no-env-file',
      '--eval',
      options.script ?? "process.stdout.write('verification-action')"
    ], {
      envMode: 'inherit',
      maxStderrBytes: options.maxStderrBytes ?? context.maxStderrBytes,
      maxStdoutBytes: options.maxStdoutBytes ?? context.maxStdoutBytes
    });
  } finally {
    cwd.dispose();
    executable.dispose();
  }
}
