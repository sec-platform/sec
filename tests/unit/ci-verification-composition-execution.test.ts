import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { createVerificationActionCallbackEffectProviderV1 } from '../../platform/dev-runner/verification-action-executor.ts';
import {
  buildCiVerificationActionPlanClosureV1,
  ciVerificationNormalizedOperationArgvV2,
  type CiVerificationActionCandidateV1,
  type CiVerificationProducerGateV1
} from '../../platform/shared/verification-action-ci-contract.ts';
import { createVerificationActionTerminalV2 } from '../../platform/shared/verification-action-contract.ts';
import { CodexDevelopmentExecuteCiActionClosureV1 } from '../../scripts/ci-verification.ts';

const digest = (value: string): `sha256:${string}` => (
  `sha256:${createHash('sha256').update(value).digest('hex')}`
);

const staticAuthorityRepositoryRoot = path.resolve(import.meta.dir, '..', '..');

function exactTrackedDigest(repositoryPath: string): `sha256:${string}` {
  const result = spawnSync('git', ['show', `HEAD:${repositoryPath}`], {
    cwd: staticAuthorityRepositoryRoot,
    encoding: null,
    windowsHide: true
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Cannot read exact static authority input ${repositoryPath}.`);
  }
  return `sha256:${createHash('sha256').update(result.stdout).digest('hex')}`;
}

function candidateFor(testIdentity: string): CiVerificationActionCandidateV1 {
  return {
  baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40), headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40),
  manifestPath: 'docs/development-governance.md',
  manifestDigest: exactTrackedDigest('docs/development-governance.md'),
  scopeAuthorizationRevision: digest(`scope:${testIdentity}`), profile: 'quick',
  toolchainRevision: 'bun@1.3.14', providerRevision: 'github-actions@trusted-default',
  contractRevision: 'ci-verification-v19', requiredBlobs: [
    ...['.bun-version', 'bun.lock', 'bunfig.toml', 'package.json', 'tsconfig.json'].map(
      (repositoryPath) => ({ path: repositoryPath, digest: exactTrackedDigest(repositoryPath) })
    )
  ]
  };
}

const candidate = candidateFor('successful-composition');
const gates: readonly CiVerificationProducerGateV1[] = [
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

function testEffectProvider(
  plan: ReturnType<typeof buildCiVerificationActionPlanClosureV1>,
  descriptors: readonly Readonly<{ gate: CiVerificationProducerGateV1; env: NodeJS.ProcessEnv }>[],
  execute: (step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }) => Promise<{
    code: number;
    rawOutputDigest: `sha256:${string}`;
    failureTail: string;
  }>
) {
  return createVerificationActionCallbackEffectProviderV1({
    providerRevision: plan.actions[0]!.action.environment.providerRevision,
    execute: async ({ action }) => {
      const index = plan.actions.findIndex((entry) => entry.action.actionKey === action.actionKey);
      const operation = index < 0 ? undefined : plan.normalizedOperations[index];
      const descriptor = index < 0 ? undefined : descriptors[index];
      if (operation === undefined || descriptor === undefined) {
        throw new Error('test Effect provider received an Action outside the closure');
      }
      const result = await execute({
        id: operation.gateId,
        argv: [...ciVerificationNormalizedOperationArgvV2(operation)],
        env: descriptor.env
      });
      return {
        terminal: createVerificationActionTerminalV2({
          status: result.code === 0 ? 'passed' : 'failed',
          reasonCode: result.code === 0 ? 'executed-success' : 'executed-failure',
          resultDigest: result.rawOutputDigest
        }),
        evidenceRefs: [`test://ci-verification/${result.rawOutputDigest}`]
      };
    }
  });
}

