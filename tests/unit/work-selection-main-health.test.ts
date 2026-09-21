import { expect, test } from 'bun:test';
import { createMainHealthLedger } from '../../src/adapters/self-hosting/control/main-health/contract.ts';
import {
  resolveWorkSelectionMainHealthProviders
} from '../../src/adapters/self-hosting/control/main-health/work-selection-main-health.ts';
import {
  withGitHubApiTestEnrollmentSession,
  withGitHubApiTestReadOperationBudget,
  withGitHubApiTestSession
} from '../../src/adapters/providers/github-api/test/operation-session.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const TEST_TOKEN = 'test-token-0123456789';

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
    hosted: { kind: 'absent' }
  });
  expect(missing.repairObservation.kind).toBe('provider-missing');
  expect(missing.projection.state).toBe('unresolved');

  const unavailable = resolveWorkSelectionMainHealthProviders({
    ...base,
    hosted: { kind: 'unavailable', ref: `sha256:${'4'.repeat(64)}` }
  });
  expect(unavailable.repairObservation.kind).toBe('provider-unavailable');

  const invalid = resolveWorkSelectionMainHealthProviders({
    ...base,
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
    hosted: { kind: 'available', ledger: hostedLedger }
  });
  expect(healthy).toMatchObject({
    projection: { state: 'healthy' },
    ledger: hostedLedger,
    repairObservation: { kind: 'available' }
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
