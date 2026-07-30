#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

import {
  classifySecRepositorySurface,
  resolveSecMarkdownSkillCoverage,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_BEHAVIOR_IDS,
  SEC_REPOSITORY_BEHAVIOR_OWNERS,
  type SecAgentSkillId,
  type SecRepositorySurfaceKind
} from '../../platform/shared/agent-skill-contract.ts';

const DEFAULT_REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const MAX_TEXT_FILE_BYTES = 2_000_000;
const GIT_BATCH_BYTE_BUDGET = 16 * 1024 * 1024;
const GIT_BATCH_OUTPUT_OVERHEAD = 2 * 1024 * 1024;
const HEURISTIC_MARKER = /(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|优先|默认|触发|停止|回退|重算|fail[- ]?closed|DO NOT MERGE|reload_if|gate_owner|\bWork\s+Package\b|\bTask\s+Envelope\b|\bAgent\s+Skill\b|\bmust\b|\bshould\b|\bnever\b|\bdo\s+not\b)/iu;
const AGENT_CONTEXT_MARKER = /(?:\bAgent\b|\bCodex\b|\bWork\s+Package\b|\bTask\s+Envelope\b|\bSkill\b|\bReview\b|\bCI\b|\bGate\b|\bmerge\b|\bbranch\b|\btool\b|工具|文档|验证|仓库|上下文|恢复|分派|权限|\bowner\b|\bauthority\b)/iu;
const STRONG_AGENT_CONTEXT_MARKER = /(?:\bAgent\b|\bCodex\b|\bWork\s+Package\b|\bTask\s+Envelope\b|\bAgent\s+Skill\b)/iu;
const NON_AUTHORITY_BEHAVIOR_PATH = /^(?:docs\/(?:archive|evidence|superpowers)\/)|(?:^|\/)[^/]+\.min\.(?:css|js)$/iu;
const MINIFIED_GENERATED_PATH = /(?:^|\/)[^/]+\.min\.(?:css|js)$/iu;
const JAVASCRIPT_OR_TYPESCRIPT_PATH = /\.(?:[cm]?[jt]sx?)$/iu;
const JAVASCRIPT_OR_TYPESCRIPT_TEST_PATH = /^tests\/.*\.(?:[cm]?[jt]sx?)$/iu;
const REPOSITORY_TEST_PATH = /^tests\//iu;
const TEST_FIXTURE_EXTENSION = /\.(?:json|md|markdown|txt)$/iu;
const TEST_FIXTURE_DIRECTORY = /(?:^|\/)(?:__)?(?:fixtures?|snapshots?)(?:__)?(?:\/|$)/iu;
const MALFORMED_REPOSITORY_REFERENCE = /(?:\t(?:ests|platform|scripts|docs)\/|\\(?:tests|platform|scripts|docs)\/)/u;
const DYNAMIC_IDENTITY = /(?:\b[0-9a-f]{40}\b|\bPR\s*#\d+\b|\b(?:run|job)\s*#?\d{8,}\b)/iu;

export type RepositoryAuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface RepositoryAuditFinding {
  code: string;
  line?: number;
  message: string;
  path?: string;
  severity: RepositoryAuditSeverity;
  skills?: readonly SecAgentSkillId[];
}

export interface RepositoryAuditReport {
  behaviorCandidates: readonly BehaviorCandidate[];
  behaviorOwners: typeof SEC_REPOSITORY_BEHAVIOR_OWNERS;
  contentCoverage: readonly RepositoryContentCoverage[];
  findings: readonly RepositoryAuditFinding[];
  optimizations: readonly string[];
  revision: Readonly<{
    defaultHead: string | null;
    defaultRef: string;
    defaultRefInput: string;
    defaultRefMode: 'exact-sha' | 'ref';
    head: string;
    tree: string;
    worktree: 'clean' | 'dirty' | 'unresolved';
  }>;
  schema: 'sec-repository-audit-v1';
  summary: Readonly<{
    activeMarkdown: number;
    behaviorCandidates: number;
    contentCoverage: Readonly<Record<RepositoryContentCoverageStatus, number>>;
    findings: Readonly<Record<RepositoryAuditSeverity, number>>;
    markdown: number;
    skills: number;
    trackedPaths: number;
    unknowns: number;
  }>;
  surfaces: Readonly<Record<SecRepositorySurfaceKind, number>>;
  unknowns: readonly string[];
}

export interface BehaviorCandidate {
  line: number;
  path: string;
  skills: readonly SecAgentSkillId[];
  text: string;
}

export type RepositoryContentCoverageStatus = 'excluded' | 'scanned' | 'unknown';

export interface RepositoryContentCoverage {
  bytes: number | null;
  mode: string;
  object: string;
  path: string;
  reason: string;
  status: RepositoryContentCoverageStatus;
}

interface GitOptions {
  allowFailure?: boolean;
}

interface GitTreeEntry {
  mode: string;
  object: string;
  path: string;
  size: number | null;
  type: 'blob' | 'commit';
}

type GitBlobRead = Readonly<{
  bytes: Buffer | null;
  reason: string | null;
}>;

type HeuristicLine = Readonly<{
  line: number;
  logical: string;
  raw: string;
}>;

function runGitBytes(
  repositoryRoot: string,
  args: readonly string[],
  options: GitOptions = {}
): Buffer | null {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    windowsHide: true
  });
  if (result.error) {
    if (options.allowFailure) return null;
    throw result.error;
  }
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr).trim();
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
  if (!Buffer.isBuffer(result.stdout)) {
    return Buffer.from(String(result.stdout), 'utf8');
  }
  return result.stdout;
}

