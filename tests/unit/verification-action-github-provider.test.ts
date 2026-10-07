import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import { getCiVerificationPerJobHostedJobPolicy } from '../../src/adapters/providers/github-api/contract/hosted-job-policy.ts';
import * as githubApi from '../../src/adapters/providers/github-api/operation-session.ts';
import * as provider from '../../src/adapters/verification/platform/ci/runtime/verification-action-github-provider.ts';
import { settleResourcesAsync, type ResourceSettlementFailure } from '../../src/execution/resource-settlement.ts';
import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest } from '../../src/execution/verification/action.ts';
import { HOSTED_SESSION_WAKE_KEY_SCHEMA } from '../../src/execution/verification/hosted.ts';

import { HOSTED_RESUME_DISPATCH_EVENT, HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, AuthenticatedGitHubJobOriginUnavailableError, closeAuthenticatedGitHubJobOrigin, openAuthenticatedGitHubJobOrigin, type AuthenticatedGitHubJobOrigin } from '../../src/adapters/providers/github-api/hosted-job-origin.ts';
import { createMainHealthLedger } from '../../src/adapters/self-hosting/control/main-health/contract.ts';
import { createScopeAuthorization } from '../../src/adapters/self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_ACTION_DISPATCH_TYPE, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, type CiVerificationActionProviderEnvelope } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, createVerificationActionProviderStartMarker, createVerificationActionProviderTerminalAnchor, VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX, VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX, verificationActionProviderRunTargetUrl, verificationActionProviderStartArtifactName, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderTerminalDescription, type VerificationActionProviderOrigin } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentFinalizeVerificationEvidenceV4, finalizeVerificationSessionResumeArtifact, parseHostedSessionTerminalArtifact } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { CI_VERIFICATION_SESSION_DISPATCH_TYPE, HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE, hostedResumeDispatchOutcomesArtifactName, hostedSessionArtifactName } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import { createHostedResumeDispatchOutcome, createHostedResumeDispatchOutcomeCollection, parseHostedResumeDispatchOutcomeCollection } from '../../src/adapters/verification/platform/ci/runtime/verification-session-journal.ts';
import { ciActionDigest, CodexDevelopmentParseHostedActionRequest, CodexDevelopmentParseHostedActionResolution, CodexDevelopmentResolveHostedAction, parseHostedEnvelope } from '../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import { createReviewSnapshotDigest, createReviewStabilityReceipt, REVIEW_OBSERVER_PRODUCER_IDENTITY, REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT, SEC_REVIEW_STABILITY_POLICY } from '../../src/adapters/verification/platform/review/contract/stability.ts';
import { createVerificationSession } from '../../src/adapters/verification/platform/session/contract/session.ts';
import { buildUnsupportedVerificationActionTerminalArtifact } from '../helpers/verification-action-fixtures.ts';

const REPOSITORY = 'openai/sec';
const REPOSITORY_ID = 311;
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
let BASE: string;
let SOURCE_TREE: string;
const HEAD = '2'.repeat(40);
const SESSION = `sha256:${'6'.repeat(64)}` as const;
const PARENT_RUN_ID = '9001';
const CURRENT_RUN_ID = '9100';
const PARENT_ARTIFACT_ID = 7000;
const PARENT_JOB_ID = 6001;
let EVENT_ROOT: string | undefined;
let EVENT_PATH: string;
let CANONICAL_WORKFLOW_SOURCE: string;

const digest = (value: string): VerificationActionKeyDigest =>
  `sha256:${value.repeat(64).slice(0, 64)}`;

// Deterministic finite stored ZIP archives. The provider reads artifact
// archives through yauzl, so fixtures must be real ZIP bytes whose SHA-256 is
// the identity declared by the envelope and anchors.
const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC32_TABLE[index] = value >>> 0;
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function storedZip(fileName: string, source: string): Buffer {
  return storedZipMembers({ [fileName]: source });
}
function storedZipMembers(files: Readonly<Record<string, string>>): Buffer {
  const localRecords: Buffer[] = [], centralRecords: Buffer[] = [];
  let offset = 0;
  for (const [fileName, source] of Object.entries(files)) {
    const name = Buffer.from(fileName, 'utf8'), data = Buffer.from(source, 'utf8');
    const checksum = crc32(data), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    localRecords.push(local, name, data);
    centralRecords.push(central, name);
    offset += local.byteLength + name.byteLength + data.byteLength;
  }
  const directory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, directory, end]);
}
const rawSha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const archiveDigestFor = (fileName: string, source: string): VerificationActionKeyDigest =>
  `sha256:${rawSha256Hex(storedZip(fileName, source))}`;

function createProviderFixtureData(BASE: string) {
  const closure = buildCiVerificationActionPlanClosure({
    candidate: {
      baseSha: BASE,
      baseTreeSha: '3'.repeat(40),
      headSha: HEAD,
      headTreeSha: '4'.repeat(40),
      manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v5.md',
      manifestDigest: digest('a'),
      scopeAuthorizationRevision: digest('b'),
      profile: 'quick',
      toolchainRevision: 'bun@1.3.14',
      providerRevision: 'github-actions@trusted-default',
      contractRevision: 'ci-verification-v19',
      requiredBlobs: [
        { path: '.bun-version', digest: digest('c') },
        { path: 'bun.lock', digest: digest('d') },
        { path: 'bunfig.toml', digest: digest('e') },
        { path: 'package.json', digest: digest('f') }
      ]
    },
    gates: [{
      id: 'typecheck',
      phase: 'quick',
      argv: ['bun', 'run', 'typecheck'],
      runtime: 'bun',
      environment: {},
      coveredScopeIds: ['runtime']
    }]
  });
  const ACTION = closure.actions[0]!.action.actionKey;
  const CONTEXT = verificationActionProviderStatusContext(ACTION);
  const sessionRequest = Object.freeze({
    schema: 'sec-verification-session-hosted-request-v1',
    prNumber: 42,
    expectedBaseSha: BASE,
    expectedBaseTreeSha: '3'.repeat(40),
    expectedHeadSha: HEAD,
    expectedHeadTreeSha: '4'.repeat(40),
    manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v5.md',
    manifestDigest: digest('a'),
    profile: 'quick',
    expectedScopeProposalDigest: digest('d'),
    expectedActionPlanDigest: closure.actionPlanDigest,
    expectedSessionRevision: SESSION,
    reviewPolicyDigest: digest('e'),
    requestOperationId: digest('f')
  });
  const proposal = createCiVerificationActionProposal({
    sessionRequest,
    proposedActionKey: ACTION
  });
  const parentActor = Object.freeze({
    login: 'maintainer',
    id: 42,
    nodeId: 'MDQ6VXNlcjQy',
    type: 'User' as const,
    permission: 'maintain' as const
  });
  const parentPlan = createCiVerificationActionParentDispatchPlan({
    repositoryId: String(REPOSITORY_ID),
    repository: REPOSITORY,
    parentRunId: PARENT_RUN_ID,
    parentRunAttempt: 1,
    parentJobId: String(PARENT_JOB_ID),
    parentWorkflowRef: `${REPOSITORY}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`,
    parentWorkflowSha: BASE,
    parentActor,
    proposals: [proposal]
  });
  const parentPlanSource = `${encodeVerificationActionData(parentPlan)}\n`;
  const envelope = createCiVerificationActionProviderEnvelope({
    proposal,
    parentPlan,
    parentDispatchPlanArtifactId: String(PARENT_ARTIFACT_ID),
    parentDispatchPlanArchiveDigest: archiveDigestFor('verification-action-parent-dispatch-plan.json', parentPlanSource)
  });
  const bot = CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot;
  const botRecord = Object.freeze({ login: bot.login, id: bot.id, node_id: bot.nodeId, type: bot.type });
  const currentOrigin: VerificationActionProviderOrigin = Object.freeze({
    repositoryId: REPOSITORY_ID,
    repository: REPOSITORY,
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
    workflowSha: BASE,
    runId: CURRENT_RUN_ID,
    runAttempt: 1,
    appId: 15368,
    appNodeId: 'MDM6QXBwMTUzNjg=',
    sourceEvent: 'repository_dispatch'
  });
  const marker = createVerificationActionProviderStartMarker({
    actionKey: ACTION,
    candidateSha: HEAD,
    executionEnvironmentRevision: 'hosted',
    producer: currentOrigin
  });
  return { closure, ACTION, CONTEXT, sessionRequest, proposal, parentActor, parentPlan, parentPlanSource, envelope, bot, botRecord, currentOrigin, marker };
}

let closure: ReturnType<typeof createProviderFixtureData>['closure'];
let ACTION: ReturnType<typeof createProviderFixtureData>['ACTION'];
let CONTEXT: ReturnType<typeof createProviderFixtureData>['CONTEXT'];
let sessionRequest: ReturnType<typeof createProviderFixtureData>['sessionRequest'];
let proposal: ReturnType<typeof createProviderFixtureData>['proposal'];
let parentActor: ReturnType<typeof createProviderFixtureData>['parentActor'];
let parentPlanSource: ReturnType<typeof createProviderFixtureData>['parentPlanSource'];
let envelope: ReturnType<typeof createProviderFixtureData>['envelope'];
let bot: ReturnType<typeof createProviderFixtureData>['bot'];
let botRecord: ReturnType<typeof createProviderFixtureData>['botRecord'];
let currentOrigin: ReturnType<typeof createProviderFixtureData>['currentOrigin'];
let marker: ReturnType<typeof createProviderFixtureData>['marker'];
const TERMINAL_PAYLOAD_DIGEST = digest('9');

// Only upstream response data is substituted. Every opaque origin below is
// issued, rechecked and closed by the real owner, including physical source,
// retained executable, mount namespace and lifetime checks. This fixture does
// not establish live GitHub provenance or make an unsupported host admissible.
type OriginFixture = Readonly<{
  policyJobId: string; phase: string; stepName: string; stepNumber: number;
  workflowPath: string; runId: string; jobId: number; checkRunId: number;
}>;
const COMPILER_WORKFLOW = '.github/workflows/compiler-pr-validation.yml';
const MERGE_WORKFLOW = '.github/workflows/merge-gate.yml';
let ORIGIN_JOB_STARTED_AT: string;
const ORIGIN_REQUEST_URL = 'https://fixture.actions.githubusercontent.com/_apis/distributedtask/hubs/Actions/plans/fixture/jobs/fixture/idtoken';
const ORIGIN_REQUEST_TOKEN = 'fixture-origin-request-token';
let originSigningKey: Readonly<{ publicKey: KeyObject; privateKey: KeyObject }>;
let originJwks: Readonly<{ keys: readonly Record<string, unknown>[] }>;
const originEnvironmentKeys = [
  'GITHUB_ACTIONS', 'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GH_TOKEN',
  'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
  'GITHUB_EVENT_NAME', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA',
  'GITHUB_ACTOR', 'GITHUB_TRIGGERING_ACTOR', 'GITHUB_EVENT_PATH', 'GITHUB_JOB',
  'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'
] as const;
let originalEnvironment: ReadonlyMap<string, string | undefined> | undefined;
const issuedFixtureOrigins: AuthenticatedGitHubJobOrigin[] = [];
let openingOriginFixture: OriginFixture | undefined;
let claimOrigin: AuthenticatedGitHubJobOrigin;
let coordinateOrigin: AuthenticatedGitHubJobOrigin;
let parentCoordinateOrigin: AuthenticatedGitHubJobOrigin;
let terminalOrigin: AuthenticatedGitHubJobOrigin;
let resumeOrigin: AuthenticatedGitHubJobOrigin;
let historicalReceiverOrigin: AuthenticatedGitHubJobOrigin;
let closedReceiverOrigin: AuthenticatedGitHubJobOrigin;
let disallowedMergeOrigin: AuthenticatedGitHubJobOrigin;

function restoreOriginEnvironment(snapshot: ReadonlyMap<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

function originFixtureResponse(fixture: OriginFixture, url: URL, init?: RequestInit): Response {
  const json = (value: unknown) => new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });
  if ((init?.method ?? 'GET') !== 'GET' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error('Unexpected origin fixture request');
  }
  const request = new URL(ORIGIN_REQUEST_URL);
  if (url.origin === request.origin && url.pathname === request.pathname) {
    const audience = url.searchParams.get('audience');
    if (audience === null || !/^sec:hosted-job-origin:v1:[0-9a-f-]{36}$/u.test(audience)
        || [...url.searchParams.keys()].join(',') !== 'audience'
        || new Headers(init?.headers).get('Authorization') !== `Bearer ${ORIGIN_REQUEST_TOKEN}`) {
      throw new Error('Unexpected origin fixture audience or request credential');
    }
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fixture-origin-key' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: 'https://token.actions.githubusercontent.com', aud: audience,
      runner_environment: 'github-hosted', ref: 'refs/heads/main', iat: now, nbf: now, exp: now + 600,
      repository: REPOSITORY, repository_id: String(REPOSITORY_ID),
      workflow_ref: `${REPOSITORY}/${fixture.workflowPath}@refs/heads/main`, workflow_sha: BASE,
      run_id: fixture.runId, run_attempt: '1', check_run_id: String(fixture.checkRunId),
      event_name: fixture.workflowPath === MERGE_WORKFLOW ? 'workflow_run' : 'repository_dispatch',
      jti: randomUUID() })).toString('base64url');
    const content = `${header}.${claims}`;
    return json({ value: `${content}.${sign('RSA-SHA256', Buffer.from(content), originSigningKey.privateKey).toString('base64url')}` });
  }
  if (url.href === 'https://token.actions.githubusercontent.com/.well-known/jwks') return json(originJwks);
  if (url.origin !== 'https://api.github.com'
      || new Headers(init?.headers).get('Authorization') !== 'Bearer ghs-provider-fixture-token') {
    throw new Error('Unexpected origin fixture provider');
  }
  const repository = { id: REPOSITORY_ID, full_name: REPOSITORY, default_branch: 'main' };
  const prefix = `/repos/${REPOSITORY}`;
  if (url.pathname === prefix && url.search === '') return json(repository);
  if (url.pathname === `${prefix}/branches/main` && url.search === '') {
    return json({ name: 'main', commit: { sha: BASE, commit: { tree: { sha: SOURCE_TREE } } } });
  }
  if (url.pathname === `${prefix}/actions/runs/${fixture.runId}` && url.search === '') {
    return json({ id: Number(fixture.runId), run_attempt: 1, path: fixture.workflowPath, head_sha: BASE,
      head_branch: 'main', event: fixture.workflowPath === MERGE_WORKFLOW ? 'workflow_run' : 'repository_dispatch',
      status: 'in_progress', conclusion: null, repository });
  }
  const policy = getCiVerificationPerJobHostedJobPolicy(fixture.workflowPath, fixture.policyJobId);
  if (url.pathname === `${prefix}/actions/runs/${fixture.runId}/attempts/1/jobs`
      && url.search === '?per_page=100&page=1') {
    return json({ total_count: 1, jobs: [{ id: fixture.jobId, run_id: Number(fixture.runId), run_attempt: 1,
      name: policy?.jobName ?? fixture.policyJobId, head_sha: BASE,
      check_run_url: `https://api.github.com/repos/${REPOSITORY}/check-runs/${fixture.checkRunId}`,
      status: 'in_progress', conclusion: null, completed_at: null,
      labels: [policy?.runnerLabel ?? 'ubuntu-24.04'], started_at: ORIGIN_JOB_STARTED_AT,
      steps: [{ number: fixture.stepNumber, name: fixture.stepName, status: 'in_progress', conclusion: null,
        started_at: ORIGIN_JOB_STARTED_AT, completed_at: null }] }] });
  }
  if (policy?.runtime.kind === 'per-job-runtime') {
    for (const file of [fixture.workflowPath, policy.runtime.launcherPath]) {
      if (url.pathname === `${prefix}/contents/${file}` && url.search === `?ref=${BASE}`) {
        const bytes = readFileSync(path.join(REPOSITORY_ROOT, file));
        return json({ type: 'file', path: file, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length });
      }
    }
  }
  throw new Error('Unexpected origin fixture URL');
}

