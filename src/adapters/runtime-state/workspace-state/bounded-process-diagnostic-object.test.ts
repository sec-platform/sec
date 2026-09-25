import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import {
  createBoundedProcessDiagnosticObjectReceipt,
  encodeBoundedProcessDiagnosticObjectReceipt
} from './bounded-process-diagnostic-contract.ts';
import {
  BoundedProcessDiagnosticObjectError,
  createBoundedProcessDiagnosticObjectStore
} from './bounded-process-diagnostic-object.ts';
import { resolveWorkspaceRuntimeRoots } from './paths.ts';
import { acquireRuntimeJournalAuthority } from './physical-authority.ts';

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()!;
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      throw new Error('Refusing to remove a non-temporary diagnostic fixture');
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-process-diagnostic-'));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  mkdirSync(repositoryRoot);
  const environment = {
    ...process.env,
    SEC_STATE_HOME: path.join(root, 'state'),
    SEC_CACHE_HOME: path.join(root, 'cache')
  };
  return { environment, repositoryRoot };
}

function operation(label: string, includeRecords = false, maximumInputBytes = 4_096) {
  const requirementId = 'runtime-state.process-diagnostic.fixture';
  const contractDigest = sha256({ requirementId }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: `runtime-state.process-diagnostic.${label}`,
    intentDigest: sha256({ label }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + 30_000,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'input-bytes', maximum: maximumInputBytes },
      { resource: 'output-bytes', maximum: 4_096 },
      ...(includeRecords ? [{ resource: 'records' as const, maximum: 32 }] : [])
    ],
    requirements: [{
      id: requirementId,
      contractDigest,
      effectKinds: ['filesystem'],
      failureKinds: [
        'diagnostic.corrupt-object',
        'diagnostic.deadline-exhausted',
        'diagnostic.physical-replacement'
      ]
    }]
  });
  return {
    requirementId,
    operation: bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId,
      contractDigest,
      providerIdentityDigest: sha256('runtime-state-process-diagnostic-fixture') as OperationDigest
    })])
  };
}

test.serial('bounded process diagnostics survive lost handles through owner-issued receipt readback', async () => {
  const value = fixture();
  const publication = operation('publish');
  const subjectDigest = sha256('action-key') as OperationDigest;
  const settlementDigest = sha256('process-settlement') as OperationDigest;
  const firstAuthority = await acquireRuntimeJournalAuthority(value);
  const roots = resolveWorkspaceRuntimeRoots(value);
  writeFileSync(
    path.join(
      roots.workspaceStateRoot,
      'verification-actions',
      'terminal-bound',
      'journal-like-child.json'
    ),
    '{}'
  );
  const firstStore = createBoundedProcessDiagnosticObjectStore({
    ...value,
    authority: firstAuthority
  });
  const receipts = await firstStore.publish({
    ...publication,
    subjectDigest,
    settlementDigest,
    streams: [
      { stream: 'stderr', bytes: new TextEncoder().encode('typed failure detail') },
      { stream: 'stdout', bytes: new TextEncoder().encode('bounded output') }
    ]
  });
  expect(receipts.map(({ receipt }) => receipt.stream)).toEqual(['stderr', 'stdout']);
  expect(receipts.every(({ receipt }) => (
    receipt.boundAttemptDigest === publication.operation.boundAttemptDigest
  ))).toBe(true);
  expect(receipts.every(({ receipt, readback }) => (
    receipt.subjectDigest === subjectDigest
    && receipt.settlementDigest === settlementDigest
    && readback.objectDigest === receipt.objectDigest
  ))).toBe(true);
  await firstAuthority.release();

  const readback = operation('readback');
  const secondAuthority = await acquireRuntimeJournalAuthority(value);
  try {
    const secondStore = createBoundedProcessDiagnosticObjectStore({
      ...value,
      authority: secondAuthority
    });
    const observed = await secondStore.read({
      ...readback,
      receipt: structuredClone(receipts[0]!.receipt)
    });
    expect(observed.status).toBe('available');
    if (observed.status !== 'available') throw new Error('Expected diagnostic readback');
    expect(new TextDecoder().decode(observed.bytes)).toBe('typed failure detail');
    const gc = operation('readback-gc', true);
    const gcReceipt = await secondStore.gc(gc);
    expect(gcReceipt).toMatchObject({
      observedObjects: 2,
      retainedObjects: 2,
      deletedObjects: 0
    });
    expect(() => createBoundedProcessDiagnosticObjectStore({
      ...value,
      authority: { ...secondAuthority }
    })).toThrow('not owner-issued');
  } finally {
    await secondAuthority.release();
  }
});

