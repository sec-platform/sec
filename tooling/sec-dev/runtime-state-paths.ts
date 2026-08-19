import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import {
  resolveSecRuntimeRootsV1,
  resolveSecRuntimeStateLayoutV1,
  type SecRuntimePlatformV1,
  type SecRuntimeStateEnvironmentV1,
  type SecRuntimeStateLayoutV1
} from '../../platform/shared/sec-runtime-state-contract.ts';

function runtimePlatform(): SecRuntimePlatformV1 {
  if (process.platform !== 'win32' && process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new Error(`SEC runtime state does not support platform ${process.platform}.`);
  }
  return process.platform;
}

function runtimeEnvironment(source: NodeJS.ProcessEnv): SecRuntimeStateEnvironmentV1 {
  const result: Record<string, string> = {};
  for (const name of [
    'SEC_STATE_HOME', 'SEC_CACHE_HOME', 'LOCALAPPDATA',
    'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'HOME'
  ]) {
    const value = source[name];
    if (typeof value === 'string' && value.length > 0) result[name] = value;
  }
  return Object.freeze(result as SecRuntimeStateEnvironmentV1);
}

function workspacePhysicalIdentity(repositoryRoot: string) {
  const identity = inspectNoFollowDirectoryChainV1(
    repositoryRoot,
    'SEC runtime workspace identity'
  ).target;
  return Object.freeze({
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

export function resolveSecWorkspaceRuntimeRootsV1(input: Readonly<{
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>) {
  return resolveSecRuntimeRootsV1({
    platform: runtimePlatform(),
    environment: runtimeEnvironment(input.environment ?? process.env),
    repositoryRoot: input.repositoryRoot,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.repositoryRoot)
  });
}

export function resolveSecRuntimeStateForRepositoryV1(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): SecRuntimeStateLayoutV1 {
  return resolveSecRuntimeStateLayoutV1({
    platform: runtimePlatform(),
    environment: runtimeEnvironment(input.environment ?? process.env),
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.repositoryRoot)
  });
}
