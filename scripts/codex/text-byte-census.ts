#!/usr/bin/env bun
/**
 * SEC Text Byte Census Tool (Issue #209 Phase A).
 *
 * Scans tracked Git blobs, reads .gitattributes policy, and classifies each
 * blob as canonical-lf / explicit-crlf / binary / preserve-external / unknown.
 * Detects CRLF/mixed endings, UTF-8 BOM, NUL bytes, unknown encoding, and
 * attributes-missing on governed extensions. Unknown fail-closed.
 *
 * Usage:
 *   bun scripts/codex/text-byte-census.ts [--json [--compact]] [--fail-on <class>]
 *
 * Output:
 *   JSON report (TextByteCensusReport) or human-readable summary.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  TEXT_BYTE_CENSUS_SCHEMA_V1,
  classifyBlobBytes,
  createEmptyCensusReport,
  type TextByteAnomaly,
  type TextByteCensusEntry,
  type TextByteCensusReport,
  type TextByteClassification
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
    // git check-attr output format: "<path>: <attr>: <value>"
    // Split from the right to avoid matching the path's colons.
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

function getGitattributesBlobSha(repositoryRoot: string): string | null {
  return getBlobSha(repositoryRoot, '.gitattributes');
}

function formatTextReport(report: TextByteCensusReport): string {
  const lines: string[] = [];
  lines.push('Text Byte Census Report');
  lines.push('  schema: ' + report.schema);
  lines.push('  generatedAt: ' + report.generatedAt);
  lines.push('  repositoryRoot: ' + report.repositoryRoot);
  lines.push('  gitattributesBlobSha: ' + (report.gitattributesBlobSha ?? '<none>'));
  lines.push('  totalFiles: ' + report.totalFiles);
  lines.push('');
  lines.push('  Classification counts:');
  const classifications: TextByteClassification[] = ['canonical-lf', 'explicit-crlf', 'binary', 'preserve-external', 'unknown'];
  for (const c of classifications) {
    lines.push('    ' + c + ': ' + report.classificationCounts[c]);
  }
  lines.push('');
  lines.push('  Anomaly counts:');
  const anomalies: TextByteAnomaly[] = [
    'crlf-in-canonical-lf-blob',
    'lf-in-explicit-crlf-blob',
    'mixed-endings',
    'utf8-bom',
    'nul-byte',
    'unknown-encoding',
    'attributes-missing',
    'attributes-conflict'
  ];
  let anyAnomaly = false;
  for (const a of anomalies) {
    const count = report.anomalyCounts[a];
    if (count > 0) {
      lines.push('    ' + a + ': ' + count);
      anyAnomaly = true;
    }
  }
  if (!anyAnomaly) {
    lines.push('    (none)');
  }
  lines.push('');
  lines.push('  failClosed: ' + report.failClosed);
  if (report.flaggedEntries.length > 0) {
    lines.push('');
    lines.push('  Flagged entries (' + report.flaggedEntries.length + '):');
    const maxShow = Math.min(report.flaggedEntries.length, 50);
    for (let i = 0; i < maxShow; i += 1) {
      const e = report.flaggedEntries[i]!;
      lines.push('    ' + e.path + ' [' + e.classification + '/' + e.lineEnding + '] anomalies: ' + (e.anomalies.length === 0 ? '(none)' : e.anomalies.join(', ')));
    }
    if (report.flaggedEntries.length > maxShow) {
      lines.push('    ... and ' + (report.flaggedEntries.length - maxShow) + ' more');
    }
  }
  return lines.join('\n');
}

export async function runCensus(repositoryRoot = DEFAULT_REPOSITORY_ROOT): Promise<TextByteCensusReport> {
  const root = path.resolve(repositoryRoot);
  const files = listTrackedFiles(root);
  const gitattributesBlobSha = getGitattributesBlobSha(root);

  const base = createEmptyCensusReport();
  const flaggedEntries: TextByteCensusEntry[] = [];

  for (const filePath of files) {
    const blobSha = getBlobSha(root, filePath);
    if (blobSha === null) continue;
    const bytes = readBlobBytes(root, blobSha);
    const { textAttr, eolAttr } = checkAttributes(root, filePath);
    const { classification, lineEnding, anomalies } = classifyBlobBytes({
      path: filePath,
      bytes: new Uint8Array(bytes),
      textAttr,
      eolAttr
    });

    const entry: TextByteCensusEntry = {
      path: filePath,
      classification,
      byteSize: bytes.length,
      blobSha,
      lineEnding,
      anomalies
    };

    base.classificationCounts[classification] += 1;
    for (const a of anomalies) {
      base.anomalyCounts[a] += 1;
    }
    if (anomalies.length > 0 || classification === 'unknown') {
      flaggedEntries.push(entry);
    }
  }

  const failClosed = base.classificationCounts.unknown > 0
    || base.anomalyCounts['crlf-in-canonical-lf-blob'] > 0
    || base.anomalyCounts['mixed-endings'] > 0
    || base.anomalyCounts['unknown-encoding'] > 0
    || base.anomalyCounts['attributes-missing'] > 0;

  flaggedEntries.sort((a, b) => a.path.localeCompare(b.path));

  const report: TextByteCensusReport = {
    schema: TEXT_BYTE_CENSUS_SCHEMA_V1,
    generatedAt: new Date().toISOString(),
    repositoryRoot: root,
    gitattributesBlobSha,
    totalFiles: files.length,
    classificationCounts: base.classificationCounts,
    anomalyCounts: base.anomalyCounts,
    flaggedEntries,
    failClosed
  };

  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const compact = args.includes('--compact');
  const failOnIndex = args.indexOf('--fail-on');
  const failOn = failOnIndex >= 0 ? args[failOnIndex + 1] : undefined;

  if (compact && !json) {
    throw new Error('Usage: text-byte-census [--json [--compact]] [--fail-on <class>]');
  }

  const report = await runCensus();

  if (json) {
    if (compact) {
      console.log(JSON.stringify({
        schema: report.schema,
        totalFiles: report.totalFiles,
        failClosed: report.failClosed,
        classificationCounts: report.classificationCounts,
        anomalyCounts: report.anomalyCounts,
        flaggedCount: report.flaggedEntries.length
      }));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } else {
    console.log(formatTextReport(report));
  }

  if (failOn === 'any' && report.failClosed) {
    process.exit(1);
  } else if (failOn && failOn !== 'any' && report.classificationCounts[failOn as TextByteClassification] > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
