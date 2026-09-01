import { expect, test } from 'bun:test';

import { buildErrorProtocol } from '../../src/compiler/error-protocol.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../../src/interface/cli/error-protocol-contract.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
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
    status: 'active',
    command: 'bun run sec -- contract errors --json',
    issueTypes: ['composition', 'kernel', 'spec', 'usage'],
    artifactPaths: [
      CI_ARTIFACT_FILES.reviewSummary,
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.provenance,
      CI_ARTIFACT_FILES.repairPlan,
      CI_ARTIFACT_FILES.upgradeDiagnostics,
      CI_ARTIFACT_FILES.upgradePlan
    ].sort(),
    examples: expect.arrayContaining([
      expect.objectContaining({
        id: 'usage-error',
        input: expect.objectContaining({ code: 'CLI-USAGE-001' }),
        output: expect.objectContaining({
          code: 'CLI-USAGE-001',
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
          suggestedActions: ['run-platform-resolve', 'run-platform-compose', 'retry-platform-verify']
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
          issueType: 'composition',
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
            migrationId: 'mig-customer-normalizer-file',
            migrationKind: 'file-replace',
            target: 'src/installed/private/customer-normalizer.ts',
            rollbackStatus: 'restored'
          }
        })
      }),
      expect.objectContaining({
        id: 'drift-error',
        output: expect.objectContaining({
          recoverable: false,
          issueType: 'spec',
          suggestedActions: ['run-platform-compose', 'revert-local-project-changes'],
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

test('diagnostic message text cannot grant CLI usage control-flow semantics', () => {
  const messageOnly = buildErrorProtocol({
    message: 'Usage: platform verify [--lane fast|runtime|all]'
  });
  expect(messageOnly.code).toBe('UNEXPECTED');
  expect(messageOnly.issueType).toBe('kernel');
  expect(messageOnly.recoverable).toBe(false);

  const typed = buildErrorProtocol({
    code: 'CLI-USAGE-001',
    message: 'Usage: platform verify [--lane fast|runtime|all]'
  });
  expect(typed.issueType).toBe('usage');
  expect(typed.recoverable).toBe(true);
});
