import * as ffi from 'bun:ffi';
import { expect, mock } from 'bun:test';
import * as fs from 'node:fs';

// This file runs in its own Bun process. Native calls are modeled here only;
// it neither opens a listener nor claims a physical Unix-socket qualification.
const realFs = { ...fs };
const realFfi = { ...ffi };
const closeError = new Error('modeled close failure');
const state = {
  duplicateFd: 902, socketResult: 901, connectResult: 0,
  credentialResult: 0, credentialSize: 12, pid: 71, uid: 23, gid: 31,
  isSocket: true, closeFailure: -1, closed: [] as number[], calls: [] as unknown[][]
};
mock.module('node:fs', () => ({
  ...realFs,
  fstatSync(fd: number, options?: never) {
    if (fd === 800) return { isSocket: () => state.isSocket };
    return realFs.fstatSync(fd, options);
  },
  closeSync(fd: number) {
    state.closed.push(fd);
    if (fd === state.closeFailure) throw closeError;
    // All descriptors passed in this process are modeled.
    return;
  }
}));
mock.module('bun:ffi', () => ({
  ...realFfi,
  read: { ...realFfi.read, i32: () => 11 },
  dlopen(_library: string, declarations: Record<string, unknown>) {
    state.calls.push(['load', Object.keys(declarations)]);
    return { symbols: {
      socket(...args: number[]) { state.calls.push(['socket', ...args]); return state.socketResult; },
      connect(fd: number, address: Buffer, length: number) {
        state.calls.push(['connect', fd, address.readUInt16LE(), address.subarray(2, length - 1).toString(), length]);
        return state.connectResult;
      },
      getsockopt(fd: number, level: number, option: number, credentials: Buffer, size: Buffer) {
        state.calls.push(['peer', fd, level, option, size.readUInt32LE()]);
        credentials.writeInt32LE(state.pid, 0);
        credentials.writeUInt32LE(state.uid, 4);
        credentials.writeUInt32LE(state.gid, 8);
        size.writeUInt32LE(state.credentialSize);
        return state.credentialResult;
      },
      fcntl(...args: number[]) { state.calls.push(['fcntl', ...args]); return state.duplicateFd; },
      __errno_location() { return 1; }
    } };
  }
}));
const { linuxRetainUnixSocketPeer } = await import('../../../src/adapters/runtime-state/physical/runtime/physical-no-follow-native.ts');
const { ResourceCompositeSettlementError } = await import('../../../src/execution/resource-settlement.ts');
const linuxTest = (name: string, run: () => void): void => {
  if (name === process.argv[2]) { reset(); run(); process.stdout.write('passed\n'); }
};

function reset(): void {
  Object.assign(state, {
    socketResult: 901, duplicateFd: 902, connectResult: 0,
    credentialResult: 0, credentialSize: 12, pid: 71, uid: 23, gid: 31,
    isSocket: true, closeFailure: -1, closed: [], calls: []
  });
}

linuxTest('native owner encodes the retained inode and owns only the peer connection', () => {
  const peer = linuxRetainUnixSocketPeer(800, 'fixture peer');
  expect(state.calls).toContainEqual(['socket', 1, 1 | 0x800 | 0x80000, 0]);
  const retainedPath = `/proc/${process.pid}/fd/800`;
  expect(state.calls).toContainEqual(['connect', 901, 1, retainedPath, Buffer.byteLength(retainedPath) + 3]);
  expect(state.calls).toContainEqual(['peer', 901, 1, 17, 12]);
  expect(peer.credentials).toEqual({ pid: 71, uid: 23, gid: 31 });
  expect(Object.isFrozen(peer)).toBe(true);
  expect(Object.isFrozen(peer.credentials)).toBe(true);
  expect(Object.keys(peer).sort()).toEqual(['assertCurrent', 'close', 'credentials']);
  peer.assertCurrent();
  state.uid += 1;
  expect(() => peer.assertCurrent()).toThrow('credentials changed');
  peer.close();
  peer.close();
  const observed = state.calls.length;
  expect(() => peer.assertCurrent()).toThrow('retained peer is closed');
  expect(state.calls).toHaveLength(observed);
  expect(state.closed).toEqual([901]);
});

linuxTest('native owner floors peer descriptors before connect and settles both generations once', () => {
  state.socketResult = 7;
  const peer = linuxRetainUnixSocketPeer(800, 'fixture peer');
  expect(state.calls).toContainEqual(['fcntl', 7, 1030, 65]);
  expect(state.calls.find(call => call[0] === 'connect')?.[1]).toBe(902);
  peer.close();
  expect(state.closed).toEqual([7, 902]);
});

linuxTest('native owner refuses invalid or non-socket borrowed descriptors before opening a peer', () => {
  expect(() => linuxRetainUnixSocketPeer(4, 'fixture peer')).toThrow('retained socket inode');
  state.isSocket = false;
  expect(() => linuxRetainUnixSocketPeer(800, 'fixture peer')).toThrow('retained socket inode');
  expect(state.calls).toEqual([]);
  expect(state.closed).toEqual([]);
});

linuxTest('native owner settles an allocated connection on incomplete connect or credential failure', () => {
  state.connectResult = -1;
  expect(() => linuxRetainUnixSocketPeer(800, 'fixture peer')).toThrow('connect did not complete');
  expect(state.closed).toEqual([901]);
  expect(state.calls.some(call => call[0] === 'peer')).toBe(false);
  state.closed = [];
  state.connectResult = 0;
  state.credentialResult = -1;
  expect(() => linuxRetainUnixSocketPeer(800, 'fixture peer')).toThrow('credentials are unavailable');
  expect(state.closed).toEqual([901]);
  state.closed = [];
  state.credentialResult = 0;
  state.credentialSize = 8;
  expect(() => linuxRetainUnixSocketPeer(800, 'fixture peer')).toThrow('credentials are unavailable');
  expect(state.closed).toEqual([901]);
});

linuxTest('native owner settles failed descriptor duplication and does not close a failed socket result', () => {
  state.socketResult = 7;
  state.duplicateFd = -1;
  expect(() => linuxRetainUnixSocketPeer(800, 'fixture peer')).toThrow('retained descriptor');
  expect(state.closed).toEqual([7]);
  state.closed = [];
  state.socketResult = -1;
  expect(() => linuxRetainUnixSocketPeer(800, 'fixture peer')).toThrow('socket creation failed');
  expect(state.closed).toEqual([]);
  state.socketResult = 7;
  state.duplicateFd = 902;
  state.closeFailure = 7;
  expect(() => linuxRetainUnixSocketPeer(800, 'fixture peer')).toThrow('pre-floor descriptor');
  expect(state.closed).toEqual([7, 902]);
});

linuxTest('native owner preserves admission and close failures and never retries a failed close', () => {
  state.connectResult = -1;
  state.closeFailure = 901;
  try {
    linuxRetainUnixSocketPeer(800, 'fixture peer');
    throw new Error('expected failed admission');
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceCompositeSettlementError);
    const composite = error as InstanceType<typeof ResourceCompositeSettlementError>;
    expect(composite.failures.map(value => value.label)).toEqual(['linux-unix-peer-admission', 'linux-unix-peer-close']);
    expect(composite.failures[1]?.error).toBe(closeError);
  }
  expect(state.closed).toEqual([901]);
  state.closed = [];
  state.connectResult = 0;
  const peer = linuxRetainUnixSocketPeer(800, 'fixture peer');
  expect(() => peer.close()).toThrow(closeError);
  expect(() => peer.close()).toThrow(closeError);
  expect(state.closed).toEqual([901]);
});
