/** VerificationSession physical owner recovered from current-main semantics. */
import { assertGitBranchName } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { createBranchLifecycleGitHubCredentialArgs, decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { VERIFICATION_SESSION_RUNTIME_ENTRYPOINT_PATH } from '../../session/contract/session.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../trust/contract/root.ts';
import { createVerificationSessionScope, type VerificationSessionScope } from '../contract/session-scope.ts';
import { requireCommand, requireVerificationSessionCommandText, runVerificationSessionCommand } from './session-local-repository.ts';
import type { TrustedRuntimeProof } from './verification-session-runtime.ts';

type TrustedRemoteDefaultIdentity = Readonly<{
  remote: string;
  defaultBranch: string;
  remoteRef: string;
  localRef: string;
}>;

type TrustedRemoteExactRefObservation = Readonly<{
  state: 'present' | 'absent';
  sha: string | null;
}>;

function trustedRemoteDefaultIdentity(
  defaultBranch = 'main',
  remote = 'origin'
): TrustedRemoteDefaultIdentity {
  assertGitBranchName(defaultBranch, 'Trusted remote default branch');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote)) {
    throw new Error('Trusted remote default identity is invalid.');
  }
  return Object.freeze({
    remote,
    defaultBranch,
    remoteRef: `refs/heads/${defaultBranch}`,
    localRef: `refs/remotes/${remote}/${defaultBranch}`
  });
}

/**
 * Observe one exact hosted branch ref without depending on actions/checkout
 * credential persistence or ambient Git credential helpers. GH_TOKEN/gh
 * ownership stays with the caller environment; this helper fixes only the
 * finite Git command and exact single-ref response shape.
 */

