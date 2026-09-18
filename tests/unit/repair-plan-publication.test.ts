import { expect, test } from 'bun:test';
import { publishRepairPlanResult, type RepairPlanPublicationOperations } from '../../src/application/repair-plan-publication.ts';
import { buildRepairPlan } from '../../src/adapters/verification/repair/build-repair-plan.ts';
import { buildPassingReviewReport, buildReviewLock } from '../helpers/review-fixtures.ts';

function fixture(status: 'passed' | 'failed' = 'passed') {
  return { lock: buildReviewLock(), repairPlan: buildRepairPlan(buildPassingReviewReport({ summary: { status } })) };
}

for (const status of ['passed', 'failed'] as const) {
  test(`${status} decision is published once without a redundant failure-state write`, async () => {
    const input = fixture(status); const events: string[] = [];
    const pending = publishRepairPlanResult(input, {
      publish: async (plan, lock) => {
        events.push('publish'); expect(plan).toBe(input.repairPlan); expect(lock).toBe(input.lock);
        expect(lock.passStatus.repair).toBe(status === 'passed' ? 'skipped' : 'failed');
        await Promise.resolve(); events.push('persisted');
      },
      recordFailure: () => { events.push('extra write'); }
    });
    if (status === 'passed') expect(await pending).toEqual(input);
    else await expect(pending).rejects.toMatchObject({ code: 'REPAIR-BLOCKED-001' });
    expect(events).toEqual(['publish', 'persisted']);
  });
}

for (const primary of [undefined, null, false, 0, Symbol('failure'), new Error('publication')]) {
  for (const secondaryFails of [false, true]) {
    test(`publication failure ${String(primary)} survives settlement failure=${secondaryFails}`, async () => {
      const input = fixture(); const secondary = Object.freeze({ reason: 'state-write' });
      let writes = 0;
      const pending = publishRepairPlanResult(input, {
        publish: () => { throw primary; },
        recordFailure: async lock => {
          writes++; expect(lock.passStatus.repair).toBe('failed');
          if (secondaryFails) throw secondary;
        }
      });
      try { await pending; throw new Error('unexpected success'); }
      catch (error) {
        if (!secondaryFails) expect(error).toBe(primary);
        else {
          expect(error).toBeInstanceOf(AggregateError);
          expect((error as AggregateError).errors).toEqual([primary, secondary]);
          expect((error as AggregateError).cause).toBe(primary);
        }
      }
      expect(writes).toBe(1);
    });
  }
}

test('publication ports preserve private state and the captured settlement callback', async () => {
  const primary = new Error('publish'); let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  class Ports implements RepairPlanPublicationOperations {
    #calls = 0;
    async publish() { this.#calls++; await pause; throw primary; }
    recordFailure() { this.#calls++; }
    get calls() { return this.#calls; }
  }
  const ports = new Ports();
  const pending = publishRepairPlanResult(fixture(), ports);
  ports.recordFailure = () => { throw new Error('replacement'); };
  release();
  await expect(pending).rejects.toBe(primary);
  expect(ports.calls).toBe(2);
});
