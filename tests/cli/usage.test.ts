import { test } from 'vitest';

import {
  ACCEPTANCE_USAGE,
  ADD_USAGE,
  ARTIFACTS_USAGE,
  BENCHMARK_USAGE,
  BLOCKS_USAGE,
  CONTRACT_USAGE,
  DOCTOR_USAGE,
  EXPLAIN_USAGE,
  INIT_USAGE,
  INSTALL_USAGE,
  LOCK_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  PROVENANCE_USAGE,
  REFERENCE_USAGE,
  REPAIR_USAGE,
  RESOLVE_USAGE,
  REVIEW_USAGE,
  RUNTIME_USAGE,
  TEST_USAGE,
  UPGRADE_USAGE,
  VERIFICATION_USAGE,
  VERIFY_USAGE,
  WORKBENCH_USAGE
} from '../../platform/cli/usage.ts';
import { expectCliText, expectCliUsageError, withTempWorkspace } from '../helpers/test-utils.ts';

type UsageArgs = [command: string, ...args: string[]];

type UsageErrorCase = {
  args: UsageArgs;
  usage: string;
};

function usageCases(usage: string, argsList: UsageArgs[]): UsageErrorCase[] {
  return argsList.map((args) => ({ args, usage }));
}

async function expectUsageErrors(workspaceRoot: string, cases: UsageErrorCase[]): Promise<void> {
  for (const { args: [command, ...args], usage } of cases) {
    await expectCliUsageError(workspaceRoot, command, args, usage);
  }
}

test('CLI prints usage for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    for (const args of [[], ['unknown'], ['unknown', '--flag']]) {
      await expectCliText(workspaceRoot, args, [
        'Usage: platform',
        'init',
        'resolve',
        'compose',
        'verify'
      ]);
    }
  });
});

test('CLI reports argument usage errors', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectUsageErrors(workspaceRoot, [
      ...usageCases(INIT_USAGE, [
        ['init', '--unknown'],
        ['init', '--reset', '--extra']
      ]),
      ...usageCases(ADD_USAGE, [
        ['add'],
        ['add', 'entity/customer-basic', '--extra']
      ]),
      ...usageCases(REPAIR_USAGE, [
        ['repair', '--extra'],
        ['repair', '--dry-run', '--extra'],
        ['repair', '--compact'],
        ['repair', '--json', '--compact', '--extra'],
        ['repair', 'plan', '--compact'],
        ['repair', 'plan', '--json', '--extra']
      ]),
      ...usageCases(UPGRADE_USAGE, [
        ['upgrade', 'entity/customer-basic'],
        ['upgrade', 'entity/customer-basic', '0.2.0', '--extra'],
        ['upgrade', 'entity/customer-basic', '0.2.0', '--dry-run', '--extra'],
        ['upgrade', 'entity/customer-basic', '0.2.0', '--compact'],
        ['upgrade', 'entity/customer-basic', '0.2.0', '--json', '--compact', '--extra'],
        ['upgrade', 'plan', '--compact'],
        ['upgrade', 'plan', '--extra'],
        ['upgrade', 'plan', '--json', '--compact', '--extra'],
        ['upgrade', 'diagnostics', '--compact'],
        ['upgrade', 'diagnostics', '--extra'],
        ['upgrade', 'diagnostics', '--json', '--compact', '--extra']
      ]),
      ...usageCases(EXPLAIN_USAGE, [
        ['explain', '--extra'],
        ['explain', '--compact'],
        ['explain', '--json', '--extra']
      ]),
      ...usageCases(ARTIFACTS_USAGE, [
        ['artifacts'],
        ['artifacts', '--compact'],
        ['artifacts', '--paths', '--extra'],
        ['artifacts', '--json', '--extra'],
        ['artifacts', '--paths', '--compact'],
        ['artifacts', 'manifest', '--compact'],
        ['artifacts', 'manifest', '--extra'],
        ['artifacts', 'manifest', '--json', '--compact', '--extra']
      ]),
      ...usageCases(DOCTOR_USAGE, [
        ['doctor', '--extra'],
        ['doctor', '--compact'],
        ['doctor', '--json', '--extra']
      ]),
      ...usageCases(REFERENCE_USAGE, [
        ['reference'],
        ['reference', 'check', '--compact'],
        ['reference', 'status']
      ]),
      ...usageCases(BENCHMARK_USAGE, [
        ['benchmark'],
        ['benchmark', 'suite', '--compact'],
        ['benchmark', 'status']
      ]),
      ...usageCases(TEST_USAGE, [
        ['test'],
        ['test', 'budget', '--compact'],
        ['test', 'status']
      ]),
      ...usageCases(POLICY_USAGE, [
        ['policy'],
        ['policy', 'report', '--compact'],
        ['policy', 'sources', '--compact'],
        ['policy', 'status']
      ]),
      ...usageCases(ACCEPTANCE_USAGE, [
        ['acceptance'],
        ['acceptance', 'coverage', '--compact'],
        ['acceptance', 'blocks', '--compact'],
        ['acceptance', 'slots', '--compact'],
        ['acceptance', 'status']
      ]),
      ...usageCases(RUNTIME_USAGE, [
        ['runtime'],
        ['runtime', 'report', '--compact'],
        ['runtime', 'status']
      ]),
      ...usageCases(INSTALL_USAGE, [
        ['install'],
        ['install', 'manifest', '--compact'],
        ['install', 'status']
      ]),
      ...usageCases(BLOCKS_USAGE, [
        ['blocks'],
        ['blocks', 'usage', '--compact'],
        ['blocks', 'status']
      ]),
      ...usageCases(POSTGRES_USAGE, [
        ['postgres'],
        ['postgres', 'contract', '--compact'],
        ['postgres', 'status']
      ]),
      ...usageCases(LOCK_USAGE, [
        ['lock', '--json'],
        ['lock', 'inspect', '--compact'],
        ['lock', 'status']
      ]),
      ...usageCases(VERIFICATION_USAGE, [
        ['verification'],
        ['verification', 'report', '--compact'],
        ['verification', 'status']
      ]),
      ...usageCases(PROVENANCE_USAGE, [
        ['provenance'],
        ['provenance', 'registry', '--compact'],
        ['provenance', 'status']
      ]),
      ...usageCases(REVIEW_USAGE, [
        ['review'],
        ['review', 'summary', '--compact'],
        ['review', 'status']
      ]),
      ...usageCases(CONTRACT_USAGE, [
        ['contract'],
        ['contract', 'freeze', '--compact'],
        ['contract', 'errors', '--compact'],
        ['contract', 'status']
      ]),
      ...usageCases(WORKBENCH_USAGE, [
        ['workbench'],
        ['workbench', 'mutations'],
        ['workbench', 'mutations', 'apply', '--compact'],
        ['workbench', 'mutations', 'apply', '--json', '--compact', '--extra']
      ]),
      ...usageCases(VERIFY_USAGE, [
        ['verify', '--lane', 'slow'],
        ['verify', '--lane'],
        ['verify', 'fast'],
        ['verify', '--lane', 'fast', '--extra'],
        ['verify', '--compact'],
        ['verify', '--json', '--compact', '--extra']
      ]),
      ...usageCases(RESOLVE_USAGE, [
        ['resolve', '--extra']
      ])
    ]);
  });
});
