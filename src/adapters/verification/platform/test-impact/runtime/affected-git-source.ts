import { rawSha256, sha256, uniqueSorted } from '../../../../../contracts/canonical.ts';
import type { GitReadSession } from '../../../../providers/git-read/runtime/session.ts';
import {
  CodexDevelopmentCreateTestImpactTransitionObservation,
  gitChangedFileDiffArgs,
  gitIndexChangedFileDiffArgs,
  gitPathBlobBatchArgs,
  gitUntrackedFileArgs,
  gitWorkingTreeStatusArgs,
  gitWorktreeChangedFileDiffArgs,
  parseGitChangedRecordsOutput,
  parseGitPathBlobBatchOutput,
  parseGitUntrackedFileOutput,
  type CodexDevelopmentTestImpactTransitionObservation
} from './transition.ts';

export type AffectedGitSelectionObservation = Readonly<{
  baseSha: string | null;
  headSha: string;
  indexDigest: `sha256:${string}`;
  worktreeDigest: `sha256:${string}`;
  gitExecutable: string;
  gitExecutableIdentity: GitReadSession['gitExecutableIdentity'];
  gitProviderRoute: GitReadSession['providerRoute'];
  gitProviderIdentity: NonNullable<GitReadSession['providerIdentity']>;
}>;

export type IssuedAffectedGitSelectionSource = Readonly<{
  files: readonly string[];
  gitObservation: AffectedGitSelectionObservation;
}>;

type AffectedGitSelectionBindingRecord = Readonly<{
  session: GitReadSession;
  baseRef: string | null;
  transition: CodexDevelopmentTestImpactTransitionObservation | null;
  descriptorChangeRoots: readonly string[];
}>;
const affectedGitSelectionBindings = new WeakMap<object, AffectedGitSelectionBindingRecord>();


function completed(command: Awaited<ReturnType<GitReadSession['run']>>) {
  return command.kind === 'completed' ? command.result : null;
}

function revision(bytes: Uint8Array): string | null {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value) ? value : null;
}

function descriptorRoots(records: readonly { path: string; previousPath?: string }[], untracked: readonly string[]) {
  return uniqueSorted([...records.flatMap(({ path, previousPath }) => [path, previousPath]), ...untracked]
    .flatMap((candidate) => {
      if (candidate === undefined) return [];
      if (candidate === 'module.json') return [''];
      const suffix = '/module.json';
      return candidate.endsWith(suffix) ? [candidate.slice(0, -suffix.length)] : [];
    }));
}

/**
 * Issues the exact Git selection before any Source Program compilation.  The
 * retained process-local binding prevents callers from fabricating a cheap
 * empty selection or reusing an observation with another session/base ref.
 */
export async function issueAffectedGitSelectionSource(input: Readonly<{
  session: GitReadSession;
  baseRef: string | null;
}>): Promise<IssuedAffectedGitSelectionSource | null> {
  const { session } = input;
  let baseSha: string | null = null;
  if (input.baseRef !== null) {
    const result = completed(await session.run(['--no-pager', '-c', 'core.fsmonitor=false', '-c',
      'core.untrackedCache=false', 'rev-parse', '--verify', '--end-of-options', `${input.baseRef}^{commit}`]));
    if (result === null || result.code !== 0 || (baseSha = revision(result.stdout)) === null) return null;
  }
  const head = completed(await session.run(['--no-pager', '-c', 'core.fsmonitor=false', '-c',
    'core.untrackedCache=false', 'rev-parse', '--verify', 'HEAD^{commit}']));
  if (head === null || head.code !== 0) return null;
  const headSha = revision(head.stdout);
  if (headSha === null) return null;
  const staged = completed(await session.run(gitIndexChangedFileDiffArgs(baseSha === null ? 'HEAD' : headSha)));
  const unstaged = completed(await session.run(gitWorktreeChangedFileDiffArgs()));
  const committed = baseSha === null ? null : completed(await session.run(gitChangedFileDiffArgs(baseSha, headSha)));
  const untracked = completed(await session.run(gitUntrackedFileArgs()));
  const status = completed(await session.run(gitWorkingTreeStatusArgs()));
  const index = completed(await session.run(['--no-pager', '-c', 'core.fsmonitor=false', '-c',
    'core.untrackedCache=false', 'ls-files', '--stage', '-z']));
  if ([staged, unstaged, untracked, status, index].some((value) => value === null || value.code !== 0)
      || (baseSha !== null && (committed === null || committed.code !== 0))) return null;
  const stagedRecords = parseGitChangedRecordsOutput(staged!.stdout);
  const unstagedRecords = parseGitChangedRecordsOutput(unstaged!.stdout);
  const committedRecords = committed === null ? [] : parseGitChangedRecordsOutput(committed.stdout);
  const untrackedPaths = parseGitUntrackedFileOutput(untracked!.stdout);
  if (session.consumeRecords(stagedRecords.length + unstagedRecords.length
      + committedRecords.length + untrackedPaths.length) !== null) return null;
  const files = uniqueSorted([...stagedRecords, ...unstagedRecords, ...committedRecords]
    .flatMap((record) => record.previousPath === undefined ? [record.path] : [record.previousPath, record.path])
    .concat(untrackedPaths));
  const removedPaths = uniqueSorted(committedRecords.filter(({ status: kind }) => kind === 'removed')
    .map(({ path }) => path));
  const blobs = new Map<string, ReturnType<typeof parseGitPathBlobBatchOutput>>();
  for (const objectId of removedPaths.length === 0 || baseSha === null ? [] : [baseSha, headSha]) {
    const result = completed(await session.run(gitPathBlobBatchArgs(objectId, removedPaths)));
    if (result === null || result.code !== 0) return null;
    const parsed = parseGitPathBlobBatchOutput(result.stdout, removedPaths);
    if (session.consumeRecords(parsed.size) !== null) return null;
    blobs.set(objectId, parsed);
  }
  if (session.providerIdentity === null || session.workingDirectoryIdentity == null
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) return null;
  const transition = baseSha === null ? null : CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: committedRecords,
    readPathBlob: (objectId, repositoryPath) => blobs.get(objectId)?.get(repositoryPath) ?? null
  });
  const source = Object.freeze({
    files: Object.freeze(files),
    gitObservation: Object.freeze({
      baseSha,
      headSha,
      indexDigest: rawSha256(index!.stdout),
      worktreeDigest: rawSha256(status!.stdout),
      gitExecutable: session.gitExecutable,
      gitExecutableIdentity: session.gitExecutableIdentity,
      gitProviderRoute: session.providerRoute,
      gitProviderIdentity: session.providerIdentity
    })
  });
  affectedGitSelectionBindings.set(source, Object.freeze({
    session,
    baseRef: input.baseRef,
    transition,
    descriptorChangeRoots: Object.freeze(descriptorRoots(
      [...stagedRecords, ...unstagedRecords, ...committedRecords], untrackedPaths
    ))
  }));
  return source;
}

