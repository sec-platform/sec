import { expect, test } from 'bun:test';
import path from 'node:path';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('Verification consumes the canonical Slot capability lint without the retired security adapter', async () => {
  const verifyProject = await readCompilerFile('platform/compiler/verify/verify-project.ts');

  expect(verifyProject).toContain("from './slot-capability-lint.ts'");
  expect(verifyProject).toContain('await lintSlotCapabilities(workspaceRoot, lock);');
  expect(verifyProject).not.toContain('validateSlotSecurity');
  expect(verifyProject).not.toContain("from './validate-slot-security.ts'");

  const retiredAdapter = Bun.file(path.resolve(
    import.meta.dir,
    '../../platform/compiler/verify/validate-slot-security.ts'
  ));
  expect(await retiredAdapter.exists()).toBe(false);
});

test('canonical Slot lint explicitly refuses to claim physical or runtime security proof', async () => {
  const lint = await readCompilerFile('platform/compiler/verify/slot-capability-lint.ts');

  expect(lint).toContain('Static authoring lint only');
  expect(lint).toContain('It never proves sandboxing, transitive dependency safety, runtime');
  expect(lint).toContain('explicit capability/effect');
  expect(lint).not.toContain('Physical security gate enforcement blocked compilation');
  expect(lint).not.toContain('Code execution gate enforcement blocked compilation');
});
