import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import {
  currentSecRuntimePlatformV1,
  resolveSecRuntimeRootsV1,
  resolveSecRuntimeStateLayoutV1,
  secRuntimeStateEnvironmentV1,
  type SecRuntimeStateLayoutV1
} from '../../platform/shared/sec-runtime-state-contract.ts';

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
    platform: currentSecRuntimePlatformV1(),
    environment: secRuntimeStateEnvironmentV1(input.environment ?? process.env),
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
    platform: currentSecRuntimePlatformV1(),
    environment: secRuntimeStateEnvironmentV1(input.environment ?? process.env),
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    workspacePhysicalIdentity: workspacePhysicalIdentity(input.repositoryRoot)
  });
}
