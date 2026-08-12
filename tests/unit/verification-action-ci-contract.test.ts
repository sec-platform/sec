import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { executeVerifiedCiActionPlanV1 } from '../../platform/dev-runner.ts';
import { buildCiFullGatePlan, buildCiQuickGatePlan } from '../../platform/shared/ci-verification-plan.ts';
import {
  assertCiVerificationActionPlanClosureEqualV1,
  assertCiVerificationActionProviderEnvelopeMemberV2,
  buildCiVerificationActionPlanClosureV1,
  ciVerificationActionParentDispatchPlanArtifactNameV2,
  ciVerificationActionParentDispatchPlanPayloadDigestV2,
  ciVerificationGateStepV1,
  ciVerificationNormalizedOperationArgvV2,
  createCiVerificationActionParentDispatchPlanV2,
  createCiVerificationActionProposalV2,
  createCiVerificationActionProviderEnvelopeV2,
  parseCiVerificationActionParentDispatchPlanV2,
  parseCiVerificationActionPlanClosureV1,
  parseCiVerificationActionProviderEnvelopeV2,
  type CiVerificationActionCandidateV1
} from '../../platform/shared/verification-action-ci-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  createVerificationSessionProposalDigestV1,
  createVerificationSessionV2
} from '../../platform/shared/verification-session-contract.ts';

const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const candidate: CiVerificationActionCandidateV1 = {
  baseSha: '1'.repeat(40),
  baseTreeSha: '2'.repeat(40),
  headSha: '3'.repeat(40),
  headTreeSha: '4'.repeat(40),
  manifestPath: 'docs/work-packages/example-v1.md',
  manifestDigest: digest('a'),
  scopeAuthorizationRevision: digest('b'),
  profile: 'quick',
  toolchainRevision: 'bun@1.3.14',
  providerRevision: 'github-actions@trusted-default',
  contractRevision: 'ci-verification-v19',
  requiredBlobs: [
    { path: '.bun-version', digest: digest('c') },
    { path: 'bun.lock', digest: digest('d') },
    { path: 'bunfig.toml', digest: digest('e') },
    { path: 'package.json', digest: digest('f') }
  ]
};

function rehashActionClosure(value: Record<string, unknown>): Record<string, unknown> {
  const { actionPlanDigest: _discarded, ...withoutDigest } = value;
  return {
    ...withoutDigest,
    actionPlanDigest: `sha256:${createHash('sha256')
      .update(encodeVerificationActionDataV2(withoutDigest))
      .digest('hex')}`
  };
}

test('normal CLI, dev-runner, and workflow projections share one byte-identical Action closure', () => {
  const gates = buildCiQuickGatePlan({ includeImports: true, includeDocs: true, includeRisk: true })
    .map(ciVerificationGateStepV1);
  const cli = buildCiVerificationActionPlanClosureV1({ candidate, gates });
  const devRunner = buildCiVerificationActionPlanClosureV1({ candidate: { ...candidate }, gates: gates.map((gate) => ({ ...gate })) });
  const workflow = parseCiVerificationActionPlanClosureV1(encodeVerificationActionDataV2(cli));
  expect(devRunner.actionPlanDigest).toBe(cli.actionPlanDigest);
  expect(workflow.actionPlanDigest).toBe(cli.actionPlanDigest);
  expect(encodeVerificationActionDataV2(workflow.actions)).toBe(encodeVerificationActionDataV2(cli.actions));
  expect(() => assertCiVerificationActionPlanClosureEqualV1(workflow, cli)).not.toThrow();
});

