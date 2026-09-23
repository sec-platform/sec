import { admitVerificationLane, type VerificationLaneAdmission } from '../../application/verification-request.ts';

export const VERIFICATION_LANE_OPTION = Object.freeze({
  name: 'lane', flags: '--lane <lane>', description: 'Verification lane'
} as const);

/** Entry owns CLI rejection wording; application owns admitted domain choices. */
export function parseVerificationLaneOption(
  value: unknown,
  reject: (choices: string) => never
): Extract<VerificationLaneAdmission, { accepted: true }>['lane'] {
  const admission = admitVerificationLane(value);
  return admission.accepted ? admission.lane : reject(admission.choices);
}
