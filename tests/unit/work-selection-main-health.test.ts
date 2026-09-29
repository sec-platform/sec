import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  withGitHubApiTestEnrollmentSession,
  withGitHubApiTestReadOperationBudget,
  withGitHubApiTestSession
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { createMainHealthLedger } from '../../src/adapters/self-hosting/control/main-health/contract.ts';
import { resolveSecRuntimeStateForRepository } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import {
  createTrustedRuntimeMainHealthReceipt,
  trustedRuntimeMainHealthReceiptLocator,
  TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS
} from '../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY } from '../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import {
  attachRegisteredMainHealthWorkflowProvenance,
  observeCanonicalMainHealthForDocumentControlTestingV2,
  resolveWorkSelectionMainHealthProviders
} from '../../src/adapters/self-hosting/control/main-health/work-selection-main-health.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const TEST_TOKEN = 'test-token-0123456789';

test('unrelated Actions checks do not require MainHealth workflow provenance', () => {
  const policy = GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY;
  const check = {
    id: 108459011050,
    name: 'Analyze (actions)',
    status: 'completed',
    conclusion: 'success',
    headSha: MAIN,
    detailsUrl: 'https://github.com/sec-platform/sec/actions/runs/36261827172/job/108459011050',
    appId: policy.app.id,
    appNodeId: policy.app.nodeId,
    appSlug: policy.app.slug,
    workflowPath: null,
    workflowRef: null,
    eventName: null,
    workflowRunId: '36261827172',
    workflowRunDisplayTitle: null
  } as const;
  expect(attachRegisteredMainHealthWorkflowProvenance({
    checks: [check], workflows: new Map(), mainSha: MAIN
  })).toEqual([check]);

  const registered = { ...check, name: policy.context };
  expect(() => attachRegisteredMainHealthWorkflowProvenance({
    checks: [registered], workflows: new Map(), mainSha: MAIN
  })).toThrow('provenance was not observed');
  expect(() => attachRegisteredMainHealthWorkflowProvenance({
    checks: [{ ...registered, workflowRunId: null }], workflows: new Map(), mainSha: MAIN
  })).toThrow('lacks a workflow run identity');
  const workflowPath = '.github/workflows/compiler-pr-validation.yml';
  const attached = attachRegisteredMainHealthWorkflowProvenance({
    checks: [registered],
    workflows: new Map([[registered.workflowRunId, {
      raw: {}, workflowPath, eventName: 'repository_dispatch',
      workflowRunDisplayTitle: 'SEC main health'
    }]]),
    mainSha: MAIN
  });
  expect(attached[0]).toMatchObject({
    workflowPath, workflowRef: `${workflowPath}@${MAIN}`,
    eventName: 'repository_dispatch'
  });
});

test('WorkSelection resolves only registered hosted repository health', () => {
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
    local: { kind: 'absent' },
    hosted: { kind: 'invalid', ref: `sha256:${'5'.repeat(64)}` }
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
      identity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts',
      trustRevision: base.mainSha,
      sourceTransport: 'github-api',
      sourceRunId: '33109458351',
      sourceRef: `github-check-runs:${base.repository}@${base.mainSha}`,
      sourceDigest: `sha256:${'6'.repeat(64)}`
    }
  });
  const healthy = resolveWorkSelectionMainHealthProviders({
    ...base,
    local: { kind: 'absent' },
    hosted: { kind: 'available', ledger: hostedLedger }
  });
  expect(healthy).toMatchObject({
    projection: { state: 'healthy' },
    ledger: hostedLedger,
    repairObservation: { kind: 'available' }
  });
});

