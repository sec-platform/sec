import type { SourceProgramCompilationOperation } from '../../../brownfield/source-program-model/compilation-operation.ts';
import { compileRepositorySourceProgramWithCache } from '../../../brownfield/source-program-model/repository-compilation-cache-session.ts';
import {
  issueTestImpactProjection,
  type IssuedTestImpactProjection
} from '../../../brownfield/source-program-model/test-impact-projection.ts';
import {
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence,
  type WorkspaceTypeScriptProjectGenerationEvidence
} from '../../../brownfield/source-program-model/workspace-source-snapshot.ts';
import type { GitReadSession } from '../../../external-capabilities/git-read/runtime/session.ts';
import { rawSha256, sha256, uniqueSorted } from '../../../contracts/canonical.ts';
import { assertRetainedCompilerDependencyReadGeneration, type RetainedCompilerDependencyReadGeneration } from '../../../toolchain/dependencies/runtime.ts';
import { tsconfigRelativePath } from '../../../workspace/runtime/paths.ts';
import { issueTestInventoryProjection, type IssuedTestInventoryProjection } from '../contract/budget.ts';
import {
  CodexDevelopmentCreateTestImpactTransitionObservation,
  CodexDevelopmentTestImpactTransitionDigest,
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

export type IssuedAffectedTestImpactSource = Readonly<{
  files: readonly string[];
  gitObservation: AffectedGitSelectionObservation;
  projection: IssuedTestImpactProjection;
  testInventory: IssuedTestInventoryProjection;
  projectGenerationEvidence: WorkspaceTypeScriptProjectGenerationEvidence;
}>;

type AffectedBindingRecord = Readonly<{
  transition: CodexDevelopmentTestImpactTransitionObservation;
  descriptorChangeRoots: readonly string[];
}>;
const affectedSourceBindings = new WeakMap<object, AffectedBindingRecord>();

export function readIssuedAffectedTestImpactBinding(
  source: IssuedAffectedTestImpactSource
): AffectedBindingRecord | null {
  return affectedSourceBindings.get(source) ?? null;
}

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
      if (candidate === 'sec.module.json') return [''];
      const suffix = '/sec.module.json';
      return candidate.endsWith(suffix) ? [candidate.slice(0, -suffix.length)] : [];
    }));
}

export async function issueAffectedTestImpactSource(input: Readonly<{
  dependencyGeneration?: RetainedCompilerDependencyReadGeneration;
  compilationOperation: SourceProgramCompilationOperation;
  repositoryRoot: string;
  session: GitReadSession;
  baseRef: string | null;
}>): Promise<IssuedAffectedTestImpactSource | null> {
  const { session, dependencyGeneration } = input;
  if (dependencyGeneration !== undefined) assertRetainedCompilerDependencyReadGeneration(dependencyGeneration);
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
  const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
  if (workspaceSnapshot.subject.provenance.kind !== 'working-tree-observation'
      || workspaceSnapshot.subject.provenance.providerIdentityDigest !== sha256(session.providerIdentity)
      || workspaceSnapshot.subject.provenance.repositoryRootIdentityDigest !== sha256(session.workingDirectoryIdentity)
      || transition?.removedPathBlobs.some(({ path }) => workspaceSnapshot.file(path) !== null)
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) return null;
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath,
    dependencyGeneration === undefined ? undefined : {
      dependencyGeneration: dependencyGeneration.physicalGeneration,
      dependencyGenerationDigest: dependencyGeneration.generationDigest
    }
  );
  const compilation = compileRepositorySourceProgramWithCache({
    workspaceSnapshot,
    operation: input.compilationOperation,
    projectInput,
    repositoryRoot: input.repositoryRoot
  });
  const descriptorChangeRoots = descriptorRoots(
    [...stagedRecords, ...unstagedRecords, ...committedRecords], untrackedPaths
  );
  const projection = issueTestImpactProjection({
    workspaceSnapshot,
    projectGeneration: compilation.projectGeneration,
    repositoryModel: compilation.model,
    typeScriptModel: compilation.typeScriptCompilation.model,
    testObservations: compilation.testObservations
  });
  if (transition !== null) CodexDevelopmentTestImpactTransitionDigest(transition);
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
    }),
    projection,
    testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
    projectGenerationEvidence: issueWorkspaceTypeScriptProjectGenerationEvidence(workspaceSnapshot, projectInput)
  });
  if (transition !== null) {
    affectedSourceBindings.set(source, Object.freeze({
      transition,
      descriptorChangeRoots: Object.freeze(descriptorChangeRoots)
    }));
  }
  return source;
}
