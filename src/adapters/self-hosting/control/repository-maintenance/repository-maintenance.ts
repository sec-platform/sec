#!/usr/bin/env bun

import { sha256 } from '../../../../contracts/canonical.ts';
import type { MaintenanceRequest } from './contract.ts';
import { planRepositoryMaintenance } from './plan.ts';
import { assertHostedRepositoryMaintenanceIdentity, parseHostedRepositoryMaintenanceRequest } from './hosted-admission.ts';
import { executeRepositoryMaintenanceEffect, preflightRepositoryMaintenanceEffects } from './effect.ts';

export { parseRepositoryMaintenanceRequest } from './contract.ts';

export async function executeRepositoryMaintenance(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  schema: 'sec-repository-maintenance-result-v1';
  requestDigest: `sha256:${string}`;
  completed: number;
  results: readonly unknown[];
}>> {
  const environment = input.environment ?? process.env;
  const plan = planRepositoryMaintenance(input.request);
  assertHostedRepositoryMaintenanceIdentity(plan, environment);
  await preflightRepositoryMaintenanceEffects({
    repositoryRoot: input.repositoryRoot, repository: plan.repository
  });
  const results: unknown[] = [];
  for (const operation of plan.steps) {
    results.push(await executeRepositoryMaintenanceEffect({
      repositoryRoot: input.repositoryRoot, repository: plan.repository, operation,
      recoveryRoot: environment.SEC_BRANCH_RECOVERY_ROOT
    }));
  }
  return Object.freeze({
    schema: 'sec-repository-maintenance-result-v1',
    requestDigest: sha256(input.request),
    completed: results.length,
    results: Object.freeze(results)
  });
}

export async function repositoryMaintenanceCli(argv: readonly string[]): Promise<string> {
  if (argv[0] !== 'execute' || argv.some((value, index) => index > 0 && value !== '--json')) {
    throw new Error('usage: repository-maintenance execute [--json]');
  }
  const repositoryRoot = process.cwd();
  const request = parseHostedRepositoryMaintenanceRequest(process.env);
  const result = await executeRepositoryMaintenance({ repositoryRoot, request });
  return JSON.stringify(result, null, argv.includes('--json') ? 2 : 0);
}

if (import.meta.main) {
  process.stdout.write(`${await repositoryMaintenanceCli(process.argv.slice(2))}\n`);
}
