import { expect, test } from 'bun:test';

import type { ExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import {
  HEAD, RECOVERY, ROOT, withExactRefFixture, type Event, type Fault
} from '../helpers/exact-ref-retirement-fixture.ts';

const transport: ExactRefRetirement = {
  classification: 'transport-only', branches: ['transport/obsolete'], expectedHeadSha: HEAD
};
const closed: ExactRefRetirement = {
  classification: 'closed-pr-superseded', branches: ['fix/closed'], expectedHeadSha: HEAD, pullRequestNumber: 631
};
const identical: ExactRefRetirement = {
  classification: 'main-tree-identical', branches: ['fix/identical'], expectedHeadSha: HEAD
};
const reviewed: ExactRefRetirement = {
  classification: 'reviewed-superseded', branches: ['fix/reviewed'], expectedHeadSha: HEAD,
  reviewIssueNumber: 313, reviewCommentId: 9001
};

// This oracle is a literal contract, not output of the retirement implementation
// or fixture. It requires all class-specific observations at both sides of CAS.
const observation: Record<'transport' | 'closed' | 'identical' | 'reviewed', Event['operation'][]> = {
  transport: [
    { kind: 'git-ref', branch: 'main' }, { kind: 'open-pulls-page', page: 1 },
    { kind: 'git-ref', branch: 'transport/obsolete' }
  ],
  closed: [
    { kind: 'git-ref', branch: 'main' }, { kind: 'open-pulls-page', page: 1 },
    { kind: 'pull', pullRequestNumber: 631 }, { kind: 'git-ref', branch: 'fix/closed' }
  ],
  identical: [
    { kind: 'git-ref', branch: 'main' }, { kind: 'open-pulls-page', page: 1 },
    { kind: 'git-commit', sha: 'b'.repeat(40) }, { kind: 'git-commit', sha: 'a'.repeat(40) },
    { kind: 'git-ref', branch: 'fix/identical' }
  ],
  reviewed: [
    { kind: 'git-ref', branch: 'main' }, { kind: 'open-pulls-page', page: 1 },
    { kind: 'review-evidence', repositoryRoot: ROOT, issueNumber: 313, commentId: 9001,
      branch: 'fix/reviewed', expectedHeadSha: 'b'.repeat(40), expectedMainSha: 'a'.repeat(40) },
    { kind: 'git-ref', branch: 'fix/reviewed' }
  ]
};
function casEvents(events: readonly Event[]) {
  return events.filter(({ operation }) => operation.kind === 'delete-ref-cas');
}
async function successfulRetirement(request: ExactRefRetirement, expected: readonly Event['operation'][], branch: string) {
  await withExactRefFixture(request, undefined, async (state, prepare, retire) => {
    expect(await prepare()).toEqual({
      schema: 'sec-exact-ref-retirement-recovery-preparation-v1', repository: 'sec-platform/sec',
      expectedMainSha: 'a'.repeat(40), retirement: request, refState: 'present',
      recovery: { bundleName: 'exact-ref-retirement-recovery-fixture.bundle', sha256: `sha256:${'e'.repeat(64)}`,
        verifyOutput: 'verified independent recovery fixture' }
    });
    expect(state.recoveryCalls).toHaveLength(1);
    expect(state.recoveryCalls[0]).toMatchObject({ branch, expectedSha: 'b'.repeat(40),
      refSource: request.classification === 'closed-pr-superseded' ? { kind: 'pull', number: 631 } : { kind: 'remote-branch' } });
    expect(await retire()).toEqual({ retired: [branch], alreadyAbsent: [],
      recoveries: [{ branch, sha256: `sha256:${'e'.repeat(64)}` }] });
    expect(state.recoveryVerifications).toHaveLength(1);
    expect(state.recoveryVerifications[0]).toMatchObject({ recovery: RECOVERY, expectedHeadSha: 'b'.repeat(40) });
    expect(state.sessions[0]!.kind).toBe('read');
    const effect = state.events.filter(({ phase }) => phase === 'before' || phase === 'after');
    expect(effect.map(({ operation }) => operation)).toEqual([
      ...expected, { kind: 'delete-ref-cas', branch, expectedOldSha: 'b'.repeat(40) }, ...expected
    ]);
    const [cas] = casEvents(effect);
    expect(cas).toBeDefined();
    for (const event of effect) expect(event.capability).toBe(cas!.capability);
    expect(cas!.capability).not.toBe(state.sessions[0]!.capability);
    const localReadback = state.localObservations.filter(({ afterCas }) => afterCas);
    expect(localReadback.some(({ kind }) => kind === 'active')).toBe(true);
    const activeIndex = localReadback.findIndex(({ kind }) => kind === 'active');
    expect(localReadback.findIndex(({ kind }) => kind === 'inventory')).toBeGreaterThan(activeIndex);
  });
}

test('transport retirement observes exact live state around one CAS with the same effect capability', async () => {
  await successfulRetirement(transport, observation.transport, 'transport/obsolete');
});
test('closed-PR retirement rechecks exact PR identity around CAS with the same effect capability', async () => {
  await successfulRetirement(closed, observation.closed, 'fix/closed');
});
test('tree-identical retirement rechecks both commit trees around CAS with the same effect capability', async () => {
  await successfulRetirement(identical, observation.identical, 'fix/identical');
});
test('reviewed retirement rechecks exact supersession evidence around CAS with the same effect capability', async () => {
  await successfulRetirement(reviewed, observation.reviewed, 'fix/reviewed');
});

async function rejectedBeforeCas(request: ExactRefRetirement, fault: Fault, message: string) {
  await withExactRefFixture(request, fault, async (state, prepare, retire) => {
    await prepare();
    await expect(retire()).rejects.toThrow(message);
    expect(casEvents(state.events)).toEqual([]);
    expect(state.recoveryVerifications).toHaveLength(1);
  });
}
test('head drift after recovery publication causes zero CAS effects', async () => {
  await rejectedBeforeCas(transport, 'head-drift', 'does not bind expected head');
});
test('live-main drift immediately before CAS causes zero effects', async () => {
  await rejectedBeforeCas(transport, 'main-drift', 'live default branch drifted');
});
test('new open base-branch consumer immediately before CAS causes zero effects', async () => {
  await rejectedBeforeCas(transport, 'open-consumer', 'still referenced by open PR #99');
});
test('closed-PR identity drift immediately before CAS causes zero effects', async () => {
  await rejectedBeforeCas(closed, 'closed-pull-changed', 'does not bind fix/closed');
});
test('unequal commit trees immediately before CAS cause zero effects', async () => {
  await rejectedBeforeCas(identical, 'tree-changed', 'differs from live main tree');
});
test('rejected review evidence immediately before CAS causes zero effects', async () => {
  await rejectedBeforeCas(reviewed, 'review-rejected', 'independent review evidence rejected');
});

test('remaining remote ref after CAS withholds retirement and identifies recovery', async () => {
  await withExactRefFixture(transport, 'ref-remains', async (state, prepare, retire) => {
    await prepare();
    await expect(retire()).rejects.toThrow('effect is unsettled; recover from the uploaded bundle: branch transport/obsolete remains');
    expect(casEvents(state.events)).toHaveLength(1);
  });
});
test('failed authoritative remote readback after CAS withholds retirement and identifies recovery', async () => {
  await withExactRefFixture(transport, 'readback-failed', async (state, prepare, retire) => {
    await prepare();
    await expect(retire()).rejects.toThrow('effect is unsettled; recover from the uploaded bundle: fixture HTTP 503');
    expect(casEvents(state.events)).toHaveLength(1);
  });
});
test('final local inventory still constrains retirement after successful remote absence', async () => {
  const readbackFailures: readonly [Fault, string][] = [
    ['inventory-main-changed', 'default branch changed'],
    ['inventory-consumer', 'active Work Package branch'],
    ['inventory-unknown', 'readback is unresolved'],
    ['inventory-ref-remains', 'remains after exact ref retirement readback']
  ];
  for (const [fault, message] of readbackFailures) {
    await withExactRefFixture(transport, fault, async (state, prepare, retire) => {
      await prepare();
      await expect(retire()).rejects.toThrow(message);
      expect(casEvents(state.events)).toHaveLength(1);
      expect(state.localObservations.some(({ kind, afterCas }) => kind === 'inventory' && afterCas)).toBe(true);
    });
  }
});
test('absent reviewed-superseded ref cannot mint recovery preparation', async () => {
  await withExactRefFixture(reviewed, 'preparation-absent', async (state, prepare) => {
    await expect(prepare()).rejects.toThrow('requires the exact remote ref to remain present at recovery preparation');
    expect(state.recoveryCalls).toEqual([]);
    expect(casEvents(state.events)).toEqual([]);
    expect(state.sessions.map(({ kind }) => kind)).toEqual(['read']);
    expect(state.events.map(({ operation }) => operation)).toEqual(observation.reviewed);
  });
});

test('unverified recovery bundle cannot mint preparation', async () => {
  await withExactRefFixture(transport, 'preparation-unverified', async (state, prepare) => {
    await expect(prepare()).rejects.toThrow('did not produce one verified git bundle');
    expect(casEvents(state.events)).toEqual([]);
  });
});
test('failed published recovery readback prevents every CAS effect', async () => {
  await withExactRefFixture(transport, 'recovery-readback-rejected', async (state, prepare, retire) => {
    await prepare();
    await expect(retire()).rejects.toThrow('published recovery readback is invalid: published bundle no longer verifies');
    expect(casEvents(state.events)).toEqual([]);
  });
});
