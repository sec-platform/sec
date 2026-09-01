import { expect, test } from 'bun:test';

import { RetainedCommandTransportError } from '../../runtime-state/physical/runtime/process.ts';
import {
  PhysicalResourceCompositeSettlementError,
  settlePhysicalResources
} from '../../runtime-state/physical/runtime/resource-settlement.ts';
import {
  compileRepositoryAuditWorkerDiagnostic,
  executeSupervisedWorkingTreeSourceProgramAudit
} from './cli.ts';

const digest = `sha256:${'0'.repeat(64)}` as const;

test('repository audit worker uses one retained process session and closes its actual output ledger', async () => {
  const execution = await executeSupervisedWorkingTreeSourceProgramAudit(['--query']);

  expect(execution.status).toBe('completed');
  if (execution.status !== 'completed') return;
  expect(execution.code).not.toBe(0);
  expect(execution.resources.processCount).toBe(1);
  expect(execution.resources.failedProcessCount).toBe(0);
  expect(execution.resources.outputBytes).toBe(
    execution.stdout.byteLength + Buffer.byteLength(execution.stderr, 'utf8')
  );
  expect(execution.resources.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('repository audit worker cannot widen or outlive its parent deadline', async () => {
  const execution = await executeSupervisedWorkingTreeSourceProgramAudit(
    ['--worktree-module-topology'],
    1_000
  );

  expect(execution.status).toBe('denied');
  if (execution.status !== 'denied') return;
  expect(execution.diagnostic.authority).toBe('none-diagnostic-only');
  if (execution.diagnostic.reason === 'cancelled') {
    expect(execution.diagnostic.process?.status).toBe('aborted');
    expect(execution.diagnostic.resources).not.toBeNull();
    expect(execution.diagnostic.resources!.deadlineAtUnixMs).toBeLessThanOrEqual(Date.now());
  } else {
    expect([
      'deadline-exhausted',
      'process-settlement-unproven'
    ]).toContain(execution.diagnostic.reason);
  }
  expect(execution.diagnostic.resources?.processCount).toBe(1);
  expect(execution.diagnostic.resources!.deadlineAtUnixMs).toBeLessThanOrEqual(Date.now());
});

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

test('repository audit cleanup settles every retained resource and reports composite residue', () => {
  const primary = new Error('worker execution failed');
  const settled: string[] = [];
  let settlementError: unknown;
  try {
    settlePhysicalResources({
      primary: { label: 'worker execution', error: primary },
      cleanup: [
        {
          label: 'worker capability',
          settle: () => {
            settled.push('worker');
            throw new Error('worker disposal failed');
          }
        },
        {
          label: 'cwd capability',
          settle: () => { settled.push('cwd'); }
        },
        {
          label: 'executable capability',
          settle: () => {
            settled.push('executable');
            throw new Error('executable disposal failed');
          }
        }
      ]
    });
  } catch (error) {
    settlementError = error;
  }

  expect(settled).toEqual(['worker', 'cwd', 'executable']);
  expect(settlementError).toBeInstanceOf(PhysicalResourceCompositeSettlementError);
  if (!(settlementError instanceof PhysicalResourceCompositeSettlementError)) return;
  expect(settlementError.failures.map(({ label }) => label)).toEqual([
    'worker execution',
    'worker capability',
    'executable capability'
  ]);
  const primaryDiagnostic = compileRepositoryAuditWorkerDiagnostic(primary, null);
  const compositeDiagnostic = compileRepositoryAuditWorkerDiagnostic(settlementError, null);
  expect(compositeDiagnostic.reason).toBe('physical-boundary-unsettled');
  expect(compositeDiagnostic.detailDigest).not.toBe(primaryDiagnostic.detailDigest);
});
