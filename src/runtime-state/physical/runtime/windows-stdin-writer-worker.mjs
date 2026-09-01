import { parentPort } from 'node:worker_threads';

parentPort.once('message', async ({ handle, bytes }) => {
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    const kernel32 = dlopen('kernel32.dll', {
      WriteFile: {
        args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32
      }
    });
    const input = Buffer.from(bytes);
    let offset = 0;
    while (offset < input.byteLength) {
      const next = input.subarray(offset, Math.min(input.byteLength, offset + 64 * 1024));
      const written = Buffer.alloc(4);
      if (kernel32.symbols.WriteFile(handle, next, next.byteLength, written, null) === 0) {
        throw new Error('stdin write failed');
      }
      const byteLength = written.readUInt32LE(0);
      if (byteLength <= 0 || byteLength > next.byteLength) throw new Error('stdin short write');
      offset += byteLength;
    }
    parentPort.postMessage({ ok: true, byteLength: offset });
  } catch {
    parentPort.postMessage({ ok: false, byteLength: 0 });
  }
});
