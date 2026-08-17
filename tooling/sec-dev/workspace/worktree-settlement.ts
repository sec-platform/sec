import fs from 'node:fs/promises';
import path from 'node:path';

import {
  WORKTREE_SETTLEMENT_SCHEMA_V1,
  detectLineEnding,
  differsOnlyInLineEnding,
  type WorktreeMaterializationEntry,
  type WorktreeSettlementReceipt
} from '../../../platform/shared/worktree-settlement-contract.ts';
import {
  gitReadBytes,
  gitReadText,
  parseNulUtf8,
  readBlobBatch,
  readCommitBlobInventory,
  readOptionalGitConfig,
  readTextAttributesBatch,
  resolveExactHeadCommit
} from '../git/git-read.ts';

const DEFAULT_REPOSITORY_ROOT = process.cwd();

interface PorcelainStatus {
  readonly dirty: number;
  readonly untracked: number;
}

function getPorcelainStatus(repositoryRoot: string): PorcelainStatus {
  const fields = parseNulUtf8(
    gitReadBytes(
      repositoryRoot,
      ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
      { maxBuffer: 32 * 1024 * 1024, label: 'git status' }
    ),
    'git status'
  );
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
      if (index >= fields.length) {
        throw new Error('git status returned an incomplete rename/copy record');
      }
      index += 1;
    }
  }
  return Object.freeze({ dirty, untracked });
}

function declaredLineEnding(input: {
  textAttr: 'set' | 'unset' | 'unspecified';
  eolAttr: 'lf' | 'crlf' | 'unspecified';
}): WorktreeMaterializationEntry['declared'] {
  if (input.textAttr === 'unset') return 'binary';
  if (input.textAttr === 'set' && input.eolAttr === 'lf') return 'lf';
  if (input.textAttr === 'set' && input.eolAttr === 'crlf') return 'crlf';
  return 'unspecified';
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
  const gitVersion = gitReadText(root, ['--version'], { maxBuffer: 1024, label: 'git --version' }).trim();
  const coreAutocrlf = readOptionalGitConfig(root, 'core.autocrlf');
  const coreEol = readOptionalGitConfig(root, 'core.eol');
  const initialStatus = getPorcelainStatus(root);

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

  const paths = files.map((entry) => entry.path);
  const objectIds = [...new Set(files.map((entry) => entry.objectId))];
  let blobs: ReadonlyMap<string, Buffer>;
  let attributes: ReturnType<typeof readTextAttributesBatch>;
  try {
    blobs = readBlobBatch(root, objectIds);
    attributes = readTextAttributesBatch(root, sourceCommit, paths);
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
      summary: `Settlement Git observation failed closed: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  let scanned = 0;
  const driftEntries: WorktreeMaterializationEntry[] = [];
  try {
    for (const file of files) {
      const attrs = attributes.get(file.path);
      const blobBytes = blobs.get(file.objectId);
      if (attrs === undefined || blobBytes === undefined) {
        throw new Error(`Settlement observation is incomplete for ${file.path}`);
      }
      const declared = declaredLineEnding(attrs);
      if (declared !== 'lf' && declared !== 'crlf') continue;

      const worktreeBytes = await fs.readFile(path.join(root, ...file.path.split('/')));
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
  } catch (error) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries,
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Settlement physical observation failed closed: ${error instanceof Error ? error.message : String(error)}`
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
      driftEntries,
      untrackedCount: 0,
      dirtyCount: 0,
      summary: 'Repository HEAD/index/worktree changed during settlement observation; retry from a stable state.'
    });
  }

  if (driftEntries.length === 0) {
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
      summary: `Worktree settled: clean, ${scanned} governed text file(s) materialize canonical bytes.`
    });
  }

  if (!options.fix) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'materialization-drift',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries,
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Clean working tree but ${driftEntries.length} file(s) materialize non-canonical bytes. Run with --fix to re-checkout governed text.`
    });
  }

  try {
    gitReadBytes(
      root,
      ['checkout', '--', ...driftEntries.map((entry) => entry.path)],
      { maxBuffer: 32 * 1024 * 1024, label: 'git checkout --fix' }
    );
  } catch (error) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries,
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Settlement fix could not re-materialize governed files: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  const fixedDrift: WorktreeMaterializationEntry[] = [];
  try {
    for (const entry of driftEntries) {
      const worktreeBytes = await fs.readFile(path.join(root, ...entry.path.split('/')));
      const newWorktreeLineEnding = detectLineEnding(new Uint8Array(worktreeBytes));
      if (newWorktreeLineEnding !== entry.blobLineEnding) {
        fixedDrift.push({ ...entry, worktreeLineEnding: newWorktreeLineEnding });
      }
    }
  } catch (error) {
    return makeReceipt({
      repositoryRoot: root,
      status: 'unsafe',
      gitVersion,
      coreAutocrlf,
      coreEol,
      gitattributesBlobSha,
      totalFiles: files.length,
      driftEntries,
      untrackedCount: 0,
      dirtyCount: 0,
      summary: `Settlement fix readback failed closed: ${error instanceof Error ? error.message : String(error)}`
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
      driftEntries: fixedDrift,
      untrackedCount: 0,
      dirtyCount: 0,
      summary: 'Repository HEAD/index/worktree changed during settlement fix/readback; retry from a stable state.'
    });
  }

  return makeReceipt({
    repositoryRoot: root,
    status: fixedDrift.length === 0 ? 'settled' : 'unsafe',
    gitVersion,
    coreAutocrlf,
    coreEol,
    gitattributesBlobSha,
    totalFiles: files.length,
    driftEntries: fixedDrift,
    untrackedCount: 0,
    dirtyCount: 0,
    summary: fixedDrift.length === 0
      ? `Settled after --fix: ${driftEntries.length} file(s) re-materialized to canonical bytes.`
      : `After --fix, ${fixedDrift.length} file(s) still drift; manual investigation required.`
  });
}
