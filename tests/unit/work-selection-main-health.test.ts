import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  createTrustedRuntimeMainHealthBaselineObservationV2,
  createTrustedRuntimeMainHealthReceiptV2,
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2
} from '../../scripts/codex/trusted-runtime-container.ts';
import {
  observeCanonicalMainHealthForRepairV1,
  observeCanonicalMainHealthForWorkSelectionV1
} from '../../scripts/codex/work-selection-main-health.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASELINE = '7'.repeat(40);
const BASELINE_TREE = '8'.repeat(40);

test('production MainHealth entrypoints consume exact local evidence when hosted transport is unavailable', () => {
  const repositoryRoot = process.cwd();
  const stateHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-state-'));
  const cacheHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-cache-'));
  const binHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-bin-'));
  const previous = Object.freeze({
    stateHome: process.env.SEC_STATE_HOME,
    cacheHome: process.env.SEC_CACHE_HOME,
    path: process.env.PATH,
    mode: process.env.SEC_TEST_GH_MODE
  });
  try {
    process.env.SEC_STATE_HOME = stateHome;
    process.env.SEC_CACHE_HOME = cacheHome;
    process.env.PATH = binHome;
    const layout = resolveSecRuntimeStateForRepositoryV1({
      repository: 'sec-platform/sec',
      repositoryRoot
    });
    const healthRoot = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    mkdirSync(healthRoot, { recursive: true });
    const baseline = createTrustedRuntimeMainHealthBaselineObservationV2({
      mainSha: MAIN,
      mainTreeSha: TREE,
      parentLine: `${MAIN} ${BASELINE}`,
      parentTreeSha: BASELINE_TREE
    });
    const receipt = createTrustedRuntimeMainHealthReceiptV2({
      origin: 'physical-main',
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      mainTreeSha: TREE,
      baselineSha: BASELINE,
      baselineTreeSha: BASELINE_TREE,
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'trusted-main-health-provider-cutover',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
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
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
      actionResults: Object.freeze([
        Object.freeze({ actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` })
      ]),
      transition: null,
      observedAt: new Date(Date.now() - 1_000).toISOString()
    });
    const receiptPath = path.join(healthRoot, `main-${MAIN}.json`);
    writeFileSync(receiptPath, `${encodeVerificationActionDataV2(receipt)}\n`, 'utf8');
    const input = Object.freeze({
      repositoryRoot,
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: MAIN,
      mainTreeSha: TREE
    });
    expect(observeCanonicalMainHealthForWorkSelectionV1(input).state).toBe('healthy');
    expect(observeCanonicalMainHealthForRepairV1(input))
      .toMatchObject({ status: 'blocked', routingState: 'ordinary-only' });
    rmSync(receiptPath);
    expect(observeCanonicalMainHealthForWorkSelectionV1(input).state).toBe('unresolved');
  } finally {
    for (const [name, value] of [
      ['SEC_STATE_HOME', previous.stateHome],
      ['SEC_CACHE_HOME', previous.cacheHome],
      ['PATH', previous.path],
      ['SEC_TEST_GH_MODE', previous.mode]
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(stateHome, { recursive: true, force: true });
    rmSync(cacheHome, { recursive: true, force: true });
    rmSync(binHome, { recursive: true, force: true });
  }
});
