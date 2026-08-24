#!/usr/bin/env bun
/** Registry-backed documentation policy scanner. */
import { spawnSync, type SpawnSyncReturns, type StdioOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  compileDocsDoctorIndexSnapshotLayoutV3,
  DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT_V3,
  isDocsDoctorGitObjectIdV3,
  type DocsDoctorGitObjectFormatV3
} from '../../platform/shared/docs-doctor-index-snapshot-contract.ts';
import {
  activeDocumentationPaths,
  documentationRecordByPath,
  parseDocumentationAuthorityRegistry,
  renderDocumentationIndex,
  type DocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';
import { isolatedGitReadEnvironment } from '../../platform/shared/git-read-environment.ts';
import { isPathInside } from '../../platform/shared/paths.ts';
import {
  createExclusiveNoFollowDirectoryV1,
  createNoFollowOrdinaryDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  retainNoFollowDirectoryForChildProcessV1,
  retainNoFollowOrdinaryFileForChildProcessV1,
  scanNoFollowDirectoryTreeInventoryV1,
  type NoFollowDirectoryTreeInventoryEntryV1,
  type PhysicalDirectoryIdentityV1,
  type RetainedNoFollowChildProcessDirectoryV1,
  type RetainedNoFollowChildProcessFileV1
} from '../../platform/shared/physical-no-follow.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../../platform/shared/repository-path-contract.ts';
import { resolveSecRuntimeCacheRootV1 } from '../../platform/shared/sec-runtime-state-contract.ts';
import {
  assertSecRoadmapTerminalCompactionDeltaV2,
  parseSecRoadmapWorkCatalogV1
} from '../../platform/shared/work-selection-live-contract.ts';
import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentClassifyWorkPackageCensusV1,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1
} from '../../scripts/codex/document-control-plane-contract.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../scripts/codex/work-package-contract.ts';
import { acquireSecRuntimeCachePhysicalAuthorityV1 } from '../../tooling/sec-dev/runtime-state-authority.ts';
import { scanMachineLedgers } from './docs-doctor-ledgers.ts';
import {
  ACTIVE_POINTER_STATUS,
  activeCandidatePath,
  CONTROL_PATHS,
  DEPRECATED_TOKENS,
  DOCUMENT_AUTHORITY_REGISTRY_PATH,
  DYNAMIC_FACT_PATTERNS,
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
  VALID_STATUS,
  walk,
  type DocsDoctorIssue,
  type DocsDoctorResult,
  type DocsDoctorScanOptions
} from './docs-doctor-shared.ts';

