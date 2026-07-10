import { expect, test } from 'bun:test';

import {
  buildCiContract,
  CI_VERIFICATION_CONTRACT_REVISION,
  CI_VERIFICATION_EXECUTION_MODEL
} from '../../platform/shared/ci-contract.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

function occurrenceCount(source: string, value: string): number {
  return source.split(value).length - 1;
}

test('active GitHub validation workflows execute fresh frozen heads once and retired legacy entry stays absent', async () => {
  const prWorkflow = await readCompilerFile('.github/workflows/compiler-pr-validation.yml');
  const releaseWorkflow = await readCompilerFile('.github/workflows/compiler-release-validation.yml');
  const verificationSource = await readCompilerFile('scripts/ci-verification.ts');
  const contract = buildCiContract();

  expect(contract.verificationContractRevision).toBe(CI_VERIFICATION_CONTRACT_REVISION);
  expect(contract.executionModel).toBe(CI_VERIFICATION_EXECUTION_MODEL);
  expect(contract.triggerLabels).toEqual(['run-full', 'run-quick']);
  expect(contract.prWorkflowCommands.filter((command) => !prWorkflow.includes(command))).toEqual([]);
  expect(contract.releaseWorkflowCommands.filter((command) => !releaseWorkflow.includes(command))).toEqual([]);

  expect(prWorkflow).toContain('contents: read');
  expect(prWorkflow).toContain('statuses: write');
  expect(prWorkflow).toContain('github.event.pull_request.base.sha');
  expect(prWorkflow).toContain('github.event.pull_request.head.sha');
  expect(prWorkflow).toContain("github.event.label.name == 'run-quick' || github.event.label.name == 'run-full'");
  expect(prWorkflow).toContain('Validate current base freshness and dedupe verification key');
  expect(prWorkflow).toContain('compareCommitsWithBasehead');
  expect(prWorkflow).toContain('basehead: `${baseSha}...${headSha}`');
  expect(prWorkflow).toContain('comparison.behind_by !== 0');
  expect(prWorkflow).toContain('update the branch before verification');
  expect(prWorkflow).toContain('listCommitStatusesForRef');
  expect(prWorkflow).toContain('sec-verification/${profile}/ci-verification-v2/base-${baseSha}');
  expect(prWorkflow).toContain("status.context === statusContext && status.state === 'success'");
  expect(prWorkflow).toContain("core.setOutput('skip', trustedSuccess ? 'true' : 'false')");
  expect(prWorkflow).toContain("if: steps.verification.outputs.skip != 'true'\n        uses: actions/checkout@v5");
  expect(prWorkflow).toContain('ref: ${{ github.event.pull_request.head.sha }}');
  expect(prWorkflow).toContain('id: evidence');
  expect(prWorkflow).toContain('actions/upload-artifact@v4');
  expect(prWorkflow).toContain('.tmp/ci-verification-evidence.json');
  expect(prWorkflow).toContain('retention-days: 7');
  expect(prWorkflow).toContain('EVIDENCE_OUTCOME: ${{ steps.evidence.outcome }}');
  expect(prWorkflow).toContain("process.env.VERIFY_OUTCOME === 'success' && process.env.EVIDENCE_OUTCOME === 'success'");
  expect(prWorkflow).toContain('base-${process.env.VERIFY_BASE}');
  expect(prWorkflow).toContain("steps.verify.outcome != 'success' || steps.evidence.outcome != 'success'");
  expect(prWorkflow).not.toContain('- opened');
  expect(prWorkflow).not.toContain('- synchronize');
  expect(prWorkflow).not.toContain('- reopened');
  expect(prWorkflow).not.toContain('- ready_for_review');
  expect(prWorkflow).not.toContain('branches:\n      - main');
  expect(prWorkflow).not.toContain('contents: write');
  expect(prWorkflow).not.toContain('imports:organize');
  expect(occurrenceCount(prWorkflow, 'runs-on: ubuntu-latest')).toBe(1);
  expect(occurrenceCount(prWorkflow, 'bun install --frozen-lockfile')).toBe(1);

  expect(releaseWorkflow).toContain('contents: read');
  expect(releaseWorkflow).toContain('statuses: write');
  expect(releaseWorkflow).toContain('workflow_dispatch:');
  expect(releaseWorkflow).toContain('workflow_call:');
  expect(releaseWorkflow).toContain('Resolve and dedupe exact full verification key');
  expect(releaseWorkflow).toContain('getCommit');
  expect(releaseWorkflow).toContain('listCommitStatusesForRef');
  expect(releaseWorkflow).toContain("status.context === statusContext && status.state === 'success'");
  expect(releaseWorkflow).toContain("core.setOutput('sha', headSha)");
  expect(releaseWorkflow).toContain("core.setOutput('skip', trustedSuccess ? 'true' : 'false')");
  expect(releaseWorkflow).toContain("if: steps.verification.outputs.skip != 'true'\n        uses: actions/checkout@v5");
  expect(releaseWorkflow).toContain('ref: ${{ steps.verification.outputs.sha }}');
  expect(releaseWorkflow).toContain('--profile full');
  expect(releaseWorkflow).toContain('id: evidence');
  expect(releaseWorkflow).toContain('actions/upload-artifact@v4');
  expect(releaseWorkflow).toContain('.tmp/ci-verification-evidence.json');
  expect(releaseWorkflow).toContain('retention-days: 7');
  expect(releaseWorkflow).toContain('EVIDENCE_OUTCOME: ${{ steps.evidence.outcome }}');
  expect(releaseWorkflow).toContain("process.env.VERIFY_OUTCOME === 'success' && process.env.EVIDENCE_OUTCOME === 'success'");
  expect(releaseWorkflow).toContain("steps.verify.outcome != 'success' || steps.evidence.outcome != 'success'");
  expect(releaseWorkflow).toContain('sec-verification/full/ci-verification-v2');
  expect(releaseWorkflow).not.toContain('pull_request:');
  expect(releaseWorkflow).not.toContain('schedule:');
  expect(releaseWorkflow).not.toContain('cron:');
  expect(releaseWorkflow).not.toContain('strategy:');
  expect(releaseWorkflow).not.toContain('matrix:');
  expect(releaseWorkflow).not.toContain('contents: write');
  expect(releaseWorkflow).not.toContain('imports:organize');
  expect(occurrenceCount(releaseWorkflow, 'runs-on: ubuntu-latest')).toBe(1);
  expect(occurrenceCount(releaseWorkflow, 'bun install --frozen-lockfile')).toBe(1);

  expect(verificationSource).toContain('CI_VERIFICATION_CONTRACT_REVISION');
  expect(verificationSource).toContain('VERIFICATION_EVIDENCE_PATH');
  expect(verificationSource).toContain('writeEvidence({');
  expect(verificationSource).toContain('failedGate: result.id');
  expect(verificationSource).toContain('assertExpectedHead(headSha)');
  expect(verificationSource).toContain('files.some(isVerificationInfrastructureFile)');
  expect(verificationSource).toContain('full-fast-verification-infrastructure');
  expect(verificationSource).toContain("args: ['scripts/ci-pr-risk.ts', '--all-slow']");
  expect(verificationSource).toContain("args: ['run', 'sec', '--', 'verify', '--lane', 'all', '--json', '--compact']");
  expect(verificationSource).toContain("args: ['run', 'sec', '--', 'reference', 'check', '--json', '--compact']");

  await expect(readCompilerFile('.github/workflows/compiler-validation.yml')).rejects.toMatchObject({
    code: 'ENOENT'
  });
});
