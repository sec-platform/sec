import { expect, test } from 'bun:test';

import { readCompilerTypeScriptMutationFixture } from '../helpers/compiler-fixtures.ts';

test('hosted integration routing remains zero-write and provider-neutral', async () => {
  const source = await readCompilerTypeScriptMutationFixture(
    'src/adapters/verification/platform/ci/runtime/verification-session-integration-routing.ts', 'tcb-analysis'
  );
  expect(source).not.toMatch(/node:(?:fs|child_process)|providers\/github-api|withGitHubApi|executeGitHubApiOperation/u);
  expect(source).not.toMatch(/writeFile|unlink|rename|spawn|Bun\.spawn|fetch\(/u);
  expect(source).not.toContain("from './verification-session-runtime.ts'");
  expect(source).toContain('routeHostedIntegration');
  expect(source).toContain('planHostedIntegrationEffects');
  const mergeProvider = await readCompilerTypeScriptMutationFixture(
    'src/adapters/verification/platform/ci/runtime/verification-session-merge-provider.ts', 'tcb-analysis'
  );
  expect(mergeProvider).toContain('withGitHubApiMergeWriteSession');
  expect(mergeProvider).toContain('executeGitHubApiOperation');
  expect(source).not.toContain('withGitHubApiMergeWriteSession');
});

test('dependency public contract is physically separate from effect runtime', async () => {
  const [contract, runtime] = await Promise.all([
    readCompilerTypeScriptMutationFixture('src/adapters/toolchain/dependencies/runtime/project-runtime-contract.ts', 'tcb-analysis'),
    readCompilerTypeScriptMutationFixture('src/adapters/toolchain/dependencies/runtime/project-runtime.ts', 'tcb-analysis')
  ]);
  expect(contract).not.toMatch(/node:(?:fs|child_process)|runBunInstall|withInstallLock|retireNoFollow|publishExclusive/u);
  expect(contract).toContain('RuntimeDependencyTargetIdentity');
  expect(contract).toContain('CompilerDependencyExecutionGenerationAuthority');
  expect(runtime).toContain("from './project-runtime-contract.ts'");
  expect(runtime).not.toContain('export interface RuntimeDepsStamp');
  expect(runtime).not.toContain('export interface DependencyAuthorityPaths');
  const ownedFileProvider = await readCompilerTypeScriptMutationFixture(
    'src/adapters/toolchain/dependencies/runtime/owned-file-provider.ts', 'tcb-analysis'
  );
  expect(ownedFileProvider).toContain('deleteRetainedNoFollowEntry');
  expect(contract).not.toContain('deleteRetainedNoFollowEntry');
});


test('dependency coordination owns lock, cutover and Runtime State lease without importing project runtime', async () => {
  const [coordination, runtime] = await Promise.all([
    readCompilerTypeScriptMutationFixture('src/adapters/toolchain/dependencies/runtime/dependency-coordination.ts', 'tcb-analysis'),
    readCompilerTypeScriptMutationFixture('src/adapters/toolchain/dependencies/runtime/project-runtime.ts', 'tcb-analysis')
  ]);
  expect(coordination).not.toContain("from './project-runtime.ts'");
  expect(coordination).toContain('withInstallLock');
  expect(coordination).toContain('resolveCompilerDependencyCoordinationRoots');
  expect(coordination).toContain('acquireRuntimeStatePhysicalAuthority');
  expect(coordination).toContain('withDependencyCoordinationLease');
  expect(runtime).toContain("from './dependency-coordination.ts'");
  expect(runtime).not.toContain('const INSTALL_LOCK_RECLAIM_SCHEMA');
  expect(runtime).not.toContain('const COMPILER_DEPENDENCY_COORDINATION_CUTOVER_SCHEMA');
  expect(runtime).not.toContain('async function reclaimOrphanInstallLock');
  expect(runtime).not.toContain('function resolveCompilerDependencyCoordinationRoots');
  expect(runtime).not.toContain('migrateRuntimeStateDirectoryGeneration');
});
