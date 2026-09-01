#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createOptions as createKnipOptions,
  type Issues as KnipIssues,
  type MainOptions as KnipMainOptions
} from 'knip/session';
import ts from 'typescript';

import {
  classifySecRepositorySurface,
  resolveSecMarkdownSkillCoverage,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_HEURISTIC_BEHAVIOR_IDS,
  SEC_REPOSITORY_HEURISTIC_ROUTES,
  type SecAgentSkillId,
  type SecRepositorySurfaceKind
} from '../../control/agent/skill.ts';
import {
  CodexDevelopmentClassifyWorkPackageCensus,
  CodexDevelopmentParseActivePointer,
  CodexDevelopmentParseRollingPlan
} from '../../control/documentation/document-control-plane-contract.ts';
import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { type GitReadSession, type GitReadSessionCommand } from '../../external-capabilities/git-read/runtime/session.ts';
import { parseWorktreeStatusPorcelainZ } from '../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  retainCommandAuxiliaryOrdinaryFiles,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  RetainedCommandTransportError
} from '../../runtime-state/physical/runtime/process.ts';
import {
  PhysicalResourceCompositeSettlementError,
  settlePhysicalResources
} from '../../runtime-state/physical/runtime/resource-settlement.ts';
import {
  openContentAddressedWorkspaceCacheSession,
  type ContentAddressedWorkspaceCacheSession
} from '../../runtime-state/workspace-state/content-addressed-workspace-cache.ts';
import { currentSecRuntimePlatform, resolveSecRuntimeCacheRoot, secRuntimeStateEnvironment } from '../../runtime-state/workspace-state/layout.ts';
import { createRepositoryCompilationCacheProvider } from '../../runtime-state/workspace-state/repository-compilation-cache-provider.ts';
import { compareCodeUnits, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import {
  assertSecRepositoryModuleArchitectureBoundaries,
  compileSecRepositoryModuleArchitectureProjection,
  compileSecRepositoryModuleMembershipSnapshot,
  compileSecRepositoryModuleTopologyProjection,
  type SecRepositoryModuleArchitectureProjection,
  type SecRepositoryModuleMembership,
  type SecRepositoryModuleTopologyProjection
} from '../../system-architecture/repository-modules/contract.ts';
import { isSecRepositoryTestModulePath } from '../../system-architecture/repository-modules/test-module-path.ts';
import { compilerRuntimeLayout } from '../../toolchain/runtime.ts';
import {
  SEC_TCB_CLOSURE_RUNTIME_PATH,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH
} from '../../verification/trust/contract/root.ts';
import { tsconfigRelativePath } from '../../workspace/runtime/paths.ts';
import { SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODES, sourceProgramSurfaceForPath, type SourceProgramCandidate, type SourceProgramFileInput, type SourceProgramModel, type SourceProgramOwnerIntentEvidence, type SourceProgramSupersessionReceipt } from '../source-program-model/contract.ts';
import {
  compileSourceProgramDeclarationTopology,
  type SourceProgramDeclarationTopology
} from '../source-program-model/declaration-topology.ts';
import { compileSourceProgramImplementationDominance } from '../source-program-model/implementation-dominance.ts';
import {
  compileSourceProgramReconciliationProjection
} from '../source-program-model/reconciliation-projection.ts';
import { buildSourceProgramAggregateImportReductionPatch, compileSourceProgramAggregateImportReductionPlan, compileSourceProgramGraphCutReductionPlan, compileSourceProgramSupersessionEvidence, compileSourceProgramSupersessionEvidenceIdentity, compileSourceProgramSupersessionReceipt, compileSourceProgramTestRetirementReceipt, compileSourceProgramVersionSuffixReductionPlan, parseSourceProgramSupersessionEvidence, projectSourceProgramTestRetirementDispositions, renderSourceProgramGraphCutReductionPatch, renderSourceProgramVersionSuffixReductionPatch, type SourceProgramSupersessionEvidence, type SourceProgramSupersessionEvidenceIdentity, type SourceProgramUnusedSymbolEvidence } from '../source-program-model/reduction.ts';
import { compileRepositorySourceProgramCompilation } from '../source-program-model/repository-compilation.ts';
import { compileSourceProgramOwnerIntentEvidence, summarizeSourceProgramTopology } from '../source-program-model/repository.ts';
import { compileSourceProgramTestBaselineEvidence, compileSourceProgramTestValue, reconcileSourceProgramTestValueWithSupersession, SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES, summarizeSourceProgramTestUnknownDispositionClusters, type SourceProgramTestBaselineEvidence, type SourceProgramTestFinding } from '../source-program-model/test-value.ts';
import { querySourceProgramModel, releaseTypeScriptSourceProgramWorkspace } from '../source-program-model/typescript.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot,
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput
} from '../source-program-model/workspace-source-snapshot.ts';

