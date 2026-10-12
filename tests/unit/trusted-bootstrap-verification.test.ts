import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  runTrustedBootstrapVerification, type TrustedBootstrapIdentity,
  type TrustedBootstrapVerificationPorts
} from '../../src/application/trusted-bootstrap-verification.ts';
import { evaluateTrustedBootstrapSutEvidence } from '../../src/execution/verification/trusted-bootstrap.ts';

type Digest = `sha256:${string}`;
const hash = (bytes: Uint8Array | string): Digest => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const sha = (digit: string) => digit.repeat(40);
const digest = (digit: string): Digest => `sha256:${digit.repeat(64)}`;
const registry = Buffer.from('independent registry bytes');
const program = Buffer.from('independent loaded checker bytes');
const identity: TrustedBootstrapIdentity = {
  phase: 'post', baseSha: sha('a'), baseTreeSha: sha('b'), headSha: sha('c'), treeSha: sha('d'),
  registryDigest: hash(registry), preDownloadOutcome: 'success', sutDownloadOutcome: 'failure', sutJobResult: 'failure'
};
const action = { actionKey: digest('2'), resultDigest: digest('3'),
  identity: { closureDigest: digest('3'), trustRevision: 'fixture', moduleCount: 1, modules: ['src/runtime.ts'] } };
function preSemantic(): Record<string, unknown> {
  return { schema: 'sec-trusted-bootstrap-checker-receipt-v1', phase: 'pre',
    checkerBaseSha: identity.baseSha, baseTreeSha: identity.baseTreeSha,
    candidateHeadSha: identity.headSha, candidateTreeSha: identity.treeSha, candidateParentSha: identity.baseSha,
    registryDigest: identity.registryDigest, checkerActionKey: action.actionKey,
    checkerActionResultDigest: action.resultDigest, checkerClosureDigest: action.identity.closureDigest,
    candidateActionKey: action.actionKey, candidateActionResultDigest: action.resultDigest,
    candidateClosureDigest: action.identity.closureDigest, candidateTrustRevision: 'fixture', candidateModuleCount: 1,
    checkerProgramDigest: hash(program), checkerToolBlob: sha('e'), checkerWorkflowBlob: sha('e'),
    candidateToolBlob: sha('e'), candidateWorkflowBlob: sha('e'), authorityVerdict: 'manual-bootstrap-required',
    authorityReason: 'trusted-base-cannot-decide-checker-policy-or-validation-plan-change',
    baseUndecidablePaths: ['src/policy.ts'], auxiliaryStatus: 'not-observed',
    sutEvidenceDigest: null, sutJobResult: null, sutDiagnosticDigest: null };
}
function wire(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ ...value, receiptDigest: hash(JSON.stringify(value)) }));
}
function fixture(preBytes: Uint8Array, files = new Map<string, Uint8Array>()) {
  const calls: string[] = [];
  const ports: TrustedBootstrapVerificationPorts<string, string, string, typeof action> = {
    assertExactIdentity: () => { calls.push('identity'); },
    createSnapshot: root => { calls.push(`create:${root}`); return root; },
    finalizeSnapshot: root => { calls.push(`finalize:${root}`); },
    readRegistry: () => registry,
    parseRegistry: () => 'registry', changedPaths: () => ['src/policy.ts'],
    compileChecker: () => { calls.push('compile-checker'); return action; },
    baseTrustRuntimePaths: () => ['src/runtime.ts'],
    selectCandidate: () => ({ impactedPaths: ['src/policy.ts'], plan: 'plan' }),
    compileCandidate: () => { calls.push('compile-candidate'); return action; },
    readPreReceipt: () => preBytes,
    readSutFile: name => { calls.push(`sut:${name}`); const bytes = files.get(name); if (!bytes) throw new Error('missing member'); return bytes; },
    prepareSut: async () => { calls.push('prepare-sut'); },
    parseSutCapability: value => { calls.push('capability'); return (value as { complete: boolean }).complete; },
    parseSutLifecycle: value => { calls.push('lifecycle'); return (value as { complete: boolean }).complete; },
    parseSutCleanup: value => { calls.push('cleanup'); return (value as { complete: boolean }).complete; },
    sandboxPolicyDigest: () => digest('7'), checkerProgramBytes: () => program,
    gitBlob: () => { calls.push('blob'); return sha('e'); }
  };
  return { ports, calls };
}

