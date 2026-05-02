import { expect, test } from 'bun:test';

import { expectCliJson, expectCliText, expectCliVariants, runCliPipeline } from '../helpers/cli-helpers.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

test('CLI emits explain JSON for CI consumers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'all', lock: true });

    const { json: payload } = await expectCliVariants<{
      graph: { nodes: Array<{ id: string; type: string }>; edges: unknown[] };
      e2eMatrix: {
        status: string;
        rowCount: number;
        rows: Array<{
          stage: string;
          status: string;
          detail: string;
          evidenceCount: number;
          evidence: string[];
        }>;
      };
      reviewSummary: {
        formatVersion: string;
        ciSummary: { status: string; failureCount: number };
        chainSummary: {
          status: string;
          stageCount: number;
          passedStageCount: number;
          attentionStageCount: number;
          failedStageCount: number;
          stageSummaries: Array<{ id: string; status: string; detail: string }>;
        };
        coverageSummary?: {
          status: string;
          acceptancePassedCount: number;
          blockCount: number;
          slotCount: number;
          coveredBlockCount: number;
          coveredSlotCount: number;
          uncoveredBlockCount: number;
          uncoveredSlotCount: number;
          blockSummaries: Array<{ id: string; coveredByCount: number; coveredBy: string[] }>;
          slotSummaries: Array<{ id: string; coveredByCount: number; coveredBy: string[] }>;
        };
        provenanceSummary?: {
          artifactCount: number;
          overrideArtifactCount: number;
          registryArtifactCount: number;
          generatedArtifactCount: number;
          unverifiedArtifactCount: number;
          originSummaryCount: number;
          originSummaries: Array<{ originType: string; count: number; paths: string[] }>;
          overrideSummaryCount: number;
          overrideSummaries: Array<{ overrideStatus: string; count: number; paths: string[] }>;
          registrySummaryCount: number;
          registrySummaries: Array<{ registrySourceId: string; count: number; paths: string[] }>;
          generatedPassSummaries: Array<{ pass: string; count: number; paths: string[] }>;
        };
        policySummary?: {
          status: string;
          officialPolicyCount: number;
          projectPolicyCount: number;
          mergedPolicyCount: number;
          sourceCount: number;
          violationCount: number;
          sourceSummaries: Array<{ scope: string; path: string; policyIds: string[] }>;
          mergedSummaries: Array<{ id: string; targetCount: number; targets: string[] }>;
        };
        changeSourceCount: number;
        runtimeEntryCount: number;
        installImpactCount: number;
        installImpactSummary: {
          impactCount: number;
          groupCount: number;
          blockCount: number;
          actionKinds: string[];
          runtimeEntryCount: number;
          targetPathCount: number;
          groupSummaries: Array<{
            vertical: string;
            blockCount: number;
            actionKinds: string[];
            runtimeEntries: string[];
            targetPaths: string[];
          }>;
        };
        impactedBlocks: string[];
        failurePoints: unknown[];
      };
    }>(workspaceRoot, ['explain'], {
      text: [
        'Explain graph',
        'Node types:',
        'block=',
        'policy=',
        'Edge types:',
        'depends_on=',
        'Coverage: 3 blocks; 1 slots;',
        'uncovered blocks=0',
        'uncovered slots=0',
        'Coverage detail: passed;',
        'covered blocks: 3/3',
        'covered slots: 1/1',
        'Provenance origins:',
        'block=',
        'slot=',
        'Provenance detail: artifacts:',
        'registry:',
        'unverified:',
        'Install impact: 3 impacts; groups: 2; actions: copy, merge-prisma;',
        'runtime entries: 0; targets: 7',
        'CI status: passed; failures: 0; regression risks: 0; conflict hints: 0',
        'Chain: attention; stages: 3/4; attention: 1; failed: 0',
        'E2E verification: passed; lane=all; failed=none; evidence=ci=passed, failures=0',
        'E2E coverage: passed; blocks=3/3; slots=1/1; evidence=blocks=3/3, slots=1/1',
        'E2E artifacts: attention; total=0; missing=0; evidence=artifacts=missing',
        'E2E review: passed; review-summary=generated; evidence=review-summary=generated',
        'Impacted: 3 blocks, 1 slots,',
        'Policy: passed; official: 1; project: 0; merged: 1; violations: 0'
      ],
      compactJson: {
        e2eMatrix: {
          status: 'attention',
          rowCount: 4
        },
        reviewSummary: {
          formatVersion: '2',
          chainSummary: { stageCount: 4 }
        }
      }
    });
    expect(payload.graph.nodes.some((node) => node.id === 'policy:tenant-scope-required')).toBe(true);
    expect(payload.graph.edges.length).toBeGreaterThan(0);
    expect(payload.e2eMatrix).toMatchObject({
      status: 'attention',
      rowCount: 4,
      rows: [
        { stage: 'verification', status: 'passed', evidenceCount: 2, evidence: ['ci=passed', 'failures=0'] },
        { stage: 'coverage', status: 'passed', evidenceCount: 2, evidence: ['blocks=3/3', 'slots=1/1'] },
        { stage: 'artifacts', status: 'attention', evidenceCount: 1, evidence: ['artifacts=missing'] },
        { stage: 'review', status: 'passed', evidenceCount: 1, evidence: ['review-summary=generated'] }
      ]
    });

    await expectCliText(workspaceRoot, ['review', 'matrix'], [
      'E2E matrix attention; rows=4',
      'verification: passed; lane=all; failed=none; evidence=ci=passed, failures=0',
      'artifacts: attention; total=0; missing=0; evidence=artifacts=missing'
    ]);

    const matrixPayload = await expectCliJson<typeof payload.e2eMatrix>(
      workspaceRoot,
      ['review', 'matrix', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(matrixPayload).toEqual(payload.e2eMatrix);
    expect(payload.reviewSummary.formatVersion).toBe('2');
    expect(payload.reviewSummary.ciSummary).toMatchObject({
      status: 'passed',
      failureCount: 0
    });
    expect(payload.reviewSummary.chainSummary).toMatchObject({
      status: 'attention',
      stageCount: 4,
      passedStageCount: 3,
      attentionStageCount: 1,
      failedStageCount: 0,
      stageSummaries: [
        { id: 'verification', status: 'passed', detail: 'lane=all; failed=none' },
        { id: 'coverage', status: 'passed', detail: 'blocks=3/3; slots=1/1' },
        { id: 'artifacts', status: 'attention', detail: 'total=0; missing=0' },
        { id: 'review', status: 'passed', detail: 'review-summary=generated' }
      ]
    });
    expect(payload.reviewSummary.coverageSummary).toMatchObject({
      status: 'passed',
      blockCount: 3,
      slotCount: 1,
      coveredBlockCount: 3,
      coveredSlotCount: 1,
      uncoveredBlockCount: 0,
      uncoveredSlotCount: 0
    });
    expect(payload.reviewSummary.coverageSummary?.blockSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'entity/customer-basic',
          coveredByCount: 3,
          coveredBy: ['tenant_only_sees_own_customers', 'user_can_create_customer', 'user_can_list_customers']
        })
      ])
    );
    expect(payload.reviewSummary.coverageSummary?.slotSummaries).toEqual([
      expect.objectContaining({
        id: 'customer_normalizer',
        coveredByCount: 2,
        coveredBy: ['tenant_only_sees_own_customers', 'user_can_create_customer']
      })
    ]);
    expect(payload.reviewSummary.provenanceSummary).toMatchObject({
      overrideArtifactCount: 0,
      registryArtifactCount: expect.any(Number),
      generatedArtifactCount: expect.any(Number),
      unverifiedArtifactCount: expect.any(Number),
      originSummaryCount: expect.any(Number),
      overrideSummaryCount: expect.any(Number),
      registrySummaryCount: expect.any(Number),
      originSummaries: expect.arrayContaining([
        expect.objectContaining({
          originType: 'block',
          count: expect.any(Number)
        }),
        expect.objectContaining({
          originType: 'slot',
          count: expect.any(Number)
        })
      ]),
      generatedPassSummaries: expect.arrayContaining([
        expect.objectContaining({
          pass: 'compose',
          count: expect.any(Number)
        })
      ])
    });
    expect(payload.reviewSummary.provenanceSummary?.artifactCount).toBeGreaterThan(0);
    expect(payload.reviewSummary.policySummary).toMatchObject({
      status: 'passed',
      officialPolicyCount: 1,
      projectPolicyCount: 0,
      mergedPolicyCount: 1,
      sourceCount: 2,
      violationCount: 0,
      sourceSummaries: [
        {
          scope: 'official',
          path: 'platform/policies/official/policy.spec.yaml',
          policyIds: ['tenant-scope-required']
        },
        {
          scope: 'project',
          path: 'source/model/policies/policy.spec.yaml',
          policyIds: []
        }
      ],
      mergedSummaries: [
        {
          id: 'tenant-scope-required',
          targetCount: 1,
          targets: ['src/installed/entity/customer-service.ts']
        }
      ]
    });
    expect(payload.reviewSummary.installImpactSummary).toMatchObject({
      impactCount: 3,
      groupCount: 2,
      blockCount: 3,
      actionKinds: ['copy', 'merge-prisma'],
      runtimeEntryCount: 0,
      targetPathCount: 7,
      groupSummaries: expect.arrayContaining([
        expect.objectContaining({
          vertical: 'customer',
          blockCount: 1,
          actionKinds: ['copy', 'merge-prisma'],
          runtimeEntries: [],
          targetPaths: expect.arrayContaining([
            'prisma/schema.prisma',
            'src/installed/entity/customer-service.ts',
            'tests/acceptance/customer-flow.test.ts',
            'tests/unit/customer-normalizer.test.ts'
          ])
        }),
        expect.objectContaining({
          vertical: 'none',
          blockCount: 2,
          actionKinds: ['copy'],
          runtimeEntries: [],
          targetPaths: expect.arrayContaining([
            'src/installed/auth/session.ts',
            'src/installed/tenant/context.ts',
            'tests/shared/tenant-runtime-fixture.ts'
          ])
        })
      ])
    });
    expect(payload.reviewSummary.impactedBlocks).toEqual(
      expect.arrayContaining([
        'auth/basic-session',
        'entity/customer-basic',
        'tenant/basic-workspace'
      ])
    );
    expect(payload.reviewSummary.failurePoints).toHaveLength(0);
  });
}, 120000);
