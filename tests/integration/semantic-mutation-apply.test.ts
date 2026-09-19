import { lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { buildFactDelta } from '../../src/compiler/ir/build-fact-delta.ts';
import {
  applySemanticMutation,
  initWorkspace,
  planSemanticMutationTransaction,
  querySemanticMutationRequest,
  resolveWorkspace
} from '../../src/bootstrap/engineering/cli.ts';
import {
  applySemanticMutationWithTestDependencies,
  planSemanticMutationTransactionWithTestDependencies
} from '../../src/bootstrap/engineering/semantic-mutation-orchestrator.ts';
import { buildWorkspaceSemanticBundle } from '../../src/adapters/workspace/semantic-bundle.ts';
import {
  atomicPublishSemanticMutationSource,
  writeSemanticMutationTransactionArtifacts
} from '../../src/adapters/mutation/atomic-source-publish.ts';
import {
  deriveStagedSemanticMutation,
  type DerivedSemanticMutationTransaction
} from '../../src/adapters/mutation/derive-staged-mutation.ts';
import { expectationFromFactDelta } from '../../src/compiler/semantic-mutation/match-expectation.ts';
import { appendSemanticMutationRecoveryRecord, loadSemanticMutationRecoveryRecords } from '../../src/adapters/mutation/mutation-recovery-record.ts';
import { semanticMutationAuthorizationRevision } from '../../src/compiler/semantic-mutation/normalize-request.ts';
import { renderSemanticContractYamlEdit } from '../../src/adapters/mutation/semantic-contract-yaml-adapter.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../src/assurance/verification/semantic-mutation/execution-ref.ts';
import {
  semanticMutationRequestIdentityDigest,
  semanticMutationTransactionRoot
} from '../../src/adapters/mutation/transaction-identity.ts';
import { semanticMutationRequiredVerificationDigest } from '../../src/compiler/semantic-mutation/verification-policy.ts';
import {
  SEMANTIC_MUTATION_ISOLATED_VERIFICATION_TIMEOUT_MS
} from '../../src/adapters/verification/run-semantic-mutation-isolated-child.ts';
import type { FactDeltaEndpointContext } from '../../src/semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationApplyInput, SemanticMutationRecoveryState } from '../../src/semantics/mutation/transaction.ts';
import { type SemanticMutationAuthorizationContext, type SemanticMutationPlan, type SemanticMutationRequest } from '../../src/semantics/mutation/types.ts';
import { semanticMutationVerificationReportFixture } from '../helpers/semantic-mutation-verification-report.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const FAILURE_MATRIX_ISOLATION_CAPABILITY_PROBE = () =>
  Object.freeze({ status: 'available' as const });
const FAILURE_MATRIX_TEST_DEPENDENCIES = Object.freeze({
  isolationCapabilityProbe: FAILURE_MATRIX_ISOLATION_CAPABILITY_PROBE
});
const SM3_PRODUCTION_TEST_TIMEOUT_MS =
  SEMANTIC_MUTATION_ISOLATED_VERIFICATION_TIMEOUT_MS + 120_000;

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

async function installSmokeRuntimeTests(workspaceRoot: string): Promise<void> {
  const unitRoot = path.join(workspaceRoot, 'project', 'tests', 'runtime', 'unit');
  await mkdir(unitRoot, { recursive: true });
  await writeFile(
    path.join(unitRoot, 'smoke.test.ts'),
    [
      "import { expect, test } from 'bun:test';",
      "import { readFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      '',
      "test('semantic mutation produced the required item transition', async () => {",
      "  const stagedSource = path.resolve(process.cwd(), '..', 'source', 'model', 'item.yaml');",
      "  const source = await readFile(stagedSource, 'utf8');",
      "  expect(source).toContain('from: open');",
      "  expect(source).toContain('to: closed');",
      '});',
      ''
    ].join('\n'),
    'utf8'
  );
}

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

function authorization(): SemanticMutationAuthorizationContext {
  const draft: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'> = {
    taskId: 'task:sm3-integration',
    envelopeRevision: 'envelope:v2',
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: ['state:item:item-status'],
    allowedSourceOwnerIds: ['semantic-contract-owner:item:item-core'],
    allowedPathPrefixes: ['source/model/'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  };
  return { ...draft, authorizationRevision: semanticMutationAuthorizationRevision(draft) };
}

type ReadyMutationPlan = Extract<SemanticMutationPlan, { readonly status: 'ready' }>;
type ReadyDerivedMutation = DerivedSemanticMutationTransaction & {
  readonly plan: ReadyMutationPlan;
  readonly staged: FactDeltaEndpointContext;
  readonly stagingWorkspaceRoot: string;
};

interface CoordinatorFailureFixture {
  readonly sourcePath: string;
  readonly input: SemanticMutationApplyInput;
  readonly transactionRoot: string;
  readonly identity: {
    readonly graphId: string;
    readonly appId: SemanticMutationRequest['appId'];
    readonly requestId: string;
  };
}

interface WorkspaceByteEntry {
  readonly relativePath: string;
  readonly kind: 'directory' | 'file' | 'symlink';
  readonly bytes?: Uint8Array;
  readonly target?: string;
}

async function liveWorkspaceByteSnapshot(workspaceRoot: string): Promise<readonly WorkspaceByteEntry[]> {
  const snapshot: WorkspaceByteEntry[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (relativeDirectory === '' && entry.name === '.sec') continue;
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        snapshot.push({ relativePath, kind: 'symlink', target: await readlink(absolutePath) });
      } else if (stat.isDirectory()) {
        snapshot.push({ relativePath, kind: 'directory' });
        await visit(absolutePath, relativePath);
      } else if (stat.isFile()) {
        snapshot.push({
          relativePath,
          kind: 'file',
          bytes: new Uint8Array(await readFile(absolutePath))
        });
      }
    }
  };
  await visit(workspaceRoot, '');
  return snapshot;
}

