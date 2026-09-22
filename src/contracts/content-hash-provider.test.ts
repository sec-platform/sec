import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  captureContentHashProvider,
  type ContentHashProvider,
  type ContentHashProviderParallelism
} from './content-hash-provider.ts';
import { createContentDigestRuntime } from './content-digest.ts';

function fakeProvider(
  parallelism: ContentHashProviderParallelism = 'single-thread'
): ContentHashProvider {
  return Object.freeze({
    descriptor: Object.freeze({
      providerId: 'test-provider/v1',
      algorithm: 'blake3-256',
      outputBytes: 32,
      streaming: true,
      updateInputLifetime: 'call-only',
      backend: 'test',
      parallelism
    }),
    create() {
      let length = 0;
      let destroyed = false;
      return Object.freeze({
        update(bytes: Uint8Array): void {
          if (destroyed) throw new Error('destroyed');
          length += bytes.byteLength;
        },
        digest(): Uint8Array {
          if (destroyed) throw new Error('destroyed');
          const out = new Uint8Array(32);
          out[0] = length & 0xff;
          return out;
        },
        destroy(): void {
          destroyed = true;
        }
      });
    }
  });
}

test('provider capture fixes the complete physical execution shape', () => {
  const provider = captureContentHashProvider(fakeProvider());
  assert.deepEqual(provider.descriptor, {
    providerId: 'test-provider/v1',
    algorithm: 'blake3-256',
    outputBytes: 32,
    streaming: true,
    updateInputLifetime: 'call-only',
    backend: 'test',
    parallelism: 'single-thread'
  });
  assert.equal(Object.isFrozen(provider), true);
  assert.equal(Object.isFrozen(provider.descriptor), true);
});

test('ordinary content identity rejects hidden parallelism', () => {
  assert.throws(
    () => createContentDigestRuntime(fakeProvider('caller-bounded')),
    /single-thread provider/u
  );
  assert.throws(
    () => createContentDigestRuntime(fakeProvider('provider-unbounded')),
    /single-thread provider/u
  );
});

test('provider and engine surfaces reject accessors proxies and unknown fields', () => {
  const accessor = { ...fakeProvider() } as Record<string, unknown>;
  Object.defineProperty(accessor, 'create', {
    enumerable: true,
    get() { throw new Error('getter invoked'); }
  });
  assert.throws(
    () => captureContentHashProvider(accessor),
    /enumerable own data/u
  );
  assert.throws(
    () => captureContentHashProvider(new Proxy(fakeProvider(), {})),
    /ordinary data object/u
  );
  assert.throws(
    () => captureContentHashProvider({
      ...fakeProvider(),
      extra: true
    }),
    /missing or unknown fields/u
  );
});

test('provider output length remains a runtime fail-closed boundary', () => {
  const bad = fakeProvider();
  const runtime = createContentDigestRuntime(Object.freeze({
    descriptor: bad.descriptor,
    create() {
      return Object.freeze({
        update(_bytes: Uint8Array): void {},
        digest(): Uint8Array { return new Uint8Array(31); },
        destroy(): void {}
      });
    }
  }));
  assert.throws(() => runtime.contentDigest('x'), /invalid output length/u);
});