const malformed: Array<readonly [string, Record<string, unknown>]> = [
  ['negative module count', { candidateModuleCount: -1 }],
  ['fractional module count', { candidateModuleCount: 1.5 }],
  ['string module count', { candidateModuleCount: '1' }],
  ['null Action residue', { candidateActionKey: null }],
  ['invalid SHA', { checkerToolBlob: 'g'.repeat(40) }],
  ['invalid digest', { checkerActionKey: 'not-a-digest' }],
  ['closure mismatch', { checkerActionResultDigest: digest('9') }],
  ['unknown verdict', { authorityVerdict: 'anything' }],
  ['empty reason', { authorityReason: '' }],
  ['traversal', { baseUndecidablePaths: ['../outside.ts'] }],
  ['absolute', { baseUndecidablePaths: ['/outside.ts'] }],
  ['duplicate', { baseUndecidablePaths: ['src/a.ts', 'src/a.ts'] }],
  ['POST status', { auxiliaryStatus: 'passed' }],
  ['POST evidence', { sutEvidenceDigest: digest('8') }],
  ['POST job result', { sutJobResult: 'success' }],
  ['POST diagnostic', { sutDiagnosticDigest: digest('8') }]
];
for (const [name, patch] of malformed) {
  test(`POST application rejects rehashed PRE ${name} before consuming its causal or authority fields`, async () => {
    const { ports, calls } = fixture(wire({ ...preSemantic(), ...patch }));
    await expect(runTrustedBootstrapVerification(identity, ports)).rejects.toThrow();
    expect(calls).toEqual(['identity', 'create:base', 'create:candidate', 'finalize:base', 'finalize:candidate']);
  });
}
for (const [name, bytes] of [
  ['duplicate', Buffer.from(wire(preSemantic()).toString().replace('{', '{"candidateModuleCount":-1,'))],
  ['escaped duplicate', Buffer.from(wire(preSemantic()).toString().replace('{', '{"\\u0070hase":"post",'))],
  ['depth', Buffer.from(wire(preSemantic()).toString().replace('"fixture"', '['.repeat(33) + '0' + ']'.repeat(33)))],
  ['trailing data', Buffer.concat([wire(preSemantic()), Buffer.from('{}')])],
  ['invalid UTF-8', Buffer.concat([wire(preSemantic()), Uint8Array.of(0xff)])]
] as const) {
  test(`POST application rejects PRE ${name} wire bytes before SUT preparation`, async () => {
    const { ports, calls } = fixture(bytes);
    await expect(runTrustedBootstrapVerification(identity, ports)).rejects.toThrow();
    expect(calls).toEqual(['identity', 'create:base', 'create:candidate', 'finalize:base', 'finalize:candidate']);
  });
}

test('application PRE then unavailable POST preserves independent causal and authority facts', async () => {
  const first = fixture(new Uint8Array());
  const before = await runTrustedBootstrapVerification({ ...identity, phase: 'pre' }, first.ports);
  expect(before.receipt).toEqual(JSON.parse(wire(preSemantic()).toString()));
  expect(first.calls.filter(call => call.startsWith('compile-'))).toEqual(['compile-checker', 'compile-candidate']);
  const second = fixture(wire(preSemantic()));
  const after = await runTrustedBootstrapVerification(identity, second.ports);
  for (const field of ['checkerActionKey', 'checkerActionResultDigest', 'checkerClosureDigest',
    'candidateActionKey', 'candidateActionResultDigest', 'candidateClosureDigest', 'candidateTrustRevision',
    'candidateModuleCount', 'authorityVerdict', 'authorityReason', 'baseUndecidablePaths']) {
    expect(after.receipt[field]).toEqual(preSemantic()[field]);
  }
  expect(after.receipt.auxiliaryStatus).toBe('unavailable');
  expect(after.receipt.sutEvidenceDigest).toBe(null);
  expect(after.diagnostic?.auxiliaryReason).toBe('candidate-sut-artifact-unavailable');
  expect(second.calls.some(call => call.startsWith('compile-'))).toBe(false);
});

