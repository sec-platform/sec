import { expect, test } from 'vitest';

import type {
  VerificationReport
} from '../../platform/shared/types.ts';
import { runCliInProcess as runCli, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes policy report as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['policy', 'report']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Policy report passed; official=1; project=0; merged=1; violations=0');
    expect(textResult.stdout).toContain('Policy tenant-scope-required; scope=official; source=platform/policies/official/policy.spec.yaml; targets=src/installed/entity/customer-service.ts');

    const jsonResult = await runCli(workspaceRoot, ['policy', 'report', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const policyReport = JSON.parse(jsonResult.stdout) as {
      status: string;
      merged: { policies: Array<{ id: string; targets: string[] }> };
      violations: unknown[];
    };
    expect(policyReport).toMatchObject({
      status: 'passed',
      violations: []
    });
    expect(policyReport.merged.policies).toEqual([
      expect.objectContaining({
        id: 'tenant-scope-required',
        targets: ['src/installed/entity/customer-service.ts']
      })
    ]);

    const compactResult = await runCli(workspaceRoot, ['policy', 'report', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'passed'
    });

    const sourcesText = await runCli(workspaceRoot, ['policy', 'sources']);
    expect(sourcesText.code).toBe(0);
    expect(sourcesText.stderr).toBe('');
    expect(sourcesText.stdout).toContain('Policy sources passed');
    expect(sourcesText.stdout).toContain('sources=2; policies=1');
    expect(sourcesText.stdout).toContain('Source official; path=platform/policies/official/policy.spec.yaml; policies=tenant-scope-required');
    expect(sourcesText.stdout).toContain('Source project; path=source/model/policies/policy.spec.yaml; policies=none');

    const sourcesJson = await runCli(workspaceRoot, ['policy', 'sources', '--json', '--compact']);
    expect(sourcesJson.code).toBe(0);
    expect(sourcesJson.stderr).toBe('');
    expect(sourcesJson.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(sourcesJson.stdout)).toEqual({
      formatVersion: '1',
      status: 'passed',
      sourceCount: 2,
      policyCount: 1,
      sources: [
        {
          scope: 'official',
          path: 'platform/policies/official/policy.spec.yaml',
          policyCount: 1,
          policyIds: ['tenant-scope-required']
        },
        {
          scope: 'project',
          path: 'source/model/policies/policy.spec.yaml',
          policyCount: 0,
          policyIds: []
        }
      ]
    });
  });
});

test('CLI exposes acceptance coverage as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['acceptance', 'coverage']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Acceptance coverage passed; acceptancePassed=');
    expect(textResult.stdout).toContain('blocks=0/3; slots=0/1; uncoveredBlocks=3; uncoveredSlots=1');
    expect(textResult.stdout).toContain('Uncovered blocks: auth/basic-session, tenant/basic-workspace, entity/customer-basic');
    expect(textResult.stdout).toContain('Block entity/customer-basic; declared=3; coveredBy=none; uncovered=true');
    expect(textResult.stdout).toContain('Slot customer_normalizer; declared=2; coveredBy=none; uncovered=true');

    const jsonResult = await runCli(workspaceRoot, ['acceptance', 'coverage', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const coverageReport = JSON.parse(jsonResult.stdout) as {
      status: string;
      blocks: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      slots: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      uncoveredBlocks: string[];
      uncoveredSlots: string[];
    };
    expect(coverageReport).toMatchObject({
      status: 'passed',
      uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic'],
      uncoveredSlots: ['customer_normalizer']
    });
    expect(coverageReport.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'entity/customer-basic',
          uncovered: true
        })
      ])
    );
    expect(coverageReport.slots).toEqual([
      expect.objectContaining({
        id: 'customer_normalizer',
        uncovered: true
      })
    ]);

    const compactResult = await runCli(workspaceRoot, ['acceptance', 'coverage', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'passed',
      uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic'],
      uncoveredSlots: ['customer_normalizer']
    });

    const blocksText = await runCli(workspaceRoot, ['acceptance', 'blocks']);
    expect(blocksText.code).toBe(0);
    expect(blocksText.stderr).toBe('');
    expect(blocksText.stdout).toContain('Acceptance coverage blocks passed');
    expect(blocksText.stdout).toContain('targets=3; covered=0; uncovered=3');
    expect(blocksText.stdout).toContain('Uncovered: auth/basic-session, tenant/basic-workspace, entity/customer-basic');
    expect(blocksText.stdout).toContain('Target entity/customer-basic; declared=3; coveredBy=none; uncovered=true');

    const blocksJson = await runCli(workspaceRoot, ['acceptance', 'blocks', '--json', '--compact']);
    expect(blocksJson.code).toBe(0);
    expect(blocksJson.stderr).toBe('');
    expect(blocksJson.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(blocksJson.stdout)).toMatchObject({
      formatVersion: '1',
      status: 'passed',
      targetKind: 'blocks',
      targetCount: 3,
      coveredCount: 0,
      uncoveredCount: 3,
      uncoveredIds: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic']
    });

    const slotsText = await runCli(workspaceRoot, ['acceptance', 'slots']);
    expect(slotsText.code).toBe(0);
    expect(slotsText.stderr).toBe('');
    expect(slotsText.stdout).toContain('Acceptance coverage slots passed');
    expect(slotsText.stdout).toContain('targets=1; covered=0; uncovered=1');
    expect(slotsText.stdout).toContain('Target customer_normalizer; declared=2; coveredBy=none; uncovered=true');

    const slotsJson = await runCli(workspaceRoot, ['acceptance', 'slots', '--json', '--compact']);
    expect(slotsJson.code).toBe(0);
    expect(slotsJson.stderr).toBe('');
    expect(slotsJson.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(slotsJson.stdout)).toMatchObject({
      formatVersion: '1',
      status: 'passed',
      targetKind: 'slots',
      targetCount: 1,
      coveredCount: 0,
      uncoveredCount: 1,
      uncoveredIds: ['customer_normalizer']
    });
  });
});

