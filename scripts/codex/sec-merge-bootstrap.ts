#!/usr/bin/env bun
/**
 * sec-merge-bootstrap.ts — SEC merge bootstrap CLI.
 *
 * Automates the manual merge bootstrap flow for frozen Work Package PRs:
 *   1. Compute manifest blob SHA-256 + git blob SHA-1 from head commit.
 *   2. Dispatch sec-scope-attest-v1 repository_dispatch with exact 4-key payload.
 *   3. Dispatch sec-verify-frozen-v1 repository_dispatch with exact 7-key payload.
 *   4. Wait for both workflow runs to reach successful completion.
 *   5. Ensure PR head is single-parent (parent === base); squash if needed.
 *   6. Admin squash merge via `gh pr merge --admin --squash`.
 *   7. Post-merge pointer patch: update active-work-package.md manifestDigest + rolling plan.
 *   8. Branch cleanup: delete local + remote merged feature branch.
 *
 * Usage:
 *   bun scripts/codex/sec-merge-bootstrap.ts <command> [options]
 *   bun scripts/codex/sec-merge-bootstrap.ts all --pr 200 --profile full
 *
 * Commands:
 *   digest --pr <n>                          Print manifest digest + blob SHA.
 *   attest --pr <n>                           Trigger scope attestation dispatch.
 *   verify --pr <n> --profile <quick|full>    Trigger frozen verification dispatch.
 *   squash --pr <n>                           Ensure single-parent head (squash if needed).
 *   merge --pr <n>                            Admin squash merge.
 *   patch --pr <n>                            Post-merge pointer patch.
 *   cleanup --pr <n>                          Delete local + remote feature branch.
 *   all --pr <n> --profile <quick|full>       Run entire flow end-to-end.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentWorkPackageManifestDigest
} from './work-package-contract.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export type PrInfo = {
  number: number;
  headSha: string;
  baseSha: string;
  headBranch: string;
  title: string;
  state: string;
  body: string;
  manifestPath: string;
};

export type ManifestDigest = {
  digest: string;
  blobSha: string;
  byteLength: number;
};

export type WorkflowRunSummary = {
  databaseId: number;
  status: string;
  conclusion: string | null;
  displayTitle: string;
  headSha: string;
};

export type BootstrapContext = {
  repositoryRoot: string;
  runShell: ShellCommandRunner;
};

export type BootstrapOptions = {
  prNumber: number;
  profile?: 'quick' | 'full';
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
};

// ---------------------------------------------------------------------------
// Default shell runner
// ---------------------------------------------------------------------------

export const defaultShellRunner: ShellCommandRunner = (cmd, args, options) => {
  const result = spawnSync(cmd, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status
  };
};

// ---------------------------------------------------------------------------
// Output helpers (human-readable, not Logger — this is a CLI tool)
// ---------------------------------------------------------------------------

function logInfo(message: string): void {
  process.stdout.write(`[bootstrap] ${message}\n`);
}

function logWarn(message: string): void {
  process.stderr.write(`[bootstrap:warn] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[bootstrap:error] ${message}\n`);
}

function fail(message: string): never {
  logError(message);
  process.exitCode = 1;
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Core pure functions (testable without shell)
// ---------------------------------------------------------------------------

/**
 * Compute manifest digest + git blob SHA from raw bytes.
 */
export function computeManifestDigestFromBytes(bytes: Uint8Array): ManifestDigest {
  const digest = CodexDevelopmentWorkPackageManifestDigest(bytes);
  const blobSha = createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
  return { digest, blobSha, byteLength: bytes.byteLength };
}

/**
 * Build the exact 4-key scope attestation client_payload.
 */
export function buildScopeAttestPayload(
  pr: PrInfo,
  manifest: ManifestDigest
): Record<string, string | number> {
  return {
    pull_request: pr.number,
    expected_head: pr.headSha,
    expected_base: pr.baseSha,
    manifest_digest: manifest.digest
  };
}

/**
 * Build the exact 7-key frozen verification client_payload.
 */
export function buildVerificationPayload(
  pr: PrInfo,
  manifest: ManifestDigest,
  profile: 'quick' | 'full'
): Record<string, string | number> {
  return {
    schema: 'codex-development-frozen-verification-request-v1',
    pull_request: pr.number,
    expected_head: pr.headSha,
    expected_base: pr.baseSha,
    manifest_path: pr.manifestPath,
    manifest_digest: manifest.digest,
    profile
  };
}

