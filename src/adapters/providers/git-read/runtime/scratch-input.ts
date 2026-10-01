import { borrowByteView, snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';

export type GitScratchIndexTreeDelta = Readonly<{
  readonly additions: readonly Readonly<{
    readonly path: string;
    readonly bytes: Uint8Array;
  }>[];
  readonly removals: readonly string[];
}>;

/** NUL-delimited index-info record. The caller has already admitted the path
 * and object identity. Sharing this protocol representation keeps preflight
 * byte cost and actual stdin in agreement; it does not grant a write. */
export function formatGitScratchIndexRecord(
  mode: '0' | '100644', objectId: string, path: string
): string {
  return `${mode} ${objectId}\t${path}\0`;
}

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
  const zeroObject = '0'.repeat(objectFormat === 'sha1' ? 40 : 64);
  const indexRecordOverhead = Buffer.byteLength(formatGitScratchIndexRecord('100644', zeroObject, ''), 'utf8');
  const removalRecordOverhead = Buffer.byteLength(formatGitScratchIndexRecord('0', zeroObject, ''), 'utf8');
  // Every accepted path has at least one UTF-8 byte. Apply this lower bound
  // before traversing or duplicating a possibly huge caller-supplied array.
  const minimumAdditionBytes = indexRecordOverhead + 1;
  if (additionCount > Math.floor(maximumInputBytes / minimumAdditionBytes)
      || removalCount > Math.floor((maximumInputBytes - additionCount * minimumAdditionBytes) / (removalRecordOverhead + 1))) {
    throw new RangeError('Git scratch delta exceeds remaining stdin budget');
  }
  const seen = new Set<string>();
  const selectPath = (value: unknown): string => {
    if (typeof value !== 'string') throw new TypeError('Git scratch delta path must be a string');
    const bytes = Buffer.byteLength(value, 'utf8');
    // Admit bytes before normalization, component splitting or retaining the
    // path. Metadata rejection must not first clone unrelated blob inputs.
    consume(bytes);
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
  const selectedAdditions: Array<{ path: string; source: GitScratchIndexTreeDelta['additions'][number] }> = [];
  const additionPaths = new Set<string>();
  for (let index = 0; index < additionCount; index++) {
    const addition = ownEntry(additions, index);
    if (addition === null || typeof addition !== 'object' || Array.isArray(addition)) {
      throw new TypeError('Git scratch addition must be a record');
    }
    const requestedPath = addition.path;
    consume(indexRecordOverhead);
    const path = selectPath(requestedPath);
    selectedAdditions.push({ path, source: addition });
    additionPaths.add(path);
  }
  const capturedRemovals: string[] = [];
  for (let index = 0; index < removalCount; index++) {
    consume(removalRecordOverhead);
    const path = selectPath(ownEntry(removals, index));
    capturedRemovals.push(path);
  }
  // Two additions cannot simultaneously describe a file and its descendant.
  // Removal of an old parent while adding a child remains a separate legal case.
  // NUL is forbidden by the canonical path grammar. Ordering separators before
  // all component bytes makes a file adjacent to its first descendant, even
  // with intervening ordinary names such as a, a-, a/b in ordinary sort order.
  // Build one linear-sized key per path, never one full prefix per separator.
  const ordered = [...additionPaths].map(path => ({ path, key: path.replaceAll('/', '\0') }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.path.startsWith(`${ordered[index - 1]!.path}/`)) {
      throw new TypeError('Git scratch additions contain a file/directory conflict');
    }
  }
  const selectedBytes: Array<{ path: string; view: Uint8Array; length: number }> = [];
  for (const { path, source } of selectedAdditions) {
    const view = borrowByteView(source.bytes, 'Git scratch addition');
    const length = view.byteLength;
    consume(length);
    selectedBytes.push({ path, view, length });
  }
  // All blob lengths fit before the first clone. Borrowed views never leave
  // this synchronous capture; the result owns independent bytes.
  const capturedAdditions = selectedBytes.map(({ path, view, length }) => {
    const bytes = snapshotByteView(view, 'Git scratch addition', length);
    if (bytes.byteLength !== length) throw new TypeError('Git scratch addition changed during capture');
    return Object.freeze({ path, bytes });
  });
  return Object.freeze({ additions: Object.freeze(capturedAdditions), removals: Object.freeze(capturedRemovals) });
}