export function observeTrustedRemoteExactRef(input: {
  ctx: VerificationSessionScope;
  remote: string;
  remoteRef: string;
  label: string;
  cwd?: string;
}): TrustedRemoteExactRefObservation {
  const headPrefix = 'refs/heads/';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.remote)
      || !input.remoteRef.startsWith(headPrefix)) {
    throw new Error('Trusted remote exact-ref identity is invalid.');
  }
  assertGitBranchName(input.remoteRef.slice(headPrefix.length), 'Trusted remote exact-ref branch');
  const result = runVerificationSessionCommand(input.ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'ls-remote', '--exit-code', input.remote, input.remoteRef
  ], input.cwd);
  const source = decodeBranchLifecycleChildStdout(result);
  if (result.status === 2 && source.trim().length === 0) {
    return Object.freeze({ state: 'absent', sha: null });
  }
  if (result.status !== 0) {
    throw new Error(`${input.label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error('Trusted remote exact-ref readback is incomplete or ambiguous.');
  }
  const match = /^([0-9a-f]{40})\t(.+)$/u.exec(lines[0]!);
  const observedRef = match?.[2] ?? '';
  if (!observedRef.startsWith(headPrefix)) {
    throw new Error('Trusted remote exact-ref readback is malformed.');
  }
  assertGitBranchName(observedRef.slice(headPrefix.length), 'Trusted remote exact-ref readback branch');
  if (match === null || observedRef !== input.remoteRef) {
    throw new Error('Trusted remote exact-ref readback is malformed.');
  }
  return Object.freeze({ state: 'present', sha: match[1]! });
}

function readTrustedRemoteDefaultRef(input: {
  ctx: VerificationSessionScope;
  identity: TrustedRemoteDefaultIdentity;
  label: string;
}): string {
  const observed = observeTrustedRemoteExactRef({
    ctx: input.ctx,
    remote: input.identity.remote,
    remoteRef: input.identity.remoteRef,
    label: input.label
  });
  if (observed.state !== 'present' || observed.sha === null) {
    throw new Error('Trusted remote default readback is absent.');
  }
  return observed.sha;
}

/** Live production proof. The command runner is fixed inside the opaque context. */

export function inspectTrustedRuntime(input: {
  repositoryRoot: string;
  defaultBranch?: string;
  remote?: string;
  candidateHeadSha?: string;
}): TrustedRuntimeProof {
  const identity = trustedRemoteDefaultIdentity(input.defaultBranch, input.remote);
  const ctx = createVerificationSessionScope({ repositoryRoot: input.repositoryRoot });
  const currentHeadSha = requireCommand(ctx, 'git', ['rev-parse', 'HEAD'], 'HEAD readback');
  const currentBranch = requireCommand(ctx, 'git', ['branch', '--show-current'], 'branch readback');
  const localDefaultSha = requireCommand(ctx, 'git', ['rev-parse', identity.localRef], 'local default readback');
  const remoteDefaultSha = readTrustedRemoteDefaultRef({
    ctx, identity, label: 'remote default readback'
  });
  const workingTreeClean = requireCommand(ctx, 'git', [
    'status', '--porcelain=v1', '--untracked-files=all'
  ], 'worktree readback').length === 0;
  // Exact clean Git identity proves every tracked byte, including the TCB.
  // Candidate TCB compilation is an Impact-selected Verification Action and
  // must not run before changed-path selection on unrelated operations.
  const entrypointPath = VERIFICATION_SESSION_RUNTIME_ENTRYPOINT_PATH;
  const runtimeEntrypointBlobMatched = requireCommand(
    ctx, 'git', ['rev-parse', `${currentHeadSha}:${entrypointPath}`], 'runtime entrypoint trusted blob'
  ) === requireCommand(ctx, 'git', ['hash-object', '--', entrypointPath], 'runtime entrypoint working blob');
  let boundaryTargetsMatched = true;
  for (const edge of SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedBoundaryEdges) {
    const target = edge.split(' -> ')[1];
    if (target === undefined || !SEC_TRUSTED_BOOTSTRAP_REGISTRY.staticExactPaths.includes(target)) {
      boundaryTargetsMatched = false;
      break;
    }
    const trustedBlob = requireCommand(ctx, 'git', ['rev-parse', `${currentHeadSha}:${target}`], `boundary target ${target}`);
    const workingBlob = requireCommand(ctx, 'git', ['hash-object', '--', target], `working boundary target ${target}`);
    const candidateBlob = input.candidateHeadSha === undefined ? trustedBlob
      : requireCommand(ctx, 'git', ['rev-parse', `${input.candidateHeadSha}:${target}`], `candidate boundary target ${target}`);
    if (trustedBlob !== workingBlob || trustedBlob !== candidateBlob) {
      boundaryTargetsMatched = false;
      break;
    }
  }
  return Object.freeze({ currentHeadSha, currentBranch, localDefaultSha, remoteDefaultSha,
    workingTreeClean, runtimeEntrypointBlobMatched, boundaryTargetsMatched });
}

export function synchronizeTrustedRemoteDefaultRef(input: {
  ctx: VerificationSessionScope;
  defaultBranch?: string;
  remote?: string;
}): Readonly<{ defaultSha: string; headSha: string }> {
  const identity = trustedRemoteDefaultIdentity(input.defaultBranch, input.remote);
  const readLive = (label: string): string => {
    return readTrustedRemoteDefaultRef({ ctx: input.ctx, identity, label });
  };

  const headBefore = requireVerificationSessionCommandText(
    input.ctx, 'git', ['rev-parse', 'HEAD'], 'pre-synchronization HEAD readback'
  );
  const liveBefore = readLive('pre-synchronization live default readback');
  const fetched = runVerificationSessionCommand(input.ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'fetch', '--no-tags', '--no-recurse-submodules', identity.remote,
    `+${identity.remoteRef}:${identity.localRef}`
  ]);
  if (fetched.status !== 0) {
    throw new Error(
      `Trusted remote default ref-only fetch failed: ${decodeBranchLifecycleChildError(fetched)}`
    );
  }
  const localAfter = requireVerificationSessionCommandText(
    input.ctx, 'git', ['rev-parse', identity.localRef], 'post-synchronization local default readback'
  );
  const liveAfter = readLive('post-synchronization live default readback');
  const headAfter = requireVerificationSessionCommandText(
    input.ctx, 'git', ['rev-parse', 'HEAD'], 'post-synchronization HEAD readback'
  );
  if (headAfter !== headBefore) {
    throw new Error('Trusted remote default ref-only fetch changed HEAD.');
  }
  if (liveBefore !== liveAfter || localAfter !== liveAfter) {
    throw new Error('Trusted remote default changed during synchronized ref-only fetch.');
  }
  return Object.freeze({ defaultSha: liveAfter, headSha: headAfter });
}
