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

test('active GitHub validation workflows execute frozen heads once and retired legacy entry stays absent', async () => {
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
  expect(prWorkflow).toContain('ref: ${{ github.event.pull_request.head.sha }}');
  expect(prWorkflow).toContain('sec-verification/${profile}/ci-verification-v2');
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
  expect(releaseWorkflow).toContain('--profile full');
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
