import { expect, mock, test } from 'bun:test';

import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import type { GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import type { ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
let observationFailure: { reason: unknown } | undefined;
let beforeObservation: (() => void) | undefined;
let activeSessions = 0;
let maximumActiveSessions = 0;
let dependencyReady = true;
let dependencyMaterializations = 0;
let hookObservation: 'ready' | 'materialization-required' = 'ready';
let hookMaterializations = 0;
let currentHead = HEAD;
let parentProcessSession: ProcessResourceSession | null = null;
let parentOperation: BoundSemanticOperation | null = null;

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

mock.module('../../../providers/git-read/authority.ts', () => ({
  async withAuthorityGitReadSession<T>(
    input: Readonly<{ operation?: BoundSemanticOperation; processSession?: ProcessResourceSession }>,
    callback: (value: GitReadSession) => Promise<T>
  ): Promise<T> {
    expect(input.operation).toBeDefined();
    expect(input.processSession).toBeDefined();
    parentOperation = input.operation!;
    parentProcessSession = input.processSession!;
    activeSessions += 1;
    maximumActiveSessions = Math.max(maximumActiveSessions, activeSessions);
    try {
      beforeObservation?.();
      if (observationFailure !== undefined) throw observationFailure.reason;
      return await callback(session);
    } finally {
      activeSessions -= 1;
    }
  }
}));

mock.module('../../../toolchain/dependencies/runtime.ts', () => ({
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
  async installGitHooksWithSession(input: Readonly<{
    operation: BoundSemanticOperation;
    processSession: ProcessResourceSession;
  }>) {
    expect(input.operation === parentOperation).toBe(true);
    expect(input.processSession === parentProcessSession).toBe(true);
    expect(activeSessions).toBe(1);
    hookMaterializations += 1;
    hookObservation = 'ready';
    return Object.freeze({ status: 'installed' as const, message: 'installed' });
  }
}));

const { runWorkspaceTransitionOperation } = await import('./operation.ts');

function reset(): void {
  observationFailure = undefined;
  beforeObservation = undefined;
  activeSessions = 0;
  maximumActiveSessions = 0;
  dependencyMaterializations = 0;
  hookMaterializations = 0;
  currentHead = HEAD;
  parentProcessSession = null;
  parentOperation = null;
  dependencyReady = true;
  hookObservation = 'ready';
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

test('path checkout does not admit dependency or hook installation', async () => {
  reset();
  dependencyReady = false;
  hookObservation = 'materialization-required';
  await expect(runWorkspaceTransitionOperation({
    event: 'post-checkout',
    arguments: [HEAD, HEAD, '0'],
    repositoryRoot: 'D:\\repo',
    async handoff() { throw new Error('path checkout must not hand off'); }
  })).resolves.toBe(0);
  expect(dependencyMaterializations).toBe(0);
  expect(hookMaterializations).toBe(0);
  expect(activeSessions).toBe(0);
  expect(parentProcessSession?.signal.aborted).toBe(true);
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

test('hook materialization adopts the exact parent operation and process session', async () => {
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
  })).resolves.toBe(0);
  expect(hookMaterializations).toBe(1);
  expect(maximumActiveSessions).toBe(1);
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

test('the operation and trigger retain the same parameters across observation', async () => {
  reset();
  const args = ['0'];
  const input = {
    event: 'post-merge' as const, arguments: args, repositoryRoot: 'D:\\repo',
    async handoff() { throw new Error('handoff must not run'); }
  };
  beforeObservation = () => { args[0] = 'not-a-merge-flag'; input.repositoryRoot = 'D:\\other'; };
  await expect(runWorkspaceTransitionOperation(input)).resolves.toBe(0);
  expect(activeSessions).toBe(0);
});

test('captured rewrite bytes cannot be replaced while acquiring observations', async () => {
  reset();
  const bytes = new TextEncoder().encode(`${HEAD} ${HEAD}\n`);
  beforeObservation = () => { bytes.fill(0); };
  await expect(runWorkspaceTransitionOperation({
    event: 'post-rewrite', arguments: ['amend'], standardInput: bytes,
    repositoryRoot: 'D:\\repo', async handoff() { throw new Error('handoff must not run'); }
  })).resolves.toBe(0);
});

test('undefined observation failures survive process-session closeout', async () => {
  reset();
  observationFailure = { reason: undefined };
  let rejected = false;
  try {
    await runWorkspaceTransitionOperation({
      event: 'post-merge', arguments: ['0'], repositoryRoot: 'D:\\repo',
      async handoff() { throw new Error('handoff must not run'); }
    });
  } catch (error) { rejected = true; expect(error).toBeUndefined(); }
  expect(rejected).toBe(true);
  expect(activeSessions).toBe(0);
});

test('argument accessors are refused without invocation or resource acquisition', async () => {
  reset();
  let reads = 0;
  const args = new Array<string>(1);
  Object.defineProperty(args, 0, { get() { reads++; return '0'; } });
  await expect(runWorkspaceTransitionOperation({
    event: 'post-merge', arguments: args, repositoryRoot: 'D:\\repo',
    async handoff() { throw new Error('handoff must not run'); }
  })).rejects.toHaveProperty('code', 'workspace-transition-argument-invalid');
  expect(reads).toBe(0);
  expect(parentProcessSession).toBeNull();
});

test('unsupported events never enter the fallback rewrite branch or acquire a session', async () => {
  reset();
  await expect(runWorkspaceTransitionOperation({
    event: 'unsupported' as 'post-rewrite', arguments: ['amend'],
    standardInput: new TextEncoder().encode(`${HEAD} ${HEAD}\n`),
    repositoryRoot: 'D:\\repo', async handoff() { throw new Error('handoff must not run'); }
  })).rejects.toHaveProperty('code', 'workspace-transition-argument-invalid');
  expect(parentProcessSession).toBeNull();
});

test('an unused handoff callback is not evaluated as part of operation identity', async () => {
  reset();
  await expect(runWorkspaceTransitionOperation({
    event: 'post-merge', arguments: ['0'], repositoryRoot: 'D:\\repo',
    get handoff(): never { throw new Error('unused handoff must not be read'); }
  })).resolves.toBe(0);
});

test('stream collection copies each chunk before the producer can reuse it', async () => {
  reset();
  const bytes = new TextEncoder().encode(`${HEAD} ${HEAD}\n`);
  let supplied = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!supplied) { supplied = true; controller.enqueue(bytes); }
      else { bytes.fill(0); controller.close(); }
    }
  }, { highWaterMark: 0 });
  await expect(runWorkspaceTransitionOperation({
    event: 'post-rewrite', arguments: ['amend'], standardInputStream: stream,
    repositoryRoot: 'D:\\repo', async handoff() { throw new Error('handoff must not run'); }
  })).resolves.toBe(0);
  expect(stream.locked).toBe(false);
});

