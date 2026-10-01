import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { buildCiVerificationActionPlanClosure, ciVerificationGateStep, ciVerificationNormalizedOperationArgv, sourceProgramTransitionGate, type CiVerificationActionCandidate, type CiVerificationProducerGate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CodexDevelopmentVerificationDigest, parseSourceProgramTransitionAcceptanceRecord, parseTrustedRuntimeSourceProgramActionRecord } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { CodexDevelopmentRunGateProcess, type CodexDevelopmentGateProcessSettlement } from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { CodexDevelopmentExecuteCiActionClosure } from '../../src/adapters/verification/platform/ci/verification.ts';
import { assertSourceProgramTransitionQualification, assertTrustedRuntimeSourceProgramAction } from '../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { CodexDevelopmentBuildVerificationGateResult } from '../../src/assurance/verification/result/contract/result.ts';

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
    execution: Parameters<typeof CodexDevelopmentRunGateProcess>[2]
  ): Promise<CodexDevelopmentGateProcessSettlement> => CodexDevelopmentRunGateProcess(
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
    const result = await CodexDevelopmentExecuteCiActionClosure({
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
    const result = await CodexDevelopmentExecuteCiActionClosure({
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
      await expect(CodexDevelopmentExecuteCiActionClosure({
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
    await expect(CodexDevelopmentExecuteCiActionClosure({
      repositoryRoot: root,
      actionPlan: plan,
      gates: [{ gate: gates[0]!, env: {} }],
      headSha: plainResultCandidate.headSha,
      now: clock(),
      runGate: async () => ({
        code: 0,
        rawOutputDigest: digest('plain-result'),
        failureTail: ''
      } as unknown as CodexDevelopmentGateProcessSettlement)
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

// The transport fixture is deliberately historical data. It never executes the
// private producer or obtains its live issuer relations.
function historicalSourceActionFixture() {
  const subject = candidateFor('source-action-transport');
  const sourceGate = ciVerificationGateStep(sourceProgramTransitionGate({
    baseSha: subject.baseSha, headSha: subject.headSha,
    payloadDigest: null, approvalObservationDigest: null, approvalDigest: null
  }));
  const plan = buildCiVerificationActionPlanClosure({ candidate: subject, gates: [gates[0]!, sourceGate] });
  const action = plan.actions[1]!.action;
  const result = CodexDevelopmentBuildVerificationGateResult({
    gateId: 'source-program-transition-assessment', gateRevision: action.operation.revision,
    owner: 'ci-verification-maintainer', requirementKey: 'gate:source-program-transition-assessment',
    subjectRevision: subject.headSha, inputDigest: action.actionKey,
    applicability: 'required', status: 'passed', disposition: 'executed', reasonCode: 'executed-success',
    requiredForClaims: ['gate:source-program-transition-assessment'],
    supportedClaims: ['gate:source-program-transition-assessment'],
    environment: { runtime: 'bun', os: 'linux', arch: 'x64', filesystem: null, capabilities: [],
      toolchainRevision: action.environment.toolchainRevision, providerRevisions: [action.environment.providerRevision] },
    execution: { argv: [...sourceGate.argv], startedAt: '2026-10-01T10:00:00.000Z',
      finishedAt: '2026-10-01T10:00:00.001Z', durationMs: 1, exitCode: 0,
      outputDigest: digest('exact-source-bytes'), failureFingerprint: null },
    evidenceRefs: [digest('exact-source-bytes')], invalidationRules: ['source or producer changes'], diagnostic: null
  });
  const fields = {
    schema: 'source-program-qualified-action-v1' as const, authority: 'historical-evidence-only' as const,
    sessionRevision: digest('source-session'), observationDigest: digest('source-observation'),
    attemptEvidenceDigest: digest('source-attempt'), outputByteDigest: digest('exact-source-bytes'),
    gate: { action, result, cleanup: { status: 'passed' as const, evidenceRefs: [digest('source-attempt')], diagnostic: null } }
  };
  const sourceAction = { ...fields, sourceActionDigest: CodexDevelopmentVerificationDigest(fields) };
  return { subject, sourceGate, plan, sourceAction };
}

function historicalAcceptanceFixture(first: boolean) {
  const fields = {
    status: 'accepted', assessmentDigest: digest('assessment'),
    ...(first ? { schema: 'source-program-transition-qualification-v2', origin: 'first-qualified',
      sourceActionOutputDigest: digest('source-output'), sourceActionDigest: digest('source-action') }
      : { predecessorActionOutputDigest: digest('predecessor-output'), predecessorDisposition: 'superseded-nonterminal' }),
    attemptId: 'isolated-attempt-1', actionKey: digest('source-action-key'), sessionRevision: digest('session'),
    observationDigest: digest('observation'), approvalDigest: null, auditResultDigest: digest('audit-result'),
    adoptionDigest: digest('adoption'), attemptEvidenceDigest: digest('attempt')
  };
  return { ...fields, qualificationDigest: CodexDevelopmentVerificationDigest(fields) };
}

test('source Action transport consumes the exact completed gate without a second physical execution', async () => {
  const { subject, sourceGate, plan, sourceAction } = historicalSourceActionFixture();
  const processCalls: string[] = [];
  const root = mkdtempSync(path.join(tmpdir(), 'sec-source-handoff-'));
  try {
    const execution = await CodexDevelopmentExecuteCiActionClosure({
      repositoryRoot: root, actionPlan: plan, gates: [{ gate: gates[0]!, env: {} }, { gate: sourceGate, env: {} }],
      headSha: subject.headSha, now: clock(), sourceAction, sessionRevision: sourceAction.sessionRevision,
      runGate: async (gate, effect) => {
        processCalls.push(gate.id);
        if (gate.id === 'source-program-transition-assessment') throw new Error('a handed-off source Action must not run again');
        return await executeSentinelGate(root, 0)(gate, effect);
      }
    });
    expect(processCalls).toEqual(['composition-scope-a']);
    expect(execution.failed).toBe(false);
    expect(execution.gates).toHaveLength(2);
    expect(execution.gates[1]).toBe(sourceAction.gate);
    expect(execution.gates[1]!.result.disposition).toBe('executed');
    expect(execution.gates[1]!.cleanup.evidenceRefs).toEqual([digest('source-attempt')]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source Action transport rejects another Session, subject, or altered full gate', async () => {
  const { subject, sourceGate, plan, sourceAction } = historicalSourceActionFixture();
  const execute = (sessionRevision: string, headSha: string) => CodexDevelopmentExecuteCiActionClosure({
    repositoryRoot: tmpdir(), actionPlan: plan, gates: [{ gate: gates[0]!, env: {} }, { gate: sourceGate, env: {} }],
    headSha, now: clock(), sourceAction, sessionRevision,
    runGate: async () => { throw new Error('invalid handoff must not run'); }
  });
  await expect(execute(digest('another-session'), subject.headSha)).rejects.toThrow('another exact Session or Action');
  await expect(execute(sourceAction.sessionRevision, 'a'.repeat(40))).rejects.toThrow('another exact Session or Action');
  const changed = JSON.parse(JSON.stringify(sourceAction));
  changed.gate.result.execution.durationMs = 2;
  expect(() => parseTrustedRuntimeSourceProgramActionRecord(changed)).toThrow('digest mismatch');
  expect(() => parseTrustedRuntimeSourceProgramActionRecord({ ...sourceAction, skip: true })).toThrow('unknown or missing fields');
});

test('source acceptance v1 retains its predecessor and v2 explicitly has none', () => {
  const legacy = parseSourceProgramTransitionAcceptanceRecord(historicalAcceptanceFixture(false));
  const first = parseSourceProgramTransitionAcceptanceRecord(historicalAcceptanceFixture(true));
  expect(legacy).toHaveProperty('predecessorDisposition', 'superseded-nonterminal');
  expect(legacy).not.toHaveProperty('schema');
  expect(legacy).not.toHaveProperty('origin');
  expect(first).toHaveProperty('schema', 'source-program-transition-qualification-v2');
  expect(first).toHaveProperty('origin', 'first-qualified');
  expect(first).not.toHaveProperty('predecessorActionOutputDigest');
  expect(first).not.toHaveProperty('predecessorDisposition');
  expect(() => parseSourceProgramTransitionAcceptanceRecord({ ...first,
    predecessorActionOutputDigest: digest('fake-predecessor') })).toThrow('unknown or missing fields');
  expect(() => parseSourceProgramTransitionAcceptanceRecord({ ...first, origin: 'legacy-requalification' }))
    .toThrow('invalid qualified origin');
});

test('canonical historical source records and JSON clones never recover live host authority', () => {
  const { sourceAction } = historicalSourceActionFixture();
  const transported = parseTrustedRuntimeSourceProgramActionRecord(JSON.parse(JSON.stringify(sourceAction)));
  expect(transported.gate.result.status).toBe('passed');
  expect(() => assertTrustedRuntimeSourceProgramAction(sourceAction)).toThrow('exact live isolated producer handoff');
  expect(() => assertTrustedRuntimeSourceProgramAction(transported)).toThrow('exact live isolated producer handoff');
  for (const first of [false, true]) {
    const record = parseSourceProgramTransitionAcceptanceRecord(JSON.parse(JSON.stringify(historicalAcceptanceFixture(first))));
    expect(() => assertSourceProgramTransitionQualification(record)).toThrow('live isolated host qualification');
  }
});
