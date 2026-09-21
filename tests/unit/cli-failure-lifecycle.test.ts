import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { ErrorProtocol } from '../../src/application/error-protocol.ts';
import { reportCliFailure } from '../../src/entry/cli/cli-failure.ts';
import { runRepairWithFailureReadback } from '../../src/application/repair-execution.ts';
import { reportRepairFailureReadback } from '../../src/entry/cli/repair-failure-readback.ts';
import { formatCompilerFailure } from '../../src/compiler/errors.ts';

function protocol(details?: unknown): ErrorProtocol {
  return { code: 'REPAIR-BLOCKED-001', message: 'repair failed', recoverable: true, issueType: 'composition',
    suggestedActions: ['inspect-repair-plan'], artifactPaths: ['plan.json'], details };
}
function render(value: ErrorProtocol): string[] {
  const lines: string[] = [];
  reportCliFailure(null, () => value, { write: (line) => lines.push(line), error: (line) => `error:${line}`, dim: (line) => `dim:${line}` });
  return lines;
}

test('normal failure rendering keeps header, JSON projection and separate details', () => {
  const lines = render(protocol({ reason: 'preflight' }));
  assert.equal(lines[0], 'error:REPAIR-BLOCKED-001 repair failed');
  assert.deepEqual(JSON.parse(lines[1]!.slice(4)), { code: 'REPAIR-BLOCKED-001', message: 'repair failed', recoverable: true,
    issueType: 'composition', suggestedActions: ['inspect-repair-plan'], artifactPaths: ['plan.json'] });
  assert.deepEqual(JSON.parse(lines[2]!.slice(4)), { reason: 'preflight' });
});

test('falsy details preserve the existing no-extra-line presentation', () => {
  for (const details of [undefined, null, false, 0, '']) assert.equal(render(protocol(details)).length, 2);
});

test('circular and bigint details cannot replace primary diagnostics with a JSON error', () => {
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  for (const details of [cycle, { value: 1n }, 1n]) {
    const lines = render(protocol(details));
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'error:REPAIR-BLOCKED-001 repair failed');
    assert.match(lines[2]!, /Details could not be rendered as JSON/);
  }
});

test('failing serialization and inspection hooks never escape failure reporting', () => {
  let hooks = 0;
  const details = { toJSON() { throw new Error('JSON failed'); },
    [Symbol.for('nodejs.util.inspect.custom')]() { hooks++; throw new Error('inspect failed'); } };
  assert.match(render(protocol(details))[2]!, /Details could not be rendered as JSON/);
  assert.equal(hooks, 0);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.doesNotThrow(() => render(protocol(revoked.proxy)));
});

test('details are captured once even when their first serialization fails', () => {
  let reads = 0;
  const value = Object.defineProperty(protocol(), 'details', { get() {
    reads++; if (reads > 1) throw new Error('read twice'); return { toJSON() { throw new Error('cannot serialize'); } };
  } });
  render(value); assert.equal(reads, 1);
});

test('a broken decoration function falls back to plain diagnostic text', () => {
  const lines: string[] = [];
  reportCliFailure(null, () => protocol(), { write: (line) => lines.push(line),
    error() { throw new Error('style'); }, dim() { throw new Error('style'); } });
  assert.equal(lines[0], 'REPAIR-BLOCKED-001 repair failed');
  assert.equal(JSON.parse(lines[1]!).code, 'REPAIR-BLOCKED-001');
});

test('a broken sink is not retried indefinitely and cannot throw out of reporting', () => {
  let writes = 0;
  assert.doesNotThrow(() => reportCliFailure(null, () => protocol({ data: 1 }), {
    write() { writes++; throw new Error('closed sink'); }, error: (line) => line, dim: (line) => line
  }));
  assert.equal(writes, 3);
});

test('failure of protocol construction reports the original value instead of its own error', () => {
  const lines: string[] = [];
  reportCliFailure(new Error('original'), () => { throw new Error('builder'); }, {
    write: (line) => lines.push(line), error: (line) => line, dim: (line) => line
  });
  assert.equal(lines.length, 1); assert.match(lines[0]!, /original/); assert.doesNotMatch(lines[0]!, /Error: builder/);
});

test('successful repair runs once without invoking failure readback', async () => {
  let calls = 0; const result = {};
  assert.equal(await runRepairWithFailureReadback(
    async () => { calls++; return result; },
    async () => assert.fail('readback'),
    () => assert.fail('secondary reporter')
  ), result);
  assert.equal(calls, 1);
});

for (const primary of [null, undefined, 'primary', new Error('primary'), Object.freeze({ code: 'original' })]) {
  test(`repair retains ${typeof primary} failure identity after diagnostic readback`, async () => {
    const events: string[] = [];
    let thrown = false;
    try {
      await runRepairWithFailureReadback(
        async () => { events.push('execute'); throw primary; },
        async () => { events.push('readback'); },
        () => undefined
      );
    } catch (error) { thrown = true; assert.equal(error, primary); }
    assert.ok(thrown); assert.deepEqual(events, ['execute', 'readback']);
  });
}

test('secondary readback failure is reported without masking the original repair failure', async () => {
  const primary = {}, secondary = new Error('readback'); const lines: unknown[][] = [];
  const previous = console.error; console.error = (...args) => { lines.push(args); };
  try {
    await assert.rejects(runRepairWithFailureReadback(
      async () => { throw primary; },
      async () => { throw secondary; },
      failure => reportRepairFailureReadback(formatCompilerFailure(failure))
    ), (e) => e === primary);
    assert.equal(lines.length, 1); assert.match(String(lines[0]![0]), /readback/);
  } finally { console.error = previous; }
});

test('even a secondary failure and a broken diagnostic sink cannot change the original error', async () => {
  const primary = Object.freeze({ status: 'failed' });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const previous = console.error; console.error = () => { throw new Error('sink'); };
  try {
    await assert.rejects(runRepairWithFailureReadback(
      async () => { throw primary; },
      async () => { throw revoked.proxy; },
      failure => reportRepairFailureReadback(formatCompilerFailure(failure))
    ), (e) => e === primary);
  } finally { console.error = previous; }
});

test('a presentation failure after successful repair does not start failure readback', async () => {
  const failure = new Error('format'); let reads = 0;
  await assert.rejects((async () => {
    await runRepairWithFailureReadback(
      async () => 7,
      async () => { reads++; },
      () => undefined
    );
    throw failure;
  })(), (e) => e === failure);
  assert.equal(reads, 0);
});


test('unrepresentable truthy details fall back to inspection instead of emitting undefined', () => {
  for (const details of [Symbol('detail'), () => undefined]) {
    const lines = render(protocol(details));
    assert.equal(lines.length, 3);
    assert.match(lines[2]!, /Details could not be rendered as JSON/);
  }
});
