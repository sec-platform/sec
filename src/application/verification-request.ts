import { isVerificationLane, VERIFICATION_LANES, type VerificationLane } from '../assurance/verification/contract/lanes.ts';

export const STANDALONE_VERIFICATION_DEFAULT_LANE = 'fast' as const;
const VERIFICATION_LANE_CHOICES = Object.freeze([...VERIFICATION_LANES]) as readonly VerificationLane[];
const VERIFICATION_LANE_CHOICES_DESCRIPTION = VERIFICATION_LANE_CHOICES.map((lane, index) =>
  index === VERIFICATION_LANE_CHOICES.length - 1 ? `or ${lane}` : lane
).join(', ');

export type VerificationLaneAdmission =
  | Readonly<{ accepted: true; lane: VerificationLane }>
  | Readonly<{ accepted: false; choices: string }>;

/** Application owns which verification lanes are meaningful; transports own how invalid input is reported. */
export function admitVerificationLane(value: unknown): VerificationLaneAdmission {
  return isVerificationLane(value)
    ? Object.freeze({ accepted: true, lane: value })
    : Object.freeze({ accepted: false, choices: VERIFICATION_LANE_CHOICES_DESCRIPTION });
}
