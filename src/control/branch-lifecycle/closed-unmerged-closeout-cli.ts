#!/usr/bin/env bun

import path from 'node:path';

import { observeActiveWorkPackage } from '../documentation/document-control-plane.ts';
import {
  loadPreparedBranchCloseoutEnvelope,
  preparationFilePath,
  prepareClosedUnmergedPullRequestCloseout
} from './branch-closeout.ts';
import {
  executeProductionClosedUnmergedCloseout
} from './closed-unmerged-closeout-production.ts';
import {
  compileClosedUnmergedCloseoutOperation,
  createClosedSupersededDispositionEvidence
} from './closed-unmerged-closeout.ts';

interface Arguments {
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly disposition: 'closed-superseded';
  readonly reviewCommentId: number;
  readonly preparationPath: string | null;
}

function positiveInteger(value: string | undefined, label: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) throw new Error(`${label} must be one positive integer`);
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
      throw new Error('usage: closed-unmerged-closeout --repository owner/name --pr N --disposition closed-superseded --review-comment ID [--preparation PATH]');
    }
    values.set(key, value);
  }
  if ([...values.keys()].some((key) => !['--repository', '--pr', '--disposition', '--review-comment', '--preparation'].includes(key))) {
    throw new Error('closed-unmerged closeout received an unknown argument');
  }
  const repository = values.get('--repository');
  if (repository === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(repository)) {
    throw new Error('--repository must be one bounded owner/name identity');
  }
  if (values.get('--disposition') !== 'closed-superseded') {
    throw new Error('--disposition must be closed-superseded');
  }
  const preparation = values.get('--preparation');
  return Object.freeze({
    repository,
    pullRequestNumber: positiveInteger(values.get('--pr'), '--pr'),
    disposition: 'closed-superseded',
    reviewCommentId: positiveInteger(values.get('--review-comment'), '--review-comment'),
    preparationPath: preparation === undefined ? null : path.resolve(preparation)
  });
}

export async function runClosedUnmergedCloseoutCli(argv: readonly string[]): Promise<number> {
  const input = parseClosedUnmergedCloseoutArguments(argv);
  const repositoryRoot = path.resolve(process.cwd());
  let capturedPreparationPath = input.preparationPath;
  try {
    const result = await executeProductionClosedUnmergedCloseout({
      repositoryRoot,
      repository: input.repository,
      compileOperation: async (context) => {
        const pull = await context.observePullRequest(input.pullRequestNumber);
        const supersession = await context.observeSupersessionEvidence({
          pullRequestNumber: input.pullRequestNumber,
          commentId: input.reviewCommentId
        });
        if (pull.state !== 'closed' || pull.headSha === null || pull.baseSha == null) {
          throw new Error('closed-superseded production closeout requires one exact closed PR with complete head/base identity');
        }
        const headRef = await context.observeHeadRef(pull.headBranch);
        if (headRef.state === 'present' && headRef.sha !== pull.headSha) {
          throw new Error('current remote head ref differs from the exact closed PR head');
        }
        const evidence = createClosedSupersededDispositionEvidence({
          repository: input.repository,
          pullRequestNumber: pull.number,
          branch: pull.headBranch,
          headSha: pull.headSha,
          headTreeSha: supersession.review.headTreeSha,
          baseBranch: pull.baseBranch,
          baseSha: pull.baseSha,
          currentMainSha: supersession.review.currentMainSha,
          currentMainTreeSha: supersession.review.currentMainTreeSha,
          durableGoal: { kind: 'evidence', reference: supersession.reference },
          supersession
        });
        const completedPreparation = input.preparationPath === null
          ? await context.observeCompletedPreparation(pull.number, evidence.evidenceDigest)
          : null;
        const prepared = input.preparationPath === null
          ? completedPreparation ?? prepareClosedUnmergedPullRequestCloseout({
              repositoryRoot, repositoryFullName: input.repository,
              activeWorkPackageObservation: await observeActiveWorkPackage(repositoryRoot) }, {
              number: pull.number, state: 'closed',
              refState: headRef.state,
              headBranch: pull.headBranch, headSha: pull.headSha,
              baseBranch: pull.baseBranch, baseSha: pull.baseSha,
              exactPullRequest: pull
            })
          : loadPreparedBranchCloseoutEnvelope(input.preparationPath);
        capturedPreparationPath = preparationFilePath(prepared.preparation);
        if (prepared.before.repository.fullName !== input.repository
            || prepared.before.repository.defaultBranch !== pull.baseBranch
            || prepared.before.main.remoteSha !== supersession.review.currentMainSha) {
          throw new Error('prepared repository/main identity differs from the adopted supersession review');
        }
        const compiled = compileClosedUnmergedCloseoutOperation({ prepared, evidence });
        if (compiled.status !== 'ready') throw new Error(`closed-unmerged operation compilation blocked: ${compiled.blockers.join(' | ')}`);
        return compiled.operation;
      }
    });
    process.stdout.write(`${JSON.stringify({ operation: 'closed-unmerged-closeout', repository: input.repository,
      pullRequestNumber: input.pullRequestNumber, disposition: input.disposition,
      preparationPath: result.status === 'completed' ? null : capturedPreparationPath,
      ...result })}\n`);
    return result.status === 'completed' ? 0 : 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'preserved', operation: 'closed-unmerged-closeout',
      repository: input.repository, pullRequestNumber: input.pullRequestNumber,
      disposition: input.disposition, stage: 'production-closeout',
      preparationPath: capturedPreparationPath,
      reasons: [error instanceof Error ? error.message : String(error)] })}\n`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = await runClosedUnmergedCloseoutCli(process.argv.slice(2));
