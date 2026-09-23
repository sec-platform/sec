import { types as nativeTypes } from 'node:util';

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const nativeByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;

function ordinaryByteView(bytes: Uint8Array, label: string): Uint8Array {
  if (!nativeTypes.isUint8Array(bytes)) throw new TypeError(`${label} must be Uint8Array data`);
  const buffer = nativeBuffer.call(bytes);
  if (nativeTypes.isSharedArrayBuffer(buffer)) throw new TypeError(`${label} cannot use shared memory`);
  return new Uint8Array(buffer, nativeByteOffset.call(bytes), nativeByteLength.call(bytes));
}

function validateMaximum(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError('Byte snapshot maximum must be a non-negative safe integer');
  }
}

/** Borrow one admitted ordinary byte view for a synchronous consumer. The
 * caller must not retain the returned view past the call that requested it.
 * Shared memory, spoofed typed arrays and detached backing stores fail closed.
 * Unlike snapshotByteView this performs no full-input copy. */
export function borrowByteView(bytes: Uint8Array, label = 'Bytes'): Uint8Array {
  return ordinaryByteView(bytes, label);
}

/** Copy the actual admitted byte view, not shadowable public properties or a
 * custom iterator. This snapshot owns bytes, not resource/IO authority. Shared
 * memory requires synchronization by its owner before entering this boundary. */
export function snapshotByteView(bytes: Uint8Array, label = 'Bytes', maximumBytes?: number): Uint8Array {
  if (maximumBytes !== undefined) validateMaximum(maximumBytes);
  const view = ordinaryByteView(bytes, label);
  if (maximumBytes !== undefined && view.byteLength > maximumBytes) {
    throw new RangeError(`${label} exceeds its byte snapshot limit`);
  }
  return Buffer.from(view);
}

/** Diagnostic suffix projection, deliberately different from full-input
 * admission: excess leading bytes are discarded. The native subview is built
 * before copying, so copied memory is bounded by maximumBytes, not input size.
 * No caller iterator/species/subarray override participates; shared memory is
 * still refused. The result owns its bytes and cannot retain the source buffer.
 */
export function snapshotByteTail(bytes: Uint8Array, maximumBytes: number, label = 'Byte tail'): Buffer {
  validateMaximum(maximumBytes);
  const view = ordinaryByteView(bytes, label);
  return Buffer.from(view.subarray(Math.max(0, view.byteLength - maximumBytes)));
}
