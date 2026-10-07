import { expect, test } from 'bun:test';
import { composeWorkspaceResult } from '../../src/application/compose-workspace.ts';
import { executePipelineStageLifecycle } from '../../src/application/pipeline-stage-lifecycle.ts';
import {
  executeProjectComposition,
  type ProjectCompositionOperations
} from '../../src/application/project-composition.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { SUPPORTED_STACK, type PlanFile } from '../../src/compiler/contract.ts';
import type { PipelineSemanticContext } from '../../src/compiler/pipeline/semantic-context.ts';
import { buildOfficialCopyInstallStep, buildOfficialResolvedBlock } from '../helpers/lock-fixtures.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { ticketSemanticGeneratorTask } from '../testkit/semantic.ts';

const order = [
  'checkWriteBoundary', 'ensureBase', 'install', 'mergePrisma', 'installOpaque',
  'prepareArtifactDirectories', 'publishBlockUsage', 'lowerSemantic', 'generateRuntime',
  'format', 'applyOverrides', 'publishInstallManifest', 'readOverrideTargets',
  'publishBaseline', 'persistLock'
] as const;
// This unit observes forwarding to the lowering capability, not IR admission.
// Production semantic admission remains with the existing pipeline owner.
const semantic = Object.freeze({ transactionId: 'opaque-to-composition' }) as PipelineSemanticContext;

function fixture(onStep?: (name: typeof order[number], args: unknown[]) => void) {
  const lock = buildReviewLock({
    installPlan: [buildOfficialCopyInstallStep({ stepId: 'install-ticket', blockId: 'ticket/basic', sourceRoot: 'src', from: 'ticket.ts', to: 'src/ticket.ts' })],
    resolvedBlocks: [buildOfficialResolvedBlock({ id: 'ticket/basic', installOrder: 2 })],
    generatedPaths: ['retained.ts'],
    passStatus: { compose: 'pending' }
  });
  const task = ticketSemanticGeneratorTask();
  const calls: Array<{ name: typeof order[number]; args: unknown[] }> = [];
  const results: Partial<Record<typeof order[number], unknown>> = {
    installOpaque: ['opaque.ts'],
    lowerSemantic: { tasks: [task], generatedPaths: ['semantic.ts'] },
    generateRuntime: ['runtime.ts'],
    readOverrideTargets: ['override.ts']
  };
  const operations = Object.fromEntries(order.map(name => [name, function(this: unknown, ...args: unknown[]) {
    expect(this).toBe(operations);
    calls.push({ name, args });
    onStep?.(name, args);
    return results[name];
  }])) as unknown as ProjectCompositionOperations;
  return { lock, task, calls, operations };
}

const options = { opaqueModuleMaterializationMode: 'build-copy' as const };

test('composition owns generation through baseline and lock publication using one captured install plan', async () => {
  const f = fixture(name => {
    if (name === 'checkWriteBoundary') {
      f.lock.installPlan[0]!.to = 'changed-by-provider.ts';
      f.lock.installPlan = [];
      f.operations.persistLock = () => { throw new Error('late replacement must not run'); };
    }
  });
  const originalStep = { ...f.lock.installPlan[0]! };
  const controller = new AbortController();
  const result = await executeProjectComposition(f.lock, semantic, { ...options, signal: controller.signal }, f.operations);
  expect(result).toBe(f.lock);
  expect(f.calls.map(call => call.name)).toEqual([...order]);
  const args = (name: typeof order[number]) => f.calls.find(call => call.name === name)!.args;
  expect(args('install')[0]).toEqual([originalStep]);
  expect(Object.isFrozen(args('install')[0])).toBe(true);
  expect(Object.isFrozen((args('install')[0] as unknown[])[0])).toBe(true);
  expect(args('install')[1]).toBe(f.lock);
  expect(args('install')[3]).toBe(controller.signal);
  const fence = args('ensureBase')[0];
  expect(typeof fence).toBe('function');
  expect(args('install')[2]).toBe(fence);
  expect(args('mergePrisma')[0]).toBe(fence);
  for (const name of ['installOpaque', 'publishBlockUsage', 'lowerSemantic', 'generateRuntime',
    'format', 'publishInstallManifest', 'publishBaseline', 'persistLock'] as const) {
    expect(args(name)[1]).toBe(fence);
  }
  expect(args('prepareArtifactDirectories')[0]).toBe(fence);
  expect(args('applyOverrides')[0]).toBe(fence);
  expect(args('installOpaque')[0]).toBe('build-copy');
  expect(args('publishBlockUsage')[0]).toEqual([{ id: 'ticket/basic', installOrder: 2 }]);
  expect(args('lowerSemantic')[0]).toBe(semantic);
  expect(f.lock.semanticLoweringTasks).toEqual([f.task]);
  expect(f.lock.generatedPaths).toEqual([
    CI_ARTIFACT_FILES.blockUsageMap, CI_ARTIFACT_FILES.installManifest,
    'opaque.ts', 'retained.ts', 'runtime.ts', 'semantic.ts'
  ].sort());
  expect(args('format')[0]).toBe(f.lock.generatedPaths);
  expect(args('publishInstallManifest')[0]).toEqual([{ ...originalStep, status: 'installed' }]);
  expect(args('publishBaseline')[0]).toEqual(['src/ticket.ts', ...f.lock.generatedPaths, 'override.ts']);
  expect(args('persistLock')[0]).toBe(f.lock);
  expect(f.lock.passStatus.compose).toBe('succeeded');
});

