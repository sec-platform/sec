import path from 'node:path';
import { removeDir } from '../../../filesystem/files.ts';
import { getWorkspacePaths } from '../../../workspace-context.ts';

/** The native projection remover accepts only the established project pair. */
export async function removeDependencyProjectProjection(workspaceRoot: string): Promise<readonly string[]> {
  const root = getWorkspacePaths(path.resolve(workspaceRoot)).workspaceRoot;
  const targets = Object.freeze([path.join(root, 'node_modules'), path.join(root, '.runtime-deps.stamp.json')]);
  for (const target of targets) await removeDir(target);
  return targets;
}
