#!/usr/bin/env bun

import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { writeDurableFile } from '../branch-lifecycle/branch-recovery.ts';
import { retireExactRemoteRefs } from '../branch-lifecycle/exact-ref-retirement.ts';
import type { MaintenanceRequest } from './contract.ts';
import {
  assertHostedRepositoryMaintenanceIdentity,
  parseHostedRepositoryMaintenanceRequest
} from './hosted-admission.ts';

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
  const repositoryRoot = path.resolve(input.repositoryRoot);
  assertHostedRepositoryMaintenanceIdentity(input.request, environment);

  const results: unknown[] = [];
  for (const operation of input.request.operations) {
    results.push(Object.freeze({
      kind: operation.kind,
      ...(await retireExactRemoteRefs({
        repositoryRoot,
        repository: input.request.repository,
        retirement: operation.retirement,
        recoveryRoot: environment.SEC_BRANCH_RECOVERY_ROOT
      }))
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
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--json')) {
    throw new Error('usage: repository-maintenance [--json]');
  }
  const request = parseHostedRepositoryMaintenanceRequest(process.env);
  const result = await executeRepositoryMaintenance({
    repositoryRoot: process.cwd(),
    request
  });
  const rendered = JSON.stringify(result, null, argv.includes('--json') ? 2 : 0);
  const recoveryRoot = process.env.SEC_BRANCH_RECOVERY_ROOT;
  if (recoveryRoot !== undefined && recoveryRoot.length > 0) {
    writeDurableFile(path.join(path.resolve(recoveryRoot), 'maintenance-result.json'), rendered + '\n');
  }
  return rendered;
}

if (import.meta.main) {
  process.stdout.write(`${await repositoryMaintenanceCli(process.argv.slice(2))}\n`);
}
