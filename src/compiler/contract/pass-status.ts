export const LOCK_PASS_STATES = Object.freeze(['pending', 'running', 'succeeded', 'failed', 'blocked', 'skipped'] as const);

export type PassState = (typeof LOCK_PASS_STATES)[number];

/** Pass identity, order and initial state share one contract. Initialization
 * and invalidation consume the same rule; repair is intentionally skipped. */
export const PASS_INITIAL_STATES = Object.freeze({
  parse: 'pending',
  align: 'pending',
  resolve: 'pending',
  'build-ir': 'pending',
  compose: 'pending',
  verify: 'pending',
  repair: 'skipped',
  lock: 'pending',
  emit: 'pending'
} as const satisfies Record<string, PassState>);

export type PassId = keyof typeof PASS_INITIAL_STATES;
/** build-ir stays optional while retained pre-P0-3 lock artifacts remain readable. */
export type PassStatus = Record<Exclude<PassId, 'build-ir'>, PassState>
  & Partial<Record<'build-ir', PassState>>;