function runGitText(
  repositoryRoot: string,
  args: readonly string[],
  options: GitOptions = {}
): string | null {
  return runGitBytes(repositoryRoot, args, options)?.toString('utf8').trim() ?? null;
}

function revisionTreeEntries(
  repositoryRoot: string,
  revision: string
): GitTreeEntry[] {
  const raw = runGitBytes(repositoryRoot, [
    'ls-tree', '-r', '-z', '-l', '--full-tree', revision
  ]);
  if (raw === null) throw new Error(`git ls-tree returned no output for ${revision}`);

  const entries = raw.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const separator = record.indexOf('\t');
    if (separator < 0) throw new Error(`Malformed git ls-tree record: ${record}`);
    const metadata = record.slice(0, separator);
    const repositoryPath = record.slice(separator + 1);
    const match = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64})\s+(-|\d+)$/u.exec(metadata);
    if (!match) throw new Error(`Malformed git ls-tree metadata: ${metadata}`);
    return Object.freeze({
      mode: match[1]!,
      object: match[3]!,
      path: repositoryPath,
      size: match[4] === '-' ? null : Number.parseInt(match[4]!, 10),
      type: match[2] as 'blob' | 'commit'
    });
  });
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function trackedRepositoryFiles(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  revision = 'HEAD'
): string[] {
  return revisionTreeEntries(repositoryRoot, revision).map(({ path: repositoryPath }) =>
    repositoryPath);
}

