import { blake3 } from '@awasm/noble/wasm.js';

import {
  CONTENT_HASH_ALGORITHM,
  CONTENT_HASH_OUTPUT_BYTES,
  type ContentHashProvider
} from '../../../contracts/content-hash-provider.ts';

const AWASM_BLAKE3_WASM_SIMD_PROVIDER_ID =
  '@awasm/noble@0.1.4/wasm-simd' as const;

const descriptor = Object.freeze({
  providerId: AWASM_BLAKE3_WASM_SIMD_PROVIDER_ID,
  algorithm: CONTENT_HASH_ALGORITHM,
  outputBytes: CONTENT_HASH_OUTPUT_BYTES,
  streaming: true as const,
  updateInputLifetime: 'call-only' as const,
  backend: 'wasm-simd',
  parallelism: 'single-thread' as const
});

/** Physical BLAKE3 provider. The package/version are lock-bound. This adapter
 * exposes no key, output-length, algorithm, reset, worker-count or XOF choice
 * to identity callers. The default awasm target is synchronous WASM+SIMD; the
 * separate wasm_threads target is intentionally not imported because its
 * shared worker pool has no caller-bounded slot contract. */
export function createAwasmBlake3WasmSimdProvider(): ContentHashProvider {
  if (blake3.outputLen !== CONTENT_HASH_OUTPUT_BYTES
      || blake3.canXOF !== true
      || blake3.getPlatform() !== 'wasm') {
    throw new Error('Pinned awasm BLAKE3 provider does not match its binding contract');
  }
  return Object.freeze({
    descriptor,
    create() {
      const hash = blake3.create();
      if (hash.outputLen !== CONTENT_HASH_OUTPUT_BYTES || hash.canXOF !== true) {
        hash.destroy();
        throw new Error('Pinned awasm BLAKE3 stream does not match its binding contract');
      }
      return Object.freeze({
        update(bytes: Uint8Array): void {
          hash.update(bytes);
        },
        digest(): Uint8Array {
          return hash.digest();
        },
        destroy(): void {
          hash.destroy();
        }
      });
    }
  });
}
