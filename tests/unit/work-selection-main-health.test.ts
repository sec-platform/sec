import { expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createMainHealthLedger } from '../../src/control/main-health/contract.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../src/control/main-health/provider-policy.ts';
import {
  classifyTrustedLocalMainHealthObservationFailure,
  issueTrustedRuntimeMainHealthAuthorityV2,
  observeCanonicalMainHealthForRepairTestingV2,
  observeCanonicalMainHealthForRepairV1,
  observeCanonicalMainHealthForWorkSelectionTestingV2,
  observeMainHealthGitHubDefaultBranchSha,
  reconcileCanonicalMainHealthProviderConflict,
  reconcileCanonicalMainHealthProviderConflictTestingV2,
  resolveWorkSelectionMainHealthProviders,
} from '../../src/control/main-health/work-selection-main-health.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestEnrollmentSession,
  withGitHubApiTestReadOperationBudget,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/external-capabilities/github-api/test/operation-session.ts';
import { PhysicalNoFollowError } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecRuntimeStateForRepository } from '../../src/runtime-state/workspace-state/paths.ts';
import { encodeVerificationActionData } from '../../src/verification/action/contract/action.ts';
import { createTrustedRuntimeMainHealthBaselineObservation, createTrustedRuntimeMainHealthReceipt, TRUSTED_RUNTIME_CONTAINER_IMAGE_ID, TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST } from '../../src/verification/trusted-runtime/trusted-runtime-container.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASELINE = '7'.repeat(40);
const BASELINE_TREE = '8'.repeat(40);
const TEST_TOKEN = 'test-token-0123456789';

