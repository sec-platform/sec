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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs as parseNativeArgs } from 'node:util';

import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  GIT_READ_DEFAULT_OPERATION_BUDGET,
  type GitReadSession
} from '../../../providers/git-read/runtime/session.ts';

import type { SecRuntimeStateLayout } from '../../../runtime-state/workspace-state/layout.ts';
import { resolveSecRuntimeStateForRepository } from '../../../runtime-state/workspace-state/paths.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { gitChangedFileDiffArgs, gitUntrackedFileArgs, parseGitChangedRecordsOutput, parseGitUntrackedFileOutput, type CodexDevelopmentGitChangedRecord } from '../../../verification/platform/test-impact/runtime/transition.ts';
import {
  CodexDevelopmentAssertWorkPackageChangedRecords,
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../task/contract/work-package.ts';
import {
  admitLocalContinuation,
  parseLocalContinuationCheckpoint,
  type LocalContinuationAdmission,
  type LocalContinuationCheckpoint,
  type LocalContinuationObservation
} from './checkpoint.ts';
import {
  compileContinuationInvalidation,
  type ContinuationExternalBoundary,
  type ContinuationInvalidationDecision,
  type ContinuationLocalState
} from './invalidation.ts';
import {
  clearActiveContinuation,
  gcContinuationObjects,
  loadActiveContinuationCheckpoint,
  persistActiveContinuationCheckpoint,
  resolveSecRuntimeStateFromWorkspaceLocator
} from './runtime-store.ts';

export const MANAGED_DEVELOPMENT_CONTINUATION_SCHEMA =
  'sec-managed-development-continuation-v1' as const;

export interface ContinueOptions {
  readonly handoffPath: string | null;
  readonly boundary: ContinuationExternalBoundary;
  readonly externalChanged: boolean;
  readonly terminal: boolean;
  readonly json: boolean;
}

export interface ManagedDevelopmentContinuation {
  readonly schema: typeof MANAGED_DEVELOPMENT_CONTINUATION_SCHEMA;
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
  readonly localState: ContinuationLocalState;
  readonly importedAdmission: LocalContinuationAdmission | null;
  readonly invalidation: ContinuationInvalidationDecision;
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

async function runGit(
  session: GitReadSession,
  args: readonly string[],
  acceptedCodes: readonly number[] = [0]
): Promise<Buffer> {
  const completed = await session.run(args);
  if (completed.kind !== 'completed') {
    fail(`git ${args[0] ?? 'command'} was blocked: ${completed.reason}.`);
  }
  if (!acceptedCodes.includes(completed.result.code)) {
    fail(`git ${args[0] ?? 'command'} failed (${completed.result.code}): ${completed.result.stderr.slice(0, 4096)}`);
  }
  return Buffer.from(completed.result.stdout);
}

function utf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`LocalContinuation ${label} is not UTF-8.`, { cause: error });
  }
}

async function line(session: GitReadSession, args: readonly string[], label: string): Promise<string> {
  const value = utf8(await runGit(session, args), label).trim();
  if (value.length === 0) fail(`${label} is empty.`);
  return value;
}

async function gitSha(session: GitReadSession, ref: string, label: string): Promise<string> {
  const value = await line(session, ['rev-parse', '--verify', ref], label);
  if (!/^[0-9a-f]{40}$/u.test(value)) fail(`${label} is not a lowercase Git SHA.`);
  return value;
}

async function workingTreeChangedRecords(
  session: GitReadSession
): Promise<readonly CodexDevelopmentGitChangedRecord[]> {
  const tracked = parseGitChangedRecordsOutput(
    await runGit(session, gitChangedFileDiffArgs(undefined, 'HEAD'))
  );
  const untracked = parseGitUntrackedFileOutput(await runGit(session, gitUntrackedFileArgs()))
    .map((filePath) => Object.freeze({ status: 'added' as const, path: filePath }));
  return Object.freeze([...tracked, ...untracked]);
}

async function changedRecordsBetween(
  session: GitReadSession,
  baseSha: string,
  headSha: string
): Promise<readonly CodexDevelopmentGitChangedRecord[]> {
  return Object.freeze(parseGitChangedRecordsOutput(
    await runGit(session, gitChangedFileDiffArgs(baseSha, headSha))
  ));
}

async function repositoryRoot(session: GitReadSession): Promise<string> {
  return path.resolve(await line(session, ['rev-parse', '--show-toplevel'], 'repository root'));
}