async function openFixtureOrigin(fixture: OriginFixture): Promise<AuthenticatedGitHubJobOrigin> {
  if (openingOriginFixture !== undefined) throw new Error('Concurrent origin fixture issuance');
  const saved = new Map(originEnvironmentKeys.map(key => [key, process.env[key]]));
  trustedEnvironment();
  Object.assign(process.env, { GITHUB_JOB: fixture.policyJobId, GITHUB_RUN_ID: fixture.runId,
    GITHUB_EVENT_NAME: fixture.workflowPath === MERGE_WORKFLOW ? 'workflow_run' : 'repository_dispatch',
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/${fixture.workflowPath}@refs/heads/main`,
    ACTIONS_ID_TOKEN_REQUEST_URL: ORIGIN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN: ORIGIN_REQUEST_TOKEN });
  openingOriginFixture = fixture;
  try {
    const origin = await openAuthenticatedGitHubJobOrigin({ repositoryRoot: REPOSITORY_ROOT });
    issuedFixtureOrigins.push(origin);
    expect(assertAuthenticatedGitHubJobOriginCurrent(origin)).toMatchObject({
      repository: REPOSITORY, repositoryId: String(REPOSITORY_ID), workflowSha: BASE,
      trustedSourceSha: BASE, trustedSourceTreeSha: SOURCE_TREE, workflowPath: fixture.workflowPath,
      policyJobId: fixture.policyJobId, phase: fixture.phase, stepName: fixture.stepName,
      stepNumber: fixture.stepNumber, runId: fixture.runId, runAttempt: 1,
      jobId: String(fixture.jobId), checkRunId: String(fixture.checkRunId), trustedDriverRoot: REPOSITORY_ROOT
    });
    return origin;
  } finally {
    openingOriginFixture = undefined;
    restoreOriginEnvironment(saved);
  }
}

const receiverFixture: OriginFixture = Object.freeze({ workflowPath: COMPILER_WORKFLOW,
  policyJobId: 'receive-verification-session-resume', phase: 'receive-verification-session-resume',
  stepName: 'Resume original authenticated Verification Session', stepNumber: 5,
  runId: CURRENT_RUN_ID, jobId: 6104, checkRunId: 5104 });

function rawStatus(input: Readonly<{
  id: number;
  context?: string;
  state?: 'error' | 'failure' | 'pending' | 'success';
  description?: string;
  targetUrl?: string;
}>): Record<string, unknown> {
  return {
    id: input.id,
    node_id: `STATUS_${input.id}`,
    state: input.state ?? 'pending',
    context: input.context ?? CONTEXT,
    description: input.description ?? verificationActionProviderStartDescription(marker.markerDigest),
    target_url: input.targetUrl ?? verificationActionProviderRunTargetUrl(currentOrigin),
    sha: HEAD,
    created_at: '2026-08-09T01:00:00.000Z',
    updated_at: '2026-08-09T01:00:00.000Z',
    creator: botRecord
  };
}

type ArtifactFixture = Readonly<{
  id: number;
  name: string;
  expired: boolean;
  runId: number;
  fileName: string;
  source: string;
  members?: Readonly<Record<string, string>>;
}>;

function fixtureArchive(artifact: ArtifactFixture): Buffer {
  return artifact.members === undefined ? storedZip(artifact.fileName, artifact.source) : storedZipMembers(artifact.members);
}

// Provider response data only. The attempt-specific endpoint supplies the
// omitted run_attempt membership; these fixtures do not issue a live origin.
function parentJobFixture(): Record<string, unknown> {
  return { id: PARENT_JOB_ID, name: 'coordinate-verification-session', run_id: Number(PARENT_RUN_ID),
    head_sha: BASE, status: 'in_progress', conclusion: null,
    started_at: '2026-08-09T01:00:00Z', completed_at: null,
    steps: [
      { number: 5, name: 'Prepare canonical parent Action dispatch plan', status: 'completed', conclusion: 'success',
        started_at: '2026-08-09T01:00:01Z', completed_at: '2026-08-09T01:00:02Z' },
      { number: 6, name: 'Upload canonical parent Action dispatch plan artifact', status: 'completed', conclusion: 'success',
        started_at: '2026-08-09T01:00:03Z', completed_at: '2026-08-09T01:00:05Z' },
      { number: 7, name: 'Complete original Action coordination and canonical Session', status: 'in_progress', conclusion: null,
        started_at: '2026-08-09T01:00:06Z', completed_at: null }
    ] };
}

function actionJobFixtures(runId: number): Record<string, unknown>[] {
  const step = (number: number, name: string, start: number, end: number, clock = '01:00') => ({ number, name,
    status: 'completed', conclusion: 'success',
    started_at: `2026-08-09T${clock}:${String(start).padStart(2, '0')}Z`,
    completed_at: `2026-08-09T${clock}:${String(end).padStart(2, '0')}Z` });
  const common = { run_id: runId, head_sha: BASE, status: 'completed', conclusion: 'success',
    started_at: '2026-08-09T01:00:00Z', completed_at: '2026-08-09T01:00:12Z' };
  return [
    { ...common, id: runId * 100 + 1, name: 'claim-verification-action', steps: [
      step(8, 'Create immutable Action start marker from fresh provider census', 1, 2),
      step(9, 'Upload immutable Action start marker', 3, 5),
      step(10, 'Publish durable start tombstone and issue execution ticket', 6, 7)
    ] },
    { ...common, id: runId * 100 + 2, name: 'assemble-verification-action-terminal', steps: [
      step(8, 'Assemble canonical five-state terminal artifact', 1, 2),
      step(9, 'Upload canonical terminal Action artifact', 3, 5),
      step(10, 'Create exact post-upload terminal anchor', 6, 7),
      step(11, 'Upload exact post-upload terminal anchor', 8, 10),
      step(12, 'Publish neutral terminal provider tombstone', 11, 12)
    ] },
    { ...common, id: runId * 100 + 3, name: 'resolve-verification-action',
      started_at: '2026-08-09T00:59:00Z', completed_at: '2026-08-09T00:59:12Z', steps: [
      step(5, 'Rebuild trusted Session envelope and exact ActionKey member', 1, 2, '00:59'),
      step(6, 'Upload trusted Action resolution transport', 3, 5, '00:59')
    ] }
  ];
}

class FakeGh {
  statuses: Record<string, unknown>[] = [];
  artifacts: ArtifactFixture[] = [{
    id: PARENT_ARTIFACT_ID,
    name: envelope.parentDispatchPlanArtifactName,
    expired: false,
    runId: Number(PARENT_RUN_ID),
    fileName: 'verification-action-parent-dispatch-plan.json',
    source: parentPlanSource
  }];
  statusListCalls: Array<{ page: number; perPage: number }> = [];
  artifactListCalls: Array<{ page: number; perPage: number }> = [];
  jobListCalls: Array<{ runId: string; runAttempt: number; page: number }> = [];
  parentJobs: Record<string, unknown>[] = [parentJobFixture()];
  actionJobsByAttempt: Record<string, Record<string, unknown>[]> = {};
  jobPageHook: ((page: number, call: number, runId: string, runAttempt: number) => Readonly<{
    jobs?: readonly Record<string, unknown>[]; totalCount?: unknown;
  }> | null) | null = null;
  artifactMetadataOverrides: Record<string, Record<string, unknown>> = {};
  workflowSource = CANONICAL_WORKFLOW_SOURCE;
  workflowSourceHook: ((call: number) => string | null | Promise<string | null>) | null = null;
  workflowSourceCalls: Array<{ path: string; ref: string | null }> = [];
  createCalls = 0;
  dispatchCalls = 0;
  dispatchBodies: unknown[] = [];
  failStatusPost = false;
  lastDownloadedArtifactId: number | null = null;
  downloadedArtifactIds: number[] = [];
  currentRunOverrides: Record<string, unknown> = {};
  parentRunOverrides: Record<string, unknown> = {};
  currentSuiteOverrides: Record<string, unknown> = {};
  exactRunOverrides: Record<string, Record<string, unknown>> = {};
  exactSuiteOverrides: Record<string, Record<string, unknown>> = {};
  parentPermission: Record<string, unknown> = { permission: 'write', role_name: 'maintain' };
  parentPermissionUser: { login: string; id: number; node_id: string; type: string } = { login: parentActor.login, id: parentActor.id, node_id: parentActor.nodeId, type: 'User' };
  permissionCalls = 0;
  permissionHook: ((call: number) => Record<string, unknown> | null) | null = null;
  exactRunFailures = new Set<string>();
  latestRunAttempts: Record<string, number> = {};
  latestRunCalls: string[] = [];
  exactAttemptCalls: Array<{ runId: string; runAttempt: number }> = [];
  statusPageHook: ((page: number, call: number) => readonly Record<string, unknown>[] | null) | null = null;
  artifactPageHook: ((page: number, call: number) => Readonly<{
    artifacts?: readonly ArtifactFixture[];
    totalCount?: number;
  }> | null) | null = null;

  withMarker(markerValue = marker, runId = Number(CURRENT_RUN_ID)): this {
    this.artifacts.push({
      id: 7001,
      name: verificationActionProviderStartArtifactName(ACTION),
      expired: false,
      runId,
      fileName: 'verification-action-start-marker.json',
      source: JSON.stringify(markerValue)
    });
    return this;
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof URL ? input : new URL(input);
    if (!url.pathname.startsWith('/repos/')) return this.download(url);
    const endpoint = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') return this.post(endpoint, init);
    if (endpoint === `/repos/${REPOSITORY}`) {
      return this.json({ id: REPOSITORY_ID, full_name: REPOSITORY, default_branch: 'main' });
    }
    if (endpoint === `/repos/${REPOSITORY}/actions/workflows/300`
        || endpoint === `/repos/${REPOSITORY}/actions/workflows/compiler-pr-validation.yml`) {
      return this.json({ id: 300, path: '.github/workflows/compiler-pr-validation.yml', state: 'active' });
    }
    if (endpoint === `/repos/${REPOSITORY}/collaborators/${parentActor.login}/permission`) {
      this.permissionCalls += 1;
      return this.json({ ...this.parentPermission, user: this.parentPermissionUser,
        ...this.permissionHook?.(this.permissionCalls) });
    }
    if (endpoint === `/repos/${REPOSITORY}/contents/.github/workflows/compiler-pr-validation.yml`) {
      const ref = url.searchParams.get('ref');
      this.workflowSourceCalls.push({ path: '.github/workflows/compiler-pr-validation.yml', ref });
      if (ref !== BASE) return this.fail('unexpected workflow source revision');
      const bytes = Buffer.from(await this.workflowSourceHook?.(this.workflowSourceCalls.length) ?? this.workflowSource, 'utf8');
      return this.json({ type: 'file', path: '.github/workflows/compiler-pr-validation.yml', encoding: 'base64',
        content: bytes.toString('base64'), size: bytes.byteLength,
        sha: createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex') });
    }
    const jobsMatch = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)\/jobs$/u.exec(endpoint);
    if (jobsMatch !== null) {
      const page = Number(url.searchParams.get('page'));
      this.jobListCalls.push({ runId: jobsMatch[1]!, runAttempt: Number(jobsMatch[2]), page });
      const runId = jobsMatch[1]!, runAttempt = Number(jobsMatch[2]);
      const jobs = runId === PARENT_RUN_ID ? this.parentJobs
        : this.actionJobsByAttempt[`${runId}:${runAttempt}`] ??= actionJobFixtures(Number(runId));
      const override = this.jobPageHook?.(page, this.jobListCalls.length, runId, runAttempt) ?? null;
      return this.json({ total_count: override !== null && Object.hasOwn(override, 'totalCount')
        ? override.totalCount : jobs.length,
        jobs: override?.jobs ?? jobs.slice((page - 1) * 100, page * 100) });
    }
    if (/^\/repos\/[^/]+\/[^/]+\/commits\/[0-9a-f]{40}\/statuses$/u.test(endpoint)) {
      const page = Number(url.searchParams.get('page'));
      this.statusListCalls.push({ page, perPage: 100 });
      const override = this.statusPageHook?.(page, this.statusListCalls.length) ?? null;
      return this.json(override ?? this.statuses.slice((page - 1) * 100, page * 100));
    }
    const artifactZipMatch = /^\/repos\/[^/]+\/[^/]+\/actions\/artifacts\/([1-9][0-9]*)\/zip$/u.exec(endpoint);
    if (artifactZipMatch !== null) {
      const artifact = this.artifacts.find((entry) => entry.id === Number(artifactZipMatch[1]));
      if (artifact === undefined) return this.fail('artifact not found');
      this.lastDownloadedArtifactId = artifact.id;
      this.downloadedArtifactIds.push(artifact.id);
      return new Response(null, { status: 302, headers: {
        location: `https://results-receiver.actions.githubusercontent.com/fixture/${artifact.id}`
      } });
    }
    const artifactMetadataMatch = /^\/repos\/[^/]+\/[^/]+\/actions\/artifacts\/([1-9][0-9]*)$/u.exec(endpoint);
    if (artifactMetadataMatch !== null) {
      const artifact = this.artifacts.find((entry) => entry.id === Number(artifactMetadataMatch[1]));
      if (artifact === undefined) return this.fail('artifact not found');
      const archive = fixtureArchive(artifact);
      return this.json({
        id: artifact.id,
        name: artifact.name,
        expired: artifact.expired,
        workflow_run: { id: artifact.runId, head_sha: BASE },
        created_at: artifact.fileName === 'verification-action-terminal-status-anchor.json'
          ? '2026-08-09T01:00:08Z' : artifact.fileName === 'hosted-action-resolution.json'
            ? '2026-08-09T00:59:03Z' : '2026-08-09T01:00:03Z',
        updated_at: artifact.fileName === 'verification-action-terminal-status-anchor.json'
          ? '2026-08-09T01:00:10Z' : artifact.fileName === 'hosted-action-resolution.json'
            ? '2026-08-09T00:59:05Z' : '2026-08-09T01:00:05Z',
        size_in_bytes: archive.byteLength,
        digest: `sha256:${rawSha256Hex(archive)}`,
        ...this.artifactMetadataOverrides[String(artifact.id)]
      });
    }
    if (/^\/repos\/[^/]+\/[^/]+\/actions\/artifacts$/u.test(endpoint)) {
      const page = Number(url.searchParams.get('page'));
      this.artifactListCalls.push({ page, perPage: 100 });
      const override = this.artifactPageHook?.(page, this.artifactListCalls.length) ?? null;
      const inventory = override?.artifacts ?? this.artifacts;
      const artifacts = inventory.slice((page - 1) * 100, page * 100).map((entry) => ({
        id: entry.id,
        name: entry.name,
        expired: entry.expired,
        workflow_run: { id: entry.runId }
      }));
      return this.json({ total_count: override?.totalCount ?? inventory.length, artifacts });
    }
    const exactRunMatch = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/u.exec(endpoint);
    if (exactRunMatch !== null) {
      const id = exactRunMatch[1]!;
      const runAttempt = Number(exactRunMatch[2]);
      this.exactAttemptCalls.push({ runId: id, runAttempt });
      if (this.exactRunFailures.has(`${id}:${runAttempt}`)) {
        return this.fail('exact attempt not found');
      }
      return this.json({
        id: Number(id), run_attempt: runAttempt,
        check_suite_id: id === PARENT_RUN_ID ? 5001 : id === CURRENT_RUN_ID ? 5002 : 5003,
        event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
        head_sha: BASE, repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
        ...(this.exactRunOverrides[`${id}:${runAttempt}`] ?? {})
      });
    }
    const runMatch = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/([1-9][0-9]*)$/u.exec(endpoint);
    if (runMatch !== null) {
      const id = runMatch[1]!;
      this.latestRunCalls.push(id);
      if (id === PARENT_RUN_ID) {
        return this.json({
          id: Number(PARENT_RUN_ID), run_attempt: 1, workflow_id: 300, check_suite_id: 5001,
          event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
          head_sha: BASE, head_branch: 'main',
          name: `verify session PR #42 session ${SESSION}`,
          display_title: `verify session PR #42 session ${SESSION}`, actor: {
            login: parentActor.login, id: parentActor.id, node_id: parentActor.nodeId, type: 'User'
          }, repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
          ...this.parentRunOverrides
        });
      }
      return this.json({
        id: Number(id), run_attempt: this.latestRunAttempts[id] ?? 1,
        workflow_id: 300, check_suite_id: id === CURRENT_RUN_ID ? 5002 : 5003,
        event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
        head_sha: BASE, head_branch: 'main', name: `produce Action ${ACTION}`,
        display_title: `produce Action ${ACTION}`, actor: botRecord,
        repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
        ...this.currentRunOverrides
      });
    }
    const suiteMatch = /^\/repos\/[^/]+\/[^/]+\/check-suites\/([1-9][0-9]*)$/u.exec(endpoint);
    if (suiteMatch !== null) {
      const id = Number(suiteMatch[1]);
      return this.json({
        id,
        head_sha: BASE,
        repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
        app: { id: 15368, node_id: 'MDM6QXBwMTUzNjg=', slug: 'github-actions' },
        ...(id === 5002 ? this.currentSuiteOverrides : {}),
        ...(this.exactSuiteOverrides[String(id)] ?? {})
      });
    }
    return this.fail(`unexpected endpoint ${endpoint}`);
  }

  private download(url: URL): Response {
    const artifact = this.artifacts.find((entry) => entry.id === Number(url.pathname.split('/').pop()));
    if (artifact === undefined) return this.fail('artifact download is not available', 404);
    return new Response(fixtureArchive(artifact), { status: 200 });
  }

  private post(endpoint: string, init?: RequestInit): Response {
    if (endpoint === `/repos/${REPOSITORY}/dispatches`) {
      this.dispatchCalls += 1;
      this.dispatchBodies.push(JSON.parse(String(init?.body ?? 'null')));
      return new Response(null, { status: 204 });
    }
    if (!/^\/repos\/[^/]+\/[^/]+\/statuses\/[0-9a-f]{40}$/u.test(endpoint)) {
      return this.fail('unexpected mutation endpoint');
    }
    this.createCalls += 1;
    if (this.failStatusPost) return this.fail('connection reset after request write');
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      state?: 'pending' | 'success'; context?: string; description?: string; target_url?: string;
    };
    const created = rawStatus({
      id: 9000 + this.createCalls,
      state: body.state,
      context: body.context,
      description: body.description,
      targetUrl: body.target_url
    });
    this.statuses.push(created);
    return this.json(created);
  }

  private json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  }

  private fail(message: string, status = 500): Response {
    return new Response(message, { status });
  }
}

