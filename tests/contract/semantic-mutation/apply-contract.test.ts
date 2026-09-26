import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  type PipelineExecutionContext
} from '../../../src/adapters/compilation-protocol/types.ts';
import { semanticMutationTransactionRoot } from '../../../src/adapters/mutation/transaction-identity.ts';
import { planSemanticMutationVerificationCapabilities } from '../../../src/adapters/verification/semantic-mutation/verification.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../../src/assurance/verification/semantic-mutation/execution-ref.ts';
import {
  isolatedVerificationEvidenceDigest,
  type IsolatedVerificationEvidence
} from '../../../src/assurance/verification/semantic-mutation/isolated/evidence.ts';
import { assertSemanticMutationVerificationReportInvariant } from '../../../src/assurance/verification/semantic-mutation/report-contract.ts';
import { executeSemanticMutationVerification } from '../../../src/assurance/verification/semantic-mutation/verification-runtime.ts';
import { applySemanticMutation } from '../../../src/bootstrap/engineering/cli.ts';
import { sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';
import type { IsolatedVerificationCapability } from '../../../src/execution/isolated-verification-capability.ts';
import { type SemanticMutationApplyOutcome, type SemanticMutationRequestRecordView } from '../../../src/semantics/mutation/transaction.ts';
import { isSemanticMutationStagingWorkspace } from '../../../src/workspace/contract/semantic-mutation/staging.ts';

test('semantic mutation staging layout is exactly the canonical transaction workspace', () => {
  const workspaceRoot = path.resolve('contract-workspace');
  const digest = sha256('canonical-transaction-layout');
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, digest);
  const transactionName = digest.slice('sha256:'.length);
  expect(transactionRoot).toBe(path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    transactionName
  ));
  expect(isSemanticMutationStagingWorkspace(path.join(transactionRoot, 'workspace'))).toBe(true);
  expect(isSemanticMutationStagingWorkspace(path.join(workspaceRoot, '.sec', 's', transactionName))).toBe(false);
  expect(isSemanticMutationStagingWorkspace(path.join(transactionRoot, 'staging'))).toBe(false);
  expect(isSemanticMutationStagingWorkspace(path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'not-a-digest',
    'workspace'
  ))).toBe(false);
});

test('ordinary malformed requests return the exact redacted request-rejected outcome before lease acquisition', async () => {
  const outcome = await applySemanticMutation('Z:\\must-not-be-observed', {
    request: { contractVersion: '1', requestId: 'request:malformed' }
  } as never);
  expect(Object.keys(outcome)).toEqual([
    'status', 'requestId', 'requestRevision', 'diagnostics', 'diagnosticRevision'
  ]);
  expect(outcome).toMatchObject({
    status: 'request-rejected',
    requestId: 'request:malformed',
    requestRevision: ''
  });
  if (outcome.status !== 'request-rejected') throw new Error(JSON.stringify(outcome));
  expect(outcome.diagnostics).toHaveLength(1);
  expect(JSON.stringify(outcome)).not.toContain('Z:\\must-not-be-observed');
  expect(outcome.diagnosticRevision).toBe(sha256({
    domain: 'semantic-mutation-diagnostic-v2',
    diagnostics: outcome.diagnostics
  }));
});

