import { afterAll, describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { encodeVerificationActionData, type VerificationActionKeyDigest } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_ACTION_DISPATCH_TYPE, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, type CiVerificationActionPlanClosure, type CiVerificationActionProviderEnvelope } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, createVerificationActionProviderStartMarker, createVerificationActionProviderTerminalAnchor, VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX, VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX, verificationActionProviderRunTargetUrl, verificationActionProviderStartArtifactName, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, type VerificationActionProviderOrigin } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CI_VERIFICATION_SESSION_DISPATCH_TYPE } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { buildUnsupportedVerificationActionTerminalArtifact } from '../helpers/verification-action-fixtures.ts';

const REPOSITORY = 'openai/sec';
const REPOSITORY_ID = 311;
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const SESSION = `sha256:${'6'.repeat(64)}` as const;
const PARENT_RUN_ID = '9001';
const CURRENT_RUN_ID = '9100';
const PARENT_ARTIFACT_ID = 7000;
const PARENT_JOB_ID = 6001;
const EVENT_ROOT = mkdtempSync(path.join(tmpdir(), 'sec-provider-p1-test-'));
const EVENT_PATH = path.join(EVENT_ROOT, 'event.json');

const fixtureDigest = (source: string): VerificationActionKeyDigest =>
  `sha256:${createHash('sha256').update(source).digest('hex')}`;