export function readAffectedGitSelectionBinding(
  source: IssuedAffectedGitSelectionSource, session: GitReadSession, baseRef: string | null
): Readonly<{ transition: CodexDevelopmentTestImpactTransitionObservation | null; descriptorChangeRoots: readonly string[] }> | null {
  const binding = affectedGitSelectionBindings.get(source);
  return binding !== undefined && binding.session === session && binding.baseRef === baseRef
    ? Object.freeze({ transition: binding.transition, descriptorChangeRoots: binding.descriptorChangeRoots })
    : null;
}

/** A handoff expectation only constrains a new observation; it carries no capability. */
export function affectedGitSelectionDigest(source: IssuedAffectedGitSelectionSource): `sha256:${string}` {
  if (!affectedGitSelectionBindings.has(source)) throw new Error('Affected selection is not owner-issued');
  return sha256({ files: source.files, gitObservation: source.gitObservation }) as `sha256:${string}`;
}

/** Rebind immutable facts after their old read session closed. Revalidation
 * issues a new session-local observation; it never revives the old provider. */
export async function rebindAffectedGitSelectionSource(input: Readonly<{
  source: IssuedAffectedGitSelectionSource; session: GitReadSession; baseRef: string | null;
}>): Promise<IssuedAffectedGitSelectionSource | null> {
  const { source: previous, session, baseRef } = input;
  const binding = affectedGitSelectionBindings.get(previous);
  if (binding === undefined || binding.baseRef !== baseRef
      || binding.session.cwd !== session.cwd
      || JSON.stringify(binding.session.workingDirectoryIdentity) !== JSON.stringify(session.workingDirectoryIdentity)
      || JSON.stringify(previous.gitObservation.gitProviderIdentity) !== JSON.stringify(session.providerIdentity)) return null;
  const head = completed(await session.run(['rev-parse', '--verify', 'HEAD^{commit}']));
  const status = completed(await session.run(gitWorkingTreeStatusArgs()));
  const index = completed(await session.run(['--no-pager', '-c', 'core.fsmonitor=false', '-c',
    'core.untrackedCache=false', 'ls-files', '--stage', '-z']));
  if (head === null || status === null || index === null
      || head.code !== 0 || status.code !== 0 || index.code !== 0
      || revision(head.stdout) !== previous.gitObservation.headSha
      || rawSha256(status.stdout) !== previous.gitObservation.worktreeDigest
      || rawSha256(index.stdout) !== previous.gitObservation.indexDigest
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) return null;
  if (baseRef !== null) {
    const base = completed(await session.run(['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`]));
    if (base === null || base.code !== 0 || revision(base.stdout) !== previous.gitObservation.baseSha) return null;
  }
  const source = Object.freeze({ files: previous.files, gitObservation: previous.gitObservation });
  affectedGitSelectionBindings.set(source, Object.freeze({ ...binding, session }));
  return source;
}
