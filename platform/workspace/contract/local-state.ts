import path from 'node:path';

export const localStateRelativePath = '.sec' as const;

export function resolveWorkspaceLocalStateRoot(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), localStateRelativePath);
}
