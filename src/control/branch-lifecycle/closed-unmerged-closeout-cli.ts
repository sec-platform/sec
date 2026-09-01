#!/usr/bin/env bun

import path from 'node:path';

import { resolveProductionClosedUnmergedCloseoutEffectProvider } from './closed-unmerged-closeout-production.ts';

interface Arguments {
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly disposition: 'evidence-close' | 'closed-superseded';
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--') || values.has(key)) {
      throw new Error('usage: closed-unmerged-closeout --repository owner/name --pr N --disposition evidence-close|closed-superseded');
    }
    values.set(key, value);
  }
  if ([...values.keys()].some((key) => (
    key !== '--repository' && key !== '--pr' && key !== '--disposition'
  ))) {
    throw new Error('closed-unmerged closeout received an unknown argument');
  }
  const repository = values.get('--repository');
  const rawPullRequest = values.get('--pr');
  const disposition = values.get('--disposition');
  if (repository === undefined
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[-A-Za-z0-9._]{1,100}$/u.test(repository)) {
    throw new Error('--repository must be one bounded owner/name identity');
  }
  if (rawPullRequest === undefined || !/^[1-9][0-9]*$/u.test(rawPullRequest)) {
    throw new Error('--pr must be one positive integer');
  }
  const pullRequestNumber = Number(rawPullRequest);
  if (!Number.isSafeInteger(pullRequestNumber)) throw new Error('--pr exceeds the safe integer range');
  if (disposition !== 'evidence-close' && disposition !== 'closed-superseded') {
    throw new Error('--disposition must be evidence-close or closed-superseded');
  }
  return Object.freeze({ repository, pullRequestNumber, disposition });
}

export async function runClosedUnmergedCloseoutCli(argv: readonly string[]): Promise<number> {
  const input = parseArguments(argv);
  const resolution = await resolveProductionClosedUnmergedCloseoutEffectProvider({
    repositoryRoot: path.resolve(process.cwd()),
    deadlineAtUnixMs: Date.now() + 30_000
  });
  if (resolution.status !== 'ready') {
    process.stdout.write(`${JSON.stringify({
      status: 'preserved',
      operation: 'closed-unmerged-closeout',
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      disposition: input.disposition,
      stage: 'effect-provider-admission',
      providerStatus: resolution.status,
      providerReason: resolution.reason,
      providerDetailDigest: resolution.detailDigest
    })}\n`);
    return 2;
  }
  // The ready branch is intentionally unreachable until the external provider
  // owner exports a closed-unmerged semantic capability.  Keeping this typed
  // blocker here prevents a raw gh/git fallback from silently appearing.
  process.stdout.write(`${JSON.stringify({
    status: 'preserved',
    operation: 'closed-unmerged-closeout',
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    disposition: input.disposition,
    stage: 'effect-provider-admission',
    providerStatus: 'unavailable',
    providerReason: 'semantic-effect-provider-unavailable'
  })}\n`);
  return 2;
}

if (import.meta.main) {
  process.exitCode = await runClosedUnmergedCloseoutCli(process.argv.slice(2));
}
