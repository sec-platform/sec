import { verificationSessionCli } from '../../../adapters/verification/platform/ci/runtime/verification-session.ts';
import { worktreePhysicalCloseoutOperations } from '../../runtime-state/worktree-closeout.ts';
if (import.meta.main) process.stdout.write(`${await verificationSessionCli(process.argv.slice(2), worktreePhysicalCloseoutOperations)}\n`);