interface DocsDoctorControlPlaneScanOptions extends DocsDoctorScanOptions {
  /** One immutable Git-tree reader used by the production CLI control-plane scan. */
  readonly readControlPlaneBlob?: (repositoryPath: string) => Promise<Uint8Array>;
  /** Exact candidate-tree Work Package census; never mix an index snapshot with worktree readdir. */
  readonly listControlPlanePackagePaths?: () => Promise<readonly string[]>;
  /** Immutable default-ref reader used only to prove one byte-exact delayed predecessor. */
  readonly readDefaultBranchBlob?: (
    defaultBranchRef: string,
    repositoryPath: string
  ) => Promise<Uint8Array | null>;
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

async function listControlPlanePackagePaths(
  options: DocsDoctorControlPlaneScanOptions,
  repositoryRoot: string
): Promise<readonly string[]> {
  if (options.listControlPlanePackagePaths) {
    const paths = [...await options.listControlPlanePackagePaths()];
    if (paths.some((entry) => !/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(entry))
        || new Set(paths).size !== paths.length) {
      throw new Error('Work Package tree census is noncanonical or duplicated.');
    }
    return paths.sort();
  }
  const packageRoot = path.join(repositoryRoot, 'docs/work-packages');
  if (!(await exists(packageRoot))) return [];
  return (await fs.readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `docs/work-packages/${entry.name}`)
    .sort();
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
    const manifestBytes = await readControlPlaneBlob(options, selected);
    if (CodexDevelopmentWorkPackageManifestDigest(manifestBytes) !== pointer.manifestDigest) {
      throw new Error('Selected Work Package digest does not match the active pointer.');
    }
    const manifestSource = decodeUtf8(manifestBytes, 'Selected Work Package manifest');
    const manifest = CodexDevelopmentParseWorkPackageManifest(manifestSource, selected);
    const packagePaths = await listControlPlanePackagePaths(options, repositoryRoot);
    if (options.readDefaultBranchBlob !== undefined) {
      const roadmapSource = await readControlPlaneText(
        options,
        'docs/roadmap.md',
        'Roadmap Work Selection catalog'
      );
      const priorRoadmapBytes = await options.readDefaultBranchBlob(
        pointer.defaultBranchRef,
        'docs/roadmap.md'
      );
      if (priorRoadmapBytes === null) {
        throw new Error('Default branch is missing the Roadmap Work Selection catalog.');
      }
      const priorRoadmapSource = decodeUtf8(
        priorRoadmapBytes,
        'Default Roadmap Work Selection catalog'
      );
      const priorCatalog = parseSecRoadmapWorkCatalogV1(priorRoadmapSource);
      const priorManifestPaths = (await Promise.all(priorCatalog.items.map(async (item) => {
        const manifestPath = `docs/work-packages/${item.packageId}.md`;
        return await options.readDefaultBranchBlob!(pointer.defaultBranchRef, manifestPath) === null
          ? null
          : manifestPath;
      }))).filter((entry): entry is string => entry !== null);
      assertSecRoadmapTerminalCompactionDeltaV2({
        priorRoadmapSource,
        roadmapSource,
        priorManifestPaths,
        manifestPaths: packagePaths
      });
    }
    const nonSelectedPaths = packagePaths.filter((packagePath) => packagePath !== selected);
    const packageEntries = await Promise.all(packagePaths.map(async (packagePath) => ({
      path: packagePath,
      candidateBytes: packagePath === selected
        ? manifestBytes
        : await readControlPlaneBlob(options, packagePath),
      defaultBytes: packagePath === selected || options.readDefaultBranchBlob === undefined
        ? null
        : await options.readDefaultBranchBlob(pointer.defaultBranchRef, packagePath)
    })));
    const census = CodexDevelopmentClassifyWorkPackageCensusV1({
      selectedManifestPath: selected,
      entries: packageEntries,
      roadmapSource: manifest.tracking === 'none' && nonSelectedPaths.length > 0
        ? await readControlPlaneText(options, 'docs/roadmap.md', 'Roadmap Work Selection catalog')
        : undefined
    });
    if (census.ambiguousPredecessorPaths.length > 0) {
      pushIssue(issues, {
        level: 'error',
        code: 'ambiguous-published-work-package-predecessor',
        file: 'docs/work-packages/',
        message: 'an untracked recovery package may retain exactly one byte-exact catalog predecessor'
      });
    }
    for (const packagePath of census.stalePackagePaths) {
      pushIssue(issues, {
        level: 'error',
        code: 'stale-work-package',
        file: packagePath,
        message: 'only the selected package and one proven delayed predecessor may remain'
      });
    }
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
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: isolatedGitReadEnvironment(),
      windowsHide: true
    }
  );
}

export interface DocsDoctorIndexTreeSnapshotV1 {
  readonly objectFormat: DocsDoctorGitObjectFormatV3;
  readonly treeSha: string;
  readonly gitEnvironment: NodeJS.ProcessEnv;
  readonly gitStdio: StdioOptions;
  dispose(): void;
}

function canonicalGitPath(repositoryRoot: string, source: string, label: string): string {
  const value = source.trim();
  if (value.length === 0 || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error(`docs-doctor: ${label} is not one canonical Git path`);
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repositoryRoot, value);
}

function retainedGitStdio(
  ...entries: readonly Readonly<{ stdioSourceDescriptor: number | null }>[]
): StdioOptions {
  const stdio: Array<'ignore' | 'pipe' | number> = ['pipe', 'pipe', 'pipe'];
  for (const entry of entries) {
    stdio.push(entry.stdioSourceDescriptor ?? 'ignore');
  }
  return Object.freeze(stdio) as StdioOptions;
}

