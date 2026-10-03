import { expect, test } from 'bun:test';
import type { VerificationSessionGitHubClient } from '../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { assertHostedRecoveryArtifactProvenance, observeHostedIntegrationPrincipals } from '../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import type { GitHubActionsArtifactObservation } from '../../src/execution/verification/session.ts';

type GitHubPrincipalObservation = Awaited<ReturnType<VerificationSessionGitHubClient['observePrincipal']>>;

const base = '1'.repeat(40);
const metadata: GitHubActionsArtifactObservation = {
  artifactId: '30', artifactName: 'recovery', workflowPath: '.github/workflows/merge-gate.yml',
  workflowRef: `.github/workflows/merge-gate.yml@${base}`, workflowSha: base,
  runId: '20', runAttempt: 1, eventName: 'workflow_run', actorNodeId: 'INITIATOR',
  actorPermission: 'maintain', expired: false, archiveDigest: null
};
const producingRun = { id: 20, run_attempt: 1, event: 'workflow_run',
  path: '.github/workflows/merge-gate.yml', head_sha: base,
  actor: { login: 'initiator', node_id: 'INITIATOR' } };
const expected = { metadata, producingRun, baseSha: base, runId: '20', runAttempt: 1 };

test('recovery artifact binds its workflow_run producing attempt independently of App publication', () => {
  expect(() => assertHostedRecoveryArtifactProvenance(expected)).not.toThrow();
  expect(() => assertHostedRecoveryArtifactProvenance({ ...expected,
    metadata: { ...metadata, actorPermission: 'admin' } })).not.toThrow();
});

for (const [name, patch] of [
  ['compiler event', { eventName: 'repository_dispatch' }],
  ['foreign workflow', { workflowPath: '.github/workflows/foreign.yml' }],
  ['foreign revision', { workflowSha: '2'.repeat(40) }],
  ['other run', { runId: '21' }],
  ['other attempt', { runAttempt: 2 }],
  ['publisher substituted for initiator', { actorNodeId: 'MDM6Qm90NDE4OTgyODI=', actorPermission: 'none' }],
  ['write-only initiator', { actorPermission: 'write' }],
  ['expired archive', { expired: true }]
] as const) test(`recovery provenance rejects ${name}`, () => {
  expect(() => assertHostedRecoveryArtifactProvenance({ ...expected,
    metadata: { ...metadata, ...patch } })).toThrow('provenance drifted');
});

for (const [name, patch] of [
  ['event', { event: 'repository_dispatch' }], ['attempt', { run_attempt: 2 }],
  ['head', { head_sha: '2'.repeat(40) }], ['actor', { actor: { login: 'other', node_id: 'OTHER' } }]
] as const) test(`recovery provenance rejects producing-run ${name} drift`, () => {
  expect(() => assertHostedRecoveryArtifactProvenance({ ...expected,
    producingRun: { ...producingRun, ...patch } })).toThrow('provenance drifted');
});

function principals(permission: GitHubPrincipalObservation['permission'] = 'maintain') {
  const records: Record<string, GitHubPrincipalObservation> = {
    initiator: { login: 'initiator', nodeId: 'INITIATOR', permission: 'maintain' },
    rerunner: { login: 'rerunner', nodeId: 'RERUNNER', permission }
  };
  return {
    github: { observePrincipal: async (_repository: string, login: string) => {
      if (!Object.hasOwn(records, login)) throw new Error('Unknown fixture principal');
      return records[login]!;
    } },
    repository: 'sec-platform/sec',
    sourceRun: { actor: { login: 'initiator', node_id: 'INITIATOR' },
      triggering_actor: { login: 'initiator', node_id: 'INITIATOR' } },
    currentRun: { actor: { login: 'initiator', node_id: 'INITIATOR' },
      triggering_actor: { login: 'rerunner', node_id: 'RERUNNER' } },
    environment: { GITHUB_ACTOR: 'initiator', GITHUB_TRIGGERING_ACTOR: 'rerunner' }
  };
}

test('current rerun principal is checked independently while source initiator remains original', async () => {
  expect(await observeHostedIntegrationPrincipals(principals())).toEqual({
    sourceTriggeringActor: { login: 'initiator', nodeId: 'INITIATOR', permission: 'maintain' }
  });
  await expect(observeHostedIntegrationPrincipals(principals('write')))
    .rejects.toThrow('integrate-hosted triggering actor stable identity/live permission mismatch');
  await expect(observeHostedIntegrationPrincipals(principals('none'))).rejects.toThrow('permission mismatch');
});

test('current actor environment and API identity must agree before authority can proceed', async () => {
  const input = principals();
  await expect(observeHostedIntegrationPrincipals({ ...input,
    environment: { ...input.environment, GITHUB_TRIGGERING_ACTOR: 'initiator' } }))
    .rejects.toThrow('environment/API identity mismatch');
  await expect(observeHostedIntegrationPrincipals({ ...input,
    currentRun: { ...input.currentRun, triggering_actor: { login: 'rerunner', node_id: 'OTHER' } } }))
    .rejects.toThrow('stable identity/live permission mismatch');
  await expect(observeHostedIntegrationPrincipals({ ...input,
    sourceRun: { ...input.sourceRun, actor: { login: 'initiator', node_id: 'OTHER' } } }))
    .rejects.toThrow('source actor stable identity/live permission mismatch');
});
