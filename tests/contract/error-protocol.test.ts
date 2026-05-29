import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../../platform/shared/error-protocol-contract.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import { expectErrorProtocolSelfConsistent } from '../testkit/contracts.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI exposes error protocol as text and JSON contracts', async () => {
  const contract = buildErrorProtocolContract();
  const formatted = formatErrorProtocolContract(contract);

  expectErrorProtocolSelfConsistent(contract);
  expect(formatted).toContain('Error protocol active');
  expect(formatted).toContain('Example upgrade-conflict-error; code=UPGRADE-CONFLICT-001');
  expect(JSON.stringify(contract)).not.toContain('\n');
  expect(contract).toMatchObject({
    formatVersion: '1',
    status: 'active',
    command: 'bun run platform -- contract errors --json',
    issueTypes: ['composition', 'kernel', 'slot', 'spec', 'usage'],
    artifactPaths: [
      CI_ARTIFACT_FILES.reviewSummary,
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.provenance,
      CI_ARTIFACT_FILES.repairPlan,
      CI_ARTIFACT_FILES.upgradeDiagnostics,
      CI_ARTIFACT_FILES.upgradePlan,
      CI_ARTIFACT_FILES.viewMutationReport,
      'source/views/mutations'
    ].sort(),
    examples: expect.arrayContaining([
      expect.objectContaining({
        id: 'usage-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'usage',
          suggestedActions: ['retry-with-supported-arguments']
        })
      }),
      expect.objectContaining({
        id: 'verify-blocked-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          suggestedActions: ['run-platform-resolve', 'run-platform-compose', 'run-platform-adapt', 'retry-platform-verify']
        })
      }),
      expect.objectContaining({
        id: 'verify-acceptance-error',
        output: expect.objectContaining({
          recoverable: false,
          issueType: 'spec',
          suggestedActions: ['inspect-verification-report', 'run-platform-explain'],
          artifactPaths: [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.reviewSummary]
        })
      }),
      expect.objectContaining({
        id: 'repair-plan-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'slot',
          suggestedActions: ['inspect-repair-plan', 'run-platform-repair-dry-run'],
          artifactPaths: [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.reviewSummary]
        })
      }),
      expect.objectContaining({
        id: 'upgrade-rollback-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'composition',
          artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan],
          details: {
            migrationId: 'mig-customer-normalizer-contract',
            migrationKind: 'slot-contract-update',
            target: 'custom/customer_normalizer.ts',
            rollbackStatus: 'restored'
          }
        })
      }),
      expect.objectContaining({
        id: 'workbench-mutation-error',
        output: expect.objectContaining({
          recoverable: true,
          issueType: 'spec',
          suggestedActions: ['inspect-workbench-mutations', 'run-platform-workbench-mutations-apply'],
          artifactPaths: ['source/views/mutations', CI_ARTIFACT_FILES.viewMutationReport]
        })
      }),
      expect.objectContaining({
        id: 'drift-error',
        output: expect.objectContaining({
          recoverable: false,
          issueType: 'spec',
          suggestedActions: ['run-platform-compose', 'run-platform-adapt', 'revert-local-project-changes'],
          artifactPaths: [CI_ARTIFACT_FILES.provenance]
        })
      })
    ])
  });

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'errors'], {
      text: [
        'Error protocol active',
        `Issue type count: ${contract.issueTypeCount}`,
        `Artifact paths: ${contract.artifactPathCount}`,
        `Artifact path list: ${contract.artifactPaths.join(', ')}`,
        'Example repair-plan-error; code=REPAIR-BLOCKED-001',
        'Example upgrade-rollback-error; code=UPGRADE-MIGRATION-016',
        'Example workbench-mutation-error; code=WORKBENCH-MUTATION-002',
        'Example drift-error; code=ERROR-DRIFT-001'
      ],
      json: {
        status: 'active',
        exampleCount: contract.exampleCount,
        issueTypeCount: contract.issueTypeCount,
        suggestedActionCount: contract.suggestedActionCount,
        artifactPathCount: contract.artifactPathCount
      },
      compactJson: {
        status: 'active',
        exampleCount: contract.exampleCount,
        issueTypeCount: contract.issueTypeCount,
        artifactPathCount: contract.artifactPathCount
      }
    });
  });
});
