export const LOCK_PASS_STATES = ['pending', 'running', 'succeeded', 'failed', 'blocked', 'skipped'] as const;

export type PassState = (typeof LOCK_PASS_STATES)[number];

export interface PassStatus {
  parse: PassState;
  align: PassState;
  resolve: PassState;
  /** Optional only while pre-P0-3 lock fixtures/artifacts remain readable. */
  'build-ir'?: PassState;
  compose: PassState;
  verify: PassState;
  repair: PassState;
  lock: PassState;
  emit: PassState;
}

export type PassId = keyof PassStatus;
