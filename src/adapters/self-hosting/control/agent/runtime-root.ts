import path from 'node:path';

import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../providers/git-read/runtime/session.ts';

/** Locate this loaded control-plane owner through Git, never caller cwd or fixed parent hops. */
export async function resolveAgentRuntimeRepositoryRoot(): Promise<string> {
  return withAuthorityGitReadSession(
    { cwd: import.meta.dir, budget: GIT_READ_DEFAULT_OPERATION_BUDGET },
    async (session) => {
      const command = await session.run(['rev-parse', '--show-toplevel']);
      if (command.kind !== 'completed') {
        throw new GitReadAuthorityError('Agent runtime repository identity is unavailable.', command);
      }
      const recordFailure = session.consumeRecords(1);
      if (recordFailure !== null) {
        throw new GitReadAuthorityError('Agent runtime repository identity exceeded its record budget.', recordFailure);
      }
      if (command.result.code !== 0) throw new Error('Agent runtime repository identity could not be resolved.');
      const root = new TextDecoder('utf-8', { fatal: true }).decode(command.result.stdout).replace(/\r?\n$/u, '');
      if (!path.isAbsolute(root) || path.resolve(root) !== root || /[\0\r\n]/u.test(root)) {
        throw new Error('Agent runtime repository identity is not one canonical absolute path.');
      }
      return root;
    }
  );
}
