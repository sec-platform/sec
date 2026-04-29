import type { CommandHandler, CommandContext } from '../command-registry.ts';
import { parseLockArgs } from '../args.ts';
import { lockWorkspace } from '../../orchestrator.ts';
import { resolveWorkspaceLockPath } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { formatLockInspect } from '../formatters.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { LOCK_USAGE } from '../usage.ts';

export const lockCommand: CommandHandler = {
  name: 'lock',
  usage: LOCK_USAGE,
  async execute(args, ctx) {
    const lockArgs = parseLockArgs(args);
    if (lockArgs.mode === 'inspect') {
      const readableLockPath = await resolveWorkspaceLockPath(ctx.cwd);
      if (!(await pathExists(readableLockPath))) {
        throw new Error('Graph lock not found; run platform lock first');
      }
      const lock = await readJson<LockFile>(readableLockPath);
      if (lockArgs.json) {
        console.log(JSON.stringify(lock, null, lockArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatLockInspect(lock));
      return;
    }
    await lockWorkspace(ctx.cwd);
    console.log('Locked project');
  }
};