const DEFAULT_REPOSITORY_ROOT = compilerRuntimeLayout.packageRoot;
const MAX_TEXT_FILE_BYTES = 2_000_000;
const GIT_BATCH_BYTE_BUDGET = 16 * 1024 * 1024;
const GIT_BATCH_OUTPUT_OVERHEAD = 2 * 1024 * 1024;
const SOURCE_PROGRAM_AUDIT_DEADLINE_MS = 180_000;
const SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES = 1024 * 1024;
const SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES = 64 * 1024 * 1024;
const SOURCE_PROGRAM_AUDIT_GIT_PROCESS_BUDGET = 128;
const SOURCE_PROGRAM_AUDIT_STDERR_BUDGET_BYTES = 4 * 1024 * 1024;
export const SOURCE_PROGRAM_AUDIT_DEADLINE_ENV = 'SEC_REPOSITORY_AUDIT_DEADLINE_AT_UNIX_MS';
const SOURCE_PROGRAM_AUDIT_OPERATION = 'brownfield.repository-audit.source-program';
const SOURCE_PROGRAM_AUDIT_REQUIREMENT = 'brownfield.repository-audit.worker-process';
const SOURCE_PROGRAM_CACHE_REQUIREMENT = 'brownfield.repository-audit.source-program-cache';
const HEURISTIC_MARKER = /(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|优先|默认|触发|停止|回退|重算|fail[- ]?closed|DO NOT MERGE|reload_if|gate_owner|\bmust\b|\bshould\b|\bnever\b|\bdo\s+not\b)/iu;
const AGENT_CONTEXT_MARKER = /(?:\bAgent\b|\bCodex\b|\bWork\s+Package\b|\bTask\s+Envelope\b|\bSkill\b|\bReview\b|\bCI\b|\bGate\b|\bmerge\b|\bbranch\b|\btool\b|工具|文档|验证|仓库|上下文|恢复|分派|权限|\bowner\b|\bauthority\b)/iu;
const STRONG_AGENT_CONTEXT_MARKER = /(?<![/\\])\b(?:Agent|Codex)\b/iu;
const NAVIGATION_AGENT_HEADING_MARKER = /(?:\bAgent\b|\bCodex\b)/iu;
const NAVIGATION_AGENT_DIRECTIVE_MARKER = /(?:(?:\bAgent\b|\bCodex\b)[^。；\n]{0,48}(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|优先|默认|触发|停止|回退|\bmust\b|\bshould\b|\bnever\b|\bdo\s+not\b)|(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|\bmust\b|\bshould\b|\bnever\b|\bdo\s+not\b)[^。；\n]{0,48}(?:\bAgent\b|\bCodex\b)|\b(?:Agent|Codex)\s+(?:rules?|instructions?)\b)/iu;
const NON_AUTHORITY_BEHAVIOR_PATH = /^(?:docs\/(?:archive|evidence|superpowers)\/)|(?:^|\/)[^/]+\.min\.(?:css|js)$/iu;
const MINIFIED_GENERATED_PATH = /(?:^|\/)[^/]+\.min\.(?:css|js)$/iu;
const JAVASCRIPT_OR_TYPESCRIPT_PATH = /\.(?:[cm]?[jt]s|[jt]sx)$/iu;
const REPOSITORY_TEST_PATH = /^tests\//iu;
const TEST_FIXTURE_EXTENSION = /\.(?:json|md|markdown|txt)$/iu;
const TEST_FIXTURE_DIRECTORY = /(?:^|\/)(?:__)?(?:fixtures?|snapshots?)(?:__)?(?:\/|$)/iu;
const MALFORMED_REPOSITORY_REFERENCE = /(?:\t(?:ests|platform|scripts|docs)\/|\\(?:tests|platform|scripts|docs)\/)/u;
const DYNAMIC_IDENTITY = /(?:\b[0-9a-f]{40}\b|\bPR\s*#\d+\b|\b(?:run|job)\s*#?\d{8,}\b)/iu;

function reviewedProcessDispatcherCachePath(repositoryRoot: string): string {
  const platform = currentSecRuntimePlatform();
  const cacheRoot = resolveSecRuntimeCacheRoot({
    platform,
    environment: secRuntimeStateEnvironment(),
    repositoryRoot
  });
  return path.join(cacheRoot, 'source-program-model', 'reviewed-process-dispatchers.json');
}

function supersessionEvidenceCachePath(repositoryRoot: string, identityDigest: string): string {
  const cacheRoot = resolveSecRuntimeCacheRoot({
    platform: currentSecRuntimePlatform(),
    environment: secRuntimeStateEnvironment(),
    repositoryRoot
  });
  return path.join(
    cacheRoot,
    'source-program-model',
    'supersession',
    `${identityDigest.slice('sha256:'.length)}.json`
  );
}

function encodeCacheEnvelope(identity: string, value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  return Buffer.concat([
    Buffer.from(`${identity}\n${rawSha256(payload)}\n`, 'utf8'),
    payload
  ]);
}

function decodeCacheEnvelope(
  bytes: Buffer,
  expectedIdentity: string
): unknown | null {
  const firstNewline = bytes.indexOf(0x0a);
  const secondNewline = firstNewline < 0 ? -1 : bytes.indexOf(0x0a, firstNewline + 1);
  if (firstNewline <= 0 || secondNewline <= firstNewline + 1) return null;
  const identity = bytes.subarray(0, firstNewline).toString('utf8');
  const digest = bytes.subarray(firstNewline + 1, secondNewline).toString('utf8');
  const payload = bytes.subarray(secondNewline + 1);
  if (identity !== expectedIdentity || digest !== rawSha256(payload)) return null;
  try {
    return JSON.parse(payload.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

type ReviewedProcessDispatcherProjection = Readonly<{
  inputDigests: Readonly<Record<string, string>>;
  reviewedProcessDispatchers: readonly string[];
}>;

function parseReviewedProcessDispatcherProjection(
  value: unknown
): ReviewedProcessDispatcherProjection | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const projection = value as Partial<ReviewedProcessDispatcherProjection>;
  if (projection.inputDigests === null || typeof projection.inputDigests !== 'object'
      || Array.isArray(projection.inputDigests)
      || !Array.isArray(projection.reviewedProcessDispatchers)
      || projection.reviewedProcessDispatchers.some((value) => typeof value !== 'string')) return null;
  for (const [repositoryPath, digest] of Object.entries(projection.inputDigests)) {
    if (repositoryPath.length === 0 || !/^sha256:[0-9a-f]{64}$/u.test(digest)) return null;
  }
  return Object.freeze({
    inputDigests: Object.freeze({ ...projection.inputDigests }),
    reviewedProcessDispatchers: Object.freeze([...projection.reviewedProcessDispatchers])
  });
}

async function readReviewedProcessDispatcherProjection(
  repositoryRoot: string
): Promise<ReviewedProcessDispatcherProjection | null> {
  try {
    const bytes = await readFile(reviewedProcessDispatcherCachePath(repositoryRoot));
    return parseReviewedProcessDispatcherProjection(
      decodeCacheEnvelope(bytes, SEC_TCB_CLOSURE_RUNTIME_PATH)
    );
  } catch {
    return null;
  }
}

async function writeReviewedProcessDispatcherProjection(
  repositoryRoot: string,
  projection: ReviewedProcessDispatcherProjection
): Promise<void> {
  const cachePath = reviewedProcessDispatcherCachePath(repositoryRoot);
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    temporaryPath,
    encodeCacheEnvelope(SEC_TCB_CLOSURE_RUNTIME_PATH, projection),
    { flag: 'wx' }
  );
  try {
    await rename(temporaryPath, cachePath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function reviewedProcessDispatchersFromExactProjection(
  files: readonly SourceProgramFileInput[],
  cached: ReviewedProcessDispatcherProjection | null
): readonly string[] | null {
  if (cached === null) return null;
  const digestByPath = new Map(files.map(({ path: repositoryPath, contentDigest }) =>
    [repositoryPath, contentDigest] as const));
  return Object.keys(cached.inputDigests).length > 0
    && cached.inputDigests[SEC_TCB_CLOSURE_RUNTIME_PATH] !== undefined
    && cached.inputDigests[SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH] !== undefined
    && Object.entries(cached.inputDigests).every(([repositoryPath, digest]) =>
      digestByPath.get(repositoryPath) === digest)
    ? cached.reviewedProcessDispatchers
    : null;
}

async function resolveImmutableRevisionProcessDispatchers(
  repositoryRoot: string,
  files: readonly SourceProgramFileInput[]
): Promise<readonly string[]> {
  const cached = reviewedProcessDispatchersFromExactProjection(
    files,
    await readReviewedProcessDispatcherProjection(repositoryRoot)
  );
  if (cached === null) {
    throw new Error(
      'Immutable Git-tree process dispatcher facts require an exact cached trusted-runtime projection'
    );
  }
  return cached;
}

async function resolveReviewedProcessDispatchers(
  repositoryRoot: string,
  files: readonly SourceProgramFileInput[]
): Promise<readonly string[]> {
  const digestByPath = new Map(files.map(({ path: repositoryPath, contentDigest }) =>
    [repositoryPath, contentDigest] as const));
  const cached = reviewedProcessDispatchersFromExactProjection(
    files,
    await readReviewedProcessDispatcherProjection(repositoryRoot)
  );
  if (cached !== null) return cached;
  const { trustedRuntimeClosure } = await import('../../verification/trust/compiler.ts');
  const closure = trustedRuntimeClosure();
  const inputPaths = new Set([
    ...closure.closure,
    SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH
  ]);
  const inputDigests = Object.freeze(Object.fromEntries(
    [...inputPaths]
      .sort(compareCodeUnits)
      .map((repositoryPath) => {
        const digest = digestByPath.get(repositoryPath);
        if (digest === undefined) {
          throw new Error(`TCB reviewed process projection input is absent from the exact census: ${repositoryPath}`);
        }
        return [repositoryPath, digest];
      })
  ));
  const projection: ReviewedProcessDispatcherProjection = Object.freeze({
    inputDigests,
    reviewedProcessDispatchers: Object.freeze(
      [...closure.reviewedProcessDispatchers].sort(compareCodeUnits)
    )
  });
  await writeReviewedProcessDispatcherProjection(repositoryRoot, projection).catch(() => undefined);
  return projection.reviewedProcessDispatchers;
}

async function readSupersessionEvidenceCache(
  repositoryRoot: string,
  identity: SourceProgramSupersessionEvidenceIdentity
): Promise<SourceProgramSupersessionEvidence | null> {
  const identityDigest = sha256(identity);
  try {
    const bytes = await readFile(supersessionEvidenceCachePath(repositoryRoot, identityDigest));
    const parsed = parseSourceProgramSupersessionEvidence(
      decodeCacheEnvelope(bytes, identityDigest)
    );
    return sha256(parsed.identity) === identityDigest ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSupersessionEvidenceCache(
  repositoryRoot: string,
  evidence: SourceProgramSupersessionEvidence
): Promise<void> {
  const identityDigest = sha256(evidence.identity);
  const cachePath = supersessionEvidenceCachePath(repositoryRoot, identityDigest);
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(temporaryPath, encodeCacheEnvelope(identityDigest, evidence), { flag: 'wx' });
  try {
    await rename(temporaryPath, cachePath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function supersessionEvidenceIdentity(input: Readonly<{
  revisionDigest: string;
  treeDigest: string;
}>): SourceProgramSupersessionEvidenceIdentity {
  return compileSourceProgramSupersessionEvidenceIdentity({
    revisionDigest: input.revisionDigest,
    treeDigest: input.treeDigest,
    toolchainDigest: sha256({ bun: Bun.version, typescript: ts.version }),
    // The complete tree is a conservative configuration closure: it may
    // invalidate more often than necessary but cannot omit a semantic input.
    configurationDigest: input.treeDigest
  });
}

function repositoryAuditGitBudget(deadlineAtUnixMs?: number): Readonly<{
  deadlineMs: number;
  maxProcesses: number;
  maxStdinBytes: number;
  maxStdoutBytes: number;
  maxCommandStdoutBytes: number;
}> {
  const deadlineMs = deadlineAtUnixMs === undefined
    ? 120_000
    : Math.min(120_000, deadlineAtUnixMs - Date.now());
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) {
    throw new Error('Repository audit Git read deadline is exhausted.');
  }
  return Object.freeze({
    deadlineMs,
    maxProcesses: SOURCE_PROGRAM_AUDIT_GIT_PROCESS_BUDGET,
    maxStdinBytes: GIT_BATCH_BYTE_BUDGET,
    maxStdoutBytes: 64 * 1024 * 1024,
    maxCommandStdoutBytes: GIT_BATCH_BYTE_BUDGET + GIT_BATCH_OUTPUT_OVERHEAD
  });
}

function repositoryModuleTopologyGitBudget(): ReturnType<typeof repositoryAuditGitBudget> {
  return Object.freeze({
    deadlineMs: 15_000,
    maxProcesses: 8,
    maxStdinBytes: 1,
    maxStdoutBytes: 24 * 1024 * 1024,
    maxCommandStdoutBytes: 16 * 1024 * 1024
  });
}

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
  architecture: SecRepositoryModuleArchitectureProjection;
  declarationTopology: SourceProgramDeclarationTopology;
  behaviorCandidates: readonly BehaviorCandidate[];
  heuristicRoutes: typeof SEC_REPOSITORY_HEURISTIC_ROUTES;
  contentCoverage: readonly RepositoryContentCoverage[];
  findings: readonly RepositoryAuditFinding[];
  optimizations: readonly string[];
  sourceProgram: SourceProgramModel;
  sourceProgramCompilation: Readonly<{
    subjectDigest: `sha256:${string}`;
    snapshotDigest: `sha256:${string}`;
    moduleGraphDigest: `sha256:${string}`;
    receiptDigest: `sha256:${string}`;
  }>;
  revision: Readonly<{
    defaultHead: string | null;
    defaultRef: string;
    defaultRefInput: string;
    defaultRefMode: 'exact-sha' | 'ref';
    head: string;
    tree: string;
    worktree: 'clean' | 'dirty' | 'unresolved';
  }>;
  summary: Readonly<{
    activeMarkdown: number;
    behaviorCandidates: number;
    contentCoverage: Readonly<Record<RepositoryContentCoverageStatus, number>>;
    findings: Readonly<Record<RepositoryAuditSeverity, number>>;
    markdown: number;
    sourceProgram: Readonly<{
      capabilities: number;
      candidates: number;
      declarations: number;
      dependencies: number;
      entrypoints: number;
      entrypointClosures: number;
      files: number;
      literals: number;
      packages: number;
      references: number;
      unknowns: number;
    }>;
    skills: number;
    trackedPaths: number;
    unknowns: number;
  }>;
  surfaces: Readonly<Record<SecRepositorySurfaceKind, number>>;
  unknowns: readonly string[];
}

export interface RepositoryAuditCliProjection {
  readonly architecture: Readonly<{
    readonly evidenceDigest: ReturnType<typeof sha256>;
    readonly feedbackProjections: number;
    readonly reciprocalPairs: number;
    readonly strongComponents: number;
    readonly violations: number;
  }>;
  readonly declarationTopology: Readonly<{
    readonly evidenceDigest: `sha256:${string}`;
    readonly declarations: number;
    readonly edges: number;
    readonly strongComponents: number;
    readonly cyclicComponents: number;
    readonly unknowns: number;
  }>;
  readonly reportDigest: `sha256:${string}`;
  readonly revision: RepositoryAuditReport['revision'];
  readonly summary: RepositoryAuditReport['summary'];
  readonly findingCodes: readonly string[];
  readonly unknownsDigest: `sha256:${string}`;
}

/**
 * Interactive audit output is a decision projection, not a second report.
 * The exact full report remains available through --full or --output.
 */
export function projectRepositoryAuditCli(
  report: RepositoryAuditReport
): RepositoryAuditCliProjection {
  return Object.freeze({
    architecture: projectRepositoryModuleArchitectureCli(report.architecture),
    declarationTopology: Object.freeze({
      evidenceDigest: report.declarationTopology.topologyDigest,
      declarations: report.declarationTopology.declarations.length,
      edges: report.declarationTopology.edges.length,
      strongComponents: report.declarationTopology.strongComponents.length,
      cyclicComponents: report.declarationTopology.strongComponents.filter(
        ({ declarationObservationIds }) => declarationObservationIds.length > 1
      ).length,
      unknowns: report.declarationTopology.unknowns.length
    }),
    reportDigest: rawSha256(JSON.stringify(report)),
    revision: report.revision,
    summary: report.summary,
    findingCodes: Object.freeze([...new Set(report.findings.map(({ code }) => code))].sort()),
    unknownsDigest: rawSha256(JSON.stringify(report.unknowns))
  });
}

export type RepositoryModuleArchitectureAudit = Readonly<{
  readonly feedbackProjections: SecRepositoryModuleArchitectureProjection['feedbackCuts'];
  readonly reciprocalPairs: SecRepositoryModuleArchitectureProjection['reciprocalPairs'];
  readonly strongComponents: SecRepositoryModuleArchitectureProjection['strongComponents'];
  readonly violations: SecRepositoryModuleArchitectureProjection['violations'];
}>;

export function projectRepositoryModuleArchitectureCli(
  architecture: SecRepositoryModuleArchitectureProjection
): RepositoryAuditCliProjection['architecture'] {
  return Object.freeze({
    evidenceDigest: sha256(projectRepositoryModuleArchitectureAudit(architecture)),
    feedbackProjections: architecture.feedbackCuts.length,
    reciprocalPairs: architecture.reciprocalPairs.length,
    strongComponents: architecture.strongComponents.length,
    violations: architecture.violations.length
  });
}

/**
 * Bounded decision projection over the canonical repository-module graph.
 * Feedback projections retain their deterministic DFS witnesses. They are
 * diagnostic cycle evidence, not a minimum or automatically applicable cut.
 */
export function projectRepositoryModuleArchitectureAudit(
  architecture: SecRepositoryModuleArchitectureProjection
): RepositoryModuleArchitectureAudit {
  return Object.freeze({
    feedbackProjections: architecture.feedbackCuts,
    reciprocalPairs: architecture.reciprocalPairs,
    strongComponents: architecture.strongComponents,
    violations: architecture.violations
  });
}

export function repositoryModuleArchitectureShouldBlock(
  architecture: Pick<SecRepositoryModuleArchitectureProjection, 'violations'>
): boolean {
  return architecture.violations.length > 0;
}

function compactRecordSet<T>(records: readonly T[]): Readonly<{
  count: number;
  digest: ReturnType<typeof sha256>;
}> {
  return Object.freeze({ count: records.length, digest: sha256(records) });
}

export interface BehaviorCandidate {
  line: number;
  path: string;
  skills: readonly SecAgentSkillId[];
  text: string;
}

export interface RepositorySourceGovernanceProjection {
  candidates: readonly BehaviorCandidate[];
  blockingFindings: readonly RepositoryAuditFinding[];
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

function completedGitReadCommand(
  command: GitReadSessionCommand,
  args: readonly string[]
): Readonly<{ code: number; stdout: Buffer; stderr: string }> {
  if (command.kind !== 'completed') {
    throw new Error(
      `git ${args.join(' ')} could not be observed: ${command.reason}: ${command.detail}`
    );
  }
  return Object.freeze({
    code: command.result.code,
    stdout: Buffer.from(command.result.stdout),
    stderr: command.result.stderr
  });
}

function exactGitUtf8(bytes: Buffer, label: string): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error(`${label} is not canonical UTF-8`);
  }
  return text;
}

async function runGitBytes(
  session: GitReadSession,
  args: readonly string[],
  options: GitOptions & Readonly<{ input?: Uint8Array }> = {}
): Promise<Buffer | null> {
  const result = completedGitReadCommand(
    await session.run(args, options.input === undefined ? {} : { input: options.input }),
    args
  );
  if (result.code !== 0) {
    if (options.allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

async function runGitText(
  session: GitReadSession,
  args: readonly string[],
  options: GitOptions = {}
): Promise<string | null> {
  const bytes = await runGitBytes(session, args, options);
  return bytes === null ? null : exactGitUtf8(bytes, `git ${args.join(' ')}`).trim();
}

async function revisionTreeEntries(
  session: GitReadSession,
  revision: string
): Promise<GitTreeEntry[]> {
  const raw = await runGitBytes(session, [
    'ls-tree', '-r', '-z', '-l', '--full-tree', revision
  ]);
  if (raw === null) throw new Error(`git ls-tree returned no output for ${revision}`);

  const entries = exactGitUtf8(raw, `git ls-tree ${revision}`).split('\0').filter(Boolean).map((record) => {
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
): Promise<string[]> {
  return withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: repositoryAuditGitBudget() },
    async (session) => (await revisionTreeEntries(session, revision)).map(
      ({ path: repositoryPath }) => repositoryPath
    )
  );
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

async function readBatchGitBlobs(
  session: GitReadSession,
  entries: readonly GitTreeEntry[]
): Promise<Map<string, GitBlobRead>> {
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
    const args = ['cat-file', '--batch'] as const;
    const input = Buffer.from(`${objectIds.join('\n')}\n`, 'utf8');
    const markBatchUnavailable = (reason: string): void => {
      for (const objectId of objectIds) {
        blobs.set(objectId, { bytes: null, reason });
      }
    };
    let result: Readonly<{ code: number; stdout: Buffer; stderr: string }>;
    try {
      result = completedGitReadCommand(await session.run(args, { input }), args);
    } catch (error) {
      markBatchUnavailable(
        `blob-unavailable:${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    if (result.code !== 0 || result.stdout.length > expectedBatchBytes + GIT_BATCH_OUTPUT_OVERHEAD) {
      markBatchUnavailable(
        `blob-unavailable:${result.stderr.trim() || `exit-${result.code}`}`
      );
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
    && !isJavaScriptOrTypeScriptTestPath(repositoryPath)
    && (
      TEST_FIXTURE_EXTENSION.test(repositoryPath)
      || TEST_FIXTURE_DIRECTORY.test(repositoryPath)
    );
}

function isJavaScriptOrTypeScriptTestPath(repositoryPath: string): boolean {
  return sourceProgramSurfaceForPath(repositoryPath) === 'test'
    && JAVASCRIPT_OR_TYPESCRIPT_PATH.test(repositoryPath);
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

async function revisionTextCandidates(
  session: GitReadSession,
  entries: readonly GitTreeEntry[]
): Promise<Readonly<{
  bytesByPath: ReadonlyMap<string, Buffer>;
  contentCoverage: readonly RepositoryContentCoverage[];
  textByPath: ReadonlyMap<string, string | null>;
}>> {
  const readableEntries = entries.filter((entry) =>
    entry.type === 'blob'
    && (entry.mode === '100644' || entry.mode === '100755')
    && entry.size !== null
    && entry.size <= MAX_TEXT_FILE_BYTES);
  const blobs = await readBatchGitBlobs(session, readableEntries);
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
      && !isJavaScriptOrTypeScriptTestPath(entry.path)
    ) {
      contentCoverage.push(
        coverageResult(entry, 'unknown', unsupportedTestSyntaxReason(entry.path))
      );
      textByPath.set(entry.path, null);
      continue;
    }
    if (isJavaScriptOrTypeScriptTestPath(entry.path)) {
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

async function revisionSourceProgramFiles(
  session: GitReadSession,
  entries: readonly GitTreeEntry[]
): Promise<Readonly<{
  files: readonly SourceProgramFileInput[];
  unknowns: readonly import('../source-program-model/contract.ts').SourceProgramUnknown[];
}>> {
  const readableEntries = entries.filter(({ type, mode, size }) =>
    type === 'blob'
    && (mode === '100644' || mode === '100755')
    && size !== null
    && size <= MAX_TEXT_FILE_BYTES);
  const blobs = await readBatchGitBlobs(session, readableEntries);
  const files: SourceProgramFileInput[] = [];
  const unknowns: import('../source-program-model/contract.ts').SourceProgramUnknown[] = [];
  for (const entry of entries) {
    if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) continue;
    if (entry.size === null || entry.size > MAX_TEXT_FILE_BYTES) {
      unknowns.push(Object.freeze({
        code: 'baseline-path-oversized',
        path: entry.path,
        detail: `${entry.size ?? '<unknown>'}>${MAX_TEXT_FILE_BYTES}`,
        span: null
      }));
      continue;
    }
    const read = blobs.get(entry.object);
    if (read?.bytes === null || read === undefined) {
      unknowns.push(Object.freeze({
        code: 'baseline-path-unreadable',
        path: entry.path,
        detail: `Git object ${entry.object} was not returned by the retained batch reader`,
        span: null
      }));
      continue;
    }
    if (knownBinaryReason(read.bytes) !== null || read.bytes.includes(0)) continue;
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
    } catch {
      unknowns.push(Object.freeze({
        code: 'baseline-path-invalid-utf8',
        path: entry.path,
        detail: 'strict UTF-8 decode failed',
        span: null
      }));
      continue;
    }
    files.push(Object.freeze({
      path: entry.path,
      source,
      contentDigest: rawSha256(read.bytes)
    }));
  }
  return Object.freeze({
    files: Object.freeze(files.sort((left, right) => compareCodeUnits(left.path, right.path))),
    unknowns: Object.freeze(unknowns.sort((left, right) => compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.code, right.code)))
  });
}

async function compileRevisionSupersessionEvidence(
  repositoryRoot: string,
  commitSha: string,
  files: readonly SourceProgramFileInput[],
  unknowns: readonly import('../source-program-model/contract.ts').SourceProgramUnknown[],
  identity: SourceProgramSupersessionEvidenceIdentity,
  dependencyGeneration: RetainedNoFollowProvenDirectoryGeneration,
  cachedEvidence: SourceProgramSupersessionEvidence | null
): Promise<Readonly<{
  compilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  evidence: SourceProgramSupersessionEvidence;
  membership: SecRepositoryModuleMembership;
}>> {
  const descriptorSources = files
    .filter(({ path: repositoryPath }) => path.posix.basename(repositoryPath) === 'sec.module.json')
    .map(({ path: descriptorPath, source }) => ({ descriptorPath, source }));
  const membership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: files.map(({ path: repositoryPath }) => repositoryPath),
    descriptorSources
  });
  const revisionUnknowns = [...unknowns];
  let reviewedProcessDispatchers: readonly string[] = Object.freeze([]);
  try {
    reviewedProcessDispatchers = await resolveImmutableRevisionProcessDispatchers(
      repositoryRoot,
      files
    );
  } catch (error) {
    revisionUnknowns.push(Object.freeze({
      code: 'baseline-trusted-runtime-projection-unresolved',
      path: '.',
      detail: error instanceof Error ? error.message : String(error),
      span: null
    }));
  }
  const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot,
    commitSha
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath,
    { dependencyGeneration }
  );
  const compilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot,
    projectInput,
    reviewedProcessDispatchers,
    unknowns: revisionUnknowns
  });
  const model = compilation.model;
  return Object.freeze({
    compilation,
    membership,
    evidence: cachedEvidence ?? compileSourceProgramSupersessionEvidence({
      model,
      tests: compileSourceProgramTestValue({
        repositoryRoot: DEFAULT_REPOSITORY_ROOT,
        files,
        model
      }),
      intentEvidence: compileSourceProgramOwnerIntentEvidence(model, membership),
      identity
    })
  });
}

async function repositoryWorktreeState(
  session: GitReadSession
): Promise<'clean' | 'dirty' | 'unresolved'> {
  const status = await runGitBytes(session, [
    '-c', 'core.quotepath=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ], { allowFailure: true });
  if (status === null) return 'unresolved';
  return status.length === 0 ? 'clean' : 'dirty';
}

type WorkingTreeModuleTopology = Readonly<{
  sourceRevision: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  moduleGraphDigest: `sha256:${string}`;
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  files: number;
  references: number;
  unresolvedFiles: readonly string[];
  topology: SecRepositoryModuleTopologyProjection;
}>;

async function compileWorkingTreeModuleTopology(
  repositoryRoot: string
): Promise<WorkingTreeModuleTopology> {
  return withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: repositoryModuleTopologyGitBudget() },
    async (session) => {
      const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
      if (workspaceSnapshot.moduleMembership.descriptors.length === 0) {
        throw new Error('Working-tree module topology requires at least one sec.module.json descriptor');
      }
      const graph = workspaceSnapshot.moduleGraph;
      return Object.freeze({
        sourceRevision: workspaceSnapshot.sourceRevision,
        snapshotDigest: workspaceSnapshot.snapshotDigest,
        moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
        workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
        files: graph.files.length,
        references: graph.references.length,
        unresolvedFiles: graph.unresolvedFiles,
        topology: compileSecRepositoryModuleTopologyProjection(
          graph,
          workspaceSnapshot.moduleMembership
        )
      });
    }
  );
}

async function compileKnipUnusedSymbolEvidence(
  repositoryRoot: string
): Promise<readonly SourceProgramUnusedSymbolEvidence[]> {
  const options = await createKnipOptions({
    cwd: repositoryRoot,
    includedIssueTypes: ['exports', 'types'],
    isShowProgress: false
  });
  const { main: runKnip } = await import('knip') as unknown as Readonly<{
    main(options: KnipMainOptions): Promise<Readonly<{ issues: KnipIssues }>>;
  }>;
  const result = await runKnip(options);
  const providerRevision = rawSha256(await readFile(new URL(import.meta.resolve('knip'))));
  const evidence: SourceProgramUnusedSymbolEvidence[] = [];
  for (const issueRecords of [result.issues.exports, result.issues.types]) {
    for (const [rawPath, symbols] of Object.entries(issueRecords)) {
      const repositoryPath = rawPath.replaceAll('\\', '/');
      for (const name of Object.keys(symbols)) {
        evidence.push(Object.freeze({
          path: repositoryPath,
          name,
          provider: 'knip',
          providerRevision
        }));
      }
    }
  }
  return Object.freeze(evidence.sort((left, right) =>
    compareCodeUnits(left.path, right.path) || compareCodeUnits(left.name, right.name)));
}

async function compileWorkingTreeSourceProgram(
  repositoryRoot: string,
  supersessionBaseline: string,
  deadlineAtUnixMs: number
): Promise<Readonly<{
  cache: 'hit' | 'incremental' | 'miss';
  sourceProgramCompilation: Readonly<{
    subjectDigest: `sha256:${string}`;
    snapshotDigest: `sha256:${string}`;
    moduleGraphDigest: `sha256:${string}`;
    receiptDigest: `sha256:${string}`;
  }>;
  currentSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  invalidatedTypeScriptPaths: readonly string[];
  declarationTopology: SourceProgramDeclarationTopology;
  model: SourceProgramModel;
  moduleArchitecture: SecRepositoryModuleArchitectureProjection;
  moduleBoundaryFailures: readonly string[];
  baselineTestPaths: readonly string[];
  baselineTestEvidence: readonly SourceProgramTestBaselineEvidence[];
  baselineSourceFiles: readonly SourceProgramFileInput[];
  baselineSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  baselineModuleMembership: SecRepositoryModuleMembership;
  baselineSupersessionEvidence: SourceProgramSupersessionEvidence;
  currentSupersessionIdentity: SourceProgramSupersessionEvidenceIdentity;
  currentIntentEvidence: readonly SourceProgramOwnerIntentEvidence[];
  moduleMembership: SecRepositoryModuleMembership;
  reviewedProcessDispatchers: readonly string[];
  sourceFiles: readonly SourceProgramFileInput[];
}>> {
  const runtime = await import('../../toolchain/dependencies/runtime.ts');
  const authority = await runtime.observeCompilerDependencyExecutionGenerationAuthority(
    { deadlineAtUnixMs },
    repositoryRoot
  );
  if (authority === null) {
    throw new Error('Working-tree Source Program audit requires one admitted compiler dependency generation.');
  }
  const retained = await runtime.retainCompilerDependencyExecutionGeneration(authority, {
    deadlineAtUnixMs
  });
  try {
    return await withAuthorityGitReadSession(
      { cwd: repositoryRoot, budget: repositoryAuditGitBudget(deadlineAtUnixMs) },
      async (session) => compileWorkingTreeSourceProgramWithSession(
        session,
        repositoryRoot,
        supersessionBaseline,
        deadlineAtUnixMs,
        retained.physicalGeneration
      )
    );
  } finally {
    await retained.retire();
  }
}

function openRepositoryCompilationCacheSession(input: Readonly<{
  repositoryRoot: string;
  deadlineAtUnixMs: number;
  sourceByteLength: number;
  sourceFileCount: number;
}>): ContentAddressedWorkspaceCacheSession {
  const durationMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(durationMs) || durationMs < 1
      || !Number.isSafeInteger(input.sourceByteLength) || input.sourceByteLength < 0
      || !Number.isSafeInteger(input.sourceFileCount) || input.sourceFileCount < 1) {
    throw new Error('Repository compilation cache requires one live, bounded Source Program operation.');
  }
  const repository = inspectNoFollowDirectoryChain(
    input.repositoryRoot,
    'Repository compilation cache repository root'
  ).target;
  const contractDigest = sha256({
    operation: 'brownfield.repository-compilation-cache',
    physicalProvider: 'runtime-state.content-addressed-workspace-cache',
    authority: 'non-authoritative-acceleration-only'
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'brownfield.repository-compilation-cache',
    intentDigest: sha256({
      repository,
      sourceByteLength: input.sourceByteLength,
      sourceFileCount: input.sourceFileCount
    }) as SecOperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES },
      { resource: 'output-bytes', maximum: SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES },
      { resource: 'records', maximum: Math.max(64, input.sourceFileCount * 4) }
    ],
    requirements: [{
      id: SOURCE_PROGRAM_CACHE_REQUIREMENT,
      contractDigest,
      effectKinds: ['filesystem'],
      failureKinds: [
        'cache.cancelled',
        'cache.deadline-exhausted',
        'cache.physical-replacement',
        'cache.resource-budget-exhausted',
        'cache.settlement-unproven'
      ]
    }]
  });
  const operation = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: SOURCE_PROGRAM_CACHE_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: sha256({
      provider: 'runtime-state.content-addressed-workspace-cache',
      repository
    }) as SecOperationDigest
  })]);
  return openContentAddressedWorkspaceCacheSession({
    operation,
    requirementId: SOURCE_PROGRAM_CACHE_REQUIREMENT,
    repository
  });
}

async function compileWorkingTreeSourceProgramWithSession(
  session: GitReadSession,
  repositoryRoot: string,
  supersessionBaseline: string,
  deadlineAtUnixMs: number,
  dependencyGeneration: RetainedNoFollowProvenDirectoryGeneration
): Promise<Readonly<{
  cache: 'hit' | 'incremental' | 'miss';
  sourceProgramCompilation: Readonly<{
    subjectDigest: `sha256:${string}`;
    snapshotDigest: `sha256:${string}`;
    moduleGraphDigest: `sha256:${string}`;
    receiptDigest: `sha256:${string}`;
  }>;
  currentSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  invalidatedTypeScriptPaths: readonly string[];
  declarationTopology: SourceProgramDeclarationTopology;
  model: SourceProgramModel;
  moduleArchitecture: SecRepositoryModuleArchitectureProjection;
  moduleBoundaryFailures: readonly string[];
  baselineTestPaths: readonly string[];
  baselineTestEvidence: readonly SourceProgramTestBaselineEvidence[];
  baselineSourceFiles: readonly SourceProgramFileInput[];
  baselineSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  baselineModuleMembership: SecRepositoryModuleMembership;
  baselineSupersessionEvidence: SourceProgramSupersessionEvidence;
  currentSupersessionIdentity: SourceProgramSupersessionEvidenceIdentity;
  currentIntentEvidence: readonly SourceProgramOwnerIntentEvidence[];
  moduleMembership: SecRepositoryModuleMembership;
  reviewedProcessDispatchers: readonly string[];
  sourceFiles: readonly SourceProgramFileInput[];
}>> {
  const before = await runGitBytes(session, [
    '-c', 'core.quotepath=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ]);
  if (before === null) {
    throw new Error('Working-tree Source Program Model requires Git status');
  }
  const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
  const repositoryPaths = workspaceSnapshot.files.map(({ path: repositoryPath }) => repositoryPath);
  if (supersessionBaseline.startsWith('-')) {
    throw new Error('--supersession-baseline cannot begin with -');
  }
  const exactSupersessionBaseline = await runGitText(session, [
    'rev-parse', '--verify', `${supersessionBaseline}^{commit}`
  ]);
  if (exactSupersessionBaseline === null || !/^[0-9a-f]{40,64}$/u.test(exactSupersessionBaseline)) {
    throw new Error('--supersession-baseline must resolve to one exact commit');
  }
  const exactCurrentHead = await runGitText(session, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (exactCurrentHead === null || !/^[0-9a-f]{40,64}$/u.test(exactCurrentHead)) {
    throw new Error('Working-tree Source Program Model requires one exact HEAD commit');
  }
  const baselineEntries = await revisionTreeEntries(session, exactSupersessionBaseline);
  const baselineTreeDigest = rawSha256(JSON.stringify(baselineEntries.map(
    ({ mode, object, path: repositoryPath, size, type }) => ({
      mode,
      object,
      path: repositoryPath,
      size,
      type
    })
  )));
  const baselineIdentity = supersessionEvidenceIdentity({
    revisionDigest: rawSha256(Buffer.from(exactSupersessionBaseline, 'utf8')),
    treeDigest: baselineTreeDigest
  });
  const baselineSource = await revisionSourceProgramFiles(session, baselineEntries);
  const cachedBaselineSupersessionEvidence = await readSupersessionEvidenceCache(
    repositoryRoot,
    baselineIdentity
  );
  const baselineReconciliation = await compileRevisionSupersessionEvidence(
    repositoryRoot,
    exactSupersessionBaseline,
    baselineSource.files,
    baselineSource.unknowns,
    baselineIdentity,
    dependencyGeneration,
    cachedBaselineSupersessionEvidence
  );
  const baselineSupersessionEvidence = baselineReconciliation.evidence;
  if (cachedBaselineSupersessionEvidence === null) {
    await writeSupersessionEvidenceCache(repositoryRoot, baselineReconciliation.evidence)
      .catch(() => undefined);
  }
  releaseTypeScriptSourceProgramWorkspace();
  const baselineTestPaths = Object.freeze(
    baselineEntries
      .filter(({ path: repositoryPath }) => isSecRepositoryTestModulePath(repositoryPath))
      .map(({ path: repositoryPath }) => repositoryPath)
      .sort(compareCodeUnits)
  );
  const baselineTestRevision = rawSha256(JSON.stringify(
    baselineEntries
      .filter(({ path: repositoryPath }) => isSecRepositoryTestModulePath(repositoryPath))
      .map(({ mode, object, path: repositoryPath, size, type }) => ({
        mode,
        object,
        path: repositoryPath,
        size,
        type
      }))
  ));
  const files = workspaceSnapshot.files;
  const presentRepositoryPaths = repositoryPaths;
  const unknowns: import('../source-program-model/contract.ts').SourceProgramUnknown[] = [];
  const candidateTestPaths = new Set(
    presentRepositoryPaths.filter((repositoryPath) => isSecRepositoryTestModulePath(repositoryPath))
  );
  const baselineTestSource = baselineSource;
  const baselineTestEvidence = compileSourceProgramTestBaselineEvidence(
    baselineTestPaths,
    baselineTestSource.files.filter(({ path: repositoryPath }) =>
      isSecRepositoryTestModulePath(repositoryPath)
      && !candidateTestPaths.has(repositoryPath)),
    baselineTestRevision,
    files
  );
  const moduleMembership = workspaceSnapshot.moduleMembership;
  if (moduleMembership.descriptors.length === 0) {
    unknowns.push(Object.freeze({
      code: 'working-tree-module-ownership-unavailable',
      path: '.',
      detail: 'no sec.module.json descriptor is present',
      span: null
    }));
  }
  const moduleBoundaryFailures: string[] = [];
  const currentSupersessionIdentity = supersessionEvidenceIdentity({
    revisionDigest: rawSha256(Buffer.concat([
      Buffer.from(`${exactCurrentHead}\n`, 'utf8'),
      before
    ])),
    treeDigest: workspaceSnapshot.sourceRevision
  });
  const reviewedProcessDispatchers = await resolveReviewedProcessDispatchers(
    repositoryRoot,
    files
  );
  const after = await runGitBytes(session, [
    '-c', 'core.quotepath=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ]);
  if (after === null || !before.equals(after)) {
    unknowns.push(Object.freeze({
      code: 'working-tree-changed-during-source-program-census',
      path: '.',
      detail: `start=${rawSha256(before)} end=${after === null ? '<unavailable>' : rawSha256(after)}`,
      span: null
    }));
  }
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath,
    { dependencyGeneration }
  );
  const cacheSession = openRepositoryCompilationCacheSession({
    repositoryRoot,
    deadlineAtUnixMs,
    sourceByteLength: workspaceSnapshot.sourceByteLength ?? (() => {
      throw new Error('Repository compilation cache requires a physical Source Program byte observation');
    })(),
    sourceFileCount: workspaceSnapshot.files.length
  });
  let compilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  try {
    compilation = compileRepositorySourceProgramCompilation({
      workspaceSnapshot,
      projectInput,
      cacheProvider: createRepositoryCompilationCacheProvider({ session: cacheSession }),
      repositoryRoot,
      reviewedProcessDispatchers,
      unknowns
    });
  } finally {
    cacheSession.close();
  }
  const moduleGraph = compilation.workspaceSnapshot.moduleGraph;
  const incrementalCompilation = compilation.typeScriptCompilation;
  const model = compilation.model;
  const declarationTopology = compileSourceProgramDeclarationTopology(compilation);
  const moduleArchitecture = compileSecRepositoryModuleArchitectureProjection(
    moduleGraph,
    moduleMembership,
    model
  );
  try {
    assertSecRepositoryModuleArchitectureBoundaries(moduleGraph, moduleMembership, model);
  } catch (error) {
    moduleBoundaryFailures.push(error instanceof Error ? error.message : String(error));
  }
  const sortedModuleBoundaryFailures = Object.freeze(
    [...new Set(moduleBoundaryFailures)].sort(compareCodeUnits)
  );
  return Object.freeze({
    cache: incrementalCompilation.mode === 'exact'
      ? 'hit'
      : incrementalCompilation.mode === 'incremental'
        ? 'incremental'
        : 'miss',
    sourceProgramCompilation: Object.freeze({
      subjectDigest: compilation.subjectDigest,
      snapshotDigest: compilation.snapshotDigest,
      moduleGraphDigest: compilation.moduleGraphDigest,
      receiptDigest: compilation.receiptDigest
    }),
    currentSourceProgramCompilation: compilation,
    invalidatedTypeScriptPaths: incrementalCompilation.invalidatedPaths,
    declarationTopology,
    model,
    moduleArchitecture,
    moduleBoundaryFailures: sortedModuleBoundaryFailures,
    baselineTestPaths,
    baselineTestEvidence,
    baselineSourceFiles: baselineTestSource.files,
    baselineSourceProgramCompilation: baselineReconciliation.compilation,
    baselineModuleMembership: baselineReconciliation.membership,
    baselineSupersessionEvidence,
    currentSupersessionIdentity,
    currentIntentEvidence: compileSourceProgramOwnerIntentEvidence(model, moduleMembership),
    moduleMembership,
    reviewedProcessDispatchers,
    sourceFiles: Object.freeze(files)
  });
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
      && !isJavaScriptOrTypeScriptTestPath(repositoryPath)
    )
  ) return [];
  const markdown = resolveSecMarkdownSkillCoverage(repositoryPath);
  if (markdown && (
    markdown.kind === 'historical'
    || markdown.kind === 'evidence'
    || markdown.kind === 'frozen-work-package'
    || markdown.kind === 'control-projection'
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
      const directContext = markdown?.kind === 'navigation'
        ? NAVIGATION_AGENT_DIRECTIVE_MARKER.test(logical)
        : contextMarker.test(logical);
      if (isStructuralHeading(logical)) {
        inheritedContext = markdown?.kind === 'navigation'
          ? NAVIGATION_AGENT_HEADING_MARKER.test(logical)
          : directContext;
      }
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

const SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODE_SET = new Set<string>(
  SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODES
);
const SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODE_SET = new Set<string>(
  SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES
);

export function sourceProgramBlockingCandidates(
  model: Pick<SourceProgramModel, 'candidates'>
): readonly SourceProgramCandidate[] {
  return Object.freeze(model.candidates.filter(({ code }) =>
    SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODE_SET.has(code)));
}

export function sourceProgramBlockingTestFindings(
  findings: readonly SourceProgramTestFinding[]
): readonly SourceProgramTestFinding[] {
  return Object.freeze(findings.filter(({ code }) =>
    SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODE_SET.has(code)));
}

export function repositoryAuditSupersessionShouldBlock(
  receipt: Pick<SourceProgramSupersessionReceipt, 'status'>
): boolean {
  return receipt.status === 'owner-decision-required';
}

function appendSourceProgramBlockingFindings(
  findings: RepositoryAuditFinding[],
  model: Pick<SourceProgramModel, 'candidates'>
): void {
  for (const candidate of sourceProgramBlockingCandidates(model)) {
    pushFinding(findings, {
      code: `source-program-${candidate.code}`,
      message: `${candidate.subject}: ${candidate.reason}`,
      path: candidate.paths[0],
      severity: 'high'
    });
  }
}

export function projectRepositorySourceGovernance(
  repositoryPath: string,
  source: string
): RepositorySourceGovernanceProjection {
  const candidates = extractHeuristicBehaviorCandidates(repositoryPath, source);
  const blockingFindings: RepositoryAuditFinding[] = [];
  for (const candidate of candidates) {
    if (candidate.skills.length === 0) {
      pushFinding(blockingFindings, {
        code: 'possible-heuristic-outside-governance',
        line: candidate.line,
        message: `possible Agent behavior requires deterministic-vs-heuristic triage: ${candidate.text}`,
        path: candidate.path,
        severity: 'high'
      });
    }
  }
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    if (MALFORMED_REPOSITORY_REFERENCE.test(rawLine)) {
      pushFinding(blockingFindings, {
        code: 'malformed-repository-reference',
        line: index + 1,
        message: `malformed repository path reference: ${rawLine.trim()}`,
        path: repositoryPath,
        severity: 'high'
      });
    }
  }
  return Object.freeze({
    candidates: Object.freeze([...candidates]),
    blockingFindings: Object.freeze([...blockingFindings])
  });
}

interface DeletedBlobGitFact {
  oldBlob: string;
  bytes: number;
  lineCount: number;
}

function unknownCount(unknowns: readonly string[], markers: readonly string[]): number {
  return unknowns.filter((unknown) => markers.some((marker) => unknown.includes(marker))).length;
}

async function auditControlPlane(
  session: GitReadSession,
  tracked: readonly string[],
  head: string,
  defaultRef: string,
  bytesByPath: ReadonlyMap<string, Buffer>,
  textByPath: ReadonlyMap<string, string | null>,
  findings: RepositoryAuditFinding[],
  unknowns: string[]
): Promise<{ pointerManifestOnDefault: boolean }> {
  const pointerPath = 'docs/work/active-work-package.md';
  const rollingPath = 'docs/work/rolling-plan.md';
  if (!tracked.includes(pointerPath) || !tracked.includes(rollingPath)) {
    unknowns.push('docs/work control plane is incomplete');
    return { pointerManifestOnDefault: false };
  }

  const pointer = textByPath.get(pointerPath);
  const rollingPlan = textByPath.get(rollingPath);
  if (pointer === undefined || pointer === null
    || rollingPlan === undefined || rollingPlan === null) {
    unknowns.push('docs/work control plane is not readable as text at the audited revision');
    return { pointerManifestOnDefault: false };
  }
  let manifestPath: string;
  let expectedDigest: string;
  try {
    const parsedPointer = CodexDevelopmentParseActivePointer(pointer);
    manifestPath = parsedPointer.manifest;
    expectedDigest = parsedPointer.manifestDigest.slice('sha256:'.length);
  } catch (error) {
    pushFinding(findings, {
      code: 'control-plane-pointer-invalid',
      message: error instanceof Error ? error.message : String(error),
      path: pointerPath,
      severity: 'critical'
    });
    return { pointerManifestOnDefault: false };
  }
  let rollingPackage: string;
  try {
    rollingPackage = CodexDevelopmentParseRollingPlan(rollingPlan).activePackageId;
  } catch (error) {
    pushFinding(findings, {
      code: 'control-plane-rolling-invalid',
      message: error instanceof Error ? error.message : String(error),
      path: rollingPath,
      severity: 'critical'
    });
    return { pointerManifestOnDefault: false };
  }
  if (!tracked.includes(manifestPath)) {
    pushFinding(findings, {
      code: 'control-plane-manifest-missing',
      message: `active pointer references untracked manifest ${manifestPath}`,
      path: pointerPath,
      severity: 'critical'
    });
    return { pointerManifestOnDefault: false };
  }

  const manifestBytes = bytesByPath.get(manifestPath);
  if (manifestBytes === undefined) {
    pushFinding(findings, {
      code: 'control-plane-manifest-blob-unavailable',
      message: `active manifest has no readable raw Git blob at ${head}: ${manifestPath}`,
      path: pointerPath,
      severity: 'critical'
    });
    return { pointerManifestOnDefault: false };
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

  const defaultManifestBytes = await runGitBytes(
    session,
    ['show', `${defaultRef}:${manifestPath}`],
    { allowFailure: true }
  );
  // The active-phase manifest is frozen on the default branch by the activation
  // commit; docs/work/README.md keeps it `conditional` while the pointer selects
  // it. Being present on default is the designed state, not a violation.
  const pointerManifestOnDefault = defaultManifestBytes !== null
    && createHash('sha256').update(defaultManifestBytes).digest('hex') === expectedDigest;

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
  try {
    const entries = await Promise.all(liveManifests.map(async (packagePath) => {
      const candidateBytes = bytesByPath.get(packagePath);
      if (candidateBytes === undefined) {
        throw new Error(`candidate Git bytes are unavailable for ${packagePath}`);
      }
      return {
        path: packagePath,
        candidateBytes,
        defaultBytes: packagePath === manifestPath
          ? null
          : await runGitBytes(session, ['show', `${defaultRef}:${packagePath}`], { allowFailure: true })
      };
    }));
    const roadmapSource = textByPath.get('docs/roadmap.md');
    const census = CodexDevelopmentClassifyWorkPackageCensus({
      selectedManifestPath: manifestPath,
      entries,
      roadmapSource: liveManifests.length > 1 && roadmapSource !== null
        ? roadmapSource
        : undefined
    });
    if (census.ambiguousPredecessorPaths.length > 0) {
      pushFinding(findings, {
        code: 'control-plane-live-manifest-census',
        message: `multiple byte-exact published predecessors remain: ${census.ambiguousPredecessorPaths.join(', ')}`,
        path: 'docs/work-packages',
        severity: 'high'
      });
    }
    for (const stalePath of census.stalePackagePaths) {
      pushFinding(findings, {
        code: 'control-plane-live-manifest-census',
        message: `stale or unauthorized Work Package remains beside the selected manifest: ${stalePath}`,
        path: stalePath,
        severity: 'high'
      });
    }
  } catch (error) {
    pushFinding(findings, {
      code: 'control-plane-live-manifest-census',
      message: error instanceof Error ? error.message : String(error),
      path: 'docs/work-packages',
      severity: 'critical'
    });
  }
  return { pointerManifestOnDefault };
}

export async function auditRepository(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  options: { defaultRef?: string } = {}
): Promise<RepositoryAuditReport> {
  return withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: repositoryAuditGitBudget() },
    async (session) => auditRepositoryWithSession(session, repositoryRoot, options)
  );
}

async function auditRepositoryWithSession(
  session: GitReadSession,
  repositoryRoot: string,
  options: { defaultRef?: string }
): Promise<RepositoryAuditReport> {
  const defaultRefInput = options.defaultRef ?? process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF ?? 'refs/remotes/origin/main';
  const isExactSha = /^[0-9a-f]{40}$/u.test(defaultRefInput);
  // For exact SHA input, validate it resolves to a commit object. For ref input,
  // use rev-parse --verify <ref> (resolves through symbolic refs).
  const defaultRef = isExactSha ? `${defaultRefInput}^{commit}` : defaultRefInput;
  const findings: RepositoryAuditFinding[] = [];
  const unknowns: string[] = [];
  const head = await runGitText(session, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const tree = await runGitText(session, ['rev-parse', '--verify', 'HEAD^{tree}']);
  if (head === null || tree === null) {
    throw new Error('Repository audit requires a resolvable HEAD commit and tree');
  }
  const initialWorktree = await repositoryWorktreeState(session);
  if (initialWorktree !== 'clean') {
    unknowns.push(`exact HEAD evidence requires a clean index/worktree; state=${initialWorktree}`);
  }
  const entries = await revisionTreeEntries(session, head);
  const tracked = entries.map(({ path: repositoryPath }) => repositoryPath);
  const {
    bytesByPath,
    contentCoverage,
    textByPath
  } = await revisionTextCandidates(session, entries);
  const descriptorSources = tracked
    .filter((repositoryPath) => path.posix.basename(repositoryPath) === 'sec.module.json')
    .map((descriptorPath) => {
      const source = textByPath.get(descriptorPath);
      if (source === null || source === undefined) {
        throw new Error(`Repository module descriptor is unreadable at ${head}: ${descriptorPath}`);
      }
      return { descriptorPath, source };
    });
  const moduleMembership = descriptorSources.length === 0
    ? Object.freeze({
        descriptors: Object.freeze([]),
        graphRoots: Object.freeze([]),
        moduleRoots: Object.freeze([]),
        moduleForPath: () => null
      })
    : compileSecRepositoryModuleMembershipSnapshot({
        repositoryFiles: tracked,
        descriptorSources
      });
  if (descriptorSources.length === 0) {
    unknowns.push('source program module ownership is unavailable: exact snapshot has no sec.module.json descriptors');
  }
  const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot,
    commitSha: head
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath
  );
  const sourceProgramCompilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot,
    projectInput,
    repositoryRoot
  });
  const moduleGraph = sourceProgramCompilation.workspaceSnapshot.moduleGraph;
  const sourceProgram = sourceProgramCompilation.model;
  const declarationTopology = compileSourceProgramDeclarationTopology(sourceProgramCompilation);
  const architecture = compileSecRepositoryModuleArchitectureProjection(
    moduleGraph,
    workspaceSnapshot.moduleMembership,
    sourceProgram
  );
  try {
    assertSecRepositoryModuleArchitectureBoundaries(
      moduleGraph,
      workspaceSnapshot.moduleMembership,
      sourceProgram
    );
  } catch (error) {
    pushFinding(findings, {
      code: 'repository-module-architecture-boundary-invalid',
      message: error instanceof Error ? error.message : String(error),
      path: 'src',
      severity: 'high'
    });
  }
  appendSourceProgramBlockingFindings(findings, sourceProgram);
  for (const coverage of contentCoverage) {
    if (coverage.status === 'unknown') {
      unknowns.push(`content coverage unknown: ${coverage.path} [${coverage.reason}]`);
    }
  }
  const defaultHead = await runGitText(
    session,
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
  const sourceProgramSurfaceByPath = new Map(sourceProgram.files.map((file) => (
    [file.path, file.surface] as const
  )));

  for (const repositoryPath of tracked) {
    const compiledSurface = sourceProgramSurfaceByPath.get(repositoryPath);
    const surface = compiledSurface === 'test'
      ? { kind: 'verification-test' as const, skills: [] }
      : compiledSurface === 'production'
        ? { kind: 'product-implementation' as const, skills: [] }
        : classifySecRepositorySurface(repositoryPath);
    surfaceCounts[surface.kind] += 1;
    if (repositoryPath.endsWith('.md')) markdown += 1;

    const source = textByPath.get(repositoryPath) ?? null;
    if (source === null) continue;

    const markdownCoverage = resolveSecMarkdownSkillCoverage(repositoryPath);
    if (markdownCoverage?.kind === 'active-authority'
      || markdownCoverage?.kind === 'agent-projection') {
      activeMarkdown += 1;
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

    const sourceGovernance = projectRepositorySourceGovernance(repositoryPath, source);
    candidates.push(...sourceGovernance.candidates);
    findings.push(...sourceGovernance.blockingFindings);

    for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
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
    const routed = SEC_REPOSITORY_HEURISTIC_BEHAVIOR_IDS.filter(
      (behavior) => SEC_REPOSITORY_HEURISTIC_ROUTES[behavior].owner === skillId
    );
    if (routed.length === 0) {
      pushFinding(findings, {
        code: 'skill-without-heuristic-route',
        message: `${skillId} does not own any registered heuristic behavior route`,
        path: `.agents/skills/${skillId}/SKILL.md`,
        severity: 'high',
        skills: [skillId]
      });
    }
  }

  await auditControlPlane(
    session,
    tracked,
    head,
    defaultRefInput,
    bytesByPath,
    textByPath,
    findings,
    unknowns
  );
  const finalHead = await runGitText(session, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const finalTree = await runGitText(session, ['rev-parse', '--verify', 'HEAD^{tree}']);
  const finalWorktree = await repositoryWorktreeState(session);
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
    architecture,
    declarationTopology,
    behaviorCandidates: Object.freeze([...candidates]),
    heuristicRoutes: SEC_REPOSITORY_HEURISTIC_ROUTES,
    contentCoverage,
    findings: Object.freeze(findings),
    optimizations: Object.freeze([
      '把未覆盖的 Agent 行为交给 sec-heuristic-governance，不在原文件追加孤立指令。',
      '把跨 owner 的架构 finding 交给 sec-architecture-evolution，冻结 authority/contract 后再实现。',
      '把产品 finding 拆为依赖明确的最小 Work Package；审计报告只作 exact-revision Evidence。',
      '删除无消费者配置、已退役路径 owner 和重复权威；保留机器可验证 registry，而不是新增叙述文档。'
    ]),
    sourceProgram,
    sourceProgramCompilation: Object.freeze({
      subjectDigest: sourceProgramCompilation.subjectDigest,
      snapshotDigest: sourceProgramCompilation.snapshotDigest,
      moduleGraphDigest: sourceProgramCompilation.moduleGraphDigest,
      receiptDigest: sourceProgramCompilation.receiptDigest
    }),
    revision: Object.freeze({
      defaultHead,
      defaultRef: defaultRefInput,
      defaultRefInput,
      defaultRefMode: isExactSha ? 'exact-sha' : 'ref',
      head,
      tree,
      worktree
    }),
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
      sourceProgram: Object.freeze({
        capabilities: sourceProgram.capabilities.length,
        candidates: sourceProgram.candidates.length,
        declarations: sourceProgram.declarations.length,
        dependencies: sourceProgram.dependencies.length,
        entrypoints: sourceProgram.entrypoints.length,
        entrypointClosures: sourceProgram.entrypointClosures.length,
        files: sourceProgram.files.length,
        literals: sourceProgram.literals.length,
        packages: sourceProgram.packages.length,
        references: sourceProgram.references.length,
        unknowns: sourceProgram.unknowns.length
      }),
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

export async function runRepositoryAuditCli(
  args: readonly string[] = process.argv.slice(2),
  execution: Readonly<{ deadlineAtUnixMs?: number }> = {}
): Promise<void> {
  const diagnostic = args.includes('--diagnostic');
  const full = args.includes('--full');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  const failIndex = args.indexOf('--fail-on');
  const queryIndex = args.indexOf('--query');
  const query = queryIndex >= 0 ? args[queryIndex + 1] : undefined;
  if (queryIndex >= 0 && (!query || query.startsWith('--'))) {
    throw new Error('--query requires one symbol, literal, module, or path fragment');
  }
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

  if (args.includes('--worktree-module-topology')) {
    const result = await compileWorkingTreeModuleTopology(DEFAULT_REPOSITORY_ROOT);
    const projection = Object.freeze({
      sourceRevision: result.sourceRevision,
      workspaceSourceSnapshot: Object.freeze({
        snapshotDigest: result.snapshotDigest,
        moduleGraphDigest: result.moduleGraphDigest,
        identityDigest: result.workspaceSnapshotIdentityDigest
      }),
      files: result.files,
      references: result.references,
      unresolvedFiles: full
        ? result.unresolvedFiles
        : compactRecordSet(result.unresolvedFiles),
      topology: full
        ? Object.freeze({
            ownerEdges: result.topology.ownerEdges,
            strongComponents: result.topology.strongComponents,
            reciprocalPairs: result.topology.reciprocalPairs,
            feedbackProjections: result.topology.feedbackCuts,
            violations: result.topology.violations
          })
        : Object.freeze({
            evidenceDigest: sha256(result.topology),
            ownerEdges: result.topology.ownerEdges.length,
            strongComponents: result.topology.strongComponents.length,
            reciprocalPairs: result.topology.reciprocalPairs.length,
            feedbackProjections: result.topology.feedbackCuts.length,
            violations: result.topology.violations.length
          })
    });
    const encoded = `${JSON.stringify(projection, null, 2)}\n`;
    if (outputPath !== undefined) {
      const absoluteOutput = path.resolve(outputPath);
      await mkdir(path.dirname(absoluteOutput), { recursive: true });
      await writeFile(absoluteOutput, encoded, 'utf8');
    }
    process.stdout.write(encoded);
    if (args.includes('--enforce') && result.topology.violations.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes('--worktree-source-program')) {
    if (!Number.isSafeInteger(execution.deadlineAtUnixMs)
        || (execution.deadlineAtUnixMs as number) <= Date.now()) {
      throw new Error('Working-tree Source Program audit requires one inherited absolute deadline.');
    }
    const deadlineAtUnixMs = execution.deadlineAtUnixMs as number;
    const supersessionBaselineIndex = args.indexOf('--supersession-baseline');
    const supersessionBaseline = supersessionBaselineIndex >= 0
      ? args[supersessionBaselineIndex + 1]
      : 'HEAD';
    if (!supersessionBaseline || supersessionBaseline.startsWith('--')) {
      throw new Error('--supersession-baseline requires one Git revision');
    }
    const worktreeAudit = await (async () => {
      try {
        return await compileWorkingTreeSourceProgram(
          DEFAULT_REPOSITORY_ROOT,
          supersessionBaseline,
          deadlineAtUnixMs
        );
      } finally {
        // Every downstream audit consumes sealed fact shards, never the live
        // Language Service. Release the compiler graph at this lifecycle seam
        // even when projection compilation fails.
        releaseTypeScriptSourceProgramWorkspace();
      }
    })();
    const { model } = worktreeAudit;
    const implementationDominance = compileSourceProgramImplementationDominance({
      model,
      ownerIntents: worktreeAudit.currentIntentEvidence
    });
    const reconciliationProjection = compileSourceProgramReconciliationProjection({
      before: worktreeAudit.baselineSourceProgramCompilation,
      after: worktreeAudit.currentSourceProgramCompilation,
      beforeMembership: worktreeAudit.baselineModuleMembership,
      afterMembership: worktreeAudit.moduleMembership
    });
    const blockingCandidates = sourceProgramBlockingCandidates(model);
    const observedTestValue = compileSourceProgramTestValue({
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
      files: worktreeAudit.sourceFiles,
      model,
      baselineTestPaths: worktreeAudit.baselineTestPaths,
      baselineEvidence: worktreeAudit.baselineTestEvidence
    });
    const currentSupersessionEvidence = compileSourceProgramSupersessionEvidence({
      model,
      tests: observedTestValue,
      intentEvidence: worktreeAudit.currentIntentEvidence,
      identity: worktreeAudit.currentSupersessionIdentity
    });
    await writeSupersessionEvidenceCache(DEFAULT_REPOSITORY_ROOT, currentSupersessionEvidence)
      .catch(() => undefined);
    const supersession = compileSourceProgramSupersessionReceipt({
      baseline: worktreeAudit.baselineSupersessionEvidence,
      current: currentSupersessionEvidence
    });
    const supersessionTestDisposition = reconcileSourceProgramTestValueWithSupersession(
      observedTestValue,
      supersession
    );
    const testRetirement = compileSourceProgramTestRetirementReceipt({
      baseline: worktreeAudit.baselineSupersessionEvidence,
      current: currentSupersessionEvidence,
      supersession,
      currentModel: model,
      currentTestCompilation: observedTestValue,
      baselineFiles: worktreeAudit.baselineSourceFiles,
      currentFiles: worktreeAudit.sourceFiles
    });
    const testDisposition = projectSourceProgramTestRetirementDispositions(
      supersessionTestDisposition,
      testRetirement
    );
    const blockingTestFindings = sourceProgramBlockingTestFindings(testDisposition.findings);
    const unknownDispositionClusters = summarizeSourceProgramTestUnknownDispositionClusters(
      testDisposition.dispositions,
      testDisposition.findings
    );
    const compactBlockingTestFindings = blockingTestFindings.filter(({ disposition }) =>
      disposition?.disposition !== 'unknown');
    const compactDispositions = testDisposition.dispositions.filter(({ disposition }) =>
      disposition !== 'unknown');
    const compactFindings = testDisposition.findings.filter(({ disposition }) =>
      disposition?.disposition !== 'unknown');
    const reductionModeCount = [
      '--version-reductions',
      '--graph-cuts',
      '--aggregate-import-reductions'
    ].filter((mode) => args.includes(mode)).length;
    if (reductionModeCount > 1) {
      throw new Error('Choose exactly one reduction mode per exact source snapshot');
    }
    const aggregateImportPlan = args.includes('--aggregate-import-reductions')
      ? compileSourceProgramAggregateImportReductionPlan(
          model,
          worktreeAudit.sourceFiles,
          Object.freeze({
            sourceRevision: model.sourceRevision,
            architecture: worktreeAudit.moduleArchitecture
          })
        )
      : null;
    const aggregateImportPatch = aggregateImportPlan === null
      || aggregateImportPlan.reductions.every(({ status }) => status === 'blocked')
      ? null
      : buildSourceProgramAggregateImportReductionPatch(
          aggregateImportPlan,
          worktreeAudit.sourceFiles
        );
    const versionReductionPlan = args.includes('--version-reductions')
      ? compileSourceProgramVersionSuffixReductionPlan(model, worktreeAudit.sourceFiles)
      : null;
    const versionReductionPatch = versionReductionPlan === null
      || versionReductionPlan.reductions.every(({ status }) => status === 'blocked')
      ? null
      : renderSourceProgramVersionSuffixReductionPatch(
          versionReductionPlan,
          worktreeAudit.sourceFiles
        );
    const graphCutPlan = args.includes('--graph-cuts')
      ? compileSourceProgramGraphCutReductionPlan(
          model,
          worktreeAudit.sourceFiles,
          await compileKnipUnusedSymbolEvidence(DEFAULT_REPOSITORY_ROOT),
          Object.freeze({
            moduleMembership: worktreeAudit.moduleMembership,
            reviewedProcessDispatchers: worktreeAudit.reviewedProcessDispatchers
          })
        )
      : null;
    const graphCutPatch = graphCutPlan === null
      || graphCutPlan.reductions.every(({ status }) => status === 'blocked')
      ? null
      : renderSourceProgramGraphCutReductionPatch(graphCutPlan, worktreeAudit.sourceFiles);
    if (outputPath !== undefined) {
      const reductionPatch = versionReductionPatch ?? graphCutPatch ?? aggregateImportPatch;
      if (reductionPatch === null) {
        throw new Error('--output requires one reduction mode with at least one ready reduction');
      }
      const absoluteOutput = path.resolve(outputPath);
      await mkdir(path.dirname(absoluteOutput), { recursive: true });
      await writeFile(absoluteOutput, reductionPatch.patch, 'utf8');
    }
    process.stdout.write(`${JSON.stringify({
      architecture: full
        ? projectRepositoryModuleArchitectureAudit(worktreeAudit.moduleArchitecture)
        : projectRepositoryModuleArchitectureCli(worktreeAudit.moduleArchitecture),
      modelDigest: model.modelDigest,
      sourceRevision: model.sourceRevision,
      sourceProgramCompilation: worktreeAudit.sourceProgramCompilation,
      declarationTopology: full ? worktreeAudit.declarationTopology : {
        compilationReceiptDigest: worktreeAudit.declarationTopology.compilationReceiptDigest,
        topologyDigest: worktreeAudit.declarationTopology.topologyDigest,
        declarations: worktreeAudit.declarationTopology.declarations.length,
        edges: worktreeAudit.declarationTopology.edges.length,
        strongComponents: worktreeAudit.declarationTopology.strongComponents.length,
        cyclicComponents: worktreeAudit.declarationTopology.strongComponents.filter(
          ({ declarationObservationIds }) => declarationObservationIds.length > 1
        ).length,
        unknowns: worktreeAudit.declarationTopology.unknowns.length
      },
      cache: worktreeAudit.cache,
      invalidatedTypeScriptPaths: full
        ? worktreeAudit.invalidatedTypeScriptPaths
        : compactRecordSet(worktreeAudit.invalidatedTypeScriptPaths),
      implementationDominance: full ? implementationDominance : {
        compilationDigest: implementationDominance.compilationDigest,
        units: compactRecordSet(implementationDominance.units),
        findings: compactRecordSet(implementationDominance.findings),
        dispositions: Object.fromEntries(
          [...new Set(implementationDominance.findings.map(({ disposition }) => disposition))]
            .sort(compareCodeUnits)
            .map((disposition) => [
              disposition,
              implementationDominance.findings.filter((finding) => (
                finding.disposition === disposition
              )).length
            ])
          )
      },
      reconciliation: full ? reconciliationProjection : {
        status: reconciliationProjection.status,
        projectionDigest: reconciliationProjection.projectionDigest,
        before: reconciliationProjection.before,
        after: reconciliationProjection.after,
        changes: reconciliationProjection.changes.length,
        frontiers: reconciliationProjection.frontiers.length,
        providerEvidence: reconciliationProjection.providerEvidence,
        unresolvedReasons: compactRecordSet(reconciliationProjection.unresolvedReasons)
      },
      blockingCandidates: full ? blockingCandidates : compactRecordSet(blockingCandidates),
      blockingTestFindings: full
        ? blockingTestFindings
        : compactRecordSet(compactBlockingTestFindings),
      unknownDispositionClusters: full
        ? unknownDispositionClusters
        : compactRecordSet(unknownDispositionClusters),
      supersession: full ? supersession : {
        status: supersession.status,
        receiptDigest: supersession.receiptDigest,
        baseline: supersession.baseline,
        current: supersession.current,
        lifecycleCost: supersession.lifecycleCost,
        replacements: {
          entrypoint: supersession.replacements.filter(({ kind }) => kind === 'entrypoint').length,
          production: supersession.replacements.filter(({ kind }) => kind === 'production').length,
          resource: supersession.replacements.filter(({ kind }) => kind === 'resource').length,
          test: supersession.replacements.filter(({ kind }) => kind === 'test').length
        },
        findings: compactRecordSet(supersession.findings)
      },
      testRetirement: full ? testRetirement : {
        receiptDigest: testRetirement.receiptDigest,
        retired: testRetirement.proofs.filter(({ status }) => status === 'retired').length,
        blocked: testRetirement.proofs.filter(({ status }) => status === 'blocked').length,
        proofsDigest: sha256(testRetirement.proofs)
      },
      summary: {
        blockingCandidates: blockingCandidates.length,
        implementationDominanceFindings: implementationDominance.findings.length,
        implementationDominanceUnits: implementationDominance.units.length,
        reconciliationStatus: reconciliationProjection.status,
        reconciliationChanges: reconciliationProjection.changes.length,
        reconciliationFrontiers: reconciliationProjection.frontiers.length,
        reconciliationUnresolvedReasons: reconciliationProjection.unresolvedReasons.length,
        blockingTestFindings: blockingTestFindings.length,
        reportedBlockingTestFindings: (full ? blockingTestFindings : compactBlockingTestFindings).length,
        unknownDispositionClusters: unknownDispositionClusters.length,
        unknownDispositions: testDisposition.dispositions.filter(({ disposition }) =>
          disposition === 'unknown').length,
        architectureFeedbackProjections: worktreeAudit.moduleArchitecture.feedbackCuts.length,
        architectureReciprocalPairs: worktreeAudit.moduleArchitecture.reciprocalPairs.length,
        architectureStrongComponents: worktreeAudit.moduleArchitecture.strongComponents.length,
        architectureViolations: worktreeAudit.moduleArchitecture.violations.length,
        moduleBoundaryFailures: worktreeAudit.moduleBoundaryFailures.length,
        capabilities: model.capabilities.length,
        candidates: model.candidates.length,
        declarations: model.declarations.length,
        dependencies: model.dependencies.length,
        entrypoints: model.entrypoints.length,
        entrypointClosures: model.entrypointClosures.length,
        files: model.files.length,
        literals: model.literals.length,
        packages: model.packages.length,
        references: model.references.length,
        supersessionFindings: supersession.findings.length,
        supersessionStatus: supersession.status,
        baselineTestModules: observedTestValue.baselineTestPaths.length,
        testDispositionRecords: testDisposition.dispositions.length,
        testRegistrations: observedTestValue.records.length,
        unknowns: model.unknowns.length
      },
      topology: summarizeSourceProgramTopology(model),
      testValue: {
        baselineDigest: observedTestValue.baselineDigest,
        baselineEvidenceDigest: observedTestValue.baselineEvidenceDigest,
        baselineTestPaths: full
          ? observedTestValue.baselineTestPaths
          : compactRecordSet(observedTestValue.baselineTestPaths),
        compilationDigest: observedTestValue.compilationDigest,
        dispositionProjectionDigest: testDisposition.projectionDigest,
        supersessionReceiptDigest: testDisposition.supersessionReceiptDigest,
        dispositions: full
          ? testDisposition.dispositions
          : compactRecordSet(compactDispositions),
        findings: full ? testDisposition.findings : compactRecordSet(compactFindings),
        candidateRegistrationCensus: {
          count: observedTestValue.records.length,
          digest: sha256(observedTestValue.records.map(({ testId, path: repositoryPath, span }) => ({
            testId,
            path: repositoryPath,
            span
          }))),
          ...(full ? {
            paths: [...new Set(observedTestValue.records.map(({ path: repositoryPath }) => repositoryPath))]
              .sort(compareCodeUnits)
          } : {})
        },
        recordsWithUnknownSemantics: observedTestValue.records
          .filter(({ unknowns }) => unknowns.length > 0).length,
        semanticClasses: Object.fromEntries(
          [...new Set(observedTestValue.records.flatMap(({ semanticClasses }) => semanticClasses))]
            .sort(compareCodeUnits)
            .map((semanticClass) => [
              semanticClass,
              observedTestValue.records
                .filter(({ semanticClasses }) => semanticClasses.includes(semanticClass)).length
            ])
        )
      },
      ...(versionReductionPlan === null ? {} : {
        versionReductionPlan: {
          planDigest: versionReductionPlan.planDigest,
          sourceRevision: versionReductionPlan.sourceRevision,
          ready: versionReductionPlan.reductions.filter(({ status }) => status === 'ready').length,
          blocked: versionReductionPlan.reductions.filter(({ status }) => status === 'blocked').length,
          locations: versionReductionPlan.reductions.reduce(
            (total, reduction) => total + reduction.locations.length,
            0
          ),
          patchDigest: versionReductionPatch?.patchDigest ?? null,
          changedFiles: versionReductionPatch?.files.length ?? 0,
          outputPath: outputPath === undefined ? null : path.resolve(outputPath),
          blockedReductions: versionReductionPlan.reductions
            .filter(({ status }) => status === 'blocked')
            .map(({ currentName, declarationPaths, reason }) => ({
              currentName,
              declarationPaths,
              reason
            }))
        }
      }),
      ...(aggregateImportPlan === null ? {} : {
        aggregateImportPlan: {
          planDigest: aggregateImportPlan.planDigest,
          sourceRevision: aggregateImportPlan.sourceRevision,
          architectureDigest: aggregateImportPlan.architectureDigest,
          snapshotStatus: aggregateImportPlan.snapshotStatus,
          snapshotReason: aggregateImportPlan.snapshotReason,
          ready: aggregateImportPlan.reductions.filter(({ status }) => status === 'ready').length,
          blocked: aggregateImportPlan.reductions.filter(({ status }) => status === 'blocked').length,
          patchDigest: aggregateImportPatch?.patchDigest ?? null,
          changedFiles: aggregateImportPatch?.files.length ?? 0,
          outputPath: outputPath === undefined ? null : path.resolve(outputPath),
          blockedReductions: aggregateImportPlan.reductions
            .filter(({ status }) => status === 'blocked')
            .map(({ moduleSpecifier, path: sourcePath, reason }) => ({
              moduleSpecifier,
              path: sourcePath,
              reason
            }))
        }
      }),
      ...(graphCutPlan === null ? {} : {
        graphCutPlan: {
          planDigest: graphCutPlan.planDigest,
          evidenceDigest: graphCutPlan.evidenceDigest,
          verificationDigest: graphCutPlan.verificationDigest,
          sourceRevision: graphCutPlan.sourceRevision,
          ready: graphCutPlan.reductions.filter(({ status }) => status === 'ready').length,
          blocked: graphCutPlan.reductions.filter(({ status }) => status === 'blocked').length,
          patchDigest: graphCutPatch?.patchDigest ?? null,
          changedFiles: graphCutPatch?.files.length ?? 0,
          outputPath: outputPath === undefined ? null : path.resolve(outputPath),
          blockedReductions: graphCutPlan.reductions
            .filter(({ status }) => status === 'blocked')
            .map(({ name, path: declarationPath, reason }) => ({
              name,
              path: declarationPath,
              reason
            }))
        }
      }),
      ...(worktreeAudit.moduleBoundaryFailures.length > 0
        ? {
            moduleBoundaryFailures: full
              ? worktreeAudit.moduleBoundaryFailures
              : compactRecordSet(worktreeAudit.moduleBoundaryFailures)
          }
        : {}),
      ...(query ? { result: querySourceProgramModel(model, query) } : {}),
      ...(args.includes('--candidates') ? { candidates: model.candidates } : {})
    }, null, 2)}\n`);
    if (args.includes('--enforce')
      && (blockingCandidates.length > 0
        || implementationDominance.findings.length > 0
        || reconciliationProjection.status === 'unresolved'
        || blockingTestFindings.length > 0
        || repositoryAuditSupersessionShouldBlock(supersession)
        || repositoryModuleArchitectureShouldBlock(worktreeAudit.moduleArchitecture)
        || worktreeAudit.moduleBoundaryFailures.length > 0)) {
      process.exitCode = 1;
    }
    return;
  }

  const report = await auditRepository(undefined, { defaultRef });
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const absoluteOutput = path.resolve(outputPath);
    await mkdir(path.dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, encoded, 'utf8');
  }
  process.stdout.write(query
    ? `${JSON.stringify({
        modelDigest: report.sourceProgram.modelDigest,
        sourceRevision: report.sourceProgram.sourceRevision,
        result: querySourceProgramModel(report.sourceProgram, query)
      }, null, 2)}\n`
    : full
      ? encoded
      : `${JSON.stringify(projectRepositoryAuditCli(report), null, 2)}\n`);

  if (repositoryAuditShouldFail(report, {
    diagnostic,
    failOn: failOn ?? 'high'
  })) {
    process.exitCode = 1;
  }
}

export type RepositoryAuditWorkerDiagnosticReason =
  | 'cancelled'
  | 'deadline-exhausted'
  | 'output-budget-exhausted'
  | 'physical-boundary-unavailable'
  | 'physical-boundary-unsettled'
  | 'process-settlement-unproven';

export type RepositoryAuditWorkerDiagnostic = Readonly<{
  kind: 'repository-audit-worker-diagnostic';
  authority: 'none-diagnostic-only';
  status: 'denied';
  reason: RepositoryAuditWorkerDiagnosticReason;
  detailDigest: `sha256:${string}`;
  process: Readonly<{
    status: string;
    started: boolean;
    exitCode: number | null;
    stdoutBytes: number;
    stdoutDigest: `sha256:${string}`;
    stderrBytes: number;
    stderrDigest: `sha256:${string}`;
    childCloseObserved: boolean;
    streamsDrained: boolean;
    treeClosed: boolean;
  }> | null;
  resources: ProcessResourceSessionReceipt | null;
}>;

export type RepositoryAuditWorkerExecution =
  | Readonly<{
      status: 'completed';
      code: number;
      stdout: Uint8Array;
      stderr: string;
      resources: ProcessResourceSessionReceipt;
    }>
  | Readonly<{
      status: 'denied';
      diagnostic: RepositoryAuditWorkerDiagnostic;
    }>;

function sourceProgramAuditWorkerEnvironment(deadlineAtUnixMs: number): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    [SOURCE_PROGRAM_AUDIT_DEADLINE_ENV]: String(deadlineAtUnixMs)
  };
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path');
  if (pathKey !== undefined && process.env[pathKey] !== undefined) {
    environment[pathKey] = process.env[pathKey];
  }
  for (const key of ['SYSTEMROOT', 'WINDIR'] as const) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(secRuntimeStateEnvironment())) {
    if (value !== undefined) environment[key] = value;
  }
  const defaultRef = process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
  if (defaultRef !== undefined) environment.SEC_REPOSITORY_AUDIT_DEFAULT_REF = defaultRef;
  return Object.freeze(environment);
}

function compileSourceProgramAuditWorkerOperation(input: Readonly<{
  args: readonly string[];
  bunDigest: `sha256:${string}`;
  workerDigest: `sha256:${string}`;
  repositoryPhysical: PhysicalDirectoryIdentity;
  environment: NodeJS.ProcessEnv;
  deadlineAtUnixMs: number;
}>): SecBoundSemanticOperation {
  const durationMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(durationMs) || durationMs < 1
      || durationMs > SOURCE_PROGRAM_AUDIT_DEADLINE_MS) {
    throw new Error('Repository audit worker deadline is outside its canonical bound.');
  }
  const contractDigest = sha256({
    operation: SOURCE_PROGRAM_AUDIT_OPERATION,
    process: 'one-retained-bun-worker',
    cwd: 'one-retained-repository-root',
    childGit: 'canonical-git-read-session-only',
    output: 'bounded-diagnostic-or-domain-report'
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: SOURCE_PROGRAM_AUDIT_OPERATION,
    intentDigest: sha256({
      args: input.args,
      bunDigest: input.bunDigest,
      workerDigest: input.workerDigest,
      repositoryPhysical: input.repositoryPhysical,
      environment: input.environment
    }) as SecOperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES },
      { resource: 'output-bytes', maximum: SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: SOURCE_PROGRAM_AUDIT_REQUIREMENT,
      contractDigest,
      effectKinds: ['process'],
      failureKinds: [
        'process.cancelled',
        'process.deadline-exhausted',
        'process.identity-drift',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: SOURCE_PROGRAM_AUDIT_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: sha256({
      provider: 'runtime-state.physical.process-resource-session',
      bunDigest: input.bunDigest,
      workerDigest: input.workerDigest,
      repositoryPhysical: input.repositoryPhysical
    }) as SecOperationDigest
  })]);
}

export function compileRepositoryAuditWorkerDiagnostic(
  error: unknown,
  resources: ProcessResourceSessionReceipt | null
): RepositoryAuditWorkerDiagnostic {
  const transport = error instanceof RetainedCommandTransportError ? error.outcome : null;
  const settlementProven = transport === null || !transport.started || (
    transport.termination.childCloseObserved
    && transport.termination.streamsDrained
    && transport.termination.treeClosed
  );
  const reason: RepositoryAuditWorkerDiagnosticReason = !settlementProven
    ? 'process-settlement-unproven'
    : transport?.status === 'timed-out'
      ? 'deadline-exhausted'
      : transport?.status === 'aborted'
        ? 'cancelled'
        : transport?.status === 'observer-failed'
          ? 'output-budget-exhausted'
          : error instanceof PhysicalResourceCompositeSettlementError
            || resources !== null && resources.processCount > 0
            ? 'physical-boundary-unsettled'
            : 'physical-boundary-unavailable';
  const detail = error instanceof PhysicalResourceCompositeSettlementError
    ? error.failures.map(({ label, error: failure }) => Object.freeze({
        label,
        detail: failure instanceof Error ? failure.message : String(failure)
      }))
    : error instanceof Error ? error.message : String(error);
  return Object.freeze({
    kind: 'repository-audit-worker-diagnostic',
    authority: 'none-diagnostic-only',
    status: 'denied',
    reason,
    detailDigest: sha256({ detail }) as `sha256:${string}`,
    process: transport === null ? null : Object.freeze({
      status: transport.status,
      started: transport.started,
      exitCode: transport.exitCode,
      stdoutBytes: transport.stdout.bytes,
      stdoutDigest: transport.stdout.digest,
      stderrBytes: transport.stderr.bytes,
      stderrDigest: transport.stderr.digest,
      childCloseObserved: transport.termination.childCloseObserved,
      streamsDrained: transport.termination.streamsDrained,
      treeClosed: transport.termination.treeClosed
    }),
    resources
  });
}

export async function executeSupervisedWorkingTreeSourceProgramAudit(
  args: readonly string[],
  maximumDurationMs = SOURCE_PROGRAM_AUDIT_DEADLINE_MS
): Promise<RepositoryAuditWorkerExecution> {
  if (!Number.isSafeInteger(maximumDurationMs)
      || maximumDurationMs < 1
      || maximumDurationMs > SOURCE_PROGRAM_AUDIT_DEADLINE_MS) {
    throw new Error('Repository audit worker duration is outside its canonical bound.');
  }
  const deadlineAtUnixMs = Date.now() + maximumDurationMs;
  const executablePath = path.resolve(process.execPath);
  const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));
  let executable: RetainedNoFollowOrdinaryFile | null = null;
  let workingDirectory: RetainedNoFollowChildProcessDirectory | null = null;
  let worker: RetainedNoFollowOrdinaryFile | null = null;
  let session: ProcessResourceSession | null = null;
  let resources: ProcessResourceSessionReceipt | null = null;
  let run: ProcessResourceRunResult | null = null;
  let primaryError: unknown;
  try {
    const repositoryChain = inspectNoFollowDirectoryChain(
      DEFAULT_REPOSITORY_ROOT,
      'Source Program repository audit root'
    );
    executable = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(executablePath), 'Source Program Bun parent'),
      path.basename(executablePath),
      undefined,
      'Source Program Bun executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      repositoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Source Program repository audit cwd'
    );
    [worker] = retainCommandAuxiliaryOrdinaryFiles([{
      expectedParent: inspectNoFollowDirectoryChain(
        path.dirname(workerPath),
        'Source Program audit worker parent'
      ),
      name: path.basename(workerPath),
      label: 'Source Program audit worker'
    }]);
    const environment = sourceProgramAuditWorkerEnvironment(deadlineAtUnixMs);
    const operation = compileSourceProgramAuditWorkerOperation({
      args,
      bunDigest: executable.digest().byteDigest,
      workerDigest: worker.digest().byteDigest,
      repositoryPhysical: repositoryChain.target,
      environment,
      deadlineAtUnixMs
    });
    const durationCeiling = operation.plan.execution.aggregateBudgets.find(
      ({ resource }) => resource === 'duration-ms'
    );
    if (durationCeiling === undefined) {
      throw new Error('Repository audit worker operation has no duration resource ceiling.');
    }
    session = openProcessResourceSession({
      operation,
      requirementBindingContext: issueSecOperationRequirementBindingContext({
        operation,
        requirementId: SOURCE_PROGRAM_AUDIT_REQUIREMENT,
        resourceCeilings: [
          {
            resource: 'duration-ms',
            maximum: durationCeiling.maximum
          },
          { resource: 'input-bytes', maximum: SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES },
          { resource: 'output-bytes', maximum: SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES },
          { resource: 'processes', maximum: 1 }
        ]
      })
    });
    run = await session.run(issueRetainedCommandBoundary({
      executable,
      workingDirectory,
      auxiliaryInputs: [{ capability: worker, kind: 'ordinary-file' }]
    }), ['--no-env-file', worker.childPath, ...args], {
      env: environment,
      envMode: 'replace',
      maxStderrBytes: SOURCE_PROGRAM_AUDIT_STDERR_BUDGET_BYTES,
      maxStdoutBytes: SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES
        - SOURCE_PROGRAM_AUDIT_STDERR_BUDGET_BYTES
    });
  } catch (error) {
    primaryError ??= error;
  } finally {
    const cleanup: Array<Readonly<{ label: string; settle(): void }>> = [];
    if (session !== null) {
      const retainedSession = session;
      cleanup.push(Object.freeze({
        label: 'repository audit process resource session',
        settle: () => { resources = retainedSession.close(); }
      }));
    }
    if (worker !== null) {
      const retainedWorker = worker;
      cleanup.push(Object.freeze({
        label: 'repository audit retained worker',
        settle: () => retainedWorker.dispose()
      }));
    }
    if (workingDirectory !== null) {
      const retainedWorkingDirectory = workingDirectory;
      cleanup.push(Object.freeze({
        label: 'repository audit retained cwd',
        settle: () => retainedWorkingDirectory.dispose()
      }));
    }
    if (executable !== null) {
      const retainedExecutable = executable;
      cleanup.push(Object.freeze({
        label: 'repository audit retained Bun executable',
        settle: () => retainedExecutable.dispose()
      }));
    }
    try {
      settlePhysicalResources({
        ...(primaryError === undefined ? {} : {
          primary: Object.freeze({
            label: 'repository audit worker execution',
            error: primaryError
          })
        }),
        cleanup
      });
      primaryError = undefined;
    } catch (error) {
      primaryError = error;
    }
  }
  if (primaryError !== undefined) {
    return Object.freeze({
      status: 'denied',
      diagnostic: compileRepositoryAuditWorkerDiagnostic(primaryError, resources)
    });
  }
  if (run === null || resources === null) {
    throw new Error('Repository audit worker settled without an execution result.');
  }
  return Object.freeze({
    status: 'completed',
    code: run.result.code,
    stdout: run.result.stdout,
    stderr: run.result.stderr,
    resources
  });
}

async function runSupervisedWorkingTreeSourceProgramAudit(args: readonly string[]): Promise<void> {
  const execution = await executeSupervisedWorkingTreeSourceProgramAudit(args);
  if (execution.status === 'denied') {
    process.stderr.write(`${JSON.stringify(execution.diagnostic)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(execution.stdout);
  process.stderr.write(execution.stderr);
  process.exitCode = execution.code;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--worktree-source-program')) {
    await runSupervisedWorkingTreeSourceProgramAudit(args);
  } else {
    await runRepositoryAuditCli(args);
  }
}
