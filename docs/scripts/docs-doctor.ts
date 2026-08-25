#!/usr/bin/env bun
/** Registry-backed documentation policy scanner. */
import { spawnSync, type SpawnSyncReturns, type StdioOptions } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { isolatedGitReadEnvironment } from '../../platform/git/read-environment.ts';
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

const DEVELOPMENT_CRITICAL_PATH_GRAPH_ANCHOR =
  '### Development Critical Path Spine 的唯一跨领域图' as const;
const DEVELOPMENT_CRITICAL_PATH_GRAPH_REQUIRED_NODES = Object.freeze([
  'authoringEpoch',
  'authoringStatic',
  'frozenTree',
  'validationSet',
  'staticGeneration',
  'actionAdmission',
  'targetStatic',
  'requiredScope',
  'staticEnough',
  'staticTerminal',
  'liveAuthority',
  'claim',
  'lease',
  'start',
  'capabilityGrant',
  'physicalEffect',
  'effectEvidence',
  'journalTerminal',
  'agreement',
  'release'
]);
const DEVELOPMENT_CRITICAL_PATH_GRAPH_REQUIRED_EDGES = Object.freeze([
  'authoringEpoch --> frozenTree',
  'authoringEpoch --> authoringStatic',
  'frozenTree --> demand',
  'frozenTree --> staticGeneration',
  'demand --> validationSet',
  'validationSet --> actionAdmission',
  'staticGeneration --> actionAdmission',
  'staticClosure --> requiredScope',
  'requiredScope -->|exact required scope closed| staticReceipt',
  'execute --> liveAuthority',
  'liveAuthority -->|current operation-specific grant| claim',
  'claim --> lease',
  'lease --> start',
  'start --> capabilityGrant',
  'capabilityGrant --> physicalEffect',
  'physicalEffect --> effectEvidence',
  'effectEvidence --> journalTerminal',
  'journalTerminal --> agreement',
  'agreement --> release',
  'release --> receipt'
]);
const DEVELOPMENT_CRITICAL_PATH_DECISION_IDS = Object.freeze(
  Array.from({ length: 28 }, (_value, index) => `D${String(index + 1).padStart(2, '0')}`)
);
const DEVELOPMENT_CRITICAL_PATH_RESOURCE_IDS = Object.freeze(
  Array.from({ length: 24 }, (_value, index) => `R${String(index + 1).padStart(2, '0')}`)
);
const DEVELOPMENT_ENGINEERING_PRINCIPLE_IDS = Object.freeze(
  Array.from({ length: 16 }, (_value, index) => `DG${String(index + 1).padStart(2, '0')}`)
);
const DEVELOPMENT_ENGINEERING_PRINCIPLE_GRAPH_BINDINGS = Object.freeze([
  ['DG01', 'DG01 类级根因', 'Droot'],
  ['DG02', 'DG02 PreEffectStaticClosure', 'R09'],
  ['DG03', 'DG03 dynamic-to-static', 'R10'],
  ['DG04', 'DG04 statically computable architecture', 'R06'],
  ['DG05', 'DG05 one logical validation cost', 'D03'],
  ['DG06', 'DG06 mature capability census', 'D09'],
  ['DG07', 'DG07 host/dependency reuse', 'R13'],
  ['DG08', 'DG08 resource lifecycle', 'R21'],
  ['DG09', 'DG09 frozen content, live permission', 'R20'],
  ['DG10', 'DG10 hard authority entry', 'D06'],
  ['DG11', 'DG11 one main graph + projections', 'R22'],
  ['DG12', 'DG12 independent exact-head review', 'R22'],
  ['DG13', 'DG13 bounded subagent analysis<br/>external live-resource binding: typed unknown', 'R23'],
  ['DG14', 'DG14 non-misleading projection', 'D20'],
  ['DG15', 'DG15 place every business before implementation', 'D28'],
  ['DG16', 'DG16 documentation closure before completion', 'R22']
] as const);
const DEVELOPMENT_CRITICAL_PATH_DOMAIN_PROJECTION_MARKERS = Object.freeze([
  '`D03/D04/D21`的代际发布与消费时序',
  '`D05/D11/D12/D22/D23`的Provider阶段、预算、信号与settlement',
  '`D08/D17`的宿主和三root选择',
  '`D10/D12/D13/D14/D24/D25`的release、crash recovery和GC',
  '`D09/D19/D25/D26`的实际宿主与外部资源边界',
  '`DG02/DG03/DG05/DG09/DG10/DG12/DG14`的Verification投影',
  '`DG03/DG07/DG08/DG09`的Runtime与distribution投影',
  '`DG06/DG07/DG08/DG10`的external capability投影'
]);
const IMPORT_AUTHORING_DOCUMENTATION_MARKERS = Object.freeze([
  '#### R24 Import authoring 的完整状态、资源与恢复投影',
  'sec-import-authoring-freeze-receipt-v1',
  '.sec/import-authoring-freeze/current.json',
  'unplanned --> planning',
  'workingTreeCanonical --> indexCanonical',
  'indexCanonical --> receiptCurrent',
  'receiptCurrent --> committedTree',
  'receiptCurrent --> receiptStale',
  'receiptStale --> hookFallback',
  'R24-I01..R24-I10'
]);
const VERIFICATION_SETTLEMENT_DOCUMENTATION_MARKERS = Object.freeze([
  'durable settlement 的 current receipt 是单调状态',
  'Settled --> ReusedWithoutProviderEffect',
  'Settled --> BindingMismatchBlocked',
  '`actionKey`、`executionBindingDigest`、`evidenceDigest`和`providerRevision`',
  '`candidate-implemented-local-focused-verified`',
  'process-tree物理settlement的全production consumer接线仍是另一条未完成边'
]);
const VERIFICATION_TEST_SPLIT_DOCUMENTATION_MARKERS = Object.freeze([
  'tests/integration/development-critical-path-exact-tree.canary.test.ts',
  'logical root identity',
  'zero Git、zero directory birth、zero Runtime State fsync、zero process',
  'reserved semantic inputs、whole-delta、census reuse',
  'hostile Git隔离、index零刷新、首次execute、settled reuse零execute、journal readback',
  '`integration-development-critical-path-exact-tree`唯一suite拥有'
]);
const VERIFICATION_DEADLINE_DOCUMENTATION_MARKERS = Object.freeze([
  'deadline是调度transport，不是settlement authority',
  'ProviderStarted --> DeadlineFired',
  'DeadlineFired --> SignalAborted',
  'SignalAborted --> RunningUnknown',
  'SignalAborted --> TerminalSettlementPending',
  '`phase`、`timeoutMs`、`AbortSignal.aborted`和owner生成的`timeoutError`',
  'deadline port不读取或写入journal'
]);

