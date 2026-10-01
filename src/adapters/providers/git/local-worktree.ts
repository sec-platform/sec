/** Native Git repository observations and detached scratch creation over retained roots. */
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { settleResources } from '../../../execution/resource-settlement.ts';
import { parseWorktreePorcelainZ } from '../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { RetainedCommandAuxiliaryInput } from '../../runtime-state/physical/runtime/retained-command-boundary.ts';
import { canonicalGitChildEnvironment } from './environment.ts';
import {
  assertGitPhysicalProviderCurrentInternal,
  runGitPhysicalCommandInternal,
  type GitPhysicalProviderCapability
} from './physical-provider.ts';

const SAFE_CONFIG = ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false', '-c', 'core.attributesFile=',
  '-c', 'core.quotePath=false', '-c', 'core.bare=false'] as const;
const MAX_METADATA_BYTES = 16 * 1024;
const SETTLED_WORKTREE_ADD_FAILURES = new WeakSet<object>();

/** Only native nonzero results with proven physical process settlement qualify for readback recovery. */
export function isSettledLocalGitWorktreeAddFailure(error: unknown): error is Error {
  return error !== null && typeof error === 'object' && SETTLED_WORKTREE_ADD_FAILURES.has(error);
}

export type LocalGitWorktreeAddIdentity = Readonly<{
  attemptId: string;
  ownerDigest: `sha256:${string}`;
  candidateRoot: string;
  headSha: string;
}>;

type LocalGitWorktreeAddSettlement = LocalGitWorktreeAddIdentity & Readonly<{
  settlementDigest: `sha256:${string}`;
}>;
const LOCAL_GIT_ADD_ATTEMPTS = new Map<string, Readonly<{
  identity: LocalGitWorktreeAddIdentity;
  phase: 'prepared' | 'in-flight-or-unresolved' | 'settled';
  settlement: LocalGitWorktreeAddSettlement | null;
}>>();

/** Scope fencing is independent of the attempt ID a marker currently claims. */
export function hasUnresolvedLocalGitWorktreeAdd(candidateRoot: string): boolean {
  const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return [...LOCAL_GIT_ADD_ATTEMPTS.values()].some((state) =>
    state.phase === 'in-flight-or-unresolved' && key(state.identity.candidateRoot) === key(candidateRoot));
}

/** A marker cannot manufacture a prior prepared/closed attempt after process restart. */
export function observeLocalGitWorktreeAddAttempt(identity: LocalGitWorktreeAddIdentity) {
  const state = LOCAL_GIT_ADD_ATTEMPTS.get(identity.attemptId);
  return state !== undefined && sha256(state.identity) === sha256(identity) ? state : null;
}

/** Physical closure is monotonic, but these run bindings have no authenticated restart reader. */
export function observeLocalGitWorktreeAddSettlement(identity: LocalGitWorktreeAddIdentity): LocalGitWorktreeAddSettlement | null {
  const state = LOCAL_GIT_ADD_ATTEMPTS.get(identity.attemptId);
  return state !== undefined && sha256(state.identity) === sha256(identity) ? state.settlement : null;
}

export function releaseLocalGitWorktreeAddSettlement(identity: LocalGitWorktreeAddIdentity): void {
  const state = LOCAL_GIT_ADD_ATTEMPTS.get(identity.attemptId);
  if (state !== undefined && state.settlement !== null && sha256(state.identity) === sha256(identity)) {
    LOCAL_GIT_ADD_ATTEMPTS.delete(identity.attemptId);
  }
}

export interface LocalGitWorktreeAddFailureActor {
  readonly __negativeLocalGitAddActor?: never;
}
type LocalGitWorktreeAddFailureInput = Readonly<{
  cwd: string; executablePath: string; candidateRoot: string; headSha: string;
  environment: Readonly<Record<string, string>>;
}>;
const LOCAL_GIT_ADD_FAILURE_ACTORS = new WeakMap<object, Readonly<{
  phase: 'before-start' | 'after-start-admission';
  fail(input: LocalGitWorktreeAddFailureInput): Promise<never>;
}>>();