const digest = (value: string): VerificationActionKeyDigest =>
  `sha256:${value.repeat(64).slice(0, 64)}`;

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
  parentDispatchPlanArchiveDigest: fixtureDigest(`zip-${PARENT_ARTIFACT_ID}`)
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
const TERMINAL_PAYLOAD_DIGEST = digest('9');

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
}>;

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
  createCalls = 0;
  dispatchCalls = 0;
  dispatchBodies: unknown[] = [];
  failStatusPost = false;
  lastDownloadedArtifactId: number | null = null;
  downloadedArtifactIds: number[] = [];
  currentRunOverrides: Record<string, unknown> = {};
  currentSuiteOverrides: Record<string, unknown> = {};
  exactRunOverrides: Record<string, Record<string, unknown>> = {};
  exactSuiteOverrides: Record<string, Record<string, unknown>> = {};
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

  spawn(
    command: string,
    args: readonly string[],
    options?: Readonly<{ input?: string }>
  ): Record<string, unknown> {
    if (command === 'unzip') return this.unzip(args);
    if (command !== 'gh') return this.failure(`unexpected executable ${command}`);
    const endpoint = args.find((entry) => entry.startsWith('/repos/'));
    if (endpoint === undefined) return this.failure('missing endpoint');
    if (args.includes('--method') && args.includes('POST')) return this.post(endpoint, args, options);
    if (endpoint === `/repos/${REPOSITORY}`) {
      return this.success(JSON.stringify({ id: REPOSITORY_ID, full_name: REPOSITORY, default_branch: 'main' }));
    }
    if (endpoint.endsWith('/actions/workflows/compiler-pr-validation.yml')) {
      return this.success(JSON.stringify({
        id: 300,
        path: '.github/workflows/compiler-pr-validation.yml',
        state: 'active'
      }));
    }
    if (endpoint.includes('/collaborators/maintainer/permission')) {
      return this.success(JSON.stringify({
        permission: 'maintain',
        user: { login: parentActor.login, id: parentActor.id, node_id: parentActor.nodeId, type: 'User' }
      }));
    }
    if (endpoint.includes('/attempts/1/jobs?')) {
      const page = Number(new URL(`https://github.invalid${endpoint}`).searchParams.get('page'));
      return this.success(JSON.stringify({ jobs: page === 1 ? [{
        id: PARENT_JOB_ID,
        name: 'coordinate-verification-session',
        run_id: Number(PARENT_RUN_ID),
        run_attempt: 1,
        head_sha: BASE,
        status: 'in_progress',
        conclusion: null,
        steps: [{ name: 'Prepare canonical parent Action dispatch plan', status: 'completed', conclusion: 'success' }]
      }] : [] }));
    }
    if (endpoint.includes('/commits/') && endpoint.includes('/statuses?')) {
      const page = Number(new URL(`https://github.invalid${endpoint}`).searchParams.get('page'));
      this.statusListCalls.push({ page, perPage: 100 });
      const override = this.statusPageHook?.(page, this.statusListCalls.length) ?? null;
      return this.success(JSON.stringify(override ?? this.statuses.slice((page - 1) * 100, page * 100)));
    }
    if (endpoint.includes('/actions/artifacts?')) {
      const page = Number(new URL(`https://github.invalid${endpoint}`).searchParams.get('page'));
      this.artifactListCalls.push({ page, perPage: 100 });
      const override = this.artifactPageHook?.(page, this.artifactListCalls.length) ?? null;
      const inventory = override?.artifacts ?? this.artifacts;
      const artifacts = inventory.slice((page - 1) * 100, page * 100).map((entry) => ({
        id: entry.id,
        name: entry.name,
        expired: entry.expired,
        workflow_run: { id: entry.runId }
      }));
      return this.success(JSON.stringify({ total_count: override?.totalCount ?? inventory.length, artifacts }));
    }
    const artifactMatch = /\/actions\/artifacts\/([1-9][0-9]*)(\/zip)?$/u.exec(endpoint);
    if (artifactMatch !== null) {
      const artifact = this.artifacts.find((entry) => entry.id === Number(artifactMatch[1]));
      if (artifact === undefined) return this.failure('artifact not found');
      if (artifactMatch[2] === '/zip') {
        this.lastDownloadedArtifactId = artifact.id;
        this.downloadedArtifactIds.push(artifact.id);
        return this.success(Buffer.from(`zip-${artifact.id}`));
      }
      return this.success(JSON.stringify({
        id: artifact.id,
        name: artifact.name,
        expired: artifact.expired,
        workflow_run: { id: artifact.runId }
      }));
    }
    const exactRunMatch = /\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/u.exec(endpoint);
    if (exactRunMatch !== null) {
      const id = exactRunMatch[1]!;
      const runAttempt = Number(exactRunMatch[2]);
      this.exactAttemptCalls.push({ runId: id, runAttempt });
      if (this.exactRunFailures.has(`${id}:${runAttempt}`)) {
        return this.failure('exact attempt not found');
      }
      return this.success(JSON.stringify({
        id: Number(id), run_attempt: runAttempt,
        check_suite_id: id === PARENT_RUN_ID ? 5001 : id === CURRENT_RUN_ID ? 5002 : 5003,
        event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
        head_sha: BASE, repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
        ...(this.exactRunOverrides[`${id}:${runAttempt}`] ?? {})
      }));
    }
    const runMatch = /\/actions\/runs\/([1-9][0-9]*)$/u.exec(endpoint);
    if (runMatch !== null) {
      const id = runMatch[1]!;
      this.latestRunCalls.push(id);
      if (id === PARENT_RUN_ID) {
        return this.success(JSON.stringify({
          id: Number(PARENT_RUN_ID), run_attempt: 1, workflow_id: 300, check_suite_id: 5001,
          event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
          head_sha: BASE, head_branch: 'main',
          name: `verify session PR #42 session ${SESSION}`,
          display_title: `verify session PR #42 session ${SESSION}`, actor: {
            login: parentActor.login, id: parentActor.id, node_id: parentActor.nodeId, type: 'User'
          }, repository: { id: REPOSITORY_ID, full_name: REPOSITORY }
        }));
      }
      return this.success(JSON.stringify({
        id: Number(id), run_attempt: this.latestRunAttempts[id] ?? 1,
        workflow_id: 300, check_suite_id: id === CURRENT_RUN_ID ? 5002 : 5003,
        event: 'repository_dispatch', path: '.github/workflows/compiler-pr-validation.yml',
        head_sha: BASE, head_branch: 'main', name: `produce Action ${ACTION}`,
        display_title: `produce Action ${ACTION}`, actor: botRecord,
        repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
        ...this.currentRunOverrides
      }));
    }
    const suiteMatch = /\/check-suites\/([1-9][0-9]*)$/u.exec(endpoint);
    if (suiteMatch !== null) {
      const id = Number(suiteMatch[1]);
      return this.success(JSON.stringify({
        id,
        head_sha: BASE,
        repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
        app: { id: 15368, node_id: 'MDM6QXBwMTUzNjg=', slug: 'github-actions' },
        ...(id === 5002 ? this.currentSuiteOverrides : {}),
        ...(this.exactSuiteOverrides[String(id)] ?? {})
      }));
    }
    return this.failure(`unexpected endpoint ${endpoint}`);
  }

  private post(
    endpoint: string,
    args: readonly string[],
    options?: Readonly<{ input?: string }>
  ): Record<string, unknown> {
    if (endpoint === `/repos/${REPOSITORY}/dispatches`) {
      this.dispatchCalls += 1;
      this.dispatchBodies.push(JSON.parse(options?.input ?? 'null'));
      return this.success('');
    }
    if (!endpoint.includes(`/statuses/${HEAD}`)) return this.failure('unexpected mutation endpoint');
    this.createCalls += 1;
    if (this.failStatusPost) return this.failure('connection reset after request write');
    const fields = new Map(args.filter((entry) => entry.includes('=')).map((entry) => {
      const offset = entry.indexOf('=');
      return [entry.slice(0, offset), entry.slice(offset + 1)];
    }));
    const created = rawStatus({
      id: 9000 + this.createCalls,
      state: fields.get('state') as 'pending' | 'success',
      context: fields.get('context'),
      description: fields.get('description'),
      targetUrl: fields.get('target_url')
    });
    this.statuses.push(created);
    return this.success(JSON.stringify(created));
  }

  private unzip(args: readonly string[]): Record<string, unknown> {
    const artifact = this.artifacts.find((entry) => entry.id === this.lastDownloadedArtifactId);
    if (artifact === undefined) return this.failure('no artifact fixture');
    if (args[0] === '-Z1') return this.success(`${artifact.fileName}\n`);
    if (args[0] === '-p') return this.success(artifact.source);
    return this.failure('unexpected unzip operation');
  }

  private success(stdout: string | Buffer): Record<string, unknown> {
    return { status: 0, stdout, stderr: '', error: undefined };
  }

  private failure(stderr: string): Record<string, unknown> {
    return { status: 1, stdout: '', stderr, error: undefined };
  }
}