test('direct Bun tests have one bounded normalized target and reject generic subcommands', () => {
  const argv = [
    'bun',
    'test',
    'tests/unit/verification-action-ci-contract.test.ts',
    '--test-name-pattern',
    '^direct Bun tests$',
    '--timeout',
    '180000'
  ];
  const closure = buildCiVerificationActionPlanClosureV1({
    candidate,
    gates: [{
      id: 'direct-bun-test',
      phase: 'quick',
      argv,
      runtime: 'bun',
      environment: {
        'a-binding': digest('1'),
        'B-binding': digest('2')
      },
      coveredScopeIds: ['scope:direct-bun-test']
    }]
  });
  expect(closure.normalizedOperations[0]?.target).toEqual({
    kind: 'bun-test',
    identity: 'test',
    args: argv.slice(2)
  });
  expect(closure.normalizedOperations[0]?.environmentBindings.map(({ name }) => name)).toEqual([
    'B-binding',
    'SEC_EXECUTION_ENVIRONMENT_REVISION',
    'a-binding'
  ]);
  expect(ciVerificationNormalizedOperationArgvV2(closure.normalizedOperations[0]!)).toEqual(argv);
  expect(
    ciVerificationNormalizedOperationArgvV2(
      parseCiVerificationActionPlanClosureV1(encodeVerificationActionDataV2(closure))
        .normalizedOperations[0]!
    )
  ).toEqual(argv);

  for (const pattern of ['x'.repeat(513), 'x'.repeat(8_192)]) {
    expect(() => buildCiVerificationActionPlanClosureV1({
      candidate,
      gates: [{
        id: 'bounded-pattern',
        phase: 'quick',
        argv: ['bun', 'test', 'tests/unit/example.test.ts', '--test-name-pattern', pattern],
        runtime: 'bun',
        environment: {},
        coveredScopeIds: []
      }]
    })).not.toThrow();
  }

  const rejectedArgv = [
    ['bun', 'test'],
    ['bun', 'test', 'scripts/ci-verification.ts'],
    ['bun', 'test', '../tests/unit/example.test.ts'],
    ['bun', 'test', '/tests/unit/example.test.ts'],
    ['bun', 'test', 'tests/../scripts/example.test.ts'],
    ['bun', 'test', 'tests\\unit\\example.test.ts'],
    ['bun', 'test', 'tests/unit/example.ts'],
    ['bun', 'test', 'tests/unit/example.test.cjsx'],
    ['bun', 'test', 'tests/unit/example.test.mtsx'],
    ['bun', 'test', 'tests/unit/example.test.ts', 'tests/unit/example.test.ts'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--preload', 'scripts/setup.ts'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--watch'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--test-name-pattern'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--test-name-pattern', '['],
    ['bun', 'test', 'tests/unit/example.test.ts', '--test-name-pattern', 'x'.repeat(8_193)],
    ['bun', 'test', 'tests/unit/example.test.ts', '--timeout', '0'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--timeout', '01'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--timeout=180000'],
    ['bun', 'test', 'tests/unit/example.test.ts', '--timeout', '300001'],
    [
      'bun', 'test', 'tests/unit/example.test.ts', '--timeout', '180000',
      '--test-name-pattern', '^reordered$'
    ],
    [
      'bun', 'test', 'tests/unit/example.test.ts', '--test-name-pattern', '^one$',
      '--test-name-pattern', '^two$'
    ],
    ['bun', 'install']
  ];
  for (const rejected of rejectedArgv) {
    expect(() => buildCiVerificationActionPlanClosureV1({
      candidate,
      gates: [{
        id: 'rejected-direct-bun-test',
        phase: 'quick',
        argv: rejected,
        runtime: 'bun',
        environment: {},
        coveredScopeIds: []
      }]
    })).toThrow();
  }

  const encoded = JSON.parse(encodeVerificationActionDataV2(closure)) as {
    normalizedOperations: Array<{ target: { identity: string } }>;
  };
  encoded.normalizedOperations[0]!.target.identity = 'install';
  expect(() => parseCiVerificationActionPlanClosureV1(JSON.stringify(encoded))).toThrow(
    /Bun test target identity must be test/
  );
});

