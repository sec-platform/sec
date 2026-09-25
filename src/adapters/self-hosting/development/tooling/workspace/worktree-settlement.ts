import path from 'node:path';

import { sha256 } from '../../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../../execution/operation/semantic.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import {
  type GitReadSession,
  type GitReadSessionBudget
} from '../../../../providers/git-read/runtime/session.ts';
import { inspectNoFollowDirectoryChain, readNoFollowOrdinaryFile, type PhysicalDirectoryIdentity } from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  WORKTREE_SETTLEMENT_SCHEMA,
  detectLineEnding,
  differsOnlyInLineEnding,
  type WorktreeMaterializationEntry,
  type WorktreeSettlementReceipt
} from '../../../../runtime-state/worktree-settlement.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  chunkBlobEntries,
  chunkByCount,
  gitReadBytes,
  gitReadText,
  parseNulUtf8,
  readBlobEntryBatch,
  readCommitBlobInventory,
  readOptionalGitConfig,
  resolveExactHeadCommit,
  withIsolatedTextAttributeReader,
  type GitTreeBlobEntry
} from '../git/git-read.ts';

const DEFAULT_REPOSITORY_ROOT = process.cwd();
const SETTLEMENT_ATTRIBUTE_BATCH_MAX_ITEMS = 2048;
const SETTLEMENT_BLOB_BATCH_MAX_BYTES = 24 * 1024 * 1024;
const SETTLEMENT_BLOB_BATCH_MAX_ITEMS = 1024;

interface SettlementOptions {
  readonly fix?: boolean;
  readonly deadlineAtUnixMs?: number;
  readonly signal?: AbortSignal;
}

type WorktreeSettlementOperationEnvelope = Readonly<{
  operation: BoundSemanticOperation;
  budget: GitReadSessionBudget;
  deadlineAtUnixMs: number;
}>;

const WORKTREE_SETTLEMENT_OPERATION = 'development.worktree-settlement';
const WORKTREE_SETTLEMENT_REQUIREMENT = 'repository.worktree-settlement';

function compileWorktreeSettlementOperation(
  repositoryRoot: string,
  options: SettlementOptions
): WorktreeSettlementOperationEnvelope {
  const startedAtUnixMs = Date.now();
  const localDeadlineAtUnixMs = startedAtUnixMs + GIT_READ_OPERATION_BUDGET.deadlineMs;
  const deadlineAtUnixMs = Math.min(
    options.deadlineAtUnixMs ?? localDeadlineAtUnixMs,
    localDeadlineAtUnixMs
  );
  const durationMs = deadlineAtUnixMs - startedAtUnixMs;
  if (!Number.isSafeInteger(deadlineAtUnixMs)
      || !Number.isSafeInteger(durationMs)
      || durationMs < 1) {
    throw new Error('Worktree settlement requires one future absolute deadline.');
  }
  const budget = Object.freeze({
    ...GIT_READ_OPERATION_BUDGET,
    deadlineMs: durationMs
  });
  const admittedProcessOutputBytes = budget.maxProcesses
    * (budget.maxCommandStdoutBytes + budget.maxCommandStderrBytes);
  if (!Number.isSafeInteger(admittedProcessOutputBytes)) {
    throw new Error('Worktree settlement process output envelope is not representable.');
  }
  const contractDigest = sha256({
    operation: WORKTREE_SETTLEMENT_OPERATION,
    resultSchema: WORKTREE_SETTLEMENT_SCHEMA,
    observation: 'exact-head-index-worktree-materialization'
  }) as OperationDigest;
  const providerIdentityDigest = sha256({
    provider: 'external-capabilities.git-read',
    capability: 'exact-repository-observation'
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: WORKTREE_SETTLEMENT_OPERATION,
    intentDigest: sha256({
      repositoryRoot,
      repairRequested: options.fix === true
    }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: budget.maxStdinBytes },
      // The physical process session reserves full per-child stream ceilings;
      // GitRead remains the sole owner of actual cumulative stream accounting.
      { resource: 'output-bytes', maximum: admittedProcessOutputBytes },
      { resource: 'processes', maximum: budget.maxProcesses },
      { resource: 'records', maximum: budget.maxRecords }
    ],
    requirements: [{
      id: WORKTREE_SETTLEMENT_REQUIREMENT,
      contractDigest,
      effectKinds: ['process', 'provider'],
      failureKinds: [
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.drift',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return Object.freeze({
    operation: bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId: WORKTREE_SETTLEMENT_REQUIREMENT,
      contractDigest,
      providerIdentityDigest
    })]),
    budget,
    deadlineAtUnixMs
  });
}