async function checkpointStillControlsHead(
  session: GitReadSession,
  checkpoint: LocalContinuationCheckpoint,
  headSha: string,
  workingTreeRecords: readonly CodexDevelopmentGitChangedRecord[]
): Promise<boolean> {
  let mergeBase: string;
  try {
    mergeBase = await line(session, ['merge-base', checkpoint.baseSha, headSha], 'checkpoint base ancestry');
  } catch {
    return false;
  }
  if (mergeBase !== checkpoint.baseSha) return false;

  try {
    const manifestBytes = await runGit(session, [
      'show', `${checkpoint.headSha}:${checkpoint.manifestPath}`
    ]);
    const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
      utf8(manifestBytes, 'managed manifest bytes'),
      checkpoint.manifestPath
    );
    const changedRecords = await changedRecordsBetween(session, checkpoint.baseSha, headSha);
    if (changedRecords.length === 0) return false;
    CodexDevelopmentAssertWorkPackageChangedRecords(manifest, changedRecords);
    if (workingTreeRecords.length > 0) {
      CodexDevelopmentAssertWorkPackageChangedRecords(manifest, workingTreeRecords);
    }
    return true;
  } catch {
    return false;
  }
}

async function observeLocalContinuationWithSession(
  session: GitReadSession,
  input: Readonly<{
  cwd: string;
  checkpointSource: string;
}>
): Promise<Readonly<{
  observation: LocalContinuationObservation;
  admission: LocalContinuationAdmission;
}>> {
  const checkpoint = parseLocalContinuationCheckpoint(input.checkpointSource);
  const root = await repositoryRoot(session);
  const branch = await line(session, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 'candidate branch');
  const headSha = await gitSha(session, 'HEAD^{commit}', 'candidate head');
  const headTreeSha = await gitSha(session, 'HEAD^{tree}', 'candidate tree');
  const commitLine = (await line(session, ['rev-list', '--parents', '-n', '1', 'HEAD'], 'candidate parents'))
    .split(/\s+/u);
  if (commitLine[0] !== headSha) fail('candidate parent record does not begin with exact HEAD.');
  const parentShas = Object.freeze(commitLine.slice(1));
  const baseTreeSha = await gitSha(session, `${checkpoint.baseSha}^{tree}`, 'base tree');
  const workingTreeRecords = await workingTreeChangedRecords(session);
  const worktreeClean = workingTreeRecords.length === 0;

  const manifestBytes = await runGit(session, [
    'show', `${checkpoint.headSha}:${checkpoint.manifestPath}`
  ]);
  const manifestSource = utf8(manifestBytes, 'manifest bytes');
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource, checkpoint.manifestPath);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes) as `sha256:${string}`;

  const changedRecords = await changedRecordsBetween(
    session,
    checkpoint.baseSha,
    checkpoint.headSha
  );
  if (changedRecords.length === 0) {
    fail('canonical candidate delta is unresolved or empty.');
  }
  const ownership = CodexDevelopmentAssertWorkPackageChangedRecords(manifest, changedRecords);

  const observation: LocalContinuationObservation = Object.freeze({
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
    admission: admitLocalContinuation({ checkpoint, observation })
  });
}

export async function observeLocalContinuation(input: Readonly<{
  cwd: string;
  checkpointSource: string;
}>): Promise<Readonly<{
  observation: LocalContinuationObservation;
  admission: LocalContinuationAdmission;
}>> {
  const captured = Object.freeze({
    cwd: path.resolve(input.cwd), checkpointSource: input.checkpointSource
  });
  return withAuthorityGitReadSession(
    { cwd: captured.cwd, budget: GIT_READ_DEFAULT_OPERATION_BUDGET },
    async (session) => observeLocalContinuationWithSession(session, captured)
  );
}

async function observeManagedLocalState(
  session: GitReadSession,
  checkpoint: LocalContinuationCheckpoint
): Promise<Readonly<{
  state: ContinuationLocalState;
  branch: string;
  headSha: string;
  headTreeSha: string;
  worktreeClean: boolean;
}>> {
  const branch = await line(session, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 'candidate branch');
  const headSha = await gitSha(session, 'HEAD^{commit}', 'candidate head');
  const headTreeSha = await gitSha(session, 'HEAD^{tree}', 'candidate tree');
  const baseTreeSha = await gitSha(session, `${checkpoint.baseSha}^{tree}`, 'base tree');
  const workingTreeRecords = await workingTreeChangedRecords(session);
  const worktreeClean = workingTreeRecords.length === 0;
  if (branch !== checkpoint.branch || baseTreeSha !== checkpoint.baseTreeSha
      || !await checkpointStillControlsHead(session, checkpoint, headSha, workingTreeRecords)) {
    return Object.freeze({ state: 'control-drift', branch, headSha, headTreeSha, worktreeClean });
  }
  const state: ContinuationLocalState = headSha === checkpoint.headSha
    && headTreeSha === checkpoint.headTreeSha && worktreeClean
    ? 'exact-snapshot'
    : 'local-candidate-diverged';
  return Object.freeze({ state, branch, headSha, headTreeSha, worktreeClean });
}

