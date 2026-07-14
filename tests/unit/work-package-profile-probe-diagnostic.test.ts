import { expect, test } from 'bun:test';

import type {
  ObservedCommandOptions,
  ObservedCommandOutcome
} from '../../platform/shared/observed-process.ts';
import {
  assertDiagnosticAttemptAvailable,
  assertPersistableProfileDiagnostic,
  workPackageProfileProbeEmptyDigestForTests
} from '../../scripts/diagnose-work-package-profile-probe.ts';
import {
  runWorkPackageProfileProbe
} from '../../scripts/work-package-profile-probe.ts';

function outcome(overrides: Partial<ObservedCommandOutcome> = {}): ObservedCommandOutcome {
  return Object.freeze({
    status: 'exited',
    started: true,
    exitCode: 0,
    signal: null,
    durationMs: 10,
    stdout: Object.freeze({
      bytes: 0,
      digest: workPackageProfileProbeEmptyDigestForTests,
      observerTruncated: false
    }),
    stderr: Object.freeze({
      bytes: 0,
      digest: workPackageProfileProbeEmptyDigestForTests,
      observerTruncated: false
    }),
    termination: Object.freeze({
      requested: false,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    }),
    ...overrides
  });
}

function nowSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

test('shared profile probe preserves the frozen invocation and redacts accepted identities', async () => {
  const rawIdentity = 'sec.sm3.private.profile';
  let command = '';
  let args: readonly string[] = [];
  let options: ObservedCommandOptions | undefined;
  const result = await runWorkPackageProfileProbe(30_000, {
    platform: 'win32',
    systemRoot: String.raw`C:\Windows`,
    monotonicNowMs: nowSequence(0, 10),
    runCommand: async (capturedCommand, capturedArgs, capturedOptions) => {
      command = capturedCommand;
      args = capturedArgs;
      options = capturedOptions;
      const bytes = Buffer.from(JSON.stringify({ disposition: 'observed', values: [rawIdentity] }));
      capturedOptions.onOutput?.('stdout', bytes);
      return outcome({
        stdout: Object.freeze({
          bytes: bytes.byteLength,
          digest: workPackageProfileProbeEmptyDigestForTests,
          observerTruncated: false
        })
      });
    }
  });

  expect(command).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
  expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
  expect(args[4]).toContain('OpenSubKey');
  expect(args[4]).toContain('reg query');
  expect(options).toMatchObject({
    cwd: String.raw`C:\Windows\System32`,
    envMode: 'replace',
    maxObservedOutputBytes: 1024 * 1024,
    timeoutMs: 22_500,
    terminationDeadlineMs: 7_500,
    terminationGraceMs: 5_000
  });
  expect(result.projectedProbe).toMatchObject({
    complete: true,
    reason: 'observed',
    identities: { count: 1 }
  });
  expect(result.diagnostic).toMatchObject({
    attempted: true,
    classification: 'observed',
    outerDeadlineExceeded: false,
    decode: { stage: 'accepted', disposition: 'observed', identities: { count: 1 } }
  });
  expect(JSON.stringify(result.diagnostic)).not.toContain(rawIdentity);
  expect(() => assertPersistableProfileDiagnostic(result.diagnostic)).not.toThrow();
});

test('shared profile probe keeps exit 7 and exit 11 as distinct path-free diagnoses', async () => {
  for (const [exitCode, classification] of [
    [7, 'reg-query-nonzero'],
    [11, 'registry-open-failed']
  ] as const) {
    const result = await runWorkPackageProfileProbe(30_000, {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      monotonicNowMs: nowSequence(0, 10),
      runCommand: async () => outcome({ exitCode })
    });
    expect(result.projectedProbe).toEqual({
      complete: false,
      reason: 'host-tool-failed',
      identities: null
    });
    expect(result.diagnostic.classification).toBe(classification);
    expect(result.diagnostic.decode).toEqual({
      stage: 'not-attempted',
      disposition: null,
      identities: null
    });
    expect(() => assertPersistableProfileDiagnostic(result.diagnostic)).not.toThrow();
  }
});

test('shared profile probe separates JSON, shape, and contract failures without raw output', async () => {
  const vectors = [
    ['{"raw":"sec.sm3.invalid-json"', 'json-invalid', 'sec.sm3.invalid-json'],
    [
      JSON.stringify({ disposition: 'observed', raw: 'sec.sm3.invalid-shape', values: [] }),
      'shape-invalid',
      'sec.sm3.invalid-shape'
    ],
    [
      JSON.stringify({ disposition: 'observed', values: ['SEC.SM3.INVALID-CONTRACT'] }),
      'contract-invalid',
      'SEC.SM3.INVALID-CONTRACT'
    ]
  ] as const;
  for (const [stdout, stage, rawMarker] of vectors) {
    const result = await runWorkPackageProfileProbe(30_000, {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      monotonicNowMs: nowSequence(0, 10),
      runCommand: async (_command, _args, options) => {
        const bytes = Buffer.from(stdout);
        options.onOutput?.('stdout', bytes);
        return outcome({
          stdout: Object.freeze({
            bytes: bytes.byteLength,
            digest: workPackageProfileProbeEmptyDigestForTests,
            observerTruncated: false
          })
        });
      }
    });
    expect(result.projectedProbe).toEqual({
      complete: false,
      reason: 'parse-failed',
      identities: null
    });
    expect(result.diagnostic.classification).toBe('parse-failed');
    expect(result.diagnostic.decode.stage).toBe(stage);
    expect(JSON.stringify(result.diagnostic)).not.toContain(rawMarker);
    expect(() => assertPersistableProfileDiagnostic(result.diagnostic)).not.toThrow();
  }
});

test('durable evidence existence consumes the one diagnostic authority', () => {
  expect(() => assertDiagnosticAttemptAvailable(false)).not.toThrow();
  expect(() => assertDiagnosticAttemptAvailable(true)).toThrow('already consumed');
});