async function coordinatorFailureFixture(
  workspaceRoot: string,
  requestId: string
): Promise<CoordinatorFailureFixture> {
  await mkdir(workspaceRoot, { recursive: true });
  await initWorkspace(workspaceRoot);
  await resolveWorkspace(workspaceRoot);
  await installSmokeRuntimeTests(workspaceRoot);

  const modelRoot = path.join(workspaceRoot, 'source', 'model');
  const sourcePath = path.join(modelRoot, 'item.yaml');
  await mkdir(modelRoot, { recursive: true });
  await writeFile(sourcePath, AUTHORING_SOURCE, 'utf8');
  await writeFile(path.join(modelRoot, 'semantic-contracts.yaml'), [
    'formatRevision: authoring-semantic-contract-index-v1',
    'contracts:',
    '  - blockId: entity/customer-basic',
    '    path: source/model/item.yaml',
    ''
  ].join('\n'), 'utf8');

  await mkdir(path.join(workspaceRoot, 'control', 'provenance'), { recursive: true });
  await mkdir(path.join(workspaceRoot, 'control', 'evidence'), { recursive: true });
  await mkdir(path.join(workspaceRoot, 'project', 'generated'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, 'control', 'provenance', 'failure-matrix-projection.json'),
    '{"projection":"unchanged"}\n',
    'utf8'
  );
  await writeFile(
    path.join(workspaceRoot, 'project', 'generated', 'failure-matrix-artifact.bin'),
    new Uint8Array([0, 1, 2, 127, 128, 255])
  );
  await writeFile(
    path.join(workspaceRoot, 'control', 'evidence', 'failure-matrix-note.txt'),
    'unchanged\n',
    'utf8'
  );

  const beforeBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
  const base = endpoint(beforeBundle.snapshot, `tx:failure-matrix-base:${requestId}`);
  const operation = {
    operationId: 'operation:add-transition',
    kind: 'add-state-transition' as const,
    contract: { namespace: 'item', contractId: 'item-core' },
    stateId: 'item-status',
    from: 'open',
    to: 'closed',
    by: 'closeItem'
  };
  const beforeBytes = new Uint8Array(await readFile(sourcePath));
  const transformed = renderSemanticContractYamlEdit(beforeBytes, [operation]);
  await writeFile(sourcePath, transformed.stagedBytes);
  const afterBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
  const expectedAfter = endpoint(afterBundle.snapshot, `tx:failure-matrix-after:${requestId}`);
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
    expectation: expectationFromFactDelta(
      expectedDelta,
      base.snapshot,
      expectedAfter.snapshot
    ),
    postconditions: [],
    additionalVerification: []
  };
  const transactionInput = { request, base, authorization: authorization() };
  const plan = await planSemanticMutationTransactionWithTestDependencies(
    workspaceRoot,
    transactionInput,
    FAILURE_MATRIX_TEST_DEPENDENCIES
  );
  if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
  const identity = { graphId: request.graphId, appId: request.appId, requestId } as const;
  const requestIdentityDigest = semanticMutationRequestIdentityDigest(identity);
  return {
    sourcePath,
    input: { ...transactionInput, expectedPlanRevision: plan.planRevision },
    transactionRoot: semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest),
    identity
  };
}

