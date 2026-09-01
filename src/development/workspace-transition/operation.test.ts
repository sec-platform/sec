import { expect, mock, test } from 'bun:test';

import type { GitReadSession } from '../../external-capabilities/git-read/runtime/session.ts';
import type { ProcessResourceSession } from '../../runtime-state/physical/runtime/process-resource-session.ts';
import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
let activeSessions = 0;
let maximumActiveSessions = 0;
let dependencyReady = true;
let dependencyMaterializations = 0;
let hookObservation: 'ready' | 'materialization-required' = 'ready';
let hookMaterializations = 0;
let currentHead = HEAD;
let parentProcessSession: ProcessResourceSession | null = null;
let parentOperation: SecBoundSemanticOperation | null = null;

function completed(value: string) {
  return Object.freeze({
    kind: 'completed' as const,
    result: { code: 0, stdout: new TextEncoder().encode(`${value}\n`), stderr: '' }
  });
}

const session = Object.freeze({
  cwd: 'D:\\repo',
  providerIdentity: Object.freeze({ provider: 'test-production' }),
  workingDirectoryIdentity: Object.freeze({ root: 'D:\\repo' }),
  async run(args: readonly string[]) {
    if (args.includes('--show-object-format')) return completed('sha1');
    if (args.includes('HEAD^{tree}')) return completed(TREE);
    if (args.includes('--show-toplevel')) return completed('D:\\repo');
    if (args.includes('--absolute-git-dir')) return completed('D:\\repo\\.git');
    if (args.includes('--git-common-dir')) return completed('D:\\repo\\.git');
    return completed(currentHead);
  }
}) as unknown as GitReadSession;

mock.module('../../external-capabilities/git-read/authority.ts', () => ({
  async withAuthorityGitReadSession<T>(
    input: Readonly<{ operation?: SecBoundSemanticOperation; processSession?: ProcessResourceSession }>,
    callback: (value: GitReadSession) => Promise<T>
  ): Promise<T> {
    expect(input.operation).toBeDefined();
    expect(input.processSession).toBeDefined();
    parentOperation = input.operation!;
    parentProcessSession = input.processSession!;
    activeSessions += 1;
    maximumActiveSessions = Math.max(maximumActiveSessions, activeSessions);
    try {
      return await callback(session);
    } finally {
      activeSessions -= 1;
    }
  }
}));

mock.module('../../toolchain/dependencies/runtime.ts', () => ({
  async observeCompilerDependencyExecutionGenerationAuthority() {
    expect(activeSessions).toBe(1);
    return dependencyReady
      ? Object.freeze({ generationDigest: `sha256:${'2'.repeat(64)}` })
      : null;
  },
  async observeCompilerDependencyMaterializationInput() {
    return Object.freeze({ projection: `sha256:${'3'.repeat(64)}` });
  },
  async ensureCompilerDepsReady() {
    dependencyMaterializations += 1;
    throw new Error('unmigrated dependency Effect must not run');
  }
}));

mock.module('../hooks/install.ts', () => ({
  async observeManagedGitHooksWithSession() {
    return Object.freeze({
      disposition: hookObservation,
      observationDigest: `sha256:${'5'.repeat(64)}`
    });
  },
  async installGitHooksWithSession() {
    hookMaterializations += 1;
    throw new Error('unmigrated hook Effect must not run');
  }
}));

const { runWorkspaceTransitionOperation } = await import('./operation.ts');

function reset(): void {
  activeSessions = 0;
  maximumActiveSessions = 0;
  dependencyMaterializations = 0;
  hookMaterializations = 0;
  currentHead = HEAD;
  parentProcessSession = null;
  parentOperation = null;
  delete process.env.SEC_WORKSPACE_TRANSITION_DEADLINE_AT_UNIX_MS;
}

test('ready observations complete with zero materialization Effect and final readback', async () => {
  reset();
  dependencyReady = true;
  hookObservation = 'ready';
  const result = await runWorkspaceTransitionOperation({
    event: 'post-merge',
    arguments: ['0'],
    repositoryRoot: 'D:\\repo',
    async handoff() {
      throw new Error('ready transition must not hand off');
    }
  });
  expect(result).toBe(0);
  expect(dependencyMaterializations).toBe(0);
  expect(hookMaterializations).toBe(0);
  expect(maximumActiveSessions).toBe(1);
  expect(activeSessions).toBe(0);
  expect(parentProcessSession?.signal.aborted).toBe(true);
  expect(parentProcessSession?.operationIdentityDigest)
    .toBe(parentOperation?.plan.identity.identityDigest);
});

test('unmigrated dependency Effect is blocked before materialization or handoff', async () => {
  reset();
  dependencyReady = false;
  hookObservation = 'materialization-required';
  const standardInput = new TextEncoder().encode(`${HEAD} ${HEAD}\n`);
  await expect(runWorkspaceTransitionOperation({
    event: 'post-rewrite', arguments: ['amend'], standardInput, repositoryRoot: 'D:\\repo',
    async handoff() { throw new Error('unmigrated handoff must not run'); }
  })).rejects.toHaveProperty('code', 'workspace-transition-provider-integration-unavailable');
  expect(dependencyMaterializations).toBe(0);
  expect(hookMaterializations).toBe(0);
  expect(maximumActiveSessions).toBe(1);
  expect(activeSessions).toBe(0);
  expect(parentProcessSession?.signal.aborted).toBe(true);
});

test('unmigrated hook Effect is blocked before a child can start', async () => {
  reset();
  dependencyReady = true;
  hookObservation = 'materialization-required';
  await expect(runWorkspaceTransitionOperation({
    event: 'post-merge',
    arguments: ['0'],
    repositoryRoot: 'D:\\repo',
    async handoff() {
      throw new Error('dependency-ready transition must not hand off');
    }
  })).rejects.toHaveProperty('code', 'workspace-transition-provider-integration-unavailable');
  expect(hookMaterializations).toBe(0);
  expect(parentProcessSession?.signal.aborted).toBe(true);
});

test('caller cancellation blocks before any provider session', async () => {
  reset();
  const abort = new AbortController();
  abort.abort();
  try {
    await runWorkspaceTransitionOperation({
      event: 'post-merge',
      arguments: ['0'],
      repositoryRoot: 'D:\\repo',
      signal: abort.signal,
      async handoff() {
        throw new Error('cancelled transition must not hand off');
      }
    });
    throw new Error('expected cancellation rejection');
  } catch (error) {
    expect(error).toHaveProperty('code', 'workspace-transition-operation-budget-exhausted');
  }
  expect(activeSessions).toBe(0);
});

test('an exhausted inherited deadline blocks before any provider session', async () => {
  reset();
  process.env.SEC_WORKSPACE_TRANSITION_DEADLINE_AT_UNIX_MS = String(Date.now() - 1);
  try {
    await runWorkspaceTransitionOperation({
      event: 'post-merge',
      arguments: ['0'],
      repositoryRoot: 'D:\\repo',
      async handoff() {
        throw new Error('expired transition must not hand off');
      }
    });
    throw new Error('expected deadline rejection');
  } catch (error) {
    expect(error).toHaveProperty('code', 'workspace-transition-operation-budget-exhausted');
  }
  expect(activeSessions).toBe(0);
});