test('Verification adapter emits the exact frozen report and execution binding, and forged unions never run', async () => {
  const inputRevision = sha256('input');
  const semanticRevision = sha256('semantic');
  const snapshot = {
    ir: { inputRevision, semanticRevision, entities: [], facts: [] }
  } as never;
  const requirements = [{ kind: 'pass' as const, passId: 'verify' }];
  const isolationCapabilityProbe = () => ({ status: 'available' });
  const capabilityPlan = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements,
    isolationCapabilityProbe
  });
  const attempted = { transactionId: 'tx:staged', inputRevision, semanticRevision };
  const planRevision = sha256('plan');
  const stagedSourceDigest = sha256('staged-source');
  const requiredVerificationDigest = sha256({
    domain: 'semantic-mutation-required-verification-v1',
    requirements
  });
  let calls = 0;
  const runner = (runnerInput: unknown) => {
    calls += 1;
    expect(Object.isFrozen(runnerInput)).toBe(true);
    expect(Object.keys(runnerInput as object)).toEqual([
      'runner', 'planRevision', 'attempted', 'stagedSourceDigest',
      'requiredVerificationDigest', 'requirements'
    ]);
    return { status: 'passed' as const, evidenceDigest: sha256('verify-all') };
  };
  const report = await executeSemanticMutationVerification({
    capabilityPlan,
    requirements,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner);
  expect(calls).toBe(1);
  expect(Object.keys(report)).toEqual([
    'formatRevision', 'adapterId', 'adapterRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'executions', 'status', 'reportRevision'
  ]);
  expect(Object.keys(report.executions[0]!)).toEqual([
    'requirement', 'runner', 'status', 'evidenceDigest'
  ]);
  const { reportRevision, ...withoutReportRevision } = report;
  expect(reportRevision).toBe(sha256({
    domain: 'semantic-mutation-verification-report-v1',
    ...withoutReportRevision
  }));
  expect(() => assertSemanticMutationVerificationReportInvariant(report)).not.toThrow();

  for (const key of ['inputRevision', 'semanticRevision'] as const) {
    let coercions = 0;
    const candidate = { ...report, attempted: { ...report.attempted,
      [key]: { toString() { coercions++; return report.attempted[key]; } } } };
    expect(() => assertSemanticMutationVerificationReportInvariant(candidate)).toThrow();
    expect(coercions).toBe(0);
    await expect(executeSemanticMutationVerification({ capabilityPlan, requirements,
      planRevision, attempted: candidate.attempted as never, stagedSourceDigest,
      requiredVerificationDigest }, runner)).rejects.toThrow('invalid or blocked');
    expect(coercions).toBe(0);
    expect(calls).toBe(1);
  }
  for (const key of ['planRevision', 'stagedSourceDigest', 'requiredVerificationDigest'] as const) {
    let coercions = 0;
    expect(() => assertSemanticMutationVerificationReportInvariant({ ...report,
      [key]: { toString() { coercions++; return report[key]; } } })).toThrow();
    expect(coercions).toBe(0);
    expect(() => assertSemanticMutationVerificationReportInvariant({ ...report,
      [key]: `blake3:${'a'.repeat(64)}` })).toThrow();
  }

  const execution = buildSemanticMutationVerificationExecutionRef(report);
  expect(Object.keys(execution)).toEqual([
    'adapterId', 'adapterRevision', 'reportRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'status', 'verificationExecutionRevision'
  ]);
  expect(() => buildSemanticMutationVerificationExecutionRef({
    ...report,
    reportRevision: sha256('forged-report-revision')
  })).toThrow('revision is stale or forged');
  expect(() => buildSemanticMutationVerificationExecutionRef({
    ...report,
    forgedExtra: true
  } as never)).toThrow('non-canonical schema');

  await expect(executeSemanticMutationVerification({
    capabilityPlan,
    requirements,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest: sha256('forged-union')
  }, runner)).rejects.toThrow('invalid or blocked');
  expect(calls).toBe(1);

  await expect(executeSemanticMutationVerification({
    capabilityPlan,
    requirements,
    planRevision,
    attempted: { ...attempted, transactionId: '' },
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  const nonShaEndpointPlan = structuredClone(capabilityPlan) as unknown as Record<string, unknown>;
  nonShaEndpointPlan.snapshotInputRevision = 'not-a-sha256-revision';
  delete nonShaEndpointPlan.capabilityPlanRevision;
  nonShaEndpointPlan.capabilityPlanRevision = sha256({
    domain: 'semantic-mutation-verification-capability-plan-v1',
    ...nonShaEndpointPlan
  });
  await expect(executeSemanticMutationVerification({
    capabilityPlan: nonShaEndpointPlan as never,
    requirements,
    planRevision,
    attempted: { ...attempted, inputRevision: 'not-a-sha256-revision' },
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  await expect(executeSemanticMutationVerification({
    capabilityPlan,
    requirements: [{ ...requirements[0]!, forgedExtra: true }] as never,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  expect(calls).toBe(1);

  const forgedCapabilityPlan = structuredClone(capabilityPlan) as unknown as Record<string, unknown>;
  const forgedCapabilities = forgedCapabilityPlan.capabilities as Array<Record<string, unknown>>;
  forgedCapabilities[0] = { ...forgedCapabilities[0], isolated: false };
  delete forgedCapabilityPlan.capabilityPlanRevision;
  forgedCapabilityPlan.capabilityPlanRevision = sha256({
    domain: 'semantic-mutation-verification-capability-plan-v1',
    ...forgedCapabilityPlan
  });
  await expect(executeSemanticMutationVerification({
    capabilityPlan: forgedCapabilityPlan as never,
    requirements,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  expect(calls).toBe(1);

  const externalEffectPlan = await planSemanticMutationVerificationCapabilities({
    snapshot: {
      ir: {
        inputRevision,
        semanticRevision,
        entities: [{
          id: 'effect:external',
          kind: 'effect',
          label: 'External call',
          attributes: [{ key: 'effectKind', value: 'external-service-call' }]
        }],
        facts: []
      }
    } as never,
    requirements,
    isolationCapabilityProbe
  });
  expect(externalEffectPlan.status).toBe('blocked');
  expect(externalEffectPlan.capabilities[0]).toMatchObject({
    status: 'non-runnable',
    isolated: false
  });
});

test('compile-time boundaries reject lease-free Pipeline contexts and raw journal fields in public views', () => {
  const outcome = {} as SemanticMutationApplyOutcome;
  const view = {} as SemanticMutationRequestRecordView;
  type TransactionView = Extract<SemanticMutationRequestRecordView, { readonly recordKind: 'transaction' }>;
  type ActiveView = TransactionView & { readonly state: 'prepared' | 'authoring-committed' };
  if (false) {
    // @ts-expect-error Isolated Verification authority cannot be forged structurally.
    const forgedIsolationCapability: IsolatedVerificationCapability = {};
    // @ts-expect-error Every manual Pipeline execution context must carry the exact writer lease token.
    const leaseFree: PipelineExecutionContext = { transactionId: 'tx:test', source: 'api' };
    // @ts-expect-error Public request-record views never expose retained source paths.
    const pathLeak: string = view.relativePath;
    // @ts-expect-error Public request-record views never expose retained before bytes/digests.
    const beforeLeak: string = view.beforeByteDigest;
    // @ts-expect-error Apply outcomes are discriminated; a rejection has no terminal result.
    const result = outcome.result;
    const prepared = {} as ActiveView & { readonly state: 'prepared' };
    const authoringCommitted = {} as ActiveView & { readonly state: 'authoring-committed' };
    const verified = {} as TransactionView & { readonly state: 'verified' };
    const rolledBack = {} as TransactionView & { readonly state: 'rolled-back' };
    const recoveryRequired = {} as TransactionView & { readonly state: 'recovery-required' };
    // @ts-expect-error Prepared views never carry terminal completion order.
    const invalidPrepared: TransactionView = { ...prepared, terminalSequence: 1 };
    // @ts-expect-error Authoring-committed views never carry terminal results.
    const invalidAuthoringCommitted: TransactionView = { ...authoringCommitted, result: verified.result };
    // @ts-expect-error Verified views never carry recovery failure state.
    const invalidVerified: TransactionView = { ...verified, recoveryState: 'concurrent-write' };
    // @ts-expect-error Rolled-back views require a rolled-back result.
    const invalidRolledBack: TransactionView = { ...rolledBack, result: verified.result };
    // @ts-expect-error Recovery-required views never carry terminal completion order.
    const invalidRecoveryRequired: TransactionView = { ...recoveryRequired, terminalSequence: 1 };
    const { recoveryState: omittedRecoveryState, ...recoveryWithoutState } = recoveryRequired;
    // @ts-expect-error Recovery-required views require their matching recovery state.
    const invalidRecoveryWithoutState: TransactionView = recoveryWithoutState;
    void forgedIsolationCapability;
    void leaseFree;
    void pathLeak;
    void beforeLeak;
    void result;
    void invalidPrepared;
    void invalidAuthoringCommitted;
    void invalidVerified;
    void invalidRolledBack;
    void invalidRecoveryRequired;
    void invalidRecoveryWithoutState;
    void omittedRecoveryState;
  }
  expect(true).toBe(true);
});

test('SM-3 digest domains remain independently reproducible', () => {
  const requirements = [{ kind: 'pass', passId: 'verify' }] as const;
  expect(sha256({
    domain: 'semantic-mutation-required-verification-v1',
    requirements
  })).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(sha256({
    domain: 'semantic-mutation-request-identity-v1',
    graphId: 'graph:1',
    appId: 'app:1',
    requestId: 'request:1'
  })).not.toBe(sha256({
    domain: 'semantic-mutation-verification-report-v1',
    graphId: 'graph:1',
    appId: 'app:1',
    requestId: 'request:1'
  }));
});

test('isolated Verification evidence digest is deterministic and distinguishes failure state', () => {
  const passed = {
    status: 'passed',
    artifacts: {
      rawDigests: {
        acceptanceCoverage: `sha256:${'a'.repeat(64)}`,
        policyReport: `sha256:${'b'.repeat(64)}`,
        runtimeReport: `sha256:${'c'.repeat(64)}`,
        verificationReport: `sha256:${'d'.repeat(64)}`
      },
      semanticBundle: {
        snapshot: {
          ir: {
            inputRevision: `sha256:${'1'.repeat(64)}`,
            semanticRevision: `sha256:${'2'.repeat(64)}`
          }
        }
      },
      verificationReport: {
        summary: { status: 'passed', requestedLane: 'all', failedLanes: [] },
        build: { status: 'passed' },
        unit: { status: 'passed', passed: ['unit'] },
        acceptance: { status: 'passed', passed: ['acceptance'], failed: [] },
        policy: { status: 'skipped', violations: [] },
        runtime: {
          status: 'passed',
          build: {
            status: 'passed', passed: ['build'], failed: [], command: 'bun run build'
          },
          unit: {
            status: 'passed', passed: ['unit'], failed: [], command: 'bun run test:unit'
          },
          acceptance: {
            status: 'passed', passed: ['acceptance'], failed: [],
            command: 'bun run test:acceptance'
          }
        }
      }
    }
  } as unknown as Extract<
    IsolatedVerificationEvidence,
    { readonly status: 'passed' }
  >;
  const passedDigest = isolatedVerificationEvidenceDigest(passed);
  const equivalentPassedDigest = isolatedVerificationEvidenceDigest(
    structuredClone(passed)
  );
  const blockedDigest = isolatedVerificationEvidenceDigest({
    status: 'blocked',
    failure: { stage: 'binding-mismatch' }
  });
  expect(passedDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(equivalentPassedDigest).toBe(passedDigest);
  expect(blockedDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(blockedDigest).not.toBe(passedDigest);
});
