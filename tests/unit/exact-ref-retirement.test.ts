import { expect, test } from 'bun:test';
import type { ExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import { fixtureReceipt, HEAD, MAIN, RECOVERY, TREE, withExactRefFixture, type Event, type Fault, type FixtureReceipt } from '../helpers/exact-ref-retirement-fixture.ts';

const transport: ExactRefRetirement = { classification: 'transport-only', branches: ['transport/obsolete'], expectedHeadSha: HEAD };
const sibling: ExactRefRetirement = { classification: 'transport-only', branches: ['transport/sibling'], expectedHeadSha: HEAD };
const closed: ExactRefRetirement = { classification: 'closed-pr-superseded', branches: ['fix/closed'], expectedHeadSha: HEAD, pullRequestNumber: 631 };
const identical: ExactRefRetirement = { classification: 'main-tree-identical', branches: ['fix/identical'], expectedHeadSha: HEAD };
const reviewed: ExactRefRetirement = { classification: 'reviewed-plan-superseded', branches: ['fix/reviewed'], expectedHeadSha: HEAD,
  review: { kind: 'branch-supersession-review', version: 4, repository: 'sec-platform/sec', branch: 'fix/reviewed',
    headSha: HEAD, headTreeSha: TREE, currentMainSha: MAIN, currentMainTreeSha: TREE,
    mergeBaseSha: 'e'.repeat(40), mergeBaseTreeSha: TREE, reviewer: 'independent source review', verdict: 'approved',
    sourcePathSet: { count: 1, digest: `sha256:${'1'.repeat(64)}` }, assessment: 'Complete source delta is superseded.', unknowns: [] } };
function cas(events: readonly Event[]) { return events.filter(({ operation }) => operation.kind === 'delete-ref-cas'); }

for (const request of [transport, closed, identical, reviewed]) {
  test.serial(`${request.classification}: shared recovery then exact mutable boundaries around one CAS`, async () => {
    await withExactRefFixture(request, undefined, async (state, prepare, retire) => {
      const prepared = await prepare();
      expect(prepared.schema).toBe('sec-exact-ref-batch-recovery-preparation-v2');
      expect(prepared.refs).toEqual([{ branch: request.branches[0], expectedHeadSha: HEAD, refState: 'present', absenceObserved: false, blocker: null }]);
      expect(state.recoveryCalls).toHaveLength(1);
      expect(state.recoveryCalls[0]).toMatchObject({ refs: [{ branch: request.branches[0], expectedHeadSha: HEAD }] });
      const result = await retire();
      expect(result.completed).toBe(1); expect(result.targetConverged).toBe(1);
      expect(result.results[0]).toMatchObject({ branch: request.branches[0], expectedHeadSha: HEAD,
        status: 'retired', targetState: 'absent', effectOutcome: 'acknowledged' });
      expect(state.recoveryCalls).toHaveLength(1);
      expect(state.recoveryVerifications).toHaveLength(1);
      expect(state.recoveryVerifications[0]).toMatchObject({ recovery: RECOVERY, expectedHeads: [HEAD, MAIN], requireComplete: true });
      const effects = state.events.filter(({ phase }) => phase !== 'static');
      const calls = cas(effects); expect(calls).toHaveLength(1);
      for (const event of effects) expect(event.capability).toBe(calls[0]!.capability);
      expect(calls[0]!.capability).not.toBe(state.sessions[0]!.capability);
      expect(effects.map(({ operation }) => operation.kind)).toEqual([
        'git-ref', 'maintenance-artifact', 'open-pulls-page', ...(request.classification === 'closed-pr-superseded' ? ['pull' as const] : []), 'git-ref', 'authority-revalidation',
        'delete-ref-cas', 'git-ref', 'maintenance-artifact', 'open-pulls-page', ...(request.classification === 'closed-pr-superseded' ? ['pull' as const] : []), 'git-ref', 'authority-revalidation'
      ]);
      expect(state.progress.map((row) => row.phase)).toEqual(['effect-started', 'effect-returned', 'absence-observed']);
      expect<ReadonlyArray<(typeof state.results)[number]>>(state.results).toEqual(result.results);
      expect(state.localObservations.filter((row) => row.kind === 'inventory')).toHaveLength(2); // Once per physical prepare/execute phase.
      expect(state.localObservations.some((row) => row.kind === 'active' && row.afterCas)).toBe(true);
      if (request.classification === 'reviewed-plan-superseded') {
        expect(state.events.filter((row) => row.operation.kind === 'review-evidence')).toHaveLength(2);
        expect(effects.some((row) => row.operation.kind === 'review-evidence')).toBe(false);
      }
    });
  });
}

for (const [request, fault, fragment] of [
  [transport, 'head-drift', 'old OID'], [transport, 'open-consumer', 'open PR #99'],
  [closed, 'closed-pull-changed', 'does not bind'], [identical, 'tree-changed', 'differs from live main tree'],
  [reviewed, 'review-rejected', 'independent review evidence'], [transport, 'active-consumer', 'active Work Package branch']
] as const) {
  test.serial(`${fault}: target-specific blocker produces no CAS`, async () => {
    await withExactRefFixture(request, fault, async (state, prepare, retire) => {
      await prepare(); const result = await retire();
      expect(result.completed).toBe(0); expect(cas(state.events)).toHaveLength(0);
      expect(result.results[0]!.status).toBe('blocked'); expect(result.results[0]!.detail).toContain(fragment);
    });
  });
}

test.serial('one moved ref blocks only its item while the independent sibling settles with the same single bundle', async () => {
  await withExactRefFixture([transport, sibling], 'head-drift', async (state, prepare, retire) => {
    await prepare(); const result = await retire();
    expect(result.results.map((row) => row.status)).toEqual(['blocked', 'retired']);
    expect(result.completed).toBe(1); expect(state.recoveryCalls).toHaveLength(1);
    expect(cas(state.events).map((row) => row.operation)).toEqual([{ kind: 'delete-ref-cas', branch: 'transport/sibling', expectedOldSha: HEAD }]);
  });
});
for (const fault of ['main-drift', 'active-unknown', 'carrier-lost', 'permission-lost'] as const) {
  test.serial(`${fault}: shared invalidation blocks every dependent item`, async () => {
    await withExactRefFixture([transport, sibling], fault, async (state, prepare, retire) => {
      await prepare(); const result = await retire();
      expect(result.results.map((row) => row.status)).toEqual(['blocked', 'blocked']);
      expect(result.completed).toBe(0); expect(cas(state.events)).toHaveLength(0);
      expect(state.writes).toBe(1);
    });
  });
}
for (const fault of ['ref-remains', 'readback-failed', 'cas-conflict'] as const) {
  test.serial(`${fault}: effect uncertainty is preserved and never silently reported retired`, async () => {
    await withExactRefFixture(transport, fault, async (state, prepare, retire) => {
      await prepare(); const result = await retire();
      expect(result.completed).toBe(0); expect(result.results[0]!.status).toBe('unsettled');
      expect(cas(state.events)).toHaveLength(1);
      expect(result.results[0]!.effectOutcome).toBe(fault === 'cas-conflict' ? 'unknown' : 'acknowledged');
      expect(result.results[0]!.targetState).toBe(fault === 'ref-remains' ? 'present' : 'unknown');
    });
  });
}

test.serial('verified absence is target convergence without claiming an unobserved own CAS', async () => {
  await withExactRefFixture(reviewed, 'preparation-absent', async (state, prepare, retire) => {
    expect((await prepare()).refs[0]!.refState).toBe('absent');
    const result = await retire(); expect(cas(state.events)).toHaveLength(0);
    expect(result.completed).toBe(0); expect(result.targetConverged).toBe(1);
    expect(result.results[0]).toMatchObject({ status: 'absent-unattributed', targetState: 'absent', effectOutcome: 'not-attempted' });
  });
});
for (const fault of ['preparation-unverified', 'recovery-readback-rejected'] satisfies readonly Fault[]) {
  test.serial(`${fault}: invalid recovery blocks every CAS`, async () => {
    await withExactRefFixture(transport, fault, async (state, prepare, retire) => {
      if (fault === 'preparation-unverified') await expect(prepare()).rejects.toThrow('complete bundle');
      else { await prepare(); await expect(retire()).rejects.toThrow('published bundle no longer verifies'); }
      expect(cas(state.events)).toHaveLength(0);
    });
  });
}

for (const fault of ['permission-revoked-before', 'run-changed-before', 'permission-revoked-after', 'run-changed-after'] as const) {
  test.serial(`${fault}: live authority failure is shared and cannot be reported retired`, async () => {
    await withExactRefFixture([transport, sibling], fault, async (state, prepare, retire) => {
      await prepare(); const result = await retire();
      const after = fault.endsWith('after');
      expect(result.completed).toBe(0);
      expect(result.results.map((row) => row.status)).toEqual([after ? 'unsettled' : 'blocked', 'blocked']);
      expect(cas(state.events)).toHaveLength(after ? 1 : 0);
      expect(state.writes).toBe(1);
      expect(result.results[0]!.targetState).toBe(after ? 'absent' : 'present');
      expect(result.results[0]!.effectOutcome).toBe(after ? 'acknowledged' : 'not-attempted');
      expect(result.targetConverged).toBe(after ? 1 : 0);
    });
  });
}

test.serial('authenticated absence survives result replacement and blocks same-OID recreation on every resume', async () => {
  const original = await withExactRefFixture(transport, undefined, async (state, prepare, retire) => {
    const preparation = await prepare(); state.currentTargetState = 'absent';
    await retire(); return fixtureReceipt(state, preparation);
  });
  // A supported historical receipt carried absence in its terminal row before
  // the journal acquired the monotone absence phase. It is still authenticated input.
  let receipt: FixtureReceipt = { ...original, progress: [] };
  for (const [runId, current] of [['20', 'present'], ['21', 'present'], ['22', 'absent']] as const) {
    receipt = await withExactRefFixture(transport, undefined, async (state, _prepare, retire, resumeFrom) => {
      resumeFrom(receipt, runId); state.currentTargetState = current;
      const result = await retire(); expect(cas(state.events)).toHaveLength(0); expect(result.completed).toBe(0);
      expect(result.results[0]!.targetState).toBe(current);
      expect(result.results[0]!.status).toBe(current === 'absent' ? 'absent-unattributed' : 'blocked');
      expect(state.progress.map((row) => row.phase)).toEqual(['absence-observed', 'recreation-observed']);
      return fixtureReceipt(state, original.recoveryPreparation);
    });
  }
});

test.serial('a deleted-and-recreated object cannot later inherit the original successful CAS attribution', async () => {
  const original = await withExactRefFixture(transport, undefined, async (state, prepare, retire) => {
    const preparation = await prepare(); await retire(); return fixtureReceipt(state, preparation);
  });
  let receipt = original;
  for (const [runId, current] of [['20', 'present'], ['21', 'absent']] as const) {
    receipt = await withExactRefFixture(transport, undefined, async (state, _prepare, retire, resumeFrom) => {
      resumeFrom(receipt, runId); state.currentTargetState = current;
      const result = await retire(); expect(cas(state.events)).toHaveLength(0); expect(result.completed).toBe(0);
      expect(result.targetConverged).toBe(current === 'absent' ? 1 : 0);
      expect(result.results[0]).toMatchObject({ status: 'unsettled', targetState: current, effectOutcome: 'acknowledged' });
      expect(state.progress.map((row) => row.phase)).toEqual(['effect-started', 'effect-returned', 'absence-observed', 'recreation-observed']);
      return fixtureReceipt(state, original.recoveryPreparation);
    });
  }
});

test.serial('an old valid locator may fork readback but no resume can execute its previously unstarted item', async () => {
  const sourceA = await withExactRefFixture(transport, 'open-consumer', async (state, prepare, retire) => {
    const preparation = await prepare(); await retire(); expect(cas(state.events)).toHaveLength(0);
    return fixtureReceipt(state, preparation);
  });
  for (const _reader of ['B', 'C']) {
    await withExactRefFixture(transport, undefined, async (state, _prepare, retire, resumeFrom) => {
      // Each reader deliberately selects the identical genuine old locator A.
      resumeFrom(sourceA, '20'); state.currentTargetState = 'present';
      const result = await retire(); expect(cas(state.events)).toHaveLength(0);
      expect(result.results[0]).toMatchObject({ status: 'blocked', targetState: 'present', effectOutcome: 'not-attempted' });
      expect(result.results[0]!.detail).toContain('readback-only'); expect(state.progress).toHaveLength(0);
    });
  }
  // A separate explicit fresh plan is admitted afresh. Resume never creates it.
  await withExactRefFixture(transport, undefined, async (state, prepare, retire) => {
    await prepare(); const result = await retire(); expect(result.completed).toBe(1); expect(cas(state.events)).toHaveLength(1);
  });
});


for (const fault of ['execution-static-absent', 'prepare-inventory-absent', 'execution-inventory-absent'] as const) {
  test.serial(`${fault}: every observed absence fences a later same-OID ref before any fresh CAS`, async () => {
    await withExactRefFixture(transport, fault, async (state, prepare, retire) => {
      const preparation = await prepare();
      expect(preparation.refs[0]!.refState).toBe('present'); // The latest exact API read still sees the expected OID.
      expect(preparation.refs[0]!.absenceObserved).toBe(fault === 'prepare-inventory-absent');
      const result = await retire();
      expect(cas(state.events)).toHaveLength(0);
      expect(result.completed).toBe(0);
      expect(result.results[0]).toMatchObject({ status: 'blocked', targetState: 'present', effectOutcome: 'not-attempted' });
      expect(state.progress.map((row) => row.phase)).toEqual(['absence-observed', 'recreation-observed']);
      expect(state.progress.some((row) => row.phase === 'effect-started')).toBe(false);
    });
  });
}


test.serial('an older present row followed by newly observed absence does not invent backwards recreation', async () => {
  const original = await withExactRefFixture(transport, 'head-drift', async (state, prepare, retire) => {
    const preparation = await prepare(); const result = await retire();
    expect(result.results[0]!.targetState).toBe('present');
    return fixtureReceipt(state, preparation);
  });
  await withExactRefFixture(transport, undefined, async (state, _prepare, retire, resumeFrom) => {
    resumeFrom(original); state.currentTargetState = 'absent';
    const result = await retire(); expect(cas(state.events)).toHaveLength(0);
    expect(result.results[0]).toMatchObject({ status: 'absent-unattributed', targetState: 'absent' });
    expect(state.progress.map((row) => row.phase)).toEqual(['absence-observed']);
  });
});


for (const fault of ['execution-static-absent-shared-failure', 'execution-inventory-absent-shared-failure'] as const) {
  test.serial(`${fault}: observed absence is durable before a later shared failure and survives the next run`, async () => {
    const partial = await withExactRefFixture(transport, fault, async (state, prepare, retire) => {
      const preparation = await prepare();
      await expect(retire()).rejects.toThrow('shared static');
      expect(cas(state.events)).toHaveLength(0);
      expect(state.progress.map((row) => row.phase)).toEqual(['absence-observed']);
      return fixtureReceipt(state, preparation);
    });
    await withExactRefFixture(transport, undefined, async (state, _prepare, retire, resumeFrom) => {
      resumeFrom(partial); state.currentTargetState = 'present';
      const result = await retire(); expect(cas(state.events)).toHaveLength(0);
      expect(result.results[0]).toMatchObject({ status: 'blocked', targetState: 'present' });
      expect(state.progress.map((row) => row.phase)).toEqual(['absence-observed', 'recreation-observed']);
    });
  });
}


test.serial('readback can settle an acknowledged original deletion when every current observation remains absent', async () => {
  const original = await withExactRefFixture(transport, undefined, async (state, prepare, retire) => {
    const preparation = await prepare(); await retire(); return fixtureReceipt(state, preparation);
  });
  await withExactRefFixture(transport, undefined, async (state, _prepare, retire, resumeFrom) => {
    resumeFrom(original); state.currentTargetState = 'absent';
    const result = await retire(); expect(cas(state.events)).toHaveLength(0);
    expect(result.completed).toBe(1); expect(result.targetConverged).toBe(1);
    expect(result.results[0]).toMatchObject({ status: 'retired', targetState: 'absent', effectOutcome: 'acknowledged' });
    expect(state.progress.map((row) => row.phase)).toEqual(['effect-started', 'effect-returned', 'absence-observed']);
  });
});


test.serial('legacy v3 ACK followed by present cannot attribute a later absence to the original object', async () => {
  const historical = await withExactRefFixture(transport, 'ref-remains', async (state, prepare, retire) => {
    const preparation = await prepare();
    const result = await retire();
    expect(result.results[0]).toMatchObject({ status: 'unsettled', targetState: 'present', effectOutcome: 'acknowledged' });
    const receipt = fixtureReceipt(state, preparation);
    // The original v3 writer retained these two phases and a terminal row, before
    // the monotone absence/recreation phases and preparation v2 were introduced.
    return { ...receipt, recoveryPreparation: { ...receipt.recoveryPreparation,
      schema: 'sec-exact-ref-batch-recovery-preparation-v1',
      refs: receipt.recoveryPreparation.refs.map(({ absenceObserved: _ignored, ...row }) => row) },
      progress: receipt.progress.filter((row) => row.phase === 'effect-started' || row.phase === 'effect-returned') } as unknown as FixtureReceipt;
  });
  let receipt = historical;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    receipt = await withExactRefFixture(transport, undefined, async (state, _prepare, retire, resumeFrom) => {
      resumeFrom(receipt); state.currentTargetState = 'absent';
      const result = await retire();
      expect(cas(state.events)).toHaveLength(0);
      expect(result.completed).toBe(0); expect(result.targetConverged).toBe(1);
      expect(result.results[0]).toMatchObject({ status: 'unsettled', targetState: 'absent', effectOutcome: 'acknowledged' });
      expect(state.progress.map((row) => row.phase)).toContain('recreation-observed');
      return fixtureReceipt(state, historical.recoveryPreparation);
    });
  }
});
