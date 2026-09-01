import { expect, mock, test } from 'bun:test';

import type { GitReadSession } from '../../external-capabilities/git-read/runtime/session.ts';

const HEAD = '1'.repeat(40);
let activeSessions = 0;
let maximumActiveSessions = 0;
let dependencyReady = true;
let dependencyMaterializations = 0;
let hookObservation: 'ready' | 'materialization-required' = 'ready';
let hookMaterializations = 0;

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
    return completed(args.includes('--show-object-format') ? 'sha1' : HEAD);
  }
}) as unknown as GitReadSession;

mock.module('../../external-capabilities/git-read/authority.ts', () => ({
  async withAuthorityGitReadSession<T>(
    _input: unknown,
    callback: (value: GitReadSession) => Promise<T>
  ): Promise<T> {
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
    expect(activeSessions).toBe(0);
    return dependencyReady ? Object.freeze({ generationDigest: `sha256:${'2'.repeat(64)}` }) : null;
  },
  async observeCompilerDependencyMaterializationInput() {
    return Object.freeze({ projection: `sha256:${'3'.repeat(64)}` });
  },
  async ensureCompilerDepsReady() {
    expect(activeSessions).toBe(0);
    dependencyMaterializations += 1;
    dependencyReady = true;
    return Object.freeze({
      executionGenerationAuthority: Object.freeze({ generationDigest: `sha256:${'2'.repeat(64)}` }),
      manifestHash: 'manifest',
      nodeModulesPath: 'D:\\repo\\node_modules',
      packageManager: 'bun' as const,
      requiresFreshProcess: true,
      root: 'D:\\repo',
      source: 'installed' as const,
      transitionDigest: `sha256:${'4'.repeat(64)}` as const
    });
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
    hookObservation = 'ready';
    return Object.freeze({ status: 'managed' as const, message: 'ready' });
  }
}));

const { runWorkspaceTransitionOperation } = await import('./operation.ts');

function reset(): void {
  activeSessions = 0;
  maximumActiveSessions = 0;
  dependencyMaterializations = 0;
  hookMaterializations = 0;
  delete process.env.SEC_WORKSPACE_TRANSITION_DEADLINE_AT_UNIX_MS;
}

test('ready observations complete with zero materialization Effect', async () => {
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
});

test('dependency materialization and handoff run after the observation session closes', async () => {
  reset();
  dependencyReady = false;
  hookObservation = 'materialization-required';
  const standardInput = new TextEncoder().encode(`${HEAD} ${HEAD}\n`);
  const result = await runWorkspaceTransitionOperation({
    event: 'post-rewrite',
    arguments: ['amend'],
    standardInput,
    repositoryRoot: 'D:\\repo',
    async handoff(_dependencies, forwardedInput, deadlineAtUnixMs) {
      expect(activeSessions).toBe(0);
      expect(forwardedInput).toEqual(standardInput);
      expect(deadlineAtUnixMs).toBeGreaterThan(Date.now());
      return 23;
    }
  });
  expect(result).toBe(23);
  expect(dependencyMaterializations).toBe(1);
  expect(hookMaterializations).toBe(0);
  expect(maximumActiveSessions).toBe(1);
  expect(activeSessions).toBe(0);
});
