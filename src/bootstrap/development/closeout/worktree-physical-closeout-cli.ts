import { runWorktreePhysicalCloseoutCli } from '../../../adapters/self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { worktreePhysicalCloseoutOperations } from '../../runtime-state/worktree-closeout.ts';
if (import.meta.main) await runWorktreePhysicalCloseoutCli(worktreePhysicalCloseoutOperations);
