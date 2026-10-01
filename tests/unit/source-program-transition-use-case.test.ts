import { expect, test } from 'bun:test';
import { observeSourceTransitionReadView } from '../../src/adapters/self-hosting/control/agent/source-transition-read-view.ts';
import {
  runSourceProgramTransition,
  type SourceProgramTransitionIntegrationPorts
} from '../../src/application/source-program-transition.ts';
import { runSourceProgramTransitionCli } from '../../src/entry/cli/source-program-transition.ts';

const request = Object.freeze({ purpose: 'integrate' as const, candidateRoot: '/fixture', baseSha: 'base', headSha: 'head' });
const control = Object.freeze({ deadlineAtUnixMs: 123_456 });
const facts = Object.freeze({ status: 'conditional', value: 'exact-source-fixture' });
type Facts = typeof facts;
type Ports = SourceProgramTransitionIntegrationPorts<Facts, string, string, string, string>;
function bindings(events: string[]): Ports {
  return {
    acquireFacts: async (input, admitted) => {
      expect(input).toEqual(request); expect(admitted.deadlineAtUnixMs).toBe(control.deadlineAtUnixMs);
      events.push('facts'); return { kind: 'complete', facts, acquisition: 'executed' };
    },
    assertFactsQualified: value => { expect(value).toBe(facts); events.push('qualified'); },
    observeAuthor: async () => { events.push('author'); return 'current-approval'; },
    adopt: (value, approval) => { expect(value).toBe(facts); expect(approval).toBe('current-approval'); events.push('adopt'); return { kind: 'accepted', adoption: 'qualified-adoption' }; },
    runVerification: async (_input, admitted, source) => {
      expect(admitted.deadlineAtUnixMs).toBe(control.deadlineAtUnixMs);
      const acquired = await source; expect(acquired.kind).toBe('complete');
      events.push('verification'); return { kind: 'satisfied', verification: 'independent-result' };
    },
    reobserve: async () => { events.push('reobserve'); },
    finalize: (_value, adoption, verification) => {
      expect(adoption).toBe('qualified-adoption'); expect(verification).toBe('independent-result');
      events.push('finalize'); return 'accepted-result';
    }
  };
}

// These capabilities are ordinary fixtures for business control. Their values
// do not impersonate the physical producer/qualification brands tested at CI.
test('source use case joins its exact source and independent result before reobservation and acceptance', async () => {
  const events: string[] = [];
  const outcome = await runSourceProgramTransition(request, control, bindings(events));
  expect(outcome.status).toBe('accepted'); expect(outcome.accepted).toBe('accepted-result');
  expect(events.indexOf('qualified')).toBeLessThan(events.indexOf('adopt'));
  expect(events.indexOf('verification')).toBeLessThan(events.indexOf('reobserve'));
  expect(events.slice(-2)).toEqual(['reobserve', 'finalize']);
  expect(outcome.failures).toEqual([]);
});

test('source use case preserves Needs and blocked decisions without publishing an adoption', async () => {
  for (const decision of [{ kind: 'needs-author' as const, needs: ['exact affected owner judgment'], blockers: ['unknown-input'] },
    { kind: 'blocked' as const, blockers: ['independent-source-defect'] }]) {
    const events: string[] = [];
    const ports = bindings(events); ports.adopt = () => decision;
    const outcome = await runSourceProgramTransition(request, control, ports);
    expect(outcome.status).toBe(decision.kind); expect(outcome.decision).toBe(decision);
    expect(outcome.source?.kind).toBe('complete'); expect(outcome.verification?.kind).toBe('satisfied');
    expect(outcome.accepted).toBeNull(); expect(events).not.toContain('finalize');
  }
});

test('source use case waits for independent settlement and preserves both owner failures', async () => {
  let settle!: () => void;
  const ownerSettled = new Promise<void>(resolve => { settle = resolve; });
  const sourceFailure = new Error('source-failure');
  const verificationFailure = new Error('verification-settlement-failure');
  const ports = bindings([]);
  ports.acquireFacts = async () => { throw sourceFailure; };
  ports.runVerification = async () => { await ownerSettled; throw verificationFailure; };
  let returned = false;
  const running = runSourceProgramTransition(request, control, ports).then(result => { returned = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  expect(returned).toBe(false);
  settle();
  const outcome = await running;
  expect(outcome.status).toBe('failed');
  expect(outcome.failures.map(failure => failure.cause)).toEqual([sourceFailure, verificationFailure]);
  expect(outcome.accepted).toBeNull();
});

test('source use case cancels before starting owners and refuses drift before final publication', async () => {
  const controller = new AbortController(); controller.abort();
  const events: string[] = [];
  expect((await runSourceProgramTransition(request, { ...control, signal: controller.signal }, bindings(events))).status).toBe('cancelled');
  expect(events).toEqual([]);
  const ports = bindings(events); const drift = new Error('current author changed');
  ports.reobserve = async () => { throw drift; };
  const result = await runSourceProgramTransition(request, control, ports);
  expect(result.status).toBe('failed'); expect(result.failures[0]?.cause).toBe(drift);
  expect(events).not.toContain('finalize');
});

test('source CLI observes completed conditional facts through the shared entry without adopting them', async () => {
  const output: string[] = [];
  await runSourceProgramTransitionCli([], {
    prepare: async () => ({ request: { ...request, purpose: 'inspect' }, control,
      ports: { acquireFacts: async () => ({ kind: 'complete', facts, acquisition: 'executed' }) } }),
    encode: value => JSON.stringify(value), write: value => { output.push(value); }
  });
  expect(output).toEqual(['{"status":"conditional","value":"exact-source-fixture"}']);
});

test('source Read Plan view derives dispatch and port data while preserving unobserved authority', async () => {
  const view = await observeSourceTransitionReadView(new URL('../..', import.meta.url).pathname) as {
    authority: string; readPlanDigest: unknown; unresolvedFrontier: string[];
    control: { value: { afterAdoption: unknown } }; steps: { port: string; inputs: string[]; declaredOwnerContract: string }[];
  };
  expect(view.authority).toBe('none'); expect(view.readPlanDigest).toBeNull();
  expect(view.control.value.afterAdoption).toEqual({ accepted: 'join-verification', 'needs-author': 'needs-author', blocked: 'blocked' });
  expect(view.steps.map(step => step.port)).toEqual(['acquireFacts', 'assertFactsQualified', 'observeAuthor', 'adopt', 'runVerification', 'reobserve', 'finalize']);
  expect(view.steps.find(step => step.port === 'runVerification')?.inputs[2]).toContain('Promise<SourceProgramTransitionFacts<Facts>>');
  expect(view.steps.every(step => step.declaredOwnerContract.length > 0)).toBe(true);
  expect(view.unresolvedFrontier.length).toBeGreaterThan(0);
});
