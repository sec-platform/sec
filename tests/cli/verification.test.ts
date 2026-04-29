import { expect, test } from 'vitest';

import type {
  VerificationReport
} from '../../platform/shared/types.ts';
import { expectCliJson, expectCliSuccess, expectCliText, runCliPipeline, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes policy report as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    await expectCliText(workspaceRoot, ['policy', 'report'], [
      'Policy report passed; official=1; project=0; merged=1; violations=0',
      'Policy tenant-scope-required; scope=official; source=platform/policies/official/policy.spec.yaml; targets=src/installed/entity/customer-service.ts'
    ]);

    const policyReport = await expectCliJson<{
      status: string;
      merged: { policies: Array<{ id: string; targets: string[] }> };
      violations: unknown[];
    }>(workspaceRoot, ['policy', 'report', '--json']);
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

    await expectCliJson(
      workspaceRoot,
      ['policy', 'report', '--json', '--compact'],
      { status: 'passed' },
      { compact: true }
    );

    await expectCliText(workspaceRoot, ['policy', 'sources'], [
      'Policy sources passed',
      'sources=2; policies=1',
      'Source official; path=platform/policies/official/policy.spec.yaml; policies=tenant-scope-required',
      'Source project; path=source/model/policies/policy.spec.yaml; policies=none'
    ]);

    const sourcesPayload = await expectCliJson(
      workspaceRoot,
      ['policy', 'sources', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(sourcesPayload).toEqual({
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
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    await expectCliText(workspaceRoot, ['acceptance', 'coverage'], [
      'Acceptance coverage passed; acceptancePassed=',
      'blocks=0/3; slots=0/1; uncoveredBlocks=3; uncoveredSlots=1',
      'Uncovered blocks: auth/basic-session, tenant/basic-workspace, entity/customer-basic',
      'Block entity/customer-basic; declared=3; coveredBy=none; uncovered=true',
      'Slot customer_normalizer; declared=2; coveredBy=none; uncovered=true'
    ]);

    const coverageReport = await expectCliJson<{
      status: string;
      blocks: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      slots: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      uncoveredBlocks: string[];
      uncoveredSlots: string[];
    }>(workspaceRoot, ['acceptance', 'coverage', '--json']);
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

    await expectCliJson(
      workspaceRoot,
      ['acceptance', 'coverage', '--json', '--compact'],
      {
        status: 'passed',
        uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic'],
        uncoveredSlots: ['customer_normalizer']
      },
      { compact: true }
    );

    await expectCliText(workspaceRoot, ['acceptance', 'blocks'], [
      'Acceptance coverage blocks passed',
      'targets=3; covered=0; uncovered=3',
      'Uncovered: auth/basic-session, tenant/basic-workspace, entity/customer-basic',
      'Target entity/customer-basic; declared=3; coveredBy=none; uncovered=true'
    ]);

    await expectCliJson(
      workspaceRoot,
      ['acceptance', 'blocks', '--json', '--compact'],
      {
        formatVersion: '1',
        status: 'passed',
        targetKind: 'blocks',
        targetCount: 3,
        coveredCount: 0,
        uncoveredCount: 3,
        uncoveredIds: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic']
      },
      { compact: true }
    );

    await expectCliText(workspaceRoot, ['acceptance', 'slots'], [
      'Acceptance coverage slots passed',
      'targets=1; covered=0; uncovered=1',
      'Target customer_normalizer; declared=2; coveredBy=none; uncovered=true'
    ]);

    await expectCliJson(
      workspaceRoot,
      ['acceptance', 'slots', '--json', '--compact'],
      {
        formatVersion: '1',
        status: 'passed',
        targetKind: 'slots',
        targetCount: 1,
        coveredCount: 0,
        uncoveredCount: 1,
        uncoveredIds: ['customer_normalizer']
      },
      { compact: true }
    );
  });
});

test('CLI exposes runtime report as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    await expectCliText(workspaceRoot, ['runtime', 'report'], [
      'Runtime report passed',
      'Build: skipped; passed=0; failed=0; command=npm run build',
      'Unit: passed; passed=',
      'failed=0; command=npm run test:unit',
      'Acceptance: skipped; passed=0; failed=0; command=npm run test:acceptance'
    ]);

    const runtimeReport = await expectCliJson<{
      status: string;
      build: { status: string };
      unit: { status: string; failed: string[] };
      acceptance: { status: string };
    }>(workspaceRoot, ['runtime', 'report', '--json']);
    expect(runtimeReport).toMatchObject({
      status: 'passed',
      build: { status: 'skipped' },
      unit: { status: 'passed', failed: [] },
      acceptance: { status: 'skipped' }
    });

    await expectCliJson(
      workspaceRoot,
      ['runtime', 'report', '--json', '--compact'],
      {
        status: 'passed',
        build: { status: 'skipped' },
        acceptance: { status: 'skipped' }
      },
      { compact: true }
    );

    await expectCliText(workspaceRoot, ['runtime', 'steps'], [
      'Runtime steps passed; steps=3; passed=1; failed=0; skipped=2',
      'build: skipped; passed=0; failed=0; command=npm run build',
      'unit: passed; passed=',
      'acceptance: skipped; passed=0; failed=0; command=npm run test:acceptance'
    ]);

    await expectCliJson(
      workspaceRoot,
      ['runtime', 'steps', '--json', '--compact'],
      {
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
      },
      { compact: true }
    );
  });
});

test('CLI runs verify with JSON output for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot);
    await expectCliText(workspaceRoot, ['verify', '--lane', 'fast'], ['Verification passed (fast)\n']);

    const verifyJsonResult = await expectCliSuccess(workspaceRoot, ['verify', '--lane', 'fast', '--json']);
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

    await expectCliJson(
      workspaceRoot,
      ['verify', '--json', '--compact'],
      {
        summary: {
          status: 'passed',
          requestedLane: 'fast'
        }
      },
      { compact: true }
    );

  });
}, 120000);

test('CLI exposes verification report as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });

    await expectCliText(workspaceRoot, ['verification', 'report'], [
      'Verification report passed; requestedLane=fast; failedLanes=none',
      'Fast: passed; build=passed; unit=passed; acceptance=passed; policy=passed',
      'Runtime: passed; build=skipped; unit=passed; acceptance=skipped'
    ]);

    const verificationReport = await expectCliJson<VerificationReport>(workspaceRoot, [
      'verification',
      'report',
      '--json'
    ]);
    expect(verificationReport).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: []
      },
      fast: { status: 'passed', policy: { status: 'passed' } },
      runtime: { status: 'passed', acceptance: { status: 'skipped' } }
    });

    await expectCliJson(
      workspaceRoot,
      ['verification', 'report', '--json', '--compact'],
      {
        summary: {
          status: 'passed',
          requestedLane: 'fast'
        }
      },
      { compact: true }
    );
  });
});