test('scope revision constructs ActionPlan, then SessionProposal and SessionRevision without a hash cycle', () => {
  const actionPlan = buildCiVerificationActionPlanClosureV1({
    candidate,
    gates: buildCiQuickGatePlan({ includeImports: true, includeDocs: false, includeRisk: false })
      .map(ciVerificationGateStepV1)
  });
  const sessionProposalDigest = createVerificationSessionProposalDigestV1({
    repository: 'owner/repo', prNumber: 7,
    baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha,
    headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
    manifestPath: candidate.manifestPath, manifestDigest: candidate.manifestDigest,
    testImpactTransitionDigest: digest('0'),
    scopeProposalDigest: digest('d'),
    actionPlanClosureDigest: actionPlan.actionPlanDigest,
    profile: candidate.profile, environmentDigest: digest('f'), trustRevision: candidate.baseSha,
    reviewPolicyDigest: digest('1'), mainHealthPolicyDigest: digest('9')
  });
  const sessionInput = {
    sessionId: 'constructible-session', createdAt: '2026-08-09T00:00:00.000Z',
    repository: 'owner/repo', prNumber: 7,
    baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha,
    headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
    manifestPath: candidate.manifestPath, manifestDigest: candidate.manifestDigest,
    sessionProposalDigest,
    scopeAuthorizationRevision: candidate.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: digest('e'),
    actionPlanClosureDigest: actionPlan.actionPlanDigest,
    profile: candidate.profile, environmentDigest: digest('f'), trustRevision: candidate.baseSha,
    reviewPolicyDigest: digest('1'), evidenceRequirementDigest: digest('2'),
    integrationPolicyDigest: digest('3'),
    mainHealthRef: {
      mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha,
      healthRevision: digest('4'), ledgerReceiptDigest: digest('5')
    }
  } as const;
  const session = createVerificationSessionV2(sessionInput);
  const receiptOnlyDrift = createVerificationSessionV2({
    ...sessionInput,
    sessionId: 'constructible-session-retry',
    createdAt: '2026-08-09T01:00:00.000Z',
    scopeAuthorizationReceiptDigest: digest('6'),
    mainHealthRef: { ...sessionInput.mainHealthRef, ledgerReceiptDigest: digest('7') }
  });
  expect(session.actionPlanClosureDigest).toBe(actionPlan.actionPlanDigest);
  expect(encodeVerificationActionDataV2(actionPlan)).not.toContain(sessionProposalDigest);
  expect(session.sessionRevision).toBe(receiptOnlyDrift.sessionRevision);
  expect(encodeVerificationActionDataV2(actionPlan)).not.toContain(session.sessionRevision);
  expect(createVerificationSessionV2({ ...sessionInput, actionPlanClosureDigest: digest('8') }).sessionRevision)
    .not.toBe(session.sessionRevision);
});

test('semantic input, environment, argv, topology, and plan forgery drift the Action closure', () => {
  const gates = buildCiQuickGatePlan({ includeImports: true, includeDocs: true, includeRisk: false })
    .map(ciVerificationGateStepV1);
  const baseline = buildCiVerificationActionPlanClosureV1({ candidate, gates });
  for (const changed of [
    { ...candidate, headTreeSha: '5'.repeat(40) },
    { ...candidate, manifestDigest: digest('d') },
    { ...candidate, scopeAuthorizationRevision: digest('e') },
    { ...candidate, toolchainRevision: 'bun@9.9.9' }
  ]) {
    expect(buildCiVerificationActionPlanClosureV1({ candidate: changed, gates }).actionPlanDigest)
      .not.toBe(baseline.actionPlanDigest);
  }
  const argvDrift = gates.map((gate, index) => index === 0 ? { ...gate, argv: [...gate.argv, '--forged'] } : gate);
  expect(buildCiVerificationActionPlanClosureV1({ candidate, gates: argvDrift }).actionPlanDigest)
    .not.toBe(baseline.actionPlanDigest);
  expect(() => buildCiVerificationActionPlanClosureV1({
    candidate: { ...candidate, requiredBlobs: candidate.requiredBlobs.filter((entry) => entry.path !== 'bunfig.toml') },
    gates
  })).toThrow('omits canonical dependency input bunfig.toml');
  const forged = JSON.parse(encodeVerificationActionDataV2(baseline)) as Record<string, unknown>;
  forged.actionPlanDigest = digest('f');
  expect(() => parseCiVerificationActionPlanClosureV1(JSON.stringify(forged))).toThrow('digest mismatch');
});

