const runtimeBindingRoots = new WeakSet<object>();
const forwardedRuntimeBindings = new WeakMap<object, object>();

/** Registers a newly issued root identity without exposing its private plan. */
export function registerIsolatedRuntimeBinding(binding: object): void {
  runtimeBindingRoots.add(binding);
}

/**
 * Transfers only process-local object identity. Runtime plan bytes and
 * filesystem authority remain owned by semantic-mutation-isolated-runtime-plan.
 */
export function forwardIsolatedRuntimeBinding(
  source: unknown,
  target: object
): void {
  if (!source || typeof source !== 'object') return;
  const sourceObject = source as object;
  const root = forwardedRuntimeBindings.get(sourceObject) ??
    (runtimeBindingRoots.has(sourceObject) ? sourceObject : undefined);
  if (root && runtimeBindingRoots.has(root)) forwardedRuntimeBindings.set(target, root);
}

/** Resolves a forwarded identity without exposing the bound runtime plan. */
export function resolveIsolatedRuntimeBinding(
  binding: unknown
): object | undefined {
  if (!binding || typeof binding !== 'object') return undefined;
  const bindingObject = binding as object;
  const root = forwardedRuntimeBindings.get(bindingObject) ??
    (runtimeBindingRoots.has(bindingObject) ? bindingObject : undefined);
  return root && runtimeBindingRoots.has(root) ? root : undefined;
}
