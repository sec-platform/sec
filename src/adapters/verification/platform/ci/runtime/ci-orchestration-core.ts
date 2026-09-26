import path from 'node:path';

import { createSha256Hasher } from '../../../../../contracts/digest.ts';
import { uniqueSorted } from '../../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../../execution/operation/requirement-binding-context.ts';
import type { BoundSemanticOperation } from '../../../../../execution/operation/semantic.ts';
import { GitReadAuthorityError } from '../../../../providers/git-read/authority.ts';
import { ReadExactGitBlobBytesBatchFromSession } from '../../../../providers/git-read/exact-blob.ts';
import {
  assertProductionGitReadSession,
  type GitBlobBytes,
  type GitReadSession,
  type GitReadSessionCommand
} from '../../../../providers/git-read/runtime/session.ts';
import { compileRepositorySourceProgramCompilation } from '../../../../repository/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../../../repository/source-program-model/test-impact-projection.ts';
import {
  acquireExactGitTreeSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from '../../../../repository/source-program-model/workspace-source-snapshot.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  openProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from '../../../../runtime-state/physical/runtime/process.ts';
import {
  activeDocumentationPaths,
  DOCUMENTATION_BASELINE_PATH,
  DOCUMENTATION_IDENTITY_PATH,
  parseDocumentationIdentityRegistry,
  parseDocumentationVerificationBaseline,
  type DocumentationVerificationBaseline
} from '../../../../self-hosting/control/documentation/active.ts';
import { issueTestInventoryProjection } from '../../test-impact/contract/budget.ts';
import { createRepositoryTestImpactSourceProvider, type TestImpactSourceProvider } from '../../test-impact/runtime/impact.ts';
import { CreateTestImpactTransitionObservation, gitChangedFileDiffArgs, gitPathBlobBatchArgs, gitWorkingTreeStatusArgs, parseGitChangedRecordsOutput, parseGitPathBlobBatchOutput, type GitChangedRecord, type GitPathBlobEntry, type TestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import { bindDocumentationVerificationGateInput } from '../contract/plan.ts';
const CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT = 24_000;
export const CODEX_DEVELOPMENT_GATE_STDOUT_BYTE_LIMIT = 8 * 1024 * 1024;
export const CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT = 8 * 1024 * 1024;

const exactSnapshotDocumentationBaselines = new WeakMap<
  PhysicalWorkspaceSourceSnapshot,
  DocumentationVerificationBaseline
>();

export type GateExecutionObservation = {
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

export type GateProcessResult = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
};

export type GateProcessSettlement = Readonly<{
  result: GateProcessResult;
  processResourceReceipt: ProcessResourceSessionReceipt;
}>;

export type GateProcessStep = {
  id: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
};

export type ChangedPathSnapshot = {
  records: GitChangedRecord[];
  files: string[];
  transitionObservation: TestImpactTransitionObservation;
};

class CiGitObservationError extends Error {
  constructor(
    readonly reason: 'invalid-input' | 'command-failed' | 'invalid-output',
    message: string
  ) {
    super(message);
    this.name = 'CiGitObservationError';
  }
}

function completedGitRead(
  command: GitReadSessionCommand,
  label: string
): Readonly<{ code: number; stdout: Buffer; stderr: string }> {
  if (command.kind !== 'completed') {
    throw new GitReadAuthorityError(`${label} did not complete.`, command);
  }
  return Object.freeze({
    code: command.result.code,
    stdout: Buffer.from(command.result.stdout),
    stderr: command.result.stderr
  });
}

async function observePathBlobs(
  session: GitReadSession,
  revision: string,
  repositoryPaths: readonly string[]
): Promise<ReadonlyMap<string, GitPathBlobEntry>> {
  if (repositoryPaths.length === 0) return new Map();
  const command = completedGitRead(
    await session.run(gitPathBlobBatchArgs(revision, repositoryPaths)),
    'CI changed-path blob observation'
  );
  if (command.code !== 0) {
    throw new CiGitObservationError(
      'command-failed',
      `CI changed-path blob observation failed (git exit ${command.code})`
      + `${command.stderr.trim() ? `: ${command.stderr.trim()}` : ''}`
    );
  }
  const entries = parseGitPathBlobBatchOutput(command.stdout, repositoryPaths);
  const recordFailure = session.consumeRecords(entries.size);
  if (recordFailure !== null) {
    throw new GitReadAuthorityError('CI changed-path blob inventory exceeded its record budget.', recordFailure);
  }
  return entries;
}

export async function ReadExactGitBlobs(
  session: GitReadSession,
  revision: string,
  repositoryPaths: readonly string[]
): Promise<ReadonlyMap<string, GitBlobBytes>> {
  assertProductionGitReadSession(session);
  const entries = await observePathBlobs(session, revision, uniqueSorted(repositoryPaths));
  if (entries.size === 0) return new Map();
  const orderedEntries = [...entries.entries()].map(([repositoryPath, entry]) => Object.freeze({
    repositoryPath,
    blobSha: entry.blobSha,
    mode: entry.mode,
    type: 'blob'
  }));
  const observed = await ReadExactGitBlobBytesBatchFromSession(session, {
    entries: orderedEntries
  });
  const blobs = new Map<string, GitBlobBytes>();
  for (const blob of observed) {
    const entry = entries.get(blob.repositoryPath)!;
    blobs.set(blob.repositoryPath, Object.freeze({
      blobSha: blob.blobSha,
      bytes: blob.bytes,
      mode: entry.mode,
      type: 'blob' as const
    }));
  }
  return blobs;
}

export async function DefaultGitRevision(
  session: GitReadSession,
  ref: string
): Promise<string> {
  assertProductionGitReadSession(session);
  if (ref.length === 0 || ref.includes('\0')) {
    throw new CiGitObservationError(
      'invalid-input',
      'CI Git revision requires a nonempty NUL-free ref.'
    );
  }
  const command = completedGitRead(
    await session.run(['rev-parse', '--verify', '--end-of-options', ref]),
    'CI Git revision observation'
  );
  if (command.code !== 0) {
    throw new CiGitObservationError(
      'command-failed',
      `CI Git revision observation failed (git exit ${command.code})`
      + `${command.stderr.trim() ? `: ${command.stderr.trim()}` : ''}`
    );
  }
  const revision = command.stdout.toString('utf8').trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision)) {
    throw new CiGitObservationError(
      'invalid-output',
      'CI Git revision observation did not return one canonical object id.'
    );
  }
  return revision;
}

