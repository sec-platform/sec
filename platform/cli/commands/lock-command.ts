import { lockWorkspace } from '../../orchestrator.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { resolveWorkspaceLockPath } from '../../shared/paths.ts';
import { parseLockArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import { readRequiredJson } from '../command-utils.ts';
import { printJsonOrText } from '../format-utils.ts';
import { formatLockInspect } from '../formatters.ts';
import { LOCK_USAGE } from '../usage.ts';

export const lockCommand: CommandHandler = {
  name: 'lock',
  usage: LOCK_USAGE,
  async execute(args, ctx) {
    const lockArgs = parseLockArgs(args);
    if (lockArgs.mode === 'inspect') {
      const readableLockPath = await resolveWorkspaceLockPath(ctx.cwd);
      const lock = await readRequiredJson<LockFile>(readableLockPath, 'Graph lock not found; run platform lock first');
      printJsonOrText(lock, lockArgs, formatLockInspect);
      return;
    }
    await lockWorkspace(ctx.cwd);
    console.log('Locked project');
  }
};
