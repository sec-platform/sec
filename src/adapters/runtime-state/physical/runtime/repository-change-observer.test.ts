import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { bindSemanticOperation, compileSemanticOperationPlan, issueSemanticOperationAttemptContext } from '../../../../execution/operation/semantic.ts';
import {
  armPreparedRepositoryChangeObserver,
  armRepositoryChangeObserver,
  disposePreparedRepositoryChangeObserver,
  prepareRepositoryChangeObserver,
  repositoryChangeObserverBinding,
  settlePreparedRepositoryChangeObserver,
  settleRepositoryChangeObserver,
  type PreparedRepositoryChangeObserver,
  type RepositoryChangeObserver
} from './repository-change-observer.ts';
import {
  RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
  RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
} from './windows-repository-change-observer.ts';

test.skipIf(process.platform === 'win32')(
  'unsupported host returns typed strict-capability absence without touching supplied roots',
  async () => {
    const roots = Object.defineProperty({}, 'roots', {
      get() { throw new Error('Unsupported platform must not start root admission.'); }
    }) as { roots: readonly string[]; deadlineAtUnixMs: number };
    expect(prepareRepositoryChangeObserver(roots)).toEqual({
      status: 'unavailable', reason: 'unsupported-platform'
    });
    expect(await armRepositoryChangeObserver(roots)).toEqual({
      status: 'unavailable', reason: 'unsupported-platform'
    });
  }
);

test('caller-authored capability fields cannot select, bind, arm or settle an observer', async () => {
  const forged = Object.freeze({
    rootIdentityDigest: `sha256:${'a'.repeat(64)}`,
    providerBinding: Object.freeze({
      requirementId: RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
      contractDigest: RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST
    })
  }) as unknown as PreparedRepositoryChangeObserver;
  expect(() => repositoryChangeObserverBinding(forged)).toThrow('owner-issued');
  // A forged capability is rejected before even consulting operation/context.
  const input = Object.defineProperties({ prepared: forged }, {
    operation: { get() { throw new Error('Forged capability reached operation admission.'); } },
    requirementBindingContext: { get() { throw new Error('Forged capability consumed context.'); } }
  }) as Parameters<typeof armPreparedRepositoryChangeObserver>[0];
  expect(await armPreparedRepositoryChangeObserver(input)).toEqual({
    status: 'unavailable', reason: 'invalid-input'
  });
  await expect(settlePreparedRepositoryChangeObserver(forged)).rejects.toThrow('owner-issued');
  await expect(settleRepositoryChangeObserver(forged as unknown as RepositoryChangeObserver))
    .rejects.toThrow('owner-issued');
  expect(() => disposePreparedRepositoryChangeObserver(forged)).toThrow('owner-issued');
});

test.skipIf(process.platform !== 'win32')(
  'platform dispatch preserves physical binding, retained root and terminal settlement',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-neutral-observer-'));
    let prepared: ReturnType<typeof prepareRepositoryChangeObserver> | undefined;
    try {
      prepared = prepareRepositoryChangeObserver({ roots: [root] });
      expect(prepared.status).toBe('ready');
      if (prepared.status !== 'ready') throw new Error('Windows observer preparation failed.');
      const binding = repositoryChangeObserverBinding(prepared.prepared);
      expect(binding).toBe(prepared.prepared.providerBinding);
      expect(binding.requirementId).toBe(RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID);
      expect(binding.contractDigest).toBe(RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST);
      const copiedCapability = { ...prepared.prepared };
      expect(() => repositoryChangeObserverBinding(copiedCapability)).toThrow('owner-issued');
      const operation = bindSemanticOperation(compileSemanticOperationPlan({
        operation: 'verification.repository-observer-dispatch',
        intentDigest: binding.contractDigest,
        decisionDigest: binding.contractDigest,
        deadlineAtUnixMs: Date.now() + 10_000,
        attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: binding.contractDigest }),
        aggregateBudgets: [{ resource: 'duration-ms', maximum: 10_000 }],
        requirements: [{
          id: binding.requirementId,
          contractDigest: binding.contractDigest,
          effectKinds: ['filesystem'],
          failureKinds: ['provider.unavailable']
        }]
      }), [binding]);
      const resolution = await armPreparedRepositoryChangeObserver({
        prepared: prepared.prepared,
        operation,
        requirementBindingContext: issueOperationRequirementBindingContext({
          operation,
          requirementId: binding.requirementId,
          resourceCeilings: [{ resource: 'duration-ms', maximum: 10_000 }]
        })
      });
      expect(resolution.status).toBe('ready');
      expect((await settlePreparedRepositoryChangeObserver(prepared.prepared)).status).toBe('zero-events');
      expect((await settlePreparedRepositoryChangeObserver(prepared.prepared)).status).toBe('discontinuous');
    } finally {
      if (prepared?.status === 'ready') {
        const retained = prepared.prepared;
        await settlePreparedRepositoryChangeObserver(retained);
        disposePreparedRepositoryChangeObserver(retained);
        disposePreparedRepositoryChangeObserver(retained);
        expect(() => repositoryChangeObserverBinding(retained)).toThrow('live owner-issued');
      }
      await rm(root, { recursive: true, force: true });
    }
  }
);
