import { isUtf8 } from 'node:buffer';

import { rawSha256Hex } from '../../contracts/canonical.ts';
import { readOptionalRetainedOrdinaryFile } from '../runtime-state/physical/runtime/retained-file-read.ts';

function readProjectFileBytes(absolutePath: string): Uint8Array | undefined {
  return readOptionalRetainedOrdinaryFile(absolutePath, 'Project integrity hash') ?? undefined;
}

/**
 * Raw project-integrity hash over one retained ordinary file. Only physical
 * absence maps to undefined; links, non-ordinary leaves, inaccessible parents,
 * identity races and the bounded no-follow read ceiling fail closed.
 *
 * This API is deliberately synchronous because the retained no-follow reader
 * and digest backend are synchronous. Callers must not wrap it in Promise
 * fanout and claim I/O parallelism; true parallelism requires an owning async
 * physical-read provider or worker/backend decision.
 */
export function calculateProjectFileHash(absolutePath: string): string | undefined {
  const content = readProjectFileBytes(absolutePath);
  return content === undefined ? undefined : rawSha256Hex(content);
}

/**
 * Provenance-compatible hash normalizes line endings only after the exact
 * retained bytes have been observed. Binary inputs remain byte-exact.
 *
 * Like calculateProjectFileHash, this is intentionally synchronous so the
 * public contract reflects the actual physical execution model.
 */
export function calculateCanonicalProjectFileHash(absolutePath: string): string | undefined {
  const content = readProjectFileBytes(absolutePath);
  if (content === undefined) return undefined;
  const buffer = Buffer.from(content);
  const canonicalContent = isUtf8(buffer)
    ? buffer.toString('utf8').replace(/\r\n?/g, '\n')
    : buffer;
  return rawSha256Hex(canonicalContent);
}
