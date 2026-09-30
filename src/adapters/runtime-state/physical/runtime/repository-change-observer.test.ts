import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  issueSecOperationRequirementBindingContext
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../../../execution/operation/semantic.ts';
import {
  armPreparedRepositoryChangeObserver,
  disposePreparedRepositoryChangeObserver,
  prepareRepositoryChangeObserver,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
  RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
  settlePreparedRepositoryChangeObserver
} from './repository-change-observer.ts';

function digest(value: string): SecOperationDigest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function observerOperation(
  prepared: ReturnType<typeof prepareRepositoryChangeObserver>
) {
  const deadlineAtUnixMs = Date.now() + 30_000;
  const plan = compileSecSemanticOperationPlan({
    operation: 'development.runner.test-suite',
    intentDigest: digest('repository-observer-prepared-test-intent'),
    decisionDigest: RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
    deadlineAtUnixMs,
    aggregateBudgets: [{ resource: 'duration-ms', maximum: 30_000 }],
    requirements: [{
      id: RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
      contractDigest: RETAINED_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
      effectKinds: ['filesystem'],
      failureKinds: [
        'provider.deadline-exhausted',
        'provider.unavailable',
        'provider.unverified'
      ]
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: digest('repository-observer-prepared-test-grant')
    })
  });
  return bindSecSemanticOperation(plan, [prepared.providerBinding]);
}

async function withFixture(
  operation: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-generic-repository-observer-'));
  try {
    await mkdir(path.join(root, 'nested'));
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== 'linux')(
  'prepared repository observer binds the generic semantic requirement on Linux',
  async () => withFixture(async (root) => {
    const prepared = prepareRepositoryChangeObserver({ roots: [root] });
    const operation = observerOperation(prepared);
    const resolution = await armPreparedRepositoryChangeObserver({
      prepared,
      operation,
      requirementBindingContext: issueSecOperationRequirementBindingContext({
        operation,
        requirementId: RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
        resourceCeilings: [{ resource: 'duration-ms', maximum: 20_000 }]
      })
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') {
      disposePreparedRepositoryChangeObserver(prepared);
      return;
    }
    const target = path.join(root, 'nested', 'effect.txt');
    await writeFile(target, 'effect', 'utf8');
    const settlement = await settlePreparedRepositoryChangeObserver(prepared);
    expect(settlement.status).toBe('events');
    if (settlement.status === 'events') {
      expect(settlement.events.some(({ path: observedPath }) =>
        observedPath === 'nested/effect.txt')).toBeTrue();
    }
    disposePreparedRepositoryChangeObserver(prepared);
  })
);

test.skipIf(process.platform !== 'linux')(
  'prepared repository observer settles an unchanged Linux root with zero events',
  async () => withFixture(async (root) => {
    const prepared = prepareRepositoryChangeObserver({ roots: [root] });
    const operation = observerOperation(prepared);
    const resolution = await armPreparedRepositoryChangeObserver({
      prepared,
      operation,
      requirementBindingContext: issueSecOperationRequirementBindingContext({
        operation,
        requirementId: RETAINED_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
        resourceCeilings: [{ resource: 'duration-ms', maximum: 20_000 }]
      })
    });
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') {
      disposePreparedRepositoryChangeObserver(prepared);
      return;
    }
    const settlement = await settlePreparedRepositoryChangeObserver(prepared);
    expect(settlement.status).toBe('zero-events');
    disposePreparedRepositoryChangeObserver(prepared);
  })
);
