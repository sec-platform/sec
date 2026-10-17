import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectRuntimeInspection } from '../../src/application/runtime-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  formatRuntimeReport,
  formatRuntimeStepsInspect
} from '../../src/entry/cli/runtime-inspection.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('runtime inspection routes text through application and entry while preserving both JSON contracts', async () => {
  const report = {
    status: 'failed',
    build: { status: 'passed', passed: ['build:a'], failed: [], command: 'bun run build' },
    unit: { status: 'failed', passed: ['unit:a'], failed: ['unit:b'], command: 'bun test' },
    acceptance: { status: 'skipped', passed: [], failed: [], command: null },
    logs: { stdout: 'out', stderr: 'err' }
  };

  // Keep the minimal public projection input separate from persisted logs.
  const source = {
    status: report.status,
    build: structuredClone(report.build),
    unit: structuredClone(report.unit),
    acceptance: structuredClone(report.acceptance)
  };
  const view = projectRuntimeInspection(source);

  source.build.passed.push('later');
  source.unit.failed.length = 0;

  expect(view).toEqual({
    status: 'failed',
    stepCount: 3,
    passedCount: 1,
    failedCount: 1,
    skippedCount: 1,
    steps: [
      {
        id: 'build',
        status: 'passed',
        passedCount: 1,
        failedCount: 0,
        command: 'bun run build',
        passed: ['build:a'],
        failed: []
      },
      {
        id: 'unit',
        status: 'failed',
        passedCount: 1,
        failedCount: 1,
        command: 'bun test',
        passed: ['unit:a'],
        failed: ['unit:b']
      },
      {
        id: 'acceptance',
        status: 'skipped',
        passedCount: 0,
        failedCount: 0,
        command: null,
        passed: [],
        failed: []
      }
    ]
  });
  const expectedReportText = [
    'Runtime report failed',
    'Build: passed; passed=1; failed=0; command=bun run build',
    'Unit: failed; passed=1; failed=1; command=bun test',
    'Acceptance: skipped; passed=0; failed=0; command=none'
  ].join('\n');
  expect(formatRuntimeReport(view)).toBe(expectedReportText);
  const expectedStepsText = [
    'Runtime steps failed; steps=3; passed=1; failed=1; skipped=1',
    'build: passed; passed=1; failed=0; command=bun run build',
    'unit: failed; passed=1; failed=1; command=bun test',
    'acceptance: skipped; passed=0; failed=0; command=none'
  ].join('\n');
  expect(formatRuntimeStepsInspect(view)).toBe(expectedStepsText);

  await withTempWorkspace(async (workspaceRoot) => {
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    await expectCliSuccess(workspaceRoot, ['runtime'], `${expectedReportText}\n`);
    const rawJson = await expectCliJson<typeof report>(workspaceRoot, ['runtime', '--json']);
    expect(rawJson).toEqual(report);

    await expectCliSuccess(
      workspaceRoot,
      ['runtime', 'steps'],
      `${expectedStepsText}\n`
    );
    const stepsJson = await expectCliJson<typeof view>(workspaceRoot, ['runtime', 'steps', '--json']);
    expect(stepsJson).toEqual(view);
  });
});
