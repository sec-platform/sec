import { localStateRelativePath } from './contract/local-state.ts';
import { POLICY_SOURCE_PATHS } from './contract/policy-source-paths.ts';
import { modelRelativePath } from './contract/types.ts';

/** Canonical author-workspace logical path identities. These are values, not host resolution. */
export const workspaceConfigRelativePath = 'sec.yaml' as const;
export const srcRelativePath = 'src' as const;
export const testsRelativePath = 'tests' as const;
export const packageJsonRelativePath = 'package.json' as const;
export const tsconfigRelativePath = 'tsconfig.json' as const;
export const prismaRelativePath = 'prisma' as const;
export const secRelativePath = localStateRelativePath;
export const cacheRelativePath = `${secRelativePath}/cache` as const;
export const workspaceWriteLeaseRelativePath = `${secRelativePath}/workspace-write-lease` as const;
export const modelBlocksRelativePath = `${modelRelativePath}/blocks` as const;
export const privateRegistryRelativePath = `${modelBlocksRelativePath}/private` as const;
export const policiesRelativePath = POLICY_SOURCE_PATHS.project;
export const overridesRelativePath = `${modelRelativePath}/patches` as const;
