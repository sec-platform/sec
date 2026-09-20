/** Execution selection only. This recipe does not issue verification evidence. */
export const VERIFICATION_LANE_PROFILES = Object.freeze({
  fast: Object.freeze({ runFast: true, runtimeMode: 'service', scope: 'partial' }),
  runtime: Object.freeze({ runFast: false, runtimeMode: 'service', scope: 'partial' }),
  all: Object.freeze({ runFast: true, runtimeMode: 'full', scope: 'complete' })
} as const);

export type VerificationLane = keyof typeof VERIFICATION_LANE_PROFILES;
export type VerificationLaneProfile = typeof VERIFICATION_LANE_PROFILES[VerificationLane];
export type VerificationRuntimeMode = VerificationLaneProfile['runtimeMode'];
export const VERIFICATION_LANES = Object.freeze(Object.keys(VERIFICATION_LANE_PROFILES) as VerificationLane[]);

export function isVerificationLane(value: unknown): value is VerificationLane {
  return typeof value === 'string' && Object.hasOwn(VERIFICATION_LANE_PROFILES, value);
}

export function verificationLaneProfile(lane: unknown): VerificationLaneProfile {
  if (!isVerificationLane(lane)) throw new RangeError('Unsupported verification lane');
  return VERIFICATION_LANE_PROFILES[lane];
}

/** Service checks also run for fast mode, but never after a failed fast phase. */
export function shouldExecuteRuntimeVerification(profile: VerificationLaneProfile, fastPassed: boolean): boolean {
  return !profile.runFast || fastPassed;
}