function verificationExecution(
  derived: ReadyDerivedMutation,
  status: 'passed' | 'failed' | 'blocked'
) {
  const plan = derived.plan;
  return buildSemanticMutationVerificationExecutionRef(semanticMutationVerificationReportFixture({
    adapterId: plan.verificationAdapterId,
    adapterRevision: plan.verificationAdapterRevision,
    planRevision: plan.planRevision,
    attempted: plan.staged,
    stagedSourceDigest: plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest: semanticMutationRequiredVerificationDigest(plan.requiredVerification),
    status,
    requirements: plan.requiredVerification
  }));
}

test('SM-3 dry-run/apply share one plan revision, publish atomically, rebuild live derivatives, and replay exactly once', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);
    await resolveWorkspace(workspaceRoot);
    await installSmokeRuntimeTests(workspaceRoot);

    const modelRoot = path.join(workspaceRoot, 'source', 'model');
    const sourcePath = path.join(modelRoot, 'item.yaml');
    await mkdir(modelRoot, { recursive: true });
    await writeFile(sourcePath, AUTHORING_SOURCE, 'utf8');
    await writeFile(path.join(modelRoot, 'semantic-contracts.yaml'), [
      'formatRevision: authoring-semantic-contract-index-v1',
      'contracts:',
      '  - blockId: entity/customer-basic',
      '    path: source/model/item.yaml',
      ''
    ].join('\n'), 'utf8');

    const beforeBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
    const base = endpoint(beforeBundle.snapshot, 'tx:sm3-base');
    const operation = {
      operationId: 'operation:add-transition',
      kind: 'add-state-transition' as const,
      contract: { namespace: 'item', contractId: 'item-core' },
      stateId: 'item-status',
      from: 'open',
      to: 'closed',
      by: 'closeItem'
    };
    const beforeBytes = new Uint8Array(await readFile(sourcePath));
    const transformed = renderSemanticContractYamlEdit(beforeBytes, [operation]);
    await writeFile(sourcePath, transformed.stagedBytes);
    const afterBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
    const expectedAfter = endpoint(afterBundle.snapshot, 'tx:expected-after');
    const expectedDelta = buildFactDelta(base, expectedAfter);
    await writeFile(sourcePath, beforeBytes);

    const request: SemanticMutationRequest = {
      contractVersion: '2',
      requestId: 'request:sm3-integration',
      graphId: base.snapshot.ir.graphId,
      appId: base.snapshot.ir.appId,
      base: {
        transactionId: base.transactionId,
        inputRevision: base.inputRevision,
        semanticRevision: base.semanticRevision
      },
      preconditions: [],
      operations: [operation],
      expectation: expectationFromFactDelta(
        expectedDelta,
        base.snapshot,
        expectedAfter.snapshot
      ),
      postconditions: [],
      additionalVerification: []
    };
    const input = { request, base, authorization: authorization() };
    const first = await planSemanticMutationTransaction(workspaceRoot, input);
    const second = await planSemanticMutationTransaction(workspaceRoot, input);
    if (first.status !== 'ready') {
      throw new Error(JSON.stringify({
        status: first.status,
        rejectedAt: first.rejectedAt,
        diagnostics: first.diagnostics.map(({ code, stage }) => ({ code, stage }))
      }));
    }
    expect(first.status).toBe('ready');
    expect(second).toEqual(first);

    const applied = await applySemanticMutation(workspaceRoot, {
      ...input,
      expectedPlanRevision: first.planRevision
    });
    expect(applied.status).toBe('terminal');
    if (applied.status !== 'terminal') throw new Error(JSON.stringify(applied));
    if (applied.result.status !== 'accepted') throw new Error(JSON.stringify(applied.result));
    expect(applied.result.status).toBe('accepted');
    expect(applied.result.verification).toMatchObject({
      adapterId: 'semantic-mutation-local-verification',
      adapterRevision: 'semantic-mutation-local-verification-v2',
      planRevision: first.planRevision,
      attempted: first.staged,
      stagedSourceDigest: first.sourceChanges[0].stagedByteDigest,
      requiredVerificationDigest: semanticMutationRequiredVerificationDigest(first.requiredVerification),
      status: 'passed'
    });
    expect(applied.result.verification.reportRevision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(applied.result.verification.verificationExecutionRevision)
      .toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await readFile(sourcePath, 'utf8')).toContain('from: open');

    const sourceAfterFirstApply = await readFile(sourcePath);
    const replay = await applySemanticMutation(workspaceRoot, {
      ...input,
      expectedPlanRevision: first.planRevision
    });
    expect(replay).toEqual(applied);
    expect(await readFile(sourcePath)).toEqual(sourceAfterFirstApply);
    const record = await querySemanticMutationRequest(workspaceRoot, {
      graphId: request.graphId,
      appId: request.appId,
      requestId: request.requestId
    });
    expect(record).toMatchObject({
      formatRevision: 'semantic-mutation-request-record-view-v1',
      recordKind: 'transaction',
      identity: {
        graphId: request.graphId,
        appId: request.appId,
        requestId: request.requestId
      },
      state: 'verified',
      result: { status: 'accepted' }
    });
    if (!record) throw new Error('Expected retained public request record view');
    expect(Object.keys(record)).not.toContain('request');
    expect(Object.keys(record)).not.toContain('authorization');
    expect(Object.keys(record)).not.toContain('plan');
    expect(Object.keys(record)).not.toContain('relativePath');
    expect(Object.keys(record)).not.toContain('beforeByteDigest');
    expect(Object.keys(record)).not.toContain('committedByteDigest');
    expect(JSON.stringify(record)).not.toContain('snapshot');
    expect(JSON.stringify(record)).not.toContain(AUTHORING_SOURCE);
    expect(Object.isFrozen(record)).toBe(true);

    const collision = await applySemanticMutation(workspaceRoot, {
      ...input,
      request: {
        ...request,
        additionalVerification: [{ kind: 'pass', passId: 'verify' }]
      },
      expectedPlanRevision: first.planRevision
    });
    expect(collision.status).toBe('request-rejected');
    if (collision.status !== 'request-rejected') throw new Error(JSON.stringify(collision));
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SEMANTIC-MUTATION-001',
      stage: 'request'
    }));
    expect(await readFile(sourcePath)).toEqual(sourceAfterFirstApply);
    expect(await querySemanticMutationRequest(workspaceRoot, {
      graphId: request.graphId,
      appId: request.appId,
      requestId: request.requestId
    })).toEqual(record);
    expect(await querySemanticMutationRequest(workspaceRoot, {
      graphId: request.graphId,
      appId: request.appId,
      requestId: 'request:missing'
    })).toBeNull();
  }, 'sm3-');
}, SM3_PRODUCTION_TEST_TIMEOUT_MS);

