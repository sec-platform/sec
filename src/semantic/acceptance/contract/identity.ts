const ACCEPTANCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/u;
const MAX_ACCEPTANCE_ID_LENGTH = 128;

/**
 * Acceptance IDs cross Plan, Lock, Verification, Coverage and ExplainGraph.
 * They are canonical logical identities, not display labels: lowercase ASCII
 * avoids case/Unicode-equivalent proof subjects and keeps serialization stable.
 */
export function isCanonicalAcceptanceId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ACCEPTANCE_ID_LENGTH &&
    ACCEPTANCE_ID_PATTERN.test(value);
}