/** Negative-only test actor. It cannot return a result or mint physical closure. */
export function createLocalGitWorktreeAddFailureActorForTests(input: Readonly<{
  phase: 'before-start' | 'after-start-admission';
  fail(input: LocalGitWorktreeAddFailureInput): Promise<never>;
}>): LocalGitWorktreeAddFailureActor {
  const actor = Object.freeze({});
  LOCAL_GIT_ADD_FAILURE_ACTORS.set(actor, Object.freeze({ ...input }));
  return actor;
}

type LocalGitWorktreeAddAttempt = Readonly<{
  attemptId: string;
  ownerDigest: `sha256:${string}`;
  beforeStart(): Promise<void>;
  failureActor?: LocalGitWorktreeAddFailureActor;
}>;

export type LocalGitRepository = Readonly<{
  root: string;
  commonDirectory: string;
  assertCurrent(): void;
  observe(): Promise<Readonly<{ headSha: string; headTreeSha: string; trackedClean: boolean; gitCommonDirectory: string }>>;
  resolveCommit(sha: string): Promise<Readonly<{ headSha: string; headTreeSha: string }>>;
  registrations(): Promise<ReturnType<typeof parseWorktreePorcelainZ>>;
  prepareAddAttempt(ownerDigest: `sha256:${string}`, candidateRoot: string, headSha: string): LocalGitWorktreeAddIdentity;
  addDetached(candidateRoot: string, headSha: string, attempt: LocalGitWorktreeAddAttempt): Promise<void>;
  close(): void;
}>;