let fakeGh = new FakeGh();

type FakeGitHubOperation = Readonly<Record<string, unknown> & { kind: string }>;

function fakeOperationRaw(operation: FakeGitHubOperation): string {
  const repo = `/repos/${REPOSITORY}`;
  let args: string[];
  let input: string | undefined;
  switch (operation.kind) {
    case 'repository': args = ['api', repo]; break;
    case 'workflow': args = ['api', `${repo}/actions/workflows/compiler-pr-validation.yml`]; break;
    case 'collaborator-permission':
      args = ['api', `${repo}/collaborators/${String(operation.login)}/permission`]; break;
    case 'workflow-jobs':
      args = ['api', `${repo}/actions/runs/${String(operation.runId)}/attempts/${String(operation.runAttempt)}/jobs?per_page=100&page=${String(operation.page)}`]; break;
    case 'artifacts': args = ['api', `${repo}/actions/artifacts?per_page=100&page=${String(operation.page)}`]; break;
    case 'commit-statuses':
      args = ['api', `${repo}/commits/${String(operation.sha)}/statuses?per_page=100&page=${String(operation.page)}`]; break;
    case 'create-commit-status': {
      const status = operation.status as Readonly<Record<string, unknown>>;
      args = ['api', '--method', 'POST', `${repo}/statuses/${String(operation.sha)}`,
        '-f', `state=${String(status.state)}`, '-f', `context=${String(status.context)}`,
        '-f', `description=${String(status.description)}`, '-f', `target_url=${String(status.targetUrl)}`];
      break;
    }
    case 'workflow-run': args = ['api', `${repo}/actions/runs/${String(operation.runId)}`]; break;
    case 'workflow-run-attempt':
      args = ['api', `${repo}/actions/runs/${String(operation.runId)}/attempts/${String(operation.runAttempt)}`]; break;
    case 'check-suite': args = ['api', `${repo}/check-suites/${String(operation.checkSuiteId)}`]; break;
    case 'artifact': args = ['api', `${repo}/actions/artifacts/${String(operation.artifactId)}`]; break;
    case 'repository-dispatch':
      args = ['api', '--method', 'POST', `${repo}/dispatches`];
      input = JSON.stringify({ event_type: operation.eventType, client_payload: operation.clientPayload });
      break;
    default: throw new Error(`unexpected fake GitHub operation: ${operation.kind}`);
  }
  const result = fakeGh.spawn('gh', args, input === undefined ? undefined : { input });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout ?? '');
}

