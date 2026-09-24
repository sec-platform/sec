import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { buildCiVerificationActionPlanClosure, ciVerificationNormalizedOperationArgv, type CiVerificationActionCandidate, type CiVerificationProducerGate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { RunGateProcess, type GateProcessSettlement } from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { ExecuteCiActionClosure } from '../../src/adapters/verification/platform/ci/verification.ts';

const digest = (value: string): `sha256:${string}` => (
  `sha256:${createHash('sha256').update(value).digest('hex')}`
);

function candidateFor(testIdentity: string): CiVerificationActionCandidate {
  return {
  baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40), headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40),
  manifestPath: 'config/repository/work-packages/composition-v2.md', manifestDigest: digest(`manifest:${testIdentity}`),
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

function executeSentinelGate(repositoryRoot: string, code: number, output = '') {
  return executeScriptGate(
    repositoryRoot,
    `${output.length > 0 ? `console.error(${JSON.stringify(output)});` : ''}process.exit(${code});`
  );
}

function executeScriptGate(repositoryRoot: string, script: string) {
  return async (
    gate: Readonly<{ id: string; argv: string[]; env: NodeJS.ProcessEnv }>,
    execution: Parameters<typeof RunGateProcess>[2]
  ): Promise<GateProcessSettlement> => RunGateProcess(
    repositoryRoot,
    {
      ...gate,
      argv: [process.execPath, '-e', script]
    },
    execution
  );
}

test('composition gates execute through the same Action runner and preserve producer env/scope identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-'));
  try {
    const plan = buildCiVerificationActionPlanClosure({ candidate, gates });
    const calls: Array<{ id: string; argv: readonly string[] }> = [];
    const result = await ExecuteCiActionClosure({
      repositoryRoot: root,
      actionPlan: plan,
      gates: gates.map((gate) => ({ gate, env: { SEC_CHANGED_BASE: candidate.baseSha } })),
      headSha: candidate.headSha,
      now: clock(),
      runGate: async (gate, execution) => {
        calls.push({ id: gate.id, argv: gate.argv });
        return (calls.length === 1
          ? executeScriptGate(root, 'console.log(process.cwd());')
          : executeSentinelGate(root, 0))(gate, execution);
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
    expect(result.gates.map((gate) => gate.result.execution?.outputDigest)).toEqual([
      digest(`${root}\n`),
      digest('')
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition failure remains failed and later Action is canonical not-run', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-fail-'));
  try {
    const failureCandidate = candidateFor('failed-composition');
    const plan = buildCiVerificationActionPlanClosure({ candidate: failureCandidate, gates });
    const result = await ExecuteCiActionClosure({
      repositoryRoot: root,
      actionPlan: plan,
      gates: gates.map((gate) => ({ gate, env: {} })),
      headSha: failureCandidate.headSha,
      now: clock(),
      runGate: executeSentinelGate(root, 7, 'sentinel')
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
      await expect(ExecuteCiActionClosure({
        repositoryRoot: root,
        actionPlan: plan,
        gates: [{ gate, env: {} }],
        headSha: candidate.headSha,
        now: clock(),
        runGate: async (step, execution) => {
          physicalExecutions += 1;
          return executeSentinelGate(root, 0)(step, execution);
        }
      })).rejects.toThrow(/differs from its authorized operation/);
      expect(physicalExecutions).toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition rejects a plain structural process result without an owner-issued resource receipt', async () => {
  const plainResultCandidate = candidateFor('plain-structural-process-result');
  const plan = buildCiVerificationActionPlanClosure({
    candidate: plainResultCandidate,
    gates: [gates[0]!]
  });
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-plain-result-'));
  try {
    await expect(ExecuteCiActionClosure({
      repositoryRoot: root,
      actionPlan: plan,
      gates: [{ gate: gates[0]!, env: {} }],
      headSha: plainResultCandidate.headSha,
      now: clock(),
      runGate: async () => ({
        code: 0,
        rawOutputDigest: digest('plain-result'),
        failureTail: ''
      } as unknown as GateProcessSettlement)
    })).rejects.toThrow(/did not receive an owner-issued process terminal/u);
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