interface PorcelainStatus {
  readonly dirty: number;
  readonly untracked: number;
}

type GovernedDeclaration = 'lf' | 'crlf';

type GovernedSelection = Readonly<{
  files: readonly GitTreeBlobEntry[];
  declarations: ReadonlyMap<string, GovernedDeclaration>;
}>;

async function getPorcelainStatus(session: GitReadSession): Promise<PorcelainStatus> {
  const fields = parseNulUtf8(
    await gitReadBytes(
      session,
      ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
      { maxBuffer: 32 * 1024 * 1024, label: 'git status' }
    ),
    'git status'
  );
  const recordFailure = session.consumeRecords(fields.length);
  if (recordFailure !== null) {
    throw new Error(`git status exceeded the Git read record budget: ${recordFailure.reason}`);
  }
  let dirty = 0;
  let untracked = 0;
  for (let index = 0; index < fields.length;) {
    const entry = fields[index++];
    if (entry === undefined || entry.length < 3 || entry[2] !== ' ') {
      throw new Error('git status returned an invalid porcelain record');
    }
    const x = entry[0]!;
    const y = entry[1]!;
    if (x === '?' && y === '?') untracked += 1;
    else dirty += 1;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      if (index >= fields.length) throw new Error('git status returned an incomplete rename/copy record');
      index += 1;
    }
  }
  return Object.freeze({ dirty, untracked });
}

function describeAuthorityFailure(error: unknown): string {
  if (!(error instanceof GitReadAuthorityError)) {
    return error instanceof Error ? error.message : String(error);
  }
  const failure = error.failure;
  const reason = 'reason' in failure && typeof failure.reason === 'string'
    ? failure.reason
    : 'unknown';
  const detailDigest = 'detailDigest' in failure
    && typeof failure.detailDigest === 'string'
    ? ` detailDigest=${failure.detailDigest}`
    : '';
  const detail = 'detail' in failure && typeof failure.detail === 'string'
    ? ` ${failure.detail.slice(0, 512)}`
    : '';
  return `reason=${reason}${detailDigest}${detail}`;
}

