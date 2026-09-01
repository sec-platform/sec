import {
  SecError,
  type SecErrorDetails
} from '../../system-architecture/foundation/contract/failure.ts';

export const PROJECT_INTEGRITY_DRIFT_CODE = 'ERROR-DRIFT-001' as const;

/** Workspace-owned failure for baseline and provenance integrity rejection. */
export class ProjectIntegrityError extends SecError {
  constructor(message: string, details: SecErrorDetails = {}, options?: ErrorOptions) {
    super(PROJECT_INTEGRITY_DRIFT_CODE, message, details, options);
    this.name = 'ProjectIntegrityError';
  }
}
