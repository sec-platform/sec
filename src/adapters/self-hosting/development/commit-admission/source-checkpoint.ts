import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { assertGitHubRepositoryBinding } from '../../../providers/git-read/repository-binding.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET, type GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshotFromSession,
  acquireWorkingTreeWorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertCanonicalBunPackageRunner, readCanonicalBunRuntimeProjection } from '../../../toolchain/runtime/bun-version.ts';
import { compilerRuntimeLayout } from '../../../toolchain/runtime/layout.ts';
import { CurrentStatePath } from '../../control/documentation/document-control-journal-codec.ts';
import { parseCurrentStateSpec } from '../../control/documentation/document-control-plane-contract.ts';
import { resolveSourceCheckpointStatusFromSession } from '../../control/documentation/document-control-source-checkpoint.ts';
import { DEV_RUNNER_ENTRYPOINT_PATH } from '../runner/contract.ts';
import {
  assertDevelopmentSourceCheckpointNonDefaultRef,
  validateDevelopmentSourceCheckpointRequest,
  type DevelopmentSourceCheckpointRequest
} from './source-checkpoint-contract.ts';

declare const sourceCheckpointBrand: unique symbol;
export type DevelopmentSourceCheckpointBinding = Readonly<{ readonly [sourceCheckpointBrand]: true }>;

interface BindingDetails {
  readonly request: DevelopmentSourceCheckpointRequest;
  readonly repositoryRoot: string;
  readonly toolRoot: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly toolSnapshot: PhysicalWorkspaceSourceSnapshot;
  readonly digest: `sha256:${string}`;
}
const bindings = new WeakMap<object, BindingDetails>();

