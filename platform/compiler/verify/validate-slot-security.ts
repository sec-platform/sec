export { lintSlotCapabilities } from './slot-capability-lint.ts';

/**
 * @deprecated Static capability lint only. This compatibility name exists for
 * the current Verification caller and does not prove physical/runtime security.
 * Migrate consumers to `lintSlotCapabilities` or an explicit capability/effect
 * Verification provider, then delete this adapter.
 */
export { lintSlotCapabilities as validateSlotSecurity } from './slot-capability-lint.ts';
