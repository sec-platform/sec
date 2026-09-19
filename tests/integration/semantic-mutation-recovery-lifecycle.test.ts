import { access, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { buildFactDelta } from '../../src/compiler/ir/build-fact-delta.ts';
import {
  addBlock,
  applySemanticMutation,
  initWorkspace,
  querySemanticMutationRequest,
  recoverSemanticMutationWorkspace,
  resolveWorkspace
} from '../../src/bootstrap/engineering/cli.ts';
import {
  applySemanticMutationWithAfterPreparedTestCrash,
  applySemanticMutationWithTestDependencies,
  planSemanticMutationTransactionWithTestDependencies,
  recoverSemanticMutationWorkspaceWithTestDependencies
} from '../../src/bootstrap/engineering/semantic-mutation-orchestrator.ts';
import { buildWorkspaceSemanticBundle } from '../../src/adapters/workspace/semantic-bundle.ts';
import { sha256 } from '../../src/compiler/semantic-mutation/canonical.ts';
import { expectationFromFactDelta } from '../../src/compiler/semantic-mutation/match-expectation.ts';
import { loadSemanticMutationRecoveryRecords } from '../../src/adapters/mutation/mutation-recovery-record.ts';
import { semanticMutationAuthorizationRevision } from '../../src/compiler/semantic-mutation/normalize-request.ts';
import { renderSemanticContractYamlEdit } from '../../src/adapters/mutation/semantic-contract-yaml-adapter.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../src/assurance/verification/semantic-mutation/execution-ref.ts';
import {
  semanticMutationRequestIdentityDigest,
  semanticMutationTransactionRoot
} from '../../src/adapters/mutation/transaction-identity.ts';
import { semanticMutationRequiredVerificationDigest } from '../../src/compiler/semantic-mutation/verification-policy.ts';
import type { FactDeltaEndpointContext } from '../../src/semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationRecoveryState } from '../../src/semantics/mutation/transaction.ts';
import { type SemanticMutationAuthorizationContext, type SemanticMutationBase, type SemanticMutationRequest } from '../../src/semantics/mutation/types.ts';
import { installPrivateBannerBlock } from '../helpers/private-registry-fixtures.ts';
import { semanticMutationVerificationReportFixture } from '../helpers/semantic-mutation-verification-report.ts';
import { copyWorkspaceFixture, withTempWorkspace } from '../testkit/workspace.ts';

const AUTHORING_SOURCE = [
  'formatVersion: "1"',
  'id: item-core',
  'namespace: item',
  'entities:',
  '  - id: Item',
  '    fields:',
  '      - id: status',
  '        type: ItemStatus',
  '        required: false',
  '        mutable: true',
  'states:',
  '  - id: item-status',
  '    entity: Item',
  '    field: status',
  '    owner: ItemStateMachine',
  '    values: [closed, open]',
  '    transitions: []',
  'responsibilities:',
  '  - id: ItemStateMachine',
  '    role: Own item status',
  '    owns: [Item.status]',
  '    implements: [closeItem]',
  '    dependsOn: []',
  'operations:',
  '  - id: closeItem',
  '    responsibility: ItemStateMachine',
  '    inputs: [Item]',
  '    output: Item',
  '    reads: [Item.status]',
  '    writes: []',
  '    mutates: [Item.status]',
  '    requiresPolicies: []',
  '    requiresPermissions: []',
  '    performsEffects: []',
  '    emits: []',
  '    invokes: []',
  '    awaits: []',
  'events: []',
  'policies: []',
  'permissions: []',
  'effects: []',
  'scenarios: []',
  ''
].join('\n');

const TERMINAL_HISTORY_AUTHORING_SOURCE = AUTHORING_SOURCE
  .replace('    values: [closed, open]', '    values: [closed, open, pending]')
  .replace('    transitions: []', '    transitions: [] # retain transition comment');

function endpoint(
  snapshot: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>['snapshot'],
  transactionId: string
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

function authorization(stateId = 'item-status'): SemanticMutationAuthorizationContext {
  const draft: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'> = {
    taskId: 'task:sm3-lifecycle',
    envelopeRevision: 'envelope:v2',
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: [`state:item:${stateId}`],
    allowedSourceOwnerIds: ['semantic-contract-owner:item:item-core'],
    allowedPathPrefixes: ['source/model/'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  };
  return { ...draft, authorizationRevision: semanticMutationAuthorizationRevision(draft) };
}

async function createTemplate(
  workspaceRoot: string,
  authoringSource = AUTHORING_SOURCE
): Promise<void> {
  await initWorkspace(workspaceRoot);
  await installPrivateBannerBlock(workspaceRoot);
  await addBlock(workspaceRoot, 'private/banner-basic');
  await resolveWorkspace(workspaceRoot);
  const modelRoot = path.join(workspaceRoot, 'source', 'model');
  await mkdir(modelRoot, { recursive: true });
  await writeFile(path.join(modelRoot, 'item.yaml'), authoringSource, 'utf8');
  await writeFile(path.join(modelRoot, 'semantic-contracts.yaml'), [
    'formatRevision: authoring-semantic-contract-index-v1',
    'contracts:',
    '  - blockId: private/banner-basic',
    '    path: source/model/item.yaml',
    ''
  ].join('\n'), 'utf8');
}

interface MutationTransitionFixture {
  readonly operationId: string;
  readonly stateId: string;
  readonly from: string;
  readonly to: string;
  readonly by: string;
}

const DEFAULT_MUTATION_TRANSITION: MutationTransitionFixture = Object.freeze({
  operationId: 'operation:add-transition',
  stateId: 'item-status',
  from: 'open',
  to: 'closed',
  by: 'closeItem'
});

const RECOVERY_TEST_ISOLATION_CAPABILITY_PROBE = () =>
  Object.freeze({ status: 'available' as const });

type RecoveryTestDependencies = Parameters<
  typeof applySemanticMutationWithTestDependencies
>[2];

function createRecoveryTestDependencies(): RecoveryTestDependencies {
  let staged: SemanticMutationBase | undefined;
  return {
    isolationCapabilityProbe: RECOVERY_TEST_ISOLATION_CAPABILITY_PROBE,
    verify: async (derived) => {
      staged = derived.plan.staged;
      return buildSemanticMutationVerificationExecutionRef(
        semanticMutationVerificationReportFixture({
          adapterId: derived.plan.verificationAdapterId,
          adapterRevision: derived.plan.verificationAdapterRevision,
          planRevision: derived.plan.planRevision,
          attempted: derived.plan.staged,
          stagedSourceDigest: derived.plan.sourceChanges[0].stagedByteDigest,
          requiredVerificationDigest: semanticMutationRequiredVerificationDigest(
            derived.plan.requiredVerification
          ),
          status: 'passed',
          requirements: derived.plan.requiredVerification
        })
      );
    },
    rebuildLive: async () => {
      if (!staged) throw new Error('Recovery test verification did not bind a staged endpoint');
      return staged;
    }
  };
}

async function mutationInput(
  workspaceRoot: string,
  requestId: string,
  transition: MutationTransitionFixture = DEFAULT_MUTATION_TRANSITION
) {
  const sourcePath = path.join(workspaceRoot, 'source', 'model', 'item.yaml');
  const beforeBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
  const base = endpoint(beforeBundle.snapshot, 'tx:sm3-lifecycle-base');
  const operation = {
    operationId: transition.operationId,
    kind: 'add-state-transition' as const,
    contract: { namespace: 'item', contractId: 'item-core' },
    stateId: transition.stateId,
    from: transition.from,
    to: transition.to,
    by: transition.by
  };
  const beforeBytes = new Uint8Array(await readFile(sourcePath));
  const transformed = renderSemanticContractYamlEdit(beforeBytes, [operation]);
  await writeFile(sourcePath, transformed.stagedBytes);
  const afterBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
  const expectedAfter = endpoint(afterBundle.snapshot, 'tx:sm3-lifecycle-expected');
  const expectedDelta = buildFactDelta(base, expectedAfter);
  await writeFile(sourcePath, beforeBytes);
  const request: SemanticMutationRequest = {
    contractVersion: '2',
    requestId,
    graphId: base.snapshot.ir.graphId,
    appId: base.snapshot.ir.appId,
    base: {
      transactionId: base.transactionId,
      inputRevision: base.inputRevision,
      semanticRevision: base.semanticRevision
    },
    preconditions: [],
    operations: [operation],
    expectation: expectationFromFactDelta(expectedDelta, base.snapshot, expectedAfter.snapshot),
    postconditions: [],
    additionalVerification: []
  };
  return {
    sourcePath,
    beforeBytes,
    request,
    input: { request, base, authorization: authorization(transition.stateId) }
  };
}

async function applyAccepted(workspaceRoot: string, requestId: string) {
  return applyAcceptedWithTestDependencies(
    workspaceRoot,
    requestId,
    DEFAULT_MUTATION_TRANSITION
  );
}

async function applyAcceptedWithTestDependencies(
  workspaceRoot: string,
  requestId: string,
  transition: MutationTransitionFixture
) {
  const prepared = await mutationInput(workspaceRoot, requestId, transition);
  const testDependencies = createRecoveryTestDependencies();
  const plan = await planSemanticMutationTransactionWithTestDependencies(
    workspaceRoot,
    prepared.input,
    { isolationCapabilityProbe: RECOVERY_TEST_ISOLATION_CAPABILITY_PROBE }
  );
  expect(plan.status).toBe('ready');
  if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));

  const outcome = await applySemanticMutationWithTestDependencies(workspaceRoot, {
    ...prepared.input,
    expectedPlanRevision: plan.planRevision
  }, testDependencies);
  expect(outcome.status).toBe('terminal');
  if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
  expect(outcome.result.status).toBe('accepted');
  if (outcome.result.status !== 'accepted') throw new Error(JSON.stringify(outcome.result));
  const identity = {
    graphId: prepared.request.graphId,
    appId: prepared.request.appId,
    requestId: prepared.request.requestId
  } as const;
  const transactionRoot = semanticMutationTransactionRoot(
    workspaceRoot,
    semanticMutationRequestIdentityDigest(identity)
  );
  return { ...prepared, identity, testDependencies, transactionRoot, outcome };
}