async function text(session: GitReadSession, args: readonly string[]): Promise<string> {
  const result = await session.run(args);
  if (result.kind !== 'completed' || result.result.code !== 0) {
    throw new Error(`Source checkpoint tool observation failed: git ${args[0]}.`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(result.result.stdout).trimEnd();
}

function sourceCensus(snapshot: PhysicalWorkspaceSourceSnapshot): string {
  return sha256(snapshot.files.map(({ path, mode, contentDigest }) => ({ path, mode, contentDigest })));
}

async function observeTrustedTool(request: DevelopmentSourceCheckpointRequest) {
  // This root is supplied by the runtime layout, never by the candidate or a
  // caller-authored root/digest. As with the package runner, this assumes the
  // caller launched the trusted source tool. Filesystem observations below do
  // not attest the bytes of JavaScript already loaded into this process.
  const toolRoot = compilerRuntimeLayout.repositorySourceRoot;
  if (toolRoot === null || compilerRuntimeLayout.mode !== 'source'
      || process.argv[1] === undefined
      || path.resolve(process.argv[1]) !== path.resolve(toolRoot, DEV_RUNNER_ENTRYPOINT_PATH)
      || path.resolve(process.cwd()) !== toolRoot) {
    throw new Error('Source checkpoint commit must run through the trusted main package dev entrypoint.');
  }
  const projection = await readCanonicalBunRuntimeProjection(toolRoot);
  assertCanonicalBunPackageRunner(projection.version);
  inspectNoFollowDirectoryChain(toolRoot, 'Source checkpoint trusted tool root');
  return withAuthorityGitReadSession({ cwd: toolRoot, budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET }, async (session) => {
    const head = await text(session, ['rev-parse', '--verify', 'HEAD']);
    if (head !== request.trustedMain) throw new Error('Source checkpoint trusted main revision differs.');
    const spec = parseCurrentStateSpec(await text(session, ['show', `${head}:${CurrentStatePath}`]));
    assertDevelopmentSourceCheckpointNonDefaultRef(request.expectedRef, spec.resolver.defaultBranch);
    const branch = await text(session, ['symbolic-ref', '--quiet', 'HEAD']);
    const currentDefault = await text(session, ['rev-parse', '--verify', spec.resolver.defaultRef]);
    if (branch !== `refs/heads/${spec.resolver.defaultBranch}` || head !== currentDefault
        || await text(session, ['rev-parse', '--show-toplevel']) !== toolRoot
        || (await text(session, ['status', '--porcelain=v1', '--untracked-files=all'])).length !== 0) {
      throw new Error('Source checkpoint tools require the clean default worktree at the exact requested main.');
    }
    await assertGitHubRepositoryBinding(session, spec.resolver.repository);
    const snapshot = await acquireExactGitTreeWorkspaceSourceSnapshotFromSession({ session, commitSha: head });
    const physical = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
    if (sourceCensus(snapshot) !== sourceCensus(physical)
        || await text(session, ['rev-parse', '--verify', 'HEAD']) !== head
        || await text(session, ['rev-parse', '--verify', spec.resolver.defaultRef]) !== head) {
      throw new Error('Source checkpoint trusted tool sources changed during observation.');
    }
    return Object.freeze({ toolRoot, repository: spec.resolver.repository, defaultBranch: spec.resolver.defaultBranch, snapshot });
  });
}

export function requireDevelopmentSourceCheckpointBinding(
  binding: DevelopmentSourceCheckpointBinding,
  repositoryRoot: string
): Readonly<BindingDetails> {
  const details = bindings.get(binding);
  if (details === undefined || details.repositoryRoot !== repositoryRoot) {
    throw new Error('Source checkpoint execution binding is foreign or targets another repository root.');
  }
  return details;
}

/** No grant or alternate state owner is created here. This process-local
 * binding records the startup exact-main source observation. Canonical trusted
 * source launch remains a caller precondition, not an in-memory code attestation
 * or a promise that main cannot advance during the bounded commit operation. */
export async function prepareDevelopmentSourceCheckpoint(input: Readonly<{
  repositoryRoot: string;
  request: DevelopmentSourceCheckpointRequest;
}>): Promise<DevelopmentSourceCheckpointBinding> {
  const request = validateDevelopmentSourceCheckpointRequest(input.request);
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const trusted = await observeTrustedTool(request);
  const toolDirectory = inspectNoFollowDirectoryChain(trusted.toolRoot, 'Trusted tool directory').target;
  const candidateDirectory = inspectNoFollowDirectoryChain(repositoryRoot, 'Candidate source directory').target;
  if (toolDirectory.device === candidateDirectory.device && toolDirectory.inode === candidateDirectory.inode) {
    throw new Error('Source checkpoint candidate must be physically distinct from its trusted tool checkout.');
  }
  const binding = Object.freeze({}) as DevelopmentSourceCheckpointBinding;
  bindings.set(binding, Object.freeze({
    request, repositoryRoot, toolRoot: trusted.toolRoot, repository: trusted.repository,
    defaultBranch: trusted.defaultBranch,
    toolSnapshot: trusted.snapshot,
    digest: sha256({
      request, repositoryRoot, toolRoot: trusted.toolRoot, repository: trusted.repository, defaultBranch: trusted.defaultBranch,
      toolSource: sourceCensus(trusted.snapshot), toolSnapshot: trusted.snapshot.identityDigest
    })
  }));
  return binding;
}

/** Called inside the index owner's before/after exact-index fence. The same
 * retained session owns all scope reads and their aggregate resource budget. */
export async function observeDevelopmentSourceCheckpointScope(
  binding: DevelopmentSourceCheckpointBinding,
  repositoryRoot: string,
  session: GitReadSession
): Promise<void> {
  const details = requireDevelopmentSourceCheckpointBinding(binding, repositoryRoot);
  const status = await resolveSourceCheckpointStatusFromSession(session, details.request);
  if (status.blockers.length !== 0 || status.repository !== details.repository
      || status.subject.ref !== details.request.expectedRef) {
    throw new Error(`Source checkpoint scope is not current: ${status.blockers.join(',') || 'repository/ref mismatch'}.`);
  }
}

/** The original candidate owner fences the frozen HEAD/ref/index/tree. Those
 * identities preserve the observed committed/staged scope; later unrelated
 * unstaged/untracked files are not transported by this commit. Only the original
 * session is used here, so this fence cannot renew the parent's budget. */
export async function assertDevelopmentSourceCheckpointRepository(
  binding: DevelopmentSourceCheckpointBinding,
  repositoryRoot: string,
  session: GitReadSession
): Promise<void> {
  const details = requireDevelopmentSourceCheckpointBinding(binding, repositoryRoot);
  await assertGitHubRepositoryBinding(session, details.repository);
}