test('Action closure graph is unique, closed and acyclic without requiring topological array order', () => {
  const baseline = buildCiVerificationActionPlanClosureV1({
    candidate,
    gates: buildCiQuickGatePlan({ includeImports: true, includeDocs: true, includeRisk: false })
      .map(ciVerificationGateStepV1)
  });
  const source = structuredClone(baseline) as unknown as Record<string, unknown>;
  const actions = source.actions as Record<string, unknown>[];
  const operations = source.normalizedOperations as Record<string, unknown>[];
  expect(actions.length).toBeGreaterThanOrEqual(3);

  const reversed = rehashActionClosure({
    ...source,
    actions: [...actions].reverse(),
    normalizedOperations: [...operations].reverse()
  });
  const parsedReversed = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(reversed)
  );
  expect(parsedReversed.actions.map((entry) => entry.action.actionKey)).toEqual(
    [...baseline.actions].reverse().map((entry) => entry.action.actionKey)
  );

  const missingDependency = rehashActionClosure({
    ...source,
    actions: [actions[1]!],
    normalizedOperations: [operations[1]!]
  });
  expect(() => parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(missingDependency)
  )).toThrow('does not resolve to exactly one Action member');

  const duplicateAction = rehashActionClosure({
    ...source,
    actions: [actions[0]!, actions[0]!],
    normalizedOperations: [operations[0]!, operations[0]!]
  });
  expect(() => parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(duplicateAction)
  )).toThrow('ActionKeys must be unique');

  const firstActionKey = ((actions[0]!.action as Record<string, unknown>).actionKey) as string;
  const secondActionKey = ((actions[1]!.action as Record<string, unknown>).actionKey) as string;
  const selfDependent = structuredClone(actions[0]!);
  selfDependent.dependencies = [{ actionKey: firstActionKey, kind: 'upstream' }];
  const selfCycle = rehashActionClosure({
    ...source,
    actions: [selfDependent],
    normalizedOperations: [operations[0]!]
  });
  expect(() => parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(selfCycle)
  )).toThrow('cannot depend on itself');

  const cycleFirst = structuredClone(actions[0]!);
  const cycleSecond = structuredClone(actions[1]!);
  cycleFirst.dependencies = [{ actionKey: secondActionKey, kind: 'upstream' }];
  cycleSecond.dependencies = [{ actionKey: firstActionKey, kind: 'upstream' }];
  const multiNodeCycle = rehashActionClosure({
    ...source,
    actions: [cycleFirst, cycleSecond],
    normalizedOperations: [operations[0]!, operations[1]!]
  });
  expect(() => parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(multiNodeCycle)
  )).toThrow('dependency graph contains a cycle');
});

test('full plan binds every expensive gate to the complete cheap-preflight closure', () => {
  const full = buildCiVerificationActionPlanClosureV1({
    candidate: { ...candidate, profile: 'full' },
    gates: buildCiFullGatePlan().map(ciVerificationGateStepV1)
  });
  const cheap = full.actions.filter((plan) => plan.executionClass === 'cheap-preflight').map((plan) => plan.action.actionKey);
  const expensive = full.actions.filter((plan) => plan.executionClass === 'expensive');
  expect(cheap.length).toBeGreaterThan(0);
  expect(expensive.length).toBeGreaterThan(0);
  for (const plan of expensive) expect(plan.action.requiredCheapPreflightActionKeys).toEqual([...cheap].sort());
});

test('dev-runner executes only a producer-owned member plan and never accepts raw argv or a forged key', async () => {
  const closure = buildCiVerificationActionPlanClosureV1({
    candidate,
    gates: buildCiQuickGatePlan({ includeImports: true, includeDocs: false, includeRisk: false })
      .map(ciVerificationGateStepV1)
  });
  const typecheck = closure.actions.find((plan) => plan.action.operation.identity === 'typecheck')!;
  const calls: unknown[] = [];
  expect(await executeVerifiedCiActionPlanV1({
    plan: typecheck,
    authorizedClosure: closure,
    executeNormalizedOperation: (operation) => {
      calls.push(operation);
      return 0;
    }
  })).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    gateId: 'typecheck',
    target: { kind: 'bun-package-script', identity: 'typecheck', args: [] }
  });
  const forged = structuredClone(typecheck) as typeof typecheck;
  (forged.action as { actionKey: string }).actionKey = digest('9');
  await expect(executeVerifiedCiActionPlanV1({
    plan: forged,
    authorizedClosure: closure,
    executeNormalizedOperation: () => 0
  })).rejects.toThrow();
});

