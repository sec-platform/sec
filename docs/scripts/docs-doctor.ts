#!/usr/bin/env bun
/** Registry-backed documentation policy scanner. */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  activeDocumentationPaths,
  documentationRecordByPath,
  parseDocumentationAuthorityRegistry,
  renderDocumentationIndex,
  type DocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../../platform/shared/repository-path-contract.ts';
import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1
} from '../../scripts/codex/document-control-plane-contract.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../scripts/codex/work-package-contract.ts';
import { scanMachineLedgers } from './docs-doctor-ledgers.ts';
import {
  ACTIVE_POINTER_STATUS,
  CONTROL_PATHS,
  DEPRECATED_TOKENS,
  DOCUMENT_AUTHORITY_REGISTRY_PATH,
  DYNAMIC_FACT_PATTERNS,
  VALID_STATUS,
  activeCandidatePath,
  exists,
  extractBacktickFilePaths,
  extractFileLinks,
  extractH1Headings,
  extractMarkdownLinks,
  parseFrontmatter,
  posixRelative,
  pushIssue,
  repositoryPathForInline,
  repositoryPathForLink,
  statusMatches,
  walk,
  type DocsDoctorIssue,
  type DocsDoctorResult,
  type DocsDoctorScanOptions
} from './docs-doctor-shared.ts';

