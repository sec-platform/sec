import path from 'node:path';

const TRANSACTION_NAME_PATTERN = /^[0-9a-f]{64}$/u;
const STAGING_PARENT_SEGMENTS = ['.sec', 'semantic-mutation', 'v1', 'transactions'] as const;

export function isSemanticMutationStagingWorkspace(workspaceRoot: string): boolean {
  const resolved = path.resolve(workspaceRoot);
  if (path.basename(resolved) !== 'workspace') return false;
  const transactionRoot = path.dirname(resolved);
  if (!TRANSACTION_NAME_PATTERN.test(path.basename(transactionRoot))) return false;
  let current = path.dirname(transactionRoot);
  for (const expected of [...STAGING_PARENT_SEGMENTS].reverse()) {
    if (path.basename(current) !== expected) return false;
    current = path.dirname(current);
  }
  return path.resolve(
    current,
    ...STAGING_PARENT_SEGMENTS,
    path.basename(transactionRoot),
    'workspace'
  ) === resolved;
}