test('SM-3 public dry-run blocks on unfinished recovery authority without publishing live source', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixture = await coordinatorFailureFixture(workspaceRoot, 'request:dry-run-recovery-guard');
    const sourceBeforeCrash = await readFile(fixture.sourcePath);
    await expect(applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
      ...FAILURE_MATRIX_TEST_DEPENDENCIES,
      verify: async (derived) => verificationExecution(derived, 'passed'),
      appendRecoveryRecord: async (
        ...args: Parameters<typeof appendSemanticMutationRecoveryRecord>
      ) => {
        const record = await appendSemanticMutationRecoveryRecord(...args);
        if (args[1].state === 'prepared') {
          throw new Error('injected crash after prepared recovery authority');
        }
        return record;
      }
    })).rejects.toThrow('injected crash after prepared recovery authority');

    const recordsBeforePlanning = await loadSemanticMutationRecoveryRecords(fixture.transactionRoot);
    expect(recordsBeforePlanning.map(({ state }) => state)).toEqual(['prepared']);
    expect(await readFile(fixture.sourcePath)).toEqual(sourceBeforeCrash);

    const { expectedPlanRevision: _expectedPlanRevision, ...planningInput } = fixture.input;
    await expect(planSemanticMutationTransaction(workspaceRoot, planningInput)).rejects.toThrow(
      'Semantic Mutation planning is blocked by unfinished or recovery-required workspace state'
    );

    expect(await readFile(fixture.sourcePath)).toEqual(sourceBeforeCrash);
    expect(await loadSemanticMutationRecoveryRecords(fixture.transactionRoot)).toEqual(recordsBeforePlanning);
  }, 'sm3-planning-recovery-guard-');
}, 600_000);

