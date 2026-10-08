import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const workflow = parseYaml(readFileSync(new URL('../../.github/workflows/merge-gate.yml', import.meta.url), 'utf8'));
const authorize = workflow.jobs.authorize;
const integrate = workflow.jobs.integrate;
const launcher = 'src/bootstrap/development/hosted-job-runtime.ts';
const recoveryMembers = [
  '${{ github.workspace }}/.tmp/codex/hosted-job/authorize/out/recovery/branch-closeout-recovery.json',
  '${{ github.workspace }}/.tmp/codex/hosted-job/authorize/out/recovery/integration-preflight-result-v2.json'
].join('\n');

function authorizeStep(id: string): { id?: string; run?: string; if?: string; with?: Record<string, unknown>;
  'continue-on-error'?: unknown } {
  const step = authorize.steps.find((candidate: { id?: string }) => candidate.id === id);
  if (step === undefined) throw new Error(`Authorize job has no ${id} step.`);
  return step;
}

test('authorize job runs only its two closed launcher phases around the fixed recovery upload', () => {
  const prepare = authorizeStep('prepare');
  const upload = authorizeStep('upload-recovery');
  const verify = authorizeStep('verify');
  expect(prepare.run).toBe(`exec bun --no-env-file ${launcher} --job authorize --phase prepare-integration-hosted`);
  expect(verify.run).toBe(`exec bun --no-env-file ${launcher} --job authorize --phase verify-integration-recovery`);
  expect(authorize.steps.indexOf(upload)).toBe(authorize.steps.indexOf(prepare) + 1);
  expect(authorize.steps.indexOf(verify)).toBe(authorize.steps.indexOf(upload) + 1);
  // A failed preparation fails the job, so the readback phase never runs without
  // a successful producer. A skipped upload is not a failed step: the readback
  // phase still runs and independently observes the recovery-absent lane.
  expect(prepare['continue-on-error']).toBeUndefined();
  expect(verify.if).toBeUndefined();
  expect(verify['continue-on-error']).toBeUndefined();
});

test('recovery upload identity is exactly the prepare projection member set', () => {
  const upload = authorizeStep('upload-recovery');
  expect(upload.if).toBe("${{ always() && !cancelled() && steps.prepare.outputs.recovery-ready == 'true' }}");
  expect(upload.with?.name).toBe('${{ steps.prepare.outputs.recovery-artifact-name }}');
  expect(upload.with?.path).toBe(recoveryMembers);
  expect(upload.with?.['if-no-files-found']).toBe('error');
  expect(upload.with?.['retention-days']).toBe(90);
  expect(upload.with?.['include-hidden-files']).toBe(true);
  expect(upload.with?.overwrite).toBe(false);
});

test('authorize outputs come only from the successful preparation step and cross-job consumers use them', () => {
  expect(authorize.outputs).toEqual({
    'recovery-artifact-name': '${{ steps.prepare.outputs.recovery-artifact-name }}',
    'integration-lane': '${{ steps.prepare.outputs.integration-lane }}',
    'head-sha': '${{ steps.prepare.outputs.head-sha }}',
    'preflight-result-digest': '${{ steps.prepare.outputs.preflight-result-digest }}',
    'ruleset-digest': '${{ steps.prepare.outputs.ruleset-digest }}'
  });
  const terminal = workflow.jobs['terminal-status'];
  expect(terminal.if).toBe("${{ needs.authorize.result == 'success' && needs.authorize.outputs.integration-lane == 'open-first-effect' }}");
  const download = integrate.steps.find((step: { id?: string }) => step.id === 'download-recovery');
  if (download === undefined) throw new Error('Integrate job has no download-recovery step.');
  expect(download.if).toBe("${{ needs.authorize.outputs.recovery-artifact-name != '' }}");
  expect(download.with.name).toBe('${{ needs.authorize.outputs.recovery-artifact-name }}');
  expect(download.with.path).toBe('${{ github.workspace }}/.tmp/codex/hosted-job/integrate/in/recovery');
});