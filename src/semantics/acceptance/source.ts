import { canonicalEquals, isPlainObject, uniqueSorted } from '../../contracts/canonical.ts';
import { assertCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { isSecRepositoryTestModulePath } from '../../contracts/repository-test-path.ts';
import { isCanonicalBlockId } from '../identity/block.ts';
import { isCanonicalAcceptanceId } from './identity.ts';
import type { AcceptanceItem } from './types.ts';

export function canonicalAcceptanceTestPath(value: string): string {
  assertCanonicalPortableLogicalPath(value, 'Acceptance proof path');
  if (!value.startsWith('tests/acceptance/') || !isSecRepositoryTestModulePath(value)) {
    throw new Error(`Acceptance proof path is outside the canonical test domain: ${value}`);
  }
  return value;
}

export function validateAcceptanceSourceTests(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(path => typeof path !== 'string')) {
    throw new Error('Acceptance source tests must be a nonempty canonical path array');
  }
  const paths = value.map(canonicalAcceptanceTestPath);
  if (!canonicalEquals(paths, uniqueSorted(paths))) {
    throw new Error('Acceptance source tests must be unique and canonically ordered');
  }
  return paths;
}

/** One declaration contract shared by manifests, captured Locks and evidence.
 * Selection/installation and coverage qualification belong to Assurance. */
export function validateAcceptanceItem(value: unknown): AcceptanceItem {
  if (!isPlainObject(value) || !Object.hasOwn(value, 'id') || !isCanonicalAcceptanceId(value.id)) throw new Error('Acceptance has a non-canonical Acceptance id');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !['id', 'dependsOn', 'covers', 'source'].includes(key))) throw new Error('Acceptance has unsupported fields');
  const item: AcceptanceItem = { id: value.id };
  if (value.dependsOn !== undefined) {
    if (!Array.isArray(value.dependsOn) || value.dependsOn.some(id => !isCanonicalAcceptanceId(id))) throw new Error('Acceptance has a non-canonical dependency identity');
    item.dependsOn = [...value.dependsOn];
  }
  if (value.covers !== undefined) {
    if (!isPlainObject(value.covers) || Reflect.ownKeys(value.covers).some(key => key !== 'blocks')) throw new Error('Acceptance has unsupported coverage fields');
    item.covers = {};
    if (value.covers.blocks !== undefined) {
      if (!Array.isArray(value.covers.blocks) || value.covers.blocks.some(id => !isCanonicalBlockId(id))) throw new Error('Acceptance has a non-canonical Block coverage identity');
      item.covers.blocks = [...value.covers.blocks];
    }
  }
  if (value.source !== undefined) {
    if (!isPlainObject(value.source) || Reflect.ownKeys(value.source).length !== 1 || !Object.hasOwn(value.source, 'tests')) throw new Error('Acceptance source requires only tests');
    item.source = { tests: validateAcceptanceSourceTests(value.source.tests) };
  }
  return item;
}
