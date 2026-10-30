import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildPipelineCompletionProof } from '../../../src/adapters/verification/pipeline-completion-proof.ts';
import { assertPipelineCompletionProofInvariant } from '../../../src/assurance/verification/pipeline/completion-proof.ts';

function proof() {
  return {
    formatRevision: 'pipeline-completion-proof-v2',
    transactionId: 'tx:proof',
    inputRevision: `sha256:${'1'.repeat(64)}`,
    semanticRevision: `sha256:${'2'.repeat(64)}`,
    completedStages: ['resolve', 'semantic', 'compose', 'verify', 'lock', 'emit'],
    completedPasses: ['parse', 'align', 'resolve', 'build-ir', 'compose', 'verify', 'lock', 'emit'],
    verificationDigest: `sha256:${'3'.repeat(64)}`,
    provenanceDigest: `sha256:${'4'.repeat(64)}`,
    explainGraphDigest: `sha256:${'5'.repeat(64)}`,
    reviewSummaryDigest: `sha256:${'6'.repeat(64)}`,
    // Independent SHA-256 of the literal domain and payload above, in wire order.
    proofRevision: 'sha256:4862b9d76d34ef7bdc2135bf1930520716f0f30e373fb8b3106af689efcab9b9'
  };
}

test('completion proof binds its literal payload and ordered stage evidence', () => {
  assert.doesNotThrow(() => assertPipelineCompletionProofInvariant(proof()));
  for (const field of ['completedStages', 'completedPasses'] as const) {
    const value = proof();
    value[field] = [...value[field]].reverse();
    assert.throws(() => assertPipelineCompletionProofInvariant(value), /registry-owned (stage|pass) closure/);
  }
});

test('completion producer distinguishes partial stages from missing full-pipeline evidence', async () => {
  const complete = proof().completedStages;
  for (const completedStages of [[], complete.slice(0, 1)]) {
    assert.equal(await buildPipelineCompletionProof('must-not-be-observed', { completedStages } as never), undefined);
  }
  await assert.rejects(buildPipelineCompletionProof('must-not-be-observed', { completedStages: complete } as never),
    /Full Pipeline completion is missing derivative binding evidence/);
});
