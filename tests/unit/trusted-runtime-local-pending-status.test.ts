import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { resolveSecRuntimeStateForRepository } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, ciVerificationGateStep } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentFinalizeVerificationEvidenceV4 } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { buildCiQuickGatePlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { createVerificationSessionLocalPreparationRequest } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { parseTrustedRuntimeContainerReceipt, TRUSTED_RUNTIME_CONTAINER_IMAGE_ID } from '../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/assurance/verification/contract/revision.ts';
import { CodexDevelopmentBuildVerificationGateResult } from '../../src/assurance/verification/result/contract/result.ts';

const D = (n: string) => `sha256:${n.repeat(64)}` as const;
const bytes = (value: unknown) => `${encodeVerificationActionData(value)}\n`;
const digest = (value: unknown) => `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
const candidate = { baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40), headSha: '3'.repeat(40),
  headTreeSha: '4'.repeat(40), manifestPath: 'work-packages/local.json', manifestDigest: D('1'),
  scopeAuthorizationRevision: D('2'), profile: 'quick' as const,
  toolchainRevision: 'bun@1.3.14', providerRevision: 'github-actions@trusted-default',
  contractRevision: CI_VERIFICATION_CONTRACT_REVISION, requiredBlobs: [
    { path: '.bun-version', digest: D('3') }, { path: 'bun.lock', digest: D('4') },
    { path: 'bunfig.toml', digest: D('5') }, { path: 'package.json', digest: D('6') }
  ] };
const actionPlan = buildCiVerificationActionPlanClosure({ candidate,
  gates: buildCiQuickGatePlan({ includeImports: false, includeDocs: false }).map(ciVerificationGateStep) });

// Historical parser fixture only. All evidence, receipt and pending validators
// run unmocked; these synthetic observations grant no physical qualification.
const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
  contractRevision: CI_VERIFICATION_CONTRACT_REVISION, sessionRevision: D('7'),
  sessionProposalDigest: D('8'), scopeAuthorizationRevision: D('2'), scopeAuthorizationDigest: D('9'),
  reviewReceiptDigest: D('a'), mainHealthRevision: D('b'), mainHealthDigest: D('c'),
  trustRevision: candidate.baseSha, profile: candidate.profile, baseSha: candidate.baseSha,
  baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
  manifestPath: candidate.manifestPath, manifestDigest: candidate.manifestDigest,
  producer: CodexDevelopmentCreateVerificationEvidenceProducer({ sourceTransport: 'local-dev-runner',
    workflowPath: 'fixture', workflowRef: 'fixture', workflowSha: candidate.baseSha,
    runId: 'local-status-fixture', runAttempt: 1, actorNodeId: 'fixture' }),
  actionPlan, status: 'passed', startedAt: '2026-08-09T00:00:00.000Z', finishedAt: '2026-08-09T00:00:01.000Z',
  gates: actionPlan.actions.map(({ action }) => ({ action,
    result: CodexDevelopmentBuildVerificationGateResult({ gateId: action.operation.identity,
      gateRevision: action.operation.revision, owner: 'fixture', requirementKey: 'fixture',
      subjectRevision: candidate.headSha, inputDigest: action.actionKey, applicability: 'required',
      status: 'passed', disposition: 'executed', reasonCode: 'executed-success',
      requiredForClaims: [], supportedClaims: [], environment: { runtime: candidate.toolchainRevision,
        os: 'linux', arch: 'x64', filesystem: null, capabilities: [], toolchainRevision: candidate.toolchainRevision,
        providerRevisions: [candidate.providerRevision] },
      execution: { argv: ['fixture'], startedAt: '2026-08-09T00:00:00.000Z',
        finishedAt: '2026-08-09T00:00:01.000Z', durationMs: 1000, exitCode: 0,
        outputDigest: D('d'), failureFingerprint: null },
      evidenceRefs: [], invalidationRules: ['fixture changes'], diagnostic: null }),
    cleanup: { status: 'not-required', evidenceRefs: [], diagnostic: null }
  })), evidenceRefs: [], invalidationRules: ['fixture changes']
});
const request = createVerificationSessionLocalPreparationRequest({
  schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA, prNumber: 123,
  expectedBaseSha: candidate.baseSha, expectedBaseTreeSha: candidate.baseTreeSha,
  expectedHeadSha: candidate.headSha, expectedHeadTreeSha: candidate.headTreeSha,
  manifestPath: candidate.manifestPath, manifestDigest: candidate.manifestDigest, profile: candidate.profile,
  expectedScopeProposalDigest: D('8'), expectedActionPlanDigest: actionPlan.actionPlanDigest,
  expectedSessionRevision: D('7'), reviewPolicyDigest: D('9'), requestOperationId: D('a')
});
const receiptFields = { schema: SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.imageSchema,
  executionId: 'local-status-fixture', sessionRevision: D('7'), baseSha: candidate.baseSha,
  headSha: candidate.headSha, headTreeSha: candidate.headTreeSha, imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
  dockerEndpoint: { schema: 'sec-docker-endpoint-identity-v1', contextName: 'fixture',
    endpointHost: 'unix:///tmp/fixture.sock', daemonId: 'fixture', osType: 'linux', architecture: 'x86_64' },
  networkIsolatedBeforeSut: true, evidenceByteDigest: `sha256:${createHash('sha256').update(bytes(evidence)).digest('hex')}`,
  evidenceByteLength: Buffer.byteLength(bytes(evidence)), evidenceDigest: evidence.evidenceDigest,
  producerSourceDigest: evidence.producer.sourceDigest };

function runPendingStatus(saved: unknown, receiptOverrides: Record<string, unknown> = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-local-pending-'));
  const root = path.join(parent, 'workspace');
  const state = path.join(parent, 'state');
  const cache = path.join(parent, 'cache');
  mkdirSync(root);
  try {
    const receiptInput = { ...receiptFields, ...receiptOverrides };
    const receipt = parseTrustedRuntimeContainerReceipt({ ...receiptInput, receiptDigest: digest(receiptInput) });
    const record = { schema: 'sec-trusted-runtime-pending-qualification-v1', evidence, receipt };
    const layout = resolveSecRuntimeStateForRepository({ repositoryRoot: root, repository: 'sec-platform/sec',
      environment: { SEC_STATE_HOME: state, SEC_CACHE_HOME: cache } });
    const records = path.join(layout.repositoryStateRoot, 'trusted-runtime', 'v1', request.request.expectedSessionRevision.slice(7));
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'verification-pending-qualification.json'), bytes({ ...record, pendingDigest: digest(record) }));
    const requestPath = path.join(root, 'request.json');
    writeFileSync(requestPath, JSON.stringify(saved));
    return spawnSync(process.execPath, [path.resolve("src/bootstrap/development/closeout/verification-session-cli.ts"),
      'status', '--request', requestPath], { cwd: root, env: { ...process.env, SEC_STATE_HOME: state, SEC_CACHE_HOME: cache },
      encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
  } finally { rmSync(parent, { recursive: true, force: true }); }
}

test('unmocked pending status reports matching historical evidence and unestablished request bindings', () => {
  const result = runPendingStatus(request);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'LOCAL_EVIDENCE_RECORDED',
    verificationStatus: 'passed', evidenceRecord: 'pending-qualification', artifactDigest: null,
    unverifiedRequestFields: ['repository', 'prNumber', 'expectedScopeProposalDigest', 'reviewPolicyDigest', 'requestOperationId'],
    currentSubject: 'not-observed', sourceQualification: 'not-revalidated', executionStarted: false });
});

for (const [pin, value, evidenceField] of [
  ['expectedBaseSha', 'f'.repeat(40), 'baseSha'], ['expectedBaseTreeSha', 'f'.repeat(40), 'baseTreeSha'],
  ['expectedHeadSha', 'f'.repeat(40), 'headSha'], ['expectedHeadTreeSha', 'f'.repeat(40), 'headTreeSha'],
  ['manifestPath', 'other.json', 'manifestPath'], ['manifestDigest', D('f'), 'manifestDigest'], ['profile', 'full', 'profile']
] as const) {
  test(`unmocked pending status rejects contradictory saved ${pin} with unchanged Session and Action digests`, () => {
    const result = runPendingStatus({ ...request, request: { ...request.request, [pin]: value } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Verification V4 evidence ${evidenceField} mismatch.`);
  });
}

for (const pin of ['baseSha', 'headSha', 'headTreeSha']) {
  test(`unmocked pending status rejects receipt ${pin} contradiction despite valid independent digests`, () => {
    const result = runPendingStatus(request, { [pin]: 'f'.repeat(40) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pending qualification evidence differs from the exact container receipt');
  });
}
