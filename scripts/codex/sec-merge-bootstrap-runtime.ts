import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  defaultBranchLifecycleCommandRunner,
  finalizeMergedPullRequestCloseout,
  prepareMergedPullRequestCloseout,
  type BranchLifecycleContext,
  type PreparedBranchCloseoutEnvelope
} from './branch-lifecycle.ts';
import {
  buildScopeAttestPayload,
  buildVerificationPayload,
  computeManifestDigestFromBytes,
  parsePrInfo,
  parseWorkflowRuns,
  shouldSquashToSingleParent,
  type ManifestDigest,
  type PrInfo,
  type WorkflowRunSummary
} from './sec-merge-bootstrap-contract.ts';
import { CodexDevelopmentParseWorkPackageLocator } from './work-package-contract.ts';

export type ShellCommandResult = {
  stdout: string;
  stderr: string;
  status: number | null;
};

export type ShellCommandRunner = (
  cmd: string,
  args: readonly string[],
  options: Readonly<{ cwd?: string }>
) => ShellCommandResult;

export type BootstrapContext = {
  repositoryRoot: string;
  runShell: ShellCommandRunner;
  branchLifecycle?: BranchLifecycleContext;
};

export type BootstrapOptions = {
  prNumber: number;
  profile?: 'quick' | 'full';
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
};

export const defaultShellRunner: ShellCommandRunner = (cmd, args, options) => {
  const result = spawnSync(cmd, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
    status: result.status
  };
};

function logInfo(message: string): void {
  process.stdout.write(`[bootstrap] ${message}\n`);
}

