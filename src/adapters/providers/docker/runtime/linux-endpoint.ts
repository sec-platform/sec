import { closeSync, fstatSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import type { SecOperationDigest } from '../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import {
  linuxOpenLeafAt, linuxRaiseDescriptorFloor, linuxRetainUnixSocketPeer,
  type RetainedLinuxUnixSocketPeer
} from '../../../runtime-state/physical/runtime/physical-no-follow-native.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  type RetainedNoFollowChildProcessDirectory
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { DockerCommandProviderUnavailableError } from '../contract/command-provider.ts';

/** O_PATH pins the socket inode; SO_PEERCRED describes the actual connected peer. */
export interface LinuxDockerEndpoint {
  readonly endpointHost: string;
  readonly transportHost: string;
  readonly identityDigest: SecOperationDigest;
  assertCurrent(): void;
  close(): void;
}

const issued = new WeakSet<object>();

function unavailable(message: string): never {
  throw new DockerCommandProviderUnavailableError(`Linux Docker endpoint: ${message}`);
}

export function assertLinuxDockerEndpoint(endpoint: LinuxDockerEndpoint): void {
  if (!issued.has(endpoint)) unavailable('endpoint is not owner-issued.');
  endpoint.assertCurrent();
}

export function openLinuxDockerEndpoint(input: Readonly<{
  endpointHost: string;
  peerUid: number;
}>): LinuxDockerEndpoint {
  if (process.platform !== 'linux' || process.arch !== 'x64') unavailable('unsupported native ABI.');
  const socketPath = input.endpointHost.slice('unix://'.length);
  if (!input.endpointHost.startsWith('unix:///') || socketPath.includes('\0')
      || path.posix.resolve(socketPath) !== socketPath
      || !Number.isSafeInteger(input.peerUid) || input.peerUid < 0) {
    unavailable('requires a canonical local socket and peer UID.');
  }
  let parent: RetainedNoFollowChildProcessDirectory | undefined;
  let socketFd: number | undefined;
  let retainedPeer: RetainedLinuxUnixSocketPeer | undefined;
  let closed = false;
  let closeFailure: unknown;
  const close = (): void => {
    if (closed) {
      if (closeFailure !== undefined) throw closeFailure;
      return;
    }
    closed = true;
    try {
      settleResources({ cleanup: [
        { label: 'peer-connection-close', settle: () => retainedPeer?.close() },
        { label: 'socket-inode-close', settle: () => { if (socketFd !== undefined) closeSync(socketFd); } },
        { label: 'socket-parent-close', settle: () => parent?.dispose() }
      ] });
    } catch (error) {
      closeFailure = error;
      throw error;
    }
  };
  try {
    parent = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(path.posix.dirname(socketPath), 'Linux Docker socket parent'),
      46, 'Linux Docker socket parent'
    );
    const opened = linuxOpenLeafAt(parent.stdioSourceDescriptor!, path.posix.basename(socketPath), 'Linux Docker socket');
    try { socketFd = linuxRaiseDescriptorFloor(opened, 'Linux Docker socket'); }
    catch (error) { closeSync(opened); throw error; }
    const before = fstatSync(socketFd, { bigint: true });
    if (!before.isSocket() || before.uid !== BigInt(input.peerUid) || before.nlink !== 1n) {
      unavailable('socket type, ownership or link identity is unqualified.');
    }
    const transportPath = `/proc/${process.pid}/fd/${socketFd}`;
    const transportHost = `unix://${transportPath}`;
    retainedPeer = linuxRetainUnixSocketPeer(socketFd, 'Linux Docker peer connection');
    const peer = retainedPeer.credentials;
    if (peer.pid < 1 || peer.uid !== input.peerUid) unavailable('connected peer is not the admitted owner.');
    const identity = {
      device: String(before.dev), inode: String(before.ino), mode: String(before.mode),
      uid: String(before.uid), gid: String(before.gid), peer
    };
    const assertCurrent = (): void => {
      if (closed) unavailable('retained endpoint is closed.');
      parent!.assertCurrent();
      const current = fstatSync(socketFd!, { bigint: true });
      const lexical = linuxOpenLeafAt(parent!.stdioSourceDescriptor!, path.posix.basename(socketPath), 'Linux Docker socket readback');
      try {
        const leaf = fstatSync(lexical, { bigint: true });
        for (const observed of [current, leaf]) {
          if (!observed.isSocket() || observed.dev !== before.dev || observed.ino !== before.ino
              || observed.mode !== before.mode || observed.uid !== before.uid || observed.gid !== before.gid
              || observed.nlink !== before.nlink) unavailable('retained socket identity changed.');
        }
        retainedPeer!.assertCurrent();
      } finally { closeSync(lexical); }
    };
    assertCurrent();
    const endpoint = Object.freeze({
      endpointHost: input.endpointHost, transportHost,
      identityDigest: sha256({ domain: 'sec.docker.linux-retained-endpoint', endpointHost: input.endpointHost, identity }) as SecOperationDigest,
      assertCurrent, close
    });
    issued.add(endpoint);
    return endpoint;
  } catch (error) {
    settleResources({ primary: { label: 'linux-endpoint-admission', error }, cleanup: [{ label: 'linux-endpoint-close', settle: close }] });
    throw error;
  }
}