/**
 * Decide whether a PR head needs to be squashed to single-parent.
 * Returns true if parents count !== 1 OR parent !== baseSha.
 */
export function shouldSquashToSingleParent(parents: readonly string[], baseSha: string): boolean {
  return parents.length !== 1 || parents[0] !== baseSha;
}

/**
 * Parse `gh pr view --json` output into PrInfo.
 */
export function parsePrInfo(json: string, parseLocator: (body: string) => string): PrInfo {
  const data = JSON.parse(json) as {
    number?: number;
    headRefOid?: string;
    baseRefOid?: string;
    headRefName?: string;
    title?: string;
    state?: string;
    body?: string;
  };
  if (!data || typeof data !== 'object') throw new Error('PR JSON is not an object.');
  const number = data.number;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error('PR number is invalid.');
  }
  const headRefOid = data.headRefOid;
  if (typeof headRefOid !== 'string' || !/^[0-9a-f]{40}$/.test(headRefOid)) {
    throw new Error('PR headRefOid is invalid.');
  }
  const baseRefOid = data.baseRefOid;
  if (typeof baseRefOid !== 'string' || !/^[0-9a-f]{40}$/.test(baseRefOid)) {
    throw new Error('PR baseRefOid is invalid.');
  }
  const headRefName = data.headRefName;
  if (typeof headRefName !== 'string' || headRefName.length === 0) {
    throw new Error('PR headRefName is invalid.');
  }
  if (typeof data.title !== 'string' || data.title.length === 0) throw new Error('PR title is invalid.');
  if (typeof data.state !== 'string') throw new Error('PR state is invalid.');
  const body = data.body ?? '';
  const manifestPath = parseLocator(body);
  return {
    number,
    headSha: headRefOid,
    baseSha: baseRefOid,
    headBranch: headRefName,
    title: data.title,
    state: data.state,
    body,
    manifestPath
  };
}

/**
 * Parse `gh run list --json` output into WorkflowRunSummary list.
 */
export function parseWorkflowRuns(json: string): WorkflowRunSummary[] {
  const data = JSON.parse(json) as Array<{
    databaseId?: number;
    status?: string;
    conclusion?: string | null;
    displayTitle?: string;
    headSha?: string;
  }>;
  if (!Array.isArray(data)) throw new Error('Workflow runs JSON is not an array.');
  return data.map((run) => {
    const databaseId = run.databaseId;
    if (typeof databaseId !== 'number' || !Number.isSafeInteger(databaseId) || databaseId <= 0) {
      throw new Error('Workflow run databaseId is invalid.');
    }
    const status = run.status;
    if (typeof status !== 'string') throw new Error('Workflow run status is invalid.');
    const displayTitle = run.displayTitle;
    if (typeof displayTitle !== 'string') throw new Error('Workflow run displayTitle is invalid.');
    const headSha = run.headSha;
    if (typeof headSha !== 'string') throw new Error('Workflow run headSha is invalid.');
    return {
      databaseId,
      status,
      conclusion: run.conclusion ?? null,
      displayTitle,
      headSha
    };
  });
}

/**
 * Select the latest successful run matching an exact title + head SHA.
 */