function usage(): never {
  console.error(
    'Usage: bun src/adapters/self-hosting/control/continuation/local-continuation.ts continue [--handoff <external.json>] '
    + '[--boundary <none|review|main-health|authorization|merge|closeout>] '
    + '[--external-changed] [--terminal] [--json]'
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): ContinueOptions {
  if (argv[0] !== 'continue') usage();
  let parsed;
  try {
    parsed = parseNativeArgs({
      args: argv.slice(1), strict: true, allowPositionals: false, tokens: true,
      options: {
        handoff: { type: 'string' }, boundary: { type: 'string' },
        'external-changed': { type: 'boolean' },
        terminal: { type: 'boolean' }, json: { type: 'boolean' }
      }
    });
  } catch { usage(); }
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option' || token.inlineValue) usage();
    if (token.name !== 'boundary' && seen.has(token.name)) usage();
    seen.add(token.name);
    if (token.name === 'boundary' && token.value !== 'none' && token.value !== 'review'
        && token.value !== 'main-health' && token.value !== 'authorization'
        && token.value !== 'merge' && token.value !== 'closeout') usage();
  }
  const handoff = parsed.values.handoff;
  if (handoff !== undefined && (handoff.length === 0 || handoff.includes('\0'))) usage();
  const handoffPath = handoff === undefined ? null : path.resolve(handoff);
  const boundary = (parsed.values.boundary ?? 'none') as ContinuationExternalBoundary;
  const externalChanged = parsed.values['external-changed'] ?? false;
  const terminal = parsed.values.terminal ?? false;
  const json = parsed.values.json ?? false;
  if (terminal && boundary !== 'none') usage();
  return Object.freeze({ handoffPath, boundary, externalChanged, terminal, json });
}

export async function continueLocalDevelopment(input: Readonly<{
  cwd: string;
  options: ContinueOptions;
}>): Promise<ManagedDevelopmentContinuation> {
  // Freeze the request decisions, not the observed repository state. Caller
  // mutation during Git IO must not switch the handoff or retire a live session.
  const cwd = path.resolve(input.cwd);
  const { handoffPath, boundary, externalChanged, terminal, json } = input.options;
  const options = Object.freeze({
    handoffPath: handoffPath === null ? null : path.resolve(handoffPath),
    boundary, externalChanged, terminal, json
  });
  return withAuthorityGitReadSession({
    cwd,
    budget: GIT_READ_DEFAULT_OPERATION_BUDGET
  }, async (session) => {
  const root = await repositoryRoot(session);
  let checkpoint: LocalContinuationCheckpoint;
  let importedAdmission: LocalContinuationAdmission | null = null;
  let layout: SecRuntimeStateLayout;

  if (options.handoffPath !== null) {
    const source = readFileSync(options.handoffPath, 'utf8');
    const admitted = await observeLocalContinuationWithSession(session, {
      cwd: root,
      checkpointSource: source
    });
    checkpoint = parseLocalContinuationCheckpoint(source);
    importedAdmission = admitted.admission;
    layout = resolveSecRuntimeStateForRepository({
      repository: checkpoint.repository,
      repositoryRoot: root
    });
    await persistActiveContinuationCheckpoint({ layout, repositoryRoot: root, checkpoint });
  } else {
    const located = await resolveSecRuntimeStateFromWorkspaceLocator({ repositoryRoot: root });
    if (located === null) {
      fail('no managed continuation exists for this workspace; import one upstream handoff once with --handoff.');
    }
    layout = located.layout;
    const active = await loadActiveContinuationCheckpoint({ layout, repositoryRoot: root });
    if (active === null) fail('workspace locator has no active continuation pointer; import a new upstream handoff.');
    checkpoint = active;
  }

  const local = await observeManagedLocalState(session, checkpoint);
  const invalidation = compileContinuationInvalidation({
    checkpointDigest: checkpoint.checkpointDigest,
    localState: local.state,
    externalChangeKnown: options.externalChanged,
    externalBoundary: options.boundary,
    sessionTerminal: options.terminal
  });

  let gc: Readonly<{ scanned: number; removed: number; retained: number }> =
    Object.freeze({ scanned: 0, removed: 0, retained: 0 });
  if (options.externalChanged
      || invalidation.checkpointLifecycle === 'terminal'
      || invalidation.disposition === 'invalidate-control') {
    await clearActiveContinuation({ layout, repositoryRoot: root });
    gc = await gcContinuationObjects({
      layout,
      repositoryRoot: root,
      ...(invalidation.checkpointLifecycle === 'terminal' ? { retentionMs: 0 } : {})
    });
  } else {
    gc = await gcContinuationObjects({ layout, repositoryRoot: root });
  }

  return Object.freeze({
    schema: MANAGED_DEVELOPMENT_CONTINUATION_SCHEMA,
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
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await continueLocalDevelopment({ cwd: process.cwd(), options });
  if (options.json) {
    process.stdout.write(`${encodeVerificationActionData(result)}\n`);
    return;
  }
  console.log(`SEC continuation: ${result.localState}; ${result.invalidation.disposition}`);
  console.log(`candidate: ${result.currentHeadSha} tree ${result.currentHeadTreeSha}`);
  console.log(`remote owners: ${JSON.stringify(result.invalidation.remoteOwners)}`);
  console.log('This continuation is context compression only; physical authority remains with canonical owners.');
}

if (import.meta.main) await main();
