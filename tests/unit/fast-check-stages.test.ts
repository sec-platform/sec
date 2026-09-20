import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { executeFastCheckStages, type FastCheckStages } from '../../src/adapters/self-hosting/development/runner/fast-check-stages.ts';

function stages(events: string[], overrides: Partial<FastCheckStages> = {}): FastCheckStages {
  const run = (name: string) => async () => { events.push(name); return 0; };
  return { imports: run('imports'), documentation: run('docs'),
    types: run('types'), tests: run('tests'), ...overrides };
}

test('imports complete before parallel checking and test execution', async () => {
  const events: string[] = [];
  assert.equal(await executeFastCheckStages(stages(events)), 0);
  assert.deepEqual(events, ['imports', 'docs', 'types', 'tests']);
});

test('imports rejection or failure code prevents every later stage', async () => {
  for (const reject of [false, true]) {
    const events: string[] = [], reason = new Error('imports');
    const input = stages(events, { imports: async () => { if (reject) throw reason; return 7; } });
    if (reject) await assert.rejects(executeFastCheckStages(input), error => error === reason);
    else assert.equal(await executeFastCheckStages(input), 7);
    assert.deepEqual(events, []);
  }
});

test('one parallel rejection cannot return while the other check is still running', async () => {
  let release!: () => void, entered!: () => void, finished = false;
  const held = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const reason = new Error('docs'), events: string[] = [];
  const promise = executeFastCheckStages(stages(events, {
    documentation: async () => { throw reason; }, types: async () => { entered(); await held; return 0; }
  })).finally(() => { finished = true; });
  const outcome = assert.rejects(promise, error => error === reason);
  try { await started; await new Promise(r => setTimeout(r, 0)); assert.equal(finished, false); }
  finally { release(); }
  await outcome; assert.equal(events.includes('tests'), false);
});

test('parallel checks retain both raw errors and never invoke tests', async () => {
  const second = new Error('types'), events: string[] = [];
  await assert.rejects(executeFastCheckStages(stages(events, {
    documentation: async () => { throw undefined; }, types: async () => { throw second; }
  })), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [undefined, second]);
    assert.equal(error.cause, undefined); return true;
  });
  assert.equal(events.includes('tests'), false);
});

test('parallel exit failures keep documentation priority and stop before tests', async () => {
  const events: string[] = [];
  assert.equal(await executeFastCheckStages(stages(events, {
    documentation: async () => 5, types: async () => 6
  })), 5);
  assert.deepEqual(events, ['imports']);
});

test('selected methods retain their receiver and cannot be replaced by an earlier stage', async () => {
  class Stages implements FastCheckStages {
    #imported = false;
    async imports() { this.documentation = async () => assert.fail('replacement'); this.#imported = true; return 0; }
    async documentation() { assert.equal(this.#imported, true); return 0; }
    async types() { return 0; }
    async tests() { assert.equal(this.#imported, true); return 0; }
  }
  assert.equal(await executeFastCheckStages(new Stages()), 0);
});

test('missing required stages are not treated as optional checks', async () => {
  const events: string[] = [];
  await assert.rejects(executeFastCheckStages(stages(events, { documentation: undefined })), TypeError);
  assert.deepEqual(events, []);
});