async function crashAfterPrepared(workspaceRoot: string, requestId: string) {
  const prepared = await mutationInput(workspaceRoot, requestId);
  const testDependencies = createRecoveryTestDependencies();
  const plan = await planSemanticMutationTransactionWithTestDependencies(
    workspaceRoot,
    prepared.input,
    { isolationCapabilityProbe: RECOVERY_TEST_ISOLATION_CAPABILITY_PROBE }
  );
  expect(plan.status).toBe('ready');
  if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
  await expect(applySemanticMutationWithAfterPreparedTestCrash(workspaceRoot, {
    ...prepared.input,
    expectedPlanRevision: plan.planRevision
  }, testDependencies)).rejects.toMatchObject({
    name: 'SemanticMutationAfterPreparedTestCrash',
    code: 'SEMANTIC_MUTATION_TEST_CRASH_AFTER_PREPARED'
  });
  const identity = {
    graphId: prepared.request.graphId,
    appId: prepared.request.appId,
    requestId: prepared.request.requestId
  } as const;
  const transactionRoot = semanticMutationTransactionRoot(
    workspaceRoot,
    semanticMutationRequestIdentityDigest(identity)
  );
  return { ...prepared, identity, testDependencies, transactionRoot };
}

async function expectRecoveryChain(
  transactionRoot: string,
  expectedStates: readonly SemanticMutationRecoveryState[]
): Promise<void> {
  const records = await loadSemanticMutationRecoveryRecords(transactionRoot);
  expect(records.map((record) => record.state)).toEqual([...expectedStates]);
  for (const [index, record] of records.entries()) {
    expect(record.sequence).toBe(index + 1);
    expect(record.previousRecordRevision).toBe(index === 0 ? '' : records[index - 1]!.recordRevision);
  }
}