for (const stage of order) {
  test(`composition preserves ${stage} failure and starts no later capability`, async () => {
    const failure = Object.freeze({ stage });
    const f = fixture(name => { if (name === stage) throw failure; });
    await expect(executeProjectComposition(f.lock, semantic, options, f.operations)).rejects.toBe(failure);
    expect(f.calls.map(call => call.name)).toEqual(order.slice(0, order.indexOf(stage) + 1));
    // A failed persistence can leave the in-memory lock changed; it is not a
    // durable success. The pipeline still owns failure/transaction settlement.
    if (stage !== 'persistLock') expect(f.lock.passStatus.compose).toBe('pending');
  });
  if (stage !== 'persistLock') test(`composition cancellation after ${stage} prevents later capability starts`, async () => {
    const controller = new AbortController();
    const reason = Object.freeze({ cancelledAfter: stage });
    const f = fixture(name => { if (name === stage) controller.abort(reason); });
    await expect(executeProjectComposition(f.lock, semantic, { ...options, signal: controller.signal }, f.operations))
      .rejects.toBe(reason);
    expect(f.calls.map(call => call.name)).toEqual(order.slice(0, order.indexOf(stage) + 1));
    expect(f.lock.passStatus.compose).toBe('pending');
  });
}

test('settled composition survives cancellation through the workspace and pipeline consumers', async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ cancelledAfter: 'durable-lock-publication' });
  const f = fixture(name => { if (name === 'persistLock') controller.abort(reason); });
  Object.assign(f.lock.passStatus, { resolve: 'succeeded', 'build-ir': 'succeeded' });
  const plan: PlanFile = {
    app: { id: 'composition', name: 'composition', stack: SUPPORTED_STACK,
      packageManager: 'pnpm', mode: 'single-tenant' },
    registry: { sources: [] }, blocks: [], acceptance: []
  };
  const journal: string[] = [];
  const publications: string[] = [];
  const result = await executePipelineStageLifecycle('compose', {
    readExistingLock: () => f.lock,
    assertWrite: () => {},
    saveLock: lock => { publications.push(lock.passStatus.compose); },
    recordBlocked: () => { journal.push('blocked'); },
    recordStart: () => { journal.push('started'); },
    recordSuccess: () => { journal.push('succeeded'); },
    recordFailure: () => { journal.push('failed'); },
    execute: () => composeWorkspaceResult(semantic,
      { materializationMode: options.opaqueModuleMaterializationMode, signal: controller.signal }, {
        readPlan: () => plan,
        readLock: () => f.lock,
        compose: (lock, context, request) => executeProjectComposition(lock, context, {
          ...options, signal: request.signal
        }, f.operations).then(() => {})
      })
  }, { extractLock: result => result.lock, preserveOwnedPassStates: true });
  expect(result.lock).toBe(f.lock);
  expect(controller.signal.aborted).toBe(true);
  expect(f.calls.map(call => call.name)).toEqual([...order]);
  expect(journal).toEqual(['started', 'succeeded']);
  expect(publications).not.toContain('failed');
  expect(f.lock.passStatus.compose).toBe('succeeded');
});

test('composition validates all ports and initial cancellation before any capability executes', async () => {
  const f = fixture();
  const failure = Object.freeze({ cancelled: true });
  await expect(executeProjectComposition(f.lock, semantic,
    { ...options, signal: AbortSignal.abort(failure) }, f.operations)).rejects.toBe(failure);
  f.operations.persistLock = undefined as never;
  await expect(executeProjectComposition(f.lock, semantic, options, f.operations)).rejects.toBeInstanceOf(TypeError);
  expect(f.calls).toEqual([]);
});

test('the live fence preserves provider receiver and cancellation', async () => {
  const controller = new AbortController();
  const failure = new Error('authority revoked');
  const f = fixture();
  const request = { ...options, signal: controller.signal, commitFence: async function(this: unknown) {
    expect(this).toBe(request);
    controller.abort(failure);
  } };
  f.operations.ensureBase = async fence => { await fence(); };
  await expect(executeProjectComposition(f.lock, semantic, request, f.operations)).rejects.toBe(failure);
  expect(f.calls.map(call => call.name)).toEqual(['checkWriteBoundary']);
  expect(f.lock.passStatus.compose).toBe('pending');
});