function logWarn(message: string): void {
  process.stderr.write(`[bootstrap:warn] ${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`[bootstrap:error] ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function requireShell(
  ctx: BootstrapContext,
  command: string,
  args: readonly string[],
  label: string,
  cwd = ctx.repositoryRoot
): string {
  const result = ctx.runShell(command, args, { cwd });
  if (result.status !== 0) {
    fail(`${label} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function branchLifecycleContext(ctx: BootstrapContext): BranchLifecycleContext {
  return ctx.branchLifecycle ?? {
    repositoryRoot: ctx.repositoryRoot,
    run: defaultBranchLifecycleCommandRunner
  };
}

function resolvePrInfo(ctx: BootstrapContext, prNumber: number): PrInfo {
  const json = requireShell(ctx, 'gh', [
    'pr',
    'view',
    String(prNumber),
    '--json',
    'number,headRefOid,baseRefOid,headRefName,title,state,body'
  ], `PR #${prNumber} resolution`);
  return parsePrInfo(json, CodexDevelopmentParseWorkPackageLocator);
}

function readManifestBytes(ctx: BootstrapContext, pr: PrInfo): Buffer {
  const result = ctx.runShell('git', ['show', `${pr.headSha}:${pr.manifestPath}`], {
    cwd: ctx.repositoryRoot
  });
  if (result.status !== 0) {
    fail(`Manifest ${pr.manifestPath} is absent at ${pr.headSha}: ${result.stderr.trim()}`);
  }
  return Buffer.from(result.stdout, 'utf8');
}

function resolveManifestDigest(ctx: BootstrapContext, pr: PrInfo): ManifestDigest {
  return computeManifestDigestFromBytes(readManifestBytes(ctx, pr));
}

function dispatchScopeAttest(ctx: BootstrapContext, pr: PrInfo, manifest: ManifestDigest): void {
  const payload = buildScopeAttestPayload(pr, manifest);
  requireShell(ctx, 'gh', [
    'api', '-X', 'POST', '/repos/{owner}/{repo}/dispatches',
    '-f', 'event_type=sec-scope-attest-v1',
    '-F', `client_payload[pull_request]=${payload.pull_request}`,
    '-f', `client_payload[expected_head]=${payload.expected_head}`,
    '-f', `client_payload[expected_base]=${payload.expected_base}`,
    '-f', `client_payload[manifest_digest]=${payload.manifest_digest}`
  ], 'scope attestation dispatch');
  logInfo(`Dispatched sec-scope-attest-v1 for PR #${pr.number}.`);
}

function dispatchVerification(
  ctx: BootstrapContext,
  pr: PrInfo,
  manifest: ManifestDigest,
  profile: 'quick' | 'full'
): void {
  const payload = buildVerificationPayload(pr, manifest, profile);
  requireShell(ctx, 'gh', [
    'api', '-X', 'POST', '/repos/{owner}/{repo}/dispatches',
    '-f', 'event_type=sec-verify-frozen-v1',
    '-f', `client_payload[schema]=${payload.schema}`,
    '-F', `client_payload[pull_request]=${payload.pull_request}`,
    '-f', `client_payload[expected_head]=${payload.expected_head}`,
    '-f', `client_payload[expected_base]=${payload.expected_base}`,
    '-f', `client_payload[manifest_path]=${payload.manifest_path}`,
    '-f', `client_payload[manifest_digest]=${payload.manifest_digest}`,
    '-f', `client_payload[profile]=${payload.profile}`
  ], 'frozen verification dispatch');
  logInfo(`Dispatched sec-verify-frozen-v1 for PR #${pr.number} (profile=${profile}).`);
}

function listWorkflowRuns(
  ctx: BootstrapContext,
  workflowId: string,
  event: string,
  limit: number
): WorkflowRunSummary[] {
  const output = requireShell(ctx, 'gh', [
    'run',
    'list',
    `--workflow=${workflowId}`,
    `--event=${event}`,
    `--limit=${limit}`,
    '--json',
    'databaseId,status,conclusion,displayTitle,headSha'
  ], `workflow ${workflowId} listing`);
  return parseWorkflowRuns(output);
}

function sleep(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForWorkflowRun(
  ctx: BootstrapContext,
  workflowId: string,
  event: string,
  expectedTitle: string,
  expectedHeadSha: string,
  timeoutMs: number,
  pollIntervalMs: number
): WorkflowRunSummary {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'not observed';
  while (Date.now() < deadline) {
    try {
      const runs = listWorkflowRuns(ctx, workflowId, event, 50);
      const matching = runs
        .filter((run) => run.displayTitle === expectedTitle && run.headSha === expectedHeadSha)
        .sort((left, right) => right.databaseId - left.databaseId);
      const latest = matching[0];
      if (latest) {
        lastState = `run=${latest.databaseId} status=${latest.status} conclusion=${latest.conclusion ?? 'null'}`;
        if (latest.status === 'completed') {
          if (latest.conclusion !== 'success') {
            fail(`Workflow ${workflowId} ${lastState}.`);
          }
          logInfo(`Workflow ${workflowId} run ${latest.databaseId} succeeded.`);
          return latest;
        }
      }
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error);
      logWarn(`Workflow polling read failed: ${lastState}`);
    }
    sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  fail(`Timed out waiting for ${workflowId}: ${lastState}`);
}

function resolveHeadParents(ctx: BootstrapContext, headSha: string): string[] {
  return requireShell(
    ctx,
    'git',
    ['log', '--format=%P', '-n', '1', headSha],
    `parents of ${headSha}`
  ).split(/\s+/u).filter(Boolean);
}

function ensureSingleParent(ctx: BootstrapContext, pr: PrInfo): void {
  const parents = resolveHeadParents(ctx, pr.headSha);
  if (!shouldSquashToSingleParent(parents, pr.baseSha)) {
    logInfo(`PR #${pr.number} is already one commit on exact base ${pr.baseSha.slice(0, 8)}.`);
    return;
  }

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-squash-worktree-'));
  const worktreePath = path.join(temporaryRoot, 'worktree');
  const messagePath = path.join(temporaryRoot, 'COMMIT_MSG');
  let added = false;
  try {
    requireShell(
      ctx,
      'git',
      ['worktree', 'add', '--detach', worktreePath, pr.headSha],
      'isolated squash worktree creation'
    );
    added = true;
    requireShell(
      ctx,
      'git',
      ['reset', '--soft', pr.baseSha],
      'isolated squash reset',
      worktreePath
    );
    writeFileSync(messagePath, `${pr.title}\n`, 'utf8');
    requireShell(
      ctx,
      'git',
      ['commit', '--no-verify', '-F', messagePath],
      'isolated squash commit',
      worktreePath
    );
    const newHead = requireShell(ctx, 'git', ['rev-parse', 'HEAD'], 'squash head', worktreePath);
    requireShell(ctx, 'git', [
      'push',
      `--force-with-lease=refs/heads/${pr.headBranch}:${pr.headSha}`,
      'origin',
      `HEAD:refs/heads/${pr.headBranch}`
    ], 'exact-lease squash push', worktreePath);
    pr.headSha = newHead;
    logInfo(`Squashed PR #${pr.number} to exact head ${newHead}.`);
  } finally {
    if (added) {
      const removal = ctx.runShell('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: ctx.repositoryRoot
      });
      if (removal.status !== 0) {
        logWarn(`Temporary worktree removal failed: ${removal.stderr.trim()}`);
      }
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function adminSquashMerge(ctx: BootstrapContext, pr: PrInfo): void {
  requireShell(ctx, 'gh', [
    'pr',
    'merge',
    String(pr.number),
    '--admin',
    '--squash',
    '--match-head-commit',
    pr.headSha
  ], `exact-head merge of PR #${pr.number}`);
  logInfo(`Admin squash merged PR #${pr.number} at expected head ${pr.headSha}.`);
}

function readNewMain(ctx: BootstrapContext, defaultBranch = 'main'): string {
  requireShell(ctx, 'git', [
    'fetch',
    '--prune',
    'origin',
    `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`
  ], `new ${defaultBranch} fetch`);
  const live = requireShell(
    ctx,
    'git',
    ['ls-remote', '--exit-code', 'origin', `refs/heads/${defaultBranch}`],
    `live ${defaultBranch} readback`
  ).split(/\s+/u)[0];
  const tracking = requireShell(
    ctx,
    'git',
    ['rev-parse', `refs/remotes/origin/${defaultBranch}`],
    `tracking ${defaultBranch} readback`
  );
  if (!live || live !== tracking || !/^[0-9a-f]{40}$/u.test(live)) {
    fail(`New ${defaultBranch} readback mismatch: live=${live ?? '<missing>'} tracking=${tracking}.`);
  }
  return live;
}

function runAttestation(
  ctx: BootstrapContext,
  pr: PrInfo,
  manifest: ManifestDigest,
  timeoutMs: number,
  pollIntervalMs: number
): void {
  dispatchScopeAttest(ctx, pr, manifest);
  const title = `sec-scope-attest-v1 PR #${pr.number} head ${pr.headSha} base ${pr.baseSha} manifest ${manifest.digest}`;
  waitForWorkflowRun(
    ctx,
    'sec-merge-gate.yml',
    'repository_dispatch',
    title,
    pr.baseSha,
    timeoutMs,
    pollIntervalMs
  );
}

function runVerification(
  ctx: BootstrapContext,
  pr: PrInfo,
  manifest: ManifestDigest,
  profile: 'quick' | 'full',
  timeoutMs: number,
  pollIntervalMs: number
): void {
  dispatchVerification(ctx, pr, manifest, profile);
  const title = `verify frozen PR #${pr.number} ${profile} @ ${pr.headSha} base ${pr.baseSha}`;
  waitForWorkflowRun(
    ctx,
    'compiler-pr-validation.yml',
    'repository_dispatch',
    title,
    pr.baseSha,
    timeoutMs,
    pollIntervalMs
  );
}

function commandDigest(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  const manifest = resolveManifestDigest(ctx, pr);
  process.stdout.write(`${JSON.stringify({
    pr: pr.number,
    head: pr.headSha,
    base: pr.baseSha,
    manifestPath: pr.manifestPath,
    manifestDigest: manifest.digest,
    manifestBlobSha: manifest.blobSha,
    manifestByteLength: manifest.byteLength
  }, null, 2)}\n`);
}

function commandAttest(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  runAttestation(ctx, pr, resolveManifestDigest(ctx, pr), 10 * 60_000, 15_000);
}

function commandVerify(
  ctx: BootstrapContext,
  prNumber: number,
  profile: 'quick' | 'full'
): void {
  const pr = resolvePrInfo(ctx, prNumber);
  runVerification(ctx, pr, resolveManifestDigest(ctx, pr), profile, 90 * 60_000, 30_000);
}

function commandSquash(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  ensureSingleParent(ctx, pr);
  process.stdout.write(`${JSON.stringify({ pr: pr.number, head: pr.headSha, singleParent: true })}\n`);
}

function commandPrepareCloseout(
  ctx: BootstrapContext,
  prNumber: number
): PreparedBranchCloseoutEnvelope {
  const pr = resolvePrInfo(ctx, prNumber);
  if (pr.state.toUpperCase() !== 'OPEN') fail(`PR #${pr.number} must be OPEN before preparation.`);
  const prepared = prepareMergedPullRequestCloseout(branchLifecycleContext(ctx), {
    number: pr.number,
    headBranch: pr.headBranch,
    headSha: pr.headSha
  });
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
  return prepared;
}

function commandAll(ctx: BootstrapContext, options: BootstrapOptions): void {
  const profile = options.profile ?? 'full';
  const attestTimeout = Math.min(options.waitTimeoutMs ?? 10 * 60_000, 10 * 60_000);
  const verifyTimeout = options.waitTimeoutMs ?? 90 * 60_000;
  const pollInterval = options.pollIntervalMs ?? 15_000;
  const pr = resolvePrInfo(ctx, options.prNumber);
  const manifest = resolveManifestDigest(ctx, pr);

  ensureSingleParent(ctx, pr);
  runAttestation(ctx, pr, manifest, attestTimeout, pollInterval);
  runVerification(ctx, pr, manifest, profile, verifyTimeout, Math.max(pollInterval, 30_000));

  const prepared = prepareMergedPullRequestCloseout(branchLifecycleContext(ctx), {
    number: pr.number,
    headBranch: pr.headBranch,
    headSha: pr.headSha
  });
  logInfo(`Durable recovery prepared at ${prepared.preparation.recovery.path}.`);

  adminSquashMerge(ctx, pr);
  const newMainSha = readNewMain(ctx, prepared.preparation.repository.defaultBranch);
  const receipt = finalizeMergedPullRequestCloseout(
    branchLifecycleContext(ctx),
    prepared,
    newMainSha
  );
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.status === 'blocked' || receipt.status === 'residue') {
    fail(`PR #${pr.number} merged but branch closeout ended ${receipt.status}.`);
  }
  if (receipt.status === 'protected-pending') {
    logWarn('Remote closeout completed; a local worktree-bound branch remains protected-pending.');
  } else {
    logInfo(`PR #${pr.number} merge and branch closeout completed.`);
  }
}

interface CliArguments {
  command: 'digest' | 'attest' | 'verify' | 'squash' | 'prepare-closeout' | 'all';
  prNumber: number;
  profile: 'quick' | 'full';
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  if (!value || !/^[1-9]\d*$/u.test(value)) fail(`${label} requires a positive integer.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) fail(`${label} exceeds the safe integer range.`);
  return parsed;
}

function parseArgs(argv: readonly string[]): CliArguments {
  const command = argv[0];
  if (
    command !== 'digest'
    && command !== 'attest'
    && command !== 'verify'
    && command !== 'squash'
    && command !== 'prepare-closeout'
    && command !== 'all'
  ) {
    fail(USAGE);
  }
  let prNumber: number | null = null;
  let profile: 'quick' | 'full' = 'full';
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--pr') {
      prNumber = parsePositiveInteger(argv[index + 1], '--pr');
      index += 1;
    } else if (arg === '--profile') {
      const value = argv[index + 1];
      if (value !== 'quick' && value !== 'full') fail('--profile requires quick or full.');
      profile = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  if (prNumber === null) fail('--pr is required.');
  return { command, prNumber, profile };
}

const USAGE = `Usage: bun scripts/codex/sec-merge-bootstrap.ts <command> --pr <n> [--profile <quick|full>]

Commands:
  digest            Resolve exact PR/manifest identities.
  attest            Dispatch and await exact scope attestation.
  verify            Dispatch and await frozen verification.
  squash            Rebuild a multi-commit candidate in an isolated worktree.
  prepare-closeout  Create verified durable branch recovery before merge.
  all               Squash, attest, verify, recover, merge, read back and close out.

The obsolete post-merge pointer patch and best-effort cleanup commands are intentionally removed.
`;

export function runMergeBootstrapCli(
  argv = process.argv.slice(2),
  repositoryRoot = process.cwd()
): void {
  const args = parseArgs(argv);
  const ctx: BootstrapContext = {
    repositoryRoot,
    runShell: defaultShellRunner
  };
  switch (args.command) {
    case 'digest': commandDigest(ctx, args.prNumber); break;
    case 'attest': commandAttest(ctx, args.prNumber); break;
    case 'verify': commandVerify(ctx, args.prNumber, args.profile); break;
    case 'squash': commandSquash(ctx, args.prNumber); break;
    case 'prepare-closeout': commandPrepareCloseout(ctx, args.prNumber); break;
    case 'all': commandAll(ctx, { prNumber: args.prNumber, profile: args.profile }); break;
  }
}