/** The caller owns the provider and its process budget; this owner retains Git metadata. */
export function retainLocalGitRepository(provider: GitPhysicalProviderCapability): LocalGitRepository {
  const roots: RetainedNoFollowChildProcessDirectory[] = [];
  const files: Array<Readonly<{ retained: RetainedNoFollowOrdinaryFile; bytes: Buffer }>> = [];
  let closed = false;
  let active = false;
  const dispose = (): void => {
    if (closed) return;
    if (active) throw new Error('Local Git repository cannot close during an active child.');
    closed = true;
    settleResources({ cleanup: [
      ...files.map(({ retained }) => ({ label: 'local-git-metadata', settle: () => retained.dispose() })),
      ...roots.map((root) => ({ label: 'local-git-directory', settle: () => root.dispose() }))
    ] });
  };
  try {
    const root = inspectNoFollowDirectoryChain(provider.cwd, 'local Git repository root');
    const retainDirectory = (directory: string) => {
      const retained = retainNoFollowDirectoryForChildProcess(
        inspectNoFollowDirectoryChain(directory, 'local Git metadata directory'),
        5 + roots.length, 'local Git metadata directory'
      );
      roots.push(retained);
      return retained;
    };
    const metadataText = (directory: string, name: string): string => {
      const retained = retainNoFollowOrdinaryFile(
        inspectNoFollowDirectoryChain(directory, 'local Git metadata parent'), name,
        undefined, 'local Git metadata file'
      );
      try {
        if (retained.size > MAX_METADATA_BYTES || retained.linkCount !== 1) {
          throw new Error('Local Git metadata must be one bounded ordinary file.');
        }
        const bytes = Buffer.from(retained.readBytes());
        files.push({ retained, bytes });
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) { retained.dispose(); throw error; }
    };
    const marker = lstatSync(path.join(root.target.path, '.git')).isDirectory();
    let gitDirectory: string;
    if (marker) {
      gitDirectory = path.join(provider.cwd, '.git');
    } else {
      const source = metadataText(provider.cwd, '.git');
      const match = /^gitdir: ([^\0\r\n]+)\n?$/u.exec(source);
      if (match === null) throw new Error('Local worktree .git marker is invalid.');
      gitDirectory = path.resolve(provider.cwd, match[1]!);
    }
    const git = retainDirectory(gitDirectory);
    let commonDirectory = gitDirectory;
    if (!marker) {
      const common = metadataText(gitDirectory, 'commondir');
      if (!/^[^\0\r\n]+\n?$/u.test(common)) throw new Error('Local worktree common directory marker is invalid.');
      commonDirectory = path.resolve(gitDirectory, common.trimEnd());
      const backlink = metadataText(gitDirectory, 'gitdir').trimEnd();
      if (path.resolve(gitDirectory, backlink) !== path.join(provider.cwd, '.git')) {
        throw new Error('Local worktree registration does not point back to its .git marker.');
      }
      if (path.dirname(gitDirectory) !== path.join(commonDirectory, 'worktrees')) {
        throw new Error('Local worktree administration is outside its common Git registration owner.');
      }
    }
    const common = commonDirectory === gitDirectory ? git : retainDirectory(commonDirectory);
    const assertCurrent = (): void => {
      if (closed) throw new Error('Local Git repository lifetime has ended.');
      assertGitPhysicalProviderCurrentInternal(provider);
      for (const retained of roots) retained.assertCurrent();
      for (const { retained, bytes } of files) {
        retained.assertCurrent();
        if (!Buffer.from(retained.readBytes()).equals(bytes)) throw new Error('Local Git metadata bytes drifted.');
      }
    };
    const run = async (args: readonly string[], extra: readonly RetainedCommandAuxiliaryInput[] = [], worktreeAdd?: Readonly<{ identity: LocalGitWorktreeAddIdentity; beforeStart(): Promise<void> }>) => {
      assertCurrent();
      if (active) throw new Error('Local Git repository is single-flight.');
      active = true;
      try {
      const auxiliary = [...roots.map((capability) => ({ kind: 'directory' as const, capability })), ...extra];
      const command = await runGitPhysicalCommandInternal(provider, [...SAFE_CONFIG, ...args], {
        env: canonicalGitChildEnvironment({
          ...provider.environment, GIT_DIR: git.childPath, GIT_COMMON_DIR: common.childPath,
          // The provider's cwd is retained by the same command boundary.
          GIT_WORK_TREE: process.platform === 'linux' ? '/proc/self/fd/4' : provider.cwd
        }, {}),
        envMode: 'replace', maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 64 * 1024,
        ...(worktreeAdd === undefined ? {} : { beforeSpawn: worktreeAdd.beforeStart })
      }, auxiliary);
      if (worktreeAdd !== undefined) {
        const identity = worktreeAdd.identity;
        const settlement = Object.freeze({ ...identity, settlementDigest: sha256({ identity,
          operationIdentityDigest: provider.operationIdentityDigest, boundAttemptDigest: provider.boundAttemptDigest,
          ordinal: command.ordinal, exitCode: command.result.code, finality: 'exited-tree-closed'
        }) });
        LOCAL_GIT_ADD_ATTEMPTS.set(identity.attemptId, Object.freeze({ identity, phase: 'settled' as const, settlement }));
      }
      assertCurrent();
      if (command.result.code !== 0) {
        const error = new Error(`Local Git command failed: ${command.result.stderr.trim()}`);
        // The retained process owner returns only exited/tree-closed results.
        // Transport, timeout and identity failures throw before this point.
        if (worktreeAdd !== undefined) SETTLED_WORKTREE_ADD_FAILURES.add(error);
        throw error;
      }
      return Buffer.from(command.result.stdout);
      } finally { active = false; }
    };
    const resolveCommit = async (sha: string) => {
      if (sha !== 'HEAD' && !/^[0-9a-f]{40}$/u.test(sha)) throw new Error('Local Git commit identity is invalid.');
      const headSha = (await run(['rev-parse', '--verify', `${sha}^{commit}`])).toString('utf8').trim();
      const headTreeSha = (await run(['rev-parse', '--verify', `${sha}^{tree}`])).toString('utf8').trim();
      if (!/^[0-9a-f]{40}$/u.test(headSha) || !/^[0-9a-f]{40}$/u.test(headTreeSha)) {
        throw new Error('Local Git returned a noncanonical commit or tree identity.');
      }
      return Object.freeze({ headSha, headTreeSha });
    };
    return Object.freeze({ root: provider.cwd, commonDirectory, assertCurrent, resolveCommit,
      observe: async () => {
        const exact = await resolveCommit('HEAD');
        const trackedClean = (await run(['status', '--porcelain=v1', '--untracked-files=all'])).byteLength === 0;
        return Object.freeze({ ...exact, trackedClean, gitCommonDirectory: commonDirectory });
      },
      registrations: async () => parseWorktreePorcelainZ(await run(['worktree', 'list', '--porcelain', '-z'])),
      prepareAddAttempt: (ownerDigest: `sha256:${string}`, candidateRoot: string, headSha: string) => {
        assertCurrent();
        if (hasUnresolvedLocalGitWorktreeAdd(candidateRoot)) throw new Error('Local Git target has an unresolved prior add.');
        const identity = Object.freeze({ attemptId: randomUUID(), ownerDigest, candidateRoot, headSha });
        LOCAL_GIT_ADD_ATTEMPTS.set(identity.attemptId, Object.freeze({ identity, phase: 'prepared' as const, settlement: null }));
        return identity;
      },
      addDetached: async (candidateRoot: string, headSha: string, attempt: LocalGitWorktreeAddAttempt) => {
        if (hasUnresolvedLocalGitWorktreeAdd(candidateRoot)) throw new Error('Local Git target has an unresolved prior add.');
        const relative = path.relative(provider.cwd, candidateRoot);
        if (!/^[0-9a-f]{40}$/u.test(headSha) || path.resolve(candidateRoot) !== candidateRoot
          || relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error('Local detached worktree target is invalid.');
        }
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(attempt.attemptId)
          || !/^sha256:[0-9a-f]{64}$/u.test(attempt.ownerDigest)) {
          throw new Error('Local Git add requires a fresh exact attempt identity.');
        }
        const identity = Object.freeze({ attemptId: attempt.attemptId, ownerDigest: attempt.ownerDigest, candidateRoot, headSha });
        const prior = observeLocalGitWorktreeAddAttempt(identity);
        if (prior?.phase !== 'prepared') throw new Error('Local Git add prior attempt is not authentically prepared.');
        const actor = attempt.failureActor === undefined ? undefined : LOCAL_GIT_ADD_FAILURE_ACTORS.get(attempt.failureActor);
        if (attempt.failureActor !== undefined && actor === undefined) throw new Error('Local Git add failure actor is not owner-issued.');
        const beforeStart = async () => {
          LOCAL_GIT_ADD_ATTEMPTS.set(identity.attemptId, Object.freeze({ identity, phase: 'in-flight-or-unresolved' as const, settlement: null }));
          await attempt.beforeStart();
        };
        const parent = retainNoFollowDirectoryForChildProcess(
          inspectNoFollowDirectoryChain(path.dirname(candidateRoot), 'local worktree creation parent'),
          7, 'local worktree creation parent'
        );
        try {
          // Native Git persists the canonical locator. Retaining its parent detects
          // drift around the effect; it does not claim exclusion of every Linux writer.
          if (actor !== undefined) {
            if (actor.phase === 'after-start-admission') await beforeStart();
            await actor.fail(Object.freeze({ cwd: provider.cwd, executablePath: provider.identity.executablePath,
              candidateRoot, headSha, environment: provider.environment }));
            throw new Error('Negative-only local Git add actor returned without failure.');
          }
          await run(['worktree', 'add', '--detach', '--', candidateRoot, headSha],
            [{ kind: 'directory', capability: parent }], { identity, beforeStart });
        } finally { parent.dispose(); }
      },
      close: dispose
    });
  } catch (error) {
    settleResources({ primary: { label: 'local-git-retention', error }, cleanup: [{ label: 'local-git-release', settle: dispose }] });
    throw error;
  }
}
