/**
 * Package-local fault-injection entrypoint. Production code must import
 * ../runtime.ts, whose wrappers discard every test transport and lifecycle
 * control before entering the dependency owner.
 */
export * from '../runtime/project-runtime.ts';
