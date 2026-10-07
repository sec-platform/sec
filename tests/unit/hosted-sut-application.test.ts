import { expect, test } from 'bun:test';
import type { ProcessResourceSession } from '../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { buildTrustedBootstrapSutSandboxCommandPlan, hostedCandidateProcessEnvironment, hostedSutCandidatePreparationFromPlan, parseNativeHostedCandidatePreparation } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-command-plan.ts';
import { CodexDevelopmentPrepareTrustedBootstrapSutInputs, trustedBootstrapCandidatePreparation } from '../../src/adapters/verification/platform/ci/verification-materialization.ts';
import { executeTrustedBootstrapSut, TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS, type TrustedBootstrapSutInput } from '../../src/application/hosted-sut.ts';
import { readResourceCompositeSettlementFailures, ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';
import type { PreparedTrustedBootstrapSutInputs } from '../../src/execution/verification/hosted.ts';

// These application causal fixtures do not issue a native process capability.
const digest = `sha256:${'a'.repeat(64)}` as const;
const input: TrustedBootstrapSutInput = { baseRoot: '/base', candidateRoot: '/candidate',
  outputDirectory: '/evidence', baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40),
  treeSha: 'd'.repeat(40), manifestPath: 'config/work-package.json' };
const unused = (): never => { throw new Error('Unrelated Action port was called.'); };
function fixture(options: Readonly<{ executionFailure?: Readonly<{ error: unknown }>;
  teardownFailure?: Readonly<{ error: unknown }>; preparationFailure?: Readonly<{ error: unknown }>;
  archiveCloseFailure?: Readonly<{ error: unknown }>; retirementFailure?: Readonly<{ error: unknown }> }> = {}) {
  const calls: string[] = [];
  const members = new Map<string, unknown>();
  const observation = (source: string) => ({ code: 0, rawOutputDigest: digest, failureTail: source,
    stdoutDigest: digest, stderrDigest: digest, stdoutBytesObserved: source.length,
    stderrBytesObserved: 0, outputTruncated: false,
    lifecycle: { supervisorSpawned: true, supervisorClosed: true, supervisorCloseCode: 0,
      supervisorSignal: null, namespaceEstablished: true, candidateStarted: true,
      candidateUnitSettled: true, observationGap: null } });
  const plan = (phase: string, actionKey: typeof digest) => ({ schema: 'fixture-command',
    phase, actionKey, unitName: `fixture-${phase}`, planDigest: digest,
    physicalCommandProjectionDigest: null, executionAuthorizationDigest: null,
    command: '/fixture', argv: [] });
  const ports = {
    platform: 'linux', bunExecutable: '/fixture/bun', unitNonce: 'fixture', outputByteLimit: 1024 * 1024,
    capabilityMarker: 'supported-marker', unsupportedDiagnostic: 'unsupported', sandboxPolicyDigest: digest,
    now: () => new Date(0), digest: () => digest, encodeData: JSON.stringify,
    parseResolution: unused, parseTicket: unused, createAuthorization: unused,
    candidateEnvironment: unused, createExecutionPlan: unused, normalizedArgv: unused,
    resolveAuthorizedOperation: unused, resolveArchive: (source: string) => source,
    createCapabilityPlan: () => plan('capability-self-test', digest),
    createTeardownPlan: () => plan('teardown', digest),
    createBootstrapPlan: () => plan('bootstrap-execute', digest),
    run: async (command: { phase: string }) => {
      calls.push(command.phase);
      if (command.phase === 'capability-self-test') return observation('supported-marker');
      if (command.phase === 'bootstrap-execute') {
        if (options.executionFailure !== undefined) throw options.executionFailure.error;
        return observation(JSON.stringify({ schema: 'sec-trusted-bootstrap-sandbox-summary-v1',
          baseSha: input.baseSha, headSha: input.headSha, treeSha: input.treeSha,
          parentSha: input.baseSha, status: 'passed', results: TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS.map(([, label]) =>
            ({ label, exitCode: 0, truncated: false })) }));
      }
      if (options.teardownFailure !== undefined && calls.includes('bootstrap-execute')) throw options.teardownFailure.error;
      return observation('');
    },
    unobservedProcess: (code: number, diagnostic: string) => ({ ...observation(diagnostic), code,
      lifecycle: { supervisorSpawned: null, supervisorClosed: null, supervisorCloseCode: null,
        supervisorSignal: null, namespaceEstablished: null, candidateStarted: null,
        candidateUnitSettled: null, observationGap: 'observation-lost' } }),
    lifecycleComplete: (value: { candidateUnitSettled: boolean | null }) => value.candidateUnitSettled === true,
    cleanupComplete: (value: { exitCode: number | null }) => value.exitCode === 0,
    failureTail: (source: string, fallback: string) => source || fallback,
    retainArchive: () => ({ archiveDigest: digest }), assertArchive: () => digest, pathDigest: () => digest,
    closeArchive: () => { calls.push('close'); if (options.archiveCloseFailure) throw options.archiveCloseFailure.error; },
    rootIsolation: unused, finalizeReceipt: unused, finalizeRawResult: unused,
    prepareEvidenceRoot: () => { calls.push('evidence-root'); },
    prepareBootstrap: () => {
      calls.push('prepare');
      if (options.preparationFailure !== undefined) throw options.preparationFailure.error;
      return { preparedCandidateArchive: '/transport/archive', archiveDigest: digest,
        archiveInventoryDigest: digest, dependencyArchiveProjection: {} } as PreparedTrustedBootstrapSutInputs;
    },
    bootstrapEnvironment: () => ({ SAFE_INPUT: 'value' }),
    writeEvidenceMember: (name: string, value: unknown) => { members.set(name, value); },
    evidenceMemberByteDigest: () => 'a'.repeat(64),
    writeEvidenceText: (name: string, source: string) => { members.set(name, source); },
    byteDigest: () => digest,
    retireBootstrapInputs: () => { calls.push('retire'); if (options.retirementFailure) throw options.retirementFailure.error; }
  } as unknown as Parameters<typeof executeTrustedBootstrapSut>[1];
  return { ports, calls, members };
}

