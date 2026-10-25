import { expect, test } from 'bun:test';

import type { VerificationReport } from '../../../src/assurance/verification/contract/types.ts';
import { expectCliJson, expectCliText } from '../../testkit/cli.ts';
import { withWorkspaceScenario } from '../../testkit/workspace.ts';

test('CLI exposes policy, acceptance, runtime, and verification reports as text and JSON contracts', async () => {
  await withWorkspaceScenario('verified-fast-default', async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['policy', 'report'], [
      'Policy report passed; official=1; project=0; merged=1; violations=0',
      'Policy tenant-scope-required; scope=official; source=catalog/policies/official/policy.spec.yaml; targets=src/installed/entity/customer-service.ts'
    ]);
    const policyReport = await expectCliJson<{
      status: string;
      merged: { policies: Array<{ id: string; targets: string[] }> };
      violations: unknown[];
    }>(
      workspaceRoot, ['policy', 'report', '--json', '--compact'],
      { status: 'passed' },
      { compact: true }
    );
    expect(policyReport).toMatchObject({
      status: 'passed',
      violations: [],
      evaluation: { assurance: 'semantic', unsupportedSemanticPredicates: [] }
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
      'Source project; path=model/policies/policy.spec.yaml; policies=none'
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
          path: 'model/policies/policy.spec.yaml',
          policyCount: 0,
          policyIds: []
        }
      ]
    });

    await expectCliText(workspaceRoot, ['acceptance', 'coverage'], [
      'Acceptance coverage passed; acceptancePassed=',
      'blocks=0/3; uncoveredBlocks=3',
      'Uncovered blocks: auth/basic-session, tenant/basic-workspace, entity/customer-basic',
      'Block entity/customer-basic; declared=3; coveredBy=none; uncovered=true'
    ]);
    const coverageReport = await expectCliJson<{
      status: string;
      blocks: Array<{ id: string; coveredBy: string[]; uncovered: boolean }>;
      uncoveredBlocks: string[];
    }>(
      workspaceRoot, ['acceptance', 'coverage', '--json', '--compact'],
      {
        status: 'passed',
        uncoveredBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic']
      },
      { compact: true }
    );
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

    await expectCliText(workspaceRoot, ['runtime', 'report'], [
      'Runtime report passed',
      'Build: skipped; passed=0; failed=0; command=bun run build',
      'Unit: passed; passed=',
      'failed=0; command=bun run test:unit',
      'Acceptance: skipped; passed=0; failed=0; command=bun run test:acceptance'
    ]);
    const runtimeReport = await expectCliJson<{
      status: string;
      build: { status: string };
      unit: { status: string; failed: string[] };
      acceptance: { status: string };
    }>(
      workspaceRoot, ['runtime', 'report', '--json', '--compact'],
      {
        status: 'passed',
        build: { status: 'skipped' },
        acceptance: { status: 'skipped' }
      },
      { compact: true }
    );
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

    await expectCliText(workspaceRoot, ['verification', 'report'], [
      'Verification report passed; requestedLane=fast; failedLanes=none',
      'Fast: passed; build=passed; unit=passed; acceptance=passed; policy=passed',
      'Runtime: passed; build=skipped; unit=passed; acceptance=skipped'
    ]);
    const verificationReport = await expectCliJson<VerificationReport>(
      workspaceRoot, ['verification', 'report', '--json', '--compact'],
      {
        summary: {
          status: 'passed',
          requestedLane: 'fast'
        }
      },
      { compact: true }
    );
    expect(verificationReport).toMatchObject({
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: [],
        claimSummary: {
          overall: { overallStatus: 'passed' },
          gates: expect.arrayContaining([expect.objectContaining({
            gateId: 'product-policy-gate', applicability: 'required',
            status: 'passed', reasonCode: 'claim-observed'
          })])
        }
      },
      fast: {
        status: 'passed', build: { status: 'passed' }, unit: { status: 'passed' },
        acceptance: { status: 'passed' }, policy: { status: 'passed' }
      },
      runtime: { status: 'passed', acceptance: { status: 'skipped' } }
    });
  });
}, 180000);

test('CLI runs verify with JSON output for CI consumers', async () => {
  await withWorkspaceScenario('composed-default', async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['verify'], ['Verification passed (fast)\n']);

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
  });
}, 180000);
