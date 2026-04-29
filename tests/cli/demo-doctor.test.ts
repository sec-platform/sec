import { expect, test } from 'vitest';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { expectCliSuccess, runCliInProcess as runCli, runCliPipeline, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes demo checklist as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const missingText = await runCli(workspaceRoot, ['demo', 'checklist']);
    expect(missingText.code).toBe(0);
    expect(missingText.stderr).toBe('');
    expect(missingText.stdout).toContain('Demo checklist attention; items=8; missing=8');
    expect(missingText.stdout).toContain(`verification-report: missing; ${CI_ARTIFACT_FILES.verificationReport}`);
    expect(missingText.stdout).toContain('Next command: npm run demo:quickstart');

    await runCliPipeline(workspaceRoot, { verifyLane: 'all', lock: true, explain: true });

    const readyText = await runCli(workspaceRoot, ['demo', 'checklist']);
    expect(readyText.code).toBe(0);
    expect(readyText.stderr).toBe('');
    expect(readyText.stdout).toContain('Demo checklist passed; items=8; missing=0');
    expect(readyText.stdout).toContain(`review-summary: passed; ${CI_ARTIFACT_FILES.reviewSummary}`);
    expect(readyText.stdout).toContain('Next command: npm run demo:closed-loop');

    const readyJson = await runCli(workspaceRoot, ['demo', 'checklist', '--json', '--compact']);
    expect(readyJson.code).toBe(0);
    expect(readyJson.stderr).toBe('');
    expect(readyJson.stdout).not.toContain('\n  "status"');
    expect(JSON.parse(readyJson.stdout)).toMatchObject({
      formatVersion: '1',
      status: 'passed',
      itemCount: 8,
      missingCount: 0,
      nextCommand: 'npm run demo:closed-loop',
      items: expect.arrayContaining([
        {
          id: 'explain-graph',
          status: 'passed',
          artifactPath: CI_ARTIFACT_FILES.explainGraph,
          command: 'npm run platform -- explain'
        }
      ])
    });
  });
}, 120000);

test('CLI exposes doctor as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const doctor = await runCli(workspaceRoot, ['doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).toBe('');
    expect(doctor.stdout).toContain('Developer environment doctor');
    expect(doctor.stdout).toContain('Checks: 6');
    expect(doctor.stdout).toContain('node-version');
    expect(doctor.stdout).toContain('workspace-roots');
    expect(doctor.stdout).toContain('Workspace roots missing: source, project, control, .pjc; run platform init.');
    expect(doctor.stdout).toContain('runtime-dependencies');

    const doctorJson = await runCli(workspaceRoot, ['doctor', '--json']);
    expect(doctorJson.code).toBe(0);
    expect(doctorJson.stderr).toBe('');
    expect(JSON.parse(doctorJson.stdout)).toMatchObject({
      status: expect.any(String),
      checkCount: 6,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'node-version' }),
        expect.objectContaining({ id: 'bun' }),
        expect.objectContaining({
          id: 'workspace-roots',
          status: 'warn',
          message: 'Workspace roots missing: source, project, control, .pjc; run platform init.'
        }),
        expect.objectContaining({ id: 'runtime-dependencies' })
      ]),
      dependencies: expect.objectContaining({
        mode: expect.any(String),
        recommendedAction: expect.any(String)
      })
    });

    const doctorCompact = await runCli(workspaceRoot, ['doctor', '--json', '--compact']);
    expect(doctorCompact.code).toBe(0);
    expect(doctorCompact.stderr).toBe('');
    expect(doctorCompact.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(doctorCompact.stdout)).toMatchObject({
      status: expect.any(String),
      checkCount: 6,
      dependencies: expect.objectContaining({ mode: expect.any(String) })
    });

    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
    const initializedDoctorJson = await runCli(workspaceRoot, ['doctor', '--json', '--compact']);
    expect(initializedDoctorJson.code).toBe(0);
    expect(initializedDoctorJson.stderr).toBe('');
    expect(JSON.parse(initializedDoctorJson.stdout)).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace-roots',
          status: 'ok',
          message: 'Workspace roots exist: source, project, control, .pjc.'
        })
      ])
    });
  });
});