test('internal Action proposal plan and provider envelope form a one-way, exact parent provenance chain', () => {
  const closure = buildCiVerificationActionPlanClosureV1({
    candidate,
    gates: buildCiQuickGatePlan({ includeImports: true, includeDocs: false, includeRisk: false })
      .map(ciVerificationGateStepV1)
  });
  const sessionRequest = Object.freeze({
    schema: 'sec-verification-session-hosted-request-v1',
    prNumber: 7,
    expectedBaseSha: candidate.baseSha,
    expectedHeadSha: candidate.headSha,
    expectedActionPlanDigest: closure.actionPlanDigest
  });
  const proposals = closure.actions.slice(0, 2).map((entry) => createCiVerificationActionProposalV2({
    sessionRequest,
    proposedActionKey: entry.action.actionKey
  })).reverse();
  const parentPlan = createCiVerificationActionParentDispatchPlanV2({
    repositoryId: '311',
    repository: 'owner/repo',
    parentRunId: '9001',
    parentRunAttempt: 2,
    parentJobId: '7001',
    parentWorkflowRef: 'owner/repo/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
    parentWorkflowSha: candidate.baseSha,
    parentActor: {
      login: 'maintainer', id: 42, nodeId: 'MDQ6VXNlcjQy', type: 'User', permission: 'maintain'
    },
    proposals
  });
  expect(parentPlan.proposals.map((entry) => entry.proposedActionKey)).toEqual(
    parentPlan.proposals.map((entry) => entry.proposedActionKey).sort()
  );
  expect(ciVerificationActionParentDispatchPlanArtifactNameV2('9001', 2))
    .toBe('sec-verification-action-parent-dispatch-plan-v2-run-9001-attempt-2');
  expect(ciVerificationActionParentDispatchPlanPayloadDigestV2(parentPlan)).toMatch(/^sha256:[0-9a-f]{64}$/u);
  const envelope = createCiVerificationActionProviderEnvelopeV2({
    proposal: parentPlan.proposals[0]!,
    parentPlan,
    parentDispatchPlanArtifactId: '7123',
    parentDispatchPlanArchiveDigest: digest('9')
  });
  expect(() => assertCiVerificationActionProviderEnvelopeMemberV2(envelope, parentPlan)).not.toThrow();
  expect(encodeVerificationActionDataV2(parentPlan)).not.toContain(envelope.parentDispatchPlanArchiveDigest);
  expect(encodeVerificationActionDataV2(parentPlan)).not.toContain(envelope.parentDispatchPlanPayloadDigest);
});

test('internal Action provider envelope rejects rerun, substitution, extra fields, and non-member proposals', () => {
  const closure = buildCiVerificationActionPlanClosureV1({
    candidate,
    gates: buildCiQuickGatePlan({ includeImports: true, includeDocs: false, includeRisk: false })
      .map(ciVerificationGateStepV1)
  });
  const sessionRequest = Object.freeze({ schema: 'sec-verification-session-hosted-request-v1', prNumber: 7 });
  const member = createCiVerificationActionProposalV2({
    sessionRequest,
    proposedActionKey: closure.actions[0]!.action.actionKey
  });
  const other = createCiVerificationActionProposalV2({
    sessionRequest,
    proposedActionKey: closure.actions[1]!.action.actionKey
  });
  const plan = createCiVerificationActionParentDispatchPlanV2({
    repositoryId: '311', repository: 'owner/repo', parentRunId: '9001', parentRunAttempt: 1,
    parentJobId: '7001',
    parentWorkflowRef: 'owner/repo/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
    parentWorkflowSha: candidate.baseSha,
    parentActor: { login: 'admin', id: 7, nodeId: 'MDQ6VXNlcjc=', type: 'User', permission: 'admin' },
    proposals: [member]
  });
  const envelope = createCiVerificationActionProviderEnvelopeV2({
    proposal: member,
    parentPlan: plan,
    parentDispatchPlanArtifactId: '8111',
    parentDispatchPlanArchiveDigest: digest('8')
  });
  for (const forged of [
    { ...envelope, parentRunAttempt: 2 },
    { ...envelope, parentJobId: '7002' },
    { ...envelope, parentJobName: 'coordinate-verification-sessions' },
    { ...envelope, parentPlanStepName: 'Prepare canonical parent Action dispatch plans' },
    { ...envelope, parentRunId: '9002' },
    { ...envelope, parentWorkflowSha: '9'.repeat(40) },
    { ...envelope, parentDispatchPlanDigest: digest('7') },
    { ...envelope, proposal: other },
    { ...envelope, unexpected: true }
  ]) {
    expect(() => {
      const parsed = parseCiVerificationActionProviderEnvelopeV2(forged);
      assertCiVerificationActionProviderEnvelopeMemberV2(parsed, plan);
    }).toThrow();
  }
  const forgedPlan = {
    ...plan,
    proposals: [member, other],
    parentDispatchPlanDigest: plan.parentDispatchPlanDigest
  };
  expect(() => parseCiVerificationActionParentDispatchPlanV2(forgedPlan)).toThrow('digest');
});
