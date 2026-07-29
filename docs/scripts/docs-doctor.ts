#!/usr/bin/env bun
/** Registry-backed documentation policy scanner. */
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
  CodexDevelopmentGitBlobSha256,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1
} from '../../scripts/codex/document-control-plane-contract.ts';
import { CodexDevelopmentParseWorkPackageManifest } from '../../scripts/codex/work-package-contract.ts';
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
  options: DocsDoctorScanOptions,
  issues: DocsDoctorIssue[]
): Promise<void> {
  try {
    const [currentStateSource, rollingPlanSource, pointerSource] = await Promise.all([
      fs.readFile(path.join(options.repositoryRoot, CONTROL_PATHS.currentState), 'utf8'),
      fs.readFile(path.join(options.repositoryRoot, CONTROL_PATHS.rollingPlan), 'utf8'),
      fs.readFile(path.join(options.repositoryRoot, CONTROL_PATHS.activePointer), 'utf8')
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
      file: 'docs/work/',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function scanDocumentation(
  options: DocsDoctorScanOptions
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

  for (const record of registry.documents) {
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
      if (
        repositoryPath
        && CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)
        && !(await exists(path.join(repositoryRoot, ...repositoryPath.split('/'))))
      ) {
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

  const pointerSource = await fs.readFile(
    path.join(repositoryRoot, CONTROL_PATHS.activePointer),
    'utf8'
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
    const manifestSource = await fs.readFile(path.join(repositoryRoot, selected), 'utf8');
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

if (import.meta.main) {
  const repositoryRoot = path.resolve(import.meta.dir, '../..');
  const result = await scanDocumentation({
    repositoryRoot,
    docsRoot: path.join(repositoryRoot, 'docs')
  });
  for (const issue of result.issues) {
    console.error(`[${issue.level}] ${issue.code} ${issue.file}: ${issue.message}`);
  }
  console.log(`docs-doctor: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
  if (result.errors.length > 0) process.exitCode = 1;
}
