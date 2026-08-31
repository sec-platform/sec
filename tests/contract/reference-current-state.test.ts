import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse } from 'yaml';

import { SUPPORTED_STACK } from '../../src/compiler/contract.ts';
import { readLockFile } from '../../src/compiler/lock.ts';
import { referenceWorkspaceRoot } from '../../src/reference/workspace.ts';
import { assertCanonicalVerificationArtifactSet, type VerificationArtifactSet } from '../../src/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

test('current reference projection preserves library applicability and typed Policy frontier', () => {
  const source = parse(readFileSync(path.join(referenceWorkspaceRoot, 'sec.yaml'), 'utf8')) as {
    app: { stack: string };
    acceptance: Array<{ id: string }>;
  };
  const lock = readLockFile(referenceWorkspaceRoot);
  const artifacts: VerificationArtifactSet = {
    verificationReport: readJson(resolveWorkspaceArtifactPath(referenceWorkspaceRoot, CI_ARTIFACT_FILES.verificationReport)),
    runtimeReport: readJson(resolveWorkspaceArtifactPath(referenceWorkspaceRoot, CI_ARTIFACT_FILES.runtimeReport)),
    policyReport: readJson(resolveWorkspaceArtifactPath(referenceWorkspaceRoot, CI_ARTIFACT_FILES.policyReport)),
    acceptanceCoverage: readJson(resolveWorkspaceArtifactPath(referenceWorkspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage))
  };
  assertCanonicalVerificationArtifactSet(artifacts);

  expect(source.app.stack).toBe(SUPPORTED_STACK);
  expect(lock.app.stack).toBe(source.app.stack);
  expect(source.acceptance.map(({ id }) => id)).toContain('customer_can_upload_attachment');
  expect(source.acceptance.map(({ id }) => id)).toContain('ticket_attachment_can_be_uploaded');
  expect(artifacts.acceptanceCoverage.uncoveredBlocks).toEqual([]);
  expect(artifacts.acceptanceCoverage.uncoveredSlots).toEqual([]);
  expect(artifacts.acceptanceCoverage.acceptancePassed).toContain('customer_can_upload_attachment');
  expect(artifacts.acceptanceCoverage.acceptancePassed).toContain('ticket_attachment_can_be_uploaded');

  expect(artifacts.verificationReport.fast.status).toBe('passed');
  expect(artifacts.verificationReport.runtime.status).toBe('passed');
  expect(artifacts.verificationReport.summary.claimSummary.overall.overallStatus).toBe('unsupported');
  const policyGate = artifacts.verificationReport.summary.claimSummary.gates.find(
    ({ gateId }) => gateId === 'product-policy-gate'
  );
  expect(policyGate).toMatchObject({
    applicability: 'required',
    status: 'unsupported',
    reasonCode: 'capability-unsupported',
    supportedClaims: []
  });
  expect(artifacts.policyReport.evaluation).toMatchObject({
    assurance: 'source-structure',
    requiredSemanticPredicates: ['FLOWS_TO'],
    unsupportedSemanticPredicates: ['FLOWS_TO']
  });
  expect(lock.passStatus.verify).toBe('failed');

  expect(lock.installPlan.map(({ to }) => to)).toContain(
    'tests/acceptance/customer-attachments-flow.test.ts'
  );
});