function ancestorInventory(
  entry: NoFollowDirectoryTreeInventoryEntryV1,
  directories: ReadonlyMap<string, NoFollowDirectoryTreeInventoryEntryV1>
) {
  const components = entry.relativePath.split('/');
  components.pop();
  return Object.freeze(components.map((_component, index) => {
    const relativePath = components.slice(0, index + 1).join('/');
    const ancestor = directories.get(relativePath);
    if (ancestor === undefined || ancestor.kind !== 'directory') {
      throw new Error('docs-doctor: snapshot cleanup ancestor inventory is incomplete');
    }
    return Object.freeze({
      relativePath,
      device: ancestor.device,
      inode: ancestor.inode
    });
  }));
}

function deleteDocsDoctorSnapshot(
  snapshotParent: PhysicalDirectoryIdentityV1,
  snapshotRoot: PhysicalDirectoryIdentityV1
): void {
  const inventory = scanNoFollowDirectoryTreeInventoryV1(snapshotRoot);
  const directories = new Map(inventory
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => [entry.relativePath, entry]));
  for (const entry of [...inventory].sort((left, right) =>
    right.relativePath.split('/').length - left.relativePath.split('/').length
      || right.relativePath.localeCompare(left.relativePath))) {
    deleteRetainedNoFollowEntryV1({
      root: snapshotRoot,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories: ancestorInventory(entry, directories)
    });
  }
  deleteRetainedNoFollowEntryV1({
    root: snapshotParent,
    relativePath: path.basename(snapshotRoot.path),
    kind: 'directory',
    device: snapshotRoot.device,
    inode: snapshotRoot.inode,
    ancestorDirectories: []
  });
  if (inspectExactNoFollowDirectoryPresenceV1(
    snapshotRoot.path,
    'docs-doctor snapshot cleanup readback'
  ).state !== 'absent') {
    throw new Error('docs-doctor: index snapshot cleanup readback retained residue');
  }
}