function stableObjectBatches(
  expectedSizes: ReadonlyMap<string, number>
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const objectId of [...expectedSizes.keys()].sort()) {
    const size = expectedSizes.get(objectId)!;
    if (current.length > 0 && currentBytes + size > GIT_BATCH_BYTE_BUDGET) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(objectId);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function readBatchGitBlobs(
  repositoryRoot: string,
  entries: readonly GitTreeEntry[]
): Map<string, GitBlobRead> {
  const expectedSizes = new Map<string, number>();
  const inconsistentObjects = new Set<string>();
  for (const entry of entries) {
    if (entry.size === null) continue;
    const prior = expectedSizes.get(entry.object);
    if (prior !== undefined && prior !== entry.size) inconsistentObjects.add(entry.object);
    else expectedSizes.set(entry.object, entry.size);
  }
  const blobs = new Map<string, GitBlobRead>();
  for (const objectId of inconsistentObjects) {
    blobs.set(objectId, { bytes: null, reason: 'blob-size-mismatch' });
    expectedSizes.delete(objectId);
  }

  for (const objectIds of stableObjectBatches(expectedSizes)) {
    const expectedBatchBytes = objectIds.reduce(
      (sum, objectId) => sum + expectedSizes.get(objectId)!,
      0
    );
    const result = spawnSync('git', ['cat-file', '--batch'], {
      cwd: repositoryRoot,
      input: Buffer.from(`${objectIds.join('\n')}\n`, 'utf8'),
      maxBuffer: expectedBatchBytes + GIT_BATCH_OUTPUT_OVERHEAD,
      windowsHide: true
    });
    const markBatchUnavailable = (reason: string): void => {
      for (const objectId of objectIds) {
        blobs.set(objectId, { bytes: null, reason });
      }
    };
    if (result.error) {
      markBatchUnavailable(`blob-unavailable:${result.error.message}`);
      continue;
    }
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
      const stderr = Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8').trim()
        : String(result.stderr).trim();
      markBatchUnavailable(`blob-unavailable:${stderr || `exit-${result.status ?? 'null'}`}`);
      continue;
    }

    try {
      let offset = 0;
      for (const requestedObject of objectIds) {
        const headerEnd = result.stdout.indexOf(0x0a, offset);
        if (headerEnd < 0) throw new Error(`missing-header:${requestedObject}`);
        const header = result.stdout.subarray(offset, headerEnd).toString('utf8');
        if (header === `${requestedObject} missing`) {
          blobs.set(requestedObject, { bytes: null, reason: 'blob-unavailable:missing' });
          offset = headerEnd + 1;
          continue;
        }
        const match = /^([0-9a-f]{40,64}) blob (\d+)$/u.exec(header);
        if (!match || match[1] !== requestedObject) {
          throw new Error(`unexpected-header:${requestedObject}:${header}`);
        }
        const size = Number.parseInt(match[2]!, 10);
        const contentStart = headerEnd + 1;
        const contentEnd = contentStart + size;
        if (contentEnd >= result.stdout.length || result.stdout[contentEnd] !== 0x0a) {
          throw new Error(`truncated-content:${requestedObject}`);
        }
        const expectedSize = expectedSizes.get(requestedObject)!;
        if (size !== expectedSize) {
          blobs.set(requestedObject, { bytes: null, reason: 'blob-size-mismatch' });
        } else {
          blobs.set(requestedObject, {
            bytes: Buffer.from(result.stdout.subarray(contentStart, contentEnd)),
            reason: null
          });
        }
        offset = contentEnd + 1;
      }
      if (offset !== result.stdout.length) throw new Error('unconsumed-output');
    } catch (error) {
      markBatchUnavailable(
        `blob-unavailable:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return blobs;
}

function knownBinaryReason(bytes: Buffer): string | null {
  const starts = (...values: number[]): boolean =>
    values.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, value: string): boolean =>
    bytes.subarray(offset, offset + value.length).toString('ascii') === value;
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'known-binary:png';
  if (starts(0xff, 0xd8, 0xff)) return 'known-binary:jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'known-binary:gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'known-binary:webp';
  if (ascii(0, '%PDF-')) return 'known-binary:pdf';
  if (starts(0x50, 0x4b, 0x03, 0x04)
    || starts(0x50, 0x4b, 0x05, 0x06)
    || starts(0x50, 0x4b, 0x07, 0x08)) return 'known-binary:zip';
  if (starts(0x1f, 0x8b)) return 'known-binary:gzip';
  if (starts(0x7f, 0x45, 0x4c, 0x46)) return 'known-binary:elf';
  if (ascii(0, 'MZ')) return 'known-binary:portable-executable';
  if (ascii(0, 'wOFF') || ascii(0, 'wOF2')) return 'known-binary:web-font';
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'known-binary:icon';
  if (ascii(0, 'SQLite format 3\0')) return 'known-binary:sqlite';
  if (starts(0x00, 0x61, 0x73, 0x6d)) return 'known-binary:wasm';
  if (ascii(0, 'ID3') || starts(0xff, 0xfb) || starts(0xff, 0xf3) || starts(0xff, 0xf2)) {
    return 'known-binary:mp3';
  }
  if (bytes.length >= 12 && ascii(4, 'ftyp')) return 'known-binary:mp4';
  if (ascii(0, 'OTTO') || starts(0x00, 0x01, 0x00, 0x00)) return 'known-binary:font';
  if (ascii(0, 'BM')) return 'known-binary:bmp';
  return null;
}

function scriptKind(repositoryPath: string): ts.ScriptKind {
  const extension = path.posix.extname(repositoryPath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function typeScriptSyntaxError(repositoryPath: string, source: string): string | null {
  const sourceFile = ts.createSourceFile(
    repositoryPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(repositoryPath)
  );
  const diagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics ?? [];
  if (diagnostics.length === 0) return null;
  return ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, ' ');
}

function isKnownTestFixturePath(repositoryPath: string): boolean {
  return REPOSITORY_TEST_PATH.test(repositoryPath)
    && !JAVASCRIPT_OR_TYPESCRIPT_TEST_PATH.test(repositoryPath)
    && (
      TEST_FIXTURE_EXTENSION.test(repositoryPath)
      || TEST_FIXTURE_DIRECTORY.test(repositoryPath)
    );
}

function unsupportedTestSyntaxReason(repositoryPath: string): string {
  const extension = path.posix.extname(repositoryPath).toLowerCase();
  return `unsupported-test-syntax:${extension || 'extensionless'}`;
}

function coverageResult(
  entry: GitTreeEntry,
  status: RepositoryContentCoverageStatus,
  reason: string
): RepositoryContentCoverage {
  return Object.freeze({
    bytes: entry.size,
    mode: entry.mode,
    object: entry.object,
    path: entry.path,
    reason,
    status
  });
}

function revisionTextCandidates(
  repositoryRoot: string,
  entries: readonly GitTreeEntry[]
): Readonly<{
  bytesByPath: ReadonlyMap<string, Buffer>;
  contentCoverage: readonly RepositoryContentCoverage[];
  textByPath: ReadonlyMap<string, string | null>;
}> {
  const readableEntries = entries.filter((entry) =>
    entry.type === 'blob'
    && (entry.mode === '100644' || entry.mode === '100755')
    && entry.size !== null
    && entry.size <= MAX_TEXT_FILE_BYTES);
  const blobs = readBatchGitBlobs(repositoryRoot, readableEntries);
  const bytesByPath = new Map<string, Buffer>();
  const textByPath = new Map<string, string | null>();
  const contentCoverage: RepositoryContentCoverage[] = [];

  for (const entry of entries) {
    if (entry.type === 'commit' || entry.mode === '160000') {
      contentCoverage.push(coverageResult(entry, 'unknown', 'gitlink'));
      textByPath.set(entry.path, null);
      continue;
    }
    if (entry.mode !== '100644' && entry.mode !== '100755') {
      contentCoverage.push(
        coverageResult(entry, 'unknown', `non-ordinary-blob-mode:${entry.mode}`)
      );
      textByPath.set(entry.path, null);
      continue;
    }
    if (entry.size === null) {
      contentCoverage.push(coverageResult(entry, 'unknown', 'blob-size-unavailable'));
      textByPath.set(entry.path, null);
      continue;
    }
    if (entry.size > MAX_TEXT_FILE_BYTES) {
      contentCoverage.push(
        coverageResult(entry, 'unknown', `oversized:${entry.size}>${MAX_TEXT_FILE_BYTES}`)
      );
      textByPath.set(entry.path, null);
      continue;
    }
    const read = blobs.get(entry.object);
    if (!read || read.bytes === null) {
      contentCoverage.push(
        coverageResult(entry, 'unknown', read?.reason ?? 'blob-unavailable')
      );
      textByPath.set(entry.path, null);
      continue;
    }
    if (read.bytes.length !== entry.size) {
      contentCoverage.push(coverageResult(entry, 'unknown', 'blob-size-mismatch'));
      textByPath.set(entry.path, null);
      continue;
    }
    bytesByPath.set(entry.path, read.bytes);
    if (MINIFIED_GENERATED_PATH.test(entry.path)) {
      contentCoverage.push(coverageResult(entry, 'excluded', 'minified-generated'));
      textByPath.set(entry.path, null);
      continue;
    }
    const binaryReason = knownBinaryReason(read.bytes);
    if (binaryReason !== null) {
      contentCoverage.push(coverageResult(entry, 'excluded', binaryReason));
      textByPath.set(entry.path, null);
      continue;
    }
    if (read.bytes.includes(0)) {
      contentCoverage.push(coverageResult(entry, 'unknown', 'nul-content'));
      textByPath.set(entry.path, null);
      continue;
    }
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
    } catch {
      contentCoverage.push(coverageResult(entry, 'unknown', 'invalid-utf8'));
      textByPath.set(entry.path, null);
      continue;
    }
    if (isKnownTestFixturePath(entry.path)) {
      contentCoverage.push(coverageResult(entry, 'excluded', 'test-fixture'));
      textByPath.set(entry.path, null);
      continue;
    }
    if (
      REPOSITORY_TEST_PATH.test(entry.path)
      && !JAVASCRIPT_OR_TYPESCRIPT_TEST_PATH.test(entry.path)
    ) {
      contentCoverage.push(
        coverageResult(entry, 'unknown', unsupportedTestSyntaxReason(entry.path))
      );
      textByPath.set(entry.path, null);
      continue;
    }
    if (JAVASCRIPT_OR_TYPESCRIPT_TEST_PATH.test(entry.path)) {
      const syntaxError = typeScriptSyntaxError(entry.path, source);
      if (syntaxError !== null) {
        contentCoverage.push(
          coverageResult(entry, 'unknown', `test-syntax-unresolved:${syntaxError}`)
        );
        textByPath.set(entry.path, null);
        continue;
      }
    }
    const behaviorIrrelevant = NON_AUTHORITY_BEHAVIOR_PATH.test(entry.path);
    contentCoverage.push(coverageResult(
      entry,
      'scanned',
      behaviorIrrelevant ? 'utf8-scanned-behavior-irrelevant' : 'utf8-scanned'
    ));
    textByPath.set(entry.path, source);
  }
  return {
    bytesByPath,
    contentCoverage: Object.freeze(contentCoverage),
    textByPath
  };
}

function repositoryWorktreeState(
  repositoryRoot: string
): 'clean' | 'dirty' | 'unresolved' {
  const status = runGitBytes(repositoryRoot, [
    '-c', 'core.quotepath=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ], { allowFailure: true });
  if (status === null) return 'unresolved';
  return status.length === 0 ? 'clean' : 'dirty';
}

function markdownStatus(source: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)?.[1];
  if (!frontmatter) return null;
  return /^status:\s*([^\s#]+)\s*$/mu.exec(frontmatter)?.[1] ?? null;
}

function behaviorSkills(repositoryPath: string): SecAgentSkillId[] {
  const markdown = resolveSecMarkdownSkillCoverage(repositoryPath);
  return markdown?.skills ?? resolveSecRepositoryHeuristicSkills(repositoryPath);
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 0x0a) starts.push(index + 1);
  }
  return starts;
}

function lineNumberAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
}

function stripCommentSyntax(
  raw: string,
  index: number,
  total: number
): string {
  let value = raw;
  if (index === 0) value = value.replace(/^\s*(?:\/\/|\/\*+)\s?/u, '');
  if (index === total - 1) value = value.replace(/\*\/\s*$/u, '');
  return value.replace(/^\s*\*\s?/u, '').trim();
}

function typeScriptCommentLines(
  repositoryPath: string,
  source: string
): HeuristicLine[][] {
  const starts = lineStarts(source);
  const segments: HeuristicLine[][] = [];
  let adjacentLineComments: HeuristicLine[] = [];
  let previousLineCommentEnd: number | null = null;
  let previousLineCommentLine: number | null = null;
  let previousLineCommentStandalone = false;
  const flushAdjacentLineComments = (): void => {
    if (adjacentLineComments.length > 0) segments.push(adjacentLineComments);
    adjacentLineComments = [];
    previousLineCommentEnd = null;
    previousLineCommentLine = null;
    previousLineCommentStandalone = false;
  };
  const variant = /\.(?:jsx|tsx)$/iu.test(repositoryPath)
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, source);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia
      && token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) continue;
    const tokenStart = scanner.getTokenPos();
    const tokenEnd = scanner.getTextPos();
    const tokenLines = scanner.getTokenText().split(/\r?\n/u);
    const firstLine = lineNumberAt(starts, tokenStart);
    const lines = tokenLines.map((raw, index) => Object.freeze({
      line: firstLine + index,
      logical: stripCommentSyntax(raw, index, tokenLines.length),
      raw: raw.trim()
    }));
    if (token === ts.SyntaxKind.MultiLineCommentTrivia) {
      flushAdjacentLineComments();
      segments.push(lines);
      continue;
    }

    const lineStart = starts[firstLine - 1] ?? 0;
    const standalone = /^[\t ]*$/u.test(source.slice(lineStart, tokenStart));
    const gap = previousLineCommentEnd === null
      ? ''
      : source.slice(previousLineCommentEnd, tokenStart);
    const joinsPrevious = previousLineCommentEnd !== null
      && previousLineCommentLine !== null
      && previousLineCommentStandalone
      && standalone
      && firstLine === previousLineCommentLine + 1
      && /^(?:\r\n|\n|\r)[\t ]*$/u.test(gap);
    if (!joinsPrevious) flushAdjacentLineComments();
    adjacentLineComments.push(...lines);
    previousLineCommentEnd = tokenEnd;
    previousLineCommentLine = firstLine;
    previousLineCommentStandalone = standalone;
  }
  flushAdjacentLineComments();
  return segments;
}

function looksLikeCodeToken(value: string): boolean {
  return /^(?:const|let|var|function|class|interface|type|enum|namespace|import|export|return|throw|if|else|for|while|switch|try|catch|finally)\b/u.test(value)
    || /(?:=>|===|!==|\+\+|--|;\s*$)/u.test(value)
    || /^[{}()[\].,;]+$/u.test(value);
}

function isStructuralHeading(value: string): boolean {
  return /^#{1,6}\s+\S/u.test(value)
    || /^(?:[-*+]\s+)?[^.!?。！？]+[:：]\s*$/u.test(value);
}

function logicalSegments(lines: readonly HeuristicLine[]): HeuristicLine[][] {
  const segments: HeuristicLine[][] = [];
  let current: HeuristicLine[] = [];
  let inFence = false;
  const flush = (): void => {
    if (current.length > 0) segments.push(current);
    current = [];
  };
  for (const line of lines) {
    const value = line.logical.trim();
    if (/^(?:```|~~~)/u.test(value)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (!value || looksLikeCodeToken(value)) {
      flush();
      continue;
    }
    if (isStructuralHeading(value) && current.length > 0) flush();
    current.push(line);
    if (!inFence && /^\s{4}\S/u.test(line.logical)) flush();
  }
  flush();
  return segments;
}

function sourceHeuristicSegments(
  repositoryPath: string,
  source: string
): HeuristicLine[][] {
  if (JAVASCRIPT_OR_TYPESCRIPT_PATH.test(repositoryPath)) {
    return typeScriptCommentLines(repositoryPath, source).flatMap(logicalSegments);
  }
  const lines = source.split(/\r?\n/u).map((raw, index) => Object.freeze({
    line: index + 1,
    logical: raw.trim(),
    raw: raw.trim()
  }));
  return logicalSegments(lines);
}

export function extractHeuristicBehaviorCandidates(
  repositoryPath: string,
  source: string
): BehaviorCandidate[] {
  if (
    NON_AUTHORITY_BEHAVIOR_PATH.test(repositoryPath)
    || isKnownTestFixturePath(repositoryPath)
    || (
      REPOSITORY_TEST_PATH.test(repositoryPath)
      && !JAVASCRIPT_OR_TYPESCRIPT_TEST_PATH.test(repositoryPath)
    )
  ) return [];
  const markdown = resolveSecMarkdownSkillCoverage(repositoryPath);
  if (markdown && (
    markdown.kind === 'historical'
    || markdown.kind === 'evidence'
    || markdown.kind === 'frozen-work-package'
    || markdown.kind === 'verification-fixture'
  )) {
    return [];
  }

  const skills = behaviorSkills(repositoryPath);
  const pathImpliesAgentBehavior = markdown?.kind === 'skill-definition'
    || markdown?.kind === 'agent-projection'
    || (markdown === null && resolveSecRepositoryHeuristicSkills(repositoryPath).length > 0);
  const contextMarker = skills.length > 0
    ? AGENT_CONTEXT_MARKER
    : STRONG_AGENT_CONTEXT_MARKER;
  const candidates = new Map<string, BehaviorCandidate>();
  for (const segment of sourceHeuristicSegments(repositoryPath, source)) {
    let inheritedContext = false;
    for (const line of segment) {
      const logical = line.logical.trim();
      const directContext = contextMarker.test(logical);
      if (isStructuralHeading(logical)) inheritedContext = directContext;
      if (
        !HEURISTIC_MARKER.test(logical)
        || (!pathImpliesAgentBehavior && !directContext && !inheritedContext)
      ) continue;
      const candidate = Object.freeze({
        line: line.line,
        path: repositoryPath,
        skills: Object.freeze([...skills]),
        text: line.raw
      });
      candidates.set(
        `${candidate.line}\0${candidate.text}\0${candidate.skills.join(',')}`,
        candidate
      );
    }
  }
  return [...candidates.values()].sort((left, right) =>
    left.line - right.line || left.text.localeCompare(right.text));
}

function countFindings(
  findings: readonly RepositoryAuditFinding[]
): Readonly<Record<RepositoryAuditSeverity, number>> {
  return Object.freeze({
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length
  });
}

function pushFinding(
  findings: RepositoryAuditFinding[],
  finding: RepositoryAuditFinding
): void {
  findings.push(Object.freeze({
    ...finding,
    skills: finding.skills ? Object.freeze([...finding.skills]) : undefined
  }));
}

function parseActiveManifest(pointer: string): string | null {
  return /^\s*manifest:\s*(\S+)\s*$/mu.exec(pointer)?.[1] ?? null;
}

function parseManifestDigest(pointer: string): string | null {
  return /^\s*manifestDigest:\s*sha256:([a-f0-9]{64})\s*$/mu.exec(pointer)?.[1] ?? null;
}

function currentRollingPackage(rollingPlan: string): string | null {
  const currentSection = /## 当前唯一 Work Package\s+([\s\S]*?)(?:\n## |\s*$)/u.exec(rollingPlan)?.[1];
  return currentSection
    ? /^###\s+([^\s]+)\s*$/mu.exec(currentSection)?.[1] ?? null
    : null;
}

async function auditControlPlane(
  repositoryRoot: string,
  tracked: readonly string[],
  head: string,
  defaultRef: string,
  bytesByPath: ReadonlyMap<string, Buffer>,
  textByPath: ReadonlyMap<string, string | null>,
  findings: RepositoryAuditFinding[],
  unknowns: string[]
): Promise<void> {
  const pointerPath = 'docs/work/active-work-package.md';
  const rollingPath = 'docs/work/rolling-plan.md';
  if (!tracked.includes(pointerPath) || !tracked.includes(rollingPath)) {
    unknowns.push('docs/work control plane is incomplete');
    return;
  }

  const pointer = textByPath.get(pointerPath);
  const rollingPlan = textByPath.get(rollingPath);
  if (pointer === undefined || pointer === null
    || rollingPlan === undefined || rollingPlan === null) {
    unknowns.push('docs/work control plane is not readable as text at the audited revision');
    return;
  }
  const manifestPath = parseActiveManifest(pointer);
  const expectedDigest = parseManifestDigest(pointer);
  const rollingPackage = currentRollingPackage(rollingPlan);
  if (!manifestPath || !expectedDigest) {
    pushFinding(findings, {
      code: 'control-plane-pointer-invalid',
      message: 'active Work Package pointer does not expose one canonical manifest path and sha256 digest',
      path: pointerPath,
      severity: 'critical'
    });
    return;
  }
  if (!tracked.includes(manifestPath)) {
    pushFinding(findings, {
      code: 'control-plane-manifest-missing',
      message: `active pointer references untracked manifest ${manifestPath}`,
      path: pointerPath,
      severity: 'critical'
    });
    return;
  }

  const manifestBytes = bytesByPath.get(manifestPath);
  if (manifestBytes === undefined) {
    pushFinding(findings, {
      code: 'control-plane-manifest-blob-unavailable',
      message: `active manifest has no readable raw Git blob at ${head}: ${manifestPath}`,
      path: pointerPath,
      severity: 'critical'
    });
    return;
  }
  const actualDigest = createHash('sha256').update(manifestBytes).digest('hex');
  if (actualDigest !== expectedDigest) {
    pushFinding(findings, {
      code: 'control-plane-digest-drift',
      message: `active manifest digest mismatch: expected=${expectedDigest} actual=${actualDigest}`,
      path: pointerPath,
      severity: 'critical'
    });
  }

  const defaultManifestBytes = runGitBytes(
    repositoryRoot,
    ['show', `${defaultRef}:${manifestPath}`],
    { allowFailure: true }
  );
  if (defaultManifestBytes !== null) {
    const defaultDigest = createHash('sha256').update(defaultManifestBytes).digest('hex');
    if (defaultDigest === expectedDigest) {
      pushFinding(findings, {
        code: 'control-plane-selected-manifest-already-on-default',
        message: 'active pointer selects a manifest whose exact digest is already present on the default branch',
        path: pointerPath,
        severity: 'high'
      });
    }
  }

  const manifestId = path.posix.basename(manifestPath, '.md');
  if (rollingPackage !== manifestId) {
    pushFinding(findings, {
      code: 'control-plane-rolling-drift',
      message: `rolling plan current package ${rollingPackage ?? '<missing>'} does not match ${manifestId}`,
      path: rollingPath,
      severity: 'high'
    });
  }

  const liveManifests = tracked.filter((file) => /^docs\/work-packages\/[^/]+\.md$/u.test(file));
  if (liveManifests.length !== 1 || liveManifests[0] !== manifestPath) {
    pushFinding(findings, {
      code: 'control-plane-live-manifest-census',
      message: `docs/work-packages must contain only the selected manifest; found ${liveManifests.join(', ') || '<none>'}`,
      path: 'docs/work-packages',
      severity: 'high'
    });
  }
}

export async function auditRepository(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  options: { defaultRef?: string } = {}
): Promise<RepositoryAuditReport> {
  const defaultRefInput = options.defaultRef ?? process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF ?? 'refs/remotes/origin/main';
  const isExactSha = /^[0-9a-f]{40}$/u.test(defaultRefInput);
  // For exact SHA input, validate it resolves to a commit object. For ref input,
  // use rev-parse --verify <ref> (resolves through symbolic refs).
  const defaultRef = isExactSha ? `${defaultRefInput}^{commit}` : defaultRefInput;
  const findings: RepositoryAuditFinding[] = [];
  const unknowns: string[] = [];
  const head = runGitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const tree = runGitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{tree}']);
  if (head === null || tree === null) {
    throw new Error('Repository audit requires a resolvable HEAD commit and tree');
  }
  const initialWorktree = repositoryWorktreeState(repositoryRoot);
  if (initialWorktree !== 'clean') {
    unknowns.push(`exact HEAD evidence requires a clean index/worktree; state=${initialWorktree}`);
  }
  const entries = revisionTreeEntries(repositoryRoot, head);
  const tracked = entries.map(({ path: repositoryPath }) => repositoryPath);
  const {
    bytesByPath,
    contentCoverage,
    textByPath
  } = revisionTextCandidates(repositoryRoot, entries);
  for (const coverage of contentCoverage) {
    if (coverage.status === 'unknown') {
      unknowns.push(`content coverage unknown: ${coverage.path} [${coverage.reason}]`);
    }
  }
  const defaultHead = runGitText(
    repositoryRoot,
    ['rev-parse', '--verify', defaultRef],
    { allowFailure: true }
  );
  if (defaultHead === null) {
    unknowns.push(`default ref unavailable: ${defaultRefInput}`);
  }
  const surfaceCounts: Record<SecRepositorySurfaceKind, number> = {
    configuration: 0,
    'heuristic-runtime': 0,
    markdown: 0,
    'product-implementation': 0,
    'repository-content': 0,
    'verification-test': 0
  };
  const candidates: BehaviorCandidate[] = [];
  let markdown = 0;
  let activeMarkdown = 0;

  for (const repositoryPath of tracked) {
    const surface = classifySecRepositorySurface(repositoryPath);
    surfaceCounts[surface.kind] += 1;
    if (repositoryPath.endsWith('.md')) markdown += 1;

    const source = textByPath.get(repositoryPath) ?? null;
    if (source === null) continue;

    const markdownCoverage = resolveSecMarkdownSkillCoverage(repositoryPath);
    if (markdownCoverage?.kind === 'active-authority'
      || markdownCoverage?.kind === 'agent-projection') {
      activeMarkdown += 1;
      if (markdownCoverage.skills.length === 0) {
        pushFinding(findings, {
          code: 'active-markdown-unowned',
          message: 'active Markdown has no Skill coverage',
          path: repositoryPath,
          severity: 'critical'
        });
      }
      const status = markdownStatus(source);
      if (repositoryPath.startsWith('docs/') && status === null) {
        pushFinding(findings, {
          code: 'active-markdown-status-missing',
          message: 'active documentation has no frontmatter status',
          path: repositoryPath,
          severity: 'high'
        });
      }
    }

    const extracted = extractHeuristicBehaviorCandidates(repositoryPath, source);
    candidates.push(...extracted);
    for (const candidate of extracted) {
      if (candidate.skills.length === 0) {
        pushFinding(findings, {
          code: 'possible-heuristic-outside-governance',
          line: candidate.line,
          message: `possible Agent behavior requires deterministic-vs-heuristic triage: ${candidate.text}`,
          path: candidate.path,
          severity: 'high'
        });
      } else if (
        markdownCoverage?.kind !== 'skill-definition'
        && candidate.skills.every((skill) => skill === 'sec-documentation-governance')
      ) {
        pushFinding(findings, {
          code: 'heuristic-catch-all-only',
          line: candidate.line,
          message: `Agent behavior resolves only to documentation governance: ${candidate.text}`,
          path: candidate.path,
          severity: 'high',
          skills: candidate.skills
        });
      }
    }

    for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
      if (MALFORMED_REPOSITORY_REFERENCE.test(rawLine)) {
        pushFinding(findings, {
          code: 'malformed-repository-reference',
          line: index + 1,
          message: `malformed repository path reference: ${rawLine.trim()}`,
          path: repositoryPath,
          severity: 'high'
        });
      }
      if (markdownCoverage?.kind === 'active-authority'
        && !repositoryPath.startsWith('docs/work/')
        && DYNAMIC_IDENTITY.test(rawLine)) {
        pushFinding(findings, {
          code: 'dynamic-identity-in-stable-authority',
          line: index + 1,
          message: `dynamic revision/PR/run identity appears in stable authority: ${rawLine.trim()}`,
          path: repositoryPath,
          severity: 'medium'
        });
      }
    }

    if (repositoryPath === 'scripts/discover-all.ts'
      && (source.includes("const PLATFORM_ROOT = join(ROOT, 'platform');")
        || source.includes('calls: calls.slice(0, 500)'))) {
      pushFinding(findings, {
        code: 'partial-discovery-named-all',
        message: 'discover-all has a partial repository scope or silently truncates call relations',
        path: repositoryPath,
        severity: 'medium'
      });
    }
  }

  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const owned = SEC_REPOSITORY_BEHAVIOR_IDS.filter(
      (behavior) => SEC_REPOSITORY_BEHAVIOR_OWNERS[behavior] === skillId
    );
    if (owned.length === 0) {
      pushFinding(findings, {
        code: 'skill-without-behavior-owner',
        message: `${skillId} does not own any registered repository behavior`,
        path: `.agents/skills/${skillId}/SKILL.md`,
        severity: 'high',
        skills: [skillId]
      });
    }
  }

  await auditControlPlane(
    repositoryRoot,
    tracked,
    head,
    defaultRefInput,
    bytesByPath,
    textByPath,
    findings,
    unknowns
  );

  const finalHead = runGitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const finalTree = runGitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{tree}']);
  const finalWorktree = repositoryWorktreeState(repositoryRoot);
  if (finalHead !== head || finalTree !== tree) {
    unknowns.push(
      `HEAD changed during repository audit: start=${head}/${tree} `
      + `end=${finalHead ?? '<unresolved>'}/${finalTree ?? '<unresolved>'}`
    );
  }
  if (finalWorktree !== initialWorktree) {
    unknowns.push(
      `index/worktree changed during repository audit: `
      + `start=${initialWorktree} end=${finalWorktree}`
    );
  }
  const worktree = initialWorktree === 'dirty' || finalWorktree === 'dirty'
    ? 'dirty'
    : initialWorktree === 'unresolved' || finalWorktree === 'unresolved'
      ? 'unresolved'
      : 'clean';

  const rank: Record<RepositoryAuditSeverity, number> = {
    critical: 0,
    high: 1,
    low: 3,
    medium: 2
  };
  findings.sort((left, right) =>
    rank[left.severity] - rank[right.severity]
    || (left.path ?? '').localeCompare(right.path ?? '')
    || (left.line ?? 0) - (right.line ?? 0)
    || left.code.localeCompare(right.code));

  return Object.freeze({
    behaviorCandidates: Object.freeze([...candidates]),
    behaviorOwners: SEC_REPOSITORY_BEHAVIOR_OWNERS,
    contentCoverage,
    findings: Object.freeze(findings),
    optimizations: Object.freeze([
      '把未覆盖的 Agent 行为交给 sec-heuristic-governance，不在原文件追加孤立指令。',
      '把跨 owner 的架构 finding 交给 sec-architecture-evolution，冻结 authority/contract 后再实现。',
      '把产品 finding 拆为依赖明确的最小 Work Package；审计报告只作 exact-revision Evidence。',
      '删除无消费者配置、已退役路径 owner 和重复权威；保留机器可验证 registry，而不是新增叙述文档。'
    ]),
    revision: Object.freeze({
      defaultHead,
      defaultRef: defaultRefInput,
      defaultRefInput,
      defaultRefMode: isExactSha ? 'exact-sha' : 'ref',
      head,
      tree,
      worktree
    }),
    schema: 'sec-repository-audit-v1',
    summary: Object.freeze({
      activeMarkdown,
      behaviorCandidates: candidates.length,
      contentCoverage: Object.freeze({
        excluded: contentCoverage.filter(({ status }) => status === 'excluded').length,
        scanned: contentCoverage.filter(({ status }) => status === 'scanned').length,
        unknown: contentCoverage.filter(({ status }) => status === 'unknown').length
      }),
      findings: countFindings(findings),
      markdown,
      skills: SEC_AGENT_SKILL_IDS.length,
      trackedPaths: tracked.length,
      unknowns: unknowns.length
    }),
    surfaces: Object.freeze({ ...surfaceCounts }),
    unknowns: Object.freeze(unknowns.sort())
  });
}

