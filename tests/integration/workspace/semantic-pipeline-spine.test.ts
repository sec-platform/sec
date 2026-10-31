import { expect, test } from 'bun:test';
import { chmod, lstat, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  readPipelineJournal,
  REFERENCE_PIPELINE_TRANSACTION_ID
} from '../../../src/adapters/compilation/pipeline/journal.ts';
import { readLockFile, saveLock } from "../../../src/adapters/workspace/lock.ts";
import {
  addBlock,
  compileWorkspace,
  initWorkspace
} from '../../../src/bootstrap/engineering/cli.ts';
import { copyWorkspaceFixture, createWorkspace, withTempWorkspace } from '../../testkit/workspace.ts';
import { resolveWorkspaceLockPath } from '../../../src/adapters/workspace-context.ts';

// One immutable ticket authoring baseline for three independent pipeline
// transactions. Cloning never reuses generated state, write leases, journals,
// selected pipeline ranges, or actual oracle outcomes.
let ticketSourceTemplate: Promise<string> | undefined;
function immutableTicketSourceTemplate(): Promise<string> {
  if (ticketSourceTemplate !== undefined) return ticketSourceTemplate;
  const pending = (async () => {
    const root = await createWorkspace('semantic-ticket-source-base-');
    try {
      await initWorkspace(root);
      await addBlock(root, 'ticket/basic');
      return root;
    } catch (primary) {
      try { await rm(root, { recursive: true, force: true }); }
      catch (cleanup) {
        throw new AggregateError([primary, cleanup], 'Semantic ticket source and cleanup both failed');
      }
      throw primary;
    }
  })();
  ticketSourceTemplate = pending;
  void pending.catch(() => {
    if (ticketSourceTemplate === pending) ticketSourceTemplate = undefined;
  });
  return pending;
}

async function copyTicketSource(workspaceRoot: string): Promise<void> {
  const template = await immutableTicketSourceTemplate();
  await copyWorkspaceFixture(template, workspaceRoot);
  // The copier preserves canonical bytes; exact native file modes belong to
  // each private generation and must match the authored source before use.
  for (const file of [
    await resolveWorkspaceLockPath(template),
    path.join(template, '.sec', 'pipeline-journal.json')
  ]) {
    let mode: number;
    try { mode = (await lstat(file)).mode & 0o777; }
    catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw failure;
    }
    await chmod(path.join(workspaceRoot, path.relative(template, file)), mode);
  }
}

test('Ticket canonical compile binds one validated semantic snapshot to each transaction', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await copyTicketSource(workspaceRoot);

    const first = await compileWorkspace(workspaceRoot, {
      source: 'ci',
      through: 'compose'
    });
    const firstSemantic = first.semanticContext!;

    expect(first.completedStages).toEqual(['resolve', 'semantic', 'compose']);
    expect(firstSemantic.transactionId).toBe(first.transactionId);
    expect(firstSemantic.snapshot.ir.entities.some(
      (entity) => entity.id === 'responsibility:ticket:TicketLifecycle'
    )).toBe(true);
    expect(firstSemantic.snapshot.ir.facts.some((fact) =>
      fact.subject === 'responsibility:ticket:TicketQuery' &&
      fact.predicate === 'DEPENDS_ON' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'responsibility:tenant:TenantScopeGuard'
    )).toBe(true);
    expect(firstSemantic.snapshot.ir.facts.some((fact) =>
      fact.subject === 'policy:tenant-scope-required' &&
      fact.predicate === 'ENFORCES' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'policy:tenant:tenant-scope'
    )).toBe(true);
    expect(firstSemantic.snapshot.ir.scenarios.some(
      (scenario) => scenario.id === 'scenario:ticket:create-ticket'
    )).toBe(true);
    expect(Object.isFrozen(firstSemantic.snapshot.ir)).toBe(true);
    expect(Object.isFrozen(firstSemantic.generatorPlan)).toBe(true);
    expect(Object.isFrozen(firstSemantic.generatorPlan.tasks[0]?.transitions)).toBe(true);
    expect(firstSemantic.semanticViews).toMatchObject({
      inputRevision: firstSemantic.inputRevision,
      semanticRevision: firstSemantic.semanticRevision
    });
    expect(new Set(firstSemantic.semanticViews.views.map((view) => view.viewKind))).toEqual(
      new Set(['architecture', 'scenario', 'state'])
    );
    expect(Object.isFrozen(firstSemantic.semanticViews)).toBe(true);
    expect(Object.isFrozen(firstSemantic.semanticViews.views[0]?.nodes)).toBe(true);
    expect(first.lock.semanticViews).toEqual(firstSemantic.semanticViews);

    const sharedFactId = firstSemantic.snapshot.ir.facts.find((fact) =>
      fact.subject === 'operation:ticket:transitionTicketStatus' &&
      fact.predicate === 'MUTATES' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'state:ticket:ticket-status'
    )!.id;
    for (const view of [
      firstSemantic.semanticViews.views.find((candidate) => candidate.viewKind === 'architecture')!,
      firstSemantic.semanticViews.views.find((candidate) => candidate.subject === 'scenario:ticket:transition-ticket-status')!,
      firstSemantic.semanticViews.views.find((candidate) => candidate.subject === 'state:ticket:ticket-status')!
    ]) {
      expect(view.nodes.some((node) =>
        node.references.some((reference) => reference.kind === 'fact' && reference.ref === sharedFactId)
      )).toBe(true);
    }
    expect(first.lock.semanticLoweringTasks?.[0]?.artifactBinding).toEqual({
      generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
      artifactEntityId: 'artifact:src/installed/ticket/ticket-semantic-contract.ts',
      semanticRevision: firstSemantic.semanticRevision,
      compilationTransactionId: first.transactionId
    });

    const second = await compileWorkspace(workspaceRoot, {
      source: 'ci',
      from: 'compose',
      through: 'compose'
    });
    const secondSemantic = second.semanticContext!;

    expect(second.completedStages).toEqual(['semantic', 'compose']);
    expect(second.transactionId).not.toBe(first.transactionId);
    expect(secondSemantic.transactionId).toBe(second.transactionId);
    expect(secondSemantic.inputRevision).toBe(firstSemantic.inputRevision);
    expect(secondSemantic.semanticRevision).toBe(firstSemantic.semanticRevision);
    expect(secondSemantic.semanticViews).toEqual(firstSemantic.semanticViews);
    expect(second.lock.semanticViews).toEqual(secondSemantic.semanticViews);
    expect(second.lock.semanticLoweringTasks?.[0]?.artifactBinding).toEqual({
      generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
      artifactEntityId: 'artifact:src/installed/ticket/ticket-semantic-contract.ts',
      semanticRevision: secondSemantic.semanticRevision,
      compilationTransactionId: second.transactionId
    });
  }, 'engineering-compiler-semantic-pipeline-ticket-');
}, 120000);

