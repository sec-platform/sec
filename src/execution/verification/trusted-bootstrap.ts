import { createHash } from 'node:crypto';

type Digest = `sha256:${string}`;
export const TRUSTED_BOOTSTRAP_CHECKER_RECEIPT_FIELDS = Object.freeze([
  'schema', 'phase', 'checkerBaseSha', 'baseTreeSha', 'candidateHeadSha', 'candidateTreeSha',
  'candidateParentSha', 'registryDigest', 'checkerActionKey', 'checkerActionResultDigest',
  'checkerClosureDigest', 'candidateActionKey', 'candidateActionResultDigest',
  'candidateClosureDigest', 'candidateTrustRevision', 'candidateModuleCount',
  'checkerProgramDigest', 'checkerToolBlob', 'checkerWorkflowBlob', 'candidateToolBlob',
  'candidateWorkflowBlob', 'authorityVerdict', 'authorityReason', 'baseUndecidablePaths',
  'auxiliaryStatus', 'sutEvidenceDigest', 'sutJobResult', 'sutDiagnosticDigest'
] as const);

export function trustedBootstrapDigest(bytes: Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function trustedBootstrapJsonDigest(value: object): Digest {
  return trustedBootstrapDigest(Buffer.from(JSON.stringify(value), 'utf8'));
}

export function assertTrustedBootstrapExactKeys(value: unknown, keys: readonly string[], label: string):
  asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} fields are unknown or missing.`);
  }
}

export function deriveTrustedBootstrapAuthority(input: Readonly<{
  impactedPaths: readonly string[];
  candidateRegistryFailure: string | null;
  candidateRegistryDigestMatches: boolean;
  candidateCompilationFailure: string | null;
  candidateCausalClosureMatches: boolean | null;
}>): Readonly<{
  verdict: 'failed' | 'manual-bootstrap-required' | 'passed';
  reason: string;
}> {
  const hard = new Set<string>();
  const manual = new Set<string>(input.impactedPaths.length === 0 ? []
    : ['trusted-base-cannot-decide-checker-policy-or-validation-plan-change']);
  if (input.impactedPaths.length === 0) hard.add('trusted-bootstrap-request-does-not-change-trust-root');
  if (input.candidateRegistryFailure !== null) {
    manual.add(`candidate-registry-schema-or-policy-change:${input.candidateRegistryFailure}`);
  }
  if (!input.candidateRegistryDigestMatches) manual.add('candidate-registry-differs-from-trusted-base-policy');
  if (input.candidateCompilationFailure !== null) {
    hard.add(`candidate-closure-computation-failed:${input.candidateCompilationFailure}`);
  }
  if (input.candidateCausalClosureMatches === false) {
    manual.add('candidate-causal-closure-differs-from-trusted-base-closure');
  }
  const verdict = hard.size > 0 ? 'failed'
    : manual.size > 0 ? 'manual-bootstrap-required' : 'passed';
  const reason = verdict === 'failed' ? [...hard].sort().join('|')
    : verdict === 'manual-bootstrap-required' ? [...manual].sort().join('|')
      : 'trusted-base-policy-fully-decided-candidate';
  return Object.freeze({ verdict, reason });
}

export function assertTrustedBootstrapPreReceipt(value: unknown, input: Readonly<{
  baseSha: string; baseTreeSha: string; headSha: string; treeSha: string;
  registryDigest: Digest; checkerProgramDigest: Digest;
}>): asserts value is Record<string, unknown> {
  assertTrustedBootstrapExactKeys(value, [...TRUSTED_BOOTSTRAP_CHECKER_RECEIPT_FIELDS, 'receiptDigest'],
    'trusted bootstrap PRE receipt');
  const { receiptDigest, ...semantic } = value;
  if (receiptDigest !== trustedBootstrapJsonDigest(semantic)
      || value.schema !== 'sec-trusted-bootstrap-checker-receipt-v1'
      || value.phase !== 'pre' || value.checkerBaseSha !== input.baseSha
      || value.baseTreeSha !== input.baseTreeSha || value.candidateHeadSha !== input.headSha
      || value.candidateTreeSha !== input.treeSha || value.candidateParentSha !== input.baseSha
      || value.registryDigest !== input.registryDigest
      || value.checkerProgramDigest !== input.checkerProgramDigest) {
    throw new Error('Trusted bootstrap PRE receipt identity or digest is invalid.');
  }
}

export function prepareTrustedBootstrapCheckerReceipt(semantic: Record<string, unknown>):
  Readonly<Record<string, unknown>> {
  assertTrustedBootstrapExactKeys(semantic, TRUSTED_BOOTSTRAP_CHECKER_RECEIPT_FIELDS,
    'trusted bootstrap checker receipt semantic');
  if (semantic.schema !== 'sec-trusted-bootstrap-checker-receipt-v1'
      || (semantic.phase !== 'pre' && semantic.phase !== 'post')) {
    throw new Error('Trusted bootstrap receipt schema or phase is invalid.');
  }
  return Object.freeze({ ...semantic, receiptDigest: trustedBootstrapJsonDigest(semantic) });
}

function stable(value: Record<string, unknown>): Record<string, unknown> {
  const { phase: _phase, receiptDigest: _digest, auxiliaryStatus: _auxiliaryStatus,
    sutEvidenceDigest: _sutDigest, sutJobResult: _sutResult,
    sutDiagnosticDigest: _sutDiagnosticDigest, ...rest } = value;
  return rest;
}

export function assertTrustedBootstrapStableReceipt(pre: Record<string, unknown>,
  post: Record<string, unknown>): void {
  assertTrustedBootstrapExactKeys(post, [...TRUSTED_BOOTSTRAP_CHECKER_RECEIPT_FIELDS, 'receiptDigest'],
    'trusted bootstrap POST receipt');
  if (JSON.stringify(stable(pre)) !== JSON.stringify(stable(post))) {
    throw new Error('Trusted bootstrap PRE and POST candidate closure receipts differ.');
  }
}

export function assertTrustedBootstrapPreparedReceipt(actual: unknown,
  expected: Readonly<Record<string, unknown>>): void {
  assertTrustedBootstrapExactKeys(actual, [...TRUSTED_BOOTSTRAP_CHECKER_RECEIPT_FIELDS, 'receiptDigest'],
    'trusted bootstrap prepared receipt');
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Trusted bootstrap prepared receipt differs from native-issued stage facts.');
  }
}

export const TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES = Object.freeze([
  'tcb-lock-pre.json', 'imports.log', 'docs-doctor.log', 'typecheck.log', 'diff-check.log',
  'focused-tests.log', 'repository-audit.json', 'affected-plan.json', 'affected-tests.log',
  'tcb-lock-post.json'
]);

export function assertTrustedBootstrapSutEvidenceDigestInventory(files: ReadonlyMap<string, Uint8Array>): void {
  const member = (name: string): Uint8Array => {
    const bytes = files.get(name);
    if (bytes === undefined) throw new Error(`Trusted bootstrap SUT member ${name} is absent.`);
    return bytes;
  };
  const sumsSource = new TextDecoder('utf-8', { fatal: true }).decode(member('SHA256SUMS'));
  const expectedLines = TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES.map(name =>
    `${trustedBootstrapDigest(member(name)).slice('sha256:'.length)}  ${name}`);
  if (sumsSource !== `${expectedLines.join('\n')}\n`) {
    throw new Error('candidate SUT evidence digest inventory is invalid');
  }
}

/** Verify the original auxiliary artifact without promoting it to closure
 * authority. Native parsers supply the three physical-completeness facts. */
export function evaluateTrustedBootstrapSutEvidence(input: Readonly<{
  baseSha: string; headSha: string; treeSha: string; jobResult: string;
  files: ReadonlyMap<string, Uint8Array>;
  capabilityComplete: boolean; lifecycleComplete: boolean; cleanupComplete: boolean;
  sandboxPolicyDigest: Digest;
}>): Readonly<{
  auxiliaryStatus: 'passed' | 'failed'; auxiliaryReason: string;
  evidenceSetDigest: Digest; candidateReceiptDigest: Digest;
}> {
  const member = (name: string): Uint8Array => {
    const bytes = input.files.get(name);
    if (bytes === undefined) throw new Error(`Trusted bootstrap SUT member ${name} is absent.`);
    return bytes;
  };
  assertTrustedBootstrapSutEvidenceDigestInventory(input.files);
  const sumsSource = new TextDecoder('utf-8', { fatal: true }).decode(member('SHA256SUMS'));
  const receipt: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(member('sut-receipt.json')));
  assertTrustedBootstrapExactKeys(receipt, [
    'schema', 'baseSha', 'headSha', 'treeSha', 'parentSha', 'auxiliaryStatus',
    'evidenceSetDigest', 'bootstrapDigest', 'sandboxPolicyDigest', 'commandPlanDigest',
    'archiveDigest', 'archiveInventoryDigest', 'executionOutputDigest',
    'capability', 'executionLifecycle', 'cleanup', 'receiptDigest'
  ], 'trusted bootstrap SUT receipt');
  const { receiptDigest, ...semantic } = receipt;
  const digestFields = [receipt.evidenceSetDigest, receipt.bootstrapDigest, receipt.sandboxPolicyDigest,
    receipt.archiveDigest, receipt.archiveInventoryDigest, receipt.executionOutputDigest];
  const complete = input.capabilityComplete && input.lifecycleComplete && input.cleanupComplete;
  if (receipt.schema !== 'sec-trusted-bootstrap-sut-receipt-v3'
      || receipt.baseSha !== input.baseSha || receipt.headSha !== input.headSha
      || receipt.treeSha !== input.treeSha || receipt.parentSha !== input.baseSha
      || (receipt.auxiliaryStatus !== 'passed' && receipt.auxiliaryStatus !== 'failed')
      || digestFields.some(value => typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value))
      || (receipt.commandPlanDigest !== null && (typeof receipt.commandPlanDigest !== 'string'
        || !/^sha256:[0-9a-f]{64}$/u.test(receipt.commandPlanDigest)))
      || receipt.sandboxPolicyDigest !== input.sandboxPolicyDigest
      || (receipt.auxiliaryStatus === 'passed' && (receipt.commandPlanDigest === null || !complete))
      || receipt.evidenceSetDigest !== trustedBootstrapDigest(Buffer.from(sumsSource, 'utf8'))
      || receiptDigest !== trustedBootstrapJsonDigest(semantic)
      || (receipt.auxiliaryStatus === 'passed') !== (input.jobResult === 'success')) {
    throw new Error('candidate SUT receipt identity or digest is invalid');
  }
  return Object.freeze({
    auxiliaryStatus: receipt.auxiliaryStatus,
    auxiliaryReason: receipt.auxiliaryStatus === 'passed'
      ? 'candidate-sut-diagnostics-passed' : 'candidate-sut-diagnostics-failed',
    evidenceSetDigest: receipt.evidenceSetDigest as Digest,
    candidateReceiptDigest: receiptDigest as Digest
  });
}
