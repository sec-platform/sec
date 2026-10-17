import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { executeFastCheckStages, type FastCheckStages } from '../../src/adapters/self-hosting/development/runner/fast-check-stages.ts';

function fixture(overrides: Partial<FastCheckStages> = {}) {
  const events: string[] = [];
  const stage = (name: keyof FastCheckStages) => () => {
    events.push(name);
    return overrides[name] === undefined ? Promise.resolve(0) : overrides[name]!();
  };
  const stages: FastCheckStages = {
    imports: stage('imports'),
    documentation: stage('documentation'),
    types: stage('types'),
    tests: stage('tests')
  };
  return { events, stages };
}

test('every execution stage rejects values that are not non-negative safe-integer statuses', async () => {
  const names = ['imports', 'documentation', 'types', 'tests'] as const;
  const invalid = [undefined, null, false, true, '0', NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
  for (const name of names) {
    for (const value of invalid) {
      const { events, stages } = fixture({ [name]: async () => value } as unknown as Partial<FastCheckStages>);
      await assert.rejects(executeFastCheckStages(stages), TypeError);
      assert.equal(events.filter(event => event === name).length, 1);
      assert.equal(events.includes('tests'), name === 'tests');
    }
  }
});

test('platform exit statuses above 255 are preserved rather than masked to a successful zero', async () => {
  const { stages, events } = fixture({ imports: async () => 256 });
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
  for (const second of [undefined, new Error('types')]) {
    const { stages, events } = fixture({
      documentation: async () => { throw undefined; },
      types: async () => { throw second; }
    });
    await assert.rejects(executeFastCheckStages(stages), error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [undefined, second]);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(events.includes('tests'), false);
  }
});

test('a synchronous exception does not prevent the other selected parallel check from starting', async () => {
  const reason = new Error('synchronous');
  const { stages, events } = fixture({ documentation: () => { throw reason; } });
  await assert.rejects(executeFastCheckStages(stages), error => error === reason);
  assert.equal(events.includes('types'), true);
  assert.equal(events.includes('tests'), false);
});

test('mixed failures wait for the still-running peer before leaving the operation', async () => {
  for (const [peerExitCode, message] of [[0, 'docs'], [29, 'first']] as const) {
    let release!: () => void;
    let enter!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { enter = resolve; });
    const reason = new Error(message);
    const { stages, events } = fixture({
      documentation: async () => { throw reason; },
      types: async () => { enter(); await held; return peerExitCode; }
    });
    let settled = false;
    const pending = executeFastCheckStages(stages).finally(() => { settled = true; });
    const checked = assert.rejects(pending, error => {
      if (peerExitCode === 0) {
        assert.equal(error, reason);
      } else {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], reason);
        assert.equal(error.errors[1].exitCode, peerExitCode);
      }
      return true;
    });
    try {
      await started;
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(settled, false, `peer exit code: ${peerExitCode}`);
    } finally { release(); }
    await checked;
    assert.equal(events.includes('tests'), false, `peer exit code: ${peerExitCode}`);
  }
});

test('ordinary completed failures retain documentation priority and successful runs reach tests once', async () => {
  const failed = fixture({ documentation: async () => 4, types: async () => 5 });
  assert.equal(await executeFastCheckStages(failed.stages), 4);
  assert.equal(failed.events.includes('tests'), false);
  const successful = fixture();
  assert.equal(await executeFastCheckStages(successful.stages), 0);
  assert.deepEqual(successful.events, ['imports', 'documentation', 'types', 'tests']);
});

test('the final test stage must also return a valid outcome and preserve its real failure code', async () => {
  const { stages } = fixture({ tests: async () => 3010 });
  assert.equal(await executeFastCheckStages(stages), 3010);
});
