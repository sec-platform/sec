/** Local VerificationSession artifact bytes; provider provenance remains with the caller. */
import path from 'node:path';

import {
  PhysicalNoFollowError,
  inspectNoFollowDirectoryChain,
  recoverDurableCanonicalFileReplacement,
  replaceDurableCanonicalFile,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain,
  type RetainedNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';

type ArtifactTarget = Readonly<{ parent: PhysicalDirectoryChain; name: string }>;

function artifactTarget(filePath: string): ArtifactTarget {
  const target = path.resolve(filePath);
  return Object.freeze({
    parent: inspectNoFollowDirectoryChain(path.dirname(target), 'VerificationSession artifact parent'),
    name: path.basename(target)
  });
}

function retainArtifact(target: ArtifactTarget): RetainedNoFollowOrdinaryFile {
  const retained = retainNoFollowOrdinaryFile(
    target.parent, target.name, undefined, 'VerificationSession artifact'
  );
  try {
    if (retained.linkCount !== 1) {
      throw new PhysicalNoFollowError(
        'PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'VerificationSession artifact must have exactly one link.'
      );
    }
    retained.assertCurrent();
    return retained;
  } catch (error) {
    retained.dispose();
    throw error;
  }
}

export function readSessionArtifactBytes(filePath: string): Buffer {
  const retained = retainArtifact(artifactTarget(filePath));
  try {
    return Buffer.from(retained.readBytes());
  } finally {
    retained.dispose();
  }
}

export function readSessionArtifactText(filePath: string): string {
  // Preserve a leading BOM so JSON/canonical consumers retain their format checks.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readSessionArtifactBytes(filePath));
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readSessionArtifactText(filePath)) as T;
}

function writeArtifact(filePath: string, bytes: Buffer): void {
  const target = artifactTarget(filePath);
  // An interrupted Windows replacement can temporarily quarantine the old
  // canonical leaf. Settle that transaction before interpreting absence.
  recoverDurableCanonicalFileReplacement({ parent: target.parent.target, name: target.name });
  let expectedExisting: RetainedNoFollowOrdinaryFile['physical'] | null = null;
  let current: RetainedNoFollowOrdinaryFile | null = null;
  try {
    current = retainArtifact(target);
    expectedExisting = current.physical;
  } catch (error) {
    if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
  } finally {
    // Windows ordinary-file retention excludes replacement while held. The
    // Physical replacement owner rechecks this exact identity and link policy;
    // artifact output is not an expected-old-byte compare-and-swap operation.
    current?.dispose();
  }
  replaceDurableCanonicalFile({
    parent: target.parent.target,
    name: target.name,
    bytes,
    expectedExisting,
    rejectExistingHardLinks: true,
    validate: (observed) => {
      if (!Buffer.from(observed).equals(bytes)) {
        throw new Error('VerificationSession artifact durable readback differs from the exact bytes.');
      }
    }
  });
}

export function writeDurable(filePath: string, value: unknown): void {
  writeArtifact(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

export function writeCanonicalDurable(filePath: string, value: unknown): void {
  writeArtifact(filePath, Buffer.from(`${encodeVerificationActionData(value)}\n`, 'utf8'));
}
