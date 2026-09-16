import { compareCodeUnits, deepFreeze, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  WORKSPACE_TRANSITION_OBSERVATION_DISPOSITIONS,
  WorkspaceTransitionContractError,
  type WorkspaceTransitionCapabilityObservation,
  type WorkspaceTransitionPlan,
  type WorkspaceTransitionTrigger
} from './contract.ts';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function canonicalObservation(
  observation: WorkspaceTransitionCapabilityObservation,
  label: string
): WorkspaceTransitionCapabilityObservation {
  if (!WORKSPACE_TRANSITION_OBSERVATION_DISPOSITIONS.includes(observation.disposition)
      || !DIGEST_PATTERN.test(observation.observationDigest)) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-observation-unresolved', `${label} observation is noncanonical.`
    );
  }
  return deepFreeze({ ...observation });
}

/** Unresolved owner facts fail closed before either provider may materialize. */
export function compileWorkspaceTransitionPlan(input: Readonly<{
  readonly trigger: WorkspaceTransitionTrigger;
  readonly worktreeIdentityDigest: `sha256:${string}`;
  readonly dependency: WorkspaceTransitionCapabilityObservation;
  readonly hooks: WorkspaceTransitionCapabilityObservation;
}>): WorkspaceTransitionPlan {
  if (!DIGEST_PATTERN.test(input.worktreeIdentityDigest)) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-observation-unresolved', 'Workspace identity observation is noncanonical.'
    );
  }
  const dependency = canonicalObservation(input.dependency, 'Dependency');
  const hooks = canonicalObservation(input.hooks, 'Managed Git hook');
  const blockers = Object.freeze([
    ...(dependency.disposition === 'unresolved' || dependency.disposition === 'deferred'
      ? ['compiler-dependency-tree' as const] : []),
    ...(hooks.disposition === 'unresolved'
      || (hooks.disposition === 'deferred'
        && dependency.disposition !== 'materialization-required')
      ? ['managed-git-hooks' as const] : [])
  ].sort(compareCodeUnits));
  const requiredEffects = blockers.length > 0
    ? Object.freeze([])
    : Object.freeze([
      ...(dependency.disposition === 'materialization-required'
        ? ['compiler-dependency-tree.materialize' as const] : []),
      ...(hooks.disposition === 'materialization-required'
        ? ['managed-git-hooks.materialize' as const] : [])
    ]);
  const withoutDigest = deepFreeze({
    trigger: input.trigger,
    worktreeIdentityDigest: input.worktreeIdentityDigest,
    dependency,
    hooks,
    decision: blockers.length > 0
      ? 'blocked' as const
      : requiredEffects.length === 0 ? 'no-effect' as const : 'effects-required' as const,
    requiredEffects,
    freshProcessBoundary: requiredEffects.includes('compiler-dependency-tree.materialize')
      ? 'after-compiler-dependency-tree' as const : 'none' as const,
    blockers
  });
  return deepFreeze({ ...withoutDigest, planDigest: sha256(withoutDigest) as `sha256:${string}` });
}
