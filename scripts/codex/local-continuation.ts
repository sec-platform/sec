#!/usr/bin/env bun
/**
 * Managed cross-session continuation for SEC development.
 *
 * An upstream handoff is admitted exactly once against local Git objects and
 * frozen Work Package ownership, then persisted as a content-addressed runtime
 * snapshot outside the repository tree. Subsequent `dev:continue` calls reuse
 * that snapshot without GitHub reads until an explicit external-authority
 * boundary invalidates the relevant facts.
 *
 * This command never owns Verification PASS, Review, MainHealth,
 * IntegrationAuthorization, status publication, or merge authority.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  gitChangedFileDiffArgs,
  gitUntrackedFileArgs,
  parseGitChangedRecordsOutput,
  parseGitUntrackedFileOutput,
  type CodexDevelopmentGitChangedRecordV1
} from '../../platform/shared/ci-git-changed-files.ts';
import {
  compileContinuationInvalidationV1,
  type ContinuationExternalBoundaryV1,
  type ContinuationInvalidationDecisionV1,
  type ContinuationLocalStateV1
} from '../../platform/shared/continuation-invalidation-contract.ts';
import {
  admitLocalContinuationV1,
  parseLocalContinuationCheckpointV1,
  type LocalContinuationAdmissionV1,
  type LocalContinuationCheckpointV1,
  type LocalContinuationObservationV1
} from '../../platform/shared/local-continuation-checkpoint.ts';
import type { SecRuntimeStateLayoutV1 } from '../../platform/shared/sec-runtime-state-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  clearActiveContinuationV1,
  gcContinuationObjectsV1,
  loadActiveContinuationCheckpointV1,
  persistActiveContinuationCheckpointV1,
  resolveSecRuntimeStateFromWorkspaceLocatorV1
} from '../../tooling/sec-dev/continuation-runtime-store.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state.ts';
import { createBranchLifecycleGitChildEnvironmentV1 } from './branch-lifecycle-command.ts';
import {
  CodexDevelopmentDefaultChangedPathsV1,
  CodexDevelopmentDefaultTrackedTreeIsCleanV1
} from './ci-orchestration-core.ts';
import {
  CodexDevelopmentAssertWorkPackageChangedRecords,
  CodexDevelopmentParseCurrentWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest
} from './work-package-contract.ts';

const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const GIT_TIMEOUT_MS = 60_000;

export const MANAGED_DEVELOPMENT_CONTINUATION_SCHEMA_V1 =
  'sec-managed-development-continuation-v1' as const;

export interface ContinueOptionsV1 {
  readonly handoffPath: string | null;
  readonly boundary: ContinuationExternalBoundaryV1;
  readonly externalChanged: boolean;
  readonly terminal: boolean;
  readonly json: boolean;
}

export interface ManagedDevelopmentContinuationV1 {
  readonly schema: typeof MANAGED_DEVELOPMENT_CONTINUATION_SCHEMA_V1;
  readonly authority: 'context-compression-only';
  readonly repository: string;
  readonly prNumber: number;
  readonly branch: string;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly upstreamHeadSha: string;
  readonly upstreamHeadTreeSha: string;
  readonly currentHeadSha: string;
  readonly currentHeadTreeSha: string;
  readonly worktreeClean: boolean;
  readonly localState: ContinuationLocalStateV1;
  readonly importedAdmission: LocalContinuationAdmissionV1 | null;
  readonly invalidation: ContinuationInvalidationDecisionV1;
  readonly runtimeState: Readonly<{
    repositoryKey: `sha256:${string}`;
    workspaceKey: `sha256:${string}`;
    checkpointDigest: `sha256:${string}`;
    managedExternallyFromRepositoryTree: true;
  }>;
  readonly gc: Readonly<{ scanned: number; removed: number; retained: number }>;
}

function fail(message: string): never {
  throw new Error(`LocalContinuation ${message}`);
}

function runGit(cwd: string, args: readonly string[], acceptedCodes: readonly number[] = [0]): Buffer {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: createBranchLifecycleGitChildEnvironmentV1(process.env)
  });
  if (!acceptedCodes.includes(result.status ?? -1)) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8').slice(0, 4096) : '';
    fail(`git ${args[0] ?? 'command'} failed (${result.status ?? 'null'}): ${stderr}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? ''));
}

function utf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`LocalContinuation ${label} is not UTF-8.`, { cause: error });
  }
}

function line(cwd: string, args: readonly string[], label: string): string {
  const value = utf8(runGit(cwd, args), label).trim();
  if (value.length === 0) fail(`${label} is empty.`);
  return value;
}

function gitSha(cwd: string, ref: string, label: string): string {
  const value = line(cwd, ['rev-parse', '--verify', ref], label);
  if (!/^[0-9a-f]{40}$/u.test(value)) fail(`${label} is not a lowercase Git SHA.`);
  return value;
}

function workingTreeChangedRecords(root: string): readonly CodexDevelopmentGitChangedRecordV1[] {
  const tracked = parseGitChangedRecordsOutput(runGit(root, gitChangedFileDiffArgs(undefined, 'HEAD')));
  const untracked = parseGitUntrackedFileOutput(runGit(root, gitUntrackedFileArgs()))
    .map((filePath) => Object.freeze({ status: 'added' as const, path: filePath }));
  return Object.freeze([...tracked, ...untracked]);
}

function repositoryRoot(cwd: string): string {
  return path.resolve(line(cwd, ['rev-parse', '--show-toplevel'], 'repository root'));
}

function checkpointStillControlsHead(
  root: string,
  checkpoint: LocalContinuationCheckpointV1,
  headSha: string
): boolean {
  let mergeBase: string;
  try {
    mergeBase = line(root, ['merge-base', checkpoint.baseSha, headSha], 'checkpoint base ancestry');
  } catch {
    return false;
  }
  if (mergeBase !== checkpoint.baseSha) return false;

  try {
    const manifestBytes = runGit(root, [
      'show', `${checkpoint.headSha}:${checkpoint.manifestPath}`
    ]);
    const manifest = CodexDevelopmentParseCurrentWorkPackageManifestV1(
      utf8(manifestBytes, 'managed manifest bytes'),
      checkpoint.manifestPath
    );
    const changed = CodexDevelopmentDefaultChangedPathsV1(root, checkpoint.baseSha, headSha);
    if (changed === null || changed.records.length === 0) return false;
    CodexDevelopmentAssertWorkPackageChangedRecords(manifest, changed.records);
    const workingTreeRecords = workingTreeChangedRecords(root);
    if (workingTreeRecords.length > 0) {
      CodexDevelopmentAssertWorkPackageChangedRecords(manifest, workingTreeRecords);
    }
    return true;
  } catch {
    return false;
  }
}

export function observeLocalContinuationV1(input: Readonly<{
  cwd: string;
  checkpointSource: string;
}>): Readonly<{
  observation: LocalContinuationObservationV1;
  admission: LocalContinuationAdmissionV1;
}> {
  const checkpoint = parseLocalContinuationCheckpointV1(input.checkpointSource);
  const root = repositoryRoot(input.cwd);
  const branch = line(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 'candidate branch');
  const headSha = gitSha(root, 'HEAD^{commit}', 'candidate head');
  const headTreeSha = gitSha(root, 'HEAD^{tree}', 'candidate tree');
  const commitLine = line(root, ['rev-list', '--parents', '-n', '1', 'HEAD'], 'candidate parents')
    .split(/\s+/u);
  if (commitLine[0] !== headSha) fail('candidate parent record does not begin with exact HEAD.');
  const parentShas = Object.freeze(commitLine.slice(1));
  const baseTreeSha = gitSha(root, `${checkpoint.baseSha}^{tree}`, 'base tree');
  const worktreeClean = CodexDevelopmentDefaultTrackedTreeIsCleanV1(root);

  const manifestBytes = runGit(root, [
    'show', `${checkpoint.headSha}:${checkpoint.manifestPath}`
  ]);
  const manifestSource = utf8(manifestBytes, 'manifest bytes');
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifestV1(manifestSource, checkpoint.manifestPath);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes) as `sha256:${string}`;

  const changed = CodexDevelopmentDefaultChangedPathsV1(
    root,
    checkpoint.baseSha,
    checkpoint.headSha
  );
  if (changed === null || changed.records.length === 0) {
    fail('canonical candidate delta is unresolved or empty.');
  }
  const ownership = CodexDevelopmentAssertWorkPackageChangedRecords(manifest, changed.records);

  const observation: LocalContinuationObservationV1 = Object.freeze({
    repositoryRoot: root,
    branch,
    headSha,
    headTreeSha,
    parentShas,
    baseTreeSha,
    worktreeClean,
    manifestPath: checkpoint.manifestPath,
    manifestDigest,
    workPackageId: manifest.id,
    tracking: manifest.tracking,
    manifestBaseSha: manifest.base,
    requiredProfile: manifest.requiredProfile,
    ciRevision: manifest.ciRevision,
    changedPathCount: ownership.changedPathOwners.length,
    ownershipChecked: true as const
  });
  return Object.freeze({
    observation,
    admission: admitLocalContinuationV1({ checkpoint, observation })
  });
}

function observeManagedLocalState(root: string, checkpoint: LocalContinuationCheckpointV1): Readonly<{
  state: ContinuationLocalStateV1;
  branch: string;
  headSha: string;
  headTreeSha: string;
  worktreeClean: boolean;
}> {
  const branch = line(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 'candidate branch');
  const headSha = gitSha(root, 'HEAD^{commit}', 'candidate head');
  const headTreeSha = gitSha(root, 'HEAD^{tree}', 'candidate tree');
  const baseTreeSha = gitSha(root, `${checkpoint.baseSha}^{tree}`, 'base tree');
  const worktreeClean = CodexDevelopmentDefaultTrackedTreeIsCleanV1(root);
  if (branch !== checkpoint.branch || baseTreeSha !== checkpoint.baseTreeSha
      || !checkpointStillControlsHead(root, checkpoint, headSha)) {
    return Object.freeze({ state: 'control-drift', branch, headSha, headTreeSha, worktreeClean });
  }
  const state: ContinuationLocalStateV1 = headSha === checkpoint.headSha
    && headTreeSha === checkpoint.headTreeSha && worktreeClean
    ? 'exact-snapshot'
    : 'local-candidate-diverged';
  return Object.freeze({ state, branch, headSha, headTreeSha, worktreeClean });
}

function usage(): never {
  console.error(
    'Usage: bun scripts/codex/local-continuation.ts continue [--handoff <external.json>] '
    + '[--boundary <none|review|main-health|authorization|merge|closeout>] '
    + '[--external-changed] [--terminal] [--json]'
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): ContinueOptionsV1 {
  if (argv[0] !== 'continue') usage();
  let handoffPath: string | null = null;
  let boundary: ContinuationExternalBoundaryV1 = 'none';
  let externalChanged = false;
  let terminal = false;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--json') {
      if (json) usage();
      json = true;
      continue;
    }
    if (argument === '--external-changed') {
      if (externalChanged) usage();
      externalChanged = true;
      continue;
    }
    if (argument === '--terminal') {
      if (terminal) usage();
      terminal = true;
      continue;
    }
    if (argument === '--handoff') {
      if (handoffPath !== null) usage();
      const value = argv[++index];
      if (value === undefined || value.length === 0 || value.includes('\0')) usage();
      handoffPath = path.resolve(value);
      continue;
    }
    if (argument === '--boundary') {
      const value = argv[++index];
      if (value !== 'none' && value !== 'review' && value !== 'main-health'
          && value !== 'authorization' && value !== 'merge' && value !== 'closeout') usage();
      boundary = value;
      continue;
    }
    usage();
  }
  if (terminal && boundary !== 'none') usage();
  return Object.freeze({ handoffPath, boundary, externalChanged, terminal, json });
}

export async function continueLocalDevelopmentV1(input: Readonly<{
  cwd: string;
  options: ContinueOptionsV1;
}>): Promise<ManagedDevelopmentContinuationV1> {
  const root = repositoryRoot(input.cwd);
  let checkpoint: LocalContinuationCheckpointV1;
  let importedAdmission: LocalContinuationAdmissionV1 | null = null;
  let layout: SecRuntimeStateLayoutV1;

  if (input.options.handoffPath !== null) {
    const source = readFileSync(input.options.handoffPath, 'utf8');
    const admitted = observeLocalContinuationV1({ cwd: root, checkpointSource: source });
    checkpoint = parseLocalContinuationCheckpointV1(source);
    importedAdmission = admitted.admission;
    layout = resolveSecRuntimeStateForRepositoryV1({
      repository: checkpoint.repository,
      repositoryRoot: root
    });
    await persistActiveContinuationCheckpointV1({ layout, repositoryRoot: root, checkpoint });
  } else {
    const located = await resolveSecRuntimeStateFromWorkspaceLocatorV1({ repositoryRoot: root });
    if (located === null) {
      fail('no managed continuation exists for this workspace; import one upstream handoff once with --handoff.');
    }
    layout = located.layout;
    const active = await loadActiveContinuationCheckpointV1({ layout, repositoryRoot: root });
    if (active === null) fail('workspace locator has no active continuation pointer; import a new upstream handoff.');
    checkpoint = active;
  }

  const local = observeManagedLocalState(root, checkpoint);
  const invalidation = compileContinuationInvalidationV1({
    checkpointDigest: checkpoint.checkpointDigest,
    localState: local.state,
    externalChangeKnown: input.options.externalChanged,
    externalBoundary: input.options.boundary,
    sessionTerminal: input.options.terminal
  });

  let gc: Readonly<{ scanned: number; removed: number; retained: number }> =
    Object.freeze({ scanned: 0, removed: 0, retained: 0 });
  if (input.options.externalChanged
      || invalidation.checkpointLifecycle === 'terminal'
      || invalidation.disposition === 'invalidate-control') {
    await clearActiveContinuationV1({ layout, repositoryRoot: root });
    gc = await gcContinuationObjectsV1({
      layout,
      repositoryRoot: root,
      ...(invalidation.checkpointLifecycle === 'terminal' ? { retentionMs: 0 } : {})
    });
  } else {
    gc = await gcContinuationObjectsV1({ layout, repositoryRoot: root });
  }

  return Object.freeze({
    schema: MANAGED_DEVELOPMENT_CONTINUATION_SCHEMA_V1,
    authority: 'context-compression-only',
    repository: checkpoint.repository,
    prNumber: checkpoint.prNumber,
    branch: checkpoint.branch,
    baseSha: checkpoint.baseSha,
    baseTreeSha: checkpoint.baseTreeSha,
    upstreamHeadSha: checkpoint.headSha,
    upstreamHeadTreeSha: checkpoint.headTreeSha,
    currentHeadSha: local.headSha,
    currentHeadTreeSha: local.headTreeSha,
    worktreeClean: local.worktreeClean,
    localState: local.state,
    importedAdmission,
    invalidation,
    runtimeState: Object.freeze({
      repositoryKey: layout.repositoryKey,
      workspaceKey: layout.workspaceKey,
      checkpointDigest: checkpoint.checkpointDigest,
      managedExternallyFromRepositoryTree: true as const
    }),
    gc
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await continueLocalDevelopmentV1({ cwd: process.cwd(), options });
  if (options.json) {
    process.stdout.write(`${encodeVerificationActionDataV2(result)}\n`);
    return;
  }
  console.log(`SEC continuation: ${result.localState}; ${result.invalidation.disposition}`);
  console.log(`candidate: ${result.currentHeadSha} tree ${result.currentHeadTreeSha}`);
  console.log(`remote owners: ${JSON.stringify(result.invalidation.remoteOwners)}`);
  console.log('This continuation is context compression only; physical authority remains with canonical owners.');
}

if (import.meta.main) await main();
