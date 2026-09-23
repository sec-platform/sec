import { PASS_INITIAL_STATES, type PassId, type PassState, type PassStatus } from '../contract/pass-status.ts';
import type { PipelineStageDefinition } from './stage-definitions.ts';

export type PipelineStageTransition =
  | Readonly<{ kind: 'started' | 'blocked' | 'succeeded' | 'preparation-failed' }>
  | Readonly<{ kind: 'failed'; originPass: PassId }>;

/** A pure state projection, not evidence that any pass ran or a write occurred.
 * The kernel alone applies it and retains its lease/commit fences. */
export function pipelineStageStatePatch(
  definition: PipelineStageDefinition,
  transition: PipelineStageTransition
): Readonly<Partial<Record<PassId, PassState>>> {
  if (!['started', 'blocked', 'succeeded', 'preparation-failed', 'failed'].includes(transition.kind)) {
    throw new TypeError('Unknown pipeline stage transition');
  }
  const { ownedPasses, invalidates, primaryPass } = definition;
  const patch: Partial<Record<PassId, PassState>> = {};
  if (transition.kind === 'succeeded') {
    for (const pass of ownedPasses) patch[pass] = 'succeeded';
  } else if (transition.kind === 'started') {
    for (const pass of invalidates) patch[pass] = PASS_INITIAL_STATES[pass];
    for (const pass of ownedPasses) patch[pass] = 'running';
  } else {
    for (const pass of [...ownedPasses, ...invalidates]) patch[pass] = 'blocked';
    if (transition.kind === 'preparation-failed') {
      patch[primaryPass] = 'failed';
    } else if (transition.kind === 'failed') {
      const origin = ownedPasses.includes(transition.originPass) ? transition.originPass : primaryPass;
      const failureIndex = ownedPasses.indexOf(origin);
      for (let index = 0; index < ownedPasses.length; index += 1) {
        patch[ownedPasses[index]!] = index < failureIndex ? 'succeeded' : index === failureIndex ? 'failed' : 'blocked';
      }
    }
  }
  return Object.freeze(patch);
}

/** Record the actual observed blocker states once, including an absent legacy
 * build-ir state, so diagnostics cannot re-read a different state. */
export function pipelineStageBlockers(status: Readonly<PassStatus>, requires: readonly PassId[]) {
  return requires.map((passId) => ({ passId, state: status[passId] }))
    .filter(({ state }) => state !== 'succeeded');
}