function sutFiles(status: 'passed' | 'failed') {
  // Protocol inventory is independent of the production list/builder.
  const names = ['tcb-lock-pre.json', 'imports.log', 'docs-doctor.log', 'typecheck.log', 'diff-check.log',
    'focused-tests.log', 'repository-audit.json', 'affected-plan.json', 'affected-tests.log', 'tcb-lock-post.json'];
  const files = new Map<string, Uint8Array>(names.map(name => [name, Buffer.from(`fixture:${name}`)]));
  const sums = names.map(name => `${hash(files.get(name)!).slice(7)}  ${name}`).join('\n') + '\n';
  files.set('SHA256SUMS', Buffer.from(sums));
  const value = { schema: 'sec-trusted-bootstrap-sut-receipt-v3', baseSha: identity.baseSha,
    headSha: identity.headSha, treeSha: identity.treeSha, parentSha: identity.baseSha, auxiliaryStatus: status,
    evidenceSetDigest: hash(sums), bootstrapDigest: digest('1'), sandboxPolicyDigest: digest('7'),
    commandPlanDigest: status === 'passed' ? digest('2') : null, archiveDigest: digest('3'),
    archiveInventoryDigest: digest('4'), executionOutputDigest: digest('5'), capability: { complete: true },
    executionLifecycle: { complete: true }, cleanup: { complete: true } };
  files.set('sut-receipt.json', wire(value));
  return files;
}
for (const status of ['passed', 'failed'] as const) {
  test(`POST application keeps ${status} SUT auxiliary observation separate from PRE authority`, async () => {
    const { ports } = fixture(wire(preSemantic()), sutFiles(status));
    const after = await runTrustedBootstrapVerification({ ...identity, sutDownloadOutcome: 'success',
      sutJobResult: status === 'passed' ? 'success' : 'failure' }, ports);
    expect(after.receipt.authorityVerdict).toBe('manual-bootstrap-required');
    expect(after.receipt.auxiliaryStatus).toBe(status);
    expect(after.receipt.sutEvidenceDigest).not.toBe(null);
    expect(after.diagnostic?.auxiliaryReason).toBe(`candidate-sut-diagnostics-${status}`);
  });
}
for (const [name, mutate] of [
  ['duplicate root key', (source: string) => source.replace('{', '{"auxiliaryStatus":"failed",')],
  ['duplicate nested key', (source: string) => source.replace('"complete":true', '"complete":false,"complete":true')],
  ['excessive depth', (source: string) => source.replace('"complete":true', `"complete":${'['.repeat(33)}0${']'.repeat(33)}`)]
] as const) {
  test(`SUT receipt ${name} fails in both application and execution byte consumers`, async () => {
    const files = sutFiles('passed');
    files.set('sut-receipt.json', Buffer.from(mutate(Buffer.from(files.get('sut-receipt.json')!).toString())));
    const { ports, calls } = fixture(wire(preSemantic()), files);
    const after = await runTrustedBootstrapVerification({ ...identity, sutDownloadOutcome: 'success', sutJobResult: 'success' }, ports);
    expect(after.receipt.auxiliaryStatus).toBe('invalid');
    expect(after.receipt.authorityVerdict).toBe('manual-bootstrap-required');
    expect(calls.includes('prepare-sut')).toBe(false);
    expect(() => evaluateTrustedBootstrapSutEvidence({ ...identity, jobResult: 'success', files,
      capabilityComplete: true, lifecycleComplete: true, cleanupComplete: true, sandboxPolicyDigest: digest('7') })).toThrow();
  });
}

test('provider failure and incomplete physical observations cannot become auxiliary PASS', async () => {
  for (const incomplete of [false, true]) {
    const { ports } = fixture(wire(preSemantic()), sutFiles('passed'));
    const after = await runTrustedBootstrapVerification({ ...identity, sutDownloadOutcome: 'success',
      sutJobResult: incomplete ? 'success' : 'failure' }, { ...ports, parseSutCleanup: () => !incomplete });
    expect(after.receipt.auxiliaryStatus).toBe('invalid');
    expect(after.receipt.authorityVerdict).toBe('manual-bootstrap-required');
  }
});
