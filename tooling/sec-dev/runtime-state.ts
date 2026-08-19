// Minimal compatibility surface. Durable path resolution is intentionally
// separate from continuation CAS/locator/GC so Session and Action journals do
// not expand their trust closure into the continuation store.
export * from './runtime-state-paths.ts';
