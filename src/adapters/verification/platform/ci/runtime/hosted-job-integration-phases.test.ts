import { describe, expect, test } from 'bun:test';
import type { AuthenticatedGitHubJobOrigin } from '../../../../providers/github-api/hosted-job-origin.ts';
import { assertHostedIntegrationRecoveryReadback, parseHostedIntegrationRecoveryChannels, verifyHostedIntegrationRecovery } from './hosted-job-integration-recovery.ts';

const origin = Object.freeze({ repository: 'sec-platform/sec', repositoryId: '5', runId: '6', runAttempt: 2,
  workflowSha: '1'.repeat(40), trustedSourceSha: '1'.repeat(40), jobId: '7', stepNumber: 9,
  stepName: 'Read back exact branch closeout recovery artifact' });
function fixture() {
  return { origin, observedAtUnixMs: Date.parse('2026-10-03T20:00:05Z'), artifactId: '8', artifactName: 'exact-recovery', archiveDigest: `sha256:${'a'.repeat(64)}`,
    artifact: { id: 8, name: 'exact-recovery', digest: `sha256:${'a'.repeat(64)}`, expired: false, size_in_bytes: 128,
      created_at: '2026-10-03T20:00:02Z', updated_at: '2026-10-03T20:00:02Z', workflow_run: { id: 6, head_sha: origin.workflowSha } },
    run: { id: 6, run_attempt: 2, status: 'in_progress', conclusion: null, path: '.github/workflows/merge-gate.yml', head_sha: origin.workflowSha,
      repository: { id: 5, full_name: origin.repository } },
    job: { id: 7, run_id: 6, started_at: '2026-10-03T20:00:00Z', run_attempt: 2, head_sha: origin.workflowSha, name: 'authorize', status: 'in_progress', conclusion: null,
      steps: [{ number: 8, name: 'Upload exact branch closeout recovery artifact', status: 'completed', conclusion: 'success',
        started_at: '2026-10-03T20:00:01Z', completed_at: '2026-10-03T20:00:03Z' },
      { number: 9, name: origin.stepName, status: 'in_progress', conclusion: null, started_at: '2026-10-03T20:00:04Z' }] } };
}

describe('hosted integration recovery exact readback', () => {
  test('consumes the original bare Session digest output and fixed native upload channels', () => {
    const session = 'c'.repeat(64);
    const artifactName = `sec-branch-closeout-recovery-v1-pr-17-session-${session}-run-6-attempt-2`;
    const needs = { plan: { result: 'success', outputs: { 'pr-number': '17', 'session-revision': session, 'base-sha': origin.trustedSourceSha } } };
    const steps = { prepare: { outcome: 'success', outputs: { 'integration-lane': 'open-first-effect', 'recovery-artifact-name': artifactName } },
      'upload-recovery': { outcome: 'success', outputs: { 'artifact-id': '8', 'artifact-digest': 'a'.repeat(64) } } };
    const parse = (n = needs, st = steps) => parseHostedIntegrationRecoveryChannels({ origin, needsJson: JSON.stringify(n), stepsJson: JSON.stringify(st) });
    expect(parse()).toEqual({ artifactId: '8', artifactName, digest: `sha256:${'a'.repeat(64)}` });
    expect(() => parse({ plan: { ...needs.plan, outputs: { ...needs.plan.outputs, 'session-revision': `sha256:${session}` } } })).toThrow();
    expect(() => parse(needs, { ...steps, prepare: { ...steps.prepare, outputs: { ...steps.prepare.outputs, 'recovery-artifact-name': 'foreign' } } })).toThrow();
    expect(() => parse({ plan: { ...needs.plan, result: 'failure' } })).toThrow();
    expect(() => parse(needs, { ...steps, prepare: { ...steps.prepare, outcome: 'failure' } })).toThrow();
    expect(() => parse(needs, { ...steps, 'upload-recovery': { ...steps['upload-recovery'], outcome: 'failure' } })).toThrow();
  });
  test('accepts the exact successful upload in the current authenticated job attempt', () => {
    expect(() => assertHostedIntegrationRecoveryReadback(fixture())).not.toThrow();
  });
  test('rejects changed artifact, repository, run, attempt, source, expiry and bounds', () => {
    for (const change of [{ id: 9 }, { id: [8] }, { id: '8' }, { name: 'foreign' }, { digest: `sha256:${'b'.repeat(64)}` }, { expired: true },
      { size_in_bytes: 0 }, { size_in_bytes: 32 * 1024 * 1024 + 1 }, { workflow_run: { id: 9, head_sha: origin.workflowSha } },
      { workflow_run: { id: 6, head_sha: '2'.repeat(40) } }]) {
      const value = fixture(); expect(() => assertHostedIntegrationRecoveryReadback({ ...value, artifact: { ...value.artifact, ...change } })).toThrow();
    }
    for (const change of [{ id: 9 }, { run_attempt: 1 }, { status: 'completed' }, { conclusion: 'failure' }, { path: '.github/workflows/foreign.yml' },
      { head_sha: '2'.repeat(40) }, { repository: { id: 8, full_name: origin.repository } }]) {
      const value = fixture(); expect(() => assertHostedIntegrationRecoveryReadback({ ...value, run: { ...value.run, ...change } })).toThrow();
    }
  });
  test('rejects missing, duplicated, failed, reordered or different producer steps', () => {
    const valid = fixture();
    for (const steps of [[], [...valid.job.steps, valid.job.steps[0]], [valid.job.steps[1]],
      [{ ...valid.job.steps[0], conclusion: 'failure' }, valid.job.steps[1]],
      [{ ...valid.job.steps[0], number: 10 }, valid.job.steps[1]],
      [valid.job.steps[0], { ...valid.job.steps[1], status: 'completed' }]]) {
      expect(() => assertHostedIntegrationRecoveryReadback({ ...valid, job: { ...valid.job, steps } })).toThrow();
    }
    expect(() => assertHostedIntegrationRecoveryReadback({ ...valid, observedAtUnixMs: Date.parse('2026-10-03T20:00:03Z') })).toThrow();
    expect(() => assertHostedIntegrationRecoveryReadback({ ...valid, artifact: { ...valid.artifact, updated_at: '2026-10-03T20:00:04Z' } })).toThrow();
    for (const created_at of ['2026-10-03T20:00:00Z', '2026-10-03T20:00:04Z', 'invalid']) {
      expect(() => assertHostedIntegrationRecoveryReadback({ ...valid, artifact: { ...valid.artifact, created_at } })).toThrow();
    }
  });
  test('a copied observation cannot impersonate a genuine origin or inspect caller channels', async () => {
    let inspected = 0;
    const nativeChannels = { get needsJson(): string { inspected += 1; throw new Error('untrusted'); }, get stepsJson(): string { inspected += 1; throw new Error('untrusted'); } };
    await expect(verifyHostedIntegrationRecovery({ origin: {} as AuthenticatedGitHubJobOrigin, nativeChannels })).rejects.toThrow();
    expect(inspected).toBe(0);
    await expect(verifyHostedIntegrationRecovery({ origin: origin as unknown as AuthenticatedGitHubJobOrigin,
      nativeChannels: { needsJson: '{}', stepsJson: '{}' } })).rejects.toThrow();
  });
});
