import { expect, test } from 'bun:test';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('runtime inspection routes text through application and entry while preserving both JSON contracts', async () => {
  const report = {
    status: 'failed',
    build: { status: 'passed', passed: ['build:a'], failed: [] as string[], command: 'bun run build' },
    unit: { status: 'failed', passed: ['unit:a'], failed: ['unit:b'], command: 'bun test' },
    acceptance: { status: 'skipped', passed: [] as string[], failed: [] as string[], command: null },
    logs: { stdout: 'out', stderr: 'err' }
  };

  const expectedView = {
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
  };
  const expectLine = (stdout: string, prefix: string, markers: readonly string[]) => {
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const identity = new RegExp(`^\\s*${escape(prefix)}(?=$|[\\s;,])`, 'u');
    const lines = stdout.split(/\r?\n/u).filter(line => identity.test(line));
    expect(lines).toHaveLength(1);
    for (const marker of markers) {
      expect(lines[0]!).toMatch(new RegExp(`(?:^|[\\s;,])${escape(marker)}\\s*(?=$|[;,])`, 'u'));
    }
  };

  await withTempWorkspace(async (workspaceRoot) => {
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport);
    await writeJson(reportPath, report);

    const text = await expectCliSuccess(workspaceRoot, ['runtime']);
    expectLine(text.stdout, 'Runtime report failed', []);
    const rawJson = await expectCliJson<typeof report>(workspaceRoot, ['runtime', 'report', '--json']);
    expect(rawJson).toEqual(report);

    const stepsText = await expectCliSuccess(workspaceRoot, ['runtime', 'steps']);
    expectLine(stepsText.stdout, 'Runtime steps failed', ['steps=3', 'passed=1', 'failed=1', 'skipped=1']);
    for (const [label, status, passed, failed, command] of [
      ['Build', 'passed', 1, 0, 'bun run build'],
      ['Unit', 'failed', 1, 1, 'bun test'],
      ['Acceptance', 'skipped', 0, 0, 'none']
    ] as const) {
      const markers = [`passed=${passed}`, `failed=${failed}`, `command=${command}`];
      expectLine(text.stdout, `${label}: ${status}`, markers);
      expectLine(stepsText.stdout, `${label.toLowerCase()}: ${status}`, markers);
    }
    const stepsJson = await expectCliJson<typeof expectedView>(workspaceRoot, ['runtime', 'steps', '--json']);
    expect(stepsJson).toEqual(expectedView);
  });
});
