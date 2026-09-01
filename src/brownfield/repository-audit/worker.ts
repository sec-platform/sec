#!/usr/bin/env bun
import {
  runRepositoryAuditCli,
  SOURCE_PROGRAM_AUDIT_DEADLINE_ENV
} from './cli.ts';

const deadlineSource = process.env[SOURCE_PROGRAM_AUDIT_DEADLINE_ENV];
const deadlineAtUnixMs = deadlineSource === undefined ? Number.NaN : Number(deadlineSource);
if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) {
  throw new Error('Repository audit worker requires one future absolute parent deadline.');
}

await runRepositoryAuditCli(process.argv.slice(2), { deadlineAtUnixMs });
