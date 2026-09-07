/** One preparation per key inside a run-owned template namespace. This is not
 * a filesystem lock, cross-process cache or readiness proof. Only concurrent
 * work is shared; every later call must perform its own readiness observation.
 * A failed preparation is removed so the existing owner can retry explicitly.
 */
export function createTemplatePreparation<Key>(
  prepare: (key: Key) => Promise<string>
): (key: Key) => Promise<string> {
  const pending = new Map<Key, Promise<string>>();
  return key => {
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    const result = Promise.resolve().then(() => prepare(key)).finally(() => {
      if (pending.get(key) === result) pending.delete(key);
    });
    pending.set(key, result);
    return result;
  };
}
