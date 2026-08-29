import { isWindowsReservedLogicalComponent } from '../../../foundation/paths.ts';

const SLOT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/u;
const MAX_SLOT_ID_LENGTH = 128;

/**
 * Canonical Slot identity is one bounded lowercase ASCII token.
 *
 * Slot IDs participate in Lock identity and may be projected to
 * `source/code/slots/<slotId>.ts` when no explicit source path exists. The
 * logical contract therefore excludes case/Unicode aliases, path separators,
 * dot/colon syntax and Windows device names before a physical path is formed.
 */
export function isCanonicalSlotId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SLOT_ID_LENGTH &&
    SLOT_ID_PATTERN.test(value) &&
    !isWindowsReservedLogicalComponent(value);
}
