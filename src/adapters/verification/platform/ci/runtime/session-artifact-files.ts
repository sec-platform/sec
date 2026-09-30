/** VerificationSession durable artifact owner backed by Runtime Physical capabilities. */
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  type PhysicalDirectoryIdentity
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import path from 'node:path';

const SESSION_ARTIFACT_MAXIMUM_BYTES = 64 * 1024 * 1024;

type SessionArtifactTarget = Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
}>;

function sessionArtifactTarget(filePath: string, label: string): SessionArtifactTarget {
  const absolute = path.resolve(filePath);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(absolute),
    `${label} parent`
  ).target;
  const name = path.basename(absolute);
  if (name.length === 0 || name === '.' || name === '..' || name.includes('\0')) {
    throw new Error(`${label} leaf name is invalid.`);
  }
  return Object.freeze({ parent, name });
}

function readSessionArtifactBytes(filePath: string, label: string): Buffer {
  const target = sessionArtifactTarget(filePath, label);
  const entry = inspectNoFollowOrdinaryFileEntry(target.parent, target.name, {
    maximumBytes: SESSION_ARTIFACT_MAXIMUM_BYTES
  });
  if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
    throw new Error(`${label} must be one ordinary file.`);
  }
  return Buffer.from(entry.bytes);
}

function writeSessionArtifactBytes(
  filePath: string,
  bytes: Uint8Array,
  label: string
): void {
  const target = sessionArtifactTarget(filePath, label);
  const expected = Buffer.from(bytes);
  const current = inspectNoFollowOrdinaryFileEntry(target.parent, target.name, {
    maximumBytes: SESSION_ARTIFACT_MAXIMUM_BYTES
  });
  const validate = (observed: Uint8Array): void => {
    if (!Buffer.from(observed).equals(expected)) {
      throw new Error(`${label} durable readback differs from the exact bytes.`);
    }
  };
  if (current === null) {
    publishExclusiveDurableCanonicalFile({
      parent: target.parent,
      name: target.name,
      bytes: expected,
      validate
    });
    return;
  }
  if (current.kind !== 'file') {
    throw new Error(`${label} replacement target must remain an ordinary file.`);
  }
  replaceDurableCanonicalFile({
    parent: target.parent,
    name: target.name,
    bytes: expected,
    validate,
    expectedExisting: Object.freeze({
      device: current.device,
      inode: current.inode
    }),
    rejectExistingHardLinks: true
  });
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      readSessionArtifactBytes(filePath, 'VerificationSession JSON artifact')
    )
  ) as T;
}

export function writeDurable(filePath: string, value: unknown): void {
  writeSessionArtifactBytes(
    filePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
    'VerificationSession durable artifact'
  );
}

export function writeCanonicalDurable(filePath: string, value: unknown): void {
  writeSessionArtifactBytes(
    filePath,
    Buffer.from(`${encodeVerificationActionData(value)}\n`, 'utf8'),
    'VerificationSession canonical artifact'
  );
}
