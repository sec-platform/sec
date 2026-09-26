#!/usr/bin/env bun

import {
  executeProductionClosedUnmergedRetirement
} from './closed-unmerged-closeout-production.ts';

interface Arguments {
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly disposition: 'closed-superseded';
  readonly reviewCommentId: number | null;
}

function positiveInteger(value: string | undefined, label: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be one positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
}

export function parseClosedUnmergedCloseoutArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--') || values.has(key)) {
      throw new Error('usage: closed-unmerged-closeout --repository owner/name --pr N --disposition closed-superseded [--review-comment ID]');
    }
    values.set(key, value);
  }
  if ([...values.keys()].some((key) => (
    key !== '--repository' && key !== '--pr' && key !== '--disposition'
      && key !== '--review-comment'
  ))) {
    throw new Error('closed-unmerged closeout received an unknown argument');
  }
  const repository = values.get('--repository');
  const disposition = values.get('--disposition');
  if (repository === undefined
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(repository)) {
    throw new Error('--repository must be one bounded owner/name identity');
  }
  if (disposition !== 'closed-superseded') {
    throw new Error('--disposition must be closed-superseded');
  }
  return Object.freeze({
    repository,
    pullRequestNumber: positiveInteger(values.get('--pr'), '--pr'),
    disposition,
    reviewCommentId: values.has('--review-comment')
      ? positiveInteger(values.get('--review-comment'), '--review-comment') : null
  });
}

export async function runClosedUnmergedCloseoutCli(
  argv: readonly string[],
  write: (source: string) => void = (source) => { process.stdout.write(source); }
): Promise<number> {
  const input = parseClosedUnmergedCloseoutArguments(argv);
  try {
    const result = await executeProductionClosedUnmergedRetirement({
      repositoryRoot: process.cwd(),
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      reviewCommentId: input.reviewCommentId
    });
    write(`${JSON.stringify({
      operation: 'closed-unmerged-closeout',
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      disposition: input.disposition,
      ...result
    })}\n`);
    return result.status === 'completed' ? 0 : 2;
  } catch (error) {
    write(`${JSON.stringify({
      status: 'preserved',
      operation: 'closed-unmerged-closeout',
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      disposition: input.disposition,
      stage: 'production-closeout',
      reasons: [error instanceof Error ? error.message : String(error)]
    })}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await runClosedUnmergedCloseoutCli(process.argv.slice(2));
}
