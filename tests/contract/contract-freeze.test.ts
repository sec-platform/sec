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
    'tests/contract/test-architecture.test.ts'
  ]));
  expect(contract.targetFiles).not.toContain('tests/contract/contracts.test.ts');
  expect(contract.targets.every((target) => target.testNamePattern)).toBe(true);

  expect(formatted).toContain('Contract freeze active');
  expect(formatted).toContain(`Command: ${contract.command}`);
  expect(formatted).toContain(`Target files: ${contract.targetFileCount}`);
  expect(formatted).toContain('Target tests/contract/contract-freeze.test.ts; command=bun test tests/contract/contract-freeze.test.ts --test-name-pattern');
  expect(formatted).toContain('Target tests/contract/ci-contract.test.ts; command=bun test tests/contract/ci-contract.test.ts --test-name-pattern');

  const runnerInvocations = buildContractFreezeRunnerInvocations(contract.targets);
  expect(runnerInvocations).toHaveLength(1);
  const runnerInvocation = runnerInvocations[0];
  expect(runnerInvocation).toBeDefined();
  if (!runnerInvocation) throw new Error('Missing contract-freeze runner invocation');
  expect(runnerInvocation.files).toEqual(contract.targetFiles);
  const runnerPattern = runnerInvocation.testNamePattern;
  if (!runnerPattern) throw new Error('Missing contract-freeze runner pattern');
  expect(runnerInvocation.args).toEqual([
    'test',
    ...contract.targetFiles,
    '--test-name-pattern',
    runnerPattern
  ]);
  expect(runnerPattern).toContain('CLI exposes contract freeze target list as text and JSON contracts');
  expect(runnerPattern).toContain('CI contract keeps PR lanes fast and full lane complete');
  expect(runnerPattern).toContain('test architecture exposes only canonical testkit primitives');
  expect(runnerPattern).toContain('root package exposes only canonical test entry scripts');
  expect(runnerPattern).not.toContain('v0.1 pipeline runs end to end in a temporary workspace');
  expect(JSON.stringify(contract)).not.toContain('\n');

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'freeze'], {
      text: [
        'Contract freeze active',
        `Command: ${contract.command}`,
        `Runner command: ${contract.runnerCommand}`,
        `Target files: ${contract.targetFileCount}`,
        `Target file list: ${contract.targetFiles.join(', ')}`,
        'Target tests/contract/contract-freeze.test.ts; command=bun test tests/contract/contract-freeze.test.ts --test-name-pattern',
        'Target tests/contract/ci-contract.test.ts; command=bun test tests/contract/ci-contract.test.ts --test-name-pattern'
      ],
      json: {
        status: 'active',
        command: contract.command,
        runnerCommand: contract.runnerCommand,
        targetFileCount: contract.targetFileCount,
        targetFiles: contract.targetFiles,
        targetCount: contract.targetCount
      },
      compactJson: {
        status: 'active',
        runnerCommand: contract.runnerCommand,
        targetFileCount: contract.targetFileCount,
        targetCount: contract.targetCount
      }
    });
  });
});
