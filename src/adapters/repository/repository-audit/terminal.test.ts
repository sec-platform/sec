import { expect, test } from 'bun:test';

import { ResourceCompositeSettlementError as PhysicalResourceCompositeSettlementError } from '../../../execution/resource-settlement.ts';
import { RetainedCommandTransportError } from '../../runtime-state/physical/runtime/process.ts';
import {
  compileRepositoryAuditWorkerDiagnostic
} from './cli.ts';
import { RepositoryAuditWorkerProtocolError } from './worker-protocol.ts';

const digest = `sha256:${'0'.repeat(64)}` as const;

test('repository audit diagnostic preserves lost-handle settlement as denial', () => {
  const error = new RetainedCommandTransportError('lost process handle', Object.freeze({
    status: 'timed-out' as const,
    trigger: 'timed-out' as const,
    started: true,
    exitCode: null,
    signal: null,
    durationMs: 1,
    stdout: Object.freeze({ bytes: 0, digest, observerTruncated: false }),
    stderr: Object.freeze({ bytes: 0, digest, observerTruncated: false }),
    termination: Object.freeze({
      requested: true,
      gracefulAttempted: true,
      forcedAttempted: true,
      childCloseObserved: false,
      streamsDrained: true,
      treeClosed: false
    })
  }));

  const diagnostic = compileRepositoryAuditWorkerDiagnostic(error, null);
  expect(diagnostic.status).toBe('denied');
  expect(diagnostic.reason).toBe('process-settlement-unproven');
  expect(diagnostic.process).toEqual(expect.objectContaining({
    childCloseObserved: false,
    streamsDrained: true,
    treeClosed: false
  }));
});

test('repository audit diagnostic distinguishes aggregate output exhaustion', () => {
  const error = new RetainedCommandTransportError('output budget exhausted', Object.freeze({
    status: 'observer-failed' as const,
    trigger: 'observer-failed' as const,
    started: true,
    exitCode: null,
    signal: null,
    durationMs: 1,
    stdout: Object.freeze({ bytes: 1, digest, observerTruncated: true }),
    stderr: Object.freeze({ bytes: 0, digest, observerTruncated: false }),
    termination: Object.freeze({
      requested: true,
      gracefulAttempted: true,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    })
  }));

  expect(compileRepositoryAuditWorkerDiagnostic(error, null).reason)
    .toBe('output-budget-exhausted');
});

test('repository audit diagnostic preserves typed protocol rejection', () => {
  const diagnostic = compileRepositoryAuditWorkerDiagnostic(
    new RepositoryAuditWorkerProtocolError('foreign-subject', 'subject differs'),
    null
  );
  expect(diagnostic).toEqual(expect.objectContaining({
    reason: 'protocol-invalid',
    failureKind: 'protocol-admission',
    protocolErrorCode: 'foreign-subject',
    process: null
  }));
});

test('repository audit diagnostic preserves primary failure plus cleanup residue', () => {
  const primary = new Error('worker execution failed');
  const settlementError = new PhysicalResourceCompositeSettlementError([
    { label: 'worker execution', error: primary },
    { label: 'worker capability', error: new Error('worker disposal failed') }
  ]);
  const primaryDiagnostic = compileRepositoryAuditWorkerDiagnostic(primary, null);
  const compositeDiagnostic = compileRepositoryAuditWorkerDiagnostic(settlementError, null);
  expect(compositeDiagnostic.reason).toBe('physical-boundary-unsettled');
  expect(compositeDiagnostic.detailDigest).not.toBe(primaryDiagnostic.detailDigest);
});
