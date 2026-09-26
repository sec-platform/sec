import {
  FailureError,
  type FailureDetails
} from '../../contracts/failure.ts';

const PROJECT_INTEGRITY_DRIFT_CODE = 'ERROR-DRIFT-001' as const;

/** Workspace-owned failure for baseline and provenance integrity rejection. */
export class ProjectIntegrityError extends FailureError {
  constructor(message: string, details: FailureDetails = {}, options?: ErrorOptions) {
    super(PROJECT_INTEGRITY_DRIFT_CODE, message, details, options);
    this.name = 'ProjectIntegrityError';
  }
}
