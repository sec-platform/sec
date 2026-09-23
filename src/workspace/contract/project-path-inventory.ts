import { portableLogicalPathCollisionKey } from '../../contracts/logical-path.ts';

/** Logical project-file inventory, not a filesystem observation or write grant.
 * The baseline can coalesce repeated producer paths; authorization requires an
 * explicit unique scope. Neither may silently normalize two spellings together.
 */
export function captureProjectPathInventory(
  paths: readonly string[],
  duplicates: 'coalesce' | 'reject',
  label: string
): readonly string[] {
  if (!Array.isArray(paths)) throw new TypeError(`${label} must be a path array`);
  if (duplicates !== 'coalesce' && duplicates !== 'reject') throw new TypeError('Unknown project path duplicate policy');
  const byIdentity = new Map<string, string>();
  const length = paths.length;
  for (let index = 0; index < length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(paths, index);
    if (!slot || !('value' in slot) || typeof slot.value !== 'string') {
      throw new TypeError(`${label} must contain dense own string data`);
    }
    const value: string = slot.value;
    const identity = portableLogicalPathCollisionKey(value, label);
    const previous = byIdentity.get(identity);
    if (previous !== undefined && (previous !== value || duplicates === 'reject')) {
      throw new Error(`${label} repeats or aliases a project path: ${previous}, ${value}`);
    }
    byIdentity.set(identity, value);
  }
  return Object.freeze([...byIdentity.values()].sort());
}
