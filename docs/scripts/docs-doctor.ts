#!/usr/bin/env bun
/**
 * docs-doctor: canonical documentation policy scanner.
 *
 * The scanner is intentionally reusable from tests. The CLI is only a thin
 * adapter over scanDocumentation(), so fixture and repository execution share
 * the same policy and diagnostics.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../../platform/shared/repository-path-contract.ts';
import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentGitBlobSha256,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1
} from '../../scripts/codex/document-control-plane-contract.ts';
import {
  CodexDevelopmentParseWorkPackageManifest
} from '../../scripts/codex/work-package-contract.ts';

const VALID_STATUS = new Set(['stable', 'active', 'draft', 'historical', 'archive']);
const ACTIVE_POINTER_STATUS = new Set([...VALID_STATUS, 'conditional']);
const POLICY_OWNER = '00-文档索引与一致性规则.md';
const CONTROL_PATHS = {
  currentState: 'work/current-state.yaml',
  rollingPlan: 'work/rolling-plan.md',
  activePointer: 'work/active-work-package.md'
} as const;

export const DOCS_DOCTOR_REQUIRED_CANONICAL_PATHS = [
  '00-文档索引与一致性规则.md',
  '01-用户能力模块化开发-主题整理稿.md',
  '02-工程编译器-MVP-PRD与架构稿.md',
  '03-MVP实施计划与路线图.md',
  '04-AI自主实现执行蓝图.md',
  '05-编译器核心实现规格.md',
  '06-Registry与Block协议规范.md',
  '07-Pass状态机、错误码与恢复机制.md',
  '08-Verification、Provenance与Graph规范.md',
  '09-AI Runtime、任务信封与治理规范.md',
  '10-升级迁移与Override规范.md',
  '11-Workbench与可视化规范.md',
  '12-编译管道与行为流图示.md',
  '13-独立工具分发与打包规划.md',
  '14-Engineering IR与语义事实规范.md',
  'goals/SEC-Engineering-Workspace-Compiler.md',
  'architecture/sec-ts-ir-layers.md',
  'architecture/engineering-workspace-ir.md',
  'architecture/brownfield-import.md',
  'governance/external-capability-and-provider-policy.md',
  'governance/external-capability-ledger.yaml',
  'governance/nexus-absorption-and-conformance.md',
  'governance/nexus-absorption-ledger.yaml',
  'governance/nexus-absorption-report.md',
  CONTROL_PATHS.currentState,
  CONTROL_PATHS.rollingPlan,
  CONTROL_PATHS.activePointer,
  'work/README.md',
  'test-architecture.md',
  'test-feedback-and-ci-lanes.md',
  'slow-suite-registry.md'
] as const;

export const DOCS_DOCTOR_FORBIDDEN_ACTIVE_AUTHORITIES = [
  'goals/sec_document_system_v4',
  'goals/SEC_Document_System_V4_Combined_Reference.md'
] as const;

const NON_AUTHORITY_PREFIXES = [
  'archive/',
  'evidence/',
  'superpowers/',
  'work-packages/',
  'scripts/SEC_docs_v5_replacement/'
] as const;
const WALK_SKIP_PREFIXES = [
  'archive/',
  'superpowers/',
  'scripts/SEC_docs_v5_replacement/'
] as const;
const DOCS_RELATIVE_PREFIXES = [
  'architecture/',
  'evidence/',
  'goals/',
  'governance/',
  'work/',
  'work-packages/'
] as const;
const REPOSITORY_PREFIXES = [
  '.agents/',
  '.claude/',
  '.github/',
  '.githooks/',
  'docs/',
  'platform/',
  'scripts/',
  'tests/'
] as const;
const REPOSITORY_ROOT_FILES = new Set([
  'AGENTS.md',
  'README.md',
  'bun.lock',
  'bunfig.toml',
  'package.json',
  'tsconfig.json'
]);

const DEPRECATED_TOKENS = [
  { token: 'CompilerPass', reason: '已被 Compiler 门面取代（见 05）' },
  { token: 'PassPipeline', reason: '已被 Compiler 门面取代（见 05）' },
  {
    token: 'PASS_DEPENDENCIES',
    reason: '已被 orchestrator 调用顺序 + assertPassStatus 取代',
    allowedContext: /不再以.*形式|已被.*取代/u
  },
  { token: 'pino.transport', reason: '已删除（pino 整体被 zero-dep logger 取代）' }
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
  reason?: string;
}

function posixRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function startsWithPrefix(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function isAuthorityDocument(relativePath: string): boolean {
  return !startsWithPrefix(relativePath, NON_AUTHORITY_PREFIXES);
}

function isWorkPackage(relativePath: string): boolean {
  return relativePath.startsWith('work-packages/');
}

function normalizedReference(reference: string): string {
  return reference
    .replace(/^<|>$/gu, '')
    .replace(/[?#].*$/u, '')
    .replace(/^\.\/+/u, '');
}

function isExternalReference(reference: string): boolean {
  return /^(?:https?:|mailto:|data:|javascript:|#)/iu.test(reference);
}

function isRepositoryCodeReference(reference: string): boolean {
  const normalized = normalizedReference(reference);
  if (
    /[*{}<>]/u.test(normalized)
    || !/(?:^|\/)[^/]+\.[A-Za-z0-9_-]{1,12}$/u.test(normalized)
  ) return false;
  return REPOSITORY_ROOT_FILES.has(normalized)
    || startsWithPrefix(normalized, REPOSITORY_PREFIXES)
    || startsWithPrefix(normalized, DOCS_RELATIVE_PREFIXES);
}

type ReferenceResolution = {
  target?: string;
  repositoryPath?: string;
  invalid?: 'noncanonical' | 'outside-repository';
};

function codeReferenceRepositoryPath(reference: string): string | undefined {
  const normalized = normalizedReference(reference);
  if (!isRepositoryCodeReference(normalized)) return undefined;
  if (normalized.startsWith('docs/') || REPOSITORY_ROOT_FILES.has(normalized)
    || startsWithPrefix(normalized, REPOSITORY_PREFIXES)) {
    return normalized;
  }
  return `docs/${normalized}`;
}

function resolveReference(
  repositoryRoot: string,
  docsRoot: string,
  sourceFile: string,
  rawReference: string,
  kind: 'markdown-link' | 'code-span'
): ReferenceResolution {
  const reference = normalizedReference(rawReference);
  if (!reference || isExternalReference(reference)) return {};

  if (kind === 'code-span') {
    const repositoryPath = codeReferenceRepositoryPath(reference);
    if (!repositoryPath) return {};
    if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
      return { invalid: 'noncanonical', repositoryPath };
    }
    return {
      repositoryPath,
      target: path.join(repositoryRoot, ...repositoryPath.split('/'))
    };
  }

  if (
    path.isAbsolute(reference)
    || /^[A-Za-z]:[\\/]/u.test(reference)
    || reference.includes('\\')
    || reference !== reference.normalize('NFC')
    || reference.includes('\uFFFD')
  ) return { invalid: 'noncanonical' };

  const target = path.resolve(path.dirname(sourceFile), reference);
  const repositoryRelative = path.relative(repositoryRoot, target);
  if (
    repositoryRelative === '..'
    || repositoryRelative.startsWith(`..${path.sep}`)
    || path.isAbsolute(repositoryRelative)
  ) return { invalid: 'outside-repository' };
  const repositoryPath = repositoryRelative.split(path.sep).join('/');
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
    return { invalid: 'noncanonical', repositoryPath };
  }
  return { target, repositoryPath };
}

async function exists(file: string): Promise<boolean> {
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
    const relativePath = posixRelative(root, full);
    if (entry.isDirectory()) {
      const prefix = `${relativePath}/`;
      if (!startsWithPrefix(prefix, WALK_SKIP_PREFIXES)) yield* walk(full, root);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
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
  const statusMatch = match[1]!.match(/^status:\s*([^\s#]+)\s*(?:#.*)?$/mu);
  if (!statusMatch) return { ok: false, reason: 'missing status' };
  const status = statusMatch[1]!.replace(/^['"]|['"]$/gu, '');
  if (!validStatus.has(status)) return { ok: false, reason: `invalid status "${status}"` };
  return { ok: true, status };
}

export function extractH1Headings(content: string): string[] {
  const headings: string[] = [];
  let fence: { character: '`' | '~'; length: number } | undefined;
  for (const line of content.split(/\r?\n/u)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const character = marker[0] as '`' | '~';
      if (!fence) {
        fence = { character, length: marker.length };
      } else if (fence.character === character && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^#\s+(.+?)\s*$/u);
    if (heading) headings.push(heading[1]!.trim());
  }
  return headings;
}

export function extractFileLinks(content: string): string[] {
  const links = content.match(/file:\/\/\/[^\s)`'"]+/gu) ?? [];
  return links.map((link) => {
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
    if (isRepositoryCodeReference(value.replace(/\\/gu, '/'))) paths.push(value);
  }
  return paths;
}

export function extractMarkdownLinks(content: string): string[] {
  const links: string[] = [];
  for (const match of content.matchAll(/!?\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^)\s\r\n]+)(?:\s+["'][^"']*["'])?\s*\)/gu)) {
    links.push(match[1]!);
  }
  return links;
}

async function fileUriExists(link: string): Promise<boolean> {
  let target = link.replace(/^file:\/\//u, '');
  if (/^\/[A-Za-z]:\//u.test(target)) target = target.slice(1);
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function pushIssue(
  issues: DocsDoctorIssue[],
  issue: DocsDoctorIssue
): void {
  if (!issues.some((candidate) => (
    candidate.level === issue.level
    && candidate.code === issue.code
    && candidate.file === issue.file
    && candidate.message === issue.message
  ))) issues.push(issue);
}

function pathDeclaredByManifest(
  repositoryPath: string | undefined,
  declaredPaths: readonly string[]
): boolean {
  if (!repositoryPath) return false;
  return declaredPaths.some((declaredPath) => (
    declaredPath.endsWith('/')
      ? repositoryPath.startsWith(declaredPath)
      : repositoryPath === declaredPath
  ));
}

async function scanControlPlanes(
  options: DocsDoctorScanOptions,
  issues: DocsDoctorIssue[]
): Promise<void> {
  const currentStateFile = path.join(options.docsRoot, CONTROL_PATHS.currentState);
  const rollingPlanFile = path.join(options.docsRoot, CONTROL_PATHS.rollingPlan);
  const pointerFile = path.join(options.docsRoot, CONTROL_PATHS.activePointer);
  if (!(await exists(currentStateFile)) || !(await exists(rollingPlanFile)) || !(await exists(pointerFile))) {
    return;
  }

  try {
    const [currentStateSource, rollingPlanSource, pointerSource] = await Promise.all([
      fs.readFile(currentStateFile, 'utf8'),
      fs.readFile(rollingPlanFile, 'utf8'),
      fs.readFile(pointerFile, 'utf8')
    ]);
    const currentState = CodexDevelopmentParseCurrentStateSpecV1(currentStateSource);
    const rollingPlan = CodexDevelopmentParseRollingPlanV1(rollingPlanSource);
    const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
    CodexDevelopmentAssertControlPlaneBindingV1({ spec: currentState, pointer });

    const manifestId = path.posix.basename(pointer.manifest, '.md');
    if (rollingPlan.activePackageId !== manifestId) {
      throw new Error(
        `Rolling plan active package ${rollingPlan.activePackageId} does not match pointer ${manifestId}.`
      );
    }
    if (options.readCandidateManifestBlob) {
      const manifestBytes = await options.readCandidateManifestBlob(pointer.manifest);
      if (CodexDevelopmentGitBlobSha256(manifestBytes) !== pointer.manifestDigest) {
        throw new Error('Active pointer manifest digest does not match candidate manifest bytes.');
      }
    }
  } catch (error) {
    pushIssue(issues, {
      level: 'error',
      code: 'control-plane-invalid',
      file: 'work/',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function scanDocumentation(
  options: DocsDoctorScanOptions
): Promise<DocsDoctorResult> {
  const docsRoot = path.resolve(options.docsRoot);
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const issues: DocsDoctorIssue[] = [];
  let selectedWorkPackage: string | undefined;
  let selectedDeclaredPaths: string[] = [];
  try {
    const pointerSource = await fs.readFile(
      path.join(docsRoot, CONTROL_PATHS.activePointer),
      'utf8'
    );
    const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
    selectedWorkPackage = pointer.manifest.replace(/^docs\//u, '');
    const manifestSource = await fs.readFile(path.join(repositoryRoot, pointer.manifest), 'utf8');
    const manifest = CodexDevelopmentParseWorkPackageManifest(manifestSource, pointer.manifest);
    selectedDeclaredPaths = [
      ...manifest.tasks.flatMap((task) => task.ownedPaths),
      ...manifest.forbiddenPaths
    ];
  } catch (error) {
    pushIssue(issues, {
      level: 'error',
      code: 'selected-work-package-invalid',
      file: CONTROL_PATHS.activePointer,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  for (const relativePath of DOCS_DOCTOR_REQUIRED_CANONICAL_PATHS) {
    if (!(await exists(path.join(docsRoot, relativePath)))) {
      pushIssue(issues, {
        level: 'error',
        code: 'canonical-owner-missing',
        file: relativePath,
        message: 'required canonical document is missing'
      });
    }
  }
  for (const relativePath of DOCS_DOCTOR_FORBIDDEN_ACTIVE_AUTHORITIES) {
    if (await exists(path.join(docsRoot, relativePath))) {
      pushIssue(issues, {
        level: 'error',
        code: 'retired-authority-present',
        file: relativePath,
        message: 'retired V4 authority must not exist in the active documentation tree'
      });
    }
  }

  for await (const file of walk(docsRoot)) {
    const relativePath = posixRelative(docsRoot, file);
    const repositoryPath = `docs/${relativePath}`;
    const content = await fs.readFile(file, 'utf8');
    const authorityDocument = isAuthorityDocument(relativePath);
    const workPackage = isWorkPackage(relativePath);

    if (
      repositoryPath !== repositoryPath.normalize('NFC')
      || repositoryPath.includes('\uFFFD')
      || !CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)
    ) {
      pushIssue(issues, {
        level: 'error',
        code: 'noncanonical-unicode-path',
        file: relativePath,
        message: 'document path must be normalized canonical repository-relative Unicode'
      });
    }
    if (content.includes('\uFFFD')) {
      pushIssue(issues, {
        level: 'error',
        code: 'unicode-replacement-character',
        file: relativePath,
        message: 'document contains the Unicode replacement character U+FFFD'
      });
    }

    const frontmatter = parseFrontmatter(
      content,
      relativePath === CONTROL_PATHS.activePointer ? ACTIVE_POINTER_STATUS : VALID_STATUS
    );
    if (authorityDocument && relativePath.endsWith('.md') && !frontmatter.ok) {
      pushIssue(issues, {
        level: 'error',
        code: 'frontmatter-invalid',
        file: relativePath,
        message: `frontmatter: ${frontmatter.reason}`
      });
    }

    const h1 = extractH1Headings(content);
    if (authorityDocument && h1.length !== 1) {
      pushIssue(issues, {
        level: 'error',
        code: 'h1-count',
        file: relativePath,
        message: `expected exactly one H1, found ${h1.length}`
      });
    }
    const mentionsRetiredAuthority = DOCS_DOCTOR_FORBIDDEN_ACTIVE_AUTHORITIES.some(
      (retiredPath) => content.includes(`docs/${retiredPath}`)
        || content.includes(retiredPath.replace(/^goals\//u, ''))
    );
    if (
      (frontmatter.status === 'active' || frontmatter.status === 'stable')
      && relativePath !== POLICY_OWNER
      && mentionsRetiredAuthority
    ) {
      pushIssue(issues, {
        level: 'error',
        code: 'retired-authority-reference',
        file: relativePath,
        message: 'active document references a retired V4 authority outside its policy owner'
      });
    }

    for (const link of extractFileLinks(content)) {
      if (!(await fileUriExists(link))) {
        pushIssue(issues, {
          level: 'warn',
          code: 'broken-file-uri',
          file: relativePath,
          message: `broken link: ${link}`
        });
      }
    }

    for (const reference of extractMarkdownLinks(content)) {
      const resolution = resolveReference(
        repositoryRoot,
        docsRoot,
        file,
        reference,
        'markdown-link'
      );
      if (resolution.invalid) {
        pushIssue(issues, {
          level: 'warn',
          code: 'noncanonical-reference',
          file: relativePath,
          message: `${resolution.invalid} Markdown link: ${reference}`
        });
      } else if (resolution.target && !(await exists(resolution.target))) {
        pushIssue(issues, {
          level: 'warn',
          code: 'unresolved-markdown-link',
          file: relativePath,
          message: `unresolved Markdown link: ${reference}`
        });
      }
    }

    if (!workPackage || relativePath === selectedWorkPackage) {
      for (const reference of extractBacktickFilePaths(content)) {
        const normalized = normalizedReference(reference);
        if (
          normalized.includes('\\')
          || normalized !== normalized.normalize('NFC')
          || normalized.includes('\uFFFD')
        ) {
          pushIssue(issues, {
            level: 'warn',
            code: 'noncanonical-inline-path',
            file: relativePath,
            message: `noncanonical inline path: \`${reference}\``
          });
          continue;
        }
        const resolution = resolveReference(
          repositoryRoot,
          docsRoot,
          file,
          reference,
          'code-span'
        );
        if (resolution.invalid) {
          pushIssue(issues, {
            level: 'warn',
            code: 'noncanonical-inline-path',
            file: relativePath,
            message: `noncanonical inline path: \`${reference}\``
          });
        } else if (
          resolution.target
          && !(await exists(resolution.target))
          && !(
            relativePath === selectedWorkPackage
            && pathDeclaredByManifest(resolution.repositoryPath, selectedDeclaredPaths)
          )
        ) {
          pushIssue(issues, {
            level: 'warn',
            code: 'unresolved-inline-path',
            file: relativePath,
            message: `unresolved path: \`${reference}\``
          });
        }
      }
    }

    if (/(?:^|[\s("'`])[A-Za-z]:\\Project\\sec(?:\\|[\s)"'`]|$)/imu.test(content)) {
      pushIssue(issues, {
        level: 'warn',
        code: 'hardcoded-local-repository-path',
        file: relativePath,
        message: 'hard-coded local repository path'
      });
    }

    for (const deprecated of DEPRECATED_TOKENS) {
      let index = content.indexOf(deprecated.token);
      while (index >= 0) {
        const context = content.slice(
          Math.max(0, index - 30),
          index + deprecated.token.length + 30
        );
        if ('allowedContext' in deprecated && deprecated.allowedContext.test(context)) {
          index = content.indexOf(deprecated.token, index + 1);
          continue;
        }
        pushIssue(issues, {
          level: 'warn',
          code: 'deprecated-token',
          file: relativePath,
          message: `deprecated token "${deprecated.token}": ${deprecated.reason}`
        });
        break;
      }
    }
  }

  await scanControlPlanes({ ...options, docsRoot, repositoryRoot }, issues);
  issues.sort((left, right) => (
    (left.level === right.level ? 0 : left.level === 'error' ? -1 : 1)
    || (left.file < right.file ? -1 : left.file > right.file ? 1 : 0)
    || (left.code < right.code ? -1 : left.code > right.code ? 1 : 0)
    || (left.message < right.message ? -1 : left.message > right.message ? 1 : 0)
  ));
  return {
    issues,
    errors: issues.filter((issue) => issue.level === 'error'),
    warnings: issues.filter((issue) => issue.level === 'warn')
  };
}

export function formatDocsDoctorResult(result: DocsDoctorResult): string {
  const lines = [
    '=== docs-doctor ===',
    `errors: ${result.errors.length}`,
    `warns:  ${result.warnings.length}`,
    ''
  ];
  for (const issue of result.issues) {
    lines.push(`  [${issue.level.toUpperCase()}] ${issue.file} (${issue.code}): ${issue.message}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const docsRoot = path.resolve(import.meta.dir, '..');
  const repositoryRoot = path.resolve(docsRoot, '..');
  const result = await scanDocumentation({ docsRoot, repositoryRoot });
  process.stdout.write(formatDocsDoctorResult(result));
  if (result.errors.length > 0) process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
