import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('verification inspection renders report text while preserving raw JSON', async () => {
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
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    await expectCliSuccess(
      workspaceRoot,
      ['verification'],
      [
        'Verification report failed; requestedLane=runtime; failedLanes=fast, runtime',
        'Fast: failed; build=passed; unit=failed; acceptance=passed; policy=failed',
        'Runtime: failed; build=passed; unit=failed; acceptance=failed',
        ''
      ].join('\n')
    );

    const rawJson = await expectCliJson<typeof report>(workspaceRoot, ['verification', '--json']);
    expect(rawJson).toEqual(report);
  });
});
