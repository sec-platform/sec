#!/usr/bin/env bun
/**
 * SEC Worktree Settlement Preflight (Issue #209 Phase A).
 *
 * Non-destructive preflight that reads Git attributes, index/blob, and worktree
 * bytes to verify the worktree is settled to canonical bytes. Dirty/untracked
 * or unsafe cases block (no reset/stash/overwrite). Emits a settlement receipt.
 *
 * Usage:
 *   bun scripts/codex/worktree-settlement.ts [--json [--compact]] [--fix]
 *
 * --fix: re-checkout governed text files to enforce canonical LF materialization.
 *        Only allowed when working tree is clean; never resets/stashes/overwrites
 *        dirty or untracked content.
 *
 * Output:
 *   JSON receipt (WorktreeSettlementReceipt) or human-readable summary.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  WORKTREE_SETTLEMENT_SCHEMA_V1,
  detectLineEnding,
  differsOnlyInLineEnding,
  type WorktreeMaterializationEntry,
  type WorktreeSettlementReceipt,
  type WorktreeSettlementStatus
} from '../../platform/shared/worktree-settlement-contract.ts';

import {
  GOVERNED_TEXT_EXTENSIONS
} from '../../platform/shared/text-byte-census-contract.ts';

const DEFAULT_REPOSITORY_ROOT = process.cwd();

type GitCommandResult = { status: number | null; stdout: Buffer; stderr: Buffer };

function runGit(repositoryRoot: string, args: readonly string[], maxBuffer: number): GitCommandResult {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer,
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(String(result.stderr ?? ''))
  };
}

function executeGit(repositoryRoot: string, args: readonly string[], maxBuffer: number, label: string): Buffer {
  const result = runGit(repositoryRoot, args, maxBuffer);
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(label + (stderr ? ': ' + stderr : '.'));
  }
  return result.stdout;
}

function getGitVersion(): string {
  const result = runGit(process.cwd(), ['--version'], 1024);
  return result.stdout.toString('utf8').trim();
}

function getConfig(key: string): string {
  const result = runGit(process.cwd(), ['config', '--get', key], 1024);
  if (result.status !== 0 || result.stdout.length === 0) return '<unset>';
  return result.stdout.toString('utf8').trim();
}

function getPorcelainStatus(repositoryRoot: string): { dirty: number; untracked: number; lines: string[] } {
  const stdout = executeGit(repositoryRoot, ['status', '--porcelain', '-z'], 16 * 1024 * 1024, 'git status failed');
  if (stdout.length === 0) return { dirty: 0, untracked: 0, lines: [] };
  const entries = stdout.toString('binary').split('\0').filter((p) => p.length > 0);
  let dirty = 0;
  let untracked = 0;
  for (const entry of entries) {
    const code = entry.charAt(0);
    if (code === '?') {
      untracked += 1;
    } else {
      dirty += 1;
    }
  }
  return { dirty, untracked, lines: entries };
}

function listTrackedFiles(repositoryRoot: string): string[] {
  const stdout = executeGit(repositoryRoot, ['ls-files', '-z'], 16 * 1024 * 1024, 'git ls-files failed');
  if (stdout.length === 0) return [];
  return stdout.toString('binary').split('\0').filter((p) => p.length > 0);
}

function getBlobSha(repositoryRoot: string, filePath: string): string | null {
  const result = runGit(repositoryRoot, ['ls-tree', 'HEAD', '--', filePath], 1024 * 1024);
  if (result.status !== 0 || result.stdout.length === 0) return null;
  const line = result.stdout.toString('utf8').trim();
  const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})\t/u.exec(line);
  if (!match || match[2] !== 'blob') return null;
  return match[3]!;
}

function readBlobBytes(repositoryRoot: string, blobSha: string): Buffer {
  return executeGit(repositoryRoot, ['cat-file', 'blob', blobSha], 64 * 1024 * 1024, 'git cat-file blob failed');
}

function checkAttributes(repositoryRoot: string, filePath: string): {
  textAttr: 'set' | 'unset' | 'unspecified';
  eolAttr: 'lf' | 'crlf' | 'unspecified';
} {
  const result = runGit(repositoryRoot, ['check-attr', '-a', '--', filePath], 64 * 1024);
  if (result.status !== 0) {
    return { textAttr: 'unspecified', eolAttr: 'unspecified' };
  }
  const lines = result.stdout.toString('utf8').split('\n');
  let textAttr: 'set' | 'unset' | 'unspecified' = 'unspecified';
  let eolAttr: 'lf' | 'crlf' | 'unspecified' = 'unspecified';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const lastColon = trimmed.lastIndexOf(':');
    if (lastColon <= 0) continue;
    const value = trimmed.slice(lastColon + 1).trim();
    const beforeValue = trimmed.slice(0, lastColon).trim();
    const secondLastColon = beforeValue.lastIndexOf(':');
    if (secondLastColon <= 0) continue;
    const attr = beforeValue.slice(secondLastColon + 1).trim();
    if (attr === 'text') {
      if (value === 'set') textAttr = 'set';
      else if (value === 'unset') textAttr = 'unset';
    } else if (attr === 'eol') {
      if (value === 'lf') eolAttr = 'lf';
      else if (value === 'crlf') eolAttr = 'crlf';
    }
  }
  return { textAttr, eolAttr };
}

function isGovernedText(filePath: string, textAttr: 'set' | 'unset' | 'unspecified', eolAttr: 'lf' | 'crlf' | 'unspecified'): boolean {
  if (textAttr === 'set' && (eolAttr === 'lf' || eolAttr === 'crlf')) return true;
  const ext = filePath.match(/\.([^.\/]+)$/u)?.[1]?.toLowerCase();
  return ext !== undefined && GOVERNED_TEXT_EXTENSIONS.has(ext);
}

function readWorktreeBytes(repositoryRoot: string, filePath: string): Buffer | null {
  try {
    const absolute = path.join(repositoryRoot, ...filePath.split('/'));
    return readFileSync(absolute);
  } catch {
    return null;
  }
}

function formatReceiptText(receipt: WorktreeSettlementReceipt): string {
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
    for (let i = 0; i < maxShow; i += 1) {
      const e = receipt.driftEntries[i]!;
      lines.push('    ' + e.path + ' [declared=' + e.declared + ' blob=' + e.blobLineEnding + ' worktree=' + e.worktreeLineEnding + ' lineEndingOnly=' + e.lineEndingOnlyDifference + ']');
    }
    if (receipt.driftEntries.length > maxShow) {
      lines.push('    ... and ' + (receipt.driftEntries.length - maxShow) + ' more');
    }
  }
  return lines.join('\n');
}

export async function runSettlement(repositoryRoot = DEFAULT_REPOSITORY_ROOT, options: { fix?: boolean } = {}): Promise<WorktreeSettlementReceipt> {
  const root = path.resolve(repositoryRoot);
  const gitVersion = getGitVersion();
  const coreAutocrlf = getConfig('core.autocrlf');
  const coreEol = getConfig('core.eol');

  const gitattributesBlobSha = getBlobSha(root, '.gitattributes');
  const files = listTrackedFiles(root);
  const porcelain = getPorcelainStatus(root);

  let status: WorktreeSettlementStatus;
  const driftEntries: WorktreeMaterializationEntry[] = [];
  let summary: string;

  if (porcelain.dirty > 0) {
    status = 'dirty';
    summary = 'Working tree has ' + porcelain.dirty + ' dirty file(s); settlement blocked. Commit or stash before settling.';
  } else if (porcelain.untracked > 0) {
    status = 'untracked';
    summary = 'Working tree has ' + porcelain.untracked + ' untracked file(s); settlement blocked. Track or remove before settling.';
  } else {
    // Clean working tree — check materialization drift
    let scanned = 0;
    for (const filePath of files) {
      const { textAttr, eolAttr } = checkAttributes(root, filePath);
      const declared: 'lf' | 'crlf' | 'binary' | 'unspecified' =
        textAttr === 'unset' ? 'binary' :
        textAttr === 'set' && eolAttr === 'lf' ? 'lf' :
        textAttr === 'set' && eolAttr === 'crlf' ? 'crlf' :
        'unspecified';
      // Only check files explicitly declared as text eol=lf or text eol=crlf
      if (declared !== 'lf' && declared !== 'crlf') continue;

      const blobSha = getBlobSha(root, filePath);
      if (blobSha === null) continue;
      const blobBytes = readBlobBytes(root, blobSha);
      const worktreeBytes = readWorktreeBytes(root, filePath);
      if (worktreeBytes === null) continue;
      scanned += 1;

      const blobLineEnding = detectLineEnding(new Uint8Array(blobBytes));
      const worktreeLineEnding = detectLineEnding(new Uint8Array(worktreeBytes));
      const lineEndingOnlyDifference = differsOnlyInLineEnding(new Uint8Array(blobBytes), new Uint8Array(worktreeBytes));

      // Drift: worktree materializes CRLF but blob is LF (or vice versa)
      if (worktreeLineEnding !== blobLineEnding && (blobLineEnding === 'lf' || blobLineEnding === 'crlf')) {
        driftEntries.push({
          path: filePath,
          declared,
          blobLineEnding,
          worktreeLineEnding,
          lineEndingOnlyDifference
        });
      }
    }

    if (driftEntries.length > 0) {
      status = 'materialization-drift';
      summary = 'Clean working tree but ' + driftEntries.length + ' file(s) materialize non-canonical bytes. Run with --fix to re-checkout governed text.';

      if (options.fix) {
        // Re-checkout governed text files to enforce canonical materialization
        const driftPaths = driftEntries.map((e) => e.path);
        const args = ['checkout', '--', ...driftPaths];
        executeGit(root, args, 16 * 1024 * 1024, 'git checkout --fix failed');
        // Re-scan after fix
        const fixedDrift: WorktreeMaterializationEntry[] = [];
        for (const entry of driftEntries) {
          const worktreeBytes = readWorktreeBytes(root, entry.path);
          if (worktreeBytes === null) continue;
          const newWorktreeLineEnding = detectLineEnding(new Uint8Array(worktreeBytes));
          if (newWorktreeLineEnding !== entry.blobLineEnding) {
            fixedDrift.push({ ...entry, worktreeLineEnding: newWorktreeLineEnding });
          }
        }
        if (fixedDrift.length === 0) {
          status = 'settled';
          summary = 'Settled after --fix: ' + driftEntries.length + ' file(s) re-materialized to canonical bytes.';
          driftEntries.length = 0;
        } else {
          driftEntries.length = 0;
          driftEntries.push(...fixedDrift);
          status = 'unsafe';
          summary = 'After --fix, ' + fixedDrift.length + ' file(s) still drift; manual investigation required.';
        }
      }
    } else {
      status = 'settled';
      summary = 'Worktree settled: clean, ' + scanned + ' governed text file(s) materialize canonical bytes.';
    }
  }

  const receipt: WorktreeSettlementReceipt = {
    schema: WORKTREE_SETTLEMENT_SCHEMA_V1,
    generatedAt: new Date().toISOString(),
    repositoryRoot: root,
    status,
    gitVersion,
    coreAutocrlf,
    coreEol,
    gitattributesBlobSha,
    totalFiles: files.length,
    driftEntries,
    untrackedCount: porcelain.untracked,
    dirtyCount: porcelain.dirty,
    summary
  };

  return receipt;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const compact = args.includes('--compact');
  const fix = args.includes('--fix');

  if (compact && !json) {
    throw new Error('Usage: worktree-settlement [--json [--compact]] [--fix]');
  }

  const receipt = await runSettlement(undefined, { fix });

  if (json) {
    if (compact) {
      console.log(JSON.stringify({
        schema: receipt.schema,
        status: receipt.status,
        totalFiles: receipt.totalFiles,
        driftCount: receipt.driftEntries.length,
        untrackedCount: receipt.untrackedCount,
        dirtyCount: receipt.dirtyCount,
        coreAutocrlf: receipt.coreAutocrlf,
        summary: receipt.summary
      }));
    } else {
      console.log(JSON.stringify(receipt, null, 2));
    }
  } else {
    console.log(formatReceiptText(receipt));
  }

  if (receipt.status !== 'settled') {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
