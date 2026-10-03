import { expect, test } from 'bun:test';
import { parseHostedResumeDispatchSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import type { AuthenticatedGitHubJobOrigin } from '../../src/adapters/providers/github-api/hosted-job-origin.ts';
import { dispatchAuthenticatedHostedJobResume, executeGitHubApiOperation, withGitHubApiVerificationSession } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, withGitHubApiTestSession } from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const digest = `sha256:${'a'.repeat(64)}`;
function wire() {
  // Lower wire projection fixture only: CI independently validates the complete
  // original Action envelope and human authorization; no live grant is minted.
  const completedAction = { providerEnvelope: { schema: 'fixture-original-action-envelope' },
    runId: '21', runAttempt: 1, terminalArtifactId: '31', terminalArtifactName: 'sec-verification-action-fixture',
    terminalArchiveDigest: digest, terminalPayloadDigest: digest };
  const emitter = { repositoryId: '1', repository: 'sec-platform/sec', workflowPath: '.github/workflows/merge-gate.yml',
    workflowSha: 'b'.repeat(40), runId: '41', runAttempt: 1, jobId: '42', checkRunId: '43', policyJobId: 'integrate',
    phase: 'resume-verification-session', stepName: 'Resume canonical verification Session', stepNumber: 6 };
  const content = { schema: 'sec-verification-session-resume-signal-v1',
    wakeKey: sha256({ schema: 'sec-verification-session-wake-key-v1', completedAction }), completedAction, emitter };
  return { ...content, signalDigest: sha256(content) };
}
function rehash(value: ReturnType<typeof wire>) {
  const { signalDigest: _old, ...content } = value;
  return { ...content, signalDigest: sha256(content) };
}

test('fixed resume wire retains stable work identity separately from the actual emitter', () => {
  const first = wire();
  const next = rehash({ ...first, emitter: { ...first.emitter, runId: '45', jobId: '46', checkRunId: '47' } });
  expect(parseHostedResumeDispatchSignal(JSON.stringify(first)).wakeKey).toBe(next.wakeKey);
  expect(parseHostedResumeDispatchSignal(JSON.stringify(next)).signalDigest).not.toBe(first.signalDigest);
  expect(Object.isFrozen(parseHostedResumeDispatchSignal(JSON.stringify(first)).emitter)).toBe(true);
});

test('resume wire rejects duplicate, extension, wrong phase, rerun, digest and unbounded input', () => {
  const first = wire();
  for (const emitter of [{ ...first.emitter, runAttempt: 2 }, { ...first.emitter, policyJobId: 'authorize' },
    { ...first.emitter, phase: 'integrate-hosted' }, { ...first.emitter, stepName: 'Arbitrary caller phase' },
    { ...first.emitter, workflowPath: '.github/workflows/compiler-pr-validation.yml' },
    { ...first.emitter, jobId: '0' }, { ...first.emitter, stepNumber: 0 }]) {
    expect(() => parseHostedResumeDispatchSignal(JSON.stringify(rehash({ ...first, emitter })))).toThrow();
  }
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify({ ...first, event_type: 'arbitrary' }))).toThrow();
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify({ ...first, wakeKey: `sha256:${'f'.repeat(64)}` }))).toThrow();
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify(first).replace('"runId":"41"', '"runId":"41","runId":"41"'))).toThrow();
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify(first).replace('"emitter":', `"emitter":${JSON.stringify(first.emitter)},"emitter":`))).toThrow();
  expect(() => parseHostedResumeDispatchSignal(JSON.stringify({ ...first, emitter: { ...first.emitter, jobId: '99' } }))).toThrow();
  expect(() => parseHostedResumeDispatchSignal(' '.repeat(32 * 1024 + 1))).toThrow();
});

test('plain signed-looking wire and forged origin cannot reach a credential or transport', async () => {
  let touched = false;
  await expect(dispatchAuthenticatedHostedJobResume({ origin: {} as AuthenticatedGitHubJobOrigin,
    get signalSource() { touched = true; return JSON.stringify(wire()); } })).rejects.toThrow();
  expect(touched).toBe(false);
});

