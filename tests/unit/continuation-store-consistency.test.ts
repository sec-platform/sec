import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveRuntimeStateForRepository } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { createLocalContinuationCheckpoint } from '../../src/adapters/self-hosting/control/continuation/checkpoint.ts';
import { clearActiveContinuation, gcContinuationObjects, loadActiveContinuationCheckpoint, persistActiveContinuationCheckpoint } from '../../src/adapters/self-hosting/control/continuation/runtime-store.ts';

// Native owner integration: intentionally uses the real physical authority and
// gate. Must run under the repository's supported Bun/host profile, not a stub.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-continuation-consistency-'));
  const repositoryRoot = path.join(root, 'repo'); mkdirSync(repositoryRoot);
  const environment = { ...process.env, SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') };
  const checkpoint = createLocalContinuationCheckpoint({ repository: 'sec-platform/sec', prNumber: 573,
    branch: 'refactor/repository-architecture-convergence-v1', baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40),
    headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40), manifestPath: 'config/repository/work-packages/sec-static-convergence-v1.md' });
  const layout = resolveRuntimeStateForRepository({ repository: checkpoint.repository, repositoryRoot, environment });
  return { root, repositoryRoot, environment, checkpoint, layout };
}

test('unknown object-store entry vetoes the entire deletion pass, regardless of enumeration order', async () => {
  const f = fixture();
  try {
    await persistActiveContinuationCheckpoint(f);
    await clearActiveContinuation(f);
    const objectPath = path.join(f.layout.continuationObjectRoot, f.checkpoint.checkpointDigest.slice(7) + '.json');
    mkdirSync(path.join(f.layout.continuationObjectRoot, 'zz-unknown-entry'));
    const result = await gcContinuationObjects({ ...f, retentionMs: 0 });
    assert.equal(result.removed, 0); assert.equal(result.retained, 1); assert.ok(existsSync(objectPath));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}, 30_000);

test('a duplicate pointer key is rejected even when both copies have the same value', async () => {
  const f = fixture();
  try {
    await persistActiveContinuationCheckpoint(f);
    const bytes = readFileSync(f.layout.continuationPointerPath, 'utf8');
    const schema = JSON.parse(bytes).schema;
    writeFileSync(f.layout.continuationPointerPath, bytes.replace('{', `{"schema":${JSON.stringify(schema)},`));
    await assert.rejects(loadActiveContinuationCheckpoint(f));
    // An invalid pointer must retain its object, not authorize GC.
    assert.equal((await gcContinuationObjects({ ...f, retentionMs: 0 })).removed, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}, 30_000);

test('concurrent active reads and GC return the same reachable checkpoint', async () => {
  const f = fixture();
  try {
    await persistActiveContinuationCheckpoint(f);
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => index % 2 === 0
      ? loadActiveContinuationCheckpoint(f).then(value => { assert.deepEqual(value, f.checkpoint); })
      : gcContinuationObjects({ ...f, retentionMs: 0 }).then(value => { assert.equal(value.removed, 0); })));
    assert.equal(results.length, 8);
    await clearActiveContinuation(f);
    assert.equal((await gcContinuationObjects({ ...f, retentionMs: 0 })).removed, 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}, 30_000);