test('SM-3 coordinator pre-publish failure matrix preserves every live byte and stops later producers', async () => {
  await withTempWorkspace(async (root) => {
    const createCase = async (label: string): Promise<{
      readonly workspaceRoot: string;
      readonly fixture: CoordinatorFailureFixture;
      readonly before: readonly WorkspaceByteEntry[];
    }> => {
      const workspaceRoot = path.join(root, label);
      const fixture = await coordinatorFailureFixture(workspaceRoot, `request:${label}`);
      const before = await liveWorkspaceByteSnapshot(workspaceRoot);
      const paths = before.map(({ relativePath }) => relativePath);
      expect(paths).toContain('control/state/graph.lock.json');
      expect(paths).toContain('control/provenance/failure-matrix-projection.json');
      expect(paths).toContain('project/generated/failure-matrix-artifact.bin');
      expect(paths).toContain('control/evidence/failure-matrix-note.txt');
      return { workspaceRoot, fixture, before };
    };

    {
      const { workspaceRoot, fixture, before } = await createCase('derive-early-reject');
      const calls = { derive: 0, verify: 0, artifacts: 0, append: 0, publish: 0, rebuild: 0 };
      const staleInput: SemanticMutationApplyInput = {
        ...fixture.input,
        request: {
          ...fixture.input.request,
          base: {
            ...fixture.input.request.base,
            semanticRevision: `sha256:${'f'.repeat(64)}`
          }
        }
      };
      const outcome = await applySemanticMutationWithTestDependencies(workspaceRoot, staleInput, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        derive: async (...args: Parameters<typeof deriveStagedSemanticMutation>) => {
          calls.derive += 1;
          return deriveStagedSemanticMutation(...args);
        },
        verify: async () => {
          calls.verify += 1;
          throw new Error('later verification producer must not run');
        },
        writeTransactionArtifacts: async () => {
          calls.artifacts += 1;
          throw new Error('later transaction-artifact producer must not run');
        },
        appendRecoveryRecord: async () => {
          calls.append += 1;
          throw new Error('later recovery journal must not run');
        },
        publishSource: async () => {
          calls.publish += 1;
          throw new Error('later publish must not run');
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('later live rebuild must not run');
        }
      });
      expect(outcome.status).toBe('terminal');
      if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
      expect(outcome.result).toMatchObject({
        status: 'rejected',
        diagnostics: [expect.objectContaining({ code: 'SEMANTIC-MUTATION-002', stage: 'base' })]
      });
      expect(calls).toEqual({ derive: 1, verify: 0, artifacts: 0, append: 0, publish: 0, rebuild: 0 });
      expect(await liveWorkspaceByteSnapshot(workspaceRoot)).toEqual(before);
    }

    for (const verificationStatus of ['failed', 'blocked'] as const) {
      const { workspaceRoot, fixture, before } = await createCase(`verification-${verificationStatus}`);
      const calls = { verify: 0, artifacts: 0, append: 0, publish: 0, rebuild: 0 };
      const outcome = await applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          return verificationExecution(derived, verificationStatus);
        },
        writeTransactionArtifacts: async () => {
          calls.artifacts += 1;
          throw new Error('transaction artifacts must not run after verification rejection');
        },
        appendRecoveryRecord: async () => {
          calls.append += 1;
          throw new Error('prepared journal must not run after verification rejection');
        },
        publishSource: async () => {
          calls.publish += 1;
          throw new Error('publish must not run after verification rejection');
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('live rebuild must not run after verification rejection');
        }
      });
      expect(outcome.status).toBe('terminal');
      if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
      expect(outcome.result).toMatchObject({
        status: 'rejected',
        verification: { status: verificationStatus },
        diagnostics: [expect.objectContaining({
          code: 'SEMANTIC-MUTATION-010',
          stage: 'impact-verification'
        })]
      });
      expect(calls).toEqual({ verify: 1, artifacts: 0, append: 0, publish: 0, rebuild: 0 });
      expect(await liveWorkspaceByteSnapshot(workspaceRoot)).toEqual(before);
    }

    {
      const { workspaceRoot, fixture, before } = await createCase('transaction-artifact-failure');
      const calls = { verify: 0, artifacts: 0, append: 0, publish: 0, rebuild: 0 };
      await expect(applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          return verificationExecution(derived, 'passed');
        },
        writeTransactionArtifacts: async () => {
          calls.artifacts += 1;
          throw new Error('injected transaction-artifact failure');
        },
        appendRecoveryRecord: async () => {
          calls.append += 1;
          throw new Error('prepared journal must not run after transaction-artifact failure');
        },
        publishSource: async () => {
          calls.publish += 1;
          throw new Error('publish must not run after transaction-artifact failure');
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('live rebuild must not run after transaction-artifact failure');
        }
      })).rejects.toThrow('injected transaction-artifact failure');
      expect(calls).toEqual({ verify: 1, artifacts: 1, append: 0, publish: 0, rebuild: 0 });
      expect(await liveWorkspaceByteSnapshot(workspaceRoot)).toEqual(before);
    }

    {
      const { workspaceRoot, fixture, before } = await createCase('prepared-journal-failure');
      const calls = { verify: 0, artifacts: 0, appendStates: [] as string[], publish: 0, rebuild: 0 };
      await expect(applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          return verificationExecution(derived, 'passed');
        },
        writeTransactionArtifacts: async (
          ...args: Parameters<typeof writeSemanticMutationTransactionArtifacts>
        ) => {
          calls.artifacts += 1;
          return writeSemanticMutationTransactionArtifacts(...args);
        },
        appendRecoveryRecord: async (
          ...args: Parameters<typeof appendSemanticMutationRecoveryRecord>
        ) => {
          calls.appendStates.push(args[1].state);
          throw new Error('injected prepared-journal failure');
        },
        publishSource: async () => {
          calls.publish += 1;
          throw new Error('publish must not run after prepared-journal failure');
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('live rebuild must not run after prepared-journal failure');
        }
      })).rejects.toThrow('injected prepared-journal failure');
      expect(calls).toEqual({
        verify: 1,
        artifacts: 1,
        appendStates: ['prepared'],
        publish: 0,
        rebuild: 0
      });
      expect(await liveWorkspaceByteSnapshot(workspaceRoot)).toEqual(before);
    }

    {
      const { workspaceRoot, fixture, before } = await createCase('publish-failure');
      const calls = { verify: 0, artifacts: 0, appendStates: [] as string[], publish: 0, rebuild: 0 };
      const outcome = await applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          return verificationExecution(derived, 'passed');
        },
        writeTransactionArtifacts: async (
          ...args: Parameters<typeof writeSemanticMutationTransactionArtifacts>
        ) => {
          calls.artifacts += 1;
          return writeSemanticMutationTransactionArtifacts(...args);
        },
        appendRecoveryRecord: async (
          ...args: Parameters<typeof appendSemanticMutationRecoveryRecord>
        ) => {
          calls.appendStates.push(args[1].state);
          return appendSemanticMutationRecoveryRecord(...args);
        },
        publishSource: async () => {
          calls.publish += 1;
          throw new Error('injected atomic publish failure');
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('live rebuild must not run after publish failure');
        }
      });
      expect(outcome.status).toBe('terminal');
      if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
      expect(outcome.result).toMatchObject({
        status: 'rejected',
        diagnostics: [expect.objectContaining({ code: 'SEMANTIC-MUTATION-011', stage: 'publish' })]
      });
      expect(calls).toEqual({
        verify: 1,
        artifacts: 1,
        appendStates: ['prepared'],
        publish: 1,
        rebuild: 0
      });
      expect(await liveWorkspaceByteSnapshot(workspaceRoot)).toEqual(before);
    }
  }, 'sm3-pre-');
}, 600_000);

