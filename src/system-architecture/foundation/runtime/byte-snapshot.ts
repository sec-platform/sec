import { types as nativeTypes } from 'node:util';

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const nativeByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;

/** Copy the actual admitted byte view, not shadowable public properties or a
 * custom iterator. This snapshot owns bytes, not resource/IO authority. Shared
 * memory requires synchronization by its owner before entering this boundary. */
export function snapshotByteView(bytes: Uint8Array, label = 'Bytes'): Uint8Array {
  if (!nativeTypes.isUint8Array(bytes)) throw new TypeError(`${label} must be Uint8Array data`);
  const buffer = nativeBuffer.call(bytes);
  if (nativeTypes.isSharedArrayBuffer(buffer)) throw new TypeError(`${label} cannot use shared memory`);
  const view = new Uint8Array(buffer, nativeByteOffset.call(bytes), nativeByteLength.call(bytes));
  return Buffer.from(view);
}
