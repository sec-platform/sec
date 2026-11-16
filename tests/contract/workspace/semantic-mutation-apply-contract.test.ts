import { createHash } from 'node:crypto';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { semanticMutationTransactionRoot } from '../../../src/adapters/mutation/transaction-identity.ts';
import {
  semanticMutationIsolatedVerificationEvidenceDigest,
  type SemanticMutationIsolatedVerificationEvidence
} from '../../../src/assurance/verification/semantic-mutation/isolated-evidence.ts';
import { applySemanticMutation } from '../../../src/bootstrap/engineering/cli.ts';
import { sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';
import { isSemanticMutationStagingWorkspace } from '../../../src/workspace/contract/semantic-mutation-staging.ts';

test('semantic mutation staging layout is exactly the canonical transaction workspace', () => {
  const workspaceRoot = path.resolve('contract-workspace');
  const digest = sha256('canonical-transaction-layout');
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, digest);
  const transactionName = digest.slice('sha256:'.length);
  expect(transactionRoot).toBe(path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    transactionName
  ));
  expect(isSemanticMutationStagingWorkspace(path.join(transactionRoot, 'workspace'))).toBe(true);
  expect(isSemanticMutationStagingWorkspace(path.join(workspaceRoot, '.sec', 's', transactionName))).toBe(false);
  expect(isSemanticMutationStagingWorkspace(path.join(transactionRoot, 'staging'))).toBe(false);
  expect(isSemanticMutationStagingWorkspace(path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'not-a-digest',
    'workspace'
  ))).toBe(false);
});

test('ordinary malformed requests return the exact redacted request-rejected outcome before lease acquisition', async () => {
  const outcome = await applySemanticMutation('Z:\\must-not-be-observed', {
    request: { contractVersion: '1', requestId: 'request:malformed' }
  } as never);
  expect(Object.keys(outcome).sort()).toEqual([
    'status', 'requestId', 'requestRevision', 'diagnostics', 'diagnosticRevision'
  ].sort());
  expect(outcome).toMatchObject({
    status: 'request-rejected',
    requestId: 'request:malformed',
    requestRevision: ''
  });
  if (outcome.status !== 'request-rejected') throw new Error(JSON.stringify(outcome));
  expect(outcome.diagnostics).toHaveLength(1);
  expect(JSON.stringify(outcome)).not.toContain(JSON.stringify('Z:\\must-not-be-observed').slice(1, -1));
  expect(outcome.diagnosticRevision).toBe(sha256({
    domain: 'semantic-mutation-diagnostic-v2',
    diagnostics: outcome.diagnostics
  }));
});

test('isolated Verification evidence digest binds artifact content and failure stage deterministically', () => {
  const passed = {
    status: 'passed',
    artifacts: {
      rawDigests: {
        acceptanceCoverage: `sha256:${'a'.repeat(64)}`,
        policyReport: `sha256:${'b'.repeat(64)}`,
        runtimeReport: `sha256:${'c'.repeat(64)}`,
        verificationReport: `sha256:${'d'.repeat(64)}`
      },
      semanticBundle: {
        snapshot: {
          ir: {
            inputRevision: `sha256:${'1'.repeat(64)}`,
            semanticRevision: `sha256:${'2'.repeat(64)}`
          }
        }
      },
      verificationReport: {
        summary: { status: 'passed', requestedLane: 'all', failedLanes: [] },
        build: { status: 'passed' },
        unit: { status: 'passed', passed: ['unit'] },
        acceptance: { status: 'passed', passed: ['acceptance'], failed: [] },
        policy: { status: 'skipped', violations: [] },
        runtime: {
          status: 'passed',
          build: {
            status: 'passed', passed: ['build'], failed: [], command: 'bun run build'
          },
          unit: {
            status: 'passed', passed: ['unit'], failed: [], command: 'bun run test:unit'
          },
          acceptance: {
            status: 'passed', passed: ['acceptance'], failed: [],
            command: 'bun run test:acceptance'
          }
        }
      }
    }
  } as unknown as Extract<
    SemanticMutationIsolatedVerificationEvidence,
    { readonly status: 'passed' }
  >;
  const passedDigest = semanticMutationIsolatedVerificationEvidenceDigest(passed);
  const equivalentPassedDigest = semanticMutationIsolatedVerificationEvidenceDigest(
    structuredClone(passed)
  );
  const blockedDigest = semanticMutationIsolatedVerificationEvidenceDigest({
    status: 'blocked',
    failure: { stage: 'binding-mismatch' }
  });
  const expectedPassedPayload = {
    domain: 'semantic-mutation-isolated-verification-evidence-v1',
    completedStages: ['resolve', 'semantic', 'compose', 'verify'],
    inputRevision: `sha256:${'1'.repeat(64)}`,
    semanticRevision: `sha256:${'2'.repeat(64)}`,
    generatedArtifactRawDigests: passed.artifacts.rawDigests,
    report: passed.artifacts.verificationReport
  };
  expect(passedDigest).toBe(`sha256:${createHash('sha256')
    .update(JSON.stringify(expectedPassedPayload)).digest('hex')}`);
  expect(equivalentPassedDigest).toBe(passedDigest);
  expect(blockedDigest).toBe(`sha256:${createHash('sha256').update(JSON.stringify({
    domain: 'semantic-mutation-isolated-verification-evidence-v1',
    reason: 'isolated-verification-unavailable',
    failure: { stage: 'binding-mismatch' }
  })).digest('hex')}`);
});
