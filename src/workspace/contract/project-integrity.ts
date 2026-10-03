import {
  CodedFailure,
  type CodedFailureDetails
} from '../../contracts/failure.ts';

const PROJECT_INTEGRITY_DRIFT_CODE = 'ERROR-DRIFT-001' as const;

/** Workspace-owned failure for baseline and provenance integrity rejection. */
export class ProjectIntegrityError extends CodedFailure {
  constructor(message: string, details: CodedFailureDetails = {}, options?: ErrorOptions) {
    super(PROJECT_INTEGRITY_DRIFT_CODE, message, details, options);
    this.name = 'ProjectIntegrityError';
  }
}
