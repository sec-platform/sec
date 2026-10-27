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

test('public completion proof admits exact data and rejects hidden or incomplete stage evidence', () => {
  assert.doesNotThrow(() => assertPipelineCompletionProofInvariant(proof()));
  assert.doesNotThrow(() => assertPipelineCompletionProofInvariant(Object.assign(Object.create(null), proof())));
  const proxy = new Proxy(proof(), { get() { assert.fail('proof get trap'); } });
  assert.doesNotThrow(() => assertPipelineCompletionProofInvariant(proxy));

  for (const kind of ['getter', 'hidden', 'symbol', 'extra', 'missing', 'prototype']) {
    let invoked = false;
    const value: Record<string | symbol, unknown> = proof();
    if (kind === 'getter') Object.defineProperty(value, 'transactionId', { get() { invoked = true; assert.fail('getter'); } });
    if (kind === 'hidden') Object.defineProperty(value, 'transactionId', { value: 'tx:proof', enumerable: false });
    if (kind === 'symbol') value[Symbol('extra')] = 7;
    if (kind === 'extra') value.extra = 7;
    if (kind === 'missing') delete value.transactionId;
    if (kind === 'prototype') Object.setPrototypeOf(value, { extension: true });
    assert.throws(() => assertPipelineCompletionProofInvariant(value), /exact schema|own enumerable data|plain data object/);
    assert.equal(invoked, false);
  }
  for (const kind of ['hole', 'getter', 'extra', 'hidden']) {
    let invoked = false;
    const value = proof();
    const stages = value.completedStages;
    if (kind === 'hole') delete stages[0];
    if (kind === 'getter') Object.defineProperty(stages, 0, { get() { invoked = true; assert.fail('getter'); } });
    if (kind === 'extra') Object.defineProperty(stages, 'toJSON', { value() { invoked = true; assert.fail('toJSON'); } });
    if (kind === 'hidden') Object.defineProperty(stages, 0, { value: 'resolve', enumerable: false });
    assert.throws(() => assertPipelineCompletionProofInvariant(value), /dense data array/);
    assert.equal(invoked, false);
  }
  for (const field of ['completedStages', 'completedPasses'] as const) {
    const value = proof();
    value[field] = [...value[field]].reverse();
    assert.throws(() => assertPipelineCompletionProofInvariant(value), /registry-owned (stage|pass) closure/);
  }
});

test('public completion producer never treats caller methods or inherited slots as completed stages', async () => {
  const complete = proof().completedStages;
  const incomplete: unknown[] = [[], complete.slice(0, 1), [...complete, 'extra'], { ...complete, length: complete.length }];
  const sparse = [...complete];
  delete sparse[complete.length - 1];
  incomplete.push(sparse);
  const inherited = [...complete];
  delete inherited[0];
  Object.setPrototypeOf(inherited, { 0: complete[0] });
  incomplete.push(inherited);
  const forged = complete.map(() => 'forged');
  // @ts-expect-error Deliberately substitutes the caller's comparison method.
  forged.every = () => true;
  incomplete.push(forged);
  const accessor = [...complete];
  Object.defineProperty(accessor, 0, { get() { assert.fail('stage getter'); } });
  incomplete.push(accessor);
  for (const completedStages of incomplete) {
    assert.equal(await buildPipelineCompletionProof('must-not-be-observed', { completedStages } as never), undefined);
  }
  await assert.rejects(buildPipelineCompletionProof('must-not-be-observed', { completedStages: complete } as never),
    /Full Pipeline completion is missing derivative binding evidence/);
});