test('production MainHealth entrypoints consume exact local evidence when hosted transport is unavailable', async () => {
  const repositoryRoot = process.cwd();
  const stateHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-state-'));
  const cacheHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-cache-'));
  const environment = Object.freeze({
    SEC_STATE_HOME: stateHome,
    SEC_CACHE_HOME: cacheHome
  });
  try {
    const layout = resolveSecRuntimeStateForRepository({
      repository: 'sec-platform/sec',
      repositoryRoot,
      environment
    });
    const healthRoot = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    mkdirSync(healthRoot, { recursive: true });
    const baseline = createTrustedRuntimeMainHealthBaselineObservation({
      mainSha: MAIN,
      mainTreeSha: TREE,
      parentLine: `${MAIN} ${BASELINE}`,
      parentTreeSha: BASELINE_TREE
    });
    const receipt = createTrustedRuntimeMainHealthReceipt({
      origin: 'physical-main',
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      mainTreeSha: TREE,
      baselineSha: BASELINE,
      baselineTreeSha: BASELINE_TREE,
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'trusted-main-health-provider-cutover',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      dockerEndpoint: Object.freeze({
        schema: 'sec-docker-endpoint-identity-v1' as const,
        contextName: 'test-linux',
        endpointHost: process.platform === 'win32'
          ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
          : 'unix:///var/run/docker.sock',
        daemonId: 'daemon-provider-cutover',
        osType: 'linux' as const,
        architecture: 'x86_64' as const
      }),
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
      actionResults: Object.freeze([
        Object.freeze({ actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` })
      ]),
      transition: null,
      observedAt: new Date(Date.now() - 1_000).toISOString()
    });
    const receiptPath = path.join(healthRoot, `main-${MAIN}.json`);
    writeFileSync(receiptPath, `${encodeVerificationActionData(receipt)}\n`, 'utf8');
    const statusRecords: Record<string, unknown>[] = [];
    let hostedConclusion: 'failure' | 'success' = 'success';
    let mutateHostedAfterPost = false;
    let page2ReadCount = 0;
    let mutatePage2OnRead: number | null = null;
    let statusPage2ReadCount = 0;
    let mutateStatusPage2OnRead: number | null = null;
    const requestLog: string[] = [];
    const runId = '33109458351';
    const operationId = createCiMainHealthRequestOperationId(MAIN);
    const workflowRun = {
      id: Number(runId),
      path: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
      event: CI_MAIN_HEALTH_POLICY.producer.eventNames[0],
      display_title: `SEC main health ${MAIN} operation ${operationId}`,
      head_sha: MAIN
    };
    const fakeFetch: GitHubApiTransport = async (inputUrl, init) => {
      const url = String(inputUrl);
      requestLog.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes(`/commits/${MAIN}/check-runs?`)) {
        const matchingCheck: Record<string, unknown> = {
          id: Number(runId),
          name: CI_MAIN_HEALTH_POLICY.context,
          status: 'completed',
          conclusion: hostedConclusion,
          head_sha: MAIN,
          details_url: `https://github.com/sec-platform/sec/actions/runs/${runId}`,
          app: {
            id: CI_MAIN_HEALTH_POLICY.app.id,
            node_id: CI_MAIN_HEALTH_POLICY.app.nodeId,
            slug: CI_MAIN_HEALTH_POLICY.app.slug
          }
        };
        const noiseChecks: Record<string, unknown>[] = Array.from({ length: 100 }, (_, index) => ({
          id: Number(runId) + index + 1,
          name: 'unrelated-check',
          status: 'completed',
          conclusion: 'success',
          head_sha: MAIN,
          details_url: null,
          app: {
            id: CI_MAIN_HEALTH_POLICY.app.id + 1,
            node_id: 'other-app-node',
            slug: 'other-app'
          }
        }));
        const allChecks = [matchingCheck, ...noiseChecks];
        const page = new URL(url).searchParams.get('page') === '2' ? 2 : 1;
        if (page === 2) page2ReadCount += 1;
        const pageChecks = page === 1
          ? allChecks.slice(0, 100)
          : allChecks.slice(100);
        if (page === 2 && mutatePage2OnRead === page2ReadCount) {
          pageChecks[0] = { ...pageChecks[0], name: 'mutated-noise-check' };
        }
        return Response.json({
          total_count: allChecks.length,
          check_runs: pageChecks
        });
      }
      if (url.includes(`/actions/runs/${runId}`)) return Response.json(workflowRun);
      if (url.includes('/git/ref/heads/main')) {
        return Response.json({ object: { sha: MAIN } });
      }
      if (url.includes(`/commits/${MAIN}/statuses?`)) {
        const page = new URL(url).searchParams.get('page') === '2' ? 2 : 1;
        if (page === 2) statusPage2ReadCount += 1;
        const pageStatuses = statusRecords.slice((page - 1) * 100, page * 100);
        if (page === 2 && mutateStatusPage2OnRead === statusPage2ReadCount) {
          pageStatuses[0] = { ...pageStatuses[0], context: 'mutated-status-noise' };
        }
        return Response.json(pageStatuses);
      }
      if (url.includes(`/statuses/${MAIN}`) && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        const createdAt = new Date(Date.UTC(2026, 7, 28, 0, 0, statusRecords.length)).toISOString();
        const status = {
          id: 900001 + statusRecords.length,
          node_id: `SC_kwDOMainHealth${statusRecords.length}`,
          sha: MAIN,
          state: body.state,
          context: body.context,
          description: body.description,
          target_url: body.target_url,
          created_at: createdAt,
          updated_at: createdAt,
          creator: { login: 'maintainer', node_id: 'MDQ6VXNlcjE=' }
        };
        statusRecords.push(status);
        if (mutateHostedAfterPost) hostedConclusion = 'success';
        return Response.json(status);
      }
      if (url.endsWith('/user')) {
        return Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' });
      }
      if (url.includes('/collaborators/maintainer/permission')) {
        return Response.json({ permission: 'maintain' });
      }
      return new Response('unexpected fake REST request', { status: 404 });
    };
    const readCapability = issueGitHubApiTestCapability({
      repository: 'sec-platform/sec',
      token: TEST_TOKEN,
      principal: {
        transport: 'github-rest-token',
        login: 'maintainer',
        nodeId: 'MDQ6VXNlcjE=',
        userId: 900001,
        permission: 'maintain'
      },
      effect: 'read',
      transport: fakeFetch
    });
    const unavailableCapability = issueGitHubApiTestCapability({
      repository: 'sec-platform/sec',
      token: TEST_TOKEN,
      principal: {
        transport: 'github-rest-token',
        login: 'maintainer',
        nodeId: 'MDQ6VXNlcjE=',
        userId: 900001,
        permission: 'read'
      },
      effect: 'read',
      transport: async () => {
        throw new Error('offline');
      }
    });
    const runtimeAuthority = await issueTrustedRuntimeMainHealthAuthorityV2({
      repositoryRoot,
      repository: 'sec-platform/sec',
      environment
    });
    const input = Object.freeze({
      repositoryRoot,
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: MAIN,
      mainTreeSha: TREE,
      capability: readCapability,
      environment
    });
    const unavailableInput = Object.freeze({ ...input, capability: unavailableCapability });
    const requestCountBeforeProductionGuard = requestLog.length;
    await expect(withGitHubApiTestSession({
      capability: readCapability,
      operation: () => observeCanonicalMainHealthForRepairV1(input)
    })).rejects.toThrow('not bound to this repository/effect');
    await expect(withGitHubApiTestSession({
      capability: readCapability,
      operation: () => observeMainHealthGitHubDefaultBranchSha({
        repositoryRoot,
        repository: 'sec-platform/sec',
        defaultBranch: 'main'
      })
    })).rejects.toThrow('not bound to this repository/effect');
    expect(requestLog.length).toBe(requestCountBeforeProductionGuard);
    const observeWith = async <T>(
      value: typeof input,
      operation: () => Promise<T>
    ): Promise<T> => await withGitHubApiTestSession({
      capability: value.capability,
      operation
    });
    expect((await observeWith(unavailableInput, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(unavailableInput))).state)
      .toBe('unresolved');
    expect(await observeWith(unavailableInput, () =>
      observeCanonicalMainHealthForRepairTestingV2(unavailableInput)))
      .toMatchObject({ status: 'blocked', routingState: 'locked' });
    const workflowReadsBefore = requestLog.filter((entry) => entry.includes(`/actions/runs/${runId}`)).length;
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('healthy');
    const workflowReadsAfter = requestLog.filter((entry) => entry.includes(`/actions/runs/${runId}`)).length;
    // The stable provider fence reads each unique workflow provenance twice,
    // once before and once after the complete paginated census.
    expect(workflowReadsAfter - workflowReadsBefore).toBe(2);
    expect(await observeWith(input, () =>
      observeCanonicalMainHealthForRepairTestingV2(input)))
      .toMatchObject({ status: 'blocked', routingState: 'ordinary-only' });
    hostedConclusion = 'failure';
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unresolved');
    expect(await observeWith(input, () =>
      observeCanonicalMainHealthForRepairTestingV2(input)))
      .toMatchObject({ status: 'blocked', routingState: 'locked', reasonCode: 'repair-provider-conflict' });
    expect(readFileSync(receiptPath, 'utf8')).toBe(`${encodeVerificationActionData(receipt)}\n`);

    const reconcileInput = Object.freeze({
      ...input,
      githubCapability: issueGitHubApiTestCapability({
        repository: 'sec-platform/sec',
        token: TEST_TOKEN,
        principal: {
          transport: 'github-rest-token',
          login: 'maintainer',
          nodeId: 'MDQ6VXNlcjE=',
          userId: 900001,
          permission: 'maintain'
        },
        effect: 'status-write',
        transport: fakeFetch
      }),
      runtimeAuthority
    });
    const previousFetch = globalThis.fetch;
    const reconcile = async <T>(operation: () => Promise<T>): Promise<T> => {
      globalThis.fetch = fakeFetch as typeof fetch;
      try {
        return await withGitHubApiTestSession({
          capability: reconcileInput.githubCapability,
          operation
        });
      } finally {
        globalThis.fetch = previousFetch;
      }
    };
    const reconciled = await reconcile(() =>
      reconcileCanonicalMainHealthProviderConflictTestingV2(reconcileInput));
    expect(reconciled.supersession.status).toBe('superseded');
    expect(reconciled.resolution.projection.state).toBe('unhealthy');
    expect(await observeWith(input, () => observeCanonicalMainHealthForRepairTestingV2(input)))
      .toMatchObject({ status: 'repair-ready', routingState: 'repair-only' });
    expect(readFileSync(receiptPath, 'utf8')).toBe(`${encodeVerificationActionData(receipt)}\n`);
    const supersessionRoot = path.join(healthRoot, 'supersessions');
    const [supersessionRecordName] = readdirSync(supersessionRoot);
    expect([supersessionRecordName]).toEqual([
      expect.stringMatching(/^supersession-[0-9a-f]{64}-[0-9a-f]{64}\.json$/u)
    ]);
    expect(statusRecords).toHaveLength(1);
    statusRecords.splice(0, 1);
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unresolved');
    statusRecords.push({
      id: 900001,
      node_id: 'SC_kwDOMainHealth0',
      sha: MAIN,
      state: 'success',
      context: 'SEC MainHealth Supersession / placeholder',
      description: 'placeholder',
      target_url: `https://github.com/sec-platform/sec/commit/${MAIN}`,
      created_at: '2026-08-28T00:00:00.000Z',
      updated_at: '2026-08-28T00:00:00.000Z',
      creator: { login: 'maintainer', node_id: 'MDQ6VXNlcjE=' }
    });
    // Restore the exact status returned by the first publication.
    statusRecords[0] = {
      id: 900001,
      node_id: 'SC_kwDOMainHealth0',
      sha: MAIN,
      state: 'success',
      context: reconciled.supersession.receipt.providerAuthorization.context,
      description: reconciled.supersession.receipt.providerAuthorization.description,
      target_url: reconciled.supersession.receipt.providerAuthorization.targetUrl,
      created_at: reconciled.supersession.receipt.providerAuthorization.createdAt,
      updated_at: reconciled.supersession.receipt.providerAuthorization.updatedAt,
      creator: { login: 'maintainer', node_id: 'MDQ6VXNlcjE=' }
    };
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unhealthy');
    statusRecords.push({ ...statusRecords[0], id: 900002, node_id: 'SC_kwDOMainHealthDuplicate' });
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unresolved');
    statusRecords.splice(1, 1);
    rmSync(supersessionRoot, { recursive: true, force: true });
    const recoveredAfterProviderPublication = await reconcile(() =>
      reconcileCanonicalMainHealthProviderConflictTestingV2(reconcileInput));
    expect(recoveredAfterProviderPublication.supersession.status).toBe('superseded');
    expect(statusRecords).toHaveLength(1);
    const resumed = await reconcile(() =>
      reconcileCanonicalMainHealthProviderConflictTestingV2(reconcileInput));
    expect(resumed.supersession.status).toBe('resumed-superseded');
    expect(resumed.resolution.projection.state).toBe('unhealthy');
    const [recoveredRecordName] = readdirSync(supersessionRoot);
    expect(recoveredRecordName).toStartWith(
      `supersession-${supersessionRecordName!.split('-')[1]}-`
    );
    const mismatchedRecordName = `supersession-${'0'.repeat(64)}-${'0'.repeat(64)}.json`;
    renameSync(
      path.join(supersessionRoot, recoveredRecordName!),
      path.join(supersessionRoot, mismatchedRecordName)
    );
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unresolved');
    renameSync(
      path.join(supersessionRoot, mismatchedRecordName),
      path.join(supersessionRoot, recoveredRecordName!)
    );
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unhealthy');

    rmSync(supersessionRoot, { recursive: true, force: true });
    rmSync(receiptPath);
    statusRecords.splice(0, statusRecords.length);
    await expect(reconcile(() =>
      reconcileCanonicalMainHealthProviderConflictTestingV2(reconcileInput)))
      .rejects.toThrow('requires one exact active provider conflict');
    expect(() => readdirSync(supersessionRoot)).toThrow();
    writeFileSync(receiptPath, `${encodeVerificationActionData(receipt)}\n`, 'utf8');
    rmSync(path.join(healthRoot, 'prepared'), { recursive: true, force: true });
    hostedConclusion = 'failure';
    mutateHostedAfterPost = true;
    await expect(reconcile(() =>
      reconcileCanonicalMainHealthProviderConflictTestingV2(reconcileInput)))
      .rejects.toThrow('MainHealth provider conflict changed inside supersession lease');
    mutateHostedAfterPost = false;
    hostedConclusion = 'failure';
    expect(readFileSync(receiptPath, 'utf8')).toBe(`${encodeVerificationActionData(receipt)}\n`);
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unresolved');

    // Restore a healthy matching check so the following assertion isolates a
    // second-page mutation rather than a semantic provider conflict.
    hostedConclusion = 'success';
    const nextPage2StableRead = page2ReadCount + 2;
    mutatePage2OnRead = nextPage2StableRead;
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unresolved');
    mutatePage2OnRead = null;
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('healthy');

    // Status authorization history has the same page-boundary race as check
    // runs. Keep one exact matching status among a full second page of noise;
    // mutating that page during the second census must block rather than
    // permit another effect.
    statusRecords.push(...Array.from({ length: 100 }, (_, index) => ({
      id: 910000 + index,
      node_id: `SC_kwDOStatusNoise${index}`,
      context: `unrelated-status-${index}`
    })));
    mutateStatusPage2OnRead = statusPage2ReadCount + 2;
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('unresolved');
    mutateStatusPage2OnRead = null;
    statusRecords.splice(1);
    expect((await observeWith(input, () =>
      observeCanonicalMainHealthForWorkSelectionTestingV2(input))).state).toBe('healthy');

  } finally {
    rmSync(stateHome, { recursive: true, force: true });
    rmSync(cacheHome, { recursive: true, force: true });
  }
}, 20_000);

test('provider resolution preserves missing, unavailable, and invalid dispositions for repair', () => {
  const base = {
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN,
    mainTreeSha: TREE,
    now: new Date().toISOString()
  } as const;
  const missing = resolveWorkSelectionMainHealthProviders({
    ...base,
    local: { kind: 'absent' },
    hosted: { kind: 'absent' }
  });
  expect(missing.repairObservation.kind).toBe('provider-missing');
  expect(missing.projection.state).toBe('unresolved');

  const unavailable = resolveWorkSelectionMainHealthProviders({
    ...base,
    local: { kind: 'absent' },
    hosted: { kind: 'unavailable', ref: `sha256:${'4'.repeat(64)}` }
  });
  expect(unavailable.repairObservation.kind).toBe('provider-unavailable');

  const invalid = resolveWorkSelectionMainHealthProviders({
    ...base,
    local: { kind: 'invalid', ref: `sha256:${'5'.repeat(64)}` },
    hosted: { kind: 'absent' }
  });
  expect(invalid.repairObservation.kind).toBe('provider-invalid');

  const hostedLedger = createMainHealthLedger({
    repository: base.repository,
    defaultBranch: base.defaultBranch,
    mainSha: base.mainSha,
    mainTreeSha: base.mainTreeSha,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: new Date(Date.parse(base.now) + 60_000).toISOString(),
    allowedLanes: ['ordinary'],
    trustRevision: base.mainSha,
    observedAt: base.now,
    producer: {
      identity: 'src/control/main-health/main-health-observation.ts',
      trustRevision: base.mainSha,
      sourceTransport: 'github-api',
      sourceRunId: '33109458351',
      sourceRef: `github-check-runs:${base.repository}@${base.mainSha}`,
      sourceDigest: `sha256:${'6'.repeat(64)}`
    }
  });
  const localCapabilityUnavailable = classifyTrustedLocalMainHealthObservationFailure(
    new PhysicalNoFollowError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'no supported no-follow backend'
    )
  );
  expect(localCapabilityUnavailable.kind).toBe('unavailable');
  const failClosed = resolveWorkSelectionMainHealthProviders({
    ...base,
    local: localCapabilityUnavailable,
    hosted: { kind: 'available', ledger: hostedLedger }
  });
  expect(failClosed).toMatchObject({
    projection: { state: 'unresolved' },
    ledger: null,
    repairObservation: { kind: 'provider-unavailable' }
  });

  expect(classifyTrustedLocalMainHealthObservationFailure(
    new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_ABSENT', 'literal ENOENT')
  )).toEqual({ kind: 'absent' });
});

test('MainHealth GitHub enrollment starts its one budget before credential acquisition', async () => {
  let now = 0;
  let fetchCalls = 0;
  let operationCalls = 0;
  let tokenTimeoutMs: number | undefined;
  await expect(withGitHubApiTestEnrollmentSession({
    repository: 'sec-platform/sec',
    effect: 'read',
    timeoutMs: 10,
    now: () => now,
    readToken: async ({ timeoutMs }) => {
      tokenTimeoutMs = timeoutMs;
      // Simulate the credential subprocess consuming the entire absolute
      // budget without sleeping or allowing a real child process to linger.
      now = 10;
      return TEST_TOKEN;
    },
    transport: async () => {
      fetchCalls += 1;
      return Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' });
    },
    operation: async () => {
      operationCalls += 1;
    }
  })).rejects.toThrow('deadline exceeded');
  expect(tokenTimeoutMs).toBe(10);
  expect(fetchCalls).toBe(0);
  expect(operationCalls).toBe(0);
});

test('MainHealth GitHub enrollment carries credential budget through principal readback', async () => {
  let now = 0;
  let fetchCalls = 0;
  let operationCalls = 0;
  await expect(withGitHubApiTestEnrollmentSession({
    repository: 'sec-platform/sec',
    effect: 'read',
    timeoutMs: 10,
    now: () => now,
    readToken: async () => TEST_TOKEN,
    transport: async (inputUrl) => {
      fetchCalls += 1;
      if (String(inputUrl).endsWith('/user')) {
        now = 4;
        return Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' });
      }
      now = 10;
      return Response.json({ permission: 'read' });
    },
    operation: async () => {
      operationCalls += 1;
    }
  })).rejects.toThrow('deadline exceeded');
  expect(fetchCalls).toBe(2);
  expect(operationCalls).toBe(0);
});

test('nested MainHealth GitHub test sessions reuse the outer absolute budget', async () => {
  let now = 0;
  const result = await withGitHubApiTestEnrollmentSession({
    repository: 'sec-platform/sec',
    effect: 'read',
    timeoutMs: 10,
    now: () => now,
    readToken: async () => TEST_TOKEN,
    transport: async (inputUrl) => String(inputUrl).endsWith('/user')
      ? Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' })
      : Response.json({ permission: 'read' }),
    operation: async (capability) => {
      now = 5;
      await expect(withGitHubApiTestSession({
        capability,
        timeoutMs: 1_000,
        now: () => now,
        operation: async () => {
          now = 10;
          await withGitHubApiTestSession({
            capability,
            timeoutMs: 1_000,
            operation: async () => undefined
          });
        }
      })).rejects.toThrow('deadline exceeded');
      now = 9;
      return 'completed';
    }
  });
  expect(result).toBe('completed');
});

test('MainHealth parent read budget admits T1 and fresh T2 but no third session', async () => {
  let fetchCalls = 0;
  const result = await withGitHubApiTestReadOperationBudget({
    repository: 'sec-platform/sec',
    timeoutMs: 100,
    readToken: async () => TEST_TOKEN,
    transport: async (inputUrl) => {
      fetchCalls += 1;
      return String(inputUrl).endsWith('/user')
        ? Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' })
        : Response.json({ permission: 'read' });
    },
    operation: async (open) => {
      await open(async (capability) => {
        await expect(withGitHubApiTestSession({
          capability,
          operation: async () => undefined
        })).resolves.toBeUndefined();
      });
      await open(async () => undefined);
      await expect(open(async () => undefined))
        .rejects.toThrow('session-count budget exceeded');
      return 'completed';
    }
  });
  expect(result).toBe('completed');
  // Each fresh session enrolls its own pending handle, but all four
  // enrollment requests still share the parent request budget.
  expect(fetchCalls).toBe(4);
});

test('MainHealth parent read budget carries its absolute deadline into T2', async () => {
  let now = 0;
  let tokenTimeouts: number[] = [];
  let fetchCalls = 0;
  await expect(withGitHubApiTestReadOperationBudget({
    repository: 'sec-platform/sec',
    timeoutMs: 20,
    now: () => now,
    readToken: async ({ timeoutMs }) => {
      tokenTimeouts.push(timeoutMs);
      if (tokenTimeouts.length === 1) now = 12;
      if (tokenTimeouts.length === 2) now = 20;
      return TEST_TOKEN;
    },
    transport: async (inputUrl) => {
      fetchCalls += 1;
      if (String(inputUrl).endsWith('/user') && fetchCalls === 1) {
        now = 14;
        return Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' });
      }
      return Response.json({ permission: 'read' });
    },
    operation: async (open) => {
      await open(async () => undefined);
      now = 19;
      await expect(open(async () => undefined)).rejects.toThrow('deadline exceeded');
    }
  })).rejects.toThrow('deadline exceeded');
  expect(tokenTimeouts).toEqual([20, 1]);
  expect(fetchCalls).toBe(2);
});