export async function DefaultTrackedTreeIsClean(
  session: GitReadSession
): Promise<boolean> {
  assertProductionGitReadSession(session);
  const command = completedGitRead(
    await session.run(gitWorkingTreeStatusArgs()),
    'CI worktree status observation'
  );
  if (command.code !== 0) {
    throw new CiGitObservationError(
      'command-failed',
      `CI worktree status observation failed (git exit ${command.code})`
      + `${command.stderr.trim() ? `: ${command.stderr.trim()}` : ''}`
    );
  }
  const recordCount = command.stdout.reduce(
    (count, byte) => count + (byte === 0 ? 1 : 0),
    0
  );
  const recordFailure = session.consumeRecords(recordCount);
  if (recordFailure !== null) {
    throw new GitReadAuthorityError('CI worktree status exceeded its record budget.', recordFailure);
  }
  return command.stdout.length === 0;
}

export function ChangedFilesFromRecords(
  records: readonly GitChangedRecord[]
): string[] {
  return uniqueSorted(records.flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
}

export async function DefaultChangedPaths(
  session: GitReadSession,
  baseSha: string,
  headSha: string
): Promise<ChangedPathSnapshot> {
  assertProductionGitReadSession(session);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(headSha)) {
    throw new CiGitObservationError(
      'invalid-input',
      'CI changed-path observation requires canonical base and head object ids.'
    );
  }
  const diff = completedGitRead(
    await session.run(gitChangedFileDiffArgs(baseSha, headSha)),
    'CI changed-path transition'
  );
  if (diff.code !== 0) {
    throw new CiGitObservationError(
      'command-failed',
      `CI changed-path transition failed (git exit ${diff.code})`
      + `${diff.stderr.trim() ? `: ${diff.stderr.trim()}` : ''}`
    );
  }
  const records = parseGitChangedRecordsOutput(diff.stdout);
  const recordFailure = session.consumeRecords(records.length);
  if (recordFailure !== null) {
    throw new GitReadAuthorityError('CI changed-path transition exceeded its record budget.', recordFailure);
  }
  const removedPaths = uniqueSorted(records
    .filter(({ status }) => status === 'removed')
    .map(({ path: repositoryPath }) => repositoryPath));
  // A GitRead session is deliberately single-flight. Sequential commands
  // preserve one caller-owned aggregate ledger without weakening the
  // non-reentrant physical provider contract.
  const baseBlobs = await observePathBlobs(session, baseSha, removedPaths);
  const headBlobs = await observePathBlobs(session, headSha, removedPaths);
  return Object.freeze({
    records,
    files: ChangedFilesFromRecords(records),
    transitionObservation: CreateTestImpactTransitionObservation({
      baseSha,
      headSha,
      records,
      readPathBlob: (revision, repositoryPath) => (
        (revision === baseSha ? baseBlobs : headBlobs).get(repositoryPath) ?? null
      )
    })
  });
}

