import fs from 'node:fs/promises';
import path from 'node:path';

import type { DocumentationAuthorityRecord } from '../../platform/shared/documentation-authority-contract.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../../platform/shared/repository-path-contract.ts';

export const DOCUMENT_AUTHORITY_REGISTRY_PATH = 'docs/authority.json';

export const VALID_STATUS = new Set(['stable', 'active', 'draft', 'historical', 'archive']);
export const ACTIVE_POINTER_STATUS = new Set([...VALID_STATUS, 'conditional']);
export const EXCLUDED_DOC_PREFIXES = [
  'docs/archive/',
  'docs/evidence/',
  'docs/superpowers/',
  'docs/work-packages/',
  'docs/scripts/SEC_docs_v5_replacement/'
] as const;
export const CONTROL_PATHS = {
  currentState: 'docs/work/current-state.yaml',
  rollingPlan: 'docs/work/rolling-plan.md',
  activePointer: 'docs/work/active-work-package.md'
} as const;
export const DEPRECATED_TOKENS = [
  { token: 'CompilerPass', reason: '已被 Compiler 门面取代' },
  { token: 'PassPipeline', reason: '已被 Compiler 门面取代' },
  {
    token: 'PASS_DEPENDENCIES',
    reason: '已被 Pipeline registry 取代',
    allowedContext: /不再以.*形式|已被.*取代/u
  },
  { token: 'pino.transport', reason: '已被 zero-dependency logger 取代' }
] as const;
export const DYNAMIC_FACT_PATTERNS = [
  { label: 'Git commit SHA', pattern: /\b[0-9a-f]{40}\b/iu },
  { label: 'PR identity', pattern: /\bPR\s*#\d+\b/iu },
  { label: 'main revision', pattern: /\bmain@[0-9a-f]{7,40}\b/iu },
  { label: 'workflow run identity', pattern: /\b(?:run|artifact)\s*(?:id)?\s*[:#]?\s*\d{6,}\b/iu }
] as const;

export interface DocsDoctorIssue {
  level: 'error' | 'warn';
  code: string;
  file: string;
  message: string;
}

export interface DocsDoctorResult {
  issues: DocsDoctorIssue[];
  errors: DocsDoctorIssue[];
  warnings: DocsDoctorIssue[];
}

export interface DocsDoctorScanOptions {
  docsRoot: string;
  repositoryRoot: string;
  readCandidateManifestBlob?: (manifestPath: string) => Promise<Uint8Array>;
}

export interface DocsDoctorFrontmatter {
  ok: boolean;
  status?: string;
  domain?: string;
  generatedFrom?: string;
  reason?: string;
}

export function posixRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

export function normalizedReference(reference: string): string {
  return reference.replace(/^<|>$/gu, '').replace(/[?#].*$/u, '').replace(/^\.\/+/u, '');
}

export function isExternalReference(reference: string): boolean {
  return /^(?:https?:|mailto:|data:|javascript:|#)/iu.test(reference);
}

export function pushIssue(issues: DocsDoctorIssue[], issue: DocsDoctorIssue): void {
  if (!issues.some((candidate) =>
    candidate.level === issue.level
    && candidate.code === issue.code
    && candidate.file === issue.file
    && candidate.message === issue.message)) {
    issues.push(issue);
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function* walk(dir: string, root = dir): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const repositoryPath = posixRelative(root, full);
    if (entry.isDirectory()) {
      const prefix = `${repositoryPath}/`;
      if (!EXCLUDED_DOC_PREFIXES.some((excluded) => prefix.startsWith(excluded))) {
        yield* walk(full, root);
      }
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export function parseFrontmatter(
  content: string,
  validStatus = VALID_STATUS
): DocsDoctorFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) {
    return {
      ok: false,
      reason: content.startsWith('---') ? 'unterminated frontmatter' : 'missing frontmatter'
    };
  }
  const value = (name: string): string | undefined => {
    const field = match[1]!.match(new RegExp(`^${name}:\\s*([^\\s#]+)\\s*(?:#.*)?$`, 'mu'));
    return field?.[1]?.replace(/^['"]|['"]$/gu, '');
  };
  const status = value('status');
  if (!status) return { ok: false, reason: 'missing status' };
  if (!validStatus.has(status)) return { ok: false, reason: `invalid status "${status}"` };
  return {
    ok: true,
    status,
    domain: value('domain'),
    generatedFrom: value('generated-from')
  };
}

export function extractH1Headings(content: string): string[] {
  const headings: string[] = [];
  let fence: { character: '`' | '~'; length: number } | undefined;
  for (const line of content.split(/\r?\n/u)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const character = marker[0] as '`' | '~';
      if (!fence) fence = { character, length: marker.length };
      else if (fence.character === character && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^#\s+(.+?)\s*$/u);
    if (heading) headings.push(heading[1]!.trim());
  }
  return headings;
}

export function extractFileLinks(content: string): string[] {
  return (content.match(/file:\/\/\/[^\s)`'"]+/gu) ?? []).map((link) => {
    try {
      return decodeURI(link);
    } catch {
      return link;
    }
  });
}

export function extractBacktickFilePaths(content: string): string[] {
  const paths: string[] = [];
  for (const match of content.matchAll(/(?<!`)`([^`\r\n]+)`(?!`)/gu)) {
    const value = match[1]!.trim();
    if (
      !/[*{}<>]/u.test(value)
      && /(?:^|\/)[^/]+\.[A-Za-z0-9_-]{1,12}$/u.test(value.replace(/\\/gu, '/'))
    ) paths.push(value);
  }
  return paths;
}

export function extractMarkdownLinks(content: string): string[] {
  return [...content.matchAll(
    /!?\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^)\s\r\n]+)(?:\s+["'][^"']*["'])?\s*\)/gu
  )].map((match) => match[1]!);
}

export function repositoryPathForLink(
  repositoryRoot: string,
  sourceFile: string,
  rawReference: string
): { invalid?: string; repositoryPath?: string; target?: string } {
  const reference = normalizedReference(rawReference);
  if (!reference || isExternalReference(reference)) return {};
  if (
    path.isAbsolute(reference)
    || /^[A-Za-z]:[\\/]/u.test(reference)
    || reference.includes('\\')
    || reference !== reference.normalize('NFC')
    || reference.includes('\uFFFD')
  ) return { invalid: 'noncanonical' };
  const target = path.resolve(path.dirname(sourceFile), reference);
  const relative = path.relative(repositoryRoot, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { invalid: 'outside-repository' };
  }
  const repositoryPath = relative.split(path.sep).join('/');
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
    return { invalid: 'noncanonical', repositoryPath };
  }
  return { repositoryPath, target };
}

export function repositoryPathForInline(rawReference: string): string | undefined {
  const reference = normalizedReference(rawReference);
  if (
    reference.includes('\\')
    || reference !== reference.normalize('NFC')
    || reference.includes('\uFFFD')
    || /[*{}<>]/u.test(reference)
  ) return undefined;
  if (
    reference === 'README.md'
    || reference === 'AGENTS.md'
    || /^(?:\.agents|\.github|\.githooks|docs|platform|scripts|tests)\//u.test(reference)
  ) return reference;
  return reference.startsWith('docs/') ? reference : undefined;
}

export function statusMatches(record: DocumentationAuthorityRecord, frontmatter: DocsDoctorFrontmatter): boolean {
  if (record.path === CONTROL_PATHS.activePointer) return frontmatter.status === 'conditional';
  return frontmatter.status === record.lifecycle;
}

export function activeCandidatePath(repositoryPath: string): boolean {
  if (repositoryPath === 'README.md' || repositoryPath === 'AGENTS.md') return true;
  if (repositoryPath === DOCUMENT_AUTHORITY_REGISTRY_PATH) return true;
  if (!repositoryPath.startsWith('docs/')) return false;
  if (EXCLUDED_DOC_PREFIXES.some((prefix) => repositoryPath.startsWith(prefix))) return false;
  if (repositoryPath.endsWith('.md')) return true;
  return /^docs\/(?:governance|work)\/.+\.ya?ml$/u.test(repositoryPath);
}


export function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function stringArrayValue(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array.`);
  }
  return value as string[];
}