test('CLI exposes runtime report as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['runtime', 'report']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Runtime report passed');
    expect(textResult.stdout).toContain('Build: skipped; passed=0; failed=0; command=npm run build');
    expect(textResult.stdout).toContain('Unit: passed; passed=');
    expect(textResult.stdout).toContain('failed=0; command=npm run test:unit');
    expect(textResult.stdout).toContain('Acceptance: skipped; passed=0; failed=0; command=npm run test:acceptance');

    const jsonResult = await runCli(workspaceRoot, ['runtime', 'report', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const runtimeReport = JSON.parse(jsonResult.stdout) as {
      status: string;
      build: { status: string };
      unit: { status: string; failed: string[] };
      acceptance: { status: string };
    };
    expect(runtimeReport).toMatchObject({
      status: 'passed',
      build: { status: 'skipped' },
      unit: { status: 'passed', failed: [] },
      acceptance: { status: 'skipped' }
    });

    const compactResult = await runCli(workspaceRoot, ['runtime', 'report', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      status: 'passed',
      build: { status: 'skipped' },
      acceptance: { status: 'skipped' }
    });

    const stepsTextResult = await runCli(workspaceRoot, ['runtime', 'steps']);
    expect(stepsTextResult.code).toBe(0);
    expect(stepsTextResult.stderr).toBe('');
    expect(stepsTextResult.stdout).toContain('Runtime steps passed; steps=3; passed=1; failed=0; skipped=2');
    expect(stepsTextResult.stdout).toContain('build: skipped; passed=0; failed=0; command=npm run build');
    expect(stepsTextResult.stdout).toContain('unit: passed; passed=');
    expect(stepsTextResult.stdout).toContain('acceptance: skipped; passed=0; failed=0; command=npm run test:acceptance');

    const stepsJsonResult = await runCli(workspaceRoot, ['runtime', 'steps', '--json', '--compact']);
    expect(stepsJsonResult.code).toBe(0);
    expect(stepsJsonResult.stderr).toBe('');
    expect(stepsJsonResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(stepsJsonResult.stdout)).toMatchObject({
      formatVersion: '1',
      status: 'passed',
      stepCount: 3,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 2,
      steps: [
        { id: 'build', status: 'skipped', passedCount: 0, failedCount: 0 },
        { id: 'unit', status: 'passed', failedCount: 0 },
        { id: 'acceptance', status: 'skipped', passedCount: 0, failedCount: 0 }
      ]
    });
  });
});

test('CLI runs verify with JSON output for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    const verifyResult = await runCli(workspaceRoot, ['verify', '--lane', 'fast']);
    expect(verifyResult.code).toBe(0);
    expect(verifyResult.stderr).toBe('');
    expect(verifyResult.stdout).toContain('Verification passed (fast)\n');

    const verifyJsonResult = await runCli(workspaceRoot, ['verify', '--lane', 'fast', '--json']);
    expect(verifyJsonResult.code).toBe(0);
    expect(verifyJsonResult.stderr).toBe('');
    expect(verifyJsonResult.stdout).toContain('\n  "summary"');
    const directVerificationReport = JSON.parse(verifyJsonResult.stdout) as VerificationReport;
    expect(directVerificationReport).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: []
      },
      fast: { status: 'passed', policy: { status: 'passed' } },
      runtime: { status: 'passed', acceptance: { status: 'skipped' } }
    });

    const verifyCompactResult = await runCli(workspaceRoot, ['verify', '--json', '--compact']);
    expect(verifyCompactResult.code).toBe(0);
    expect(verifyCompactResult.stderr).toBe('');
    expect(verifyCompactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(verifyCompactResult.stdout)).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast'
      }
    });

  });
}, 120000);

test('CLI exposes verification report as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['verification', 'report']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Verification report passed; requestedLane=fast; failedLanes=none');
    expect(textResult.stdout).toContain('Fast: passed; build=passed; unit=passed; acceptance=passed; policy=passed');
    expect(textResult.stdout).toContain('Runtime: passed; build=skipped; unit=passed; acceptance=skipped');

    const jsonResult = await runCli(workspaceRoot, ['verification', 'report', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const verificationReport = JSON.parse(jsonResult.stdout) as VerificationReport;
    expect(verificationReport).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: []
      },
      fast: { status: 'passed', policy: { status: 'passed' } },
      runtime: { status: 'passed', acceptance: { status: 'skipped' } }
    });

    const compactResult = await runCli(workspaceRoot, ['verification', 'report', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast'
      }
    });
  });
});