/**
 * The trusted base observes the candidate commit as immutable Git data. The
 * candidate never executes its own selector implementation or chooses files.
 */
export async function ExactGitWorkspaceSourceSnapshot(
  session: GitReadSession,
  candidateSha: string
): Promise<PhysicalWorkspaceSourceSnapshot> {
  assertProductionGitReadSession(session);
  const snapshot = await acquireExactGitTreeSnapshot({
    session,
    commitSha: candidateSha
  });
  const baselineBlob = (await ReadExactGitBlobs(
    session,
    candidateSha,
    [DOCUMENTATION_BASELINE_PATH]
  )).get(DOCUMENTATION_BASELINE_PATH);
  if (baselineBlob === undefined) {
    throw new Error('Exact candidate documentation verification baseline was not observed.');
  }
  let baselineSource: string;
  try {
    baselineSource = new TextDecoder('utf-8', { fatal: true }).decode(baselineBlob.bytes);
  } catch (error) {
    throw new Error('Exact candidate documentation verification baseline is not valid UTF-8.', { cause: error });
  }
  exactSnapshotDocumentationBaselines.set(
    snapshot,
    parseDocumentationVerificationBaseline(baselineSource)
  );
  return snapshot;
}

export function TestImpactSourceProviderFromSnapshot(
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot,
  repositoryRoot: string
): TestImpactSourceProvider {
  const documentationVerificationBaseline = exactSnapshotDocumentationBaselines.get(workspaceSnapshot);
  if (documentationVerificationBaseline === undefined) {
    throw new Error('Exact candidate documentation verification baseline binding was not observed.');
  }
  const documentationIdentitySource = workspaceSnapshot.file(DOCUMENTATION_IDENTITY_PATH)?.source;
  if (documentationIdentitySource === undefined) {
    throw new Error('Exact candidate documentation identity registry was not observed.');
  }
  const candidateActiveDocumentationPaths = activeDocumentationPaths(
    parseDocumentationIdentityRegistry(documentationIdentitySource)
  );
  const sourceProgramCompilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot,
    repositoryRoot
  });
  const provider = createRepositoryTestImpactSourceProvider({
    projection: issueTestImpactProjection({
      workspaceSnapshot,
      repositoryModel: sourceProgramCompilation.model,
      typeScriptModel: sourceProgramCompilation.typeScriptCompilation.model,
      testObservations: sourceProgramCompilation.testObservations
    }),
    testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
    activeDocumentationPaths: candidateActiveDocumentationPaths
  });
  return bindDocumentationVerificationGateInput(provider, documentationVerificationBaseline);
}

export async function RunGateProcess(
  repositoryRoot: string,
  step: GateProcessStep,
  execution: Readonly<{
    operation: BoundSemanticOperation;
    requirementId: string;
  }>
): Promise<GateProcessSettlement> {
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
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation: execution.operation,
      requirementId: execution.requirementId,
      resourceCeilings: processBudgets
    })
  });
  let executable: RetainedNoFollowOrdinaryFile | null = null;
  let workingDirectory: RetainedNoFollowChildProcessDirectory | null = null;
  let result: GateProcessResult | null = null;
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
    const hash = createSha256Hasher();
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
      rawOutputDigest: hash.finish(),
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

export function FailureTail(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT
    ? combined.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT)
    : combined;
}

export function CreateNotRunGate(
  step: Readonly<{ id: string; argv: readonly string[] }>
): GateExecutionObservation {
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
