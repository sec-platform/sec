import { inspectFailureValue } from './failure-inspection.ts';
import { SecError, type SecErrorDetails } from './failure.ts';

/** Render one failure without assuming a domain-specific Error subclass. */
export function formatFailure(error: unknown): string {
  try {
    if (!(error instanceof Error)) return String(error);

    const primary = error.stack ?? error.message;
    if (typeof primary !== 'string') return inspectFailureValue(error);
    if (!(error instanceof SecError)) return primary;
    let details: SecErrorDetails | undefined;
    try {
      details = error.details;
      return details ? `${primary}\n${JSON.stringify(details, null, 2)}` : primary;
    } catch {
      return `${primary}\n[Details could not be rendered as JSON]\n${inspectFailureValue(details)}`;
    }
  } catch {
    return inspectFailureValue(error);
  }
}
