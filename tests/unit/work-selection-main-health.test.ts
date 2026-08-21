import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createMainHealthLedgerV1,
  createMainHealthRepairWorkPackagePathV1,
  type MainHealthLedgerInputV1,
  type MainHealthLedgerV1
} from '../../platform/shared/main-health-contract.ts';
import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  ensureTrustedRuntimeMainHealthReceiptInDirectoryV1
} from '../../scripts/codex/trusted-runtime-closeout.ts';
import {
  createTrustedRuntimeMainHealthReceiptV1,
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1
} from '../../scripts/codex/trusted-runtime-container.ts';
import {
  observeCanonicalWorkSelectionMainHealthV1,
  observeHostedMainHealthChecksV1,
  resolveWorkSelectionMainHealthProvidersV1
} from '../../scripts/codex/work-selection-main-health.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const NOW = '2026-08-21T10:05:00.000Z';
const OBSERVED = '2026-08-21T10:00:00.000Z';
const EXPIRES = '2026-08-21T10:10:00.000Z';

type Transport = MainHealthLedgerInputV1['producer']['sourceTransport'];

function producer(transport: Transport, suffix: string): MainHealthLedgerInputV1['producer'] {
  return Object.freeze({
    identity: `test-main-health-${suffix}`,
    trustRevision: MAIN,
    sourceTransport: transport,
    sourceRunId: `run-${suffix}`,
    sourceRef: `test:${suffix}`,
    sourceDigest: `sha256:${suffix.padEnd(64, suffix[0] ?? 'a').slice(0, 64)}` as `sha256:${string}`
  });
}

function healthy(transport: Transport, suffix: string): MainHealthLedgerV1 {
  return createMainHealthLedgerV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN,
    mainTreeSha: TREE,
    status: 'healthy',
    failureFingerprints: [],
    owner: null,
    repairWorkPackage: null,
    expiresAt: EXPIRES,
    allowedLanes: ['ordinary'],
    trustRevision: MAIN,
    observedAt: OBSERVED,
    producer: producer(transport, suffix)
  });
}

function degraded(): MainHealthLedgerV1 {
  const failure = `sha256:${'b'.repeat(64)}` as `sha256:${string}`;
  return createMainHealthLedgerV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN,
    mainTreeSha: TREE,
    status: 'degraded',
    failureFingerprints: [failure],
    owner: 'ci-verification-maintainer',
    repairWorkPackage: createMainHealthRepairWorkPackagePathV1({
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: MAIN,
      mainTreeSha: TREE,
      owner: 'ci-verification-maintainer',
      failureFingerprints: [failure]
    }),
    expiresAt: EXPIRES,
    allowedLanes: ['repair'],
    trustRevision: MAIN,
    observedAt: OBSERVED,
    producer: producer('github-api', 'c')
  });
}

function resolve(input: Readonly<{
  local: Parameters<typeof resolveWorkSelectionMainHealthProvidersV1>[0]['local'];
  hosted: Parameters<typeof resolveWorkSelectionMainHealthProvidersV1>[0]['hosted'];
  mainTreeSha?: string;
}>) {
  return resolveWorkSelectionMainHealthProvidersV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN,
    mainTreeSha: input.mainTreeSha ?? TREE,
    now: NOW,
    local: input.local,
    hosted: input.hosted
  });
}

test('fresh exact trusted-local MainHealth unlocks WorkSelection when hosted provider is absent', () => {
  const result = resolve({
    local: { kind: 'available', ledger: healthy('trusted-local-readback', 'a') },
    hosted: { kind: 'absent' }
  });
  expect(result.state).toBe('healthy');
});

test('hosted healthy remains sufficient when the local provider is absent', () => {
  const hosted = { kind: 'available' as const, ledger: healthy('github-api', 'b') };
  expect(resolve({ local: { kind: 'absent' }, hosted }).state).toBe('healthy');
});

test('two fresh healthy providers converge on one semantic health revision', () => {
  const local = healthy('trusted-local-readback', 'a');
  const hosted = healthy('github-api', 'b');
  expect(local.healthRevision).toBe(hosted.healthRevision);
  const result = resolve({
    local: { kind: 'available', ledger: local },
    hosted: { kind: 'available', ledger: hosted }
  });
  expect(result).toEqual({ state: 'healthy', ref: local.healthRevision });
});

