import { createAwasmBlake3WasmSimdProvider } from '../adapters/providers/content-hash/awasm-wasm-simd.ts';
import {
  createContentDigestRuntime,
  type ContentDigestRuntime
} from '../contracts/content-digest.ts';
import {
  createStructuredIdentityRuntime,
  type StructuredIdentityRuntime
} from '../contracts/structured-identity.ts';

export type ContentIdentityRuntime = Readonly<{
  content: ContentDigestRuntime;
  identity: StructuredIdentityRuntime;
}>;

/** Current explicit implementation binding for the identity profile. This is
 * construction, not a service locator: every consumer receives the runtime it
 * uses, and a future implementation change must produce a new binding. */
export function createContentIdentityRuntime(): ContentIdentityRuntime {
  const content = createContentDigestRuntime(
    createAwasmBlake3WasmSimdProvider()
  );
  return Object.freeze({
    content,
    identity: createStructuredIdentityRuntime(content)
  });
}
