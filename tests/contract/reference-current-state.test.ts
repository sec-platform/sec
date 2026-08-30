import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse } from 'yaml';

import { readLockFile } from '../../src/compiler/lock.ts';
import { assertCanonicalVerificationArtifactSet, type VerificationArtifactSet } from '../../src/verification/artifact/contract/artifact.ts';

const root = path.resolve(import.meta.dir, '../..');

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}

test('current reference projection preserves library applicability and typed Policy frontier', () => {
  const source = parse(readFileSync(path.join(root, 'source/app.yaml'), 'utf8')) as {
    app: { stack: string };
    acceptance: Array<{ id: string }>;
  };
  const lock = readLockFile(root);
  const artifacts: VerificationArtifactSet = {
    verificationReport: readJson('control/evidence/verification-report.json'),
    runtimeReport: readJson('control/evidence/runtime-report.json'),
    policyReport: readJson('control/evidence/policy-report.json'),
    acceptanceCoverage: readJson('control/evidence/acceptance-coverage.json')
  };
  assertCanonicalVerificationArtifactSet(artifacts);

  expect(source.app.stack).toBe('typescript-library');
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

  const retiredDefaultWebPath = /^(?:app|components|control\/workbench|generated)(?:\/|$)|^next(?:-env\.d\.ts|\.config\.mjs)$/u;
  expect(lock.generatedPaths.filter((entry) => retiredDefaultWebPath.test(entry))).toEqual([]);
  expect(lock.installPlan.map(({ to }) => to)).toContain(
    'tests/acceptance/customer-attachments-flow.test.ts'
  );
});
