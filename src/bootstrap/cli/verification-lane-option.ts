import { isVerificationLane, VERIFICATION_LANES, type VerificationLane } from '../../assurance/verification/contract/lanes.ts';

export const VERIFICATION_LANE_OPTION = Object.freeze({
  name: 'lane', flags: '--lane <lane>', description: 'Verification lane'
} as const);
const laneDescription = VERIFICATION_LANES.map((lane, index) =>
  index === VERIFICATION_LANES.length - 1 ? `or ${lane}` : lane).join(', ');

/** Both CLI families consume the domain choices; only error presentation differs. */
export function parseVerificationLaneOption(value: unknown, reject: (choices: string) => never): VerificationLane {
  return isVerificationLane(value) ? value : reject(laneDescription);
}
