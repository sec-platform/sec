import { snapshotByteView } from '../../contracts/byte-snapshot.ts';
import { captureProjectPathInventory } from '../contract/project-path-inventory.ts';

/** Decode Git's exact NUL protocol without renaming the observed files.
 * Admit the raw record count before allocating strings, including repeated
 * index-stage paths. The Git session still owns the resource budget.
 */
export function decodeTrackedProjectPathInventory(
  bytes: Uint8Array,
  admitRecords: (count: number) => void
): readonly string[] {
  if (typeof admitRecords !== 'function') throw new TypeError('Tracked path budget admission must be callable');
  const captured = snapshotByteView(bytes, 'Tracked project paths');
  if (captured.length > 0 && captured[captured.length - 1] !== 0) {
    throw new Error('git ls-files returned a non-terminated tracked-path inventory');
  }
  let records = 0;
  for (const byte of captured) if (byte === 0) records++;
  admitRecords(records);
  if (captured.length === 0) return Object.freeze([]);
  let text: string;
  try {
    // A BOM can be part of a filename. Do not silently strip its first bytes.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured.subarray(0, -1));
  } catch (cause) {
    throw new Error('git ls-files returned a non-UTF-8 tracked path', { cause });
  }
  return captureProjectPathInventory(text.split('\0'), 'coalesce', 'Tracked project paths');
}

/** Only the C-locale discovery failure of this exact Git command means absent.
 * Exit 128 alone also covers corruption, unsafe ownership and configuration
 * errors. A matching fragment inside another diagnostic is not absence.
 */
export function isTrackedProjectRepositoryAbsent(code: unknown, stderr: unknown): boolean {
  if (code !== 128 || typeof stderr !== 'string') return false;
  return /^fatal: not a git repository \(or any of the parent directories\): \.git\r?\n?$/u.test(stderr)
    || /^fatal: not a git repository \(or any parent up to mount point [^\r\n]+\)\r?\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.\r?\n?$/u.test(stderr);
}
