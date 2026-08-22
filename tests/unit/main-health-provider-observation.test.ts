import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCiMainHealthRequestOperationIdV1 } from '../../platform/shared/ci-verification-revision.ts';
import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import { GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY_V1 } from '../../scripts/codex/main-health-observation.ts';
import {
  observeCanonicalMainHealthForWorkSelectionV1,
  observeHostedMainHealthChecksV1
} from '../../scripts/codex/main-health-provider-observation.ts';
import {
  ensureTrustedRuntimeMainHealthReceiptInDirectoryV2
} from '../../scripts/codex/trusted-runtime-closeout.ts';
import {
  createTrustedRuntimeMainHealthBaselineObservationV2,
  createTrustedRuntimeMainHealthReceiptV2,
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2
} from '../../scripts/codex/trusted-runtime-container.ts';
import type { GitHubCheckObservationV1 } from '../../scripts/codex/verification-session-github.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASELINE = '7'.repeat(40);
const BASELINE_TREE = '8'.repeat(40);
const BASELINE_OBSERVATION = createTrustedRuntimeMainHealthBaselineObservationV2({
  mainSha: MAIN,
  mainTreeSha: TREE,
  parentLine: `${MAIN} ${BASELINE}`,
  parentTreeSha: BASELINE_TREE
});
const NOW = '2026-08-21T10:05:00.000Z';
const OBSERVED = '2026-08-21T10:00:00.000Z';
const EXPIRES = '2026-08-21T10:10:00.000Z';

function hostedCheck(conclusion: 'success' | 'failure'): GitHubCheckObservationV1 {
  const policy = GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY_V1;
  if (policy.producer.kind !== 'github-actions-workflow') {
    throw new Error('Actions MainHealth policy must remain workflow-backed.');
  }
  return Object.freeze({
    id: conclusion === 'success' ? 71 : 72,
    name: policy.context,
    status: policy.terminal.status,
    conclusion,
    headSha: MAIN,
    detailsUrl: null,
    appId: policy.app.id,
    appNodeId: policy.app.nodeId,
    appSlug: policy.app.slug,
    workflowPath: policy.producer.workflowPath,
    workflowRef: policy.producer.workflowRefFormat.replace('<exact-main-sha>', MAIN),
    eventName: policy.producer.eventName,
    workflowRunId: conclusion === 'success' ? '71' : '72',
    workflowRunDisplayTitle: policy.producer.runTitleFormat
      .replace('<exact-main-sha>', MAIN)
      .replace('<request-operation-id>', createCiMainHealthRequestOperationIdV1(MAIN))
  });
}

