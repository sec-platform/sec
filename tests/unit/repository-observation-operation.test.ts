import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compileRepositoryObservationOperation, resolveRepositoryObservationRoots } from '../../src/development/runner/repository-observation.ts';
import { compilerRoot } from '../../src/workspace/runtime/paths.ts';

// Actual owner compilation, production Git/session issuance and retained root
// discovery are required. A fake operation, Git provider or observer cannot
// establish this result. No write/installation/remote Git command is requested.
test('standalone repository observation binding is consumed by its real root-discovery owner', async () => {
  const operation = compileRepositoryObservationOperation();
  const roots = await resolveRepositoryObservationRoots(compilerRoot, operation);
  assert.ok(roots.includes(compilerRoot));
  assert.ok(Object.isFrozen(roots));
});
