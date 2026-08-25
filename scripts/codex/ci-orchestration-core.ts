import { createHash } from 'node:crypto';

import {
  CodexDevelopmentListExactGitTreeEntriesV1,
  CodexDevelopmentReadExactGitBlobEntryV1,
  CodexDevelopmentReadExactGitTextBlobsBatchV1,
  readGitChangedRecords,
  readGitRevision,
  readGitWorkingTreeStatus
} from '../../platform/git/objects.ts';
import type { CodexDevelopmentVerificationGateEvidenceV2 } from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentCreateTestImpactTransitionObservationV1,
  type CodexDevelopmentGitChangedRecordV1,
  type CodexDevelopmentTestImpactTransitionObservationV1
} from '../../platform/shared/ci-git-changed-files.ts';
import { uniqueSorted } from '../../platform/shared/collections.ts';
import {
  CommandTerminationErrorV1,
  runCommand
} from '../../platform/shared/process.ts';
import {
  createTestImpactSourceProviderV2,
  type CodexDevelopmentTestImpactSourceProviderV2
} from '../../platform/shared/test-impact-contract.ts';
import type { VerificationActionExecutionBudgetV1 } from '../../platform/shared/verification-action-contract.ts';

export const CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1 = 24_000;

export type CodexDevelopmentGateProcessResultV1 = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
  termination?: 'completed' | 'timeout' | 'cancelled' | 'transport-failed';
};

export type CodexDevelopmentGateProcessStepV1 = {
  id: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  budget: VerificationActionExecutionBudgetV1;
  signal: AbortSignal;
};

export type CodexDevelopmentChangedPathSnapshotV1 = {
  records: CodexDevelopmentGitChangedRecordV1[];
  files: string[];
  transitionObservation: CodexDevelopmentTestImpactTransitionObservationV1;
};

export function CodexDevelopmentDefaultGitRevisionV1(
  repositoryRoot: string,
  ref: string
): string | null {
  return readGitRevision(repositoryRoot, ref);
}

export function CodexDevelopmentDefaultTrackedTreeIsCleanV1(repositoryRoot: string): boolean {
  try {
    return readGitWorkingTreeStatus(repositoryRoot).length === 0;
  } catch {
    return false;
  }
}

export function CodexDevelopmentChangedFilesFromRecordsV1(
  records: readonly CodexDevelopmentGitChangedRecordV1[]
): string[] {
  return uniqueSorted(records.flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
}

export function CodexDevelopmentDefaultChangedPathsV1(
  repositoryRoot: string,
  baseSha: string,
  headSha: string
): CodexDevelopmentChangedPathSnapshotV1 | null {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(headSha)) return null;
  let records: CodexDevelopmentGitChangedRecordV1[];
  try {
    records = [...readGitChangedRecords(repositoryRoot, baseSha, headSha)];
  } catch {
    return null;
  }
  try {
    return {
      records,
      files: CodexDevelopmentChangedFilesFromRecordsV1(records),
      transitionObservation: CodexDevelopmentCreateTestImpactTransitionObservationV1({
        baseSha,
        headSha,
        records,
        readPathBlob: (revision, repositoryPath) => {
          try {
            const entry = CodexDevelopmentReadExactGitBlobEntryV1({
              repositoryRoot,
              commitSha: revision,
              repositoryPath
            });
            return { mode: entry.mode, blobSha: entry.blobSha };
          } catch (error) {
            if (error instanceof Error
                && error.message === `Exact Git blob path is missing at ${revision}: ${repositoryPath}.`) {
              return null;
            }
            throw error;
          }
        }
      })
    };
  } catch {
    return null;
  }
}

export function CodexDevelopmentDefaultChangedFilesV1(
  repositoryRoot: string,
  baseSha: string,
  headSha: string
): string[] | null {
  return CodexDevelopmentDefaultChangedPathsV1(repositoryRoot, baseSha, headSha)?.files ?? null;
}

/**
 * The trusted base observes the candidate commit as immutable Git data. The
 * candidate never executes its own selector implementation or chooses files.
 */
