import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CI_MAIN_HEALTH_POLICY_V1,
  createCiMainHealthRequestOperationIdV1
} from '../../platform/shared/ci-verification-revision.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  createTrustedRuntimeMainHealthBaselineObservationV2,
  createTrustedRuntimeMainHealthReceiptV2,
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2
} from '../../scripts/codex/trusted-runtime-container.ts';
import {
  observeCanonicalMainHealthForRepairV1,
  observeCanonicalMainHealthForWorkSelectionV1,
  resolveWorkSelectionMainHealthProvidersV1
} from '../../scripts/codex/work-selection-main-health.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASELINE = '7'.repeat(40);
const BASELINE_TREE = '8'.repeat(40);

function installFakeMainHealthGh(binHome: string): string {
  const runId = '33109458351';
  const operationId = createCiMainHealthRequestOperationIdV1(MAIN);
  const checkPages = [{
    total_count: 1,
    check_runs: [{
      id: Number(runId),
      name: CI_MAIN_HEALTH_POLICY_V1.context,
      status: 'completed',
      conclusion: 'failure',
      head_sha: MAIN,
      details_url: `https://github.com/sec-platform/sec/actions/runs/${runId}`,
      app: {
        id: CI_MAIN_HEALTH_POLICY_V1.app.id,
        node_id: CI_MAIN_HEALTH_POLICY_V1.app.nodeId,
        slug: CI_MAIN_HEALTH_POLICY_V1.app.slug
      }
    }]
  }];
  const workflowRun = {
    id: Number(runId),
    path: CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath,
    event: CI_MAIN_HEALTH_POLICY_V1.producer.eventNames[0],
    display_title: `SEC main health ${MAIN} operation ${operationId}`,
    head_sha: MAIN
  };
  const scriptPath = path.join(binHome, 'gh.ts');
  writeFileSync(scriptPath, [
    `const args = process.argv.slice(2).join(' ');`,
    `const checkPages = ${JSON.stringify(checkPages)};`,
    `const workflowRun = ${JSON.stringify(workflowRun)};`,
    `if (args.includes('/check-runs?')) process.stdout.write(JSON.stringify(checkPages));`,
    `else if (args.includes('/actions/runs/${runId}')) process.stdout.write(JSON.stringify(workflowRun));`,
    `else { process.stderr.write('unexpected fake gh request: ' + args); process.exit(2); }`,
    ''
  ].join('\n'), 'utf8');
  const executablePath = path.join(binHome, process.platform === 'win32' ? 'gh.exe' : 'gh');
  if (process.platform === 'win32') {
    const compiled = spawnSync(process.execPath, [
      'build', '--compile', scriptPath, '--outfile', executablePath
    ], { encoding: 'utf8', windowsHide: true });
    if (compiled.status !== 0) {
      throw new Error(`cannot compile fake MainHealth gh: ${compiled.stderr || compiled.stdout}`);
    }
  } else {
    const runtime = process.execPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    writeFileSync(executablePath, `#!/usr/bin/env sh\nexec "${runtime}" "$(dirname "$0")/gh.ts" "$@"\n`, 'utf8');
    chmodSync(executablePath, 0o755);
  }
  return executablePath;
}

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

    const fakeGh = installFakeMainHealthGh(binHome);
    expect(observeCanonicalMainHealthForWorkSelectionV1(input).state).toBe('unhealthy');
    expect(observeCanonicalMainHealthForRepairV1(input))
      .toMatchObject({ status: 'repair-ready', routingState: 'repair-only' });
    expect(() => readFileSync(receiptPath)).toThrow();
    const retirementRoot = path.join(healthRoot, 'retired');
    expect(readdirSync(retirementRoot)).toEqual([
      expect.stringMatching(/^retirement-[0-9a-f]{64}\.json$/u)
    ]);

    rmSync(fakeGh);
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

test('provider resolution preserves missing, unavailable, and invalid dispositions for repair', () => {
  const base = {
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: MAIN,
    mainTreeSha: TREE,
    now: new Date().toISOString()
  } as const;
  const missing = resolveWorkSelectionMainHealthProvidersV1({
    ...base,
    local: { kind: 'absent' },
    hosted: { kind: 'absent' }
  });
  expect(missing.repairObservation.kind).toBe('provider-missing');
  expect(missing.projection.state).toBe('unresolved');

  const unavailable = resolveWorkSelectionMainHealthProvidersV1({
    ...base,
    local: { kind: 'absent' },
    hosted: { kind: 'unavailable', ref: `sha256:${'4'.repeat(64)}` }
  });
  expect(unavailable.repairObservation.kind).toBe('provider-unavailable');

  const invalid = resolveWorkSelectionMainHealthProvidersV1({
    ...base,
    local: { kind: 'invalid', ref: `sha256:${'5'.repeat(64)}` },
    hosted: { kind: 'absent' }
  });
  expect(invalid.repairObservation.kind).toBe('provider-invalid');
});
