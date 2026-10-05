#!/usr/bin/env bun

import path from 'node:path';
import { sha256 } from '../../../../contracts/canonical.ts';
import { inspectNoFollowDirectoryChain, readNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { observeExactRefBatchResumeReceipt } from '../branch-lifecycle/exact-ref-retirement.ts';
import {
  parseRepositoryMaintenanceRequest,
  parseRepositoryMaintenanceResumeReceipt,
  REPOSITORY_MAINTENANCE_MAX_REQUEST_BYTES,
  REPOSITORY_MAINTENANCE_REQUEST_SCHEMA
} from './contract.ts';

function readBoundedInput(filename: string, limit: number): string {
  if (process.platform !== 'linux' && process.platform !== 'win32') {
    throw new Error(`repository maintenance file input is unsupported on ${process.platform}; the no-follow backend requires Linux or Windows`);
  }
  // The CLI selects a local input, not a repository-relative authority. Prove
  // the entire parent chain, then read only its ordinary no-follow leaf through
  // the physical owner; never reopen the caller's pathname as a file.
  const selected = path.resolve(filename);
  const parent = inspectNoFollowDirectoryChain(path.dirname(selected), 'maintenance input parent');
  const bytes = readNoFollowOrdinaryFile(parent.target, path.basename(selected), { maximumBytes: limit });
  if (bytes === null) throw new Error('repository maintenance input is absent');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Inspect original provider-bound evidence; never dispatch, resume an effect or delete a ref. */
export async function repositoryMaintenanceReceiptCli(argv: readonly string[]): Promise<string> {
  if (argv.length !== 5 || argv[0] !== 'read-receipt' || argv[1] !== '--request' || argv[3] !== '--resume-receipt') {
    throw new Error('usage: repository-maintenance read-receipt --request <original-json-file> --resume-receipt <locator-json-file>; read-only historical evidence');
  }
  const request = parseRepositoryMaintenanceRequest(readBoundedInput(argv[2]!, REPOSITORY_MAINTENANCE_MAX_REQUEST_BYTES));
  const resumeReceipt = parseRepositoryMaintenanceResumeReceipt(readBoundedInput(argv[4]!, 1024));
  if (request.schema !== REPOSITORY_MAINTENANCE_REQUEST_SCHEMA || resumeReceipt === undefined) {
    throw new Error('receipt lookup requires the original v2 ref batch and exact artifact locator');
  }
  const retirements = request.operations.map(operation => {
    if (operation.kind !== 'exact-ref-retirement') throw new Error('receipt lookup requires ref operations');
    return operation.retirement;
  });
  const evidence = await observeExactRefBatchResumeReceipt({ repositoryRoot: process.cwd(),
    repository: request.repository, expectedMainSha: request.expectedMainSha,
    requestDigest: sha256(request), retirements, resumeReceipt });
  return JSON.stringify({ historicalEvidence: evidence, currentRefState: 'not-observed',
    recoveryBytes: 'not-verified', effectsAttempted: false }, null, 2);
}

if (import.meta.main) {
  process.stdout.write(`${await repositoryMaintenanceReceiptCli(process.argv.slice(2))}\n`);
}
