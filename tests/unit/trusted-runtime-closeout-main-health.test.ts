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
import { pathToFileURL } from 'node:url';

import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../src/verification/ci/contract/revision.ts';
import { encodeVerificationActionData } from '../../src/verification/action/contract/action.ts';
import { createTrustedRuntimeMainHealthBaselineObservation, createTrustedRuntimeMainHealthReceipt, TRUSTED_RUNTIME_CONTAINER_IMAGE_ID, TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST } from '../../src/verification/trusted-runtime/trusted-runtime-container.ts';
import { resolveSecRuntimeStateForRepository } from '../../src/runtime-state/workspace-state/paths.ts';

const REPOSITORY = 'sec-platform/sec';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function installFakeMainHealthGh(binHome: string, mainSha: string, executionSentinelPath: string): void {
  const runId = '33109458351';
  const operationId = createCiMainHealthRequestOperationId(mainSha);
  const checkPages = [{
    total_count: 1,
    check_runs: [{
      id: Number(runId),
      name: CI_MAIN_HEALTH_POLICY.context,
      status: 'completed',
      conclusion: 'failure',
      head_sha: mainSha,
      details_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}`,
      app: {
        id: CI_MAIN_HEALTH_POLICY.app.id,
        node_id: CI_MAIN_HEALTH_POLICY.app.nodeId,
        slug: CI_MAIN_HEALTH_POLICY.app.slug
      }
    }]
  }];
  const workflowRun = {
    id: Number(runId),
    path: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
    event: CI_MAIN_HEALTH_POLICY.producer.eventNames[0],
    display_title: `SEC main health ${mainSha} operation ${operationId}`,
    head_sha: mainSha
  };
  const scriptPath = path.join(binHome, 'gh.ts');
  const statusPath = path.join(binHome, 'gh-supersession-statuses');
  writeFileSync(scriptPath, [
    `import { readFileSync, writeFileSync } from 'node:fs';`,
    `const args = process.argv.slice(2).join(' ');`,
    `const mainSha = ${JSON.stringify(mainSha)};`,
    `const checkPages = ${JSON.stringify(checkPages)};`,
    `const workflowRun = ${JSON.stringify(workflowRun)};`,
    `const viewer = { login: 'sec-maintainer', node_id: 'MDQ6VXNlcjEyMzQ1Njc4' };`,
    `const statusPath = ${JSON.stringify(statusPath)};`,
    `writeFileSync(${JSON.stringify(executionSentinelPath)}, args + '\\n', { flag: 'a' });`,
    `const readStatuses = () => { try { return JSON.parse(readFileSync(statusPath, 'utf8')); } catch { return []; } };`,
    `if (args === 'auth token --hostname github.com') process.stdout.write('test-token');`,
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
}

function runProductionMainHealth(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
  runnerPath: string
) {
  return spawnSync(process.execPath, [runnerPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: environment,
    windowsHide: true
  });
}

test('production sec main health either uses the admitted host provider or fails closed before fake PATH execution', async () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-repo-'));
  const stateHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-state-'));
  const cacheHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-cache-'));
  const binHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-bin-'));
  try {
    git(repositoryRoot, ['init', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    mkdirSync(path.join(repositoryRoot, '.git', 'disabled-hooks'), { recursive: true });
    git(repositoryRoot, ['config', 'core.hooksPath', '.git/disabled-hooks']);
    writeFileSync(path.join(repositoryRoot, 'baseline.txt'), 'baseline\n', 'utf8');
    git(repositoryRoot, ['add', 'baseline.txt']);
    git(repositoryRoot, ['commit', '-m', 'baseline']);
    const baselineSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const baselineTreeSha = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
    writeFileSync(path.join(repositoryRoot, 'main.txt'), 'main\n', 'utf8');
    git(repositoryRoot, ['add', 'main.txt']);
    git(repositoryRoot, ['commit', '-m', 'main']);
    git(repositoryRoot, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);
    const mainSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const mainTreeSha = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);

    const childEnvironment = Object.freeze({
      ...process.env,
      SEC_STATE_HOME: stateHome,
      SEC_CACHE_HOME: cacheHome,
      GH_HOST: 'evil.example.invalid',
      GH_TOKEN: 'poisoned-ambient-token',
      PATH: `${binHome}${path.delimiter}${process.env.PATH ?? ''}`
    });
    const fakeGhExecutionSentinel = path.join(binHome, 'fake-gh-executed');
    installFakeMainHealthGh(binHome, mainSha, fakeGhExecutionSentinel);
    const closeoutModuleUrl = pathToFileURL(path.resolve(
      import.meta.dir,
      '../../src/control/branch-lifecycle/trusted-runtime-closeout.ts'
    )).href;
    const runnerPath = path.join(binHome, 'run-production-main-health.ts');
    const productionOperationId = createCiMainHealthRequestOperationId(mainSha);
    writeFileSync(runnerPath, [
      `import { ensureCurrentTrustedRuntimeMainHealthV2 } from ${JSON.stringify(closeoutModuleUrl)};`,
      `import { readFileSync, writeFileSync } from 'node:fs';`,
      `const statusPath = ${JSON.stringify(path.join(binHome, 'gh-supersession-statuses'))};`,
      `const runId = '33109458351';`,
      `const mainSha = ${JSON.stringify(mainSha)};`,
      `const readStatuses = () => { try { return JSON.parse(readFileSync(statusPath, 'utf8')); } catch { return []; } };`,
      `const workflowRun = { id: Number(runId), path: ${JSON.stringify(CI_MAIN_HEALTH_POLICY.producer.workflowPath)}, event: ${JSON.stringify(CI_MAIN_HEALTH_POLICY.producer.eventNames[0])}, display_title: ${JSON.stringify(`SEC main health ${mainSha} operation ${productionOperationId}`)}, head_sha: mainSha };`,
      `globalThis.fetch = async (input, init) => {`,
      `  const url = String(input);`,
      `  if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: mainSha } });`,
      `  if (url.includes('/check-runs?')) return Response.json({ total_count: 1, check_runs: [{ id: Number(runId), name: ${JSON.stringify(CI_MAIN_HEALTH_POLICY.context)}, status: 'completed', conclusion: 'failure', head_sha: mainSha, details_url: 'https://github.com/${REPOSITORY}/actions/runs/' + runId, app: { id: ${CI_MAIN_HEALTH_POLICY.app.id}, node_id: ${JSON.stringify(CI_MAIN_HEALTH_POLICY.app.nodeId)}, slug: ${JSON.stringify(CI_MAIN_HEALTH_POLICY.app.slug)} } }] });`,
      `  if (url.includes('/actions/runs/' + runId)) return Response.json(workflowRun);`,
      `  if (url.includes('/commits/' + mainSha + '/statuses?')) return Response.json(readStatuses());`,
      `  if (url.includes('/statuses/' + mainSha) && init?.method === 'POST') {`,
      `    const statuses = readStatuses(); const body = JSON.parse(String(init.body));`,
      `    const createdAt = new Date(Date.UTC(2026, 7, 28, 0, 0, statuses.length)).toISOString();`,
      `    const status = { id: 910001 + statuses.length, node_id: 'SC_kwDOProduction' + statuses.length, sha: mainSha, state: body.state, context: body.context, description: body.description, target_url: body.target_url, created_at: createdAt, updated_at: createdAt, creator: { login: 'sec-maintainer', node_id: 'MDQ6VXNlcjEyMzQ1Njc4' } };`,
      `    statuses.push(status); writeFileSync(statusPath, JSON.stringify(statuses)); return Response.json(status);`,
      `  }`,
      `  if (url.endsWith('/user')) return Response.json({ login: 'sec-maintainer', node_id: 'MDQ6VXNlcjEyMzQ1Njc4' });`,
      `  if (url.includes('/collaborators/sec-maintainer/permission')) return Response.json({ permission: 'maintain' });`,
      `  throw new Error('unexpected fake REST request: ' + url);`,
      `};`,
      `const result = await ensureCurrentTrustedRuntimeMainHealthV2({`,
      `  repositoryRoot: process.cwd(),`,
      `  repository: ${JSON.stringify(REPOSITORY)},`,
      `  defaultBranch: 'main'`,
      `});`,
      `process.stdout.write(JSON.stringify(result));`,
      ''
    ].join('\n'), 'utf8');

    const layout = resolveSecRuntimeStateForRepository({
      repository: REPOSITORY,
      repositoryRoot,
      environment: childEnvironment
    });
    const healthRoot = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    mkdirSync(healthRoot, { recursive: true });
    const baseline = createTrustedRuntimeMainHealthBaselineObservation({
      mainSha,
      mainTreeSha,
      parentLine: `${mainSha} ${baselineSha}`,
      parentTreeSha: baselineTreeSha
    });
    const receipt = createTrustedRuntimeMainHealthReceipt({
      origin: 'physical-main',
      repository: REPOSITORY,
      mainSha,
      mainTreeSha,
      baselineSha,
      baselineTreeSha,
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'production-main-health-reconciliation-test',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      dockerEndpoint: Object.freeze({
        schema: 'sec-docker-endpoint-identity-v1' as const,
        contextName: 'test-linux',
        endpointHost: process.platform === 'win32'
          ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
          : 'unix:///var/run/docker.sock',
        daemonId: 'daemon-production-main-health-test',
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
    const receiptPath = path.join(healthRoot, `main-${mainSha}.json`);
    const receiptBytes = `${encodeVerificationActionData(receipt)}\n`;
    writeFileSync(receiptPath, receiptBytes, 'utf8');

    const firstRun = runProductionMainHealth(repositoryRoot, childEnvironment, runnerPath);
    if (process.platform === 'win32') {
      expect(firstRun.status).not.toBe(0);
      expect(firstRun.stderr).toContain('TrustedRuntimeControlCliUnavailableErrorV1');
      expect(firstRun.stderr).toContain('installed-executable-capability-unproven');
      expect(() => readFileSync(fakeGhExecutionSentinel, 'utf8')).toThrow();
      expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes);
      expect(() => readdirSync(path.join(healthRoot, 'supersessions'))).toThrow();
      return;
    }
    expect(firstRun.status, firstRun.stderr).toBe(0);
    const first = JSON.parse(firstRun.stdout) as Record<string, unknown>;
    expect(first).toMatchObject({
      schema: 'sec-trusted-runtime-main-health-publication-v2',
      repository: REPOSITORY,
      mainSha,
      mainTreeSha,
      localReceipt: {
        receiptDigest: receipt.receiptDigest,
        executionId: receipt.executionId,
        reused: true
      },
      provider: {
        state: 'unhealthy',
        routingState: 'repair-only',
        reasonCode: 'repair-ready'
      },
      supersession: {
        status: 'superseded',
        issuerNodeId: 'MDQ6VXNlcjEyMzQ1Njc4'
      }
    });
    expect(first.publicationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes);
    const supersessionRoot = path.join(healthRoot, 'supersessions');
    const records = readdirSync(supersessionRoot);
    expect(records).toEqual([
      expect.stringMatching(/^supersession-[0-9a-f]{64}-[0-9a-f]{64}\.json$/u)
    ]);
    const secondRun = runProductionMainHealth(repositoryRoot, childEnvironment, runnerPath);
    expect(secondRun.status, secondRun.stderr).toBe(0);
    const second = JSON.parse(secondRun.stdout) as Record<string, unknown>;
    expect(second).toMatchObject({
      schema: 'sec-trusted-runtime-main-health-publication-v2',
      localReceipt: {
        receiptDigest: receipt.receiptDigest,
        reused: true
      },
      supersession: {
        status: 'resumed-superseded',
        locator: records[0]
      }
    });
    expect(second.publicationDigest).toBe(first.publicationDigest);
    expect(readdirSync(supersessionRoot)).toEqual(records);
    expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes);
  } finally {
    const cleanup = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 } as const;
    rmSync(repositoryRoot, cleanup);
    rmSync(stateHome, cleanup);
    rmSync(cacheHome, cleanup);
    rmSync(binHome, cleanup);
  }
}, 30_000);
