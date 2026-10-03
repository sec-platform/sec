import { expect, test } from 'bun:test';

import { repairWorkspaceResult, type RepairWorkspaceOperations } from '../../src/application/repair-workspace.ts';
import type { RepairPlan } from '../../src/semantics/repair/types.ts';
import { buildPassingReviewReport, buildReviewLock } from '../helpers/review-fixtures.ts';

function fixture() {
  const repairPlan: RepairPlan = {
    formatVersion: '1', status: 'skipped', sourceVerificationStatus: 'passed',
    requiresVerification: false, tasks: []
  };
  return { lock: buildReviewLock(), report: buildPassingReviewReport(), repairPlan };
}

test('workspace Repair publishes through the captured provider and original private receiver', async () => {
  const input = fixture();
  class Ports implements RepairWorkspaceOperations {
    #events: string[] = [];
    readLock() {
      this.#events.push('read-lock');
      this.publish = () => { throw new Error('replacement must not run'); };
      return input.lock;
    }
    readVerification() { this.#events.push('read-verification'); return input.report; }
    buildPlan(report: typeof input.report) {
      this.#events.push('build-plan'); expect(report).toBe(input.report); return input.repairPlan;
    }
    publish(plan: RepairPlan, lock: typeof input.lock) {
      this.#events.push('publish');
      expect(plan).toBe(input.repairPlan); expect(lock).toBe(input.lock);
      expect(lock.passStatus.repair).toBe('skipped');
    }
    recordFailure() { this.#events.push('unexpected-failure'); }
    get events() { return [...this.#events]; }
  }
  const ports = new Ports();
  const result = await repairWorkspaceResult({ mode: 'publish' }, ports);
  expect(result.lock).toBe(input.lock); expect(result.repairPlan).toBe(input.repairPlan);
  expect(ports.events).toEqual(['read-lock', 'read-verification', 'build-plan', 'publish']);
});

for (const settlementFails of [false, true]) {
  test(`workspace Repair preserves captured private failure settlement, secondary failure=${settlementFails}`, async () => {
    const input = fixture();
    const primary = new Error('original publication failure');
    const secondary = new Error('original settlement failure');
    let release!: () => void;
    const pause = new Promise<void>(resolve => { release = resolve; });
    class Ports implements RepairWorkspaceOperations {
      #events: string[] = [];
      readLock() { return input.lock; }
      readVerification() { return input.report; }
      buildPlan() { return input.repairPlan; }
      async publish() { this.#events.push('publish'); await pause; throw primary; }
      recordFailure(lock: typeof input.lock) {
        this.#events.push('record-failure');
        expect(lock).toBe(input.lock); expect(lock.passStatus.repair).toBe('failed');
        if (settlementFails) throw secondary;
      }
      get events() { return [...this.#events]; }
    }
    const ports = new Ports();
    const pending = repairWorkspaceResult({ mode: 'publish' }, ports);
    const beforeSettlement = ports.events;
    ports.recordFailure = () => { throw new Error('replacement must not run'); };
    release();
    let failure: unknown;
    try { await pending; } catch (error) { failure = error; }
    expect(beforeSettlement).toEqual(['publish']);
    if (settlementFails) {
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([primary, secondary]);
      expect((failure as AggregateError).cause).toBe(primary);
    } else expect(failure).toBe(primary);
    expect(ports.events).toEqual(['publish', 'record-failure']);
  });
}
