import { expect, test } from 'bun:test';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatVerificationReport } from '../../../src/entry/cli/verification-report-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('verification inspection renders report text while preserving raw JSON', async () => {
  // The public renderer accepts this minimal source, without runtime logs,
  // commands or passed/failed inventories supplied by the persisted report.
  const source = {
    summary: {
      status: 'failed',
      requestedLane: 'runtime',
      failedLanes: ['fast', 'runtime']
    },
    fast: {
      status: 'failed',
      build: { status: 'passed' },
      unit: { status: 'failed' },
      acceptance: { status: 'passed' },
      policy: { status: 'failed' }
    },
    runtime: {
      status: 'failed',
      build: { status: 'passed' },
      unit: { status: 'failed' },
      acceptance: { status: 'failed' }
    }
  };
  const before = structuredClone(source);
  function expectFailureSummary(text: string): void {
    expect(text).toMatch(/Verification report\s+failed(?=$|[\s;,()])/u);
    expect(text).toMatch(/\brequestedLane=runtime(?=$|[\s;,()])/u);
    const summary = text.split('\n').find((line) => /Verification report/u.test(line));
    expect(summary).toMatch(/\bfailedLanes=[^;\n]*\bfast(?=$|[\s;,()])/u);
    expect(summary).toMatch(/\bfailedLanes=[^;\n]*\bruntime(?=$|[\s;,()])/u);
    const fast = text.split('\n').find((line) => /^Fast\b/u.test(line));
    expect(fast).toMatch(/^Fast\W+failed(?=$|[\s;,()])/u);
    for (const field of ['build=passed', 'unit=failed', 'acceptance=passed', 'policy=failed']) {
      expect(fast).toMatch(new RegExp(`${field}(?=$|[\\s;,()])`, 'u'));
    }
    const runtime = text.split('\n').find((line) => /^Runtime\b/u.test(line));
    expect(runtime).toMatch(/^Runtime\W+failed(?=$|[\s;,()])/u);
    for (const field of ['build=passed', 'unit=failed', 'acceptance=failed']) {
      expect(runtime).toMatch(new RegExp(`${field}(?=$|[\\s;,()])`, 'u'));
    }
  }
  expectFailureSummary(formatVerificationReport(source));
  expect(source).toEqual(before);

  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      build: { status: 'passed' },
      unit: { status: 'failed', passed: ['unit:a'] },
      acceptance: { status: 'passed', passed: ['acceptance:a'], failed: [] },
      policy: { status: 'failed', violations: [{ id: 'policy:a' }] },
      fast: {
        status: 'failed',
        build: { status: 'passed' },
        unit: { status: 'failed', passed: ['unit:a'] },
        acceptance: { status: 'passed', passed: ['acceptance:a'], failed: [] },
        policy: { status: 'failed', violations: [{ id: 'policy:a' }] },
        logs: { stdout: 'fast-out', stderr: 'fast-err' }
      },
      runtime: {
        status: 'failed',
        build: { status: 'passed', passed: ['build:a'], failed: [], command: 'bun run build' },
        unit: { status: 'failed', passed: ['unit:a'], failed: ['unit:b'], command: 'bun test' },
        acceptance: { status: 'failed', passed: [], failed: ['acceptance:b'], command: 'bun test acceptance' },
        logs: { stdout: 'runtime-out', stderr: 'runtime-err' }
      },
      summary: {
        status: 'failed',
        requestedLane: 'runtime',
        failedLanes: ['fast', 'runtime']
      },
      logs: { stdout: 'all-out', stderr: 'all-err' }
    };
    // Rich persisted input and the minimal public input remain distinct.
    const beforeRender = structuredClone(report);
    formatVerificationReport(report);
    expect(report).toEqual(beforeRender);

    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);
    await writeJson(reportPath, report);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['verification']);
    expectFailureSummary(stdout);

    const rawJson = await expectCliJson<typeof report>(workspaceRoot, ['verification', 'report', '--json']);
    expect(rawJson).toEqual(report);
  });
});