test('WorkSelection prefers exact valid local evidence over hosted absence/unavailability and fails closed on conflict', () => {
  const now = '2026-09-29T00:00:00.000Z';
  const base = {
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN,
    mainTreeSha: TREE,
    now
  } as const;
  const localLedger = createMainHealthLedger({
    repository: base.repository,
    defaultBranch: base.defaultBranch,
    mainSha: base.mainSha,
    mainTreeSha: base.mainTreeSha,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: '2026-09-29T00:10:00.000Z',
    allowedLanes: ['ordinary'],
    trustRevision: base.mainSha,
    observedAt: now,
    producer: {
      identity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts',
      trustRevision: base.mainSha,
      sourceTransport: 'trusted-runtime-durable-readback',
      sourceRunId: 'trusted-main-health-run',
      sourceRef: `runtime-state:trusted-main-health/v1/main-${MAIN}.json`,
      sourceDigest: `sha256:${'7'.repeat(64)}`
    }
  });

  for (const hosted of [
    { kind: 'absent' as const },
    { kind: 'unavailable' as const, ref: `sha256:${'8'.repeat(64)}` as const }
  ]) {
    expect(resolveWorkSelectionMainHealthProviders({
      ...base,
      local: { kind: 'available', ledger: localLedger },
      hosted
    })).toMatchObject({
      projection: { state: 'healthy' },
      ledger: localLedger,
      repairObservation: { kind: 'available' }
    });
  }

  const equivalentHosted = createMainHealthLedger({
    ...localLedger,
    producer: {
      identity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts',
      trustRevision: MAIN,
      sourceTransport: 'github-api',
      sourceRunId: 'hosted-main-health-run',
      sourceRef: `github-check-runs:sec-platform/sec@${MAIN}`,
      sourceDigest: `sha256:${'9'.repeat(64)}`
    },
    observedAt: now,
    expiresAt: '2026-09-29T00:10:00.000Z'
  });
  expect(equivalentHosted.healthRevision).toBe(localLedger.healthRevision);
  expect(resolveWorkSelectionMainHealthProviders({
    ...base,
    local: { kind: 'available', ledger: localLedger },
    hosted: { kind: 'available', ledger: equivalentHosted }
  })).toMatchObject({
    projection: { state: 'healthy' },
    ledger: localLedger
  });

  const conflictingHosted = createMainHealthLedger({
    ...equivalentHosted,
    mainTreeSha: '3'.repeat(40)
  });
  expect(resolveWorkSelectionMainHealthProviders({
    ...base,
    local: { kind: 'available', ledger: localLedger },
    hosted: { kind: 'available', ledger: conflictingHosted }
  })).toMatchObject({
    projection: { state: 'unresolved' },
    ledger: null,
    repairObservation: { kind: 'provider-invalid' }
  });

  expect(resolveWorkSelectionMainHealthProviders({
    ...base,
    local: { kind: 'invalid', ref: `sha256:${'a'.repeat(64)}` },
    hosted: { kind: 'available', ledger: equivalentHosted }
  })).toMatchObject({
    projection: { state: 'unresolved' },
    ledger: null,
    repairObservation: { kind: 'provider-invalid' }
  });
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

test('nested MainHealth sessions cannot revive an expired outer budget by rolling back the clock', async () => {
  let now = 0;
  await expect(withGitHubApiTestEnrollmentSession({
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
  })).rejects.toThrow('deadline exceeded');
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

test('nested MainHealth sessions still reuse a live outer budget without replacing its deadline', async () => {
  let now = 0;
  const result = await withGitHubApiTestEnrollmentSession({
    repository: 'sec-platform/sec', effect: 'read', timeoutMs: 10, now: () => now,
    readToken: async () => TEST_TOKEN,
    transport: async inputUrl => String(inputUrl).endsWith('/user')
      ? Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' }) : Response.json({ permission: 'read' }),
    operation: async capability => {
      now = 5;
      const nested = await withGitHubApiTestSession({ capability, timeoutMs: 1_000,
        operation: async () => { now = 9; return 'inside original window'; } });
      expect(nested).toBe('inside original window');
      return 'completed';
    }
  });
  expect(result).toBe('completed');
});


test('provider observation consumes only the exact trusted-runtime receipt path', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const repositoryRoot = process.cwd();
  const stateHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-state-'));
  const cacheHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-cache-'));
  const previous = Object.freeze({
    stateHome: process.env.SEC_STATE_HOME,
    cacheHome: process.env.SEC_CACHE_HOME
  });
  process.env.SEC_STATE_HOME = stateHome;
  process.env.SEC_CACHE_HOME = cacheHome;
  try {
    const layout = resolveSecRuntimeStateForRepository({
      repository: 'sec-platform/sec',
      repositoryRoot
    });
    const locator = trustedRuntimeMainHealthReceiptLocator({
      repositoryStateRoot: layout.repositoryStateRoot,
      mainSha: MAIN
    });
    mkdirSync(locator.directory, { recursive: true });
    const receipt = createTrustedRuntimeMainHealthReceipt({
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      mainTreeSha: TREE,
      executionId: 'trusted-main-health-reader-fixture',
      dockerEndpoint: {
        schema: 'sec-docker-endpoint-identity-v1',
        contextName: 'test-linux',
        endpointHost: process.platform === 'win32'
          ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
          : 'unix:///var/run/docker.sock',
        daemonId: 'daemon-main-health-reader',
        osType: 'linux',
        architecture: 'x86_64'
      },
      dependencyCacheKey: `sha256:${'3'.repeat(64)}`,
      actionResults: TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.map((command, index) => ({
        command,
        resultDigest: `sha256:${String(index + 4).repeat(64)}` as `sha256:${string}`
      })),
      observedAt: '2026-09-29T00:00:00.000Z'
    });
    writeFileSync(
      path.join(locator.directory, locator.fileName),
      `${encodeVerificationActionData(receipt)}\n`,
      'utf8'
    );

    const observe = async () => await withGitHubApiTestEnrollmentSession({
      repository: 'sec-platform/sec',
      effect: 'read',
      readToken: async () => TEST_TOKEN,
      transport: async (inputUrl) => {
        const url = String(inputUrl);
        if (url.endsWith('/user')) {
          return Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=' });
        }
        if (url.includes('/collaborators/maintainer/permission')) {
          return Response.json({ permission: 'read' });
        }
        if (url.includes(`/commits/${MAIN}/check-runs`)) {
          return Response.json({ total_count: 0, check_runs: [] });
        }
        throw new Error(`unexpected MainHealth test URL: ${url}`);
      },
      operation: async (capability) => await observeCanonicalMainHealthForDocumentControlTestingV2({
        repositoryRoot,
        repository: 'sec-platform/sec',
        defaultBranch: 'main',
        mainSha: MAIN,
        mainTreeSha: TREE,
        capability
      })
    });

    const healthy = await observe();
    expect(healthy.projection.state).toBe('healthy');
    expect(healthy.repairDecision).toMatchObject({
      status: 'blocked',
      routingState: 'ordinary-only',
      reasonCode: 'repair-lane-ineligible'
    });

    unlinkSync(path.join(locator.directory, locator.fileName));
    const missing = await observe();
    expect(missing.projection.state).toBe('unresolved');
    expect(missing.repairDecision).toMatchObject({
      status: 'blocked',
      routingState: 'locked',
      reasonCode: 'repair-provider-missing'
    });
  } finally {
    if (previous.stateHome === undefined) delete process.env.SEC_STATE_HOME;
    else process.env.SEC_STATE_HOME = previous.stateHome;
    if (previous.cacheHome === undefined) delete process.env.SEC_CACHE_HOME;
    else process.env.SEC_CACHE_HOME = previous.cacheHome;
    rmSync(stateHome, { recursive: true, force: true });
    rmSync(cacheHome, { recursive: true, force: true });
  }
});
