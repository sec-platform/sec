/** VerificationSession physical owner recovered from current-main semantics. */
import type { ActiveWorkPackageOwnerObservation } from '../../../../self-hosting/control/task/contract/active-work-observation.ts';

export interface VerificationSessionScope {
  readonly repositoryRoot: string;
  readonly remote?: string;
  readonly repositoryFullName?: string;
  readonly defaultBranch?: string;
  readonly recoveryRoot?: string;
  readonly activeWorkPackageObservation?: ActiveWorkPackageOwnerObservation;
}

export function createVerificationSessionScope(input: VerificationSessionScope): VerificationSessionScope {
  return Object.freeze({ ...input });
}
