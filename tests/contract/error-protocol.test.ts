import { expect, test } from 'bun:test';

import { buildErrorProtocol } from '../../src/application/engineering/error-protocol.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('public error codes retain their independent recovery contract', () => {
  const cases = [
    {
      code: 'CLI-USAGE-001',
      expected: {
        issueType: 'usage',
        recoverable: true,
        suggestedActions: ['retry-with-supported-arguments'],
        artifactPaths: []
      }
    },
    {
      code: 'VERIFY-BLOCKED-001',
      expected: {
        issueType: 'composition',
        recoverable: true,
        suggestedActions: ['run-platform-resolve', 'run-platform-compose', 'retry-platform-verify']
      }
    },
    {
      code: 'VERIFY-ACCEPTANCE-003',
      expected: {
        issueType: 'spec',
        recoverable: false,
        suggestedActions: ['inspect-verification-report', 'run-platform-explain'],
        artifactPaths: [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.reviewSummary]
      }
    },
    {
      code: 'REPAIR-BLOCKED-001',
      expected: {
        issueType: 'composition',
        recoverable: true,
        suggestedActions: ['inspect-repair-plan', 'run-platform-repair-dry-run'],
        artifactPaths: [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.reviewSummary]
      }
    },
    {
      code: 'UPGRADE-MIGRATION-016',
      expected: {
        issueType: 'composition',
        recoverable: true,
        artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan]
      }
    },
    {
      code: 'ERROR-DRIFT-001',
      expected: {
        issueType: 'spec',
        recoverable: false,
        suggestedActions: ['run-platform-compose', 'revert-local-project-changes'],
        artifactPaths: [CI_ARTIFACT_FILES.provenance]
      }
    }
  ] as const;

  for (const { code, expected } of cases) {
    expect(buildErrorProtocol({ code, message: 'fixture' }), code).toMatchObject(expected);
  }
});

test('error-contract CLI exposes the stable protocol boundary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'errors'], {
      text: [
        'Error protocol active',
        'Example usage-error; code=CLI-USAGE-001',
        'Example verify-acceptance-error; code=VERIFY-ACCEPTANCE-003',
        'Example upgrade-rollback-error; code=UPGRADE-MIGRATION-016'
      ],
      json: {
        status: 'active',
        command: 'bun run sec -- contract errors --json',
        issueTypes: ['composition', 'kernel', 'spec', 'usage']
      }
    });
  });
});