test('composition gates execute through the same Action runner and preserve producer env/scope identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-'));
  try {
    const plan = buildCiVerificationActionPlanClosureV1({ candidate, gates });
    const calls: Array<{ id: string; argv: readonly string[] }> = [];
    const result = await CodexDevelopmentExecuteCiActionClosureV1({
      runtimeStateRepositoryRoot: root,
      staticAuthorityRepositoryRoot,
      physicalExecutionRepositoryRoot: root,
      actionPlan: plan,
      gates: gates.map((gate) => ({ gate, env: { SEC_CHANGED_BASE: candidate.baseSha } })),
      headSha: candidate.headSha,
      now: clock(),
      effectProvider: testEffectProvider(plan, gates.map((gate) => ({
        gate, env: { SEC_CHANGED_BASE: candidate.baseSha }
      })), async (gate) => {
        calls.push({ id: gate.id, argv: gate.argv });
        return { code: 0, rawOutputDigest: digest('f'), failureTail: '' };
      })
    });
    expect(result.failed).toBe(false);
    expect(calls.map(({ id }) => id)).toEqual(gates.map((gate) => gate.id));
    expect(calls.map(({ argv }) => argv)).toEqual(gates.map(({ argv }) => argv));
    expect(plan.normalizedOperations.map(ciVerificationNormalizedOperationArgvV2))
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
    const plan = buildCiVerificationActionPlanClosureV1({ candidate: failureCandidate, gates });
    const result = await CodexDevelopmentExecuteCiActionClosureV1({
      runtimeStateRepositoryRoot: root,
      staticAuthorityRepositoryRoot,
      physicalExecutionRepositoryRoot: root,
      actionPlan: plan,
      gates: gates.map((gate) => ({ gate, env: {} })),
      headSha: failureCandidate.headSha,
      now: clock(),
      effectProvider: testEffectProvider(plan, gates.map((gate) => ({ gate, env: {} })), async () => ({
        code: 7, rawOutputDigest: digest('9'), failureTail: 'sentinel'
      }))
    });
    expect(result.failed).toBe(true);
    expect(result.gates.map((gate) => gate.result.status)).toEqual(['failed', 'not-run']);
    expect(result.gates[1]?.result.reasonCode).toBe('fail-fast-prerequisite-failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition rejects same-id descriptor argv or runtime substitution before physical execution', async () => {
  const plan = buildCiVerificationActionPlanClosureV1({ candidate, gates: [gates[0]!] });
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-composition-substitution-'));
  try {
    for (const gate of [
      { ...gates[0]!, argv: ['bun', 'test', 'tests/forged.test.ts'] },
      { ...gates[0]!, runtime: 'bun@1.3.14' }
    ]) {
      let physicalExecutions = 0;
      await expect(CodexDevelopmentExecuteCiActionClosureV1({
        runtimeStateRepositoryRoot: root,
        staticAuthorityRepositoryRoot,
        physicalExecutionRepositoryRoot: root,
        actionPlan: plan,
        gates: [{ gate, env: {} }],
        headSha: candidate.headSha,
        now: clock(),
        effectProvider: testEffectProvider(plan, [{ gate, env: {} }], async () => {
          physicalExecutions += 1;
          return { code: 0, rawOutputDigest: digest('7'), failureTail: '' };
        })
      })).rejects.toThrow(/differs from its authorized operation/);
      expect(physicalExecutions).toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('default physical provider rejects a cwd whose exact head/tree differs before runner admission', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-physical-binding-'));
  try {
    const plan = buildCiVerificationActionPlanClosureV1({ candidate, gates: [gates[0]!] });
    await expect(CodexDevelopmentExecuteCiActionClosureV1({
      runtimeStateRepositoryRoot: root,
      staticAuthorityRepositoryRoot,
      physicalExecutionRepositoryRoot: staticAuthorityRepositoryRoot,
      actionPlan: plan,
      gates: [{ gate: gates[0]!, env: {} }],
      headSha: candidate.headSha,
      now: clock()
    })).rejects.toThrow(/physical-execution-binding-mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composition environment, argv, and topology drift change the Action plan digest', () => {
  const baseline = buildCiVerificationActionPlanClosureV1({ candidate, gates });
  const variants: readonly (readonly CiVerificationProducerGateV1[])[] = [
    gates.map((gate, index) => index === 0 ? { ...gate, environment: { 'ci-env-v1:environment': digest('8') } } : gate),
    [...gates].reverse()
  ];
  for (const variant of variants) {
    expect(buildCiVerificationActionPlanClosureV1({ candidate, gates: variant }).actionPlanDigest)
      .not.toBe(baseline.actionPlanDigest);
  }
  const forgedArgv = gates.map((gate, index) => index === 0
    ? { ...gate, argv: [...gate.argv, '--forged'] }
    : gate);
  expect(() => buildCiVerificationActionPlanClosureV1({ candidate, gates: forgedArgv })).toThrow(
    /outside the canonical producer-owned grammar/
  );
});
