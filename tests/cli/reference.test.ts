import { expect, test } from 'vitest';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../../platform/shared/reference-check.ts';

test('CLI exposes reference drift check as text and JSON contracts', async () => {
  const report = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (command, args) => {
      if (command === 'git') {
        expect(args).toEqual(['diff', '--name-only', '--exit-code', '--', 'source', 'project', 'control']);
        return { code: 1, stdout: `source/app.yaml\n${CI_ARTIFACT_FILES.reviewSummary}\n`, stderr: '' };
      }

      expect(args.slice(-2)).toEqual(['run', 'reference:refresh']);
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  expect(formatReferenceCheck(report)).toContain('Reference workspace drifted');
  expect(formatReferenceCheck(report)).toContain('Failed stage: diff');
  expect(formatReferenceCheck(report)).toContain('Command: bun run platform -- reference check --json');
  expect(formatReferenceCheck(report)).toContain('Runner command: bun run reference:check');
  expect(formatReferenceCheck(report)).toContain(
    'Commands: refresh=bun run reference:refresh; diff=git diff --name-only --exit-code -- source project control'
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
    command: 'bun run platform -- reference check --json',
    runnerCommand: 'bun run reference:check',
    refreshCommand: 'bun run reference:refresh',
    refreshExitCode: 0,
    diffCommand: 'git diff --name-only --exit-code -- source project control',
    diffExitCode: 1,
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
    commandRunner: async (command) =>
      command === 'git'
        ? { code: 128, stdout: '', stderr: 'diff failed' }
        : { code: 0, stdout: '', stderr: '' }
  });
  expect(diffFailedReport).toMatchObject({
    status: 'diff-failed',
    failedStage: 'diff',
    refreshExitCode: 0,
    diffExitCode: 128,
    changedPathCount: 0,
    recommendedAction: 'inspect-git-diff-command'
  });
  expect(() => assertReferenceCheckClean(diffFailedReport)).toThrow('reference diff command failed');
});
