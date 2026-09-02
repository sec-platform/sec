import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { compileRepositorySourceProgramCompilation } from '../../../brownfield/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../../brownfield/source-program-model/test-impact-projection.ts';
import { acquireExactGitTreeWorkspaceSourceSnapshot } from '../../../brownfield/source-program-model/workspace-source-snapshot.ts';
import {
  activeDocumentationPaths,
  parseDocumentationAuthorityRegistry
} from '../../../control/documentation/authority.ts';
import {
  CodexDevelopmentReadExactGitBlobEntry
} from '../../../external-capabilities/git-read/exact-blob.ts';
import { isolatedGitReadEnvironment } from '../../../external-capabilities/git-read/runtime/session.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  openProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from '../../../runtime-state/physical/runtime/process.ts';
import { rawSha256, uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../../system-architecture/operation/requirement-binding-context.ts';
import type { SecBoundSemanticOperation } from '../../../system-architecture/operation/semantic.ts';
import { createRepositoryTestImpactSourceProvider, type CodexDevelopmentTestImpactSourceProvider } from '../../test-impact/runtime/impact.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation, gitChangedFileDiffArgs, parseGitChangedRecordsOutput, type CodexDevelopmentGitChangedRecord, type CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
export const CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT = 24_000;
export const CODEX_DEVELOPMENT_GATE_STDOUT_BYTE_LIMIT = 8 * 1024 * 1024;
export const CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT = 8 * 1024 * 1024;

export type CodexDevelopmentGateExecutionObservation = {
  id: string;
  argv: string[];
  status: 'passed' | 'failed' | 'not-run';
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  failureTail: string | null;
  rawOutputDigest: string | null;
  notRunReason: string | null;
};

export type CodexDevelopmentGateProcessResult = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
};

export type CodexDevelopmentGateProcessSettlement = Readonly<{
  result: CodexDevelopmentGateProcessResult;
  processResourceReceipt: ProcessResourceSessionReceipt;
}>;

export type CodexDevelopmentGateProcessStep = {
  id: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
};

export type CodexDevelopmentChangedPathSnapshot = {
  records: CodexDevelopmentGitChangedRecord[];
  files: string[];
  transitionObservation: CodexDevelopmentTestImpactTransitionObservation;
};