test('SM-3 retained terminal history does not become recovery authority for later legal mutations', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await createTemplate(workspaceRoot, TERMINAL_HISTORY_AUTHORING_SOURCE);
    const first = await applyAcceptedWithTestDependencies(
      workspaceRoot,
      'request:terminal-history-first',
      {
        operationId: 'operation:first-transition',
        stateId: 'item-status',
        from: 'open',
        to: 'closed',
        by: 'closeItem'
      }
    );
    const second = await applyAcceptedWithTestDependencies(
      workspaceRoot,
      'request:terminal-history-second',
      {
        operationId: 'operation:second-transition',
        stateId: 'item-status',
        from: 'closed',
        to: 'pending',
        by: 'closeItem'
      }
    );

    expect(await querySemanticMutationRequest(workspaceRoot, first.identity))
      .toMatchObject({ recordKind: 'transaction', state: 'verified' });
    expect(await querySemanticMutationRequest(workspaceRoot, second.identity))
      .toMatchObject({ recordKind: 'transaction', state: 'verified' });
    const sourceBytesAfterSecond = await readFile(second.sourcePath);
    const sourceAfterSecond = sourceBytesAfterSecond.toString('utf8');
    expect(sourceAfterSecond.match(/from:/gu)).toHaveLength(2);
    expect(sourceAfterSecond.indexOf('from: closed')).toBeLessThan(sourceAfterSecond.indexOf('from: open'));
    expect(sourceAfterSecond).toContain('# retain transition comment');
    const firstRecordsBeforeReplay = await loadSemanticMutationRecoveryRecords(first.transactionRoot);
    const secondRecordsBeforeReplay = await loadSemanticMutationRecoveryRecords(second.transactionRoot);
    const replay = await applySemanticMutation(workspaceRoot, {
      ...first.input,
      expectedPlanRevision: first.outcome.result.planRevision
    });
    expect(replay).toEqual(first.outcome);
    expect(await readFile(second.sourcePath)).toEqual(sourceBytesAfterSecond);
    expect(await loadSemanticMutationRecoveryRecords(first.transactionRoot)).toEqual(firstRecordsBeforeReplay);
    expect(await loadSemanticMutationRecoveryRecords(second.transactionRoot)).toEqual(secondRecordsBeforeReplay);
    expect(await querySemanticMutationRequest(workspaceRoot, first.identity))
      .toMatchObject({ recordKind: 'transaction', state: 'verified' });
    expect(await recoverSemanticMutationWorkspace(workspaceRoot)).toEqual({ status: 'clean' });
    await expectRecoveryChain(first.transactionRoot, ['prepared', 'authoring-committed', 'verified']);
    await expectRecoveryChain(second.transactionRoot, ['prepared', 'authoring-committed', 'verified']);

    const third = await mutationInput(
      workspaceRoot,
      'request:terminal-history-third',
      {
        operationId: 'operation:third-transition',
        stateId: 'item-status',
        from: 'pending',
        to: 'open',
        by: 'closeItem'
      }
    );
    const thirdPlan = await planSemanticMutationTransactionWithTestDependencies(
      workspaceRoot,
      third.input,
      { isolationCapabilityProbe: RECOVERY_TEST_ISOLATION_CAPABILITY_PROBE }
    );
    expect(thirdPlan.status).toBe('ready');
    expect(await querySemanticMutationRequest(workspaceRoot, first.identity))
      .toMatchObject({ recordKind: 'transaction', state: 'verified' });
  }, 'sm3-terminal-history-');
}, 600_000);