test('test capabilities and generic verification effects cannot acquire the new workflow write grant', async () => {
  let requests = 0;
  for (const effect of ['verification-read', 'verification-dispatch', 'verification-resume-dispatch'] as const) {
    const capability = issueGitHubApiTestCapability({ repository: 'sec-platform/sec', effect, token: 'fixture-no-secret',
      principal: { transport: 'github-actions-token', login: 'github-actions[bot]', nodeId: 'MDM6Qm90NDE4OTgyODI=',
        userId: 41898282, permission: 'workflow', workflowRef: 'sec-platform/sec/.github/workflows/merge-gate.yml@refs/heads/main',
        workflowSha: 'b'.repeat(40) }, transport: async () => { requests += 1; return new Response(null, { status: 204 }); } });
    await expect(withGitHubApiTestSession({ capability, operation: async () => await executeGitHubApiOperation(capability,
      { kind: 'verification-resume-dispatch', signalSource: JSON.stringify(wire()) }) })).rejects.toThrow();
  }
  expect(requests).toBe(0);
});

test('the generic production verification entry does not accept the dedicated resume effect', async () => {
  let invoked = false;
  await expect(Reflect.apply(withGitHubApiVerificationSession, undefined, [{
    repositoryRoot: '/not-opened', repository: 'sec-platform/sec', effect: 'verification-resume-dispatch',
    operation: async () => { invoked = true; }
  }])).rejects.toThrow('Verification session effect is invalid');
  expect(invoked).toBe(false);
});

test('workflow run history is a closed unfiltered read on the exact workflow numeric ID', async () => {
  const requests: string[] = [];
  const capability = issueGitHubApiTestCapability({repository:'sec-platform/sec',effect:'verification-read',token:'fixture-no-secret',
    principal:{transport:'github-rest-token',login:'fixture',nodeId:'FIXTURE',userId:1,permission:'maintain'},
    transport:async target=>{requests.push(String(target));return new Response('{"total_count":0,"workflow_runs":[]}');}});
  await withGitHubApiTestSession({capability,operation:async()=>{
    await executeGitHubApiOperation(capability,{kind:'verification-workflow-run-history',workflowId:'123',page:2});
    for(const workflowId of ['0','../runs','123?status=success']) await expect(executeGitHubApiOperation(capability,
      {kind:'verification-workflow-run-history',workflowId,page:1})).rejects.toThrow();
    await expect(executeGitHubApiOperation(capability,{kind:'verification-workflow-run-history',workflowId:'123',page:0})).rejects.toThrow();
  }});
  expect(requests).toEqual(['https://api.github.com/repos/sec-platform/sec/actions/workflows/123/runs?per_page=100&page=2']);
});

test('resume provenance reads exact attempt, suite, workflow and job through closed numeric selectors', async () => {
  const requests: string[] = [];
  const capability = issueGitHubApiTestCapability({repository:'sec-platform/sec',effect:'verification-read',token:'fixture-no-secret',
    principal:{transport:'github-rest-token',login:'fixture',nodeId:'FIXTURE',userId:1,permission:'maintain'},
    transport:async target=>{requests.push(String(target));return new Response('{}');}});
  await withGitHubApiTestSession({capability,operation:async()=>{
    await executeGitHubApiOperation(capability,{kind:'verification-workflow-run-attempt',runId:'11',runAttempt:2});
    await executeGitHubApiOperation(capability,{kind:'verification-check-suite',checkSuiteId:'12'});
    await executeGitHubApiOperation(capability,{kind:'verification-workflow',workflowId:'13'});
    await executeGitHubApiOperation(capability,{kind:'verification-workflow-job',jobId:'14'});
    for (const id of ['0','../escape','12?branch=main']) {
      await expect(executeGitHubApiOperation(capability,{kind:'verification-workflow-run-attempt',runId:id,runAttempt:1})).rejects.toThrow();
      await expect(executeGitHubApiOperation(capability,{kind:'verification-check-suite',checkSuiteId:id})).rejects.toThrow();
      await expect(executeGitHubApiOperation(capability,{kind:'verification-workflow',workflowId:id})).rejects.toThrow();
      await expect(executeGitHubApiOperation(capability,{kind:'verification-workflow-job',jobId:id})).rejects.toThrow();
    }
    await expect(executeGitHubApiOperation(capability,{kind:'verification-workflow-run-attempt',runId:'11',runAttempt:0})).rejects.toThrow();
  }});
  expect(requests).toEqual([
    'https://api.github.com/repos/sec-platform/sec/actions/runs/11/attempts/2',
    'https://api.github.com/repos/sec-platform/sec/check-suites/12',
    'https://api.github.com/repos/sec-platform/sec/actions/workflows/13',
    'https://api.github.com/repos/sec-platform/sec/actions/jobs/14']);
});