test('fresh providers that disagree never select the greener result', () => {
  const result = resolve({
    local: { kind: 'available', ledger: healthy('trusted-local-readback', 'a') },
    hosted: { kind: 'available', ledger: degraded() }
  });
  expect(result.state).toBe('unresolved');
});

test('invalid exact provider evidence blocks health promotion', () => {
  const result = resolve({
    local: { kind: 'invalid', ref: `sha256:${'e'.repeat(64)}` },
    hosted: { kind: 'available', ledger: healthy('github-api', 'b') }
  });
  expect(result.state).toBe('unresolved');
});

test('a valid hosted terminal failure remains unhealthy when no fresh local proof exists', () => {
  const result = resolve({
    local: { kind: 'absent' },
    hosted: { kind: 'available', ledger: degraded() }
  });
  expect(result.state).toBe('unhealthy');
});

test('all providers missing remains unresolved instead of becoming healthy', () => {
  expect(resolve({
    local: { kind: 'absent' },
    hosted: { kind: 'absent' }
  }).state).toBe('unresolved');
});

test('hosted transport failure cannot suppress valid local health or invent health without it', () => {
  const hosted = observeHostedMainHealthChecksV1({
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    observeChecks: () => {
      throw new Error('GitHub check-runs provider unavailable');
    }
  });
  expect(hosted.kind).toBe('unavailable');
  if (hosted.kind !== 'unavailable') throw new Error('hosted failure was not classified');
  expect(resolve({
    local: { kind: 'available', ledger: healthy('trusted-local-readback', 'a') },
    hosted
  }).state).toBe('healthy');
  expect(resolve({ local: { kind: 'absent' }, hosted }).state).toBe('unresolved');
});

test('provider proof for a different exact main tree cannot authorize current WorkSelection', () => {
  const result = resolve({
    local: { kind: 'absent' },
    hosted: { kind: 'available', ledger: healthy('github-api', 'b') },
    mainTreeSha: '9'.repeat(40)
  });
  expect(result.state).toBe('unresolved');
});

test('production observer consumes only the exact canonical local receipt path', () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;

  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-main-health-repository-'));
  const stateHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-state-'));
  const cacheHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-cache-'));
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SEC_STATE_HOME: stateHome,
    SEC_CACHE_HOME: cacheHome
  };
  try {
    const layout = resolveSecRuntimeStateForRepositoryV1({
      repository: 'sec-platform/sec',
      repositoryRoot,
      environment
    });
    const healthRoot = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    mkdirSync(healthRoot, { recursive: true });
    const receipt = createTrustedRuntimeMainHealthReceiptV1({
      origin: 'physical-main',
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      mainTreeSha: TREE,
      executionId: 'trusted-main-health-work-selection',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      dockerEndpoint: Object.freeze({
        schema: 'sec-docker-endpoint-identity-v1' as const,
        contextName: 'desktop-linux',
        endpointHost: process.platform === 'win32'
          ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
          : 'unix:///var/run/docker.sock',
        daemonId: 'daemon-work-selection',
        osType: 'linux' as const,
        architecture: 'x86_64' as const
      }),
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
      commandResultDigests: [
        `sha256:${'3'.repeat(64)}`,
        `sha256:${'4'.repeat(64)}`,
        `sha256:${'5'.repeat(64)}`,
        `sha256:${'6'.repeat(64)}`
      ],
      transition: null,
      observedAt: OBSERVED
    });
    const receiptPath = path.join(healthRoot, `main-${MAIN}.json`);
    const canonicalBytes = `${encodeVerificationActionDataV2(receipt)}\n`;
    writeFileSync(receiptPath, canonicalBytes, 'utf8');

    const observation = observeCanonicalWorkSelectionMainHealthV1({
      repositoryRoot,
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: MAIN,
      mainTreeSha: TREE,
      now: NOW,
      hostedExpiresAt: EXPIRES,
      hosted: { kind: 'observed', checks: [] },
      runtimeStateEnvironment: environment
    });
    expect(observation.state).toBe('healthy');

    const lateObservation = observeCanonicalWorkSelectionMainHealthV1({
      repositoryRoot,
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: MAIN,
      mainTreeSha: TREE,
      now: '2027-08-21T10:05:00.000Z',
      hostedExpiresAt: '2027-08-21T10:10:00.000Z',
      hosted: { kind: 'observed', checks: [] },
      runtimeStateEnvironment: environment
    });
    expect(lateObservation.state).toBe('healthy');
    expect(lateObservation.ref).toBe(observation.ref);

    writeFileSync(receiptPath, ` ${canonicalBytes}`, 'utf8');
    expect(observeCanonicalWorkSelectionMainHealthV1({
      repositoryRoot,
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: MAIN,
      mainTreeSha: TREE,
      now: NOW,
      hostedExpiresAt: EXPIRES,
      hosted: { kind: 'observed', checks: [] },
      runtimeStateEnvironment: environment
    }).state).toBe('unresolved');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(stateHome, { recursive: true, force: true });
    rmSync(cacheHome, { recursive: true, force: true });
  }
});

