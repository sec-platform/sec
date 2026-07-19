import { expect, test } from 'bun:test';

import {
  buildContractFreezeContract,
  buildContractFreezeRunnerInvocations,
  formatContractFreezeContract
} from '../../platform/shared/contract-freeze-contract.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import { expectContractFreezeSelfConsistent } from '../testkit/contracts.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI exposes contract freeze target list as text and JSON contracts', async () => {
  const contract = buildContractFreezeContract();
  const formatted = formatContractFreezeContract(contract);

  expectContractFreezeSelfConsistent(contract);
  expect(contract.targetFiles).toEqual(expect.arrayContaining([
    'tests/contract/benchmark-budget.test.ts',
    'tests/contract/ci-contract.test.ts',
    'tests/contract/contract-freeze.test.ts',
    'tests/contract/error-protocol.test.ts',
    'tests/contract/fact-delta-contract.test.ts',
    'tests/contract/impact-propagation-contract.test.ts',
    'tests/contract/semantic-mutation-contract.test.ts',
    'tests/contract/semantic-mutation-apply-contract.test.ts',
    'tests/contract/semantic-mutation-source-adapter-contract.test.ts',
    'tests/contract/test-architecture.test.ts',
    'tests/contract/test-impact.test.ts'
  ]));
  expect(contract.targetFiles).not.toContain('tests/contract/contracts.test.ts');
  expect(contract.targets.map((target) => target.contractId)).toEqual(expect.arrayContaining([
    'verification.contract-freeze',
    'verification.ci-workflow',
    'verification.impact',
    'semantic.fact-delta',
    'semantic.impact-propagation',
    'semantic.mutation',
    'semantic.mutation-source-adapter',
    'semantic.mutation-apply'
  ]));
  expect(contract.contractIds).toEqual([...contract.targets.map((target) => target.contractId)].sort());

  expect(formatted).toContain('Contract freeze active');
  expect(formatted).toContain(`Command: ${contract.command}`);
  expect(formatted).toContain(`Target files: ${contract.targetFileCount}`);
  expect(formatted).toContain(`Contract IDs: ${contract.contractIdCount}`);
  expect(formatted).toContain('Target verification.contract-freeze; file=tests/contract/contract-freeze.test.ts; command=bun test tests/contract/contract-freeze.test.ts');
  expect(formatted).toContain('Target verification.ci-workflow; file=tests/contract/ci-contract.test.ts; command=bun test tests/contract/ci-contract.test.ts');
  expect(formatted).toContain('Target semantic.mutation; file=tests/contract/semantic-mutation-contract.test.ts; command=bun test tests/contract/semantic-mutation-contract.test.ts');
  expect(formatted).toContain('Target semantic.mutation-source-adapter; file=tests/contract/semantic-mutation-source-adapter-contract.test.ts; command=bun test tests/contract/semantic-mutation-source-adapter-contract.test.ts');
  expect(formatted).toContain('Target semantic.mutation-apply; file=tests/contract/semantic-mutation-apply-contract.test.ts; command=bun test tests/contract/semantic-mutation-apply-contract.test.ts');

  const runnerInvocations = buildContractFreezeRunnerInvocations(contract.targets);
  expect(runnerInvocations).toHaveLength(1);
  const runnerInvocation = runnerInvocations[0];
  expect(runnerInvocation).toBeDefined();
  if (!runnerInvocation) throw new Error('Missing contract-freeze runner invocation');
  expect(runnerInvocation.files).toEqual(contract.targetFiles);
  expect(runnerInvocation.args).toEqual([
    'test',
    ...contract.targetFiles,
    '--timeout',
    '180000'
  ]);
  expect(JSON.stringify(contract)).not.toContain('testNamePattern');
  expect(JSON.stringify(contract)).not.toContain('--test-name-pattern');
  expect(JSON.stringify(contract)).not.toContain('\n');

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'freeze'], {
      text: [
        'Contract freeze active',
        `Command: ${contract.command}`,
        `Runner command: ${contract.runnerCommand}`,
        `Contract IDs: ${contract.contractIdCount}`,
        `Contract ID list: ${contract.contractIds.join(', ')}`,
        `Target files: ${contract.targetFileCount}`,
        `Target file list: ${contract.targetFiles.join(', ')}`,
        'Target verification.contract-freeze; file=tests/contract/contract-freeze.test.ts; command=bun test tests/contract/contract-freeze.test.ts',
        'Target verification.ci-workflow; file=tests/contract/ci-contract.test.ts; command=bun test tests/contract/ci-contract.test.ts',
        'Target semantic.mutation; file=tests/contract/semantic-mutation-contract.test.ts; command=bun test tests/contract/semantic-mutation-contract.test.ts'
      ],
      json: {
        status: 'active',
        command: contract.command,
        runnerCommand: contract.runnerCommand,
        contractIdCount: contract.contractIdCount,
        contractIds: contract.contractIds,
        targetFileCount: contract.targetFileCount,
        targetFiles: contract.targetFiles,
        targetCount: contract.targetCount
      },
      compactJson: {
        status: 'active',
        runnerCommand: contract.runnerCommand,
        contractIdCount: contract.contractIdCount,
        targetFileCount: contract.targetFileCount,
        targetCount: contract.targetCount
      }
    });
  });
});