interface DocsDoctorControlPlaneScanOptions extends DocsDoctorScanOptions {
  /** One immutable Git-tree reader used by the production CLI control-plane scan. */
  readonly readControlPlaneBlob?: (repositoryPath: string) => Promise<Uint8Array>;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} must be valid UTF-8.`, { cause: error });
  }
}

async function readControlPlaneBlob(
  options: DocsDoctorControlPlaneScanOptions,
  repositoryPath: string
): Promise<Uint8Array> {
  if (options.readControlPlaneBlob) return options.readControlPlaneBlob(repositoryPath);
  return fs.readFile(path.join(options.repositoryRoot, ...repositoryPath.split('/')));
}

async function readControlPlaneText(
  options: DocsDoctorControlPlaneScanOptions,
  repositoryPath: string,
  label: string
): Promise<string> {
  return decodeUtf8(await readControlPlaneBlob(options, repositoryPath), label);
}

export {
  DOCUMENT_AUTHORITY_REGISTRY_PATH,
  extractBacktickFilePaths,
  extractFileLinks,
  extractH1Headings,
  extractMarkdownLinks,
  parseFrontmatter,
  walk,
  type DocsDoctorFrontmatter,
  type DocsDoctorIssue,
  type DocsDoctorResult,
  type DocsDoctorScanOptions
} from './docs-doctor-shared.ts';

function isMachineLocalAbsolutePath(reference: string): boolean {
  return path.win32.isAbsolute(reference) || path.posix.isAbsolute(reference);
}

function isRepositoryLikeInlinePath(reference: string): boolean {
  const normalized = reference
    .replace(/[?#].*$/u, '')
    .replace(/^\.\/+/u, '')
    .replace(/\\/gu, '/');
  return /^(?:README\.md|AGENTS\.md|(?:\.agents|\.github|\.githooks|docs|platform|scripts|tests)\/)/u
    .test(normalized);
}

async function loadRegistry(
  repositoryRoot: string,
  issues: DocsDoctorIssue[]
): Promise<DocumentationAuthorityRegistry | undefined> {
  try {
    return parseDocumentationAuthorityRegistry(
      await fs.readFile(path.join(repositoryRoot, DOCUMENT_AUTHORITY_REGISTRY_PATH), 'utf8')
    );
  } catch (error) {
    pushIssue(issues, {
      level: 'error',
      code: 'authority-registry-invalid',
      file: DOCUMENT_AUTHORITY_REGISTRY_PATH,
      message: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

async function scanControlPlanes(
  options: DocsDoctorControlPlaneScanOptions,
  issues: DocsDoctorIssue[]
): Promise<void> {
  try {
    const [currentStateSource, rollingPlanSource, pointerSource] = await Promise.all([
      readControlPlaneText(options, CONTROL_PATHS.currentState, 'Current-state spec'),
      readControlPlaneText(options, CONTROL_PATHS.rollingPlan, 'Rolling plan'),
      readControlPlaneText(options, CONTROL_PATHS.activePointer, 'Active Work Package pointer')
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
    const readManifestBlob = options.readControlPlaneBlob ?? options.readCandidateManifestBlob;
    if (readManifestBlob) {
      const manifestBytes = await readManifestBlob(pointer.manifest);
      if (CodexDevelopmentWorkPackageManifestDigest(manifestBytes) !== pointer.manifestDigest) {
        throw new Error('Active pointer manifest digest does not match candidate manifest bytes.');
      }
      CodexDevelopmentParseWorkPackageManifest(
        decodeUtf8(manifestBytes, 'Selected Work Package manifest'),
        pointer.manifest
      );
    }
  } catch (error) {
    pushIssue(issues, {
      level: 'error',
      code: 'control-plane-invalid',
      file: 'docs/work/',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function scanDocumentation(
  options: DocsDoctorControlPlaneScanOptions
): Promise<DocsDoctorResult> {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const docsRoot = path.resolve(options.docsRoot);
  const issues: DocsDoctorIssue[] = [];
  const registry = await loadRegistry(repositoryRoot, issues);
  if (!registry) return {
    issues,
    errors: issues.filter((issue) => issue.level === 'error'),
    warnings: issues.filter((issue) => issue.level === 'warn')
  };

  const registeredPaths = new Set(activeDocumentationPaths(registry));
  for (const record of registry.documents) {
    const target = path.join(repositoryRoot, ...record.path.split('/'));
    if (!(await exists(target))) {
      pushIssue(issues, {
        level: 'error',
        code: 'registered-document-missing',
        file: record.path,
        message: `registry document ${record.id} does not exist`
      });
    }
  }

  for (const rootFile of ['README.md', 'AGENTS.md']) {
    if (await exists(path.join(repositoryRoot, rootFile)) && !registeredPaths.has(rootFile)) {
      pushIssue(issues, {
        level: 'error',
        code: 'unregistered-active-document',
        file: rootFile,
        message: 'active document is not registered'
      });
    }
  }

  for await (const file of walk(docsRoot, repositoryRoot)) {
    const repositoryPath = posixRelative(repositoryRoot, file);
    if (activeCandidatePath(repositoryPath) && !registeredPaths.has(repositoryPath)) {
      pushIssue(issues, {
        level: 'error',
        code: 'unregistered-active-document',
        file: repositoryPath,
        message: 'active document is not registered'
      });
    }
  }

  const incrementalFilter = options.changedDocumentPaths ?? null;
  const isIncremental = incrementalFilter !== null;
  // 当 registry 本身或其投影（docs/README.md）发生变化时，增量模式必须退化为全量
  // per-document 检查：任何文档都可能引用了被变更的 registry/index，需要重新校验链接。
  const registryOrIndexChanged = isIncremental
    && (incrementalFilter.has(DOCUMENT_AUTHORITY_REGISTRY_PATH)
      || incrementalFilter.has('docs/README.md')
      || incrementalFilter.has(CONTROL_PATHS.activePointer)
      || incrementalFilter.has(CONTROL_PATHS.rollingPlan)
      || incrementalFilter.has(CONTROL_PATHS.currentState));
  const effectiveFilter = registryOrIndexChanged ? null : incrementalFilter;

  for (const record of registry.documents) {
    // 增量模式：只对变更文档执行 per-document 诊断；全局不变量已在上文/下文单独校验。
    if (effectiveFilter !== null && !effectiveFilter.has(record.path)) continue;
    const file = path.join(repositoryRoot, ...record.path.split('/'));
    if (!(await exists(file))) continue;
    const content = await fs.readFile(file, 'utf8');

    if (
      record.path !== record.path.normalize('NFC')
      || record.path.includes('\uFFFD')
      || !CodexDevelopmentIsCanonicalRepositoryPathV1(record.path)
    ) {
      pushIssue(issues, {
        level: 'error',
        code: 'noncanonical-unicode-path',
        file: record.path,
        message: 'document path must be canonical NFC repository-relative POSIX'
      });
    }
    if (content.includes('\uFFFD')) {
      pushIssue(issues, {
        level: 'error',
        code: 'unicode-replacement-character',
        file: record.path,
        message: 'document contains Unicode replacement character U+FFFD'
      });
    }

    if (record.path.endsWith('.md') && record.path !== 'README.md' && record.path !== 'AGENTS.md') {
      const frontmatter = parseFrontmatter(
        content,
        record.path === CONTROL_PATHS.activePointer ? ACTIVE_POINTER_STATUS : VALID_STATUS
      );
      if (!frontmatter.ok) {
        pushIssue(issues, {
          level: 'error',
          code: 'frontmatter-invalid',
          file: record.path,
          message: `frontmatter: ${frontmatter.reason}`
        });
      } else {
        if (!statusMatches(record, frontmatter)) {
          pushIssue(issues, {
            level: 'error',
            code: 'registry-lifecycle-mismatch',
            file: record.path,
            message: `registry lifecycle ${record.lifecycle} does not match status ${frontmatter.status}`
          });
        }
        if (record.path !== CONTROL_PATHS.activePointer && frontmatter.domain !== record.domain) {
          pushIssue(issues, {
            level: 'error',
            code: 'registry-domain-mismatch',
            file: record.path,
            message: `registry domain ${record.domain} does not match frontmatter ${frontmatter.domain ?? 'missing'}`
          });
        }
        if (record.generatedFrom && frontmatter.generatedFrom !== record.generatedFrom) {
          pushIssue(issues, {
            level: 'error',
            code: 'generated-source-mismatch',
            file: record.path,
            message: `expected generated-from ${record.generatedFrom}`
          });
        }
      }
      const headings = extractH1Headings(content);
      if (headings.length !== 1) {
        pushIssue(issues, {
          level: 'error',
          code: 'h1-count',
          file: record.path,
          message: `expected exactly one H1, found ${headings.length}`
        });
      }
    }

    if (record.dynamicPolicy === 'forbidden') {
      for (const dynamic of DYNAMIC_FACT_PATTERNS) {
        if (dynamic.pattern.test(content)) {
          pushIssue(issues, {
            level: 'error',
            code: 'dynamic-fact-in-stable-document',
            file: record.path,
            message: `${dynamic.label} is forbidden in stable/projection documentation`
          });
        }
      }
    }

    for (const link of extractFileLinks(content)) {
      pushIssue(issues, {
        level: 'warn',
        code: 'file-uri-reference',
        file: record.path,
        message: `machine-local file URI is not a portable document reference: ${link}`
      });
    }

    for (const reference of extractMarkdownLinks(content)) {
      const resolution = repositoryPathForLink(repositoryRoot, file, reference);
      if (resolution.invalid) {
        pushIssue(issues, {
          level: 'error',
          code: 'noncanonical-reference',
          file: record.path,
          message: `${resolution.invalid} Markdown link: ${reference}`
        });
      } else if (resolution.target && !(await exists(resolution.target))) {
        pushIssue(issues, {
          level: 'error',
          code: 'unresolved-markdown-link',
          file: record.path,
          message: `unresolved Markdown link: ${reference}`
        });
      }
    }

    for (const reference of extractBacktickFilePaths(content)) {
      const repositoryPath = repositoryPathForInline(reference);
      if (!repositoryPath) {
        if (isMachineLocalAbsolutePath(reference)) {
          pushIssue(issues, {
            level: 'error',
            code: 'hardcoded-local-repository-path',
            file: record.path,
            message: `machine-local absolute inline path: ${reference}`
          });
        } else if (isRepositoryLikeInlinePath(reference)) {
          pushIssue(issues, {
            level: 'warn',
            code: 'noncanonical-inline-path',
            file: record.path,
            message: `noncanonical inline path: ${reference}`
          });
        }
        continue;
      }
      if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
        pushIssue(issues, {
          level: 'warn',
          code: 'noncanonical-inline-path',
          file: record.path,
          message: `noncanonical inline path: ${reference}`
        });
      } else if (!(await exists(path.join(repositoryRoot, ...repositoryPath.split('/'))))) {
        pushIssue(issues, {
          level: 'warn',
          code: 'unresolved-inline-path',
          file: record.path,
          message: `unresolved inline path: ${reference}`
        });
      }
    }

    for (const deprecated of DEPRECATED_TOKENS) {
      if (
        content.includes(deprecated.token)
        && !('allowedContext' in deprecated && deprecated.allowedContext.test(content))
      ) {
        pushIssue(issues, {
          level: 'warn',
          code: 'deprecated-token',
          file: record.path,
          message: `${deprecated.token}: ${deprecated.reason}`
        });
      }
    }
  }

  const indexRecord = documentationRecordByPath(registry, 'docs/README.md');
  if (!indexRecord || indexRecord.generatedFrom !== DOCUMENT_AUTHORITY_REGISTRY_PATH) {
    pushIssue(issues, {
      level: 'error',
      code: 'generated-index-owner-invalid',
      file: 'docs/README.md',
      message: 'generated index must be registered as a projection of docs/authority.json'
    });
  } else {
    const actual = await fs.readFile(path.join(repositoryRoot, 'docs/README.md'), 'utf8');
    const expected = renderDocumentationIndex(registry);
    if (actual !== expected) {
      pushIssue(issues, {
        level: 'error',
        code: 'generated-index-drift',
        file: 'docs/README.md',
        message: 'generated documentation index does not match registry projection'
      });
    }
  }

  const pointerSource = await readControlPlaneText(
    options,
    CONTROL_PATHS.activePointer,
    'Active Work Package pointer'
  );
  try {
    const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
    const selected = pointer.manifest;
    const packageRoot = path.join(repositoryRoot, 'docs/work-packages');
    if (await exists(packageRoot)) {
      for (const entry of await fs.readdir(packageRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const packagePath = `docs/work-packages/${entry.name}`;
        if (packagePath !== selected) {
          pushIssue(issues, {
            level: 'error',
            code: 'stale-work-package',
            file: packagePath,
            message: 'only the selected frozen Work Package may remain in the active directory'
          });
        }
      }
    }
    const manifestBytes = await readControlPlaneBlob(options, selected);
    if (CodexDevelopmentWorkPackageManifestDigest(manifestBytes) !== pointer.manifestDigest) {
      throw new Error('Selected Work Package digest does not match the active pointer.');
    }
    const manifestSource = decodeUtf8(manifestBytes, 'Selected Work Package manifest');
    CodexDevelopmentParseWorkPackageManifest(manifestSource, selected);
  } catch (error) {
    pushIssue(issues, {
      level: 'error',
      code: 'selected-work-package-invalid',
      file: CONTROL_PATHS.activePointer,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  await scanMachineLedgers(repositoryRoot, registry, issues);
  await scanControlPlanes(options, issues);

  const sortedIssues = issues.sort((left, right) =>
    left.level.localeCompare(right.level)
    || left.file.localeCompare(right.file)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
  );
  return {
    issues: sortedIssues,
    errors: sortedIssues.filter((issue) => issue.level === 'error'),
    warnings: sortedIssues.filter((issue) => issue.level === 'warn')
  };
}

/**
 * Resolve the set of repository-relative paths changed since `sinceRef` via
 * `git diff --name-only`. Used by the CLI `--since` flag to drive incremental scans.
 */
function resolveChangedDocumentPathsSince(
  repositoryRoot: string,
  sinceRef: string
): SpawnSyncReturns<string> {
  return spawnSync(
    'git',
    ['diff', '--name-only', `${sinceRef}..HEAD`],
    { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }
  );
}

function captureDocsDoctorIndexTree(repositoryRoot: string): string {
  const result = spawnSync('git', ['write-tree'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  const treeSha = result.stdout?.trim() ?? '';
  if (result.error || result.status !== 0 || !/^[0-9a-f]{40}$/u.test(treeSha)) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status ?? 1}`;
    throw new Error(`docs-doctor: immutable Git index tree capture failed: ${detail}`);
  }
  return treeSha;
}