test('canonical MainHealth publisher executes an exact main once and reuses its immutable receipt', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;

  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-main-health-publisher-repository-'));
  const stateHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-publisher-state-'));
  const cacheHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-publisher-cache-'));
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SEC_STATE_HOME: stateHome,
    SEC_CACHE_HOME: cacheHome
  };
  let executions = 0;
  const receipt = createTrustedRuntimeMainHealthReceiptV1({
    origin: 'physical-main',
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: TREE,
    executionId: 'trusted-main-health-publisher',
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    dockerEndpoint: Object.freeze({
      schema: 'sec-docker-endpoint-identity-v1' as const,
      contextName: 'desktop-linux',
      endpointHost: process.platform === 'win32'
        ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
        : 'unix:///var/run/docker.sock',
      daemonId: 'daemon-publisher',
      osType: 'linux' as const,
      architecture: 'x86_64' as const
    }),
    networkIsolatedBeforeExecution: true,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
    commandResultDigests: [
      `sha256:${'3'.repeat(64)}`,
      `sha256:${'4'.repeat(64)}`,
      `sha256:${'5'.repeat(64)}`,
      `sha256:${'6'.repeat(64)}`
    ],
    transition: null,
    observedAt: OBSERVED
  });
  try {
    const layout = resolveSecRuntimeStateForRepositoryV1({
      repository: 'sec-platform/sec',
      repositoryRoot,
      environment
    });
    const healthRoot = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    mkdirSync(healthRoot, { recursive: true });
    const directory = inspectNoFollowDirectoryChainV1(
      healthRoot,
      'MainHealth publisher test directory'
    ).target;
    const first = await ensureTrustedRuntimeMainHealthReceiptInDirectoryV1({
      directory,
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      mainTreeSha: TREE,
      execute: async () => {
        executions += 1;
        return receipt;
      }
    });
    expect(first.reused).toBe(false);
    expect(first.receipt).toEqual(receipt);

    const second = await ensureTrustedRuntimeMainHealthReceiptInDirectoryV1({
      directory,
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      mainTreeSha: TREE,
      execute: async () => {
        throw new Error('unchanged exact-main evidence must not execute again');
      }
    });
    expect(second.reused).toBe(true);
    expect(second.receipt).toEqual(receipt);
    expect(executions).toBe(1);
    await expect(ensureTrustedRuntimeMainHealthReceiptInDirectoryV1({
      directory,
      repository: 'sec-platform/sec',
      mainSha: '../foreign-receipt',
      mainTreeSha: TREE,
      execute: async () => receipt
    })).rejects.toThrow('mainSha must be one lowercase Git SHA');
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(stateHome, { recursive: true, force: true });
    rmSync(cacheHome, { recursive: true, force: true });
  }
});

test('existing Test Impact graph protects the new provider-neutral WorkSelection seam', () => {
  const selection = selectTestsForSources(['scripts/codex/work-selection-main-health.ts']);
  expect(selection.owners).toContain('module-graph');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/work-selection-main-health.test.ts',
    'tests/unit/work-selection-live.test.ts'
  ]));
});
