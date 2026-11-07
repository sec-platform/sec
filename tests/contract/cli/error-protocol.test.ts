import { expect, test } from 'bun:test';
import path from 'node:path';

import { buildErrorProtocol } from '../../../src/application/error-protocol.ts';
import type { ErrorProtocolContract } from '../../../src/application/error-protocol-contract.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliText } from '../../testkit/cli.ts';

test('error-contract CLI exposes the stable protocol boundary', async () => {
  // This in-process cwd is request data only; no selected reader opens it.
  const workspaceRoot = path.resolve('/cli-input-only');
  await expectCliText(workspaceRoot, ['contract', 'errors'], [
    'Error protocol active',
    'Example usage-error; code=CLI-USAGE-001',
    'Example verify-acceptance-error; code=VERIFY-ACCEPTANCE-003',
    'Example upgrade-rollback-error; code=UPGRADE-MIGRATION-016'
  ]);
  const contract = await expectCliJson<ErrorProtocolContract>(
    workspaceRoot, ['contract', 'errors', '--json', '--compact'],
    {
      status: 'active',
      command: 'bun run sec -- contract errors --json',
      issueTypes: ['composition', 'kernel', 'spec', 'usage']
    },
    { compact: true }
  );
  const cases = [
    {
      code: 'UPGRADE-NOOP-001',
      expected: { suggestedActions: ['choose-different-upgrade-target'] }
    },
    {
      code: 'REPAIR-BLOCKED-002',
      expected: { suggestedActions: ['run-platform-verify', 'retry-platform-repair-dry-run'] }
    },
    { code: 'PIPELINE-USAGE-001', expected: { issueType: 'usage' } },
    { code: 'PIPELINE-INTERNAL-001', expected: { issueType: 'kernel' } },
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
    // Catalog examples already pass through the real protocol owner. Only
    // pipeline codes absent from that catalog need a direct invocation here.
    const result = code.startsWith('PIPELINE-')
      ? buildErrorProtocol({ code, message: 'fixture' })
      : contract.examples.find((example) => example.output.code === code)?.output;
    expect(result, code).toBeDefined();
    expect(result, code).toMatchObject(expected);
    if ('suggestedActions' in expected) {
      expect(result!.suggestedActions, code).toEqual(expected.suggestedActions);
    }
  }

  // These are catalog projection consistency checks, not a replacement for the
  // fixed protocol expectations on individual real error codes above.
  expect(contract.exampleCount).toBe(contract.examples.length);
  const observedIssueTypes = new Set(contract.examples.map(({ output }) => output.issueType));
  expect(new Set(contract.issueTypes)).toEqual(observedIssueTypes);
  expect(contract.issueTypeCount).toBe(observedIssueTypes.size);
  expect(contract.suggestedActionCount).toBe(new Set(
    contract.examples.flatMap(({ output }) => output.suggestedActions)
  ).size);
  const observedArtifactPaths = new Set(contract.examples.flatMap(({ output }) => output.artifactPaths));
  expect(new Set(contract.artifactPaths)).toEqual(observedArtifactPaths);
  expect(contract.artifactPathCount).toBe(observedArtifactPaths.size);

  const rollback = contract.examples.find((example) => example.id === 'upgrade-rollback-error')!;
  const expectedDetails = {
    migrationId: 'mig-customer-normalizer-file',
    migrationKind: 'file-replace',
    rollbackStatus: 'restored'
  };
  expect(rollback.input.details).toMatchObject(expectedDetails);
  expect(rollback.output.details).toMatchObject(expectedDetails);
  expect(rollback.output.details).toEqual(rollback.input.details);
  const unexpected = contract.examples.find((example) => example.id === 'unexpected-error')!;
  expect(unexpected.input).not.toHaveProperty('code');
  expect(unexpected.input).not.toHaveProperty('details');
  expect(unexpected.output).toMatchObject({
    code: 'UNEXPECTED', message: 'Unexpected failure',
    issueType: 'kernel', recoverable: false,
    suggestedActions: ['inspect-cli-stack', 'collect-error-output'],
    artifactPaths: []
  });
});