test('SM-3 acceptance-not-executed stays blocked and never publishes staged writes', async () => {
  // 1B-4 reverse invariant: when acceptance truth cannot be executed (canonical
  // blocked/not-run/invalidated verification), the mutation must be rejected as
  // blocked, no transaction artifact/journal/publish/rebuild producer may run,
  // and the live workspace must remain byte-identical (staged writes uncommitted).
  await withTempWorkspace(async (workspaceRoot) => {
    const fixture = await coordinatorFailureFixture(
      workspaceRoot,
      'request:acceptance-not-executed'
    );
    const before = await liveWorkspaceByteSnapshot(workspaceRoot);
    const calls = { verify: 0, artifacts: 0, append: 0, publish: 0, rebuild: 0 };
    const outcome = await applySemanticMutationWithTestDependencies(
      workspaceRoot,
      fixture.input,
      {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          return verificationExecution(derived, 'blocked');
        },
        writeTransactionArtifacts: async () => {
          calls.artifacts += 1;
          throw new Error('transaction artifacts must not run after blocked verification');
        },
        appendRecoveryRecord: async () => {
          calls.append += 1;
          throw new Error('prepared journal must not run after blocked verification');
        },
        publishSource: async () => {
          calls.publish += 1;
          throw new Error('publish must not run after blocked verification');
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('live rebuild must not run after blocked verification');
        }
      }
    );
    expect(outcome.status).toBe('terminal');
    if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
    expect(outcome.result).toMatchObject({
      status: 'rejected',
      verification: { status: 'blocked' },
      diagnostics: [expect.objectContaining({
        code: 'SEMANTIC-MUTATION-010',
        stage: 'impact-verification'
      })]
    });
    expect(calls).toEqual({ verify: 1, artifacts: 0, append: 0, publish: 0, rebuild: 0 });
    expect(await liveWorkspaceByteSnapshot(workspaceRoot)).toEqual(before);
  }, 'sm3-acceptance-not-executed-');
}, 600_000);

