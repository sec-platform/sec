import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../system-architecture/foundation/contract/repository-path.ts';
import { snapshotByteView } from '../../../system-architecture/foundation/runtime/byte-snapshot.ts';

export type GitScratchIndexTreeDelta = Readonly<{
  readonly additions: readonly Readonly<{
    readonly path: string;
    readonly bytes: Uint8Array;
  }>[];
  readonly removals: readonly string[];
}>;

function ownEntry<T>(input: readonly T[], index: number): T {
  const slot = Object.getOwnPropertyDescriptor(input, String(index));
  if (slot === undefined || !('value' in slot)) {
    throw new TypeError('Git scratch delta requires own data entries');
  }
  return slot.value;
}

/** The complete input is fixed before the first object-store write. Metadata
 * and byte admission are separate: reject an impossible count, invalid path or
 * conflicting file tree before cloning blob data. The existing process owner
 * still charges every actual command; this projection issues no capability.
 */
export function captureGitScratchIndexDelta(
  input: GitScratchIndexTreeDelta,
  objectFormat: 'sha1' | 'sha256',
  maximumInputBytes: number
): GitScratchIndexTreeDelta {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
      || (objectFormat !== 'sha1' && objectFormat !== 'sha256')
      || !Number.isSafeInteger(maximumInputBytes) || maximumInputBytes < 0) {
    throw new TypeError('Git scratch delta requires a valid input, object format and remaining byte budget');
  }
  const { additions, removals } = input;
  if (!Array.isArray(additions) || !Array.isArray(removals)) {
    throw new TypeError('Git scratch delta requires arrays');
  }
  const additionCount = Object.getOwnPropertyDescriptor(additions, 'length')!.value as number;
  const removalCount = Object.getOwnPropertyDescriptor(removals, 'length')!.value as number;
  const indexRecordOverhead = 9 + (objectFormat === 'sha1' ? 40 : 64);
  // Every accepted path has at least one UTF-8 byte. Apply this lower bound
  // before traversing or duplicating a possibly huge caller-supplied array.
  const minimumAdditionBytes = indexRecordOverhead + 1;
  if (additionCount > Math.floor(maximumInputBytes / minimumAdditionBytes)
      || removalCount > Math.floor((maximumInputBytes - additionCount * minimumAdditionBytes) / 2)) {
    throw new RangeError('Git scratch delta exceeds remaining stdin budget');
  }
  const seen = new Set<string>();
  const selectPath = (value: unknown): string => {
    if (!CodexDevelopmentIsCanonicalRepositoryPath(value) || seen.has(value)) {
      throw new TypeError('Git scratch delta path is invalid or repeated');
    }
    // Repository selectors supply the canonical path syntax; index writes also
    // exclude Git administrative components, including default NTFS aliases.
    if (value.split('/').some(segment => {
      const folded = segment.toLowerCase().replace(/[ .]+$/u, '');
      return folded === '.git' || folded === 'git~1';
    })) throw new TypeError('Git scratch delta cannot target Git administrative paths');
    seen.add(value);
    return value;
  };
  let remaining = maximumInputBytes;
  const consume = (bytes: number): void => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > remaining) {
      throw new RangeError('Git scratch delta exceeds remaining stdin budget');
    }
    remaining -= bytes;
  };
  const selectedAdditions: Array<{ path: string; bytes: Uint8Array }> = [];
  const additionPaths = new Set<string>();
  for (let index = 0; index < additionCount; index++) {
    const addition = ownEntry(additions, index);
    if (addition === null || typeof addition !== 'object' || Array.isArray(addition)) {
      throw new TypeError('Git scratch addition must be a record');
    }
    const { path: requestedPath, bytes } = addition;
    const path = selectPath(requestedPath);
    consume(indexRecordOverhead + Buffer.byteLength(path, 'utf8'));
    selectedAdditions.push({ path, bytes });
    additionPaths.add(path);
  }
  const capturedRemovals: string[] = [];
  for (let index = 0; index < removalCount; index++) {
    const path = selectPath(ownEntry(removals, index));
    consume(Buffer.byteLength(path, 'utf8') + 1);
    capturedRemovals.push(path);
  }
  // Two additions cannot simultaneously describe a file and its descendant.
  // Removal of an old parent while adding a child remains a separate legal case.
  for (const path of additionPaths) {
    for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
      if (additionPaths.has(path.slice(0, slash))) {
        throw new TypeError('Git scratch additions contain a file/directory conflict');
      }
    }
  }
  const capturedAdditions = selectedAdditions.map(({ path, bytes: requestedBytes }) => {
    const bytes = snapshotByteView(requestedBytes, 'Git scratch addition', remaining);
    consume(bytes.byteLength);
    return Object.freeze({ path, bytes });
  });
  return Object.freeze({ additions: Object.freeze(capturedAdditions), removals: Object.freeze(capturedRemovals) });
}