function withTerminalChain(target: FakeGh) {
  const terminalArtifact = buildUnsupportedVerificationActionTerminalArtifact({
    actionPlan: closure.actions[0]!,
    normalizedOperation: closure.normalizedOperations[0]!,
    baseSha: BASE,
    baseTreeSha: '3'.repeat(40),
    headSha: HEAD,
    headTreeSha: '4'.repeat(40),
    manifestPath: 'config/repository/work-packages/verification-action-trusted-cutover-v5.md',
    manifestDigest: digest('a'),
    producer: currentOrigin
  });
  const terminalAnchor = createVerificationActionProviderTerminalAnchor({
    actionKey: ACTION,
    candidateSha: HEAD,
    startStatusId: 101,
    startStatusNodeId: 'STATUS_101',
    startArtifactOriginId: '7001',
    startArtifactName: verificationActionProviderStartArtifactName(ACTION),
    startArtifactArchiveDigest: archiveDigestFor('verification-action-start-marker.json', JSON.stringify(marker)),
    startMarkerDigest: marker.markerDigest,
    terminalArtifactOriginId: '7002',
    terminalArtifactName: verificationActionProviderTerminalArtifactName(ACTION),
    terminalArtifactArchiveDigest: archiveDigestFor('verification-action-terminal-artifact.json', JSON.stringify(terminalArtifact)),
    terminalArtifactPayloadDigest: terminalArtifact.artifactDigest as VerificationActionKeyDigest,
    terminalAssemblerOrigin: currentOrigin,
    anchorPublisherOrigin: currentOrigin
  });
  target.withMarker();
  target.statuses = [rawStatus({ id: 101 })];
  target.artifacts.push(
    { id: 7002, name: verificationActionProviderTerminalArtifactName(ACTION), expired: false,
      runId: Number(CURRENT_RUN_ID), fileName: 'verification-action-terminal-artifact.json',
      source: JSON.stringify(terminalArtifact) },
    { id: 7003, name: verificationActionProviderTerminalAnchorName(ACTION), expired: false,
      runId: Number(CURRENT_RUN_ID), fileName: 'verification-action-terminal-status-anchor.json',
      source: JSON.stringify(terminalAnchor) }
  );
  return terminalAnchor;
}

function resolutionMembersFixture() {
  // These are capture/outer-decoder data. Nested Scope, Review and MainHealth
  // declarations remain unqualified for their original downstream consumers.
  const body = {
    schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA,
    requestOperationId: sessionRequest.requestOperationId,
    scopeAuthorization: { repository: REPOSITORY, authorizationRevision: digest('b'), authorizationDigest: digest('5') },
    preGateReview: { receiptDigest: digest('a') }, mainHealth: { healthRevision: digest('8'), ledgerDigest: digest('9') },
    session: { schema: 'codex-development-verification-session-v2', sessionId: 'provider-resolution-data',
      createdAt: '2026-08-09T01:00:00Z', repository: REPOSITORY, prNumber: sessionRequest.prNumber,
      baseSha: BASE, baseTreeSha: sessionRequest.expectedBaseTreeSha, headSha: HEAD, headTreeSha: sessionRequest.expectedHeadTreeSha,
      manifestPath: sessionRequest.manifestPath, manifestDigest: sessionRequest.manifestDigest,
      sessionProposalDigest: digest('6'), scopeAuthorizationRevision: digest('b'), scopeAuthorizationReceiptDigest: digest('5'),
      actionPlanClosureDigest: closure.actionPlanDigest, profile: sessionRequest.profile, environmentDigest: digest('b'),
      trustRevision: BASE, reviewPolicyDigest: sessionRequest.reviewPolicyDigest, evidenceRequirementDigest: digest('d'),
      integrationPolicyDigest: digest('e'), mainHealthRef: { healthRevision: digest('8'), ledgerReceiptDigest: digest('9') },
      sessionRevision: SESSION },
    actionPlanClosure: closure
  };
  const hosted = parseHostedEnvelope({ ...body, envelopeDigest: ciActionDigest(body) });
  const resolution = CodexDevelopmentResolveHostedAction({
    request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(proposal)), envelope: hosted
  });
  return Object.freeze({
    'verification-action-provider-envelope.json': `${encodeVerificationActionData(envelope)}\n`,
    'hosted-action-resolution.json': `${encodeVerificationActionData(resolution)}\n`,
    'hosted-envelope.json': `${encodeVerificationActionData(hosted)}\n`
  });
}


const DELEGATED_RUN_ID = '9400';
const DELEGATED_ARTIFACT_ID = 7005;

function delegatedSessionFixture() {
  // Complete historical data through the original constructors and decoders.
  // These finite provider facts never constitute a live accepted native profile.
  const scopeInput = {
    repository: REPOSITORY, prNumber: 42, baseSha: BASE, baseTreeSha: '3'.repeat(40),
    headSha: HEAD, headTreeSha: '4'.repeat(40), manifestPath: sessionRequest.manifestPath,
    manifestDigest: digest('a'), proposalDigest: digest('d'), authorizedPaths: ['src/example.ts'],
    sessionProposalDigest: digest('d'), actionPlanClosureDigest: digest('a'), profile: 'quick',
    environmentDigest: digest('b'), issuer: { principalId: parentActor.nodeId,
      role: 'trusted-base-a0' as const, trustRevision: BASE, producerIdentity: 'provider-delegated-data',
      sourceTransport: 'github-actions' as const, sourceRunId: DELEGATED_RUN_ID,
      sourceRef: 'refs/heads/main', sourceDigest: digest('c') },
    issuedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T04:00:00.000Z'
  };
  const provisionalScope = createScopeAuthorization(scopeInput);
  const actionPlanClosure = buildCiVerificationActionPlanClosure({
    candidate: { baseSha: BASE, baseTreeSha: scopeInput.baseTreeSha, headSha: HEAD,
      headTreeSha: scopeInput.headTreeSha, manifestPath: scopeInput.manifestPath,
      manifestDigest: scopeInput.manifestDigest, scopeAuthorizationRevision: provisionalScope.authorizationRevision,
      profile: 'quick', toolchainRevision: 'bun@1.3.14', providerRevision: 'github-actions@trusted-default',
      contractRevision: 'ci-verification-v19', requiredBlobs: [
        { path: '.bun-version', digest: digest('c') }, { path: 'bun.lock', digest: digest('d') },
        { path: 'bunfig.toml', digest: digest('e') }, { path: 'package.json', digest: digest('f') }
      ] },
    gates: [{ id: 'typecheck', phase: 'quick', argv: ['bun', 'run', 'typecheck'], runtime: 'bun',
      environment: {}, coveredScopeIds: ['runtime'] }]
  });
  const scopeAuthorization = createScopeAuthorization({ ...scopeInput,
    actionPlanClosureDigest: actionPlanClosure.actionPlanDigest });
  const mainHealth = createMainHealthLedger({ repository: REPOSITORY, defaultBranch: 'main',
    mainSha: BASE, mainTreeSha: scopeInput.baseTreeSha, status: 'healthy', failureFingerprints: [],
    owner: null, repairWorkPackage: null, allowedLanes: ['ordinary'], trustRevision: BASE,
    observedAt: scopeInput.issuedAt, expiresAt: scopeInput.expiresAt,
    producer: { identity: 'provider-delegated-data', trustRevision: BASE, sourceTransport: 'github-api',
      sourceRunId: PARENT_RUN_ID, sourceRef: 'refs/heads/main', sourceDigest: digest('a') } });
  const session = createVerificationSession({ sessionId: 'provider-delegated-data', createdAt: scopeInput.issuedAt,
    repository: REPOSITORY, prNumber: 42, baseSha: BASE, baseTreeSha: scopeInput.baseTreeSha,
    headSha: HEAD, headTreeSha: scopeInput.headTreeSha, manifestPath: scopeInput.manifestPath,
    manifestDigest: scopeInput.manifestDigest, sessionProposalDigest: scopeAuthorization.sessionProposalDigest,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest,
    actionPlanClosureDigest: actionPlanClosure.actionPlanDigest, profile: 'quick', environmentDigest: scopeInput.environmentDigest,
    trustRevision: BASE, reviewPolicyDigest: SEC_REVIEW_STABILITY_POLICY.policyDigest,
    evidenceRequirementDigest: digest('d'), integrationPolicyDigest: digest('e'),
    mainHealthRef: { mainSha: BASE, mainTreeSha: mainHealth.mainTreeSha,
      healthRevision: mainHealth.healthRevision, ledgerReceiptDigest: mainHealth.ledgerDigest } });
  const reviewSnapshot = { paginationComplete: true as const, reviewedHeadSha: HEAD,
    reviewPageDigests: [digest('a')], threadPageDigests: [digest('b')], reviewCount: 1,
    threadCount: 0, unresolvedBlockingThreadCount: 0 as const, requestChangesPrincipalIds: [] as const };
  const snapshot = { ...reviewSnapshot, snapshotDigest: createReviewSnapshotDigest(reviewSnapshot) };
  const preGateReview = createReviewStabilityReceipt({ stage: 'pre-expensive', repository: REPOSITORY,
    prNumber: 42, sessionRevision: session.sessionRevision,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision,
    scopeAuthorizationReceiptDigest: scopeAuthorization.authorizationDigest, headSha: HEAD,
    headTreeSha: session.headTreeSha, policy: SEC_REVIEW_STABILITY_POLICY,
    principal: { kind: 'human', nodeId: 'REVIEWER', approvalState: 'APPROVED' },
    independence: { candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: parentActor.nodeId },
    producer: { identity: REVIEW_OBSERVER_PRODUCER_IDENTITY, executionIdentity: 'provider-delegated-data',
      providerIdentity: 'github', candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
      trustedRevision: SEC_REVIEW_STABILITY_POLICY.trustedRevision, sourceTransport: 'github-graphql',
      sourceRunId: PARENT_RUN_ID, sourceRef: `github://${REPOSITORY}/pull/42@${HEAD}`,
      sourceDigest: snapshot.snapshotDigest }, snapshot,
    reviewedAt: scopeInput.issuedAt, expiresAt: scopeInput.expiresAt });
  const request = { ...sessionRequest, expectedScopeProposalDigest: scopeAuthorization.sessionProposalDigest,
    expectedActionPlanDigest: actionPlanClosure.actionPlanDigest, expectedSessionRevision: session.sessionRevision,
    reviewPolicyDigest: session.reviewPolicyDigest };
  const actionKey = actionPlanClosure.actions[0]!.action.actionKey;
  const proposed = createCiVerificationActionProposal({ sessionRequest: request, proposedActionKey: actionKey });
  const plan = createCiVerificationActionParentDispatchPlan({ repositoryId: String(REPOSITORY_ID), repository: REPOSITORY,
    parentRunId: PARENT_RUN_ID, parentRunAttempt: 1, parentJobId: String(PARENT_JOB_ID),
    parentWorkflowRef: `${REPOSITORY}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`,
    parentWorkflowSha: BASE, parentActor, proposals: [proposed] });
  const parentText = `${encodeVerificationActionData(plan)}\n`;
  const providerEnvelope = createCiVerificationActionProviderEnvelope({ proposal: proposed, parentPlan: plan,
    parentDispatchPlanArtifactId: String(PARENT_ARTIFACT_ID),
    parentDispatchPlanArchiveDigest: archiveDigestFor('verification-action-parent-dispatch-plan.json', parentText) });
  const hostedBody = { schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA, requestOperationId: request.requestOperationId,
    scopeAuthorization, preGateReview, mainHealth, session, actionPlanClosure };
  const hosted = parseHostedEnvelope({ ...hostedBody, envelopeDigest: ciActionDigest(hostedBody) });
  const resolution = CodexDevelopmentResolveHostedAction({
    request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(proposed)), envelope: hosted });
  const start = createVerificationActionProviderStartMarker({ actionKey, candidateSha: HEAD,
    executionEnvironmentRevision: 'hosted', producer: currentOrigin });
  const startText = `${encodeVerificationActionData(start)}\n`;
  const terminal = buildUnsupportedVerificationActionTerminalArtifact({ actionPlan: actionPlanClosure.actions[0]!,
    normalizedOperation: actionPlanClosure.normalizedOperations[0]!, baseSha: BASE, baseTreeSha: session.baseTreeSha,
    headSha: HEAD, headTreeSha: session.headTreeSha, manifestPath: session.manifestPath,
    manifestDigest: session.manifestDigest, producer: currentOrigin });
  const terminalText = `${encodeVerificationActionData(terminal)}\n`;
  const anchor = createVerificationActionProviderTerminalAnchor({ actionKey, candidateSha: HEAD,
    startStatusId: 101, startStatusNodeId: 'STATUS_101', startArtifactOriginId: '7001',
    startArtifactName: verificationActionProviderStartArtifactName(actionKey),
    startArtifactArchiveDigest: archiveDigestFor('verification-action-start-marker.json', startText),
    startMarkerDigest: start.markerDigest, terminalArtifactOriginId: '7002',
    terminalArtifactName: verificationActionProviderTerminalArtifactName(actionKey),
    terminalArtifactArchiveDigest: archiveDigestFor('verification-action-terminal-artifact.json', terminalText),
    terminalArtifactPayloadDigest: terminal.artifactDigest as VerificationActionKeyDigest,
    terminalAssemblerOrigin: currentOrigin, anchorPublisherOrigin: currentOrigin });
  const completedAction = { providerEnvelope, runId: CURRENT_RUN_ID, runAttempt: 1,
    terminalArtifactId: '7002', terminalArtifactName: anchor.terminalArtifactName,
    terminalArchiveDigest: anchor.terminalArtifactArchiveDigest, terminalPayloadDigest: anchor.terminalArtifactPayloadDigest };
  const emitter = { repositoryId: String(REPOSITORY_ID), repository: REPOSITORY,
    workflowPath: '.github/workflows/merge-gate.yml' as const, workflowSha: BASE, runId: '9300', runAttempt: 1,
    jobId: '6300', checkRunId: '5300', policyJobId: 'integrate' as const,
    phase: 'resume-verification-session' as const, stepName: 'Resume canonical verification Session' as const, stepNumber: 5 };
  const signalBody = { schema: HOSTED_RESUME_SIGNAL_SCHEMA,
    wakeKey: ciActionDigest({ schema: HOSTED_SESSION_WAKE_KEY_SCHEMA, completedAction }), completedAction, emitter };
  const signal = parseHostedResumeDispatchSignal(encodeVerificationActionData({ ...signalBody, signalDigest: ciActionDigest(signalBody) }));
  const producer = CodexDevelopmentCreateVerificationEvidenceProducer({ sourceTransport: 'github-actions',
    workflowPath: '.github/workflows/compiler-pr-validation.yml', workflowRef: currentOrigin.workflowRef,
    workflowSha: BASE, runId: DELEGATED_RUN_ID, runAttempt: 1, actorNodeId: bot.nodeId });
  const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({ contractRevision: 'ci-verification-v19',
    sessionRevision: session.sessionRevision, sessionProposalDigest: session.sessionProposalDigest,
    scopeAuthorizationRevision: scopeAuthorization.authorizationRevision, scopeAuthorizationDigest: scopeAuthorization.authorizationDigest,
    reviewReceiptDigest: preGateReview.receiptDigest, mainHealthRevision: mainHealth.healthRevision,
    mainHealthDigest: mainHealth.ledgerDigest, trustRevision: BASE, profile: 'quick', baseSha: BASE,
    baseTreeSha: session.baseTreeSha, headSha: HEAD, headTreeSha: session.headTreeSha,
    manifestPath: session.manifestPath, manifestDigest: session.manifestDigest, producer,
    actionPlan: actionPlanClosure, status: 'unsupported', startedAt: '2026-08-09T01:00:00.000Z',
    finishedAt: '2026-08-09T01:00:12.000Z', gates: [{ action: terminal.actionPlan.action,
      result: terminal.result, cleanup: terminal.cleanup }], evidenceRefs: [], invalidationRules: ['Original cause changes'] });
  const artifact = finalizeVerificationSessionResumeArtifact({ scopeAuthorization, session, preGateReview, mainHealth,
    evidence, producer, sourceCause: { kind: 'hosted-action-resume', signal,
      actionPlanClosureDigest: actionPlanClosure.actionPlanDigest, requestOperationId: request.requestOperationId,
      scopeAuthorizationDigest: scopeAuthorization.authorizationDigest, sessionRevision: session.sessionRevision } });
  const artifactText = `${encodeVerificationActionData(artifact)}\n`;
  const selector = parseHostedSessionTerminalArtifact(artifactText);
  if (selector.schema !== 'verification-session-delegated-terminal') throw new Error('delegated fixture schema drift');
  const artifactName = hostedSessionArtifactName({ prNumber: 42, sessionRevision: session.sessionRevision,
    runId: DELEGATED_RUN_ID, runAttempt: 1 });
  const members = { 'verification-action-provider-envelope.json': `${encodeVerificationActionData(providerEnvelope)}\n`,
    'hosted-action-resolution.json': `${encodeVerificationActionData(resolution)}\n`,
    'hosted-envelope.json': `${encodeVerificationActionData(hosted)}\n` };
  const target = new FakeGh();
  target.artifacts = [
    { id: PARENT_ARTIFACT_ID, name: providerEnvelope.parentDispatchPlanArtifactName, expired: false,
      runId: Number(PARENT_RUN_ID), fileName: 'verification-action-parent-dispatch-plan.json', source: parentText },
    { id: 7001, name: anchor.startArtifactName, expired: false, runId: Number(CURRENT_RUN_ID),
      fileName: 'verification-action-start-marker.json', source: startText },
    { id: 7002, name: anchor.terminalArtifactName, expired: false, runId: Number(CURRENT_RUN_ID),
      fileName: 'verification-action-terminal-artifact.json', source: terminalText },
    { id: 7003, name: verificationActionProviderTerminalAnchorName(actionKey), expired: false,
      runId: Number(CURRENT_RUN_ID), fileName: 'verification-action-terminal-status-anchor.json', source: `${encodeVerificationActionData(anchor)}\n` },
    { id: 7004, name: provider.hostedActionResolutionArtifactName(actionKey, CURRENT_RUN_ID, 1), expired: false,
      runId: Number(CURRENT_RUN_ID), fileName: 'hosted-action-resolution.json', source: members['hosted-action-resolution.json'], members },
    { id: DELEGATED_ARTIFACT_ID, name: artifactName, expired: false, runId: Number(DELEGATED_RUN_ID),
      fileName: 'verification-session-artifact.json', source: artifactText }
  ];
  target.statuses = [rawStatus({ id: 101, context: verificationActionProviderStatusContext(actionKey),
    description: verificationActionProviderStartDescription(start.markerDigest) }),
    rawStatus({ id: 102, context: verificationActionProviderStatusContext(actionKey), state: 'success',
      description: verificationActionProviderTerminalDescription(anchor.anchorDigest) })];
  target.parentRunOverrides = { name: `verify session PR #42 session ${session.sessionRevision}`,
    display_title: `verify session PR #42 session ${session.sessionRevision}` };
  const human = { login: parentActor.login, id: parentActor.id, node_id: parentActor.nodeId, type: 'User' };
  target.exactRunOverrides[`${PARENT_RUN_ID}:1`] = { workflow_id: 300, head_branch: 'main', actor: human, triggering_actor: human };
  target.exactRunOverrides[`${DELEGATED_RUN_ID}:1`] = { head_branch: 'main', status: 'completed', conclusion: 'success',
    actor: botRecord, triggering_actor: botRecord };
  target.exactRunOverrides['9300:1'] = { path: emitter.workflowPath, event: 'workflow_run', head_branch: 'main', check_suite_id: 5300 };
  target.actionJobsByAttempt['9300:1'] = [{ id: 6300, name: 'integrate', run_id: 9300, run_attempt: 1,
    head_sha: BASE, check_run_url: `https://api.github.com/repos/${REPOSITORY}/check-runs/5300`,
    steps: [{ number: 5, name: emitter.stepName, status: 'completed', conclusion: 'success' }] }];
  const job: Record<string, unknown> = { id: 6400, name: 'receive-verification-session-resume', run_id: Number(DELEGATED_RUN_ID),
    head_sha: BASE, status: 'completed', conclusion: 'success', started_at: '2026-08-09T01:01:00Z', completed_at: '2026-08-09T01:01:12Z',
    steps: [{ number: 5, name: 'Resume original authenticated Verification Session', status: 'completed', conclusion: 'success',
      started_at: '2026-08-09T01:01:01Z', completed_at: '2026-08-09T01:01:02Z' },
    { number: 6, name: 'Upload complete original resume dispatch outcome observations', status: 'completed', conclusion: 'success',
      started_at: '2026-08-09T01:01:03Z', completed_at: '2026-08-09T01:01:05Z' },
    { number: 7, name: 'Upload resumed terminal Verification Session artifact', status: 'completed', conclusion: 'success',
      started_at: '2026-08-09T01:01:06Z', completed_at: '2026-08-09T01:01:10Z' }] };
  target.actionJobsByAttempt[`${DELEGATED_RUN_ID}:1`] = [job];
  target.artifactMetadataOverrides[String(DELEGATED_ARTIFACT_ID)] = { created_at: '2026-08-09T01:01:06Z', updated_at: '2026-08-09T01:01:10Z' };
  const origin = historicalReceiverOrigin;
  trustedEnvironment(providerEnvelope);
  fakeGh = target;
  return { artifact: selector, artifactText, artifactId: String(DELEGATED_ARTIFACT_ID), origin,
    job, artifactName, hosted, actionPlanClosure, providerEnvelope };
}


