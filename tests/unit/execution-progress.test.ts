import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { enableExecutionProgress, reportExecutionProgress } from '../../src/execution/execution-progress.ts';

test('one command phase prints wall-clock chronology and its own monotonic duration', async () => {
  const originalWrite = process.stderr.write;
  const records: Record<string, unknown>[] = [];
  process.stderr.write = ((chunk: string) => {
    assert.match(chunk, /^\[sec-progress\] /u);
    records.push(JSON.parse(chunk.slice('[sec-progress] '.length)) as Record<string, unknown>);
    return true;
  }) as typeof process.stderr.write;
  try {
    enableExecutionProgress();
    reportExecutionProgress({ command: 'progress-test', phase: 'work', state: 'start' });
    await Bun.sleep(2);
    reportExecutionProgress({ command: 'progress-test', phase: 'work', state: 'complete' });
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(records.length, 2);
  assert.equal(records[0]?.state, 'start');
  assert.equal(records[1]?.state, 'complete');
  assert.equal(records[0]?.startedAt, records[1]?.startedAt);
  assert.ok(Date.parse(String(records[0]?.observedAt)) <= Date.parse(String(records[1]?.observedAt)));
  assert.ok(Number(records[1]?.elapsedMs) >= Number(records[0]?.elapsedMs));
  assert.ok(Number(records[1]?.phaseDurationMs) > 0);
});
