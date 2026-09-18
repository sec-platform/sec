import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TEST_IMPACT_SOURCE_KINDS,
  testImpactModuleIdsForSourceKind
} from '../../src/adapters/verification/platform/test-impact/contract/ownership.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

// A stale kind-to-owner label must not silently turn a non-code change into
// an empty selection after a directory/module migration.
for (const kind of TEST_IMPACT_SOURCE_KINDS) {
  test(`every ${kind} impact binding names an existing runtime module declaration`, () => {
    const owners = testImpactModuleIdsForSourceKind(kind);
    expect(new Set(owners).size).toBe(owners.length);
    if (kind !== 'typescript') expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) {
      const descriptor = path.join(repositoryRoot, 'src', ...owner.split('.'), 'sec.module.json');
      expect(JSON.parse(readFileSync(descriptor, 'utf8')).importGraph).toBe('runtime');
    }
  });
}