test('production provider arbitration and repair entrypoint consume only physical evidence', () => {
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
    const receipt = createTrustedRuntimeMainHealthReceiptV2({
      origin: 'physical-main',
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      mainTreeSha: TREE,
      baselineSha: BASELINE,
      baselineTreeSha: BASELINE_TREE,
      baselineObservationDigest: BASELINE_OBSERVATION.observationDigest,
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
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
      actionResults: [
        { actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` }
      ],
      transition: null,
      observedAt: OBSERVED
    });
    const receiptPath = path.join(healthRoot, `main-${MAIN}.json`);
    const canonicalBytes = `${encodeVerificationActionDataV2(receipt)}\n`;

    const observe = (
      hosted: Parameters<typeof observeCanonicalMainHealthForWorkSelectionV1>[0]['hosted'],
      now = NOW,
      hostedExpiresAt = EXPIRES
    ) => observeCanonicalMainHealthForWorkSelectionV1({
      repositoryRoot,
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: MAIN,
      mainTreeSha: TREE,
      now,
      hostedExpiresAt,
      hosted,
      runtimeStateEnvironment: environment
    });

    expect(observe({ kind: 'observed', checks: [] }).state).toBe('unresolved');
    const hostedHealthy = observe({ kind: 'observed', checks: [hostedCheck('success')] });
    expect(hostedHealthy.state).toBe('healthy');
    expect(observe({
      kind: 'observed',
      checks: [hostedCheck('failure')]
    }).state).toBe('unhealthy');
    const unknownHostedFailure = observeHostedMainHealthChecksV1({
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      observeChecks: () => { throw new Error('unexpected provider failure'); }
    });
    expect(unknownHostedFailure.kind).toBe('invalid');
    expect(observeHostedMainHealthChecksV1({
      repository: 'sec-platform/sec',
      mainSha: MAIN,
      observeChecks: () => null as unknown as readonly GitHubCheckObservationV1[]
    }).kind).toBe('invalid');
    const hostedUnavailable = Object.freeze({
      kind: 'unavailable' as const,
      ref: `sha256:${'9'.repeat(64)}` as const
    });
    expect(observe(hostedUnavailable).state).toBe('unresolved');

    writeFileSync(receiptPath, canonicalBytes, 'utf8');

    const observation = observe({ kind: 'observed', checks: [] });
    expect(observation.state).toBe('healthy');
    expect(observe(hostedUnavailable).state).toBe('healthy');
    expect(observe(unknownHostedFailure).state).toBe('unresolved');
    expect(observe({
      kind: 'observed',
      checks: [hostedCheck('success')]
    })).toEqual(observation);
    expect(observation.ref).toBe(hostedHealthy.ref);
    expect(observe({
      kind: 'observed',
      checks: [hostedCheck('failure')]
    }).state).toBe('unresolved');
    expect(observe({
      kind: 'observed',
      checks: [{ ...hostedCheck('success'), status: 'malformed-status' }]
    }).state).toBe('unresolved');

    const repairModuleUrl = pathToFileURL(
      path.resolve('scripts/codex/main-health-repair.ts')
    ).href;
    const childSource = `
      import { observeMainHealthRepairDecisionV1 } from ${JSON.stringify(repairModuleUrl)};
      const decision = observeMainHealthRepairDecisionV1({
        repositoryRoot: ${JSON.stringify(repositoryRoot)},
        repository: 'sec-platform/sec',
        defaultBranch: 'main',
        exactMainSha: ${JSON.stringify(MAIN)},
        exactMainTreeSha: ${JSON.stringify(TREE)},
        observedAt: ${JSON.stringify(NOW)}
      });
      process.stdout.write(JSON.stringify(decision));
    `;
    const environmentWithoutPath = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')
    );
    const child = spawnSync(process.execPath, ['--no-install', '--eval', childSource], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      env: {
        ...environmentWithoutPath,
        PATH: '',
        SEC_STATE_HOME: stateHome,
        SEC_CACHE_HOME: cacheHome
      }
    });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout)).toMatchObject({
      status: 'blocked',
      routingState: 'ordinary-only',
      reasonCode: 'repair-lane-ineligible'
    });

    if (process.platform === 'linux') {
      const fakeBin = path.join(repositoryRoot, 'fake-bin');
      const fakeGh = path.join(fakeBin, 'gh');
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(fakeGh, [
        '#!/bin/sh',
        'printf \'%s\\n\' "Cannot query field \'schemaLike\' on type \'Query\'" >&2',
        'exit 1',
        ''
      ].join('\n'), 'utf8');
      chmodSync(fakeGh, 0o755);
      const restSchemaLikeFailure = spawnSync(
        process.execPath,
        ['--no-install', '--eval', childSource],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...environmentWithoutPath,
            PATH: fakeBin,
            SEC_STATE_HOME: stateHome,
            SEC_CACHE_HOME: cacheHome
          }
        }
      );
      expect(restSchemaLikeFailure.status).toBe(0);
      expect(JSON.parse(restSchemaLikeFailure.stdout)).toMatchObject({
        status: 'blocked',
        routingState: 'ordinary-only',
        reasonCode: 'repair-lane-ineligible'
      });

      writeFileSync(fakeGh, '#!/bin/sh\nprintf \'%s\' \'{malformed-json\'\n', 'utf8');
      const malformed = spawnSync(
        process.execPath,
        ['--no-install', '--eval', childSource],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...environmentWithoutPath,
            PATH: fakeBin,
            SEC_STATE_HOME: stateHome,
            SEC_CACHE_HOME: cacheHome
          }
        }
      );
      expect(malformed.status).toBe(0);
      expect(malformed.stderr).toBe('');
      expect(JSON.parse(malformed.stdout)).toMatchObject({
        status: 'blocked',
        routingState: 'locked',
        reasonCode: 'repair-ledger-invalid'
      });
    }

    const lateObservation = observe(
      { kind: 'observed', checks: [] },
      '2027-08-21T10:05:00.000Z',
      '2027-08-21T10:10:00.000Z'
    );
    expect(lateObservation.state).toBe('healthy');
    expect(lateObservation.ref).toBe(observation.ref);

    writeFileSync(receiptPath, ` ${canonicalBytes}`, 'utf8');
    expect(observe({
      kind: 'observed',
      checks: [hostedCheck('success')]
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
  const receipt = createTrustedRuntimeMainHealthReceiptV2({
    origin: 'physical-main',
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: TREE,
    baselineSha: BASELINE,
    baselineTreeSha: BASELINE_TREE,
    baselineObservationDigest: BASELINE_OBSERVATION.observationDigest,
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
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
    actionResults: [
      { actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` }
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
    const first = await ensureTrustedRuntimeMainHealthReceiptInDirectoryV2({
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

    const second = await ensureTrustedRuntimeMainHealthReceiptInDirectoryV2({
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
    await expect(ensureTrustedRuntimeMainHealthReceiptInDirectoryV2({
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

test('MainHealth Test Impact owner protects the provider-neutral lane seam', () => {
  const selection = selectTestsForSources(['scripts/codex/main-health-provider-observation.ts']);
  expect(selection.owners).toContain('main-health');
  expect(selection.owners).toContain('module-graph');
  expect(selection.fast).toEqual(expect.arrayContaining([
    'tests/unit/main-health-repair-contract.test.ts',
    'tests/unit/main-health-provider-observation.test.ts',
    'tests/unit/work-selection-live.test.ts'
  ]));
});