export function CodexDevelopmentDefaultGitRevision(
  repositoryRoot: string,
  ref: string
): string | null {
  const result = spawnSync('git', ['rev-parse', ref], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment()
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function CodexDevelopmentDefaultTrackedTreeIsClean(repositoryRoot: string): boolean {
  const result = spawnSync('git', [
    '-c',
    'core.quotepath=false',
    '-c',
    'core.autocrlf=true',
    'status',
    '--porcelain=v1',
    '--untracked-files=normal',
    '--ignored=no'
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment()
  });
  return result.status === 0 && result.stdout.length === 0;
}

export function CodexDevelopmentChangedFilesFromRecords(
  records: readonly CodexDevelopmentGitChangedRecord[]
): string[] {
  return uniqueSorted(records.flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
}

export function CodexDevelopmentDefaultChangedPaths(
  repositoryRoot: string,
  baseSha: string,
  headSha: string
): CodexDevelopmentChangedPathSnapshot | null {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(headSha)) return null;
  const result = spawnSync('git', gitChangedFileDiffArgs(baseSha, headSha), {
    cwd: repositoryRoot,
    encoding: 'buffer',
    env: isolatedGitReadEnvironment()
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  try {
    const records = parseGitChangedRecordsOutput(result.stdout);
    return {
      records,
      files: CodexDevelopmentChangedFilesFromRecords(records),
      transitionObservation: CodexDevelopmentCreateTestImpactTransitionObservation({
        baseSha,
        headSha,
        records,
        readPathBlob: (revision, repositoryPath) => {
          try {
            const entry = CodexDevelopmentReadExactGitBlobEntry({
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

/**
 * The trusted base observes the candidate commit as immutable Git data. The
 * candidate never executes its own selector implementation or chooses files.
 */
export function CodexDevelopmentExactGitTestImpactSourceProvider(
  repositoryRoot: string,
  candidateSha: string
): CodexDevelopmentTestImpactSourceProvider {
  const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot,
    commitSha: candidateSha
  });
  const documentationRegistrySource = workspaceSnapshot.file('docs/authority.json')?.source;
  if (documentationRegistrySource === undefined) {
    throw new Error('Exact candidate documentation authority registry was not observed.');
  }
  const candidateActiveDocumentationPaths = activeDocumentationPaths(
    parseDocumentationAuthorityRegistry(documentationRegistrySource)
  );
  const sourceProgramCompilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot,
    repositoryRoot
  });
  return createRepositoryTestImpactSourceProvider({
    projection: issueTestImpactProjection({
      workspaceSnapshot,
      typeScriptModel: sourceProgramCompilation.typeScriptCompilation.model,
      testObservations: sourceProgramCompilation.testObservations
    }),
    activeDocumentationPaths: candidateActiveDocumentationPaths
  });
}

export async function CodexDevelopmentRunGateProcess(
  repositoryRoot: string,
  step: CodexDevelopmentGateProcessStep,
  execution: Readonly<{
    operation: SecBoundSemanticOperation;
    requirementId: string;
  }>
): Promise<CodexDevelopmentGateProcessSettlement> {
  if (step.argv.length < 1) throw new Error('CI gate process requires one executable identity.');
  const executablePath = path.resolve(process.execPath);
  if (step.argv[0] !== 'bun' && path.resolve(step.argv[0]!) !== executablePath) {
    throw new Error('CI gate process only accepts the retained canonical Bun executable.');
  }
  const processBudgets = execution.operation.plan.execution.aggregateBudgets.filter(
    ({ resource }) => resource === 'duration-ms'
      || resource === 'input-bytes'
      || resource === 'output-bytes'
      || resource === 'processes'
  );
  const session = openProcessResourceSession({
    operation: execution.operation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({
      operation: execution.operation,
      requirementId: execution.requirementId,
      resourceCeilings: processBudgets
    })
  });
  let executable: RetainedNoFollowOrdinaryFile | null = null;
  let workingDirectory: RetainedNoFollowChildProcessDirectory | null = null;
  let result: CodexDevelopmentGateProcessResult | null = null;
  const failures: unknown[] = [];
  try {
    executable = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(executablePath), 'CI gate Bun executable parent'),
      path.basename(executablePath),
      undefined,
      'CI gate Bun executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(path.resolve(repositoryRoot), 'CI gate repository root'),
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'CI gate repository root'
    );
    const hash = createHash('sha256');
    let boundedTail = '';
    const observe = (chunk: Buffer, stream: 'stdout' | 'stderr'): boolean => {
      hash.update(chunk);
      boundedTail = `${boundedTail}${chunk.toString('utf8')}`;
      if (boundedTail.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT) {
        boundedTail = boundedTail.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT);
      }
      (stream === 'stdout' ? process.stdout : process.stderr).write(chunk);
      return true;
    };
    const run = await session.run(issueRetainedCommandBoundary({ executable, workingDirectory }),
      step.argv.slice(1), {
        admitProgress: observe,
        env: step.env,
        envMode: 'replace',
        maxStderrBytes: CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT,
        maxStdoutBytes: CODEX_DEVELOPMENT_GATE_STDOUT_BYTE_LIMIT
      });
    result = Object.freeze({
      code: run.result.code,
      rawOutputDigest: `sha256:${hash.digest('hex')}`,
      failureTail: boundedTail.trim()
    });
  } catch (error) {
    failures.push(error);
  } finally {
    try { workingDirectory?.dispose(); } catch (error) { failures.push(error); }
    try { executable?.dispose(); } catch (error) { failures.push(error); }
  }
  let processResourceReceipt: ProcessResourceSessionReceipt | null = null;
  try { processResourceReceipt = session.close(); } catch (error) { failures.push(error); }
  if (failures.length > 0 || result === null || processResourceReceipt === null) {
    throw new AggregateError(failures, 'CI gate process execution did not settle cleanly.');
  }
  return Object.freeze({ result, processResourceReceipt });
}

export function CodexDevelopmentFailureTail(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT
    ? combined.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT)
    : combined;
}

export function CodexDevelopmentCreateNotRunGate(
  step: Readonly<{ id: string; argv: readonly string[] }>
): CodexDevelopmentGateExecutionObservation {
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
