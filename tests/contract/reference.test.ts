import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../../platform/shared/reference-check.ts';
import {
  REFERENCE_TRACKED_DIFF_ARGS,
  REFERENCE_UNTRACKED_SCAN_ARGS,
  scanReferenceDrift
} from '../../platform/shared/reference-drift-scan.ts';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test('CLI exposes reference drift check as text and JSON contracts', async () => {
  const report = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (_command, args) => {
      expect(args).toEqual(['run', 'reference:refresh']);
      return { code: 0, stdout: '', stderr: '' };
    },
    gitCommandRunner: async (_command, args) => {
      if (args[0] === 'diff') {
        expect(args).toEqual(REFERENCE_TRACKED_DIFF_ARGS);
        return { code: 1, stdout: bytes(`source/app.yaml\0${CI_ARTIFACT_FILES.reviewSummary}\0`), stderr: '' };
      }
      expect(args).toEqual(REFERENCE_UNTRACKED_SCAN_ARGS);
      return { code: 0, stdout: new Uint8Array(), stderr: '' };
    }
  });

  expect(formatReferenceCheck(report)).toContain('Reference workspace drifted');
  expect(formatReferenceCheck(report)).toContain('Failed stage: diff');
  expect(formatReferenceCheck(report)).toContain('Command: bun run sec -- reference check --json');
  expect(formatReferenceCheck(report)).toContain('Runner command: bun run reference:check');
  expect(formatReferenceCheck(report)).toContain(
    'Commands: refresh=bun run reference:refresh; diff=git diff --name-only --exit-code -z -- source project control; untracked=git ls-files -z --others --exclude-standard -- source project control'
  );
  expect(formatReferenceCheck(report)).toContain(
    `Changed paths: ${CI_ARTIFACT_FILES.reviewSummary}, source/app.yaml`
  );
  expect(JSON.stringify(report)).not.toContain('\n');
  expect(report).toMatchObject({
    formatVersion: '1',
    status: 'drifted',
    failedStage: 'diff',
    root: compilerRoot,
    command: 'bun run sec -- reference check --json',
    runnerCommand: 'bun run reference:check',
    refreshCommand: 'bun run reference:refresh',
    refreshExitCode: 0,
    diffCommand: 'git diff --name-only --exit-code -z -- source project control',
    diffExitCode: 1,
    trackedDiffExitCode: 1,
    untrackedScanCommand: 'git ls-files -z --others --exclude-standard -- source project control',
    untrackedScanExitCode: 0,
    changedPathCount: 2,
    changedPaths: [CI_ARTIFACT_FILES.reviewSummary, 'source/app.yaml'],
    recommendedAction: 'inspect-workspace-drift-and-refresh-reference'
  });
  expect(() => assertReferenceCheckClean(report)).toThrow('reference workspace drift detected');

  const refreshFailedReport = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async () => ({ code: 2, stdout: '', stderr: 'refresh failed' })
  });
  expect(refreshFailedReport).toMatchObject({
    status: 'refresh-failed',
    failedStage: 'refresh',
    refreshExitCode: 2,
    diffExitCode: -1,
    changedPathCount: 0,
    recommendedAction: 'fix-reference-refresh-before-reference-check'
  });
  expect(() => assertReferenceCheckClean(refreshFailedReport)).toThrow('reference refresh failed');

  const diffFailedReport = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async () => ({ code: 0, stdout: '', stderr: '' }),
    gitCommandRunner: async () => ({
      code: 128,
      stdout: bytes('diagnostic output without path authority'),
      stderr: 'diff failed'
    })
  });
  expect(diffFailedReport).toMatchObject({
    status: 'diff-failed',
    failedStage: 'diff',
    refreshExitCode: 0,
    diffExitCode: 128,
    trackedDiffExitCode: 128,
    untrackedScanExitCode: -1,
    changedPathCount: 0,
    changedPaths: [],
    recommendedAction: 'inspect-git-diff-command'
  });
  expect(() => assertReferenceCheckClean(diffFailedReport)).toThrow('reference diff command failed');
});

test('reference drift preserves newline-containing Git paths as one NUL-delimited identity', async () => {
  const changedPath = 'source/line\nbreak.ts';
  const scan = await scanReferenceDrift('/unused', async (_command, args) => {
    if (args[0] === 'diff') {
      return { code: 1, stdout: bytes(`${changedPath}\0`), stderr: '' };
    }
    return { code: 0, stdout: new Uint8Array(), stderr: '' };
  });

  expect(scan.exitCode).toBe(1);
  expect(scan.changedPaths).toEqual([changedPath]);
});

test('reference drift rejects non-UTF-8 Git path bytes instead of normalizing replacement characters', async () => {
  await expect(scanReferenceDrift('/unused', async () => ({
    code: 1,
    stdout: new Uint8Array([0xff, 0]),
    stderr: ''
  }))).rejects.toThrow('non-UTF-8 path record');
});