test('TrustedBootstrap application publishes the original fixed evidence and joins execute/teardown before retirement', async () => {
  const observed = fixture();
  expect(await executeTrustedBootstrapSut(input, observed.ports)).toEqual({ status: 'passed', bootstrapDigest: digest, receiptDigest: digest });
  expect(observed.calls).toEqual(['capability-self-test', 'teardown', 'evidence-root', 'prepare', 'bootstrap-execute', 'teardown', 'close', 'retire']);
  expect([...observed.members.keys()]).toEqual([...TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS.map(([name]) => name), 'SHA256SUMS', 'sut-receipt.json']);
});

test('TrustedBootstrap waits for asynchronous physical preparation before execution or retirement', async () => {
  const observed = fixture();
  const original = observed.ports.prepareBootstrap;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const running = executeTrustedBootstrapSut(input, { ...observed.ports, prepareBootstrap: async source => {
    const prepared = original(source);
    await gate;
    return prepared;
  } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(observed.calls).toEqual(['capability-self-test', 'teardown', 'evidence-root', 'prepare']);
  release();
  expect((await running).status).toBe('passed');
  expect(observed.calls.slice(-4)).toEqual(['bootstrap-execute', 'teardown', 'close', 'retire']);
});

test('TrustedBootstrap cannot report passed when any required evidence observation is missing or duplicated', async () => {
  for (const results of [[], [...TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS, TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS[0]!]
    .map(([, label]) => ({ label, exitCode: 0, truncated: false }))]) {
    const observed = fixture();
    const original = observed.ports.run;
    await expect(executeTrustedBootstrapSut(input, { ...observed.ports, run: async (plan, archive) => {
      const result = await original(plan, archive);
      return plan.phase !== 'bootstrap-execute' ? result : { ...result, failureTail: JSON.stringify({
        schema: 'sec-trusted-bootstrap-sandbox-summary-v1', baseSha: input.baseSha, headSha: input.headSha,
        treeSha: input.treeSha, parentSha: input.baseSha, status: 'passed', results }) };
    } })).rejects.toThrow();
    expect(JSON.parse(observed.members.get('sut-receipt.json') as string).auxiliaryStatus).toBe('failed');
    expect(observed.calls.slice(-4)).toEqual(['bootstrap-execute', 'teardown', 'close', 'retire']);
  }
});

test('TrustedBootstrap physical preparation rejects unissued sessions and caller-made publications before effects', async () => {
  const fake = {} as ProcessResourceSession;
  await expect(CodexDevelopmentPrepareTrustedBootstrapSutInputs(input, fake, '/unissued')).rejects.toThrow();
  expect(() => trustedBootstrapCandidatePreparation({} as PreparedTrustedBootstrapSutInputs, fake, digest)).toThrow(/original supervisor and physical producer/u);
});

test('TrustedBootstrap prepared native plan binds its separate subject without claiming Action authorization', () => {
  const preparation = parseNativeHostedCandidatePreparation({ schema: 'sec-trusted-bootstrap-candidate-preparation',
    bootstrapDigest: digest, baseSha: input.baseSha, baseTreeSha: 'e'.repeat(40), headSha: input.headSha,
    headTreeSha: input.treeSha, archiveDigest: digest, inventoryDigest: digest, dependencyClosureDigest: digest,
    gitBundleDigest: digest, deadlineAtUnixMs: 1_900_000_000_000, inputAccess: 'writable' });
  if (preparation.schema !== 'sec-trusted-bootstrap-candidate-preparation') throw new Error('Fixture schema changed.');
  const source = { bootstrapDigest: digest, candidateArchiveDigest: digest, bunExecutable: '/trusted/bin/bun',
    baseSha: input.baseSha, headSha: input.headSha, unitNonce: 'bootstrap-causal',
    candidateEnvironment: hostedCandidateProcessEnvironment({ SEC_EXECUTION_ENVIRONMENT_REVISION: CI_VERIFICATION_HOSTED_PROVIDER_REVISION }),
    candidatePreparation: preparation };
  const plan = buildTrustedBootstrapSutSandboxCommandPlan(source);
  expect(hostedSutCandidatePreparationFromPlan(plan)).toEqual(preparation);
  expect(plan.executionAuthorizationDigest).toBeNull();
  expect(plan.physicalCommandProjectionDigest).toBeNull();
  expect(() => buildTrustedBootstrapSutSandboxCommandPlan({ ...source, candidatePreparation: { ...preparation, archiveDigest: `sha256:${'f'.repeat(64)}` } })).toThrow();
  expect(() => hostedSutCandidatePreparationFromPlan({ ...plan, phase: 'execute' })).toThrow(/different business flow/u);
  expect(() => parseNativeHostedCandidatePreparation({ ...preparation, actionKey: digest })).toThrow();
});

test.each([null, false, undefined])('TrustedBootstrap preserves raw process failure %p after mandatory teardown and receipt', async error => {
  const observed = fixture({ executionFailure: { error } });
  let failure: unknown = Symbol('not-thrown');
  try { await executeTrustedBootstrapSut(input, observed.ports); } catch (caught) { failure = caught; }
  expect(failure).toBe(error);
  expect(observed.calls.slice(-4)).toEqual(['bootstrap-execute', 'teardown', 'close', 'retire']);
  expect(observed.members.has('sut-receipt.json')).toBe(true);
});

test('TrustedBootstrap settles every resource and preserves independent raw execution/teardown/retirement failures', async () => {
  const raw = new Error('primary');
  let reads = 0;
  Object.defineProperty(raw, 'message', { get: () => { reads++; throw new Error('hostile accessor'); } });
  const observed = fixture({ executionFailure: { error: raw }, teardownFailure: { error: false },
    archiveCloseFailure: { error: null }, retirementFailure: { error: undefined } });
  let caught: unknown;
  try { await executeTrustedBootstrapSut(input, observed.ports); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ResourceCompositeSettlementError);
  expect(readResourceCompositeSettlementFailures(caught as ResourceCompositeSettlementError).map(failure => failure.error)).toEqual([raw, false, null, undefined]);
  expect(reads).toBe(0);
  expect(observed.calls.slice(-4)).toEqual(['bootstrap-execute', 'teardown', 'close', 'retire']);
});

test('TrustedBootstrap partial preparation still retires the owned transport', async () => {
  const observed = fixture({ preparationFailure: { error: null } });
  let caught: unknown = Symbol('not-thrown');
  try { await executeTrustedBootstrapSut(input, observed.ports); } catch (error) { caught = error; }
  expect(caught).toBeNull();
  expect(observed.calls.slice(-2)).toEqual(['prepare', 'retire']);
  expect(observed.calls).not.toContain('close');
});

test('TrustedBootstrap captures one pure subject before the first process await', async () => {
  const mutable = { ...input };
  const observed = fixture();
  const originalRun = observed.ports.run;
  observed.ports.run = async (plan, archive) => {
    mutable.headSha = 'e'.repeat(40);
    return originalRun(plan, archive);
  };
  await executeTrustedBootstrapSut(mutable, observed.ports);
  expect(JSON.parse(observed.members.get('sut-receipt.json') as string).headSha).toBe(input.headSha);
});

test('TrustedBootstrap rejects malformed identity before probe or evidence allocation', async () => {
  const observed = fixture();
  await expect(executeTrustedBootstrapSut({ ...input, headSha: 'invalid' }, observed.ports)).rejects.toThrow('input identity');
  expect(observed.calls).toEqual([]);
});
