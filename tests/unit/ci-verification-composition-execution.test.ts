import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { buildCiVerificationActionPlanClosure, ciVerificationNormalizedOperationArgv, type CiVerificationActionCandidate, type CiVerificationProducerGate } from '../../src/verification/action/contract/ci.ts';
import { CodexDevelopmentExecuteCiActionClosure } from '../../src/verification/ci/verification.ts';

const digest = (value: string): `sha256:${string}` => (
  `sha256:${createHash('sha256').update(value).digest('hex')}`
);

function candidateFor(testIdentity: string): CiVerificationActionCandidate {
  return {
  baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40), headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40),
  manifestPath: 'docs/work-packages/composition-v2.md', manifestDigest: digest(`manifest:${testIdentity}`),
  scopeAuthorizationRevision: digest('b'), profile: 'quick',
  toolchainRevision: 'bun@1.3.14', providerRevision: 'github-actions@trusted-default',
  contractRevision: 'ci-verification-v19', requiredBlobs: [
    { path: '.bun-version', digest: digest('c') },
    { path: 'bun.lock', digest: digest('d') },
    { path: 'bunfig.toml', digest: digest('e') },
    { path: 'package.json', digest: digest('f') },
    { path: 'tests/fixture.ts', digest: digest('1') }
  ]
  };
}

const candidate = candidateFor('successful-composition');
const gates: readonly CiVerificationProducerGate[] = [
  {
    id: 'composition-scope-a', phase: 'quick',
    argv: ['bun', 'test', 'tests/a.test.ts', '--test-name-pattern', '^scope a$', '--timeout', '180000'],
    runtime: 'bun',
    environment: { 'ci-env-v1:environment': digest('d') }, coveredScopeIds: ['scope:a']
  },
  {
    id: 'composition-delta-b', phase: 'quick', argv: ['bun', 'test', 'tests/b.test.ts', '--timeout', '180000'],
    runtime: 'bun',
    environment: { 'ci-env-v1:environment': digest('e') }, coveredScopeIds: ['scope:b']
  }
];

function clock(): () => Date {
  let time = Date.parse('2026-08-09T00:00:00.000Z');
  return () => new Date(time += 10);
}

test('composition gates execute through the same Action runner and preserve producer env/scope identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-'));
  try {
    const plan = buildCiVerificationActionPlanClosure({ candidate, gates });
    const calls: Array<{ id: string; argv: readonly string[] }> = [];
    const result = await CodexDevelopmentExecuteCiActionClosure({
      repositoryRoot: root,
      actionPlan: plan,
      gates: gates.map((gate) => ({ gate, env: { SEC_CHANGED_BASE: candidate.baseSha } })),
      headSha: candidate.headSha,
      now: clock(),
      runGate: async (gate) => {
        calls.push({ id: gate.id, argv: gate.argv });
        return { code: 0, rawOutputDigest: digest('f'), failureTail: '' };
      }
    });
    expect(result.failed).toBe(false);
    expect(calls.map(({ id }) => id)).toEqual(gates.map((gate) => gate.id));
    expect(calls.map(({ argv }) => argv)).toEqual(gates.map(({ argv }) => argv));
    expect(plan.normalizedOperations.map(ciVerificationNormalizedOperationArgv))
      .toEqual(gates.map(({ argv }) => argv));
    expect(result.gates.map((gate) => gate.action.operation.declaredEnvironment.find(
      (entry) => entry.name === 'ci-env-v1:environment'
    )?.digest))
      .toEqual([digest('d'), digest('e')]);
    expect(result.gates.every((gate) => gate.result.inputDigest === gate.action.actionKey)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition failure remains failed and later Action is canonical not-run', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-fail-'));
  try {
    const failureCandidate = candidateFor('failed-composition');
    const plan = buildCiVerificationActionPlanClosure({ candidate: failureCandidate, gates });
    const result = await CodexDevelopmentExecuteCiActionClosure({
      repositoryRoot: root,
      actionPlan: plan,
      gates: gates.map((gate) => ({ gate, env: {} })),
      headSha: failureCandidate.headSha,
      now: clock(),
      runGate: async () => ({ code: 7, rawOutputDigest: digest('9'), failureTail: 'sentinel' })
    });
    expect(result.failed).toBe(true);
    expect(result.gates.map((gate) => gate.result.status)).toEqual(['failed', 'not-run']);
    expect(result.gates[1]?.result.reasonCode).toBe('fail-fast-prerequisite-failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition rejects same-id descriptor argv or runtime substitution before physical execution', async () => {
  const plan = buildCiVerificationActionPlanClosure({ candidate, gates: [gates[0]!] });
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-substitution-'));
  try {
    for (const gate of [
      { ...gates[0]!, argv: ['bun', 'test', 'tests/forged.test.ts'] },
      { ...gates[0]!, runtime: 'bun@1.3.14' }
    ]) {
      let physicalExecutions = 0;
      await expect(CodexDevelopmentExecuteCiActionClosure({
        repositoryRoot: root,
        actionPlan: plan,
        gates: [{ gate, env: {} }],
        headSha: candidate.headSha,
        now: clock(),
        runGate: async () => {
          physicalExecutions += 1;
          return { code: 0, rawOutputDigest: digest('7'), failureTail: '' };
        }
      })).rejects.toThrow(/differs from its authorized operation/);
      expect(physicalExecutions).toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition environment, argv, and topology drift change the Action plan digest', () => {
  const baseline = buildCiVerificationActionPlanClosure({ candidate, gates });
  const variants: readonly (readonly CiVerificationProducerGate[])[] = [
    gates.map((gate, index) => index === 0 ? { ...gate, environment: { 'ci-env-v1:environment': digest('8') } } : gate),
    [...gates].reverse()
  ];
  for (const variant of variants) {
    expect(buildCiVerificationActionPlanClosure({ candidate, gates: variant }).actionPlanDigest)
      .not.toBe(baseline.actionPlanDigest);
  }
  const forgedArgv = gates.map((gate, index) => index === 0
    ? { ...gate, argv: [...gate.argv, '--forged'] }
    : gate);
  expect(() => buildCiVerificationActionPlanClosure({ candidate, gates: forgedArgv })).toThrow(
    /outside the canonical producer-owned grammar/
  );
});
