import path from 'node:path';

import { rawSha256 } from '../../../../contracts/canonical.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { isProductionGitReadSession, type GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import {
  gitChangedFileDiffArgs,
  gitIndexChangedFileDiffArgs,
  gitUntrackedFileArgs,
  gitWorktreeChangedFileDiffArgs,
  parseGitChangedFileOutput,
  parseGitUntrackedFileOutput
} from '../../../verification/platform/test-impact/runtime/transition.ts';
import { validateSourceCheckpointStatusRequest, type SourceCheckpointStatusRequest } from './document-control-cli.ts';
import { ActivePointerPath, CurrentStatePath, RollingPlanPath } from './document-control-journal-codec.ts';
import { DOCUMENT_CONTROL_STATUS_GIT_READ_BUDGET, ExternalCommandTimeoutMs } from './document-control-observation.ts';
import { CodexDevelopmentParseCurrentStateSpec } from './document-control-plane-contract.ts';

async function bytes(session: GitReadSession, args: readonly string[]): Promise<Buffer> {
  const result = await session.run(args);
  if (result.kind !== 'completed' || result.result.code !== 0) {
    throw new Error(`Source checkpoint observation unavailable: git ${args[0]}.`);
  }
  return Buffer.from(result.result.stdout);
}

async function exactLine(session: GitReadSession, args: readonly string[]): Promise<string> {
  const value = (await bytes(session, args)).toString('utf8').trim();
  if (value.length === 0 || /[\r\n\0]/u.test(value)) throw new Error('Source checkpoint observation requires one exact Git identity.');
  return value;
}

async function snapshot(session: GitReadSession, base: string) {
  const head = await exactLine(session, ['rev-parse', '--verify', 'HEAD']);
  const refResult = await session.run(['symbolic-ref', '--quiet', 'HEAD']);
  if (refResult.kind !== 'completed' || ![0, 1].includes(refResult.result.code)) {
    throw new Error('Source checkpoint ref observation unavailable.');
  }
  const ref = refResult.result.code === 0 ? Buffer.from(refResult.result.stdout).toString('utf8').trim() : null;
  const tree = await exactLine(session, ['rev-parse', '--verify', `${head}^{tree}`]);
  const committed = await bytes(session, gitChangedFileDiffArgs(base, head));
  const staged = await bytes(session, gitIndexChangedFileDiffArgs(head));
  const unstaged = await bytes(session, gitWorktreeChangedFileDiffArgs());
  const untracked = await bytes(session, gitUntrackedFileArgs());
  return Object.freeze({
    head, ref, tree,
    committed: parseGitChangedFileOutput(committed),
    staged: parseGitChangedFileOutput(staged),
    unstaged: parseGitChangedFileOutput(unstaged),
    untracked: parseGitUntrackedFileOutput(untracked),
    observationDigest: rawSha256(JSON.stringify({
      head, ref, tree, committed: committed.toString('base64'), staged: staged.toString('base64'),
      unstaged: unstaged.toString('base64'), untracked: untracked.toString('base64')
    }))
  });
}

/**
 * A read-only route to existing source/commit owners. No MainHealth, Work,
 * activation, Gate or credential provider is consulted or manufactured here.
 * These observations cannot cross any Effect boundary as an admission token.
 */
export async function resolveSourceCheckpointStatus(cwd: string, requested: SourceCheckpointStatusRequest) {
  const request = validateSourceCheckpointStatusRequest(requested);
  const repositoryRoot = path.resolve(cwd);
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: DOCUMENT_CONTROL_STATUS_GIT_READ_BUDGET,
    deadlineAtUnixMs: Date.now() + ExternalCommandTimeoutMs
  }, (session) => resolveSourceCheckpointStatusFromSession(session, request));
}

/** Same observation within an enclosing source owner's retained read session.
 * No status projection becomes an Effect admission or renews the parent budget. */
export async function resolveSourceCheckpointStatusFromSession(
  session: GitReadSession,
  requested: SourceCheckpointStatusRequest
) {
  if (!isProductionGitReadSession(session)) {
    throw new Error('Source checkpoint observation requires a production-issued Git read session.');
  }
  const request = validateSourceCheckpointStatusRequest(requested);
  const repositoryRoot = path.resolve(session.cwd);
  const root = await exactLine(session, ['rev-parse', '--show-toplevel']);
  if (path.resolve(root) !== repositoryRoot) throw new Error('Source checkpoint requires the exact repository root.');
  const base = await exactLine(session, ['rev-parse', '--verify', `${request.base}^{commit}`]);
  if (base !== request.base) throw new Error('Source checkpoint base must be an exact commit.');
  const baseTree = await exactLine(session, ['rev-parse', '--verify', `${base}^{tree}`]);
  // Immutable base policy only identifies the repository/default ref. No rolling or active projection is read.
  const spec = CodexDevelopmentParseCurrentStateSpec((await bytes(session, ['show', `${base}:${CurrentStatePath}`])).toString('utf8'));
  const before = await snapshot(session, base);
  const ancestor = await session.run(['merge-base', '--is-ancestor', base, before.head]);
  if (ancestor.kind !== 'completed' || ![0, 1].includes(ancestor.result.code)) {
    throw new Error('Source checkpoint ancestry observation unavailable.');
  }
  const after = await snapshot(session, base);
  const owned = new Set(request.ownedPaths);
  const changedPaths = [...new Set([...after.committed, ...after.staged, ...after.unstaged, ...after.untracked])].sort();
  const unownedPaths = changedPaths.filter((file) => !owned.has(file));
  const controlPaths = changedPaths.filter((file) => file === ActivePointerPath || file === RollingPlanPath
    || file.startsWith('config/repository/work-packages/'));
  const blockers: string[] = [];
  if (before.observationDigest !== after.observationDigest) blockers.push('source-observation-raced');
  if (after.head !== request.expectedHead) blockers.push('expected-head-drift');
  if (ancestor.result.code !== 0) blockers.push('base-not-ancestor');
  if (after.ref === null || !after.ref.startsWith('refs/heads/')) blockers.push('detached-or-invalid-branch');
  if (after.ref === `refs/heads/${spec.resolver.defaultBranch}`) blockers.push('default-ref-not-source-checkpoint');
  if (unownedPaths.length !== 0) blockers.push('changed-path-ownership-unresolved');
  if (controlPaths.length !== 0) blockers.push('formal-control-projection-not-source-checkpoint');
  return Object.freeze({
    schema: 'sec-source-checkpoint-status-v1' as const,
    authority: 'observation-only' as const,
    repository: spec.resolver.repository,
    repositoryRoot,
    request,
    subject: Object.freeze({ base, baseTree, head: after.head, tree: after.tree, ref: after.ref }),
    changes: after,
    unownedPaths: Object.freeze(unownedPaths),
    controlPaths: Object.freeze(controlPaths),
    blockers: Object.freeze(blockers),
    next: Object.freeze({
      owner: blockers.length === 0 ? 'development.commit' : 'source-scope-owner',
      action: blockers.length === 0 ? 'review-scope-and-request-canonical-admission' : 'reconcile-source-observation',
      admission: 'required-by-original-owner' as const
    }),
    unobservedOwners: Object.freeze([
      'explicit-user-authorization', 'single-writer-and-dirty-content-ownership',
      'development-commit-candidate-and-normalization', 'development-commit-journal-census',
      'exact-head-source-review', 'branch-transport-effect-and-readback'
    ]),
    formalQualification: 'not-issued' as const
  });
}
