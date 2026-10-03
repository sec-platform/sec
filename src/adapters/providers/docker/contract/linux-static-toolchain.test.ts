import { expect, test } from 'bun:test';

import {
  assertLinuxDockerStaticElfProgramHeaders,
  inspectLinuxDockerStaticElfHeader,
  LinuxDockerStaticToolchainError
} from './linux-static-toolchain.ts';

// Independent ELF64 fixture: one RX PT_LOAD containing entry address 0x400078.
// No production builder is used to construct the expected executable format.
function fixture() {
  const header = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(header);
  header.writeUInt16LE(2, 16);
  header.writeUInt16LE(62, 18);
  header.writeUInt32LE(1, 20);
  header.writeBigUInt64LE(0x400078n, 24);
  header.writeBigUInt64LE(64n, 32);
  header.writeUInt16LE(64, 52);
  header.writeUInt16LE(56, 54);
  header.writeUInt16LE(1, 56);
  const table = Buffer.alloc(56);
  table.writeUInt32LE(1, 0);
  table.writeUInt32LE(5, 4);
  table.writeBigUInt64LE(0x400000n, 16);
  table.writeBigUInt64LE(128n, 32);
  table.writeBigUInt64LE(128n, 40);
  return { header, table, fileBytes: 128 };
}

function inspect(value: ReturnType<typeof fixture>) {
  const header = inspectLinuxDockerStaticElfHeader(value.header, value.fileBytes);
  assertLinuxDockerStaticElfProgramHeaders({ header, programHeaders: value.table, fileBytes: value.fileBytes });
  return header;
}

test('static Docker ELF accepts a bounded x64 executable without loader dependencies', () => {
  expect(inspect(fixture())).toEqual({ programHeaderOffset: 64, programHeaderCount: 1, entryAddress: 0x400078n });
});

test('static Docker ELF rejects scripts, wrong architecture and dynamic executable formats', () => {
  for (const mutate of [
    (header: Buffer) => { header[0] = 0x23; },
    (header: Buffer) => { header[4] = 1; },
    (header: Buffer) => { header[5] = 2; },
    (header: Buffer) => { header.writeUInt16LE(183, 18); },
    (header: Buffer) => { header.writeUInt16LE(3, 16); }
  ]) {
    const value = fixture(); mutate(value.header);
    expect(() => inspect(value)).toThrow(LinuxDockerStaticToolchainError);
  }
  for (const programType of [2, 3]) {
    const value = fixture(); value.table.writeUInt32LE(programType, 0);
    try { inspect(value); throw new Error('dynamic supply was accepted'); }
    catch (error) { expect(error).toMatchObject({ disposition: 'unsupported' }); }
  }
});

test('static Docker ELF rejects truncated, oversized and overflowing program tables', () => {
  for (const count of [0, 129, 0xffff]) {
    const value = fixture(); value.header.writeUInt16LE(count, 56);
    expect(() => inspect(value)).toThrow('out-of-bounds');
  }
  const value = fixture(); value.header.writeBigUInt64LE(0xffff_ffff_ffff_ffffn, 32);
  expect(() => inspect(value)).toThrow('out-of-bounds');
  const truncated = fixture(); truncated.table = truncated.table.subarray(0, 55);
  expect(() => inspect(truncated)).toThrow('incomplete');
});

test('static Docker ELF rejects non-executable, zero-fill-only and out-of-file entry points', () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { value.table.writeUInt32LE(4, 4); },
    (value: ReturnType<typeof fixture>) => { value.header.writeBigUInt64LE(0x400080n, 24); },
    (value: ReturnType<typeof fixture>) => { value.table.writeBigUInt64LE(120n, 32); },
    (value: ReturnType<typeof fixture>) => { value.table.writeBigUInt64LE(129n, 32); },
    (value: ReturnType<typeof fixture>) => { value.table.writeBigUInt64LE(127n, 40); }
  ]) {
    const value = fixture(); mutate(value);
    expect(() => inspect(value)).toThrow(LinuxDockerStaticToolchainError);
  }
});