test.serial('diagnostic payload mutation and incomplete object residue remain typed blockers', async () => {
  const value = fixture();
  const publication = operation('mutation-publish');
  const authority = await acquireRuntimeJournalAuthority(value);
  const store = createBoundedProcessDiagnosticObjectStore({ ...value, authority });
  const [published] = await store.publish({
    ...publication,
    subjectDigest: sha256('mutation-action-key') as OperationDigest,
    settlementDigest: sha256('mutation-process-settlement') as OperationDigest,
    streams: [{ stream: 'stderr', bytes: new TextEncoder().encode('original') }]
  });
  const receipt = published!.receipt;
  await authority.release();

  const roots = resolveWorkspaceRuntimeRoots(value);
  const payloadName = `${receipt!.objectDigest.slice('sha256:'.length)}.bin`;
  writeFileSync(path.join(roots.processDiagnosticObjectRoot, payloadName), 'mutated!');
  const readAuthority = await acquireRuntimeJournalAuthority(value);
  try {
    const readStore = createBoundedProcessDiagnosticObjectStore({ ...value, authority: readAuthority });
    const readback = operation('mutation-readback');
    try {
      await readStore.read({ ...readback, receipt });
      throw new Error('Expected mutated payload to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedProcessDiagnosticObjectError);
      expect((error as BoundedProcessDiagnosticObjectError).kind).toBe('corrupt-object');
    }
    const gc = operation('mutation-gc', true);
    try {
      await readStore.gc(gc);
      throw new Error('Expected corrupt object to block GC');
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedProcessDiagnosticObjectError);
    }
  } finally {
    await readAuthority.release();
  }
});