export function captureDocsDoctorIndexTree(
  repositoryRoot: string,
  sourceEnvironment: NodeJS.ProcessEnv = process.env
): DocsDoctorIndexTreeSnapshotV1 {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    throw new Error(`docs-doctor: unsupported runtime platform ${process.platform}`);
  }
  const cacheRoot = resolveSecRuntimeCacheRootV1({
    platform: process.platform,
    environment: {
      SEC_STATE_HOME: sourceEnvironment.SEC_STATE_HOME,
      SEC_CACHE_HOME: sourceEnvironment.SEC_CACHE_HOME,
      LOCALAPPDATA: sourceEnvironment.LOCALAPPDATA,
      XDG_STATE_HOME: sourceEnvironment.XDG_STATE_HOME,
      XDG_CACHE_HOME: sourceEnvironment.XDG_CACHE_HOME,
      HOME: sourceEnvironment.HOME
    },
    repositoryRoot: resolvedRepositoryRoot
  });
  const baseEnvironment = isolatedGitReadEnvironment({}, sourceEnvironment);
  const paths = spawnSync('git', [
    'rev-parse', '--git-path', 'index', '--git-path', 'objects', '--show-object-format'
  ], {
    cwd: resolvedRepositoryRoot,
    encoding: 'utf8',
    env: baseEnvironment,
    windowsHide: true
  });
  const pathLines = paths.stdout?.trim().split(/\r?\n/u) ?? [];
  if (paths.error || paths.status !== 0 || pathLines.length !== 3) {
    const detail = paths.error?.message ?? paths.stderr?.trim() ?? `exit ${paths.status ?? 1}`;
    throw new Error(`docs-doctor: canonical Git index/object paths failed: ${detail}`);
  }
  const indexPath = canonicalGitPath(resolvedRepositoryRoot, pathLines[0]!, 'index path');
  const objectDirectory = canonicalGitPath(resolvedRepositoryRoot, pathLines[1]!, 'object path');
  const objectFormat = pathLines[2];
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new Error(`docs-doctor: unsupported canonical Git object format ${objectFormat ?? 'absent'}`);
  }
  if (objectDirectory.includes(path.delimiter)) {
    throw new Error('docs-doctor: canonical Git index/object paths have an unsafe physical identity');
  }
  const snapshotToken = randomUUID().replaceAll('-', '')
    .slice(0, DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT_V3.snapshotTokenHexLength);
  const snapshotLayout = compileDocsDoctorIndexSnapshotLayoutV3({
    cacheRoot,
    objectFormat,
    platform: process.platform,
    snapshotToken
  });
  const { snapshotParent } = snapshotLayout;
  if (isPathInside(resolvedRepositoryRoot, snapshotParent)) {
    throw new Error('docs-doctor: index snapshot root must remain outside the repository');
  }

  const indexParent = inspectNoFollowDirectoryChainV1(
    path.dirname(indexPath),
    'docs-doctor canonical Git index parent'
  ).target;
  const indexBytes = readNoFollowOrdinaryFileV1(indexParent, path.basename(indexPath));
  if (indexBytes === null) {
    throw new Error('docs-doctor: canonical Git index is absent');
  }
  const objectChain = inspectNoFollowDirectoryChainV1(
    objectDirectory,
    'docs-doctor canonical Git object directory'
  );
  const cacheAuthority = acquireSecRuntimeCachePhysicalAuthorityV1({
    repositoryRoot: resolvedRepositoryRoot,
    cacheRoot,
    requiredDirectories: [snapshotParent]
  });
  const snapshotParentIdentity = cacheAuthority.directory(snapshotParent);
  const snapshotRoot = createExclusiveNoFollowDirectoryV1(
    snapshotParentIdentity,
    snapshotLayout.snapshotName
  );
  let retained = false;
  let originalObjects: RetainedNoFollowChildProcessDirectoryV1 | null = null;
  let snapshotObjects: RetainedNoFollowChildProcessDirectoryV1 | null = null;
  let snapshotIndexFile: RetainedNoFollowChildProcessFileV1 | null = null;
  try {
    const snapshotIndex = path.join(
      snapshotRoot.path,
      DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT_V3.indexName
    );
    const publishedIndex = publishExclusiveDurableCanonicalFileV1({
      parent: snapshotRoot,
      name: DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT_V3.indexName,
      bytes: indexBytes,
      validate: (observed) => {
        if (!Buffer.from(observed).equals(Buffer.from(indexBytes))) {
          throw new Error('docs-doctor: immutable index snapshot bytes changed');
        }
      }
    });
    if (!publishedIndex.created || publishedIndex.path !== snapshotIndex) {
      throw new Error('docs-doctor: immutable index snapshot publication was not exclusive');
    }
    const snapshotRootChain = inspectNoFollowDirectoryChainV1(
      snapshotRoot.path,
      'docs-doctor snapshot root'
    );
    const publishedIndexEntry = inspectNoFollowOrdinaryFileEntryV1(
      snapshotRoot,
      DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT_V3.indexName
    );
    if (publishedIndexEntry === null || publishedIndexEntry.kind !== 'file'
        || publishedIndexEntry.bytes === null
        || !Buffer.from(publishedIndexEntry.bytes).equals(Buffer.from(indexBytes))) {
      throw new Error('docs-doctor: immutable index snapshot physical readback differs');
    }
    const snapshotObjectIdentity = createNoFollowOrdinaryDirectoryChainV1(
      snapshotRoot,
      [DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT_V3.objectDirectoryName]
    );
    originalObjects = retainNoFollowDirectoryForChildProcessV1(
      objectChain,
      3,
      'docs-doctor canonical Git object directory'
    );
    snapshotObjects = retainNoFollowDirectoryForChildProcessV1(
      inspectNoFollowDirectoryChainV1(
        snapshotObjectIdentity.path,
        'docs-doctor snapshot object directory'
      ),
      4,
      'docs-doctor snapshot Git object directory'
    );
    snapshotIndexFile = retainNoFollowOrdinaryFileForChildProcessV1(
      snapshotRootChain,
      publishedIndexEntry,
      5,
      'docs-doctor snapshot Git index'
    );
    const gitStdio = retainedGitStdio(originalObjects, snapshotObjects, snapshotIndexFile);
    const gitEnvironment = isolatedGitReadEnvironment({
      GIT_INDEX_FILE: snapshotIndexFile.childPath,
      GIT_OBJECT_DIRECTORY: snapshotObjects.childPath,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: originalObjects.childPath
    }, sourceEnvironment);
    const result = spawnSync('git', ['write-tree'], {
      cwd: resolvedRepositoryRoot,
      encoding: 'utf8',
      env: gitEnvironment,
      stdio: gitStdio,
      windowsHide: true
    });
    const treeSha = result.stdout?.trim() ?? '';
    if (result.error || result.status !== 0 || !isDocsDoctorGitObjectIdV3(treeSha, objectFormat)) {
      const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status ?? 1}`;
      throw new Error(`docs-doctor: immutable Git index tree capture failed: ${detail}`);
    }
    let disposed = false;
    retained = true;
    return Object.freeze({
      objectFormat,
      treeSha,
      gitEnvironment: Object.freeze({ ...gitEnvironment }),
      gitStdio,
      dispose: () => {
        if (disposed) return;
        const failures: unknown[] = [];
        for (const retainedEntry of [snapshotIndexFile, snapshotObjects, originalObjects]) {
          try { retainedEntry!.assertCurrent(); } catch (error) { failures.push(error); }
          try { retainedEntry!.dispose(); } catch (error) { failures.push(error); }
        }
        try { deleteDocsDoctorSnapshot(snapshotParentIdentity, snapshotRoot); } catch (error) { failures.push(error); }
        disposed = true;
        if (failures.length > 0) {
          throw new AggregateError(failures, 'docs-doctor: retained snapshot disposal failed');
        }
      }
    });
  } finally {
    if (!retained) {
      const failures: unknown[] = [];
      for (const retainedEntry of [snapshotIndexFile, snapshotObjects, originalObjects]) {
        if (retainedEntry === null) continue;
        try { retainedEntry.dispose(); } catch (error) { failures.push(error); }
      }
      try { deleteDocsDoctorSnapshot(snapshotParentIdentity, snapshotRoot); } catch (error) { failures.push(error); }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'docs-doctor: failed snapshot cleanup failed');
      }
    }
  }
}

/**
 * The single reviewed process boundary for exact Git-tree object reads. Its
 * closed modes expose either raw blob bytes or direct tree-entry names without
 * opening another process capability.
 */
export function parseCapturedGitTreeBlobFrameV1(
  source: Uint8Array,
  repositoryPath: string,
  objectFormat: DocsDoctorGitObjectFormatV3 = 'sha1'
): Buffer {
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
    throw new Error(`docs-doctor: captured-tree path is noncanonical: ${repositoryPath}`);
  }
  const frame = Buffer.from(source);
  const headerEnd = frame.indexOf(0x0a);
  if (headerEnd < 0) {
    throw new Error(`docs-doctor: captured-tree blob header is incomplete for ${repositoryPath}.`);
  }
  const header = frame.subarray(0, headerEnd).toString('ascii');
  const match = /^([0-9a-f]+) blob ([1-9][0-9]*|0)$/u.exec(header);
  if (match !== null && !isDocsDoctorGitObjectIdV3(match[1]!, objectFormat)) {
    throw new Error(`docs-doctor: captured-tree blob object id is invalid for ${repositoryPath}.`);
  }
  if (match === null) {
    throw new Error(`docs-doctor: captured-tree blob header is invalid for ${repositoryPath}.`);
  }
  const byteLength = Number(match[2]);
  const bodyStart = headerEnd + 1;
  const bodyEnd = bodyStart + byteLength;
  if (!Number.isSafeInteger(byteLength)
      || bodyEnd + 1 !== frame.length
      || frame[bodyEnd] !== 0x0a) {
    throw new Error(`docs-doctor: captured-tree blob framing is invalid for ${repositoryPath}.`);
  }
  return frame.subarray(bodyStart, bodyEnd);
}

export function readCapturedGitTreeBlob(
  repositoryRoot: string,
  treeSha: string,
  repositoryPath: string,
  observationKind: 'blob-bytes' | 'direct-entry-names' = 'blob-bytes',
  gitEnvironment: NodeJS.ProcessEnv = isolatedGitReadEnvironment(),
  gitStdio?: StdioOptions,
  objectFormat: DocsDoctorGitObjectFormatV3 = 'sha1'
): Buffer {
  const remoteRef = /^refs\/remotes\/[A-Za-z0-9._-]+\/[A-Za-z0-9._\/-]+$/u.test(treeSha);
  if (!remoteRef && !isDocsDoctorGitObjectIdV3(treeSha, objectFormat)) {
    throw new Error(`docs-doctor: captured-tree revision is noncanonical: ${treeSha}`);
  }
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
    throw new Error(`docs-doctor: captured-tree path is noncanonical: ${repositoryPath}`);
  }
  const objectExpression = `${treeSha}:${repositoryPath}`;
  const args = observationKind === 'blob-bytes'
    ? ['cat-file', '--batch']
    : ['ls-tree', '--name-only', objectExpression];
  const result = spawnSync(
    'git',
    args,
    {
      cwd: repositoryRoot,
      encoding: 'buffer',
      env: gitEnvironment,
      stdio: gitStdio,
      input: observationKind === 'blob-bytes'
        ? Buffer.from(`${objectExpression}\n`, 'utf8')
        : undefined,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    }
  );
  if (result.error || result.status !== 0 || !result.stdout) {
    const detail = result.error?.message
      ?? Buffer.from(result.stderr ?? '').toString('utf8').trim()
      ?? `exit ${result.status ?? 1}`;
    throw new Error(`docs-doctor: captured-tree object read failed for ${repositoryPath}: ${detail}`);
  }
  if (observationKind === 'direct-entry-names') return result.stdout;
  return parseCapturedGitTreeBlobFrameV1(result.stdout, repositoryPath, objectFormat);
}

function listCapturedWorkPackagePaths(
  repositoryRoot: string,
  snapshot: DocsDoctorIndexTreeSnapshotV1
): readonly string[] {
  const packageRoot = 'docs/work-packages';
  const source = decodeUtf8(
    readCapturedGitTreeBlob(
      repositoryRoot,
      snapshot.treeSha,
      packageRoot,
      'direct-entry-names',
      snapshot.gitEnvironment,
      snapshot.gitStdio,
      snapshot.objectFormat
    ),
    'Captured Work Package tree listing'
  );
  if (!source.endsWith('\n') || source.includes('\r')) {
    throw new Error('docs-doctor: captured-tree Work Package listing has noncanonical framing.');
  }
  const names = source.slice(0, -1).split('\n');
  const paths = names.map((name) => `${packageRoot}/${name}`);
  if (names.length === 0
      || names.some((name) => name.length === 0 || name.includes('/'))
      || paths.some((entry) => !/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(entry))
      || new Set(paths).size !== paths.length
      || [...paths].sort().some((entry, index) => entry !== paths[index])) {
    throw new Error('docs-doctor: captured-tree Work Package listing is noncanonical or duplicated.');
  }
  return paths;
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
  try {
    const result = await scanDocumentation({
      repositoryRoot,
      docsRoot: path.join(repositoryRoot, 'docs'),
      changedDocumentPaths,
      readControlPlaneBlob: async (repositoryPath) =>
        readCapturedGitTreeBlob(
          repositoryRoot,
          capturedIndexTree.treeSha,
          repositoryPath,
          'blob-bytes',
          capturedIndexTree.gitEnvironment,
          capturedIndexTree.gitStdio,
          capturedIndexTree.objectFormat
        ),
      listControlPlanePackagePaths: async () =>
        listCapturedWorkPackagePaths(repositoryRoot, capturedIndexTree),
      readDefaultBranchBlob: async (defaultBranchRef, repositoryPath) => {
        if (!/^refs\/remotes\/[A-Za-z0-9._-]+\/[A-Za-z0-9._\/-]+$/u.test(defaultBranchRef)) {
          throw new Error('docs-doctor: default-ref predecessor lookup is noncanonical.');
        }
        try {
          return readCapturedGitTreeBlob(
            repositoryRoot,
            defaultBranchRef,
            repositoryPath,
            'blob-bytes',
            capturedIndexTree.gitEnvironment,
            capturedIndexTree.gitStdio,
            capturedIndexTree.objectFormat
          );
        } catch {
          return null;
        }
      }
    });
    for (const issue of result.issues) {
      console.error(`[${issue.level}] ${issue.code} ${issue.file}: ${issue.message}`);
    }
    console.log(`docs-doctor: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    if (result.errors.length > 0) process.exitCode = 1;
  } finally {
    capturedIndexTree.dispose();
  }
}
