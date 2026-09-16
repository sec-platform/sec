import path from 'node:path';

import { compilerRoot } from '../workspace/runtime/paths.ts';

export const referenceWorkspaceRelativePath = 'examples/reference-workspace' as const;

export const referenceWorkspaceRoot = path.join(
  compilerRoot,
  ...referenceWorkspaceRelativePath.split('/')
);