export function selectSuccessfulRun(
  runs: readonly WorkflowRunSummary[],
  expectedTitle: string,
  expectedHeadSha: string
): WorkflowRunSummary {
  const matching = runs
    .filter((run) => run.displayTitle === expectedTitle && run.headSha === expectedHeadSha)
    .sort((left, right) => right.databaseId - left.databaseId);
  if (matching.length === 0) {
    throw new Error(`No workflow run found with title "${expectedTitle}" and head ${expectedHeadSha}.`);
  }
  const latest = matching[0]!;
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(
      `Latest workflow run ${latest.databaseId} is not successful: status=${latest.status} conclusion=${latest.conclusion ?? 'null'}.`
    );
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Shell-bound functions (require gh/git)
// ---------------------------------------------------------------------------

function resolvePrInfo(ctx: BootstrapContext, prNumber: number): PrInfo {
  const result = ctx.runShell('gh', [
    'pr', 'view', String(prNumber),
    '--json', 'number,headRefOid,baseRefOid,headRefName,title,state,body'
  ], { cwd: ctx.repositoryRoot });
  if (result.status !== 0) {
    fail(`Failed to fetch PR #${prNumber}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return parsePrInfo(result.stdout, CodexDevelopmentParseWorkPackageLocator);
}

function readManifestBytes(ctx: BootstrapContext, headSha: string, manifestPath: string): Buffer {
  const result = ctx.runShell('git', ['show', `${headSha}:${manifestPath}`], { cwd: ctx.repositoryRoot });
  if (result.status !== 0) {
    fail(`Failed to read manifest ${manifestPath} at ${headSha}: ${result.stderr.trim()}`);
  }
  return Buffer.from(result.stdout, 'utf8');
}

function resolveManifestDigest(ctx: BootstrapContext, pr: PrInfo): ManifestDigest {
  const bytes = readManifestBytes(ctx, pr.headSha, pr.manifestPath);
  return computeManifestDigestFromBytes(bytes);
}

function dispatchScopeAttest(ctx: BootstrapContext, pr: PrInfo, manifest: ManifestDigest): void {
  const payload = buildScopeAttestPayload(pr, manifest);
  const args = [
    'api', '-X', 'POST', '/repos/{owner}/{repo}/dispatches',
    '-f', `event_type=sec-scope-attest-v1`,
    '-F', `client_payload[pull_request]=${payload.pull_request}`,
    '-f', `client_payload[expected_head]=${payload.expected_head}`,
    '-f', `client_payload[expected_base]=${payload.expected_base}`,
    '-f', `client_payload[manifest_digest]=${payload.manifest_digest}`
  ];
  const result = ctx.runShell('gh', args, { cwd: ctx.repositoryRoot });
  if (result.status !== 0) {
    fail(`Failed to dispatch sec-scope-attest-v1: ${result.stderr.trim()}`);
  }
  logInfo(`Dispatched sec-scope-attest-v1 for PR #${pr.number}.`);
}

function dispatchVerification(
  ctx: BootstrapContext,
  pr: PrInfo,
  manifest: ManifestDigest,
  profile: 'quick' | 'full'
): void {
  const payload = buildVerificationPayload(pr, manifest, profile);
  const args = [
    'api', '-X', 'POST', '/repos/{owner}/{repo}/dispatches',
    '-f', `event_type=sec-verify-frozen-v1`,
    '-f', `client_payload[schema]=${payload.schema}`,
    '-F', `client_payload[pull_request]=${payload.pull_request}`,
    '-f', `client_payload[expected_head]=${payload.expected_head}`,
    '-f', `client_payload[expected_base]=${payload.expected_base}`,
    '-f', `client_payload[manifest_path]=${payload.manifest_path}`,
    '-f', `client_payload[manifest_digest]=${payload.manifest_digest}`,
    '-f', `client_payload[profile]=${payload.profile}`
  ];
  const result = ctx.runShell('gh', args, { cwd: ctx.repositoryRoot });
  if (result.status !== 0) {
    fail(`Failed to dispatch sec-verify-frozen-v1: ${result.stderr.trim()}`);
  }
  logInfo(`Dispatched sec-verify-frozen-v1 for PR #${pr.number} (profile=${profile}).`);
}

function listWorkflowRuns(
  ctx: BootstrapContext,
  workflowId: string,
  event: string,
  limit: number
): WorkflowRunSummary[] {
  const result = ctx.runShell('gh', [
    'run', 'list',
    `--workflow=${workflowId}`,
    `--event=${event}`,
    `--limit=${limit}`,
    '--json', 'databaseId,status,conclusion,displayTitle,headSha'
  ], { cwd: ctx.repositoryRoot });
  if (result.status !== 0) {
    fail(`Failed to list workflow runs for ${workflowId}: ${result.stderr.trim()}`);
  }
  return parseWorkflowRuns(result.stdout);
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
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const runs = listWorkflowRuns(ctx, workflowId, event, 20);
      const matching = runs
        .filter((run) => run.displayTitle === expectedTitle && run.headSha === expectedHeadSha)
        .sort((left, right) => right.databaseId - left.databaseId);
      if (matching.length > 0) {
        const latest = matching[0]!;
        if (latest.status === 'completed') {
          if (latest.conclusion !== 'success') {
            fail(`Workflow run ${latest.databaseId} (${workflowId}) completed with conclusion=${latest.conclusion}.`);
          }
          logInfo(`Workflow run ${latest.databaseId} (${workflowId}) completed successfully.`);
          return latest;
        }
        logInfo(`Workflow run ${latest.databaseId} (${workflowId}) status=${latest.status}; polling...`);
      } else {
        logInfo(`No matching run yet for "${expectedTitle}" head=${expectedHeadSha}; polling...`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logWarn(`Polling error: ${lastError}`);
    }
    const sleepMs = Math.min(pollIntervalMs, deadline - Date.now());
    if (sleepMs > 0) {
      spawnSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${sleepMs}`], { windowsHide: true });
    }
  }
  fail(`Timed out waiting for workflow run (${workflowId}) title="${expectedTitle}" head=${expectedHeadSha}. Last error: ${lastError}`);
}

function resolveHeadParents(ctx: BootstrapContext, headSha: string): string[] {
  const result = ctx.runShell('git', ['log', '--format=%P', '-n', '1', headSha], { cwd: ctx.repositoryRoot });
  if (result.status !== 0) {
    fail(`Failed to resolve parents of ${headSha}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim().split(/\s+/u).filter(Boolean);
}

function ensureSingleParent(ctx: BootstrapContext, pr: PrInfo): void {
  const parents = resolveHeadParents(ctx, pr.headSha);
  if (!shouldSquashToSingleParent(parents, pr.baseSha)) {
    logInfo(`PR #${pr.number} head ${pr.headSha.slice(0, 8)} is already single-parent (parent=${parents[0]!.slice(0, 8)}).`);
    return;
  }
  logInfo(`PR #${pr.number} head has ${parents.length} parents; squashing to single-parent base ${pr.baseSha.slice(0, 8)}.`);
  // Use the PR title as the squashed commit message so the branch head reflects
  // the feature intent regardless of how many commits the branch accumulated.
  const commitMessage = `${pr.title}\n`;
  // Checkout the PR head branch, reset --soft to base, commit (not --amend), force-push.
  // Using `git commit` (not `--amend`) is critical: after `reset --soft <base>`,
  // HEAD is <base>, so `--amend` would rewrite <base> and produce a commit whose
  // parent is <base>'s parent — breaking the single-parent-base invariant.
  // A fresh `git commit -F <file>` creates a new commit with parent === <base>.
  const checkoutResult = ctx.runShell('git', ['checkout', pr.headBranch], { cwd: ctx.repositoryRoot });
  if (checkoutResult.status !== 0) {
    fail(`Failed to checkout branch ${pr.headBranch}: ${checkoutResult.stderr.trim()}`);
  }
  const resetResult = ctx.runShell('git', ['reset', '--soft', pr.baseSha], { cwd: ctx.repositoryRoot });
  if (resetResult.status !== 0) {
    fail(`Failed to git reset --soft ${pr.baseSha}: ${resetResult.stderr.trim()}`);
  }
  const messageDir = mkdtempSync(path.join(ctx.repositoryRoot, '.tmp', 'squash-msg-'));
  const messageFile = path.join(messageDir, 'COMMIT_MSG');
  try {
    writeFileSync(messageFile, commitMessage, 'utf8');
    const commitResult = ctx.runShell('git', ['commit', '--no-verify', '-F', messageFile], { cwd: ctx.repositoryRoot });
    if (commitResult.status !== 0) {
      fail(`Failed to git commit: ${commitResult.stderr.trim()}`);
    }
  } finally {
    rmSync(messageDir, { recursive: true, force: true });
  }
  const pushResult = ctx.runShell('git', ['push', '--force-with-lease', 'origin', pr.headBranch], { cwd: ctx.repositoryRoot });
  if (pushResult.status !== 0) {
    fail(`Failed to git push --force-with-lease origin ${pr.headBranch}: ${pushResult.stderr.trim()}`);
  }
  // Update local head SHA after force-push.
  const newHeadResult = ctx.runShell('git', ['rev-parse', 'HEAD'], { cwd: ctx.repositoryRoot });
  if (newHeadResult.status !== 0) {
    fail(`Failed to resolve new HEAD after squash: ${newHeadResult.stderr.trim()}`);
  }
  pr.headSha = newHeadResult.stdout.trim();
  logInfo(`Squashed PR #${pr.number} to new head ${pr.headSha.slice(0, 8)}.`);
}

function adminSquashMerge(ctx: BootstrapContext, pr: PrInfo): void {
  const result = ctx.runShell('gh', [
    'pr', 'merge', String(pr.number),
    '--admin',
    '--squash',
    '--delete-branch'
  ], { cwd: ctx.repositoryRoot });
  if (result.status !== 0) {
    fail(`Failed to admin squash merge PR #${pr.number}: ${result.stderr.trim()}`);
  }
  logInfo(`Admin squash merged PR #${pr.number}.`);
}

function postMergeCheckoutMain(ctx: BootstrapContext): string {
  const checkoutResult = ctx.runShell('git', ['checkout', 'main'], { cwd: ctx.repositoryRoot });
  if (checkoutResult.status !== 0) {
    fail(`Failed to checkout main: ${checkoutResult.stderr.trim()}`);
  }
  const pullResult = ctx.runShell('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: ctx.repositoryRoot });
  if (pullResult.status !== 0) {
    fail(`Failed to pull main: ${pullResult.stderr.trim()}`);
  }
  const headResult = ctx.runShell('git', ['rev-parse', 'HEAD'], { cwd: ctx.repositoryRoot });
  if (headResult.status !== 0) {
    fail(`Failed to resolve main HEAD: ${headResult.stderr.trim()}`);
  }
  const mainSha = headResult.stdout.trim();
  logInfo(`Local main updated to ${mainSha.slice(0, 8)}.`);
  return mainSha;
}

function postMergePointerPatch(ctx: BootstrapContext, pr: PrInfo, manifest: ManifestDigest): void {
  const mainSha = postMergeCheckoutMain(ctx);
  // Check if manifest was archived to docs/archive/work-packages/.
  const archivePath = pr.manifestPath.replace('docs/work-packages/', 'docs/archive/work-packages/');
  const archiveResult = ctx.runShell('git', ['show', `${mainSha}:${archivePath}`], { cwd: ctx.repositoryRoot });
  const archived = archiveResult.status === 0;
  const activePointerPath = path.join(ctx.repositoryRoot, 'docs', 'work', 'active-work-package.md');
  const rollingPlanPath = path.join(ctx.repositoryRoot, 'docs', 'work', 'rolling-plan.md');
  // Update active-work-package.md: if manifest archived, set pointer to resolved state.
  if (archived) {
    const pointerContent = readFileSync(activePointerPath, 'utf8');
    const updated = pointerContent
      .replace(/^status:\s*conditional$/mu, 'status: resolved')
      .replace(/^manifest:\s*.*$/mu, `manifest: ${archivePath}`)
      .replace(/^manifestDigest:\s*.*$/mu, `manifestDigest: ${manifest.digest}`)
      .replace(/^matchingDefaultBlob:\s*none$/mu, `matchingDefaultBlob: ${manifest.blobSha}`);
    writeFileSync(activePointerPath, updated, 'utf8');
    logInfo(`Patched active-work-package.md to resolved state (manifest archived to ${archivePath}).`);
  } else {
    logInfo(`Manifest not archived; active-work-package.md pointer unchanged (still conditional).`);
  }
  // Commit pointer patch.
  const addResult = ctx.runShell('git', ['add', activePointerPath, rollingPlanPath], { cwd: ctx.repositoryRoot });
  if (addResult.status !== 0) {
    logWarn(`git add pointer files failed: ${addResult.stderr.trim()}`);
    return;
  }
  const statusResult = ctx.runShell('git', ['status', '--porcelain'], { cwd: ctx.repositoryRoot });
  if (statusResult.status !== 0 || statusResult.stdout.trim().length === 0) {
    logInfo(`No pointer changes to commit.`);
    return;
  }
  const commitResult = ctx.runShell('git', [
    'commit', '-m', `docs: post-merge pointer patch for PR #${pr.number}`
  ], { cwd: ctx.repositoryRoot });
  if (commitResult.status !== 0) {
    fail(`Failed to commit pointer patch: ${commitResult.stderr.trim()}`);
  }
  const pushResult = ctx.runShell('git', ['push', 'origin', 'main'], { cwd: ctx.repositoryRoot });
  if (pushResult.status !== 0) {
    fail(`Failed to push pointer patch: ${pushResult.stderr.trim()}`);
  }
  logInfo(`Post-merge pointer patch pushed to main.`);
}

function cleanupBranches(ctx: BootstrapContext, pr: PrInfo): void {
  // Local branch deletion (ignore failure if already gone).
  const localDelete = ctx.runShell('git', ['branch', '-D', pr.headBranch], { cwd: ctx.repositoryRoot });
  if (localDelete.status === 0) {
    logInfo(`Deleted local branch ${pr.headBranch}.`);
  } else {
    logInfo(`Local branch ${pr.headBranch} not present (already deleted).`);
  }
  // Remote branch deletion (ignore failure if already gone via --delete-branch in merge).
  const remoteDelete = ctx.runShell('gh', [
    'api', '-X', 'DELETE', `/repos/{owner}/{repo}/git/refs/heads/${pr.headBranch}`
  ], { cwd: ctx.repositoryRoot });
  if (remoteDelete.status === 0) {
    logInfo(`Deleted remote branch ${pr.headBranch}.`);
  } else {
    logInfo(`Remote branch ${pr.headBranch} not present (already deleted by --delete-branch).`);
  }
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

function commandDigest(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  const manifest = resolveManifestDigest(ctx, pr);
  process.stdout.write(
    JSON.stringify({
      pr: pr.number,
      head: pr.headSha,
      base: pr.baseSha,
      manifestPath: pr.manifestPath,
      manifestDigest: manifest.digest,
      manifestBlobSha: manifest.blobSha,
      manifestByteLength: manifest.byteLength
    }, null, 2) + '\n'
  );
}

function commandAttest(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  const manifest = resolveManifestDigest(ctx, pr);
  dispatchScopeAttest(ctx, pr, manifest);
  logInfo(`Waiting for sec-scope-attest-v1 workflow run to complete...`);
  const expectedTitle = `sec-scope-attest-v1 PR #${pr.number} head ${pr.headSha} base ${pr.baseSha} manifest ${manifest.digest}`;
  waitForWorkflowRun(
    ctx,
    'sec-merge-gate.yml',
    'repository_dispatch',
    expectedTitle,
    pr.baseSha,
    10 * 60 * 1000,
    15 * 1000
  );
}

function commandVerify(ctx: BootstrapContext, prNumber: number, profile: 'quick' | 'full'): void {
  const pr = resolvePrInfo(ctx, prNumber);
  const manifest = resolveManifestDigest(ctx, pr);
  dispatchVerification(ctx, pr, manifest, profile);
  logInfo(`Waiting for sec-verify-frozen-v1 workflow run to complete...`);
  const expectedTitle = `verify frozen PR #${pr.number} ${profile} @ ${pr.headSha} base ${pr.baseSha}`;
  waitForWorkflowRun(
    ctx,
    'compiler-pr-validation.yml',
    'repository_dispatch',
    expectedTitle,
    pr.baseSha,
    90 * 60 * 1000,
    30 * 1000
  );
}

function commandSquash(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  ensureSingleParent(ctx, pr);
  process.stdout.write(
    JSON.stringify({ pr: pr.number, head: pr.headSha, singleParent: true }) + '\n'
  );
}

function commandMerge(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  adminSquashMerge(ctx, pr);
}

function commandPatch(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  const manifest = resolveManifestDigest(ctx, pr);
  postMergePointerPatch(ctx, pr, manifest);
}

function commandCleanup(ctx: BootstrapContext, prNumber: number): void {
  const pr = resolvePrInfo(ctx, prNumber);
  cleanupBranches(ctx, pr);
}

function commandAll(ctx: BootstrapContext, options: BootstrapOptions): void {
  const { prNumber, profile = 'full' } = options;
  logInfo(`Starting full bootstrap flow for PR #${prNumber} (profile=${profile}).`);
  // 1. Resolve PR + manifest digest.
  const pr = resolvePrInfo(ctx, prNumber);
  const manifest = resolveManifestDigest(ctx, pr);
  logInfo(`Manifest digest: ${manifest.digest}`);
  // 2. Dispatch scope attestation + wait.
  dispatchScopeAttest(ctx, pr, manifest);
  const attestTitle = `sec-scope-attest-v1 PR #${pr.number} head ${pr.headSha} base ${pr.baseSha} manifest ${manifest.digest}`;
  waitForWorkflowRun(ctx, 'sec-merge-gate.yml', 'repository_dispatch', attestTitle, pr.baseSha, 10 * 60 * 1000, 15 * 1000);
  // 3. Dispatch verification + wait.
  dispatchVerification(ctx, pr, manifest, profile);
  const verifyTitle = `verify frozen PR #${pr.number} ${profile} @ ${pr.headSha} base ${pr.baseSha}`;
  waitForWorkflowRun(ctx, 'compiler-pr-validation.yml', 'repository_dispatch', verifyTitle, pr.baseSha, 90 * 60 * 1000, 30 * 1000);
  // 4. Ensure single-parent.
  ensureSingleParent(ctx, pr);
  // 5. Admin squash merge.
  adminSquashMerge(ctx, pr);
  // 6. Post-merge pointer patch.
  postMergePointerPatch(ctx, pr, manifest);
  // 7. Branch cleanup.
  cleanupBranches(ctx, pr);
  logInfo(`Bootstrap flow complete for PR #${prNumber}.`);
}

// ---------------------------------------------------------------------------
// CLI main
// ---------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): {
  command: string;
  prNumber: number;
  profile: 'quick' | 'full';
} {
  const args = [...argv];
  if (args.length === 0) {
    fail('Usage: sec-merge-bootstrap.ts <command> --pr <n> [--profile <quick|full>]');
  }
  const command = args[0]!;
  const rest = args.slice(1);
  let prNumber: number | null = null;
  let profile: 'quick' | 'full' = 'full';
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === '--pr') {
      const value = rest[index + 1];
      if (!value || !/^\d+$/u.test(value)) fail('--pr requires a positive integer.');
      prNumber = Number.parseInt(value, 10);
      index += 1;
    } else if (arg === '--profile') {
      const value = rest[index + 1];
      if (value !== 'quick' && value !== 'full') fail('--profile requires quick or full.');
      profile = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (prNumber === null) {
    fail('--pr is required and must be a positive integer.');
  }
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    fail('--pr is required and must be a positive integer.');
  }
  return { command, prNumber, profile };
}

const USAGE = `Usage: bun scripts/codex/sec-merge-bootstrap.ts <command> --pr <n> [--profile <quick|full>]

Commands:
  digest --pr <n>                          Print manifest digest + blob SHA.
  attest --pr <n>                           Trigger scope attestation dispatch.
  verify --pr <n> --profile <quick|full>    Trigger frozen verification dispatch.
  squash --pr <n>                           Ensure single-parent head (squash if needed).
  merge --pr <n>                            Admin squash merge.
  patch --pr <n>                            Post-merge pointer patch.
  cleanup --pr <n>                          Delete local + remote feature branch.
  all --pr <n> --profile <quick|full>       Run entire flow end-to-end.
`;

function main(): void {
  const { command, prNumber, profile } = parseArgs(process.argv.slice(2));
  const ctx: BootstrapContext = {
    repositoryRoot: process.cwd(),
    runShell: defaultShellRunner
  };
  switch (command) {
    case 'digest':
      commandDigest(ctx, prNumber);
      break;
    case 'attest':
      commandAttest(ctx, prNumber);
      break;
    case 'verify':
      commandVerify(ctx, prNumber, profile);
      break;
    case 'squash':
      commandSquash(ctx, prNumber);
      break;
    case 'merge':
      commandMerge(ctx, prNumber);
      break;
    case 'patch':
      commandPatch(ctx, prNumber);
      break;
    case 'cleanup':
      commandCleanup(ctx, prNumber);
      break;
    case 'all':
      commandAll(ctx, { prNumber, profile });
      break;
    default:
      fail(`Unknown command: ${command}\n${USAGE}`);
  }
}

if (import.meta.main) {
  main();
}
