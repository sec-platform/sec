import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { executeFastCheckStages, type FastCheckStages } from '../../src/adapters/self-hosting/development/runner/fast-check-stages.ts';

function stages(events: string[], overrides: Partial<FastCheckStages> = {}): FastCheckStages {
  const run = (name: string) => async () => { events.push(name); return 0; };
  return { imports: run('imports'), documentation: run('docs'),
    types: run('types'), tests: run('tests'), ...overrides };
}


test('imports rejection or failure code prevents every later stage', async () => {
  for (const reject of [false, true]) {
    const events: string[] = [], reason = new Error('imports');
    const input = stages(events, { imports: async () => { if (reject) throw reason; return 7; } });
    if (reject) await assert.rejects(executeFastCheckStages(input), error => error === reason);
    else assert.equal(await executeFastCheckStages(input), 7);
    assert.deepEqual(events, []);
  }
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
