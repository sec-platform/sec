import path from 'node:path';

import { parseGitHubRepositoryIdentityFromRemoteUrl } from '../../system-architecture/foundation/contract/git-reference.ts';
import type { GitReadSession, GitReadSessionCommand } from './runtime/session.ts';

function commandText(command: GitReadSessionCommand, label: string): string {
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new Error(`GitHub repository binding ${label} observation failed.`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(command.result.stdout);
  } catch {
    throw new Error(`GitHub repository binding ${label} is not UTF-8.`);
  }
}

/** Binds one retained native Git read session to the GitHub repository named by
 * a provider capability. The caller's owner/name string is only the comparison
 * target; repository identity comes from this exact local repository's origin.
 */
export async function assertGitHubRepositoryBinding(
  session: GitReadSession,
  expectedRepository: string
): Promise<void> {
  if (parseGitHubRepositoryIdentityFromRemoteUrl(
    `https://github.com/${expectedRepository}.git`
  ) !== expectedRepository) {
    throw new Error('Expected GitHub repository identity is invalid.');
  }

  const layout = commandText(await session.run([
    'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'
  ]), 'local repository layout').trimEnd().split(/\r?\n/u);
  if (layout.length !== 2 || layout.some((entry) => entry.length === 0 || !path.isAbsolute(entry))) {
    throw new Error('GitHub repository binding local repository layout is invalid.');
  }
  const repositoryRoot = path.resolve(layout[0]!);
  const commonDirectory = path.resolve(layout[1]!);
  if (repositoryRoot !== path.resolve(session.cwd) || commonDirectory === repositoryRoot) {
    throw new Error('GitHub repository binding session root differs from the native repository root.');
  }

  const remoteUrl = commandText(
    await session.run(['remote', 'get-url', 'origin']),
    'origin remote'
  );
  const observedRepository = parseGitHubRepositoryIdentityFromRemoteUrl(remoteUrl);
  if (observedRepository !== expectedRepository) {
    throw new Error('Local origin remote differs from the authenticated GitHub repository.');
  }
}