test('SM-3 coordinator post-publish restore and journal failures become durable recovery-required', async () => {
  await withTempWorkspace(async (root) => {
    const createCase = async (label: string) => {
      const workspaceRoot = path.join(root, label);
      const fixture = await coordinatorFailureFixture(workspaceRoot, `request:${label}`);
      return {
        workspaceRoot,
        fixture,
        before: await liveWorkspaceByteSnapshot(workspaceRoot)
      };
    };
    const expectOnlyAuthoringSourceChanged = async (
      workspaceRoot: string,
      before: readonly WorkspaceByteEntry[]
    ): Promise<void> => {
      const withoutAuthoringSource = (entries: readonly WorkspaceByteEntry[]) =>
        entries.filter(({ relativePath }) => relativePath !== 'source/model/item.yaml');
      expect(withoutAuthoringSource(await liveWorkspaceByteSnapshot(workspaceRoot)))
        .toEqual(withoutAuthoringSource(before));
    };
    const expectRecovery = async (
      workspaceRoot: string,
      fixture: CoordinatorFailureFixture,
      states: readonly SemanticMutationRecoveryState[],
      recoveryState: 'rollback-failed' | 'rebuild-failed'
    ): Promise<void> => {
      expect((await loadSemanticMutationRecoveryRecords(fixture.transactionRoot)).map(({ state }) => state))
        .toEqual([...states]);
      expect(await querySemanticMutationRequest(workspaceRoot, fixture.identity)).toMatchObject({
        state: 'recovery-required',
        recoveryState,
        result: { status: 'recovery-required', recoveryState }
      });
    };

    {
      const { workspaceRoot, fixture, before } = await createCase('restore-failure');
      const calls = {
        verify: 0,
        appendStates: [] as string[],
        publish: 0,
        rebuild: 0,
        restore: 0
      };
      const outcome = await applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          return verificationExecution(derived, 'passed');
        },
        appendRecoveryRecord: async (
          ...args: Parameters<typeof appendSemanticMutationRecoveryRecord>
        ) => {
          calls.appendStates.push(args[1].state);
          return appendSemanticMutationRecoveryRecord(...args);
        },
        publishSource: async (...args: Parameters<typeof atomicPublishSemanticMutationSource>) => {
          calls.publish += 1;
          return atomicPublishSemanticMutationSource(...args);
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('injected post-publish rebuild failure');
        },
        restoreSource: async () => {
          calls.restore += 1;
          throw new Error('injected atomic restore failure');
        }
      });
      expect(outcome.status).toBe('terminal');
      if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
      expect(outcome.result).toMatchObject({ status: 'recovery-required', recoveryState: 'rollback-failed' });
      expect(calls).toEqual({
        verify: 1,
        appendStates: ['prepared', 'authoring-committed', 'recovery-required'],
        publish: 1,
        rebuild: 1,
        restore: 1
      });
      expect(await readFile(fixture.sourcePath, 'utf8')).toContain('from: open');
      await expectOnlyAuthoringSourceChanged(workspaceRoot, before);
      await expectRecovery(
        workspaceRoot,
        fixture,
        ['prepared', 'authoring-committed', 'recovery-required'],
        'rollback-failed'
      );
    }

    {
      const { workspaceRoot, fixture, before } = await createCase('authoring-committed-journal-failure');
      const calls = {
        verify: 0,
        appendStates: [] as string[],
        publish: 0,
        rebuild: 0,
        restore: 0
      };
      let failedOnce = false;
      const outcome = await applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          return verificationExecution(derived, 'passed');
        },
        appendRecoveryRecord: async (
          ...args: Parameters<typeof appendSemanticMutationRecoveryRecord>
        ) => {
          const state = args[1].state;
          calls.appendStates.push(state);
          if (state === 'authoring-committed' && !failedOnce) {
            failedOnce = true;
            throw new Error('injected authoring-committed journal failure');
          }
          return appendSemanticMutationRecoveryRecord(...args);
        },
        publishSource: async (...args: Parameters<typeof atomicPublishSemanticMutationSource>) => {
          calls.publish += 1;
          return atomicPublishSemanticMutationSource(...args);
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          throw new Error('live rebuild must not run after authoring journal failure');
        },
        restoreSource: async () => {
          calls.restore += 1;
          throw new Error('restore must not run after authoring journal failure');
        }
      });
      expect(outcome.status).toBe('terminal');
      if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
      expect(outcome.result).toMatchObject({ status: 'recovery-required', recoveryState: 'rebuild-failed' });
      expect(calls).toEqual({
        verify: 1,
        appendStates: ['prepared', 'authoring-committed', 'recovery-required'],
        publish: 1,
        rebuild: 0,
        restore: 0
      });
      expect(await readFile(fixture.sourcePath, 'utf8')).toContain('from: open');
      await expectOnlyAuthoringSourceChanged(workspaceRoot, before);
      await expectRecovery(workspaceRoot, fixture, ['prepared', 'recovery-required'], 'rebuild-failed');
    }

    {
      const { workspaceRoot, fixture, before } = await createCase('verified-journal-failure');
      const calls = {
        verify: 0,
        appendStates: [] as string[],
        publish: 0,
        rebuild: 0,
        restore: 0
      };
      let staged: ReadyMutationPlan | undefined;
      let failedOnce = false;
      const outcome = await applySemanticMutationWithTestDependencies(workspaceRoot, fixture.input, {
        ...FAILURE_MATRIX_TEST_DEPENDENCIES,
        verify: async (derived: ReadyDerivedMutation) => {
          calls.verify += 1;
          staged = derived.plan;
          return verificationExecution(derived, 'passed');
        },
        appendRecoveryRecord: async (
          ...args: Parameters<typeof appendSemanticMutationRecoveryRecord>
        ) => {
          const state = args[1].state;
          calls.appendStates.push(state);
          if (state === 'verified' && !failedOnce) {
            failedOnce = true;
            throw new Error('injected verified journal failure');
          }
          return appendSemanticMutationRecoveryRecord(...args);
        },
        publishSource: async (...args: Parameters<typeof atomicPublishSemanticMutationSource>) => {
          calls.publish += 1;
          return atomicPublishSemanticMutationSource(...args);
        },
        rebuildLive: async () => {
          calls.rebuild += 1;
          if (!staged) throw new Error('verification did not bind the staged plan');
          return staged.staged;
        },
        restoreSource: async () => {
          calls.restore += 1;
          throw new Error('verified journal failure must not trigger rollback');
        }
      });
      expect(outcome.status).toBe('terminal');
      if (outcome.status !== 'terminal') throw new Error(JSON.stringify(outcome));
      expect(outcome.result).toMatchObject({
        status: 'recovery-required',
        recoveryState: 'rebuild-failed',
        diagnostics: [expect.objectContaining({
          code: 'SEMANTIC-MUTATION-012',
          message: 'Committed source could not durably finalize its verified journal state'
        })]
      });
      expect(calls).toEqual({
        verify: 1,
        appendStates: ['prepared', 'authoring-committed', 'verified', 'recovery-required'],
        publish: 1,
        rebuild: 1,
        restore: 0
      });
      expect(await readFile(fixture.sourcePath, 'utf8')).toContain('from: open');
      await expectOnlyAuthoringSourceChanged(workspaceRoot, before);
      await expectRecovery(
        workspaceRoot,
        fixture,
        ['prepared', 'authoring-committed', 'recovery-required'],
        'rebuild-failed'
      );
    }
  }, 'sm3-post-');
}, 600_000);
