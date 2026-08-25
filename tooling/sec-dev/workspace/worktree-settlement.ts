import path from 'node:path';

import { withIsolatedTextAttributeReader } from '../../../platform/git/attributes.ts';
import {
  chunkBlobEntries,
  chunkByCount,
  readBlobEntryBatch,
  readCommitBlobInventory,
  readGitConfig,
  readGitVersion,
  readGitWorkingTreeStatus,
  resolveExactHeadCommit,
  type GitTreeBlobEntry
} from '../../../platform/git/objects.ts';
import {
  inspectNoFollowDirectoryChainV1,
  readNoFollowOrdinaryFileV1,
  type PhysicalDirectoryIdentityV1
} from '../../../platform/shared/physical-no-follow.ts';
import {
  WORKTREE_SETTLEMENT_SCHEMA_V1,
  detectLineEnding,
  differsOnlyInLineEnding,
  type WorktreeMaterializationEntry,
  type WorktreeSettlementReceipt
} from '../../../platform/shared/worktree-settlement-contract.ts';

const DEFAULT_REPOSITORY_ROOT = process.cwd();
const SETTLEMENT_ATTRIBUTE_BATCH_MAX_ITEMS = 2048;
const SETTLEMENT_BLOB_BATCH_MAX_BYTES = 64 * 1024 * 1024;
const SETTLEMENT_BLOB_BATCH_MAX_ITEMS = 1024;

interface PorcelainStatus {
  readonly dirty: number;
  readonly untracked: number;
}

type GovernedDeclaration = 'lf' | 'crlf';

type GovernedSelection = Readonly<{
  files: readonly GitTreeBlobEntry[];
  declarations: ReadonlyMap<string, GovernedDeclaration>;
}>;

function getPorcelainStatus(repositoryRoot: string): PorcelainStatus {
  const observation = readGitWorkingTreeStatus(repositoryRoot);
  const fields = observation;
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
  parents: Map<string, PhysicalDirectoryIdentityV1>
): Buffer {
  const absolutePath = absoluteGitPath(repositoryRoot, gitPath);
  const parentPath = path.dirname(absolutePath);
  let parent = parents.get(parentPath);
  if (parent === undefined) {
    parent = inspectNoFollowDirectoryChainV1(
      parentPath,
      `Worktree settlement parent for ${gitPath}`
    ).target;
    parents.set(parentPath, parent);
  }
  const bytes = readNoFollowOrdinaryFileV1(parent, path.basename(absolutePath));
  if (bytes === null) {
    throw new Error(`Governed worktree file disappeared during settlement observation: ${gitPath}`);
  }
  return Buffer.from(bytes);
}

function selectGovernedFiles(
  repositoryRoot: string,
  sourceCommit: string,
  files: readonly GitTreeBlobEntry[]
): GovernedSelection {
  const selected: GitTreeBlobEntry[] = [];
  const declarations = new Map<string, GovernedDeclaration>();
  withIsolatedTextAttributeReader(repositoryRoot, sourceCommit, (readAttributes) => {
    for (const batch of chunkByCount(files, SETTLEMENT_ATTRIBUTE_BATCH_MAX_ITEMS)) {
      const attributes = readAttributes(batch.map((entry) => entry.path));
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

function scanGovernedFiles(
  repositoryRoot: string,
  selection: GovernedSelection
): Readonly<{ scanned: number; driftEntries: WorktreeMaterializationEntry[] }> {
  let scanned = 0;
  const driftEntries: WorktreeMaterializationEntry[] = [];
  for (const batch of chunkBlobEntries(selection.files, {
    maxBytes: SETTLEMENT_BLOB_BATCH_MAX_BYTES,
    maxItems: SETTLEMENT_BLOB_BATCH_MAX_ITEMS
  })) {
    const blobs = readBlobEntryBatch(repositoryRoot, batch);
    const retainedParents = new Map<string, PhysicalDirectoryIdentityV1>();
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
  repositoryRoot: string,
  sourceCommit: string
): Promise<boolean> {
  try {
    if (resolveExactHeadCommit(repositoryRoot) !== sourceCommit) return false;
    const status = getPorcelainStatus(repositoryRoot);
    return status.dirty === 0 && status.untracked === 0;
  } catch {
    return false;
  }
}

function makeReceipt(input: Omit<WorktreeSettlementReceipt, 'schema' | 'generatedAt'>): WorktreeSettlementReceipt {
  return {
    schema: WORKTREE_SETTLEMENT_SCHEMA_V1,
    generatedAt: new Date().toISOString(),
    ...input
  };
}

export function formatWorktreeSettlementReceipt(receipt: WorktreeSettlementReceipt): string {
  const lines: string[] = [];
  lines.push('Worktree Settlement Receipt');
  lines.push('  schema: ' + receipt.schema);
  lines.push('  generatedAt: ' + receipt.generatedAt);
  lines.push('  repositoryRoot: ' + receipt.repositoryRoot);
  lines.push('  status: ' + receipt.status);
  lines.push('  gitVersion: ' + receipt.gitVersion);
  lines.push('  coreAutocrlf: ' + receipt.coreAutocrlf);
  lines.push('  coreEol: ' + receipt.coreEol);
  lines.push('  gitattributesBlobSha: ' + (receipt.gitattributesBlobSha ?? '<none>'));
  lines.push('  totalFiles: ' + receipt.totalFiles);
  lines.push('  untrackedCount: ' + receipt.untrackedCount);
  lines.push('  dirtyCount: ' + receipt.dirtyCount);
  lines.push('  driftEntries: ' + receipt.driftEntries.length);
  lines.push('');
  lines.push('  summary: ' + receipt.summary);
  if (receipt.driftEntries.length > 0) {
    lines.push('');
    lines.push('  Drift entries:');
    const maxShow = Math.min(receipt.driftEntries.length, 30);
    for (let index = 0; index < maxShow; index += 1) {
      const entry = receipt.driftEntries[index]!;
      lines.push('    ' + entry.path + ' [declared=' + entry.declared + ' blob=' + entry.blobLineEnding + ' worktree=' + entry.worktreeLineEnding + ' lineEndingOnly=' + entry.lineEndingOnlyDifference + ']');
    }
    if (receipt.driftEntries.length > maxShow) {
      lines.push('    ... and ' + (receipt.driftEntries.length - maxShow) + ' more');
    }
  }
  return lines.join('\n');
}

export async function runSettlement(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  options: { fix?: boolean } = {}
): Promise<WorktreeSettlementReceipt> {
  const root = path.resolve(repositoryRoot);
  const gitVersion = readGitVersion(root);
  const coreAutocrlf = readGitConfig(root, 'core.autocrlf') ?? '<unset>';
  const coreEol = readGitConfig(root, 'core.eol') ?? '<unset>';
  let initialStatus: PorcelainStatus;
  try {
    initialStatus = getPorcelainStatus(root);
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
  let files: ReturnType<typeof readCommitBlobInventory>;
  try {
    sourceCommit = resolveExactHeadCommit(root);
    files = readCommitBlobInventory(root, sourceCommit);
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

  let observation: ReturnType<typeof scanGovernedFiles>;
  try {
    const selection = selectGovernedFiles(root, sourceCommit, files);
    observation = scanGovernedFiles(root, selection);
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

  if (!(await repositoryStillMatchesObservation(root, sourceCommit))) {
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