test('reference recompilation keeps a stable binding to its current named transaction', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await copyTicketSource(workspaceRoot);

    const first = await compileWorkspace(workspaceRoot, {
      source: 'reference',
      through: 'compose'
    });
    const second = await compileWorkspace(workspaceRoot, {
      source: 'reference',
      from: 'compose',
      through: 'compose'
    });
    const journal = await readPipelineJournal(workspaceRoot);

    expect(first.transactionId).toBe(REFERENCE_PIPELINE_TRANSACTION_ID);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.semanticContext?.transactionId).toBe(second.transactionId);
    expect(second.lock.semanticLoweringTasks?.[0]?.artifactBinding).toMatchObject({
      semanticRevision: second.semanticContext?.semanticRevision,
      compilationTransactionId: second.transactionId
    });
    expect(journal.lastCommittedTransactionId).toBe(second.transactionId);
    expect(journal.transactions.filter((entry) => entry.id === second.transactionId)).toEqual([
      expect.objectContaining({
        source: 'reference',
        status: 'succeeded'
      })
    ]);
  }, 'engineering-compiler-reference-semantic-transaction-');
}, 120000);

test('Semantic Frontend failure blocks mutating passes and a new transaction can retry safely', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await copyTicketSource(workspaceRoot);
    await compileWorkspace(workspaceRoot, {
      source: 'ci',
      through: 'resolve'
    });

    const resolvedLock = await readLockFile(workspaceRoot);
    const originalBlocks = structuredClone(resolvedLock.resolvedBlocks);
    resolvedLock.resolvedBlocks[0]!.id = 'missing/semantic-block';
    await saveLock(workspaceRoot, resolvedLock);

    await expect(compileWorkspace(workspaceRoot, {
      source: 'repair',
      from: 'compose',
      through: 'compose'
    })).rejects.toMatchObject({ code: 'MANIFEST-SCHEMA-004' });

    const failedLock = await readLockFile(workspaceRoot);
    expect(failedLock.semanticViews).toBeUndefined();
    expect(failedLock.semanticLoweringTasks).toBeUndefined();
    expect(failedLock.passStatus).toMatchObject({
      resolve: 'succeeded',
      'build-ir': 'failed',
      compose: 'blocked',
      verify: 'blocked',
      repair: 'blocked',
      lock: 'blocked',
      emit: 'blocked'
    });
    const failedJournal = await readPipelineJournal(workspaceRoot);
    expect(failedJournal.transactions.at(-1)).toMatchObject({
      source: 'repair',
      requestedStages: ['semantic', 'compose'],
      status: 'failed',
      passRecords: [{ passId: 'build-ir', status: 'failed' }]
    });

    failedLock.resolvedBlocks = originalBlocks;
    await saveLock(workspaceRoot, failedLock);
    const retried = await compileWorkspace(workspaceRoot, {
      source: 'repair',
      from: 'compose',
      through: 'compose'
    });

    expect(retried.completedStages).toEqual(['semantic', 'compose']);
    expect(retried.semanticContext?.transactionId).toBe(retried.transactionId);
    expect(retried.lock.passStatus).toMatchObject({
      'build-ir': 'succeeded',
      compose: 'succeeded'
    });
  }, 'engineering-compiler-semantic-pipeline-retry-');
}, 120000);