async function fakeExecuteOperation(_capability: unknown, operation: FakeGitHubOperation): Promise<unknown> {
  const raw = fakeOperationRaw(operation);
  return raw.length === 0 ? null : JSON.parse(raw) as unknown;
}

const fakeSession = async <T>(input: Readonly<{
  operation: (capability: Readonly<Record<string, never>>) => Promise<T>;
}>) => await input.operation(Object.freeze({}));

mock.module('../../src/adapters/providers/github-api/operation-session.ts', () => ({
  withGitHubApiReadSession: fakeSession,
  withGitHubApiStatusWriteSession: fakeSession,
  withGitHubApiRepositoryDispatchWriteSession: fakeSession,
  executeGitHubApiOperation: fakeExecuteOperation,
  executeObservedGitHubApiOperation: async (_capability: unknown, operation: FakeGitHubOperation) => {
    const source = fakeOperationRaw(operation);
    return Object.freeze({ value: JSON.parse(source) as unknown, source });
  },
  readGitHubApiBytes: async (_capability: unknown, input: Readonly<{
    kind: 'artifact-archive';
    artifactId: number;
  }>) => {
    const artifact = fakeGh.artifacts.find((entry) => entry.id === input.artifactId);
    if (artifact === undefined) throw new Error('artifact not found');
    fakeGh.lastDownloadedArtifactId = artifact.id;
    fakeGh.downloadedArtifactIds.push(artifact.id);
    return new Uint8Array(Buffer.from(`zip-${artifact.id}`));
  }
}));
mock.module('../../src/adapters/providers/zip/runtime.ts', () => ({
  readZipTextFile: async (input: Readonly<{
    expectedFileName: string;
  }>) => {
    const artifact = fakeGh.artifacts.find((entry) => entry.id === fakeGh.lastDownloadedArtifactId);
    if (artifact === undefined) throw new Error('no artifact fixture');
    if (artifact.fileName !== input.expectedFileName) {
      throw new Error('archive inventory is not the exact single expected member');
    }
    return artifact.source;
  }
}));
const provider = await import('../../src/adapters/verification/platform/ci/runtime/verification-action-github-provider.ts');
const ensureTransaction = (
  input: Omit<Parameters<typeof provider.ensureVerificationActionGitHubProviderTransaction>[0], 'repositoryRoot'>
) => provider.ensureVerificationActionGitHubProviderTransaction({ repositoryRoot: EVENT_ROOT, ...input });