test('workspace fixture copies case-fold local state and preserve only snapshot-defining files', async () => {
  await withTempWorkspace(async (root) => {
    const template = path.join(root, 'template');
    const workspace = path.join(root, 'workspace');
    const siblingWorkspace = path.join(root, 'workspace-sibling');
    const localState = path.join(template, '.SEC');
    const clonedLocalState = path.join(workspace, '.sec');
    await mkdir(path.join(localState, 'workspace-write-lease'), { recursive: true });
    await mkdir(path.join(localState, 'CACHE'), { recursive: true });
    await mkdir(path.join(localState, 'artifacts', 'state'), { recursive: true });
    await mkdir(path.join(localState, 'semantic-mutation', 'v1'), { recursive: true });
    await mkdir(path.join(localState, 'future-state'), { recursive: true });
    await mkdir(path.join(template, 'source'), { recursive: true });
    await writeFile(path.join(localState, 'workspace-write-lease', 'protocol.json'), '{}\n', 'utf8');
    await writeFile(path.join(localState, 'CACHE', 'composition-baseline.json'), '{"kind":"composition"}\n', 'utf8');
    await writeFile(path.join(localState, 'CACHE', 'project-baseline.json'), '{"kind":"project"}\n', 'utf8');
    await writeFile(path.join(localState, 'pipeline-journal.json'), '{"kind":"pipeline"}\n', 'utf8');
    await writeFile(path.join(localState, 'artifacts', 'state', 'graph.lock.json'), '{"kind":"lock"}\n', 'utf8');
    await writeFile(path.join(localState, 'semantic-mutation', 'v1', 'state.json'), '{}\n', 'utf8');
    await writeFile(path.join(localState, 'future-state', 'state.json'), '{}\n', 'utf8');
    await writeFile(path.join(template, 'source', 'model.yaml'), 'formatVersion: "1"\n', 'utf8');

    await copyWorkspaceFixture(template, workspace);
    await copyWorkspaceFixture(template, siblingWorkspace);

    const sourceModel = path.join(template, 'source', 'model.yaml');
    const clonedModel = path.join(workspace, 'source', 'model.yaml');
    const siblingModel = path.join(siblingWorkspace, 'source', 'model.yaml');
    const physicalFiles = await Promise.all([
      lstat(sourceModel, { bigint: true }),
      lstat(clonedModel, { bigint: true }),
      lstat(siblingModel, { bigint: true })
    ]);
    expect(physicalFiles.map((metadata) => metadata.nlink)).toEqual([1n, 1n, 1n]);
    expect(new Set(physicalFiles.map((metadata) => `${metadata.dev}:${metadata.ino}`)).size).toBe(3);
    await writeFile(clonedModel, 'formatVersion: "2"\n', 'utf8');
    await expect(readFile(sourceModel, 'utf8')).resolves.toBe('formatVersion: "1"\n');
    await expect(readFile(siblingModel, 'utf8')).resolves.toBe('formatVersion: "1"\n');

    await expect(readFile(clonedModel, 'utf8')).resolves.toBe('formatVersion: "2"\n');
    await expect(readFile(path.join(clonedLocalState, 'cache', 'composition-baseline.json'), 'utf8'))
      .resolves.toBe('{"kind":"composition"}\n');
    await expect(readFile(path.join(clonedLocalState, 'cache', 'project-baseline.json'), 'utf8'))
      .resolves.toBe('{"kind":"project"}\n');
    await expect(readFile(path.join(clonedLocalState, 'pipeline-journal.json'), 'utf8'))
      .resolves.toBe('{"kind":"pipeline"}\n');
    await expect(readFile(path.join(clonedLocalState, 'artifacts', 'state', 'graph.lock.json'), 'utf8'))
      .resolves.toBe('{"kind":"lock"}\n');
    await expect(access(path.join(clonedLocalState, 'workspace-write-lease')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(clonedLocalState, 'semantic-mutation')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(clonedLocalState, 'future-state')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }, 'sm3-fixture-copy-');
});

test.skipIf(
  process.platform === 'win32' && process.env.SEC_CASE_SENSITIVE_FIXTURE_TEST !== '1'
)(
  'workspace fixture copies reject case-colliding local-state paths',
  async () => {
    await withTempWorkspace(async (root) => {
      const template = path.join(root, 'template');
      await mkdir(path.join(template, '.sec', 'cache'), { recursive: true });
      await mkdir(path.join(template, '.SEC', 'CACHE'), { recursive: true });

      await expect(copyWorkspaceFixture(template, path.join(root, 'workspace')))
        .rejects.toThrow('case-colliding local-state paths');
    }, 'sm3-fixture-case-collision-');
  }
);

test('workspace fixture copies reject a local-state root alias', async () => {
  await withTempWorkspace(async (root) => {
    const template = path.join(root, 'template');
    const externalState = path.join(root, 'external-state');
    await mkdir(path.join(externalState, 'workspace-write-lease'), { recursive: true });
    await mkdir(template, { recursive: true });
    await symlink(
      externalState,
      path.join(template, '.sec'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(copyWorkspaceFixture(template, path.join(root, 'workspace')))
      .rejects.toThrow('Workspace fixture .sec must be a physical directory');
  }, 'sm3-fixture-root-alias-');
});

test('workspace fixture copies reject a local-state cache alias', async () => {
  await withTempWorkspace(async (root) => {
    const template = path.join(root, 'template');
    const externalCache = path.join(root, 'external-cache');
    await mkdir(path.join(template, '.sec'), { recursive: true });
    await mkdir(externalCache, { recursive: true });
    await symlink(
      externalCache,
      path.join(template, '.sec', 'cache'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(copyWorkspaceFixture(template, path.join(root, 'workspace')))
      .rejects.toThrow('Workspace fixture .sec/cache must be a physical directory');
  }, 'sm3-fixture-cache-alias-');
});

test('workspace fixture copies reject an allowlisted snapshot alias', async () => {
  await withTempWorkspace(async (root) => {
    const template = path.join(root, 'template');
    const cacheRoot = path.join(template, '.sec', 'cache');
    const externalTarget = path.join(
      root,
      process.platform === 'win32' ? 'external-baseline-dir' : 'external-baseline.json'
    );
    await mkdir(cacheRoot, { recursive: true });
    if (process.platform === 'win32') {
      await mkdir(externalTarget, { recursive: true });
    } else {
      await writeFile(externalTarget, '{"external":true}\n', 'utf8');
    }
    await symlink(
      externalTarget,
      path.join(cacheRoot, 'project-baseline.json'),
      process.platform === 'win32' ? 'junction' : 'file'
    );

    await expect(copyWorkspaceFixture(template, path.join(root, 'workspace')))
      .rejects.toThrow(
        'Workspace fixture .sec/cache/project-baseline.json must be a physical regular file'
      );
  }, 'sm3-fixture-leaf-alias-');
});

test('workspace fixture copies reject a case-equivalent destination alias without writes', async () => {
  await withTempWorkspace(async (root) => {
    const template = path.join(root, 'template');
    const workspace = path.join(root, 'workspace');
    const externalState = path.join(root, 'external-destination-state');
    await mkdir(path.join(template, '.sec'), { recursive: true });
    await mkdir(path.join(template, 'source'), { recursive: true });
    await writeFile(
      path.join(template, '.sec', 'pipeline-journal.json'),
      '{"kind":"pipeline"}\n',
      'utf8'
    );
    await writeFile(path.join(template, 'source', 'model.yaml'), 'formatVersion: "1"\n', 'utf8');
    await mkdir(workspace, { recursive: true });
    await mkdir(externalState, { recursive: true });
    await writeFile(path.join(externalState, 'sentinel.txt'), 'unchanged\n', 'utf8');
    await symlink(
      externalState,
      path.join(workspace, '.SEC'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(copyWorkspaceFixture(template, workspace))
      .rejects.toThrow(
        'Workspace fixture destination must not contain a case-equivalent local-state path'
      );
    expect(await readdir(workspace)).toEqual(['.SEC']);
    await expect(readFile(path.join(externalState, 'sentinel.txt'), 'utf8'))
      .resolves.toBe('unchanged\n');
    await expect(access(path.join(externalState, 'pipeline-journal.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(workspace, 'source')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }, 'sm3-fixture-destination-alias-');
});

test('SM-3 real lifecycle covers CAS rejection/collision and prepared, rolled-back, recovery-required recovery', async () => {
  await withTempWorkspace(async (root) => {
    const template = path.join(root, 'template');
    await createTemplate(template);

    const casWorkspace = path.join(root, 'plan-cas');
    await copyWorkspaceFixture(template, casWorkspace);
    const cas = await mutationInput(casWorkspace, 'request:plan-cas');
    const casTestDependencies = createRecoveryTestDependencies();
    const casPlan = await planSemanticMutationTransactionWithTestDependencies(
      casWorkspace,
      cas.input,
      { isolationCapabilityProbe: RECOVERY_TEST_ISOLATION_CAPABILITY_PROBE }
    );
    if (casPlan.status !== 'ready') throw new Error(JSON.stringify(casPlan));
    expect(casPlan.status).toBe('ready');
    const rejected = await applySemanticMutationWithTestDependencies(casWorkspace, {
      ...cas.input,
      expectedPlanRevision: sha256('wrong-plan')
    }, casTestDependencies);
    expect(rejected.status).toBe('terminal');
    if (rejected.status !== 'terminal') throw new Error(JSON.stringify(rejected));
    expect(rejected.result.status).toBe('rejected');
    expect(rejected.result.diagnostics.map((entry) => entry.code)).toEqual(['SEMANTIC-MUTATION-007']);
    expect(await readFile(cas.sourcePath)).toEqual(Buffer.from(cas.beforeBytes));
    expect(await applySemanticMutationWithTestDependencies(casWorkspace, {
      ...cas.input,
      expectedPlanRevision: sha256('wrong-plan')
    }, casTestDependencies)).toEqual(rejected);
    const collisionRequest = {
      ...cas.request,
      operations: [{ ...cas.request.operations[0]!, operationId: 'operation:collision' }]
    };
    const collision = await applySemanticMutationWithTestDependencies(casWorkspace, {
      ...cas.input,
      request: collisionRequest,
      expectedPlanRevision: casPlan.planRevision
    }, casTestDependencies);
    expect(collision.status).toBe('request-rejected');
    if (collision.status !== 'request-rejected') throw new Error(JSON.stringify(collision));
    expect(collision.diagnostics.map((entry) => entry.code)).toEqual(['SEMANTIC-MUTATION-001']);
    const rejectedView = await querySemanticMutationRequest(casWorkspace, {
      graphId: cas.request.graphId,
      appId: cas.request.appId,
      requestId: cas.request.requestId
    });
    expect(rejectedView).toMatchObject({ recordKind: 'rejected-terminal', state: 'rejected' });
    const casTransactionRoot = semanticMutationTransactionRoot(
      casWorkspace,
      semanticMutationRequestIdentityDigest({
        graphId: cas.request.graphId,
        appId: cas.request.appId,
        requestId: cas.request.requestId
      })
    );
    await expectRecoveryChain(casTransactionRoot, []);

    const preparedWorkspace = path.join(root, 'prepared-crash');
    await copyWorkspaceFixture(template, preparedWorkspace);
    const prepared = await crashAfterPrepared(preparedWorkspace, 'request:prepared-crash');
    await expectRecoveryChain(prepared.transactionRoot, ['prepared']);
    expect(await readFile(prepared.sourcePath)).toEqual(Buffer.from(prepared.beforeBytes));
    const preparedRecovery = await recoverSemanticMutationWorkspaceWithTestDependencies(
      preparedWorkspace,
      prepared.testDependencies
    );
    expect(preparedRecovery.status).toBe('terminal');
    if (preparedRecovery.status !== 'terminal') throw new Error(JSON.stringify(preparedRecovery));
    expect(preparedRecovery.result.status).toBe('accepted');
    expect(await readFile(prepared.sourcePath, 'utf8')).toContain('from: open');
    expect(await querySemanticMutationRequest(preparedWorkspace, prepared.identity))
      .toMatchObject({ recordKind: 'transaction', state: 'verified' });
    await expectRecoveryChain(prepared.transactionRoot, ['prepared', 'authoring-committed', 'verified']);

    const rolledBackWorkspace = path.join(root, 'rolled-back');
    await copyWorkspaceFixture(template, rolledBackWorkspace);
    const rolledBack = await applyAccepted(rolledBackWorkspace, 'request:rolled-back');
    await expectRecoveryChain(rolledBack.transactionRoot, ['prepared', 'authoring-committed', 'verified']);
    await rm(path.join(rolledBack.transactionRoot, 'records', '000003-verified.json'));
    await expectRecoveryChain(rolledBack.transactionRoot, ['prepared', 'authoring-committed']);
    await writeFile(rolledBack.sourcePath, rolledBack.beforeBytes);
    const rolledBackRecovery = await recoverSemanticMutationWorkspaceWithTestDependencies(
      rolledBackWorkspace,
      {
        ...rolledBack.testDependencies,
        rebuildLive: async () => rolledBack.input.base
      }
    );
    expect(rolledBackRecovery.status).toBe('terminal');
    if (rolledBackRecovery.status !== 'terminal') throw new Error(JSON.stringify(rolledBackRecovery));
    expect(rolledBackRecovery.result.status).toBe('rolled-back');
    expect(await readFile(rolledBack.sourcePath)).toEqual(Buffer.from(rolledBack.beforeBytes));
    expect(await querySemanticMutationRequest(rolledBackWorkspace, rolledBack.identity))
      .toMatchObject({ recordKind: 'transaction', state: 'rolled-back' });
    await expectRecoveryChain(rolledBack.transactionRoot, ['prepared', 'authoring-committed', 'rolled-back']);

    const recoveryWorkspace = path.join(root, 'recovery-required');
    await copyWorkspaceFixture(template, recoveryWorkspace);
    const recoveryRequired = await applyAccepted(recoveryWorkspace, 'request:recovery-required');
    await expectRecoveryChain(recoveryRequired.transactionRoot, ['prepared', 'authoring-committed', 'verified']);
    await rm(path.join(recoveryRequired.transactionRoot, 'records', '000003-verified.json'));
    await expectRecoveryChain(recoveryRequired.transactionRoot, ['prepared', 'authoring-committed']);
    const thirdPartyBytes = new TextEncoder().encode('third-party: true\n');
    await writeFile(recoveryRequired.sourcePath, thirdPartyBytes);
    const unresolved = await recoverSemanticMutationWorkspace(recoveryWorkspace);
    expect(unresolved.status).toBe('recovery-required');
    if (unresolved.status !== 'recovery-required') throw new Error(JSON.stringify(unresolved));
    expect(unresolved.record).toMatchObject({
      recordKind: 'transaction',
      state: 'recovery-required',
      recoveryState: 'concurrent-write'
    });
    expect(Object.keys(unresolved.record)).not.toContain('relativePath');
    expect(Object.keys(unresolved.record)).not.toContain('beforeByteDigest');
    expect(await readFile(recoveryRequired.sourcePath)).toEqual(Buffer.from(thirdPartyBytes));
    await expect(access(path.join(recoveryRequired.transactionRoot, 'original.backup'))).resolves.toBeNull();
    await expectRecoveryChain(recoveryRequired.transactionRoot, [
      'prepared',
      'authoring-committed',
      'recovery-required'
    ]);

    const missingSourceWorkspace = path.join(root, 'missing-terminal-source');
    await copyWorkspaceFixture(template, missingSourceWorkspace);
    const missingSource = await applyAccepted(missingSourceWorkspace, 'request:missing-terminal-source');
    const missingSourceRecords = await loadSemanticMutationRecoveryRecords(missingSource.transactionRoot);
    await rm(missingSource.sourcePath);
    expect(await recoverSemanticMutationWorkspace(missingSourceWorkspace)).toEqual({ status: 'clean' });
    const missingSourceReplay = await applySemanticMutation(missingSourceWorkspace, {
      ...missingSource.input,
      expectedPlanRevision: missingSource.outcome.result.planRevision
    });
    expect(missingSourceReplay).toEqual(missingSource.outcome);
    expect(await querySemanticMutationRequest(missingSourceWorkspace, missingSource.identity)).toMatchObject({
      state: 'verified',
      result: { status: 'accepted' }
    });
    expect(JSON.stringify(missingSourceReplay)).not.toContain(missingSourceWorkspace);
    expect(await loadSemanticMutationRecoveryRecords(missingSource.transactionRoot))
      .toEqual(missingSourceRecords);

    const missingActiveSourceWorkspace = path.join(root, 'missing-active-source');
    await copyWorkspaceFixture(template, missingActiveSourceWorkspace);
    const missingActiveSource = await crashAfterPrepared(
      missingActiveSourceWorkspace,
      'request:missing-active-source'
    );
    await rm(missingActiveSource.sourcePath);
    const missingActiveRecovery = await recoverSemanticMutationWorkspace(missingActiveSourceWorkspace);
    expect(missingActiveRecovery.status).toBe('recovery-required');
    if (missingActiveRecovery.status !== 'recovery-required') {
      throw new Error(JSON.stringify(missingActiveRecovery));
    }
    expect(missingActiveRecovery.record).toMatchObject({
      state: 'recovery-required',
      recoveryState: 'concurrent-write'
    });
    expect(JSON.stringify(missingActiveRecovery)).not.toContain(missingActiveSourceWorkspace);
    await expectRecoveryChain(missingActiveSource.transactionRoot, ['prepared', 'recovery-required']);

    const frontendFailureWorkspace = path.join(root, 'prepared-frontend-failure');
    await copyWorkspaceFixture(template, frontendFailureWorkspace);
    const frontendFailure = await crashAfterPrepared(
      frontendFailureWorkspace,
      'request:prepared-frontend-failure'
    );
    await writeFile(path.join(frontendFailureWorkspace, 'source', 'app.yaml'), 'invalid: [\n', 'utf8');
    const frontendRecovery = await recoverSemanticMutationWorkspace(frontendFailureWorkspace);
    expect(frontendRecovery.status).toBe('recovery-required');
    if (frontendRecovery.status !== 'recovery-required') throw new Error(JSON.stringify(frontendRecovery));
    expect(frontendRecovery.record).toMatchObject({
      state: 'recovery-required',
      recoveryState: 'rebuild-failed'
    });
    expect(JSON.stringify(frontendRecovery)).not.toContain(frontendFailureWorkspace);
    await expectRecoveryChain(frontendFailure.transactionRoot, ['prepared', 'recovery-required']);

    const restoreValidationWorkspace = path.join(root, 'restore-validation-failure');
    await copyWorkspaceFixture(template, restoreValidationWorkspace);
    const restoreValidation = await applyAccepted(
      restoreValidationWorkspace,
      'request:restore-validation-failure'
    );
    await rm(path.join(restoreValidation.transactionRoot, 'records', '000003-verified.json'));
    await writeFile(restoreValidation.sourcePath, restoreValidation.beforeBytes);
    await writeFile(path.join(restoreValidationWorkspace, 'source', 'app.yaml'), 'invalid: [\n', 'utf8');
    const restoreValidationRecovery = await recoverSemanticMutationWorkspace(restoreValidationWorkspace);
    expect(restoreValidationRecovery.status).toBe('recovery-required');
    if (restoreValidationRecovery.status !== 'recovery-required') {
      throw new Error(JSON.stringify(restoreValidationRecovery));
    }
    expect(restoreValidationRecovery.record).toMatchObject({
      state: 'recovery-required',
      recoveryState: 'restore-validation-failed'
    });
    expect(JSON.stringify(restoreValidationRecovery)).not.toContain(restoreValidationWorkspace);
    await expectRecoveryChain(restoreValidation.transactionRoot, [
      'prepared',
      'authoring-committed',
      'recovery-required'
    ]);
  }, 'sm3-life-');
}, 600_000);
