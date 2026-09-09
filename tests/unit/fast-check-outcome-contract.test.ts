import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { executeFastCheckStages, type FastCheckStages } from '../../src/development/runner/fast-check-stages.ts';

function fixture(overrides: Partial<FastCheckStages> = {}) {
  const events: string[] = [];
  const stages: FastCheckStages = {
    imports: async () => { events.push('imports'); return 0; },
    sourceAudit: async () => { events.push('audit'); return 0; },
    documentation: async () => { events.push('documentation'); return 0; },
    types: async () => { events.push('types'); return 0; },
    tests: async () => { events.push('tests'); return 0; },
    ...overrides
  };
  return { events, stages };
}

test('every execution stage rejects values that are not non-negative safe-integer statuses', async () => {
  const names = ['imports', 'sourceAudit', 'documentation', 'types', 'tests'] as const;
  const invalid = [undefined, null, false, true, '0', NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
  for (const name of names) {
    for (const value of invalid) {
      const { events, stages } = fixture({ [name]: async () => value } as unknown as Partial<FastCheckStages>);
      await assert.rejects(executeFastCheckStages(stages), TypeError);
      assert.equal(events.includes('tests'), false);
    }
  }
});

test('platform exit statuses above 255 are preserved rather than masked to a successful zero', async () => {
  const { stages, events } = fixture({ sourceAudit: async () => 256 });
  assert.equal(await executeFastCheckStages(stages), 256);
  assert.deepEqual(events, ['imports']);
});

test('a rejected documentation check does not hide a nonzero type-check exit', async () => {
  const reason = new Error('documentation failed');
  const { stages, events } = fixture({ documentation: async () => { throw reason; }, types: async () => 23 });
  await assert.rejects(executeFastCheckStages(stages), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0], reason);
    assert.equal(error.errors[1].stage, 'types');
    assert.equal(error.errors[1].exitCode, 23);
    assert.equal(error.cause, reason);
    return true;
  });
  assert.equal(events.includes('tests'), false);
});

test('a nonzero documentation exit remains visible when type checking rejects', async () => {
  const reason = Object.freeze({ failure: 'type-check' });
  const { stages } = fixture({ documentation: async () => 17, types: async () => { throw reason; } });
  await assert.rejects(executeFastCheckStages(stages), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0].stage, 'documentation');
    assert.equal(error.errors[0].exitCode, 17);
    assert.equal(error.errors[1], reason);
    return true;
  });
});

test('one rejection with a successful peer retains the exact original thrown value', async () => {
  for (const reason of [undefined, null, false, 0, new Error('original')]) {
    const { stages } = fixture({ documentation: async () => { throw reason; } });
    let failed = false;
    try { await executeFastCheckStages(stages); }
    catch (error) { failed = true; assert.equal(error, reason); }
    assert.equal(failed, true);
  }
});

test('two rejecting checks preserve both values even when both values are undefined', async () => {
  const { stages } = fixture({ documentation: async () => { throw undefined; }, types: async () => { throw undefined; } });
  await assert.rejects(executeFastCheckStages(stages), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [undefined, undefined]);
    return true;
  });
});

test('a synchronous exception does not prevent the other selected parallel check from starting', async () => {
  const reason = new Error('synchronous');
  const { stages, events } = fixture({ documentation: () => { throw reason; } });
  await assert.rejects(executeFastCheckStages(stages), error => error === reason);
  assert.equal(events.includes('types'), true);
  assert.equal(events.includes('tests'), false);
});

test('mixed failures wait for the still-running peer before leaving the operation', async () => {
  let release!: () => void;
  let enter!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { enter = resolve; });
  const reason = new Error('first');
  const { stages } = fixture({
    documentation: async () => { throw reason; },
    types: async () => { enter(); await held; return 29; }
  });
  let settled = false;
  const pending = executeFastCheckStages(stages).finally(() => { settled = true; });
  const checked = assert.rejects(pending, error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], reason);
    assert.equal(error.errors[1].exitCode, 29);
    return true;
  });
  try {
    await started;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(settled, false);
  } finally { release(); }
  await checked;
});

test('ordinary completed failures retain documentation priority and successful runs reach tests once', async () => {
  const failed = fixture({ documentation: async () => 4, types: async () => 5 });
  assert.equal(await executeFastCheckStages(failed.stages), 4);
  assert.equal(failed.events.includes('tests'), false);
  const successful = fixture();
  assert.equal(await executeFastCheckStages(successful.stages), 0);
  assert.deepEqual(successful.events, ['imports', 'audit', 'documentation', 'types', 'tests']);
});

test('the final test stage must also return a valid outcome and preserve its real failure code', async () => {
  const { stages } = fixture({ tests: async () => 3010 });
  assert.equal(await executeFastCheckStages(stages), 3010);
  const malformed = fixture({ tests: async () => '0' } as unknown as Partial<FastCheckStages>);
  await assert.rejects(executeFastCheckStages(malformed.stages), TypeError);
});