/**
 * Validate the one human-facing graph as a projection of the machine state
 * order.  This does not make Markdown an authority: it prevents the canonical
 * document from silently omitting or reordering already-owned transitions.
 */
export function validateDevelopmentCriticalPathCanonicalGraphV1(
  source: string,
  principleRegistrySemanticDigest: `sha256:${string}`
): void {
  const anchorCount = source.split(DEVELOPMENT_CRITICAL_PATH_GRAPH_ANCHOR).length - 1;
  if (anchorCount !== 1) {
    throw new Error('Development Critical Path canonical graph anchor must occur exactly once.');
  }
  const afterAnchor = source.slice(source.indexOf(DEVELOPMENT_CRITICAL_PATH_GRAPH_ANCHOR));
  const graphStart = afterAnchor.indexOf('```mermaid');
  const graphEnd = graphStart < 0 ? -1 : afterAnchor.indexOf('```', graphStart + '```mermaid'.length);
  if (graphStart < 0 || graphEnd < 0) {
    throw new Error('Development Critical Path canonical Mermaid graph is missing or unterminated.');
  }
  const graph = afterAnchor.slice(graphStart, graphEnd);
  for (const node of DEVELOPMENT_CRITICAL_PATH_GRAPH_REQUIRED_NODES) {
    if (!new RegExp(`^\\s*${node}(?:\\[|\\{)`, 'mu').test(graph)) {
      throw new Error(`Development Critical Path canonical graph is missing node ${node}.`);
    }
  }
  for (const edge of DEVELOPMENT_CRITICAL_PATH_GRAPH_REQUIRED_EDGES) {
    if (!graph.includes(edge)) {
      throw new Error(`Development Critical Path canonical graph is missing ordered edge ${edge}.`);
    }
  }
  if (!graph.includes('class targetStatic partial;') || !graph.includes('stroke-dasharray')) {
    throw new Error('Development Critical Path whole-delta node must remain visibly partial while domain receipts are missing.');
  }
  if (/(?:^|\n)\s*(?:staticPlan|hostWriter)(?:\[|\{)/u.test(graph)) {
    throw new Error('Development Critical Path canonical graph contains a retired ambiguous node.');
  }
  for (const decisionId of DEVELOPMENT_CRITICAL_PATH_DECISION_IDS) {
    if (!new RegExp(`\\b${decisionId}\\b`, 'u').test(source)) {
      throw new Error(`Development Critical Path causal atlas is missing decision ${decisionId}.`);
    }
  }
  for (const resourceId of DEVELOPMENT_CRITICAL_PATH_RESOURCE_IDS) {
    const occurrences = source.match(new RegExp(`\\b${resourceId}\\b`, 'gu'))?.length ?? 0;
    if (occurrences < 2) {
      throw new Error(
        `Development Critical Path resource atlas must index and graph ${resourceId}.`
      );
    }
  }
  for (const marker of IMPORT_AUTHORING_DOCUMENTATION_MARKERS) {
    if (!source.includes(marker)) {
      throw new Error(`Development Critical Path import authoring documentation is missing ${marker}.`);
    }
  }
  const principleAnchor = '#### 顶层原则到因果与资源图的不可丢失映射';
  const principleSection = source.slice(source.indexOf(principleAnchor));
  const principleGraphStart = principleSection.indexOf('```mermaid');
  const principleGraphEnd = principleGraphStart < 0
    ? -1
    : principleSection.indexOf('```', principleGraphStart + '```mermaid'.length);
  if (source.indexOf(principleAnchor) < 0 || principleGraphStart < 0 || principleGraphEnd < 0) {
    throw new Error('Development Critical Path principle projection graph is missing.');
  }
  const principleGraph = principleSection.slice(principleGraphStart, principleGraphEnd);
  if (!source.includes(`principleRegistrySemanticDigest: ${principleRegistrySemanticDigest}`)) {
    throw new Error('Development Critical Path principle graph does not bind the canonical registry semantic digest.');
  }
  if (/^\s*P\d{2}\s*(?:\[|\{)/mu.test(source)) {
    throw new Error('Development Critical Path local graph nodes must not occupy global Pxx principle identities.');
  }
  for (const principleId of DEVELOPMENT_ENGINEERING_PRINCIPLE_IDS) {
    if (!new RegExp(`^\\s*${principleId}\\["${principleId}\\s`, 'mu').test(principleGraph)) {
      throw new Error(`Development Critical Path principle projection is missing ${principleId}.`);
    }
  }
  for (const [principleId, title, target] of DEVELOPMENT_ENGINEERING_PRINCIPLE_GRAPH_BINDINGS) {
    const expected = `${principleId}["${title}"] --> ${target}`;
    if (!principleGraph.includes(expected)) {
      throw new Error(`Development Critical Path principle projection has an invalid title or edge for ${principleId}.`);
    }
  }
}

export function validateDevelopmentCriticalPathDomainProjectionGraphsV1(input: Readonly<{
  verification: string;
  runtime: string;
  externalProvider: string;
}>): void {
  const sources = `${input.verification}\n${input.runtime}\n${input.externalProvider}`;
  for (const marker of DEVELOPMENT_CRITICAL_PATH_DOMAIN_PROJECTION_MARKERS) {
    if (!sources.includes(marker)) {
      throw new Error(`Development Critical Path domain graph is missing projection marker ${marker}.`);
    }
  }
  for (const marker of VERIFICATION_SETTLEMENT_DOCUMENTATION_MARKERS) {
    if (!input.verification.includes(marker)) {
      throw new Error(`Development Critical Path settlement documentation is missing ${marker}.`);
    }
  }
  for (const marker of VERIFICATION_TEST_SPLIT_DOCUMENTATION_MARKERS) {
    if (!input.verification.includes(marker)) {
      throw new Error(`Development Critical Path test split documentation is missing ${marker}.`);
    }
  }
  for (const marker of VERIFICATION_DEADLINE_DOCUMENTATION_MARKERS) {
    if (!input.verification.includes(marker)) {
      throw new Error(`Development Critical Path deadline documentation is missing ${marker}.`);
    }
  }
  for (const [source, minimum] of [
    [input.verification, 3],
    [input.runtime, 3],
    [input.externalProvider, 2]
  ] as const) {
    const mermaidCount = source.split('```mermaid').length - 1;
    if (mermaidCount < minimum) {
      throw new Error('Development Critical Path domain projection must retain its detailed Mermaid graphs.');
    }
  }
}

export type DevelopmentEngineeringPrincipleRegistryV1 = Readonly<{
  schema: 'sec-development-engineering-principle-registry-v1';
  owner: 'development-governance';
  principles: readonly Readonly<{ id: string; title: string; statement: string }>[];
  semanticDigest: `sha256:${string}`;
}>;

export function parseDevelopmentEngineeringPrincipleRegistryV1(
  source: string
): DevelopmentEngineeringPrincipleRegistryV1 {
  const anchor = '## 工程顶层原则的合取闭包';
  if (source.split(anchor).length - 1 !== 1) {
    throw new Error('Development engineering principle conjunction must have exactly one canonical anchor.');
  }
  const nextHeading = source.indexOf('\n## ', source.indexOf(anchor) + anchor.length);
  const section = source.slice(source.indexOf(anchor), nextHeading < 0 ? source.length : nextHeading);
  const candidatePrincipleIds = [...section.matchAll(/^\s*\|\s*((?:DG|P)\d{2})\s*\|/gmu)]
    .map((match) => match[1]!);
  const globalIdentity = candidatePrincipleIds.find((id) => /^P\d{2}$/u.test(id));
  if (globalIdentity !== undefined) {
    throw new Error(`Development engineering principle conjunction must not redefine global ${globalIdentity} identity.`);
  }
  const unknownIdentity = candidatePrincipleIds.find((id) =>
    id.startsWith('DG') && !DEVELOPMENT_ENGINEERING_PRINCIPLE_IDS.includes(id)
  );
  if (unknownIdentity !== undefined) {
    throw new Error(`Development engineering principle conjunction contains unknown identity ${unknownIdentity}.`);
  }
  for (const principleId of DEVELOPMENT_ENGINEERING_PRINCIPLE_IDS) {
    if (candidatePrincipleIds.filter((id) => id === principleId).length !== 1) {
      throw new Error(`Development engineering principle conjunction must define ${principleId} exactly once.`);
    }
  }
  const principleRows = [...section.matchAll(/^\| (DG\d{2}) \| ([^|\r\n]+) \| ([^\r\n]+) \|$/gmu)]
    .map((match) => Object.freeze({
      id: match[1]!,
      title: match[2]!.trim(),
      statement: match[3]!.trim()
    }));
  if (principleRows.length !== DEVELOPMENT_ENGINEERING_PRINCIPLE_IDS.length) {
    throw new Error('Development engineering principle conjunction must define exactly sixteen structured rows.');
  }
  for (const [index, principleId] of DEVELOPMENT_ENGINEERING_PRINCIPLE_IDS.entries()) {
    if (principleRows[index]?.id !== principleId) {
      throw new Error(`Development engineering principle conjunction must define ${principleId} exactly once and in canonical order.`);
    }
  }
  for (const requiredBoundary of [
    '新增原则只能加入合取',
    '不能覆盖、折叠、降级',
    '原生Bun/Git/Docker命令可以保留为非authority诊断能力',
    'A0保留统一决策、集成与验证',
    'candidate不等于selected',
    'documentation-closure-missing'
  ]) {
    if (!section.includes(requiredBoundary)) {
      throw new Error(`Development engineering principle conjunction is missing boundary: ${requiredBoundary}.`);
    }
  }
  const material = Object.freeze({
    schema: 'sec-development-engineering-principle-registry-v1' as const,
    owner: 'development-governance' as const,
    principles: Object.freeze(principleRows)
  });
  return Object.freeze({
    ...material,
    semanticDigest: `sha256:${createHash('sha256').update(JSON.stringify(material)).digest('hex')}`
  });
}

export function validateDevelopmentEngineeringPrincipleConjunctionV1(source: string): void {
  parseDevelopmentEngineeringPrincipleRegistryV1(source);
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
  if (registeredPaths.has('docs/system-architecture.md')) {
    try {
      const principleRegistry = parseDevelopmentEngineeringPrincipleRegistryV1(
        await fs.readFile(path.join(repositoryRoot, 'docs/development-governance.md'), 'utf8')
      );
      validateDevelopmentCriticalPathCanonicalGraphV1(
        await fs.readFile(path.join(repositoryRoot, 'docs/system-architecture.md'), 'utf8'),
        principleRegistry.semanticDigest
      );
    } catch (error) {
      pushIssue(issues, {
        level: 'error',
        code: 'development-critical-path-graph-invalid',
        file: 'docs/system-architecture.md',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (registeredPaths.has('docs/development-governance.md')) {
    try {
      validateDevelopmentEngineeringPrincipleConjunctionV1(
        await fs.readFile(path.join(repositoryRoot, 'docs/development-governance.md'), 'utf8')
      );
    } catch (error) {
      pushIssue(issues, {
        level: 'error',
        code: 'development-engineering-principle-conjunction-invalid',
        file: 'docs/development-governance.md',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (registeredPaths.has('docs/verification-governance.md')
      && registeredPaths.has('docs/runtime-and-distribution.md')
      && registeredPaths.has('docs/external-provider-policy.md')) {
    try {
      validateDevelopmentCriticalPathDomainProjectionGraphsV1({
        verification: await fs.readFile(
          path.join(repositoryRoot, 'docs/verification-governance.md'),
          'utf8'
        ),
        runtime: await fs.readFile(
          path.join(repositoryRoot, 'docs/runtime-and-distribution.md'),
          'utf8'
        ),
        externalProvider: await fs.readFile(
          path.join(repositoryRoot, 'docs/external-provider-policy.md'),
          'utf8'
        )
      });
    } catch (error) {
      pushIssue(issues, {
        level: 'error',
        code: 'development-critical-path-domain-graph-invalid',
        file: 'docs/system-architecture.md',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
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