export function CodexDevelopmentExactGitTestImpactSourceProviderV1(
  repositoryRoot: string,
  candidateSha: string
): CodexDevelopmentTestImpactSourceProviderV2 {
  const treeEntries = CodexDevelopmentListExactGitTreeEntriesV1({
    repositoryRoot,
    commitSha: candidateSha
  });
  const entriesByPath = new Map(treeEntries.map((entry) => [entry.repositoryPath, entry]));
  let provider!: CodexDevelopmentTestImpactSourceProviderV2;
  let sourceByPath: ReadonlyMap<string, string> | null = null;
  provider = createTestImpactSourceProviderV2({
    repositoryFiles: treeEntries.map(({ repositoryPath }) => repositoryPath),
    readModuleSource: (moduleFile) => {
      if (sourceByPath === null) {
        const ordinaryModuleEntries = provider.moduleFiles.flatMap((repositoryPath) => {
          const entry = entriesByPath.get(repositoryPath);
          return entry !== undefined
              && (entry.mode === '100644' || entry.mode === '100755')
              && entry.type === 'blob'
            ? [entry]
            : [];
        });
        sourceByPath = new Map(CodexDevelopmentReadExactGitTextBlobsBatchV1({
          repositoryRoot,
          entries: ordinaryModuleEntries
        }).map(({ repositoryPath, source }) => [repositoryPath, source]));
      }
      return sourceByPath.get(moduleFile) ?? null;
    }
  });
  return provider;
}

export function CodexDevelopmentRunGateProcessV1(
  repositoryRoot: string,
  step: CodexDevelopmentGateProcessStepV1
): Promise<CodexDevelopmentGateProcessResultV1> {
  return (async () => {
    const hash = createHash('sha256');
    let boundedTail = '';
    const observe = (chunk: Buffer): void => {
      hash.update(chunk);
      boundedTail = `${boundedTail}${chunk.toString('utf8')}`;
      if (boundedTail.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1) {
        boundedTail = boundedTail.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1);
      }
    };
    const result = await runCommand(step.argv[0]!, step.argv.slice(1), {
      cwd: repositoryRoot,
      env: step.env,
      maxStdoutBytes: step.budget.maxStdoutBytes,
      maxStderrBytes: step.budget.maxStderrBytes,
      retainOutput: false,
      timeoutMs: step.budget.absoluteTimeoutMs,
      stallTimeoutMs: step.budget.stallTimeoutMs,
      processTreeSettlementTimeoutMs: step.budget.processTreeSettlementTimeoutMs,
      // Generic gates do not own a semantic presentation parser.  Their
      // output therefore cannot extend the stall budget; producers that own
      // structured progress must expose a narrower transport adapter.
      admitProgress: () => false,
      signal: step.signal,
      onOutput: (chunk, stream) => {
        observe(chunk);
        (stream === 'stdout' ? process.stdout : process.stderr).write(chunk);
      }
    });
    return {
      code: result.code,
      rawOutputDigest: `sha256:${hash.digest('hex')}`,
      failureTail: boundedTail.trim(),
      termination: 'completed' as const
    };
  })().catch((error) => {
    const message = `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
    process.stderr.write(message);
    const termination = error instanceof CommandTerminationErrorV1
      ? error.reason === 'aborted' ? 'cancelled' as const : 'timeout' as const
      : 'transport-failed' as const;
    return {
      code: 1,
      rawOutputDigest: `sha256:${createHash('sha256').update(message).digest('hex')}`,
      failureTail: message.trim().slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1),
      termination
    };
  });
}

export function CodexDevelopmentFailureTailV1(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1
    ? combined.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1)
    : combined;
}

export function CodexDevelopmentCreateNotRunGateV2(
  step: Readonly<{ id: string; argv: readonly string[] }>
): CodexDevelopmentVerificationGateEvidenceV2 {
  return {
    id: step.id,
    argv: [...step.argv],
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'Gate was not reached because preflight or an earlier fail-fast gate did not complete.'
  };
}
