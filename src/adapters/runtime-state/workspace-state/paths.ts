import { inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import {
  currentRuntimePlatform,
  resolveRuntimeRoots,
  resolveRuntimeStateLayout,
  runtimeStateEnvironment,
  type RuntimeStateEnvironment,
  type RuntimeStateLayout
} from './layout.ts';

function workspacePhysicalIdentity(repositoryRoot: string) {
  const identity = inspectNoFollowDirectoryChain(
    repositoryRoot,
    'SEC runtime workspace identity'
  ).target;
  return Object.freeze({
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

export function resolveWorkspaceRuntimeRoots(input: Readonly<{
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv | RuntimeStateEnvironment;
}>) {
  return resolveRuntimeRoots({
    platform: currentRuntimePlatform(),
    environment: runtimeStateEnvironment(input.environment ?? process.env),
    repositoryRoot: input.repositoryRoot,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.repositoryRoot)
  });
}

export function resolveRuntimeStateForRepository(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv | RuntimeStateEnvironment;
}>): RuntimeStateLayout {
  return resolveRuntimeStateLayout({
    platform: currentRuntimePlatform(),
    environment: runtimeStateEnvironment(input.environment ?? process.env),
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.repositoryRoot)
  });
}