function severityFails(
  severity: RepositoryAuditSeverity,
  threshold: RepositoryAuditSeverity
): boolean {
  const rank: Record<RepositoryAuditSeverity, number> = {
    critical: 0,
    high: 1,
    low: 3,
    medium: 2
  };
  return rank[severity] <= rank[threshold];
}

export function repositoryAuditShouldFail(
  report: Pick<RepositoryAuditReport, 'findings' | 'unknowns'>,
  options: {
    diagnostic?: boolean;
    failOn?: RepositoryAuditSeverity | 'none';
  } = {}
): boolean {
  const diagnostic = options.diagnostic ?? false;
  const failOn = options.failOn ?? 'high';
  if (!diagnostic && report.unknowns.length > 0) return true;
  return failOn !== 'none'
    && report.findings.some((finding) => severityFails(finding.severity, failOn));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const diagnostic = args.includes('--diagnostic');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  const failIndex = args.indexOf('--fail-on');
  const failOn = failIndex >= 0
    ? args[failIndex + 1] as RepositoryAuditSeverity | 'none' | undefined
    : 'high';
  if (failOn !== undefined
    && failOn !== 'none'
    && !['critical', 'high', 'medium', 'low'].includes(failOn)) {
    throw new Error(`Unsupported --fail-on value: ${failOn}`);
  }

  // Default-base identity: CLI --default-ref takes precedence; env is read only
  // when CLI flag is absent. No other inference paths.
  const defaultRefIndex = args.indexOf('--default-ref');
  const cliDefaultRef = defaultRefIndex >= 0 ? args[defaultRefIndex + 1] : undefined;
  const defaultRef = cliDefaultRef ?? process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF ?? undefined;

  const report = await auditRepository(undefined, { defaultRef });
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const absoluteOutput = path.resolve(outputPath);
    await mkdir(path.dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, encoded, 'utf8');
  }
  if (args.includes('--json') || !outputPath) {
    process.stdout.write(encoded);
  } else {
    process.stdout.write(
      `Tracked ${report.summary.trackedPaths} paths; `
      + `findings=${JSON.stringify(report.summary.findings)}; `
      + `unknowns=${report.summary.unknowns}\n`
    );
  }

  if (repositoryAuditShouldFail(report, {
    diagnostic,
    failOn: failOn ?? 'high'
  })) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
