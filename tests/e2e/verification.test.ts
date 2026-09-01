import { expect, test } from 'bun:test';

import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { expectCliJson, expectCliText, expectCliVariants } from '../testkit/cli.ts';
import { withWorkspaceScenario } from '../testkit/workspace.ts';

test('CLI exposes policy report as text and JSON contracts', async () => {
  await withWorkspaceScenario('verified-fast-default', async (workspaceRoot) => {
    const { json: policyReport } = await expectCliVariants<{
      status: string;
      merged: { policies: Array<{ id: string; targets: string[] }> };
      violations: unknown[];
    }>(workspaceRoot, ['policy', 'report'], {
      text: [
        'Policy report passed; official=1; project=0; merged=1; violations=0',
        'Policy tenant-scope-required; scope=official; source=catalog/policies/official/policy.spec.yaml; targets=src/installed/entity/customer-service.ts'
      ],
      compactJson: { status: 'passed' }
    });
    expect(policyReport).toMatchObject({
      status: 'passed',
      violations: []
    });
    expect(policyReport.merged.policies).toHaveLength(1);
    expect(policyReport.merged.policies[0]).toMatchObject({
      id: 'tenant-scope-required',
      targets: ['src/installed/entity/customer-service.ts']
    });

    await expectCliText(workspaceRoot, ['policy', 'sources'], [
      'Policy sources passed',
      'sources=2; policies=1',
      'Source official; path=catalog/policies/official/policy.spec.yaml; policies=tenant-scope-required',
      'Source project; path=source/model/policies/policy.spec.yaml; policies=none'
    ]);

    const sourcesPayload = await expectCliJson(
      workspaceRoot,
      ['policy', 'sources', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(sourcesPayload).toEqual({
      status: 'passed',
      sourceCount: 2,
      policyCount: 1,
      sources: [
        {
          scope: 'official',
          path: 'catalog/policies/official/policy.spec.yaml',
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
}, 120000);

test('CLI exposes acceptance coverage as text and JSON contracts', async () => {
  await withWorkspaceScenario('verified-fast-default', async (workspaceRoot) => {
    const { json: coverageReport } = await expectCliVariants<{
      status: string;
      blocks: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      uncoveredBlocks: string[];
    }>(workspaceRoot, ['acceptance', 'coverage'], {
      text: [
        'Acceptance coverage passed; acceptancePassed=',
        'blocks=0/3; uncoveredBlocks=3',
        'Uncovered blocks: auth/basic-session, tenant/basic-workspace, entity/customer-basic',
        'Block entity/customer-basic; declared=3; coveredBy=none; uncovered=true'
      ],
      compactJson: {
        status: 'passed',
        uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic']
      }
    });
    expect(coverageReport).toMatchObject({
      status: 'passed',
      uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic']
    });
    expect(coverageReport.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'entity/customer-basic',
          uncovered: true
        })
      ])
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
        status: 'passed',
        targetKind: 'blocks',
        targetCount: 3,
        coveredCount: 0,
        uncoveredCount: 3,
        uncoveredIds: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic']
      },
      { compact: true }
    );

  });
}, 120000);

test('CLI exposes runtime report as text and JSON contracts', async () => {
  await withWorkspaceScenario('verified-fast-default', async (workspaceRoot) => {
    const { json: runtimeReport } = await expectCliVariants<{
      status: string;
      build: { status: string };
      unit: { status: string; failed: string[] };
      acceptance: { status: string };
    }>(workspaceRoot, ['runtime', 'report'], {
      text: [
        'Runtime report passed',
        'Build: skipped; passed=0; failed=0; command=bun run build',
        'Unit: passed; passed=',
        'failed=0; command=bun run test:unit',
        'Acceptance: skipped; passed=0; failed=0; command=bun run test:acceptance'
      ],
      compactJson: {
        status: 'passed',
        build: { status: 'skipped' },
        acceptance: { status: 'skipped' }
      }
    });
    expect(runtimeReport).toMatchObject({
      status: 'passed',
      build: { status: 'skipped' },
      unit: { status: 'passed', failed: [] },
      acceptance: { status: 'skipped' }
    });

    await expectCliText(workspaceRoot, ['runtime', 'steps'], [
      'Runtime steps passed; steps=3; passed=1; failed=0; skipped=2',
      'build: skipped; passed=0; failed=0; command=bun run build',
      'unit: passed; passed=',
      'acceptance: skipped; passed=0; failed=0; command=bun run test:acceptance'
    ]);

    await expectCliJson(
      workspaceRoot,
      ['runtime', 'steps', '--json', '--compact'],
      {
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
}, 120000);

test('CLI runs verify with JSON output for CI consumers', async () => {
  await withWorkspaceScenario('composed-default', async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['verify', '--lane', 'fast'], ['Verification passed (fast)\n']);

    const directVerificationReport = await expectCliJson<VerificationReport>(
      workspaceRoot,
      ['verify', '--lane', 'fast', '--json'],
      undefined,
      { stdoutMarkers: ['\n  "summary"'] }
    );
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
  await withWorkspaceScenario('verified-fast-default', async (workspaceRoot) => {
    const { json: verificationReport } = await expectCliVariants<VerificationReport>(workspaceRoot, ['verification', 'report'], {
      text: [
        'Verification report passed; requestedLane=fast; failedLanes=none',
        'Fast: passed; build=passed; unit=passed; acceptance=passed; policy=passed',
        'Runtime: passed; build=skipped; unit=passed; acceptance=skipped'
      ],
      compactJson: {
        summary: {
          status: 'passed',
          requestedLane: 'fast'
        }
      }
    });
    expect(verificationReport).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: []
      },
      fast: { status: 'passed', policy: { status: 'passed' } },
      runtime: { status: 'passed', acceptance: { status: 'skipped' } }
    });
  });
}, 180000);
