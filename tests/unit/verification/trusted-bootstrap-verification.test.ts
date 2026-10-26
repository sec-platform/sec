import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  runTrustedBootstrapVerification, type TrustedBootstrapIdentity,
  type TrustedBootstrapVerificationPorts
} from '../../../src/application/trusted-bootstrap-verification.ts';
import { evaluateTrustedBootstrapSutEvidence } from '../../../src/execution/verification/trusted-bootstrap.ts';

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

test('POST rejects untrusted PRE semantics and ambiguous bytes before authority or SUT consumption', async () => {
  const cases = [
    [wire({ ...preSemantic(), candidateModuleCount: -1 }), 'candidate Action fields are inconsistent'],
    [Buffer.from(wire(preSemantic()).toString().replace('{', '{"\\u0070hase":"post",')), 'contains duplicate key "phase"']
  ] as const;
  for (const [bytes, message] of cases) {
    const { ports, calls } = fixture(bytes);
    await expect(runTrustedBootstrapVerification(identity, ports)).rejects.toThrow(message);
    expect(calls).toEqual(['identity', 'create:base', 'create:candidate', 'finalize:base', 'finalize:candidate']);
  }
});

test('application PRE then unavailable POST preserves independent causal and authority facts', async () => {
  const expected = preSemantic();
  const preBytes = wire(expected);
  const first = fixture(new Uint8Array());
  const before = await runTrustedBootstrapVerification({ ...identity, phase: 'pre' }, first.ports);
  expect(before.receipt).toEqual(JSON.parse(preBytes.toString()));
  expect(first.calls.filter(call => call.startsWith('compile-'))).toEqual(['compile-checker', 'compile-candidate']);
  const second = fixture(preBytes);
  const after = await runTrustedBootstrapVerification(identity, second.ports);
  for (const field of ['checkerActionKey', 'checkerActionResultDigest', 'checkerClosureDigest',
    'candidateActionKey', 'candidateActionResultDigest', 'candidateClosureDigest', 'candidateTrustRevision',
    'candidateModuleCount', 'authorityVerdict', 'authorityReason', 'baseUndecidablePaths']) {
    expect(after.receipt[field]).toEqual(expected[field]);
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
test('POST observations remain auxiliary and malformed SUT bytes cannot reach preparation', async () => {
  const cases = [
    { status: 'passed', jobResult: 'success', cleanupComplete: true, malformed: false, expected: 'passed' },
    { status: 'failed', jobResult: 'failure', cleanupComplete: true, malformed: false, expected: 'failed' },
    { status: 'passed', jobResult: 'failure', cleanupComplete: true, malformed: false, expected: 'invalid' },
    { status: 'passed', jobResult: 'success', cleanupComplete: false, malformed: false, expected: 'invalid' },
    { status: 'passed', jobResult: 'success', cleanupComplete: true, malformed: true, expected: 'invalid' }
  ] as const;
  for (const sample of cases) {
    const files = sutFiles(sample.status);
    if (sample.malformed) {
      files.set('sut-receipt.json', Buffer.from(Buffer.from(files.get('sut-receipt.json')!).toString()
        .replace('{', '{"auxiliaryStatus":"failed",')));
    }
    const { ports, calls } = fixture(wire(preSemantic()), files);
    const selectedPorts = sample.expected !== 'invalid' || sample.malformed ? ports
      : { ...ports, parseSutCleanup: () => sample.cleanupComplete };
    const after = await runTrustedBootstrapVerification({ ...identity, sutDownloadOutcome: 'success',
      sutJobResult: sample.jobResult }, selectedPorts);
    expect(after.receipt.authorityVerdict).toBe('manual-bootstrap-required');
    expect(after.receipt.auxiliaryStatus).toBe(sample.expected);
    if (sample.expected !== 'invalid') {
      expect(after.receipt.sutEvidenceDigest).not.toBe(null);
      expect(after.diagnostic?.auxiliaryReason).toBe(`candidate-sut-diagnostics-${sample.expected}`);
    }
    if (sample.malformed) {
      expect(calls.includes('prepare-sut')).toBe(false);
      expect(() => evaluateTrustedBootstrapSutEvidence({ ...identity, jobResult: 'success', files,
        capabilityComplete: true, lifecycleComplete: true, cleanupComplete: true, sandboxPolicyDigest: digest('7') }))
        .toThrow('contains duplicate key "auxiliaryStatus"');
    }
  }
});
