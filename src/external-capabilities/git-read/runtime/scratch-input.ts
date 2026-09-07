import { snapshotByteView } from '../../../system-architecture/foundation/runtime/byte-snapshot.ts';

export type GitScratchIndexTreeDelta = Readonly<{
  readonly additions: readonly Readonly<{
    readonly path: string;
    readonly bytes: Uint8Array;
  }>[];
  readonly removals: readonly string[];
}>;

function entries<T>(input: readonly T[]): T[] {
  if (!Array.isArray(input)) throw new TypeError('Git scratch delta requires arrays');
  const selected: T[] = [];
  for (let index = 0; index < input.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(input, String(index));
    if (slot === undefined || !('value' in slot)) throw new TypeError('Git scratch delta requires own data entries');
    selected.push(slot.value);
  }
  return selected;
}

/** The complete input is fixed before the first object-store write. The bound
 * byte count includes hash-object input and subsequent index-info/removal stdin;
 * the existing process owner still charges every actual command independently.
 * This is a data projection, not an authorization or a persisted second plan. */
export function captureGitScratchIndexDelta(
  input: GitScratchIndexTreeDelta,
  objectFormat: 'sha1' | 'sha256',
  maximumInputBytes: number
): GitScratchIndexTreeDelta {
  if (input === null || typeof input !== 'object' || !Number.isSafeInteger(maximumInputBytes) || maximumInputBytes < 0) {
    throw new TypeError('Git scratch delta requires a valid input and remaining byte budget');
  }
  const { additions, removals } = input;
  const selectedAdditions = entries(additions), selectedRemovals = entries(removals);
  const seen = new Set<string>();
  const selectPath = (value: unknown): string => {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')
        || value.startsWith('/') || value.startsWith('../') || value.includes('/../') || value === '..'
        || value.startsWith('./') || value.includes('/./') || seen.has(value)) {
      throw new TypeError('Git scratch delta path is invalid or repeated');
    }
    seen.add(value); return value;
  };
  let remaining = maximumInputBytes;
  const consume = (bytes: number): void => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > remaining) throw new RangeError('Git scratch delta exceeds remaining stdin budget');
    remaining -= bytes;
  };
  const capturedAdditions = selectedAdditions.map(addition => {
    if (addition === null || typeof addition !== 'object') throw new TypeError('Git scratch addition must be a record');
    const { path: requestedPath, bytes: requestedBytes } = addition;
    const path = selectPath(requestedPath);
    // `100644 <object-id>\t<path>\0` accompanies every added blob.
    consume(9 + (objectFormat === 'sha1' ? 40 : 64) + Buffer.byteLength(path, 'utf8'));
    const bytes = snapshotByteView(requestedBytes, 'Git scratch addition', remaining);
    consume(bytes.byteLength);
    return Object.freeze({ path, bytes });
  });
  const capturedRemovals = selectedRemovals.map(value => {
    const path = selectPath(value); consume(Buffer.byteLength(path, 'utf8') + 1); return path;
  });
  return Object.freeze({ additions: Object.freeze(capturedAdditions), removals: Object.freeze(capturedRemovals) });
}
