import path from 'node:path';

import { classifySemanticMutationTransactionRoot } from './state-layout.ts';

export function isSemanticMutationStagingWorkspace(workspaceRoot: string): boolean {
  const resolved = path.resolve(workspaceRoot);
  if (path.basename(resolved) !== 'workspace') return false;
  const transactionRoot = path.dirname(resolved);
  const location = classifySemanticMutationTransactionRoot(transactionRoot);
  return location !== null && path.join(location.transactionRoot, 'workspace') === resolved;
}