function absoluteGitPath(repositoryRoot: string, gitPath: string): string {
  const absolutePath = path.resolve(repositoryRoot, ...gitPath.split('/'));
  const relative = path.relative(repositoryRoot, absolutePath);
  if (
    relative === '' ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Settlement Git path escapes the repository: ${gitPath}`);
  }
  return absolutePath;
}

function readWorktreeOrdinaryBytes(
  repositoryRoot: string,
  gitPath: string,
  parents: Map<string, PhysicalDirectoryIdentity>
): Buffer {
  const absolutePath = absoluteGitPath(repositoryRoot, gitPath);
  const parentPath = path.dirname(absolutePath);
  let parent = parents.get(parentPath);
  if (parent === undefined) {
    parent = inspectNoFollowDirectoryChain(
      parentPath,
      `Worktree settlement parent for ${gitPath}`
    ).target;
    parents.set(parentPath, parent);
  }
  const bytes = readNoFollowOrdinaryFile(parent, path.basename(absolutePath));
  if (bytes === null) {
    throw new Error(`Governed worktree file disappeared during settlement observation: ${gitPath}`);
  }
  return Buffer.from(bytes);
}

async function selectGovernedFiles(
  session: GitReadSession,
  sourceCommit: string,
  files: readonly GitTreeBlobEntry[]
): Promise<GovernedSelection> {
  const selected: GitTreeBlobEntry[] = [];
  const declarations = new Map<string, GovernedDeclaration>();
  await withIsolatedTextAttributeReader(session, sourceCommit, async (readAttributes) => {
    for (const batch of chunkByCount(files, SETTLEMENT_ATTRIBUTE_BATCH_MAX_ITEMS)) {
      const attributes = await readAttributes(batch.map((entry) => entry.path));
      for (const file of batch) {
        const attrs = attributes.get(file.path);
        if (attrs === undefined) {
          throw new Error(`Settlement attribute observation is incomplete for ${file.path}`);
        }
        if (attrs.textAttr === 'set' && (attrs.eolAttr === 'lf' || attrs.eolAttr === 'crlf')) {
          selected.push(file);
          declarations.set(file.path, attrs.eolAttr);
        }
      }
    }
  });
  return Object.freeze({
    files: Object.freeze(selected),
    declarations
  });
}

async function scanGovernedFiles(
  session: GitReadSession,
  repositoryRoot: string,
  selection: GovernedSelection
): Promise<Readonly<{ scanned: number; driftEntries: WorktreeMaterializationEntry[] }>> {
  let scanned = 0;
  const driftEntries: WorktreeMaterializationEntry[] = [];
  for (const batch of chunkBlobEntries(selection.files, {
    maxBytes: SETTLEMENT_BLOB_BATCH_MAX_BYTES,
    maxItems: SETTLEMENT_BLOB_BATCH_MAX_ITEMS
  })) {
    const blobs = await readBlobEntryBatch(session, batch);
    const retainedParents = new Map<string, PhysicalDirectoryIdentity>();
    for (const file of batch) {
      const declared = selection.declarations.get(file.path);
      const blobBytes = blobs.get(file.objectId);
      if (declared === undefined || blobBytes === undefined) {
        throw new Error(`Settlement governed observation is incomplete for ${file.path}`);
      }
      const worktreeBytes = readWorktreeOrdinaryBytes(repositoryRoot, file.path, retainedParents);
      scanned += 1;
      const blobLineEnding = detectLineEnding(new Uint8Array(blobBytes));
      const worktreeLineEnding = detectLineEnding(new Uint8Array(worktreeBytes));
      if (worktreeLineEnding !== blobLineEnding && (blobLineEnding === 'lf' || blobLineEnding === 'crlf')) {
        driftEntries.push({
          path: file.path,
          declared,
          blobLineEnding,
          worktreeLineEnding,
          lineEndingOnlyDifference: differsOnlyInLineEnding(
            new Uint8Array(blobBytes),
            new Uint8Array(worktreeBytes)
          )
        });
      }
    }
  }
  return Object.freeze({ scanned, driftEntries });
}

async function repositoryStillMatchesObservation(
  session: GitReadSession,
  sourceCommit: string
): Promise<boolean> {
  try {
    if (await resolveExactHeadCommit(session) !== sourceCommit) return false;
    const status = await getPorcelainStatus(session);
    return status.dirty === 0 && status.untracked === 0;
  } catch {
    return false;
  }
}

function makeReceipt(input: Omit<WorktreeSettlementReceipt, 'schema' | 'generatedAt'>): WorktreeSettlementReceipt {
  return {
    schema: WORKTREE_SETTLEMENT_SCHEMA,
    generatedAt: new Date().toISOString(),
    ...input
  };
}

async function runSettlementWithSession(
  session: GitReadSession,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  options: SettlementOptions = {}
): Promise<WorktreeSettlementReceipt> {
  const root = path.resolve(repositoryRoot);
  const gitVersion = (await gitReadText(session, ['--version'], { maxBuffer: 1024, label: 'git --version' })).trim();
  const coreAutocrlf = await readOptionalGitConfig(session, 'core.autocrlf');
  const coreEol = await readOptionalGitConfig(session, 'core.eol');
  let initialStatus: PorcelainStatus;
  try {
    initialStatus = await getPorcelainStatus(session);
  } catch (error) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha: null,
      totalFiles: 0,
      driftEntries: [],
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Settlement status observation failed closed: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  let sourceCommit: string;
  let files: Awaited<ReturnType<typeof readCommitBlobInventory>>;
  try {
    sourceCommit = await resolveExactHeadCommit(session);
    files = await readCommitBlobInventory(session, sourceCommit);
  } catch (error) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha: null,
      totalFiles: 0,
      driftEntries: [],
      untrackedCount: initialStatus.untracked,
      dirtyCount: initialStatus.dirty,
      summary: `Settlement observation could not bind one exact HEAD tree: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  const gitattributesBlobSha = files.find((entry) => entry.path === '.gitattributes')?.objectId ?? null;
  if (initialStatus.dirty > 0) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'dirty',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries: [],
      untrackedCount: initialStatus.untracked,
      dirtyCount: initialStatus.dirty,
      summary: `Working tree has ${initialStatus.dirty} dirty file(s); settlement blocked. Commit or stash before settling.`
    });
  }
  if (initialStatus.untracked > 0) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'untracked',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries: [],
      untrackedCount: initialStatus.untracked,
      dirtyCount: initialStatus.dirty,
      summary: `Working tree has ${initialStatus.untracked} untracked file(s); settlement blocked. Track or remove before settling.`
    });
  }

  let observation: Awaited<ReturnType<typeof scanGovernedFiles>>;
  try {
    const selection = await selectGovernedFiles(session, sourceCommit, files);
    observation = await scanGovernedFiles(session, root, selection);
  } catch (error) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries: [],
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Settlement exact Git/physical observation failed closed: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  if (!(await repositoryStillMatchesObservation(session, sourceCommit))) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries: observation.driftEntries,
      untrackedCount: 0,
      dirtyCount: 0,
      summary: 'Repository HEAD/index/worktree changed during settlement observation; retry from a stable state.'
    });
  }

  if (observation.driftEntries.length === 0) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'settled',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries: [],
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Worktree settled: clean, ${observation.scanned} governed text file(s) materialize canonical bytes.`
    });
  }

  return makeReceipt({
    repositoryRoot: root,
    status: options.fix ? 'unsafe' : 'materialization-drift',
    gitVersion,
    coreAutocrlf,
    coreEol,
    gitattributesBlobSha,
    totalFiles: files.length,
    driftEntries: observation.driftEntries,
    untrackedCount: 0,
    dirtyCount: 0,
    summary: options.fix
      ? 'Automatic --fix is disabled: Git checkout cannot conditionally replace the retained worktree preimage, so a concurrent external writer could be overwritten without detectable final drift. Use an explicit authoring operation after reviewing the current bytes.'
      : `Clean working tree but ${observation.driftEntries.length} file(s) materialize non-canonical bytes. Automatic repair remains disabled until the write owner can prove retained-preimage CAS against concurrent writers.`
  });
}

export async function runSettlement(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  options: SettlementOptions = {}
): Promise<WorktreeSettlementReceipt> {
  const root = path.resolve(repositoryRoot);
  try {
    const envelope = compileWorktreeSettlementOperation(root, options);
    return await withAuthorityGitReadSession(
      {
        cwd: root,
        operation: envelope.operation,
        budget: envelope.budget,
        deadlineAtUnixMs: envelope.deadlineAtUnixMs,
        ...(options.signal === undefined ? {} : { signal: options.signal })
      },
      (session) => runSettlementWithSession(session, root, options)
    );
  } catch (error) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion: '<unavailable>',
      coreAutocrlf: '<unavailable>',
      coreEol: '<unavailable>',
      gitattributesBlobSha: null,
      totalFiles: 0,
      driftEntries: [],
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Git read authority was unavailable; settlement stopped before any untrusted transport: ${describeAuthorityFailure(error)}`
    });
  }
}
