import { verificationSessionCli } from '../../../adapters/verification/platform/ci/runtime/verification-session.ts';
import { parseHostedVerificationCommand } from '../../../entry/verification-session-hosted-cli.ts';
import { worktreePhysicalCloseoutOperations } from '../../runtime-state/worktree-closeout.ts';
import { runHostedVerificationInvocation } from '../hosted-job-runtime.ts';
import { executeHostedSessionCompilerCommand } from './verification-session-hosted.ts';
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const result = command === 'prepare-integration-hosted' || command === 'integrate-hosted'
      || command === 'closeout-mutate-hosted' || command === 'closeout-publish-hosted'
    ? await runHostedVerificationInvocation(parseHostedVerificationCommand(argv))
    : command === 'observe-hosted' || command === 'prepare-hosted' || command === 'finalize-hosted'
      ? await executeHostedSessionCompilerCommand(argv)
      : await verificationSessionCli(argv, worktreePhysicalCloseoutOperations);
  process.stdout.write(`${result}\n`);
}
