import path from 'node:path';

import { compilerRoot } from "../../adapters/workspace-context.ts";

export const referenceWorkspaceRelativePath = 'examples/reference-workspace' as const;

export const referenceWorkspaceRoot = path.join(
  compilerRoot,
  ...referenceWorkspaceRelativePath.split('/')
);
