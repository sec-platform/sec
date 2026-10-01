#!/usr/bin/env bun
import {
  parseRepositoryAuditCliOptions,
  repositoryAuditInheritedDeadline,
  SOURCE_PROGRAM_TRANSITION_DEADLINE_ENV
} from '../../adapters/repository/repository-audit/cli-contract.ts';
import { assessSourceProgramTransitionWithinDeadline, readSourceProgramTransitionAuthorInput } from '../../adapters/repository/repository-audit/cli.ts';
import type { SourceProgramTransitionAssessment } from '../../adapters/repository/repository-audit/transition.ts';
import { SourceProgramCompilationInterruptedError } from '../../adapters/repository/source-program-model/compilation-operation.ts';
import type { SourceProgramTransitionControl, SourceProgramTransitionRequest } from '../../application/source-program-transition.ts';
import { canonicalJson } from '../../contracts/canonical.ts';
import { runSourceProgramTransitionCli } from '../../entry/cli/source-program-transition.ts';
import { enableExecutionProgress, reportExecutionProgress } from '../../execution/execution-progress.ts';

export async function runRepositorySourceProgramTransition(argv: readonly string[]): Promise<void> {
  // Choose the enclosing bound before source/root reads or parser preparation.
  const deadlineAtUnixMs = repositoryAuditInheritedDeadline(process.env[SOURCE_PROGRAM_TRANSITION_DEADLINE_ENV]);
  await runSourceProgramTransitionCli<SourceProgramTransitionAssessment>(argv, {
    prepare: async (args) => {
      const input = parseRepositoryAuditCliOptions(args, 'source-program');
      if (input.mode !== 'source-program' || input.transitionCandidateRoot === null) {
        throw new Error('Source transition entry requires an exact candidate root and head');
      }
      const authorPayload = await readSourceProgramTransitionAuthorInput({
        candidateRoot: input.transitionCandidateRoot, authorInputPath: input.testAuthorInput
      });
      return Object.freeze({
        request: Object.freeze({ purpose: 'inspect' as const,
          candidateRoot: input.transitionCandidateRoot,
          baseSha: input.supersessionBaseline, headSha: input.transitionExpectedHead! }),
        control: Object.freeze({ deadlineAtUnixMs }),
        ports: Object.freeze({
          acquireFacts: async (request: SourceProgramTransitionRequest, control: SourceProgramTransitionControl) => Object.freeze({
            kind: 'complete' as const, acquisition: 'executed' as const,
            facts: await assessSourceProgramTransitionWithinDeadline({
              candidateRoot: request.candidateRoot, baseSha: request.baseSha, headSha: request.headSha,
              ...(authorPayload === undefined ? {} : { authorPayload })
            }, control.deadlineAtUnixMs)
          })
        })
      });
    },
    encode: (facts) => `${JSON.stringify(canonicalJson(facts))}\n`,
    write: (output) => { process.stdout.write(output); }
  });
}

if (import.meta.main) {
  enableExecutionProgress();
  reportExecutionProgress({ command: 'audit:source-program', phase: 'command', state: 'start' });
  try {
    await runRepositorySourceProgramTransition(process.argv.slice(2));
    reportExecutionProgress({ command: 'audit:source-program', phase: 'command', state: 'complete' });
  } catch (error) {
    reportExecutionProgress({ command: 'audit:source-program', phase: 'command', state: 'failed' });
    if (!(error instanceof SourceProgramCompilationInterruptedError)) throw error;
    process.stderr.write(`${JSON.stringify({ code: error.code, phase: error.phase, phaseEvents: error.phaseEvents })}\n`);
    process.exitCode = 1;
  }
}