function trustedEnvironment(eventEnvelope: CiVerificationActionProviderEnvelope = envelope): void {
  Object.assign(process.env, {
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

afterAll(() => rmSync(EVENT_ROOT, { recursive: true, force: true }));

describe('VerificationAction GitHub provider authenticated transaction', () => {
  test('exact parent artifact, closure member, current bot run, and marker chain posts once', async () => {
    fakeGh = new FakeGh().withMarker();
    const result = await ensureTransaction({
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
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'coordinate-parent' }
    });
    expect(result.disposition).toBe('observed');
    expect(result.actionKey).toBe(ACTION);
    expect(fakeGh.createCalls).toBe(0);
  });

  test('parent coordinator emits one authenticated child wake-up without exposing raw dispatch', async () => {
    fakeGh = new FakeGh();
    trustedParentEnvironment();
    const result = await ensureTransaction({
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
        authority: { envelope, actionPlanClosure: closure },
        intent: { kind: 'coordinate-parent' }
      })).rejects.toThrow();
      expect(fakeGh.createCalls).toBe(0);
    }
  });

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
      authority: { envelope, actionPlanClosure: closure },
      intent: { kind: 'dispatch-child' }
    })).rejects.toThrow(/artifact inventory total or leading boundary changed/i);
    expect(fakeGh.dispatchCalls).toBe(0);

    fakeGh = new FakeGh();
    fakeGh.artifacts.push(Object.freeze({ ...fakeGh.artifacts[0]!, name: 'duplicate-id' }));
    await expect(ensureTransaction({
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
    const result = await ensureTransaction({ authority: authority(), intent: { kind: 'claim-start', marker } });
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
      await expect(ensureTransaction({ authority: authority(), intent: { kind: 'claim-start', marker } }))
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
    const stable = await ensureTransaction({ authority: authority(), intent: { kind: 'coordinate' } });
    expect(stable.disposition).toBe('observed');
    expect(fakeGh.createCalls).toBe(0);
    expect(fakeGh.statusListCalls.filter((call) => call.page === 1).length).toBe(2);
    expect(fakeGh.statusListCalls).toContainEqual({ page: 2, perPage: 100 });

    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [
      rawStatus({ id: 77, context: 'diagnostic/one' }),
      { ...rawStatus({ id: 77, context: 'diagnostic/two' }), node_id: 'STATUS_77_DUPLICATE' }
    ];
    await expect(ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/duplicate status identity/i);
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [
      rawStatus({ id: 78, context: 'diagnostic/node-one' }),
      { ...rawStatus({ id: 79, context: 'diagnostic/node-two' }), node_id: 'STATUS_78' }
    ];
    await expect(ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/duplicate status identity/i);
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    const repeatedPage = Array.from({ length: 100 }, (_, index) => rawStatus({
      id: 500 - index,
      context: `diagnostic/drift-${index}`
    }));
    fakeGh.statuses = [...repeatedPage, rawStatus({ id: 399 })];
    fakeGh.statusPageHook = (page) => page === 2 ? repeatedPage : null;
    await expect(ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/duplicate status identity/i);
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    fakeGh.statusPageHook = (page, call) => page === 1 && call === 2
      ? [rawStatus({ id: 88 })]
      : [];
    await expect(ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow(/leading boundary changed/i);
    expect(fakeGh.createCalls).toBe(0);
  });

  test('unrelated canonical null status fields do not block provider status publication', async () => {
    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [{
      ...rawStatus({ id: 98, context: 'third-party/check' }),
      description: null,
      target_url: null
    }];
    const result = await ensureTransaction({ authority: authority(),
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
    await expect(ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow();
    expect(fakeGh.createCalls).toBe(0);
  });

  test('existing exact status is joined and unknown POST outcome is never retried', async () => {
    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [rawStatus({ id: 101 })];
    const existing = await ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker } });
    expect(existing.disposition).toBe('complete');
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    fakeGh.failStatusPost = true;
    const ambiguous = await ensureTransaction({ authority: authority(),
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
      await expect(ensureTransaction({ authority: { envelope, actionPlanClosure: closure },
        intent: { kind: 'claim-start', marker } })).rejects.toThrow();
      expect(fakeGh.createCalls).toBe(0);
    }
  });

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
      startArtifactArchiveDigest: fixtureDigest('zip-7001'),
      startMarkerDigest: stableMarker.markerDigest,
      terminalArtifactOriginId: '7002',
      terminalArtifactName: verificationActionProviderTerminalArtifactName(ACTION),
      terminalArtifactArchiveDigest: fixtureDigest('zip-7002'),
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
    const observed = await ensureTransaction({ authority: authority(), intent: { kind: 'coordinate' } });
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
    const expired = await ensureTransaction({ authority: authority(), intent: { kind: 'coordinate' } });
    expect(expired.snapshot.startObservations[0]).toMatchObject({
      expired: true, payload: null, referencedOrigin: null, archiveDigest: null
    });
    expect(fakeGh.exactAttemptCalls.some((entry) => entry.runId === '9300')).toBe(false);
    expect(fakeGh.downloadedArtifactIds).not.toContain(7010);

    fakeGh = new FakeGh().withMarker(stableMarker, 9300);
    await expect(ensureTransaction({ authority: authority(), intent: { kind: 'coordinate' } }))
      .rejects.toThrow(/payload producing origin differs.*metadata identity/i);
    expect(fakeGh.createCalls).toBe(0);

    const malformedAttemptMarker = { ...stableMarker,
      producer: { ...stableMarker.producer, runAttempt: 0 } } as typeof marker;
    fakeGh = new FakeGh().withMarker(malformedAttemptMarker, 9200);
    await expect(ensureTransaction({ authority: authority(), intent: { kind: 'coordinate' } }))
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
      await expect(ensureTransaction({ authority: authority(), intent: { kind: 'coordinate' } }))
        .rejects.toThrow();
      expect(fakeGh.createCalls).toBe(0);
    }
  });

  test('substituted parent artifact, closure, and non-member envelope fail before POST', async () => {
    fakeGh = new FakeGh().withMarker();
    fakeGh.artifacts[0] = Object.freeze({ ...fakeGh.artifacts[0]!, source: '{}\n' });
    await expect(ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow();
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    const substitutedClosure = { ...closure, actionPlanDigest: digest('8') } as CiVerificationActionPlanClosure;
    await expect(ensureTransaction({ authority: authority(envelope, substitutedClosure),
      intent: { kind: 'claim-start', marker } })).rejects.toThrow();
    expect(fakeGh.createCalls).toBe(0);

    fakeGh = new FakeGh().withMarker();
    const forgedEnvelope = {
      ...envelope,
      proposal: { ...envelope.proposal, proposedActionKey: digest('7') }
    } as CiVerificationActionProviderEnvelope;
    await expect(ensureTransaction({ authority: authority(forgedEnvelope),
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
    const result = await ensureTransaction({ authority: authority(),
      intent: { kind: 'claim-start', marker: forgedMarker } });
    expect(result.disposition).toBe('blocked');
    expect(fakeGh.createCalls).toBe(0);
  });

  test('terminal publication binds the authenticated current run and full artifact chain', async () => {
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
      startArtifactArchiveDigest: fixtureDigest('zip-7001'),
      startMarkerDigest: marker.markerDigest,
      terminalArtifactOriginId: '7002',
      terminalArtifactName: verificationActionProviderTerminalArtifactName(ACTION),
      terminalArtifactArchiveDigest: fixtureDigest('zip-7002'),
      terminalArtifactPayloadDigest: terminalArtifact.artifactDigest as VerificationActionKeyDigest,
      terminalAssemblerOrigin: currentOrigin,
      anchorPublisherOrigin: currentOrigin
    });
    fakeGh = new FakeGh().withMarker();
    fakeGh.statuses = [rawStatus({ id: 101 })];
    fakeGh.artifacts.push(
      { id: 7002, name: verificationActionProviderTerminalArtifactName(ACTION), expired: false,
        runId: Number(CURRENT_RUN_ID), fileName: 'verification-action-terminal-artifact.json',
        source: JSON.stringify(terminalArtifact) },
      { id: 7003, name: verificationActionProviderTerminalAnchorName(ACTION), expired: false,
        runId: Number(CURRENT_RUN_ID), fileName: 'verification-action-terminal-status-anchor.json',
        source: JSON.stringify(terminalAnchor) }
    );
    const result = await ensureTransaction({ authority: authority(),
      intent: { kind: 'anchor-terminal', anchor: terminalAnchor } });
    expect(result.disposition).toBe('terminal-anchored');
    expect(result.status?.state).toBe('success');
    expect(fakeGh.createCalls).toBe(1);
  });
});
