import { inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import {
  currentSecRuntimePlatform,
  resolveSecRuntimeRoots,
  resolveSecRuntimeStateLayout,
  secRuntimeStateEnvironment,
  type SecRuntimeStateLayout
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

export function resolveSecWorkspaceRuntimeRoots(input: Readonly<{
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>) {
  return resolveSecRuntimeRoots({
    platform: currentSecRuntimePlatform(),
    environment: secRuntimeStateEnvironment(input.environment ?? process.env),
    repositoryRoot: input.repositoryRoot,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.repositoryRoot)
  });
}

export function resolveSecRuntimeStateForRepository(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): SecRuntimeStateLayout {
  return resolveSecRuntimeStateLayout({
    platform: currentSecRuntimePlatform(),
    environment: secRuntimeStateEnvironment(input.environment ?? process.env),
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.repositoryRoot)
  });
}
