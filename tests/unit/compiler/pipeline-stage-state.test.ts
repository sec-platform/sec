import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { executePipelineStageLifecycle } from '../../../src/application/pipeline-stage-lifecycle.ts';
import type { PassStatus } from '../../../src/compiler/contract/pass-status.ts';
import type { PipelineStageId } from '../../../src/compiler/pipeline/stages.ts';
import { buildReviewLock } from '../../helpers/review-fixtures.ts';

function fixture(passStatus: PassStatus, failure?: { at: 'start' | 'execute'; reason: Error }) {
  const lock = buildReviewLock({ passStatus });
  const publications: PassStatus[] = [];
  const events: string[] = [];
  let executions = 0;
  const result = { lock };
  return {
    lock, publications, events, result,
    get executions() { return executions; },
    run: (stage: PipelineStageId) => executePipelineStageLifecycle(stage, {
      readExistingLock: () => lock,
      assertWrite: () => {},
      saveLock: value => { publications.push({ ...value.passStatus }); },
      recordBlocked: () => { events.push('blocked'); },
      recordStart: () => { events.push('started'); if (failure?.at === 'start') throw failure.reason; },
      recordSuccess: () => { events.push('succeeded'); },
      recordFailure: () => { events.push('failed'); },
      execute: async () => { executions++; if (failure?.at === 'execute') throw failure.reason; return result; }
    }, { extractLock: value => value.lock })
  };
}

const completed: PassStatus = { parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', 'build-ir': 'succeeded',
  compose: 'succeeded', verify: 'succeeded', repair: 'succeeded', lock: 'succeeded', emit: 'succeeded' };
const started: PassStatus = { parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', 'build-ir': 'succeeded',
  compose: 'running', verify: 'pending', repair: 'skipped', lock: 'pending', emit: 'pending' };

test('stage execution publishes exact state transitions without fabricating work after a preparation failure', async () => {
  const resolve = fixture({ parse: 'pending', align: 'pending', resolve: 'pending', 'build-ir': 'pending',
    compose: 'pending', verify: 'pending', repair: 'skipped', lock: 'pending', emit: 'pending' });
  assert.equal(await resolve.run('resolve'), resolve.result);
  assert.deepEqual(resolve.publications, [{ parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', 'build-ir': 'pending',
    compose: 'pending', verify: 'pending', repair: 'skipped', lock: 'pending', emit: 'pending' }]);
  assert.deepEqual(resolve.events, ['started', 'succeeded']);
  assert.equal(resolve.executions, 1);

  const success = fixture(completed);
  assert.equal(await success.run('compose'), success.result);
  assert.deepEqual(success.publications, [started, { ...started, compose: 'succeeded' }]);
  assert.deepEqual(success.events, ['started', 'succeeded']);
  assert.equal(success.executions, 1);
  for (const at of ['start', 'execute'] as const) {
    const reason = new Error(at);
    const failed = fixture(completed, { at, reason });
    await assert.rejects(failed.run('compose'), value => value === reason);
    assert.deepEqual(failed.publications, [started, {
      parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', 'build-ir': 'succeeded',
      compose: 'failed', verify: 'blocked', repair: 'blocked', lock: 'blocked', emit: 'blocked'
    }]);
    assert.deepEqual(failed.events, ['started', 'failed']);
    assert.equal(failed.executions, at === 'start' ? 0 : 1);
  }
});

test('a retained lock without the semantic pass reports its exact blocker before executing composition', async () => {
  const { 'build-ir': _absent, ...legacy } = completed;
  const blocked = fixture(legacy);
  await assert.rejects(blocked.run('compose'), error => {
    assert.equal((error as { code?: string }).code, 'PIPELINE-BLOCKED-002');
    assert.deepEqual((error as { details?: unknown }).details, {
      stageId: 'compose', blockers: [{ passId: 'build-ir', state: undefined }]
    });
    return true;
  });
  assert.equal(blocked.executions, 0);
  assert.deepEqual(blocked.events, ['blocked']);
  assert.deepEqual(blocked.publications, [{ parse: 'succeeded', align: 'succeeded', resolve: 'succeeded',
    compose: 'blocked', verify: 'blocked', repair: 'blocked', lock: 'blocked', emit: 'blocked' }]);
  assert.equal(Object.hasOwn(blocked.lock.passStatus, 'build-ir'), false);
});