test.serial('same-path diagnostic root replacement fails the mutation-safe authority fence', async () => {
  const value = fixture();
  const roots = resolveWorkspaceRuntimeRoots(value);
  const authority = await acquireRuntimeJournalAuthority(value);
  const store = createBoundedProcessDiagnosticObjectStore({ ...value, authority });
  renameSync(roots.processDiagnosticObjectRoot, `${roots.processDiagnosticObjectRoot}-replaced`);
  mkdirSync(roots.processDiagnosticObjectRoot);
  try {
    await store.publish({
      ...operation('root-replacement'),
      subjectDigest: sha256('replacement-action-key') as OperationDigest,
      settlementDigest: sha256('replacement-settlement') as OperationDigest,
      streams: [{ stream: 'stderr', bytes: new TextEncoder().encode('blocked') }]
    });
    throw new Error('Expected root replacement to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(BoundedProcessDiagnosticObjectError);
    expect((error as BoundedProcessDiagnosticObjectError).kind).toBe('physical-replacement');
  } finally {
    await authority.release();
  }
});

test.serial('foreign diagnostic residue blocks bounded collection', async () => {
  const value = fixture();
  const roots = resolveWorkspaceRuntimeRoots(value);
  const authority = await acquireRuntimeJournalAuthority(value);
  const store = createBoundedProcessDiagnosticObjectStore({ ...value, authority });
  writeFileSync(path.join(roots.processDiagnosticObjectRoot, 'foreign.txt'), 'foreign');
  try {
    await store.gc(operation('foreign-residue', true));
    throw new Error('Expected foreign residue to block collection');
  } catch (error) {
    expect(error).toBeInstanceOf(BoundedProcessDiagnosticObjectError);
    expect((error as BoundedProcessDiagnosticObjectError).kind).toBe('foreign-residue');
  } finally {
    await authority.release();
  }
});

test.serial('object-local partial publication is retained or expired without blocking unrelated GC', async () => {
  const value = fixture();
  const roots = resolveWorkspaceRuntimeRoots(value);
  const gcOperation = operation('partial-residue-gc', true);
  const authority = await acquireRuntimeJournalAuthority(value);
  const expired = createBoundedProcessDiagnosticObjectReceipt({
    operationIdentityDigest: gcOperation.operation.plan.identity.identityDigest,
    executionPlanDigest: gcOperation.operation.plan.execution.executionPlanDigest,
    boundAttemptDigest: gcOperation.operation.boundAttemptDigest,
    subjectDigest: sha256('partial-action') as OperationDigest,
    settlementDigest: sha256('partial-settlement') as OperationDigest,
    stream: 'stderr',
    bytes: new TextEncoder().encode('never-published'),
    retainedUntilUnixMs: Date.now() - 1
  });
  const expiredLeaf = expired.objectDigest.slice('sha256:'.length);
  writeFileSync(
    path.join(roots.processDiagnosticObjectRoot, `${expiredLeaf}.pending.json`),
    encodeBoundedProcessDiagnosticObjectReceipt(expired)
  );
  writeFileSync(
    path.join(roots.processDiagnosticObjectRoot, `${expiredLeaf}.bin`),
    'never-published'
  );
  const payloadOnlyDigest = sha256('payload-only').slice('sha256:'.length);
  writeFileSync(
    path.join(roots.processDiagnosticObjectRoot, `${payloadOnlyDigest}.bin`),
    'payload-only'
  );
  try {
    const store = createBoundedProcessDiagnosticObjectStore({ ...value, authority });
    const receipt = await store.gc(gcOperation);
    expect(receipt).toMatchObject({
      observedObjects: 2,
      retainedObjects: 1,
      deletedObjects: 1,
      incompleteObjects: 1,
      unknownObjects: 1
    });
    expect(existsSync(path.join(
      roots.processDiagnosticObjectRoot,
      `${expiredLeaf}.pending.json`
    ))).toBe(false);
    expect(existsSync(path.join(
      roots.processDiagnosticObjectRoot,
      `${expiredLeaf}.bin`
    ))).toBe(false);
    expect(existsSync(path.join(
      roots.processDiagnosticObjectRoot,
      `${payloadOnlyDigest}.bin`
    ))).toBe(true);
  } finally {
    await authority.release();
  }
});

test.serial('GC stops before the next payload when the remaining input-byte budget is exhausted', async () => {
  const value = fixture();
  const roots = resolveWorkspaceRuntimeRoots(value);
  const authority = await acquireRuntimeJournalAuthority(value);
  try {
    const store = createBoundedProcessDiagnosticObjectStore({ ...value, authority });
    const published = await store.publish({
      ...operation('budget-sentinel-publish'),
      subjectDigest: sha256('budget-sentinel-action') as OperationDigest,
      settlementDigest: sha256('budget-sentinel-settlement') as OperationDigest,
      streams: [
        { stream: 'stderr', bytes: new TextEncoder().encode('a') },
        { stream: 'stdout', bytes: new TextEncoder().encode('b') }
      ]
    });
    const ordered = [...published].sort((left, right) => (
      left.receipt.objectDigest.localeCompare(right.receipt.objectDigest)
    ));
    const metadataBytes = ordered.reduce((total, { receipt }) => {
      const leaf = receipt.objectDigest.slice('sha256:'.length);
      return total
        + statSync(path.join(roots.processDiagnosticObjectRoot, `${leaf}.json`)).size
        + statSync(path.join(roots.processDiagnosticObjectRoot, `${leaf}.pending.json`)).size;
    }, 0);
    const second = ordered[1]!.receipt;
    writeFileSync(
      path.join(
        roots.processDiagnosticObjectRoot,
        `${second.objectDigest.slice('sha256:'.length)}.bin`
      ),
      second.stream === 'stderr' ? 'z' : 'y'
    );
    try {
      await store.gc(operation(
        'budget-sentinel-gc',
        true,
        metadataBytes + ordered[0]!.receipt.byteLength
      ));
      throw new Error('Expected GC input budget exhaustion');
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedProcessDiagnosticObjectError);
      expect((error as BoundedProcessDiagnosticObjectError).kind).toBe('resource-exhausted');
    }
  } finally {
    await authority.release();
  }
});