const OUTCOME_ARTIFACT_ID = 7006;
function outcomeHistoryFixture() {
  const delegated = delegatedSessionFixture();
  const signal = delegated.artifact.sourceCause.signal;
  const sessionRevision = delegated.artifact.session.sessionRevision;
  const actionKey = delegated.providerEnvelope.proposal.proposedActionKey;
  const receiver = { repository: REPOSITORY, workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    workflowSha: BASE, runId: DELEGATED_RUN_ID, runAttempt: 1, jobId: String(delegated.job.id) };
  const outcome = createHostedResumeDispatchOutcome({ signal, sessionRevision, actionKey, receiver,
    outcome: { disposition: 'unknown', publicationState: 'entered-unknown', reason: 'No settled dispatch result' },
    recordedAt: '2026-08-09T01:01:02.000Z' });
  const collection = createHostedResumeDispatchOutcomeCollection({ signal, sessionRevision, receiver,
    expectedActionKeys: [actionKey], entries: [{ actionKey, recording: 'unrecorded', outcome }] });
  const source = `${JSON.stringify(collection)}\n`;
  const artifact: ArtifactFixture = { id: OUTCOME_ARTIFACT_ID,
    name: hostedResumeDispatchOutcomesArtifactName(DELEGATED_RUN_ID, 1), expired: false,
    runId: Number(DELEGATED_RUN_ID), fileName: HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE, source };
  fakeGh.artifacts.push(artifact);
  fakeGh.artifactMetadataOverrides[String(OUTCOME_ARTIFACT_ID)] = {
    created_at: '2026-08-09T01:01:03Z', updated_at: '2026-08-09T01:01:05Z' };
  fakeGh.exactRunOverrides[`${CURRENT_RUN_ID}:1`] = { head_branch: 'main', actor: botRecord, triggering_actor: botRecord };
  writeFileSync(EVENT_PATH, JSON.stringify({ action: HOSTED_RESUME_DISPATCH_EVENT, client_payload: { payload: signal },
    sender: botRecord, repository: { id: REPOSITORY_ID, full_name: REPOSITORY } }));
  return { ...delegated, signal, sessionRevision, actionKey, collection, source, artifact,
    input: { origin: delegated.origin, signal,
      authority: { envelope: delegated.providerEnvelope, actionPlanClosure: delegated.actionPlanClosure },
      sessionRevision, actionKeys: [actionKey] } };
}

let fakeGh: FakeGh;
let originalFetch: typeof fetch | undefined;
const ensureTransaction = provider.ensureVerificationActionGitHubProviderTransaction;

async function closeFixtureOrigins(primary?: ResourceSettlementFailure): Promise<void> {
  const priorFetch = originalFetch;
  const priorEnvironment = originalEnvironment;
  const eventRoot = EVENT_ROOT;
  await settleResourcesAsync({ primary, cleanup: [
    ...issuedFixtureOrigins.splice(0).map((origin, index) => ({ label: `fixture-origin-${index}`,
      settle: () => closeAuthenticatedGitHubJobOrigin(origin) })),
    { label: 'fixture-fetch', settle: () => {
      if (priorFetch !== undefined) {
        globalThis.fetch = priorFetch;
        originalFetch = undefined;
      }
    } },
    { label: 'fixture-environment', settle: () => {
      if (priorEnvironment !== undefined) {
        restoreOriginEnvironment(priorEnvironment);
        originalEnvironment = undefined;
      }
    } },
    { label: 'fixture-event-directory', settle: () => {
      if (eventRoot !== undefined) {
        rmSync(eventRoot, { recursive: true, force: true });
        EVENT_ROOT = undefined;
      }
    } }
  ] });
}

async function openFixtureOrigins(): Promise<void> {
  // Collection only registers this lifecycle. Unsupported hosts fail the suite;
  // this diagnostic is not an Action terminal or a successful skipped test.
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw Object.assign(new Error('GitHub provider issuer fixture unsupported: requires linux/x64.'), {
      code: 'GITHUB-PROVIDER-FIXTURE-UNSUPPORTED', status: 'unsupported'
    });
  }
  try {
    // Observe the actual loaded checkout through the original read owner. The
    // issuer still independently requires its exact clean source and pinned Bun.
    [BASE, SOURCE_TREE] = await withAuthorityGitReadSession({ cwd: REPOSITORY_ROOT, source: process.env,
      budget: { maxProcesses: 2 } }, async git => {
      const values: string[] = [];
      for (const revision of ['HEAD', 'HEAD^{tree}']) {
        const result = await git.run(['rev-parse', revision]);
        if (result.kind !== 'completed' || result.result.code !== 0) throw new Error('Origin fixture source observation failed');
        const value = Buffer.from(result.result.stdout).toString('utf8').trim();
        if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error('Origin fixture source identity is invalid');
        values.push(value);
      }
      return values as [string, string];
    });
    EVENT_ROOT = mkdtempSync(path.join(tmpdir(), 'sec-provider-p1-test-'));
    EVENT_PATH = path.join(EVENT_ROOT, 'event.json');
    CANONICAL_WORKFLOW_SOURCE = readFileSync(new URL('../../.github/workflows/compiler-pr-validation.yml', import.meta.url), 'utf8');
    ({ closure, ACTION, CONTEXT, sessionRequest, proposal, parentActor, parentPlanSource, envelope, bot, botRecord, currentOrigin, marker } = createProviderFixtureData(BASE));
    ORIGIN_JOB_STARTED_AT = new Date(Date.now() - 1_000).toISOString();
    originSigningKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
    originJwks = { keys: [{ ...originSigningKey.publicKey.export({ format: 'jwk' }),
      kid: 'fixture-origin-key', alg: 'RS256', use: 'sig' }] };
    fakeGh = new FakeGh();
    originalEnvironment = new Map(originEnvironmentKeys.map(key => [key, process.env[key]]));
    const priorFetch = globalThis.fetch;
    originalFetch = priorFetch;
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (openingOriginFixture !== undefined) return originFixtureResponse(openingOriginFixture, url, init);
        if (url.origin !== 'https://api.github.com' && url.origin !== 'https://results-receiver.actions.githubusercontent.com') {
          throw new Error('Unexpected provider fixture URL');
        }
        return await fakeGh.fetch(url, init);
      },
      { preconnect: priorFetch.preconnect }
    );
    claimOrigin = await openFixtureOrigin({ ...receiverFixture, policyJobId: 'claim-verification-action', phase: 'claim-start',
      stepName: 'Publish durable start tombstone and issue execution ticket', stepNumber: 10, jobId: 6101, checkRunId: 5101 });
    const coordinateFixture = { ...receiverFixture, policyJobId: 'coordinate-verification-session', phase: 'coordinate-session',
      stepName: 'Complete original Action coordination and canonical Session', stepNumber: 7, jobId: 6102, checkRunId: 5102 };
    coordinateOrigin = await openFixtureOrigin(coordinateFixture);
    parentCoordinateOrigin = await openFixtureOrigin({ ...coordinateFixture, runId: PARENT_RUN_ID, jobId: PARENT_JOB_ID, checkRunId: 5001 });
    terminalOrigin = await openFixtureOrigin({ ...receiverFixture, policyJobId: 'assemble-verification-action-terminal', phase: 'anchor-terminal',
      stepName: 'Publish neutral terminal provider tombstone', stepNumber: 12, jobId: 6103, checkRunId: 5103 });
    resumeOrigin = await openFixtureOrigin(receiverFixture);
    historicalReceiverOrigin = await openFixtureOrigin(receiverFixture);
    closedReceiverOrigin = await openFixtureOrigin(receiverFixture);
    disallowedMergeOrigin = await openFixtureOrigin({ ...receiverFixture, workflowPath: MERGE_WORKFLOW,
      policyJobId: 'integrate', phase: 'resume-verification-session', stepName: 'Resume canonical verification Session',
      runId: '9300', jobId: 6300, checkRunId: 5300 });
  } catch (error) {
    // Keep the original issuer's unavailable result and every cleanup failure.
    await closeFixtureOrigins({ label: 'fixture-origin-opening', error });
    throw error;
  }
}

function trustedEnvironment(eventEnvelope: CiVerificationActionProviderEnvelope = envelope): void {
  Object.assign(process.env, {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
    GH_TOKEN: 'ghs-provider-fixture-token',
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REPOSITORY_ID: String(REPOSITORY_ID),
    GITHUB_RUN_ID: CURRENT_RUN_ID,
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_EVENT_NAME: 'repository_dispatch',
    GITHUB_SHA: BASE,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`,
    GITHUB_WORKFLOW_SHA: BASE,
    GITHUB_ACTOR: bot.login,
    GITHUB_TRIGGERING_ACTOR: bot.login,
    GITHUB_EVENT_PATH: EVENT_PATH
  });
  writeFileSync(EVENT_PATH, JSON.stringify({
    action: CI_VERIFICATION_ACTION_DISPATCH_TYPE,
    client_payload: { payload: eventEnvelope },
    sender: botRecord,
    repository: { id: REPOSITORY_ID, full_name: REPOSITORY }
  }));
}

function trustedParentEnvironment(): void {
  Object.assign(process.env, {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
    GH_TOKEN: 'ghs-provider-fixture-token',
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REPOSITORY_ID: String(REPOSITORY_ID),
    GITHUB_RUN_ID: PARENT_RUN_ID,
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_EVENT_NAME: 'repository_dispatch',
    GITHUB_SHA: BASE,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`,
    GITHUB_WORKFLOW_SHA: BASE,
    GITHUB_ACTOR: parentActor.login,
    GITHUB_TRIGGERING_ACTOR: parentActor.login,
    GITHUB_EVENT_PATH: EVENT_PATH
  });
  writeFileSync(EVENT_PATH, JSON.stringify({
    action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    client_payload: { payload: sessionRequest },
    sender: {
      login: parentActor.login,
      id: parentActor.id,
      node_id: parentActor.nodeId,
      type: parentActor.type
    },
    repository: { id: REPOSITORY_ID, full_name: REPOSITORY }
  }));
}

function authority(
  valueEnvelope: CiVerificationActionProviderEnvelope = envelope,
  valueClosure: CiVerificationActionPlanClosure = closure
) {
  trustedEnvironment(valueEnvelope);
  return { envelope: valueEnvelope, actionPlanClosure: valueClosure };
}