test('oversized stream input is cancelled and unlocked before any provider session', async () => {
  reset();
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancellations++; }
  });
  await expect(runWorkspaceTransitionOperation({
    event: 'post-rewrite', arguments: ['amend'], standardInputStream: stream,
    repositoryRoot: 'D:\\repo', async handoff() { throw new Error('handoff must not run'); }
  })).rejects.toHaveProperty('code', 'workspace-transition-rewrite-input-limit-exceeded');
  expect(cancellations).toBe(1);
  expect(stream.locked).toBe(false);
  expect(parentProcessSession).toBeNull();
});

test('stream byte budget is cumulative across chunks rather than reset per read', async () => {
  reset();
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancellations++; }
  });
  await expect(runWorkspaceTransitionOperation({
    event: 'post-rewrite', arguments: ['amend'], standardInputStream: stream,
    repositoryRoot: 'D:\\repo', async handoff() { throw new Error('handoff must not run'); }
  })).rejects.toHaveProperty('code', 'workspace-transition-rewrite-input-limit-exceeded');
  expect(cancellations).toBe(1);
  expect(stream.locked).toBe(false);
  expect(parentProcessSession).toBeNull();
});

test('stream cancellation joins closeout and never starts provider observation', async () => {
  reset();
  const abort = new AbortController();
  const reason = new Error('cancel input');
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull() { abort.abort(reason); },
    cancel() { cancellations++; }
  }, { highWaterMark: 0 });
  await expect(runWorkspaceTransitionOperation({
    event: 'post-rewrite', arguments: ['amend'], standardInputStream: stream,
    signal: abort.signal, repositoryRoot: 'D:\\repo',
    async handoff() { throw new Error('handoff must not run'); }
  })).rejects.toBe(reason);
  expect(cancellations).toBe(1);
  expect(stream.locked).toBe(false);
  expect(parentProcessSession).toBeNull();
});
