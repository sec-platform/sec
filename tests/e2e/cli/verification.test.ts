import { expect, test } from 'bun:test';
import { lockWorkspace } from '../../../src/bootstrap/engineering/cli.ts';

import type { AcceptanceTargetInspect } from '../../../src/application/acceptance-inspection.ts';
import type { PolicySourceInspect } from '../../../src/application/policy-source-inspection.ts';
import type { RuntimeInspectionView } from '../../../src/application/runtime-inspection.ts';
import type { AcceptanceCoverageReport } from '../../../src/assurance/acceptance/coverage.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../../../src/assurance/verification/contract/types.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import { expectCliJson, expectCliText } from '../../testkit/cli.ts';
import { withWorkspaceScenario } from '../../testkit/workspace.ts';

test('CLI exposes policy, acceptance, runtime, and verification reports as JSON contracts', async () => {
  await withWorkspaceScenario('verified-fast-default', async (workspaceRoot) => {
    const policyReport = await expectCliJson<PolicyReport>(
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

    const sourcesPayload = await expectCliJson<PolicySourceInspect>(
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

    const coverageReport = await expectCliJson<AcceptanceCoverageReport>(
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

    await expectCliJson<AcceptanceTargetInspect>(
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

    const runtimeReport = await expectCliJson<RuntimeVerificationLaneReport>(
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

    await expectCliJson<RuntimeInspectionView>(
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
      runtime: { status: 'passed', build: { status: 'skipped' }, unit: { status: 'passed' },
        acceptance: { status: 'skipped' } }
    });
    // This root was actually verified above, not cloned from a verified template.
    await expect(lockWorkspace(workspaceRoot)).rejects.toMatchObject({
      code: 'LOCK-BLOCKED-002', message: 'lock requires a passing verify --lane all result'
    });
  });
}, 180000);