function readCapturedGitTreeBlob(
  repositoryRoot: string,
  treeSha: string,
  repositoryPath: string
): Buffer {
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
    throw new Error(`docs-doctor: captured-tree path is noncanonical: ${repositoryPath}`);
  }
  const result = spawnSync('git', ['show', `${treeSha}:${repositoryPath}`], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    const detail = result.error?.message
      ?? Buffer.from(result.stderr ?? '').toString('utf8').trim()
      ?? `exit ${result.status ?? 1}`;
    throw new Error(`docs-doctor: captured-tree blob read failed for ${repositoryPath}: ${detail}`);
  }
  return result.stdout;
}

if (import.meta.main) {
  const repositoryRoot = path.resolve(import.meta.dir, '../..');
  const argv = process.argv.slice(2);
  let sinceRef: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--since') {
      sinceRef = argv[i + 1];
      if (!sinceRef || sinceRef.startsWith('--')) {
        console.error('docs-doctor: --since requires a git ref argument');
        process.exitCode = 2;
        throw new Error('docs-doctor --since requires a git ref argument');
      }
      i++;
    } else if (arg.startsWith('--since=')) {
      sinceRef = arg.slice('--since='.length);
      if (sinceRef.length === 0) {
        console.error('docs-doctor: --since requires a non-empty git ref');
        process.exitCode = 2;
        throw new Error('docs-doctor --since requires a non-empty git ref');
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log('docs-doctor: registry-backed documentation policy scanner');
      console.log('  --since <git-ref>  Only scan documents changed since the ref (incremental mode)');
      console.log('                    Global invariants (control plane, index drift, machine ledgers)');
      console.log('                    always run; pass without value for full scan.');
      process.exit(0);
    }
  }

  let changedDocumentPaths: ReadonlySet<string> | null = null;
  if (sinceRef) {
    const diffResult = resolveChangedDocumentPathsSince(repositoryRoot, sinceRef);
    if (diffResult.error) {
      console.error(`docs-doctor: git diff --name-only ${sinceRef}..HEAD failed: ${diffResult.error.message}`);
      process.exitCode = 2;
      throw new Error(`docs-doctor: git diff against ${sinceRef} failed`);
    }
    if (diffResult.status !== 0) {
      const detail = diffResult.stderr?.trim() ?? '';
      console.error(`docs-doctor: git diff --name-only ${sinceRef}..HEAD failed${detail.length > 0 ? `: ${detail}` : ''}`);
      process.exitCode = 2;
      throw new Error(`docs-doctor: git diff against ${sinceRef} failed`);
    }
    changedDocumentPaths = new Set(
      diffResult.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    );
    if (changedDocumentPaths.size === 0) {
      console.log('docs-doctor: no changed paths since %s; running full-scan invariants only.', sinceRef);
    } else {
      console.log('docs-doctor: incremental mode, %d changed path(s) since %s', changedDocumentPaths.size, sinceRef);
    }
  }

  const capturedIndexTree = captureDocsDoctorIndexTree(repositoryRoot);
  const result = await scanDocumentation({
    repositoryRoot,
    docsRoot: path.join(repositoryRoot, 'docs'),
    changedDocumentPaths,
    readControlPlaneBlob: async (repositoryPath) =>
      readCapturedGitTreeBlob(repositoryRoot, capturedIndexTree, repositoryPath)
  });
  for (const issue of result.issues) {
    console.error(`[${issue.level}] ${issue.code} ${issue.file}: ${issue.message}`);
  }
  console.log(`docs-doctor: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
  if (result.errors.length > 0) process.exitCode = 1;
}
