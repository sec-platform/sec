import * as check from './application/check.ts';

export type {
  ReferenceCheckFailedStage,
  ReferenceCheckReport,
  ReferenceCheckStatus
} from './application/check.ts';
export {
  assertReferenceCheckClean,
  formatReferenceCheck
} from './application/check.ts';

export async function buildReferenceCheckReport(options: {
  readonly root?: string;
} = {}): Promise<check.ReferenceCheckReport> {
  return check.buildReferenceCheckReport({ root: options.root });
}