describe('VerificationAction GitHub provider authenticated transaction', () => {
  beforeAll(openFixtureOrigins);
  afterAll(async () => { await closeFixtureOrigins(); });

  test('compiler resume receiver gets the original Action transport for one child wake and cannot publish status', async () => {
    fakeGh = new FakeGh();
    trustedEnvironment();
    // The fixed compiler receiver was issued by the original owner. Only
    // upstream fetch data is substituted for this provider transaction.
    await githubApi.withGitHubApiVerificationActionProviderSession({ origin: resumeOrigin,
      operation: async capability => {
        await githubApi.executeGitHubApiOperation(capability, { kind: 'verification-action-dispatch', envelope });
        for (const state of ['pending', 'success'] as const) {
          await expect(githubApi.executeGitHubApiOperation(capability, {
            kind: 'verification-action-status', actionKey: ACTION, sha: HEAD, state,
            description: 'Receiver must not publish Action status',
            targetUrl: verificationActionProviderRunTargetUrl(currentOrigin)
          })).rejects.toThrow('Action status differs from its current producing phase');
        }
      }
    });
    expect(fakeGh.dispatchBodies).toEqual([{
      event_type: 'sec-produce-verification-action-v2', client_payload: { payload: envelope }
    }]);
    expect(fakeGh.dispatchCalls).toBe(1);
    expect(fakeGh.createCalls).toBe(0);
  });

  test('resume transport rejects another workflow, phase or job before the operation callback or POST', async () => {
    const forgeries = [
      { workflowPath: MERGE_WORKFLOW, policyJobId: 'receive-verification-session-resume',
        phase: 'receive-verification-session-resume', stepName: receiverFixture.stepName,
        rejection: 'job has no canonical runtime policy' },
      { workflowPath: COMPILER_WORKFLOW, policyJobId: 'receive-verification-session-resume',
        phase: 'coordinate-session', stepName: 'Complete original Action coordination and canonical Session',
        rejection: 'active provider step is not a closed launcher phase' },
      { workflowPath: COMPILER_WORKFLOW, policyJobId: 'execute-verification-action-sut',
        phase: 'receive-verification-session-resume', stepName: receiverFixture.stepName,
        rejection: 'active provider step is not a closed launcher phase' }
    ];
    for (const forged of forgeries) {
      fakeGh = new FakeGh();
      trustedEnvironment();
      let callbackCalls = 0;
      await expect((async () => {
        // These combinations cannot be issued. Inject their signed/provider
        // data at the lower seam and retain the original issuer rejection.
        const origin = await openFixtureOrigin({ ...receiverFixture, ...forged });
        await githubApi.withGitHubApiVerificationActionProviderSession({ origin,
          operation: async capability => {
            callbackCalls += 1;
            await githubApi.executeGitHubApiOperation(capability, { kind: 'verification-action-dispatch', envelope });
          }
        });
      })()).rejects.toThrow(forged.rejection);
      expect(callbackCalls).toBe(0);
      expect(fakeGh.dispatchCalls).toBe(0);
      expect(fakeGh.createCalls).toBe(0);
    }
    fakeGh = new FakeGh();
    trustedEnvironment();
    process.env.GITHUB_EVENT_NAME = 'workflow_run';
    process.env.GITHUB_WORKFLOW_REF = `${REPOSITORY}/${MERGE_WORKFLOW}@refs/heads/main`;
    let callbackCalls = 0;
    // A genuine original-issued merge job separately reaches the transport
    // guard. Issuer rejection alone must not stand in for this boundary.
    expect(assertAuthenticatedGitHubJobOriginCurrent(disallowedMergeOrigin).policyJobId).toBe('integrate');
    await expect(githubApi.withGitHubApiVerificationActionProviderSession({ origin: disallowedMergeOrigin,
      operation: async capability => {
        callbackCalls += 1;
        await githubApi.executeGitHubApiOperation(capability, { kind: 'verification-action-dispatch', envelope });
      }
    })).rejects.toThrow('Action provider transport requires its exact original job phase');
    expect(callbackCalls).toBe(0);
    expect(fakeGh.dispatchCalls).toBe(0);
    expect(fakeGh.createCalls).toBe(0);
  });

  test('exact parent artifact, closure member, current bot run, and marker chain posts once', async () => {
    fakeGh = new FakeGh().withMarker();
    const result = await ensureTransaction({
      origin: claimOrigin,
      authority: authority(),
      intent: { kind: 'claim-start', marker }
    });
    expect(result.disposition).toBe('started');
    expect(result.actionKey).toBe(ACTION);
    expect(result.status).toMatchObject({ state: 'pending', context: CONTEXT });
    expect(fakeGh.createCalls).toBe(1);
  });

  test('coordinate-parent binds the current external Session run and is structurally read-only', async () => {
    fakeGh = new FakeGh();
    trustedParentEnvironment();
    const result = await ensureTransaction({
      origin: parentCoordinateOrigin,
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'coordinate-parent' }
    });
    expect(result.disposition).toBe('observed');
    expect(result.actionKey).toBe(ACTION);
    expect(fakeGh.createCalls).toBe(0);
    fakeGh.parentPermissionUser.node_id = 'different-node';
    await expect(ensureTransaction({
      origin: parentCoordinateOrigin,
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'coordinate-parent' }
    })).rejects.toThrow('parent actor live identity');
    expect(fakeGh.createCalls).toBe(0);
  });

  test('parent plan consumes its exact workflow source, attempt census and completed upload', async () => {
    for (const completed of [false, true]) {
      fakeGh = new FakeGh();
      expect(Object.hasOwn(fakeGh.parentJobs[0]!, 'run_attempt')).toBe(false);
      if (completed) {
        fakeGh.withMarker();
        Object.assign(fakeGh.parentJobs[0]!, { run_attempt: 1, status: 'completed', conclusion: 'success',
          completed_at: '2026-08-09T01:00:07Z' });
        Object.assign((fakeGh.parentJobs[0]!.steps as Record<string, unknown>[])[2]!, {
          status: 'completed', conclusion: 'success', completed_at: '2026-08-09T01:00:07Z' });
      }
      trustedParentEnvironment();
      const result = completed
        ? await ensureTransaction({ origin: claimOrigin, authority: authority(), intent: { kind: 'claim-start', marker } })
        : await ensureTransaction({ origin: parentCoordinateOrigin,
          authority: { envelope, actionPlanClosure: closure }, intent: { kind: 'coordinate-parent' } });
      expect(result.disposition).toBe(completed ? 'started' : 'observed');
      expect(fakeGh.workflowSourceCalls).toContainEqual({ path: '.github/workflows/compiler-pr-validation.yml', ref: BASE });
      const parentCalls = fakeGh.jobListCalls.filter(call => call.runId === PARENT_RUN_ID);
      expect(parentCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of parentCalls) expect(call).toEqual({ runId: PARENT_RUN_ID, runAttempt: 1, page: 1 });
      expect(fakeGh.createCalls).toBe(completed ? 1 : 0);
      expect(fakeGh.dispatchCalls).toBe(0);
    }
  });

  test('parent job census rejects absent totals, truncated pages, duplicate identities and wrong attempts before POST', async () => {
    const forgeries: Array<(target: FakeGh) => void> = [
      ...[undefined, null, '1', -1, 1.5, 100_001, 0, 2].map(totalCount =>
        (target: FakeGh) => { target.jobPageHook = () => ({ totalCount }); }),
      target => { target.parentJobs.push({ ...target.parentJobs[0]! }); },
      ...[{ id: 0 }, { id: '6001' }, { id: 1.5 }, { run_id: Number(CURRENT_RUN_ID) },
        { run_attempt: null }, { run_attempt: 2 }, { run_attempt: '1' }].map(patch =>
        (target: FakeGh) => { Object.assign(target.parentJobs[0]!, patch); })
    ];
    for (const forge of forgeries) {
      fakeGh = new FakeGh();
      forge(fakeGh);
      trustedParentEnvironment();
      await expect(ensureTransaction({ origin: parentCoordinateOrigin,
        authority: { envelope, actionPlanClosure: closure }, intent: { kind: 'dispatch-child' } }))
        .rejects.toThrow(/(?:source job page|parent workflow job)/);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('parent job census preserves full pages and rejects changed totals or leading boundaries', async () => {
    const fillJobs = (target: FakeGh, count: number): void => {
      while (target.parentJobs.length < count) target.parentJobs.push({
        id: 10_000 + target.parentJobs.length, name: `unrelated-${target.parentJobs.length}`,
        run_id: Number(PARENT_RUN_ID), head_sha: BASE
      });
    };
    for (const count of [100, 101]) {
      fakeGh = new FakeGh();
      fillJobs(fakeGh, count);
      trustedParentEnvironment();
      await expect(ensureTransaction({ origin: parentCoordinateOrigin,
        authority: { envelope, actionPlanClosure: closure }, intent: { kind: 'coordinate-parent' } }))
        .resolves.toMatchObject({ disposition: 'observed' });
      expect(fakeGh.jobListCalls.map(call => call.page)).toEqual(count === 100 ? [1, 1] : [1, 2, 1]);
    }
    for (const forge of [
      (target: FakeGh) => { target.jobPageHook = page => page === 2 ? { totalCount: 102 } : null; },
      (target: FakeGh) => { target.jobPageHook = page => page === 2 ? { jobs: [target.parentJobs[0]!] } : null; },
      (target: FakeGh) => { target.jobPageHook = (_page, call) => call === 3
        ? { jobs: target.parentJobs.slice(0, 100).map((job, index) => index === 0 ? { ...job, id: 9999 } : job) } : null; }
    ]) {
      fakeGh = new FakeGh();
      fillJobs(fakeGh, 101);
      forge(fakeGh);
      trustedParentEnvironment();
      await expect(ensureTransaction({ origin: parentCoordinateOrigin,
        authority: { envelope, actionPlanClosure: closure }, intent: { kind: 'dispatch-child' } }))
        .rejects.toThrow(/parent workflow job/);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('parent plan exact bytes cannot replace successful ordered producer and upload observations', async () => {
    const stepPatch = (index: number, patch: Record<string, unknown>) => (target: FakeGh): void => {
      const steps = target.parentJobs[0]!.steps as Record<string, unknown>[];
      steps[index] = { ...steps[index]!, ...patch };
    };
    const forgeries: Array<(target: FakeGh) => void> = [
      target => { target.parentJobs[0]!.steps = []; },
      target => { (target.parentJobs[0]!.steps as unknown[]).splice(0, 1); },
      target => { (target.parentJobs[0]!.steps as unknown[]).splice(1, 1); },
      target => { const steps = target.parentJobs[0]!.steps as Record<string, unknown>[];
        steps.push({ ...steps[1]!, number: 8 }); },
      target => { const steps = target.parentJobs[0]!.steps as Record<string, unknown>[];
        steps.push({ ...steps[0]!, number: 8 }); },
      stepPatch(0, { number: 0 }), stepPatch(1, { number: 5 }), stepPatch(1, { number: 4 }),
      stepPatch(0, { status: 'in_progress' }), stepPatch(0, { conclusion: 'failure' }),
      stepPatch(1, { status: 'in_progress' }), stepPatch(1, { conclusion: 'skipped' }),
      stepPatch(0, { started_at: '2026-08-09T00:59:59Z' }), stepPatch(0, { started_at: undefined }),
      stepPatch(0, { completed_at: '2026-08-09T01:00:00Z' }), stepPatch(0, { completed_at: null }),
      stepPatch(1, { started_at: '2026-08-09T01:00:01Z' }), stepPatch(1, { started_at: null }),
      stepPatch(1, { completed_at: '2026-08-09T01:00:02Z' }), stepPatch(1, { completed_at: 'invalid' }),
      stepPatch(1, { completed_at: '2026-08-10T01:00:00Z' }),
      ...[{ head_sha: HEAD }, { started_at: undefined }, { started_at: '2026-08-09T01:00:02Z' },
        { status: 'completed', conclusion: 'failure', completed_at: '2026-08-09T01:00:07Z' },
        { status: 'completed', conclusion: 'success', completed_at: '2026-08-09T01:00:04Z' },
        { status: 'completed', conclusion: 'success', completed_at: '2026-08-10T01:00:00Z' },
        { completed_at: '2026-08-09T01:00:07Z' }, { conclusion: 'success' }].map(patch =>
        (target: FakeGh) => { Object.assign(target.parentJobs[0]!, patch); })
    ];
    for (const forge of forgeries) {
      fakeGh = new FakeGh();
      forge(fakeGh);
      trustedParentEnvironment();
      await expect(ensureTransaction({ origin: parentCoordinateOrigin,
        authority: { envelope, actionPlanClosure: closure }, intent: { kind: 'dispatch-child' } }))
        .rejects.toThrow(/parent plan/);
      expect(fakeGh.artifacts[0]!.source).toBe(parentPlanSource);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('parent plan artifact timestamps and exact source remain mandatory with unchanged canonical bytes', async () => {
    for (const patch of [{ created_at: undefined }, { created_at: null }, { created_at: 'invalid' },
      { updated_at: undefined }, { updated_at: null }, { updated_at: 'invalid' },
      { created_at: '2026-08-09T01:00:02Z' }, { created_at: '2026-08-09T01:00:06Z' },
      { updated_at: '2026-08-09T01:00:02Z' }, { updated_at: '2026-08-09T01:00:06Z' },
      { workflow_run: { id: Number(PARENT_RUN_ID), head_sha: HEAD } }]) {
      fakeGh = new FakeGh();
      fakeGh.artifactMetadataOverrides[String(PARENT_ARTIFACT_ID)] = patch;
      trustedParentEnvironment();
      await expect(ensureTransaction({ origin: parentCoordinateOrigin,
        authority: { envelope, actionPlanClosure: closure }, intent: { kind: 'dispatch-child' } }))
        .rejects.toThrow(/parent (?:plan|dispatch plan)/);
      expect(fakeGh.artifacts[0]!.source).toBe(parentPlanSource);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
    fakeGh = new FakeGh();
    fakeGh.workflowSource = fakeGh.workflowSource.replace('name: Upload canonical parent Action dispatch plan artifact',
      'name: Unrelated upload');
    trustedParentEnvironment();
    await expect(ensureTransaction({ origin: parentCoordinateOrigin,
      authority: { envelope, actionPlanClosure: closure }, intent: { kind: 'dispatch-child' } }))
      .rejects.toThrow(/Hosted workflow shape/);
    expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
  }, 30_000);

  test('parent coordinator emits one authenticated child wake-up without exposing raw dispatch', async () => {
    fakeGh = new FakeGh();
    trustedParentEnvironment();
    const result = await ensureTransaction({
      origin: parentCoordinateOrigin,
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'dispatch-child' }
    });
    expect(result.disposition).toBe('dispatched');
    expect(result.actionKey).toBe(ACTION);
    expect(fakeGh.dispatchCalls).toBe(1);
    expect(fakeGh.dispatchBodies).toEqual([{
      event_type: 'sec-produce-verification-action-v2',
      client_payload: { payload: envelope }
    }]);
    expect(Object.keys((fakeGh.dispatchBodies[0] as {
      client_payload: Record<string, unknown>;
    }).client_payload)).toEqual(['payload']);
    expect(fakeGh.createCalls).toBe(0);
  });

  test('coordinate-parent rejects another run, actor, or parent artifact without POST', async () => {
    const forgeries: Array<() => void> = [
      () => { process.env.GITHUB_RUN_ID = CURRENT_RUN_ID; },
      () => { process.env.GITHUB_ACTOR = bot.login; },
      () => { fakeGh.artifacts[0] = Object.freeze({ ...fakeGh.artifacts[0]!, source: '{}\n' }); }
    ];
    for (const forge of forgeries) {
      fakeGh = new FakeGh();
      trustedParentEnvironment();
      forge();
      await expect(ensureTransaction({
        origin: parentCoordinateOrigin,
        authority: { envelope, actionPlanClosure: closure },
        intent: { kind: 'coordinate-parent' }
      })).rejects.toThrow();
      expect(fakeGh.createCalls).toBe(0);
    }
  }, 30_000);

  test('complete status and artifact inventories remain fully paginated', async () => {
    fakeGh = new FakeGh();
    fakeGh.statuses = Array.from({ length: 101 }, (_, index) => rawStatus({
      id: index + 1,
      context: index === 100 ? CONTEXT : `diagnostic/${index}`
    }));
    for (let index = 0; index < 101; index += 1) {
      fakeGh.artifacts.push({
        id: 8000 + index,
        name: `unrelated-${index}`,
        expired: false,
        runId: Number(CURRENT_RUN_ID),
        fileName: 'unrelated.json',
        source: '{}'
      });
    }
    const result = await ensureTransaction({
      origin: coordinateOrigin,
      authority: authority(),
      intent: { kind: 'coordinate' }
    });
    expect(result.disposition).toBe('observed');
    expect(fakeGh.statusListCalls).toContainEqual({ page: 2, perPage: 100 });
    expect(fakeGh.artifactListCalls).toContainEqual({ page: 2, perPage: 100 });
  });

  test('artifact inventory freezes total and leading boundary before dispatch', async () => {
    const fillInventory = (target: FakeGh, count: number): void => {
      for (let index = target.artifacts.length; index < count; index += 1) {
        target.artifacts.push({
          id: 8000 + index,
          name: `unrelated-${index}`,
          expired: false,
          runId: Number(CURRENT_RUN_ID),
          fileName: 'unrelated.json',
          source: '{}'
        });
      }
    };

    fakeGh = new FakeGh();
    fillInventory(fakeGh, 101);
    trustedParentEnvironment();
    const stable = await ensureTransaction({
      origin: parentCoordinateOrigin,
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'dispatch-child' }
    });
    expect(stable.disposition).toBe('dispatched');
    expect(fakeGh.artifactListCalls.filter((call) => call.page === 1).length).toBe(4);
    expect(fakeGh.artifactListCalls.filter((call) => call.page === 2).length).toBe(2);
    expect(fakeGh.dispatchCalls).toBe(1);

    fakeGh = new FakeGh();
    fillInventory(fakeGh, 101);
    fakeGh.artifactPageHook = (page, call) => page === 2 && call === 2
      ? { totalCount: 102 }
      : null;
    trustedParentEnvironment();
    await expect(ensureTransaction({
      origin: parentCoordinateOrigin,
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'dispatch-child' }
    })).rejects.toThrow(/artifact inventory page 2 is incomplete or malformed/i);
    expect(fakeGh.dispatchCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    fillInventory(fakeGh, 101);
    const secondStart: ArtifactFixture = Object.freeze({
      id: 9900,
      name: verificationActionProviderStartArtifactName(ACTION),
      expired: false,
      runId: Number(CURRENT_RUN_ID),
      fileName: 'verification-action-start-marker.json',
      source: JSON.stringify(marker)
    });
    const changedLeadingBoundary = Object.freeze([
      secondStart,
      ...fakeGh.artifacts.slice(0, 100)
    ]);
    fakeGh.artifactPageHook = (page, call) => page === 1 && call === 3
      ? { artifacts: changedLeadingBoundary, totalCount: 101 }
      : null;
    trustedParentEnvironment();
    await expect(ensureTransaction({
      origin: parentCoordinateOrigin,
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'dispatch-child' }
    })).rejects.toThrow(/artifact inventory total or leading boundary changed/i);
    expect(fakeGh.dispatchCalls).toBe(0);

    fakeGh = new FakeGh();
    fakeGh.artifacts.push(Object.freeze({ ...fakeGh.artifacts[0]!, name: 'duplicate-id' }));
    await expect(ensureTransaction({
      origin: coordinateOrigin,
      authority: authority(),
      intent: { kind: 'coordinate' }
    })).rejects.toThrow(/repeats one provider artifact id/i);
    expect(fakeGh.createCalls).toBe(0);
    expect(fakeGh.dispatchCalls).toBe(0);
  });

  test('artifact inventory preserves opaque unrelated names but rejects malformed provider families', async () => {
    fakeGh = new FakeGh().withMarker();
    for (let index = 0; index < 98; index += 1) {
      fakeGh.artifacts.push({ id: 8000 + index, name: `diagnostic_report_${index}`,
        expired: false, runId: Number(CURRENT_RUN_ID), fileName: 'unrelated.json', source: '{}' });
    }
    const unrelatedIds = [8200, 8201];
    fakeGh.artifacts.push(
      { id: unrelatedIds[0]!, name: 'coverage_report', expired: false,
        runId: Number(CURRENT_RUN_ID), fileName: 'coverage.json', source: '{}' },
      { id: unrelatedIds[1]!, name: 'coverage_report', expired: true,
        runId: Number(CURRENT_RUN_ID), fileName: 'coverage.json', source: '{}' }
    );
    const otherActionKey = `sha256:${'b'.repeat(64)}` as VerificationActionKeyDigest;
    const otherOwnedIds = [8210, 8211, 8212];
    fakeGh.artifacts.push(
      { id: otherOwnedIds[0]!, name: verificationActionProviderStartArtifactName(otherActionKey),
        expired: false, runId: Number(CURRENT_RUN_ID), fileName: 'other.json', source: '{}' },
      { id: otherOwnedIds[1]!, name: verificationActionProviderTerminalArtifactName(otherActionKey),
        expired: false, runId: Number(CURRENT_RUN_ID), fileName: 'other.json', source: '{}' },
      { id: otherOwnedIds[2]!, name: verificationActionProviderTerminalAnchorName(otherActionKey),
        expired: false, runId: Number(CURRENT_RUN_ID), fileName: 'other.json', source: '{}' }
    );
    const result = await ensureTransaction({ origin: claimOrigin, authority: authority(), intent: { kind: 'claim-start', marker } });
    expect(result.disposition).toBe('started');
    expect(fakeGh.createCalls).toBe(1);
    expect(fakeGh.artifactListCalls).toContainEqual({ page: 2, perPage: 100 });
    expect(fakeGh.downloadedArtifactIds).toContain(7001);
    for (const ignoredId of [...unrelatedIds, ...otherOwnedIds]) {
      expect(fakeGh.downloadedArtifactIds).not.toContain(ignoredId);
    }

    const prefixes = [VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX,
      VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX,
      VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX];
    const malformedSuffixes = (prefix: string) => [
      prefix,
      `${prefix}_${'a'.repeat(64)}`,
      `${prefix}-${'g'.repeat(64)}`,
      `${prefix}-${'A'.repeat(64)}`,
      `${prefix}-${'a'.repeat(63)}`,
      `${prefix}-${'a'.repeat(65)}`,
      `${prefix}-${'a'.repeat(64)}-appended`
    ];
    let malformedId = 8300;
    for (const [index, name] of prefixes.flatMap(malformedSuffixes).entries()) {
      fakeGh = new FakeGh().withMarker();
      fakeGh.artifacts.push({ id: malformedId, name, expired: index === prefixes.length * 7 - 1,
        runId: Number(CURRENT_RUN_ID), fileName: 'malformed.json', source: '{}' });
      malformedId += 1;
      await expect(ensureTransaction({ origin: claimOrigin, authority: authority(), intent: { kind: 'claim-start', marker } }))
        .rejects.toThrow(/provider-family name is malformed/i);
      expect(fakeGh.createCalls).toBe(0);
    }
  });

  test('status history requires unique complete identities and a stable leading boundary', async () => {
    fakeGh = new FakeGh();
    fakeGh.statuses = Array.from({ length: 101 }, (_, index) => rawStatus({
      id: 1000 - index,
      context: `diagnostic/stable-${index}`
    }));
    const stable = await ensureTransaction({ origin: coordinateOrigin, authority: authority(), intent: { kind: 'coordinate' } });
    expect(stable.disposition).toBe('observed');
    expect(fakeGh.createCalls).toBe(0);
    expect(fakeGh.statusListCalls.filter((call) => call.page === 1).length).toBe(2);
    expect(fakeGh.statusListCalls).toContainEqual({ page: 2, perPage: 100 });

    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [
      rawStatus({ id: 77, context: 'diagnostic/one' }),
      { ...rawStatus({ id: 77, context: 'diagnostic/two' }), node_id: 'STATUS_77_DUPLICATE' }
    ];
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/duplicate status identity/i);
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [
      rawStatus({ id: 78, context: 'diagnostic/node-one' }),
      { ...rawStatus({ id: 79, context: 'diagnostic/node-two' }), node_id: 'STATUS_78' }
    ];
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/duplicate status identity/i);
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    const repeatedPage = Array.from({ length: 100 }, (_, index) => rawStatus({
      id: 500 - index,
      context: `diagnostic/drift-${index}`
    }));
    fakeGh.statuses = [...repeatedPage, rawStatus({ id: 399 })];
    fakeGh.statusPageHook = (page) => page === 2 ? repeatedPage : null;
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/duplicate status identity/i);
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    fakeGh.statusPageHook = (page, call) => page === 1 && call === 2
      ? [rawStatus({ id: 88 })]
      : [];
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/leading boundary changed/i);
    expect(fakeGh.createCalls).toBe(0);
  }, 30_000);

  test('unrelated canonical null status fields do not block provider status publication', async () => {
    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [{
      ...rawStatus({ id: 98, context: 'third-party/check' }),
      description: null,
      target_url: null
    }];
    const result = await ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } });
    expect(result.disposition).toBe('started');
    expect(fakeGh.createCalls).toBe(1);
  });

  test('provider-owned status with canonical null fields remains malformed before POST', async () => {
    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [{
      ...rawStatus({ id: 99 }),
      description: null,
      target_url: null
    }];
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow();
    expect(fakeGh.createCalls).toBe(0);
  });

  test('existing exact status is joined and unknown POST outcome is never retried', async () => {
    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [rawStatus({ id: 101 })];
    const existing = await ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } });
    expect(existing.disposition).toBe('complete');
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    fakeGh.failStatusPost = true;
    const ambiguous = await ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } });
    expect(ambiguous.disposition).toBe('blocked');
    expect(fakeGh.createCalls).toBe(1);
  });

  test('forged environment, workflow/base/attempt, bot, and App all fail before POST', async () => {
    const cases: Array<() => void> = [
      () => { process.env.GITHUB_WORKFLOW_REF = `${REPOSITORY}/wrong.yml@refs/heads/main`; },
      () => { fakeGh.currentRunOverrides = { head_sha: '9'.repeat(40) }; },
      () => { fakeGh.currentRunOverrides = { run_attempt: 2 }; },
      () => { fakeGh.currentRunOverrides = { path: '.github/workflows/foreign.yml' }; },
      () => { fakeGh.currentRunOverrides = { display_title: 'foreign Action' }; },
      () => { fakeGh.currentRunOverrides = { actor: { ...botRecord, id: 1 } }; },
      () => { fakeGh.currentSuiteOverrides = { app: { id: 1, node_id: 'forged', slug: 'github-actions' } }; }
    ];
    for (const forge of cases) {
      fakeGh = new FakeGh().withMarker();
      trustedEnvironment();
      forge();
      await expect(ensureTransaction({ origin: claimOrigin, authority: { envelope, actionPlanClosure: closure },
        intent: { kind: 'claim-start', marker } })).rejects.toThrow();
      expect(fakeGh.createCalls).toBe(0);
    }
  }, 30_000);

  test('artifact provenance rehydrates the immutable producing attempt instead of the latest rerun', async () => {
    const historicalOrigin = Object.freeze({ ...currentOrigin, runId: '9200', runAttempt: 1 });
    const stableMarker = createVerificationActionProviderStartMarker({
      actionKey: ACTION,
      candidateSha: HEAD,
      executionEnvironmentRevision: 'hosted',
      producer: historicalOrigin
    });
    const assemblerOrigin = Object.freeze({ ...historicalOrigin, runId: '9201' });
    const stableAnchor = createVerificationActionProviderTerminalAnchor({
      actionKey: ACTION,
      candidateSha: HEAD,
      startStatusId: 101,
      startStatusNodeId: 'STATUS_101',
      startArtifactOriginId: '7001',
      startArtifactName: verificationActionProviderStartArtifactName(ACTION),
      startArtifactArchiveDigest: archiveDigestFor('verification-action-start-marker.json', JSON.stringify(stableMarker)),
      startMarkerDigest: stableMarker.markerDigest,
      terminalArtifactOriginId: '7002',
      terminalArtifactName: verificationActionProviderTerminalArtifactName(ACTION),
      terminalArtifactArchiveDigest: archiveDigestFor('verification-action-terminal-artifact.json', '{}'),
      terminalArtifactPayloadDigest: TERMINAL_PAYLOAD_DIGEST,
      terminalAssemblerOrigin: assemblerOrigin,
      anchorPublisherOrigin: historicalOrigin
    });
    fakeGh = new FakeGh().withMarker(stableMarker, 9200);
    fakeGh.latestRunAttempts['9200'] = 2;
    fakeGh.statuses = [rawStatus({ id: 101,
      description: verificationActionProviderStartDescription(stableMarker.markerDigest),
      targetUrl: verificationActionProviderRunTargetUrl(historicalOrigin) })];
    fakeGh.artifacts.push({ id: 7003, name: verificationActionProviderTerminalAnchorName(ACTION),
      expired: false, runId: 9200, fileName: 'verification-action-terminal-status-anchor.json',
      source: JSON.stringify(stableAnchor) });
    const observed = await ensureTransaction({ origin: coordinateOrigin, authority: authority(), intent: { kind: 'coordinate' } });
    expect(observed.disposition).toBe('observed');
    expect(observed.snapshot.startObservations[0]?.referencedOrigin).toEqual(historicalOrigin);
    expect(observed.snapshot.terminalAnchorObservations[0]?.referencedOrigin).toEqual(historicalOrigin);
    expect(fakeGh.exactAttemptCalls.filter((entry) => entry.runId === '9200'))
      .toEqual([{ runId: '9200', runAttempt: 1 }, { runId: '9200', runAttempt: 1 },
        { runId: '9200', runAttempt: 1 }]);
    expect(fakeGh.latestRunCalls).not.toContain('9200');
    expect(fakeGh.exactAttemptCalls.some((entry) => entry.runId === assemblerOrigin.runId)).toBe(false);
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh();
    fakeGh.artifacts.push({ id: 7010, name: verificationActionProviderStartArtifactName(ACTION),
      expired: true, runId: 9300, fileName: 'verification-action-start-marker.json', source: 'not-json' });
    const expired = await ensureTransaction({ origin: coordinateOrigin, authority: authority(), intent: { kind: 'coordinate' } });
    expect(expired.snapshot.startObservations[0]).toMatchObject({
      expired: true, payload: null, referencedOrigin: null, archiveDigest: null
    });
    expect(fakeGh.exactAttemptCalls.some((entry) => entry.runId === '9300')).toBe(false);
    expect(fakeGh.downloadedArtifactIds).not.toContain(7010);

    fakeGh = new FakeGh().withMarker(stableMarker, 9300);
    await expect(ensureTransaction({ origin: coordinateOrigin, authority: authority(), intent: { kind: 'coordinate' } }))
      .rejects.toThrow(/payload producing origin differs.*metadata identity/i);
    expect(fakeGh.createCalls).toBe(0);

    const malformedAttemptMarker = { ...stableMarker,
      producer: { ...stableMarker.producer, runAttempt: 0 } } as typeof marker;
    fakeGh = new FakeGh().withMarker(malformedAttemptMarker, 9200);
    await expect(ensureTransaction({ origin: coordinateOrigin, authority: authority(), intent: { kind: 'coordinate' } }))
      .rejects.toThrow();
    expect(fakeGh.exactAttemptCalls.some((entry) => entry.runId === '9200')).toBe(false);
    expect(fakeGh.createCalls).toBe(0);

    const exactAttemptForgeries: Array<(transport: FakeGh) => void> = [
      (transport) => { transport.exactRunFailures.add('9200:1'); },
      (transport) => { transport.exactRunOverrides['9200:1'] = { id: 9999 }; },
      (transport) => { transport.exactRunOverrides['9200:1'] = { run_attempt: 2 }; },
      (transport) => { transport.exactRunOverrides['9200:1'] = {
        repository: { id: REPOSITORY_ID, full_name: 'attacker/fork' } }; },
      (transport) => { transport.exactRunOverrides['9200:1'] = { path: '.github/workflows/other.yml' }; },
      (transport) => { transport.exactRunOverrides['9200:1'] = { head_sha: '9'.repeat(40) }; },
      (transport) => { transport.exactRunOverrides['9200:1'] = { event: 'push' }; },
      (transport) => { transport.exactRunOverrides['9200:1'] = { check_suite_id: 0 }; },
      (transport) => { transport.exactSuiteOverrides['5003'] = { id: 1 }; },
      (transport) => { transport.exactSuiteOverrides['5003'] = {
        app: { id: 1, node_id: 'forged', slug: 'github-actions' } }; }
    ];
    for (const forge of exactAttemptForgeries) {
      fakeGh = new FakeGh().withMarker(stableMarker, 9200);
      forge(fakeGh);
      await expect(ensureTransaction({ origin: coordinateOrigin, authority: authority(), intent: { kind: 'coordinate' } }))
        .rejects.toThrow();
      expect(fakeGh.createCalls).toBe(0);
    }
  }, 30_000);

  test('substituted parent artifact, closure, and non-member envelope fail before POST', async () => {
    fakeGh = new FakeGh().withMarker();
    fakeGh.artifacts[0] = Object.freeze({ ...fakeGh.artifacts[0]!, source: '{}\n' });
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow();
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    const substitutedClosure = { ...closure, actionPlanDigest: digest('8') } as CiVerificationActionPlanClosure;
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(envelope, substitutedClosure),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow();
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    const forgedEnvelope = {
      ...envelope,
      proposal: { ...envelope.proposal, proposedActionKey: digest('7') }
    } as CiVerificationActionProviderEnvelope;
    await expect(ensureTransaction({ origin: claimOrigin, authority: authority(forgedEnvelope),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow();
    expect(fakeGh.createCalls).toBe(0);
  });

  test('marker publisher must be the exact authenticated current run', async () => {
    const forgedMarker = createVerificationActionProviderStartMarker({
      actionKey: ACTION,
      candidateSha: HEAD,
      executionEnvironmentRevision: 'hosted',
      producer: { ...currentOrigin, runId: '9999' }
    });
    fakeGh = new FakeGh().withMarker(forgedMarker, 9999);
    const result = await ensureTransaction({ origin: claimOrigin, authority: authority(),
      intent: { kind: 'claim-start', marker: forgedMarker } });
    expect(result.disposition).toBe('blocked');
    expect(fakeGh.createCalls).toBe(0);
  });

  const actionSlots = [
    { name: 'start', artifactId: 7001, jobIndex: 0, producerIndex: 0, uploadIndex: 1, observations: 'startObservations' },
    { name: 'terminal', artifactId: 7002, jobIndex: 1, producerIndex: 0, uploadIndex: 1, observations: 'terminalObservations' },
    { name: 'anchor', artifactId: 7003, jobIndex: 1, producerIndex: 2, uploadIndex: 3, observations: 'terminalAnchorObservations' }
  ] as const;
  const isolatedSlot = (slot: typeof actionSlots[number]): Record<string, unknown> => {
    fakeGh = new FakeGh();
    withTerminalChain(fakeGh);
    fakeGh.artifacts = fakeGh.artifacts.filter(artifact => artifact.id === PARENT_ARTIFACT_ID || artifact.id === slot.artifactId);
    fakeGh.statuses = [];
    const jobs = actionJobFixtures(Number(CURRENT_RUN_ID));
    fakeGh.actionJobsByAttempt[`${CURRENT_RUN_ID}:1`] = jobs;
    return jobs[slot.jobIndex]!;
  };

  for (const slot of actionSlots) {
    test(`${slot.name} artifact retains its successful upload after later publisher failure or cancellation`, async () => {
      for (const conclusion of [null, 'success', 'failure', 'cancelled', 'timed_out']) {
        const job = isolatedSlot(slot);
        expect(Object.hasOwn(job, 'run_attempt')).toBe(false);
        if (conclusion === 'success') job.run_attempt = 1;
        if (conclusion === null) { job.status = 'in_progress'; job.completed_at = null; }
        job.conclusion = conclusion;
        // The uploaded data remains useful even when the later job settlement
        // occurs after its original execution budget. This grants no dispatch.
        if (conclusion === 'timed_out') job.completed_at = '2026-08-10T01:00:00Z';
        const steps = job.steps as Record<string, unknown>[];
        steps[steps.length - 1] = { ...steps[steps.length - 1]!, status: conclusion === null ? 'in_progress' : 'completed', conclusion,
          completed_at: job.completed_at };
        const observed = await ensureTransaction({ origin: coordinateOrigin, authority: authority(), intent: { kind: 'coordinate' } });
        expect(observed.snapshot[slot.observations]).toHaveLength(1);
        expect(observed.snapshot[slot.observations][0]).toMatchObject({ expired: false, referencedOrigin: currentOrigin });
        expect(observed.snapshot[slot.observations][0]!.payload).not.toBeNull();
        expect(fakeGh.workflowSourceCalls).toEqual([
          { path: '.github/workflows/compiler-pr-validation.yml', ref: BASE },
          { path: '.github/workflows/compiler-pr-validation.yml', ref: BASE }
        ]);
        expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
      }
    });

    test(`${slot.name} artifact cannot borrow a different slot, attempt or producer with correct bytes`, async () => {
      const forgeries: Array<(job: Record<string, unknown>) => void> = [
        job => { job.name = 'coordinate-verification-session'; },
        job => { job.head_sha = HEAD; },
        job => { job.run_id = Number(PARENT_RUN_ID); },
        job => { job.run_attempt = 2; }, job => { job.run_attempt = null; },
        job => { job.conclusion = 'skipped'; },
        job => { (job.steps as Record<string, unknown>[])[slot.producerIndex]!.conclusion = 'failure'; },
        job => { (job.steps as Record<string, unknown>[])[slot.uploadIndex]!.conclusion = 'skipped'; },
        job => { (job.steps as Record<string, unknown>[])[slot.uploadIndex]!.name = 'Upload a different slot'; },
        job => { const steps = job.steps as Record<string, unknown>[];
          steps[slot.uploadIndex]!.number = Number(steps[slot.producerIndex]!.number) - 1; },
        job => { const steps = job.steps as Record<string, unknown>[];
          steps.push({ ...steps[slot.producerIndex]!, number: 20 }); },
        job => { fakeGh.actionJobsByAttempt[`${CURRENT_RUN_ID}:1`]!.push({ ...job }); },
        job => { fakeGh.actionJobsByAttempt[`${CURRENT_RUN_ID}:1`]!.push({ ...job, id: Number(job.id) + 10 }); },
        job => { job.completed_at = '2026-08-09T01:00:00Z'; }
      ];
      for (const forge of forgeries) {
        const job = isolatedSlot(slot);
        const originalBytes = fakeGh.artifacts.find(artifact => artifact.id === slot.artifactId)!.source;
        forge(job);
        await expect(ensureTransaction({ origin: claimOrigin, authority: authority(), intent: { kind: 'claim-start', marker } }))
          .rejects.toThrow(/(?:Action artifact|parent workflow job)/);
        expect(fakeGh.artifacts.find(artifact => artifact.id === slot.artifactId)!.source).toBe(originalBytes);
        expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
      }
    }, 30_000);

    test(`${slot.name} artifact requires its actual complete upload interval inside the source job budget`, async () => {
      const forgeries: Array<(job: Record<string, unknown>) => void> = [
        job => { job.started_at = undefined; },
        job => { (job.steps as Record<string, unknown>[])[slot.producerIndex]!.started_at = null; },
        job => { (job.steps as Record<string, unknown>[])[slot.uploadIndex]!.completed_at = null; },
        job => { (job.steps as Record<string, unknown>[])[slot.uploadIndex]!.started_at = '2026-08-09T00:59:59Z'; },
        job => { const upload = (job.steps as Record<string, unknown>[])[slot.uploadIndex]!;
          upload.started_at = '2026-08-10T01:00:03Z'; upload.completed_at = '2026-08-10T01:00:05Z';
          job.completed_at = '2026-08-10T01:00:12Z';
          fakeGh.artifactMetadataOverrides[String(slot.artifactId)] = {
            created_at: '2026-08-10T01:00:03Z', updated_at: '2026-08-10T01:00:05Z' }; },
        ...[{ created_at: undefined }, { updated_at: 'invalid' },
          { created_at: '2026-08-09T01:00:00Z' }, { updated_at: '2026-08-10T01:00:00Z' },
          { updated_at: '2026-08-09T01:00:00Z' },
          { workflow_run: { id: Number(CURRENT_RUN_ID), head_sha: HEAD } }].map(patch =>
          (_job: Record<string, unknown>) => { fakeGh.artifactMetadataOverrides[String(slot.artifactId)] = patch; })
      ];
      for (const forge of forgeries) {
        const job = isolatedSlot(slot);
        forge(job);
        await expect(ensureTransaction({ origin: claimOrigin, authority: authority(), intent: { kind: 'claim-start', marker } }))
          .rejects.toThrow(/Action artifact/);
        expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
      }
    }, 30_000);
  }

  test('parent and Action upload attribution reject an extra executable workflow writer before POST', async () => {
    const extraWriter = `${CANONICAL_WORKFLOW_SOURCE}\n  extra-writer:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo unexpected\n`;
    for (const changedRead of [1, 2]) {
      fakeGh = new FakeGh().withMarker();
      fakeGh.workflowSourceHook = call => call === changedRead ? extraWriter : null;
      await expect(ensureTransaction({ origin: claimOrigin, authority: authority(), intent: { kind: 'claim-start', marker } }))
        .rejects.toThrow(/Hosted workflow shape: complete job census differs/);
      expect(fakeGh.workflowSourceCalls).toHaveLength(changedRead);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  });

  const resolutionFixture = () => {
    fakeGh = new FakeGh();
    const anchor = withTerminalChain(fakeGh);
    const members = resolutionMembersFixture();
    const artifact: ArtifactFixture = { id: 7004,
      name: provider.hostedActionResolutionArtifactName(ACTION, CURRENT_RUN_ID, 1), expired: false,
      runId: Number(CURRENT_RUN_ID), fileName: 'hosted-action-resolution.json',
      source: members['hosted-action-resolution.json']!, members };
    fakeGh.artifacts.push(artifact);
    const jobs = actionJobFixtures(Number(CURRENT_RUN_ID));
    fakeGh.actionJobsByAttempt[`${CURRENT_RUN_ID}:1`] = jobs;
    const job = jobs.find(entry => entry.name === 'resolve-verification-action')!;
    const completedAction = { providerEnvelope: envelope, runId: CURRENT_RUN_ID, runAttempt: 1,
      terminalArtifactId: '7002', terminalArtifactName: anchor.terminalArtifactName,
      terminalArchiveDigest: anchor.terminalArtifactArchiveDigest,
      terminalPayloadDigest: anchor.terminalArtifactPayloadDigest };
    trustedEnvironment();
    return { artifact, job, members, completedAction };
  };

  test('public resume resolution reader binds one real three-member archive to its original successful resolver', async () => {
    for (const explicitAttempt of [false, true]) {
      const value = resolutionFixture();
      expect(Object.hasOwn(value.job, 'run_attempt')).toBe(false);
      if (explicitAttempt) value.job.run_attempt = 1;
      const observed = await provider.readHostedResumeResolutionTransport({ origin: resumeOrigin,
        completedAction: value.completedAction });
      expect(observed.files).toEqual(value.members);
      expect(observed.producingJobId).toBe(String(value.job.id));
      expect(observed.producingOrigin).toEqual(currentOrigin);
      expect(observed.archiveDigest).toBe(`sha256:${rawSha256Hex(fixtureArchive(value.artifact))}`);
      expect(CodexDevelopmentParseHostedActionResolution(observed.files['hosted-action-resolution.json']).actionKeyHex)
        .toBe(ACTION.slice(7));
      expect(parseHostedEnvelope(JSON.parse(observed.files['hosted-envelope.json'])).actionPlanClosure.actionPlanDigest)
        .toBe(closure.actionPlanDigest);
      expect(fakeGh.downloadedArtifactIds).toEqual([7002, 7004]);
      expect(fakeGh.jobListCalls.every(call => call.runId === CURRENT_RUN_ID && call.runAttempt === 1)).toBe(true);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  });

  test('resolution keeps completed-success job admission despite later-failure recovery of other Action slots', async () => {
    for (const patch of [{ status: 'in_progress', conclusion: null, completed_at: null },
      { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'timed_out' }]) {
      const value = resolutionFixture();
      Object.assign(value.job, patch);
      await expect(provider.readHostedResumeResolutionTransport({ origin: resumeOrigin,
        completedAction: value.completedAction })).rejects.toThrow('resolution producing job is not the exact completed successful producer');
      expect(fakeGh.downloadedArtifactIds).not.toContain(7004);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  });

  test('resolution source, exact attempt, unique producer and upload window are mandatory before archive capture', async () => {
    const forgeries: Array<(value: ReturnType<typeof resolutionFixture>) => void> = [
      value => { value.job.run_attempt = null; }, value => { value.job.run_attempt = 2; },
      value => { value.job.run_attempt = '1'; },
      value => { value.job.head_sha = HEAD; }, value => { value.job.name = 'claim-verification-action'; },
      value => { fakeGh.actionJobsByAttempt[`${CURRENT_RUN_ID}:1`]!.push({ ...value.job }); },
      value => { fakeGh.actionJobsByAttempt[`${CURRENT_RUN_ID}:1`]!.push({ ...value.job, id: 9999 }); },
      value => { value.job.steps = []; },
      value => { const steps = value.job.steps as Record<string, unknown>[]; steps.push({ ...steps[0]!, number: 8 }); },
      value => { (value.job.steps as Record<string, unknown>[])[0]!.conclusion = 'failure'; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.number = 4; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.conclusion = 'skipped'; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.started_at = null; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.completed_at = '2026-08-10T01:00:00Z';
        value.job.completed_at = '2026-08-10T01:00:01Z';
        fakeGh.artifactMetadataOverrides['7004'] = { updated_at: '2026-08-10T01:00:00Z' }; },
      ...[{ created_at: undefined }, { updated_at: undefined }, { created_at: '2026-08-09T00:59:02Z' },
        { updated_at: '2026-08-09T00:59:06Z' }, { updated_at: '2026-08-09T00:59:02Z' }].map(patch =>
        (_value: ReturnType<typeof resolutionFixture>) => { fakeGh.artifactMetadataOverrides['7004'] = patch; }),
      _value => { fakeGh.workflowSourceHook = call => call === 2
        ? `${CANONICAL_WORKFLOW_SOURCE}\n  extra-resolution-writer:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo unexpected\n` : null; }
    ];
    for (const forge of forgeries) {
      const value = resolutionFixture();
      const originalBytes = fixtureArchive(value.artifact);
      forge(value);
      await expect(provider.readHostedResumeResolutionTransport({ origin: resumeOrigin,
        completedAction: value.completedAction })).rejects.toThrow();
      expect(fixtureArchive(value.artifact)).toEqual(originalBytes);
      expect(fakeGh.downloadedArtifactIds).not.toContain(7004);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('resolution capture retains exact terminal identity and the finite three-member archive', async () => {
    for (const mode of ['missing', 'extra', 'digest', 'terminal'] as const) {
      const value = resolutionFixture();
      if (mode === 'missing' || mode === 'extra') {
        const members: Record<string, string> = { ...value.members };
        if (mode === 'missing') delete members['hosted-envelope.json'];
        else members['unrequested.json'] = '{}\n';
        fakeGh.artifacts[fakeGh.artifacts.length - 1] = { ...value.artifact, members };
      } else if (mode === 'digest') {
        fakeGh.artifactMetadataOverrides['7004'] = { digest: digest('f') };
      } else value.completedAction.terminalArchiveDigest = digest('f');
      await expect(provider.readHostedResumeResolutionTransport({ origin: resumeOrigin,
        completedAction: value.completedAction })).rejects.toThrow();
      if (mode === 'terminal') expect(fakeGh.downloadedArtifactIds).not.toContain(7004);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
    const value = resolutionFixture();
    await expect(provider.readHostedResumeResolutionTransport({ origin: {} as AuthenticatedGitHubJobOrigin,
      completedAction: value.completedAction })).rejects.toThrow(AuthenticatedGitHubJobOriginUnavailableError);
    expect(fakeGh.downloadedArtifactIds).toEqual([]);
    expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
  });


  test('delegated source reads original canonical data and binds only its exact selector and live origin', async () => {
    for (const explicitAttempt of [false, true]) {
      const value = delegatedSessionFixture();
      expect(Object.hasOwn(value.job, 'run_attempt')).toBe(false);
      if (explicitAttempt) value.job.run_attempt = 1;
      const observed = await provider.authenticateHistoricalHostedSessionTerminalSource(value);
      expect(observed.authenticatedArtifact).toEqual(value.artifact);
      expect(observed.authenticatedArtifact).not.toBe(value.artifact);
      expect(observed.authenticatedArtifact.evidence.status).toBe('unsupported');
      expect(observed.artifactByteDigest).toBe(`sha256:${rawSha256Hex(Buffer.from(value.artifactText))}`);
      expect(observed.archiveDigest).toBe(archiveDigestFor('verification-session-artifact.json', value.artifactText));
      expect(observed.originalRequest.expectedSessionRevision).toBe(value.artifact.session.sessionRevision);
      expect(observed.parentActor).toEqual(parentActor);
      expect(fakeGh.jobListCalls.some(call => call.runId === DELEGATED_RUN_ID && call.runAttempt === 1)).toBe(true);
      const before = fakeGh.downloadedArtifactIds.length;
      const current = await provider.assertHistoricalHostedSessionTerminalSourceCurrent(value);
      expect(current.authenticatedArtifact).toEqual(observed.authenticatedArtifact);
      expect(fakeGh.downloadedArtifactIds.length).toBeGreaterThan(before);
      await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent({ origin: value.origin,
        artifact: parseHostedSessionTerminalArtifact(value.artifactText) })).rejects.toThrow('unqualified');
      await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent({ origin: resumeOrigin,
        artifact: value.artifact })).rejects.toThrow('unqualified');
      await expect(provider.authenticateHistoricalHostedSessionTerminalSource(value)).rejects.toThrow('already has');
      provider.closeHistoricalHostedSessionTerminalSource(value);
      await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent(value)).rejects.toThrow('unqualified');
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('local delegated source observation performs the full read and never qualifies the selector', async () => {
    const value = delegatedSessionFixture();
    const observed = await provider.observeHistoricalHostedSessionTerminalSourceForLocalRead({
      repositoryRoot: process.cwd(), repository: REPOSITORY, artifactId: value.artifactId,
      artifactName: value.artifactName, artifactDigest: value.artifact.artifactDigest as VerificationActionKeyDigest,
      archiveDigest: archiveDigestFor('verification-session-artifact.json', value.artifactText) });
    expect(observed.authenticatedArtifact).toEqual(value.artifact);
    expect(observed.artifactDigest).toBe(value.artifact.artifactDigest);
    expect(observed.archiveDigest).toBe(archiveDigestFor('verification-session-artifact.json', value.artifactText));
    expect(fakeGh.downloadedArtifactIds.filter(id => id === DELEGATED_ARTIFACT_ID)).toHaveLength(2);
    await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent(value)).rejects.toThrow('unqualified');
    expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
  });

  for (const field of ['artifactDigest', 'archiveDigest'] as const) {
    for (const malformed of [true, false]) {
      test(`local delegated source rejects ${field} with ${malformed ? 'malformed encoding' : 'a different canonical digest'}`, async () => {
        const value = delegatedSessionFixture();
        const original = { artifactDigest: value.artifact.artifactDigest as VerificationActionKeyDigest,
          archiveDigest: archiveDigestFor('verification-session-artifact.json', value.artifactText) };
        const wrong = malformed ? 'sha256:not-a-canonical-digest' as const : digest('0');
        expect(wrong).not.toBe(original[field]);
        const locator = { repositoryRoot: process.cwd(), repository: REPOSITORY,
          artifactId: value.artifactId, artifactName: value.artifactName, ...original, [field]: wrong };
        await expect(provider.observeHistoricalHostedSessionTerminalSourceForLocalRead(locator)).rejects.toThrow(
          malformed ? 'Digest does not match' : field === 'archiveDigest'
            ? 'does not bind its exact sole archive bytes' : 'differs from its canonical parsed source');
        expect(fakeGh.downloadedArtifactIds).toEqual(malformed ? [] : [DELEGATED_ARTIFACT_ID]);
        expect(fakeGh.jobListCalls).toEqual([]);
        await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent(value)).rejects.toThrow('unqualified');
        expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
      });
    }
  }

  test('delegated source requires whole-workflow, exact attempt, unique receiver and successful ordered session upload', async () => {
    const forgeries: Array<(value: ReturnType<typeof delegatedSessionFixture>) => void> = [
      value => { value.job.run_attempt = null; }, value => { value.job.run_attempt = 2; },
      value => { value.job.run_attempt = '1'; }, value => { value.job.run_id = 9401; },
      value => { value.job.head_sha = HEAD; }, value => { value.job.name = 'coordinate-verification-session'; },
      value => { fakeGh.actionJobsByAttempt[`${DELEGATED_RUN_ID}:1`]!.push({ ...value.job }); },
      value => { fakeGh.actionJobsByAttempt[`${DELEGATED_RUN_ID}:1`]!.push({ ...value.job, id: 6401 }); },
      _value => { fakeGh.jobPageHook = (_page, _call, runId) => runId === DELEGATED_RUN_ID ? { totalCount: 2 } : null; },
      value => { value.job.steps = []; },
      value => { const steps = value.job.steps as Record<string, unknown>[]; steps.push({ ...steps[0]!, number: 8 }); },
      value => { const steps = value.job.steps as Record<string, unknown>[]; steps.push({ ...steps[2]!, number: 8 }); },
      value => { (value.job.steps as Record<string, unknown>[])[0]!.conclusion = 'failure'; },
      value => { (value.job.steps as Record<string, unknown>[])[2]!.conclusion = 'skipped'; },
      value => { (value.job.steps as Record<string, unknown>[])[2]!.number = 4; },
      value => { (value.job.steps as Record<string, unknown>[])[2]!.name = 'Upload complete original resume dispatch outcome observations'; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.number = 5; },
      value => { value.job.status = 'in_progress'; value.job.conclusion = null; value.job.completed_at = null; },
      ...['failure', 'cancelled', 'timed_out'].map(conclusion =>
        (value: ReturnType<typeof delegatedSessionFixture>) => { value.job.conclusion = conclusion; }),
      _value => { fakeGh.exactRunOverrides[`${DELEGATED_RUN_ID}:1`]!.conclusion = 'failure'; },
      _value => { fakeGh.workflowSourceHook = call => call === 1
        ? `${CANONICAL_WORKFLOW_SOURCE}\n  extra-session-writer:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo unexpected\n` : null; }
    ];
    for (const forge of forgeries) {
      const value = delegatedSessionFixture();
      const bytes = fixtureArchive(fakeGh.artifacts.find(entry => entry.id === DELEGATED_ARTIFACT_ID)!);
      forge(value);
      await expect(provider.authenticateHistoricalHostedSessionTerminalSource(value)).rejects.toThrow();
      expect(fixtureArchive(fakeGh.artifacts.find(entry => entry.id === DELEGATED_ARTIFACT_ID)!)).toEqual(bytes);
      await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent(value)).rejects.toThrow('unqualified');
      expect(fakeGh.exactAttemptCalls.some(call => call.runId === '9300')).toBe(false);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('delegated archive must remain in its actual session upload interval and original producer budget', async () => {
    const forgeries: Array<(value: ReturnType<typeof delegatedSessionFixture>) => void> = [
      value => { value.job.started_at = undefined; }, value => { value.job.completed_at = '2026-08-09T01:01:09Z'; },
      value => { (value.job.steps as Record<string, unknown>[])[0]!.started_at = null; },
      value => { (value.job.steps as Record<string, unknown>[])[0]!.completed_at = '2026-08-09T01:01:00Z'; },
      value => { (value.job.steps as Record<string, unknown>[])[2]!.started_at = '2026-08-09T01:01:01Z'; },
      value => { (value.job.steps as Record<string, unknown>[])[2]!.completed_at = null; },
      value => { (value.job.steps as Record<string, unknown>[])[2]!.completed_at = '2026-08-09T01:01:05Z'; },
      value => { const upload = (value.job.steps as Record<string, unknown>[])[2]!;
        upload.started_at = '2026-08-10T01:01:06Z'; upload.completed_at = '2026-08-10T01:01:10Z';
        value.job.completed_at = '2026-08-10T01:01:12Z';
        fakeGh.artifactMetadataOverrides[String(DELEGATED_ARTIFACT_ID)] = {
          created_at: upload.started_at, updated_at: upload.completed_at }; },
      ...[{ created_at: undefined }, { updated_at: undefined }, { created_at: 'invalid' },
        { created_at: '2026-08-09T01:01:05Z' }, { updated_at: '2026-08-09T01:01:11Z' },
        { updated_at: '2026-08-09T01:01:05Z' },
        { workflow_run: { id: Number(DELEGATED_RUN_ID), head_sha: HEAD } }].map(patch =>
        (_value: ReturnType<typeof delegatedSessionFixture>) => {
          Object.assign(fakeGh.artifactMetadataOverrides[String(DELEGATED_ARTIFACT_ID)]!, patch);
        })
    ];
    for (const forge of forgeries) {
      const value = delegatedSessionFixture();
      forge(value);
      await expect(provider.authenticateHistoricalHostedSessionTerminalSource(value)).rejects.toThrow();
      await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent(value)).rejects.toThrow('unqualified');
      expect(fakeGh.exactAttemptCalls.some(call => call.runId === '9300')).toBe(false);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('delegated source preserves exact archive, original cause, human readback and lexical origin', async () => {
    for (const mode of ['member', 'missing-member', 'digest', 'cause', 'action', 'emitter', 'parent', 'human', 'permission-drift', 'closed-origin'] as const) {
      const value = delegatedSessionFixture();
      const index = fakeGh.artifacts.findIndex(entry => entry.id === DELEGATED_ARTIFACT_ID);
      if (mode === 'member') fakeGh.artifacts[index] = { ...fakeGh.artifacts[index]!,
        members: { 'verification-session-artifact.json': value.artifactText, 'extra.json': '{}\n' } };
      if (mode === 'missing-member') fakeGh.artifacts[index] = { ...fakeGh.artifacts[index]!,
        members: { 'other.json': value.artifactText } };
      if (mode === 'digest') Object.assign(fakeGh.artifactMetadataOverrides[String(DELEGATED_ARTIFACT_ID)]!, { digest: digest('f') });
      if (mode === 'cause' || mode === 'action' || mode === 'emitter') {
        const raw = JSON.parse(value.artifactText);
        if (mode === 'cause') raw.sourceCause.requestOperationId = digest('0');
        else {
          if (mode === 'emitter') raw.sourceCause.signal.emitter.runId = '9301';
          else {
            raw.sourceCause.signal.completedAction.terminalPayloadDigest = digest('0');
            raw.sourceCause.signal.wakeKey = ciActionDigest({ schema: HOSTED_SESSION_WAKE_KEY_SCHEMA,
              completedAction: raw.sourceCause.signal.completedAction });
          }
          const { signalDigest: _old, ...body } = raw.sourceCause.signal;
          raw.sourceCause.signal.signalDigest = ciActionDigest(body);
        }
        const { artifactDigest: _old, ...body } = raw;
        raw.artifactDigest = ciActionDigest(body);
        const source = `${encodeVerificationActionData(raw)}\n`;
        value.artifact = raw;
        value.artifactText = source;
        fakeGh.artifacts[index] = { ...fakeGh.artifacts[index]!, source };
      }
      if (mode === 'parent') fakeGh.parentRunOverrides.display_title = 'verify session PR #42 session substituted';
      if (mode === 'human') fakeGh.parentPermissionUser.node_id = 'OTHER_HUMAN';
      if (mode === 'permission-drift') fakeGh.permissionHook = call => call >= 3
        ? { permission: 'read', role_name: 'read' } : null;
      if (mode === 'closed-origin') {
        value.origin = closedReceiverOrigin;
        fakeGh.workflowSourceHook = async () => { await closeAuthenticatedGitHubJobOrigin(value.origin); return null; };
      }
      await expect(provider.authenticateHistoricalHostedSessionTerminalSource(value)).rejects.toThrow();
      await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent(value)).rejects.toThrow('unqualified');
      if (mode === 'cause') expect(fakeGh.downloadedArtifactIds).toEqual([]);
      if (mode === 'permission-drift') expect(fakeGh.permissionCalls).toBe(3);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
    const value = delegatedSessionFixture();
    await expect(provider.authenticateHistoricalHostedSessionTerminalSource({ ...value,
      origin: {} as AuthenticatedGitHubJobOrigin })).rejects.toThrow(AuthenticatedGitHubJobOriginUnavailableError);
    expect(fakeGh.downloadedArtifactIds).toEqual([]);
  }, 30_000);

  test('delegated current readback rejects later archive drift and selector mutation', async () => {
    for (const mode of ['window', 'archive', 'selector'] as const) {
      const value = delegatedSessionFixture();
      await provider.authenticateHistoricalHostedSessionTerminalSource(value);
      if (mode === 'window') {
        Object.assign(fakeGh.artifactMetadataOverrides[String(DELEGATED_ARTIFACT_ID)]!, { updated_at: '2026-08-09T01:01:11Z' });
      } else if (mode === 'archive') {
        const index = fakeGh.artifacts.findIndex(entry => entry.id === DELEGATED_ARTIFACT_ID);
        fakeGh.artifacts[index] = { ...fakeGh.artifacts[index]!, source: `${value.artifactText}\n` };
      } else {
        (value.artifact as { artifactDigest: string }).artifactDigest = digest('f');
      }
      await expect(provider.assertHistoricalHostedSessionTerminalSourceCurrent(value)).rejects.toThrow();
      provider.closeHistoricalHostedSessionTerminalSource(value);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);


  test('outcome history preserves original query identities and observes success or failure without granting dispatch', async () => {
    for (const phaseConclusion of ['success', 'failure']) {
      const value = outcomeHistoryFixture();
      (value.job.steps as Record<string, unknown>[])[0]!.conclusion = phaseConclusion;
      value.job.conclusion = phaseConclusion;
      fakeGh.exactRunOverrides[`${DELEGATED_RUN_ID}:1`]!.conclusion = phaseConclusion;
      expect(Object.hasOwn(value.job, 'run_attempt')).toBe(false);
      if (phaseConclusion === 'success') value.job.run_attempt = 1;
      const observed = await provider.observeHostedResumeDispatchOutcomeHistory(value.input);
      expect(observed.disposition).toBe('observed');
      expect(observed.use).toBe('observer-only');
      expect(observed.observations).toHaveLength(1);
      expect(observed.observations[0]!.collection).toEqual(value.collection);
      expect(observed.observations[0]!.collection.sessionRevision).toBe(value.input.sessionRevision);
      expect(observed.observations[0]!.collection.expectedActionKeys).toEqual(value.input.actionKeys);
      expect(observed.observations[0]!.collection.entries[0]!.outcome?.outcome.publicationState).toBe('entered-unknown');
      expect(observed.observations[0]!.archiveDigest).toBe(archiveDigestFor(HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE, value.source));
      expect(parseHostedResumeDispatchOutcomeCollection(value.source, [value.actionKey])).toEqual(value.collection);
      expect(fakeGh.downloadedArtifactIds).toContain(OUTCOME_ARTIFACT_ID);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('missing or expired outcome history cannot establish first or retry dispatch permission', async () => {
    for (const mode of ['absent', 'expired', 'duplicate']) {
      const value = outcomeHistoryFixture();
      const index = fakeGh.artifacts.findIndex(entry => entry.id === OUTCOME_ARTIFACT_ID);
      if (mode === 'absent') fakeGh.artifacts.splice(index, 1);
      if (mode === 'expired') fakeGh.artifacts[index] = { ...value.artifact, expired: true };
      if (mode === 'duplicate') fakeGh.artifacts.push({ ...value.artifact, id: 7016 });
      const observed = await provider.observeHostedResumeDispatchOutcomeHistory(value.input);
      expect(observed.disposition).toBe('unavailable');
      expect(observed.use).toBe('observer-only');
      expect(observed.observations).toEqual([]);
      expect(observed.reason).toMatch(/(?:absence is not non-entry|missing bytes do not prove non-entry)/);
      expect(fakeGh.downloadedArtifactIds).not.toContain(OUTCOME_ARTIFACT_ID);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  for (const field of ['sessionRevision', 'actionKeys'] as const) {
    test(`outcome history validates ${field} without hashing supplied digest strings`, async () => {
      for (const malformed of [true, false]) {
        const value = outcomeHistoryFixture();
        const wrong = malformed ? 'sha256:invalid' as const : digest('0');
        const input = { ...value.input, ...(field === 'sessionRevision' ? { sessionRevision: wrong } : { actionKeys: [wrong] }) };
        if (malformed) {
          await expect(provider.observeHostedResumeDispatchOutcomeHistory(input)).rejects.toThrow('Digest does not match');
          expect(fakeGh.downloadedArtifactIds).toEqual([]);
        } else {
          const observed = await provider.observeHostedResumeDispatchOutcomeHistory(input);
          expect(observed.disposition).toBe('unavailable');
          expect(observed.use).toBe('observer-only');
          expect(observed.reason).toContain('query differs from its native original Session or parent members');
          expect(fakeGh.downloadedArtifactIds).not.toContain(OUTCOME_ARTIFACT_ID);
        }
        expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
      }
    }, 30_000);
  }

  test('outcome history rejects malformed, foreign or duplicate declared membership through the original parser', async () => {
    for (const mode of ['malformed-key', 'foreign-key', 'duplicate-key', 'incomplete', 'digest', 'member', 'foreign-session', 'foreign-signal'] as const) {
      const value = outcomeHistoryFixture();
      const raw = JSON.parse(value.source);
      if (mode === 'malformed-key') raw.expectedActionKeys = ['sha256:invalid'];
      if (mode === 'foreign-key') raw.expectedActionKeys = [digest('0')];
      if (mode === 'duplicate-key') raw.expectedActionKeys = [value.actionKey, value.actionKey];
      if (mode === 'incomplete') raw.entries = [];
      if (mode === 'member') raw.entries[0].actionKey = digest('0');
      if (mode === 'foreign-session') raw.sessionRevision = digest('0');
      if (mode === 'foreign-signal') {
        raw.signal.emitter.jobId = '6399';
        const { signalDigest: _oldSignal, ...signalBody } = raw.signal;
        raw.signal.signalDigest = ciActionDigest(signalBody);
      }
      const { collectionDigest: _old, ...body } = raw;
      raw.collectionDigest = mode === 'digest' ? digest('0') : ciActionDigest(body);
      const index = fakeGh.artifacts.findIndex(entry => entry.id === OUTCOME_ARTIFACT_ID);
      fakeGh.artifacts[index] = { ...value.artifact, source: `${JSON.stringify(raw)}\n` };
      const observed = await provider.observeHostedResumeDispatchOutcomeHistory(value.input);
      expect(observed.disposition).toBe('unavailable');
      expect(observed.use).toBe('observer-only');
      expect(observed.observations).toEqual([]);
      expect(fakeGh.downloadedArtifactIds).toContain(OUTCOME_ARTIFACT_ID);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
    const value = outcomeHistoryFixture();
    await expect(provider.observeHostedResumeDispatchOutcomeHistory({ ...value.input,
      actionKeys: [value.actionKey, value.actionKey] })).rejects.toThrow('membership repeats');
    expect(fakeGh.downloadedArtifactIds).toEqual([]);
    expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
  }, 30_000);

  test('outcome carrier requires its exact ended receiver, source-owned slot and actual upload interval', async () => {
    const forgeries: Array<(value: ReturnType<typeof outcomeHistoryFixture>) => void> = [
      value => { value.job.id = 6401; }, value => { value.job.run_id = 9401; },
      value => { value.job.run_attempt = null; }, value => { value.job.run_attempt = 2; },
      value => { value.job.run_attempt = '1'; }, value => { value.job.head_sha = HEAD; },
      value => { value.job.name = 'coordinate-verification-session'; },
      value => { fakeGh.actionJobsByAttempt[`${DELEGATED_RUN_ID}:1`]!.push({ ...value.job }); },
      value => { fakeGh.actionJobsByAttempt[`${DELEGATED_RUN_ID}:1`]!.push({ ...value.job, id: 6401 }); },
      _value => { fakeGh.jobPageHook = (_page, _call, runId) => runId === DELEGATED_RUN_ID ? { totalCount: 2 } : null; },
      value => { value.job.status = 'in_progress'; value.job.conclusion = null; value.job.completed_at = null; },
      value => { value.job.started_at = undefined; }, value => { value.job.completed_at = '2026-08-09T01:01:04Z'; },
      value => { value.job.steps = []; },
      value => { const steps = value.job.steps as Record<string, unknown>[]; steps.push({ ...steps[0]!, number: 8 }); },
      value => { (value.job.steps as Record<string, unknown>[])[0]!.conclusion = 'cancelled'; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.conclusion = 'failure'; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.name = 'Upload resumed terminal Verification Session artifact'; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.number = 4; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.started_at = null; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.started_at = '2026-08-09T01:01:00Z'; },
      value => { (value.job.steps as Record<string, unknown>[])[1]!.completed_at = '2026-08-09T01:01:02Z'; },
      value => { const upload = (value.job.steps as Record<string, unknown>[])[1]!;
        upload.started_at = '2026-08-10T01:01:03Z'; upload.completed_at = '2026-08-10T01:01:05Z';
        value.job.completed_at = '2026-08-10T01:01:12Z';
        fakeGh.artifactMetadataOverrides[String(OUTCOME_ARTIFACT_ID)] = { created_at: upload.started_at, updated_at: upload.completed_at }; },
      ...[{ created_at: undefined }, { updated_at: 'invalid' }, { created_at: '2026-08-09T01:01:02Z' },
        { updated_at: '2026-08-09T01:01:06Z' }, { updated_at: '2026-08-09T01:01:02Z' },
        { workflow_run: { id: Number(DELEGATED_RUN_ID), head_sha: HEAD } }].map(patch =>
        (_value: ReturnType<typeof outcomeHistoryFixture>) => {
          Object.assign(fakeGh.artifactMetadataOverrides[String(OUTCOME_ARTIFACT_ID)]!, patch);
        }),
      _value => { fakeGh.workflowSourceHook = () => fakeGh.downloadedArtifactIds.includes(OUTCOME_ARTIFACT_ID)
        ? `${CANONICAL_WORKFLOW_SOURCE}\n  extra-outcome-writer:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo unexpected\n` : null; }
    ];
    for (const forge of forgeries) {
      const value = outcomeHistoryFixture();
      forge(value);
      const observed = await provider.observeHostedResumeDispatchOutcomeHistory(value.input);
      expect(observed.disposition).toBe('unavailable');
      expect(observed.use).toBe('observer-only');
      expect(observed.observations).toEqual([]);
      expect(fakeGh.artifacts.find(entry => entry.id === OUTCOME_ARTIFACT_ID)!.source).toBe(value.source);
      expect(fakeGh.downloadedArtifactIds).toContain(OUTCOME_ARTIFACT_ID);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('outcome observer retains exact sole archive bytes and provider digest checks', async () => {
    for (const mode of ['extra', 'missing', 'digest']) {
      const value = outcomeHistoryFixture();
      const index = fakeGh.artifacts.findIndex(entry => entry.id === OUTCOME_ARTIFACT_ID);
      if (mode === 'extra') fakeGh.artifacts[index] = { ...value.artifact,
        members: { [HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE]: value.source, 'extra.json': '{}\n' } };
      if (mode === 'missing') fakeGh.artifacts[index] = { ...value.artifact, members: { 'other.json': value.source } };
      if (mode === 'digest') Object.assign(fakeGh.artifactMetadataOverrides[String(OUTCOME_ARTIFACT_ID)]!, { digest: digest('0') });
      const observed = await provider.observeHostedResumeDispatchOutcomeHistory(value.input);
      expect(observed.disposition).toBe('unavailable');
      expect(observed.use).toBe('observer-only');
      expect(observed.observations).toEqual([]);
      expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
    }
  }, 30_000);

  test('outcome observations retain unavailable state if final complete inventory changes', async () => {
    const value = outcomeHistoryFixture();
    fakeGh.artifactPageHook = () => fakeGh.downloadedArtifactIds.includes(OUTCOME_ARTIFACT_ID)
      ? { artifacts: [...fakeGh.artifacts, { id: 7099, name: 'unrelated-later-artifact', expired: false,
        runId: Number(CURRENT_RUN_ID), fileName: 'unrelated.json', source: '{}\n' }] } : null;
    const observed = await provider.observeHostedResumeDispatchOutcomeHistory(value.input);
    expect(observed.disposition).toBe('unavailable');
    expect(observed.use).toBe('observer-only');
    expect(observed.reason).toContain('complete inventory changed');
    expect(observed.observations).toHaveLength(1);
    expect(fakeGh.createCalls + fakeGh.dispatchCalls).toBe(0);
  }, 30_000);

  test('terminal publication binds the authenticated current run and full artifact chain', async () => {
    fakeGh = new FakeGh();
    const terminalAnchor = withTerminalChain(fakeGh);
    const result = await ensureTransaction({ origin: terminalOrigin, authority: authority(),
      intent: { kind: 'anchor-terminal', anchor: terminalAnchor } });
    expect(result.disposition).toBe('terminal-anchored');
    expect(result.status?.state).toBe('success');
    expect(fakeGh.createCalls).toBe(1);
  });
});
