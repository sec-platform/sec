#!/usr/bin/env bun
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_REPOSITORY_AUDIT_REF,
  parseRepositoryAuditCliOptions,
  REPOSITORY_AUDIT_SEVERITY_RANK,
  repositoryAuditShouldFail,
  repositoryModuleTopologyShouldFail,
  type RepositoryAuditCliOptions,
  type RepositoryAuditSeverity,
  type WorkingTreeSourceProgramAuditOptions
} from './cli-contract.ts';
export { repositoryAuditShouldFail } from './cli-contract.ts';
import { encodeRepositoryAuditFullReport } from './full-report-transport.ts';

import ts from 'typescript';

import { canonicalJson, compareCodeUnits, rawSha256, rawSha256Hex, sha256 } from '../../../contracts/canonical.ts';
import { isRepositoryTestModulePath } from '../../../contracts/repository-test-path.ts';
import { enableExecutionProgress, reportExecutionProgress } from '../../../execution/execution-progress.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { ResourceCompositeSettlementError as PhysicalResourceCompositeSettlementError, settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../execution/resource-settlement.ts';
import { withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import {
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  type GitReadSession,
  type GitReadSessionCommand
} from '../../providers/git-read/runtime/session.ts';
import {
  inspectNoFollowDirectoryChain, retainNoFollowOrdinaryFile, type RetainedNoFollowOrdinaryFile,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary, RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, RetainedCommandTransportError
} from '../../runtime-state/physical/runtime/process.ts';
import type { RetainedCommandBoundary } from '../../runtime-state/physical/runtime/retained-command-boundary.ts';
import {
  assertSealedExecutionTreeRetirementReceipt,
  materializeSealedExecutionTree,
  type RetainedSealedExecutionTreeGeneration,
  type SealedExecutionTreeRetirementReceipt
} from '../../runtime-state/physical/runtime/sealed-execution-tree-generation.ts';
import { currentRuntimePlatform, resolveRuntimeCacheRoot, runtimeStateEnvironment } from '../../runtime-state/workspace-state/layout.ts';
import {
  classifyRepositorySurface,
  resolveMarkdownSkillCoverage,
  resolveRepositoryHeuristicSkills,
  AGENT_SKILL_IDS,
  REPOSITORY_HEURISTIC_BEHAVIOR_IDS,
  REPOSITORY_HEURISTIC_ROUTES,
  type AgentSkillId,
  type RepositorySurfaceKind
} from '../../self-hosting/control/agent/skill.ts';
import {
  ClassifyWorkPackageCensus,
  ParseActivePointer,
  ParseRollingPlan
} from '../../self-hosting/control/documentation/document-control-plane-contract.ts';
import type {
  CompilerDependencyReadGenerationRetirementReceipt,
  RetainedCompilerDependencyReadGeneration
} from '../../toolchain/dependencies/runtime.ts';
import { compilerRuntimeLayout } from '../../toolchain/runtime.ts';
import {
  TCB_CLOSURE_RUNTIME_PATH,
  TRUSTED_BOOTSTRAP_REGISTRY_PATH
} from '../../verification/platform/trust/contract/root.ts';
import { tsconfigRelativePath } from "../../workspace-context.ts";
import {
  compileRepositoryModuleArchitectureProjection, compileRepositoryModuleTopologyProjection,
  type RepositoryModuleArchitectureProjection,
  type RepositoryModuleGraph,
  type RepositoryModuleMembership,
  type RepositoryModuleTopologyProjection
} from '../architecture/contract.ts';
import {
  compileRepositoryModulePlacementAdmission,
  type RepositoryModulePlacementAdmission
} from '../architecture/placement.ts';
import {
  createSourceProgramCompilationOperation,
  SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS,
  SourceProgramCompilationInterruptedError,
  type SourceProgramCompilationOperation
} from '../source-program-model/compilation-operation.ts';
import { SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODES, sourceProgramSurfaceForPath, type SourceProgramCandidate, type SourceProgramFileInput, type SourceProgramModel, type SourceProgramOwnerIntentEvidence, type SourceProgramSupersessionReceipt } from '../source-program-model/contract.ts';
import {
  compileSourceProgramDeclarationTopology,
  type SourceProgramDeclarationTopology
} from '../source-program-model/declaration-topology.ts';
import { compileSourceProgramImplementationDominance } from '../source-program-model/implementation-dominance.ts';
import { compileProducerClosure } from '../source-program-model/producer-closure.ts';
import {
  compileSourceProgramArchitectureEvolutionReference,
  compileSourceProgramReconciliationProjection
} from '../source-program-model/reconciliation-projection.ts';
import { buildSourceProgramAggregateImportReductionPatch, compileSourceProgramAggregateImportReductionPlan, compileSourceProgramGraphCutReductionPlan, compileSourceProgramSupersessionEvidence, compileSourceProgramSupersessionEvidenceIdentity, compileSourceProgramSupersessionReceipt, compileSourceProgramTestRetirementReceipt, compileSourceProgramVersionSuffixReductionPlan, parseSourceProgramSupersessionEvidence, projectSourceProgramTestRetirementDispositions, renderSourceProgramGraphCutReductionPatch, renderSourceProgramVersionSuffixReductionPatch, type SourceProgramSupersessionEvidence, type SourceProgramSupersessionEvidenceIdentity } from '../source-program-model/reduction.ts';
import { compileRepositorySourceProgramWithCache } from '../source-program-model/repository-compilation-cache-session.ts';
import { compileRepositorySourceProgramCompilation } from '../source-program-model/repository-compilation.ts';
import { compileOwnerIntentEvidence, summarizeRepositoryTopology } from '../source-program-model/repository.ts';
import { compileSourceProgramTestRewriteDispositions } from '../source-program-model/test-disposition-decisions.ts';
import { compileSourceProgramTestBaselineEvidence, compileSourceProgramTestValue, reconcileSourceProgramTestValueWithSupersession, SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES, summarizeSourceProgramTestUnknownDispositionClusters, type SourceProgramTestBaselineEvidence, type SourceProgramTestFinding } from '../source-program-model/test-value.ts';
import {
  observeTypeScriptSyntax,
  querySourceProgramModel,
  releaseTypeScriptWorkspace
} from '../source-program-model/typescript.ts';
import {
  acquireExactGitTreeSnapshot,
  acquireWorkingTreeSnapshot,
  compileTypeScriptProjectInput,
  type PhysicalWorkspaceSourceSnapshot,
  type WorkspaceSourceFile
} from '../source-program-model/workspace-source-snapshot.ts';
import {
  executeKnipUnusedSymbolProvider,
  type KnipProviderResult
} from './knip-provider.ts';
import {
  deriveRepositoryAuditImplementationDigest,
  joinRepositoryAuditLoadedImplementationObservation,
  type RepositoryAuditLoadedImplementationObservation
} from './loaded-implementation.ts';
import {
  compileSourceProgramAuditOperationInput,
  compileSourceProgramAuditSourceProgramProjection,
  compileSourceProgramAuditTestValueProjection,
  encodeSourceProgramAuditOperationInput,
  parseSourceProgramAuditOperationResult,
  type SourceProgramAuditOperationInput,
  type SourceProgramAuditOperationResult,
  type SourceProgramAuditReduction
} from './source-program-audit-operation.ts';
import { REPOSITORY_TEST_REWRITE_DECISION_BATCHES } from './test-disposition-decisions.ts';
import {
  compileRepositoryAuditWorkerRequest,
  encodeRepositoryAuditWorkerRequest,
  parseRepositoryAuditWorkerCandidateStream,
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS,
  RepositoryAuditWorkerProtocolError,
  type RepositoryAuditWorkerCandidateStream,
  type RepositoryAuditWorkerProtocolErrorCode,
  type RepositoryAuditWorkerRequest
} from './worker-protocol.ts';

const DEFAULT_REPOSITORY_ROOT = compilerRuntimeLayout.packageRoot;
const MAX_TEXT_FILE_BYTES = 2_000_000;
const GIT_BATCH_BYTE_BUDGET = 16 * 1024 * 1024;
const GIT_BATCH_OUTPUT_OVERHEAD = 2 * 1024 * 1024;
const SOURCE_PROGRAM_AUDIT_DEADLINE_MS = 180_000;
const SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES =
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumRequestBytes;
const SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES =
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumCandidateStreamBytes + 4 * 1024 * 1024;
const SOURCE_PROGRAM_AUDIT_GIT_PROCESS_BUDGET = 128;
const SOURCE_PROGRAM_AUDIT_STDERR_BUDGET_BYTES = 4 * 1024 * 1024;
const SOURCE_PROGRAM_AUDIT_IMPLEMENTATION_BUDGET_BYTES = 8 * 1024 * 1024;
const SOURCE_PROGRAM_AUDIT_IMPLEMENTATION_ENTRY_BUDGET = 256;
const SOURCE_PROGRAM_AUDIT_MAX_SETTLEMENT_RESERVE_MS = 5_000;
const SOURCE_PROGRAM_AUDIT_OPERATION = 'brownfield.repository-audit.source-program';
const SOURCE_PROGRAM_AUDIT_REQUIREMENT = 'brownfield.repository-audit.worker-process';
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

function reviewedProcessDispatcherCachePath(repositoryRoot: string): string {
  const platform = currentRuntimePlatform();
  const cacheRoot = resolveRuntimeCacheRoot({
    platform,
    environment: runtimeStateEnvironment(),
    repositoryRoot
  });
  return path.join(cacheRoot, 'source-program-model', 'reviewed-process-dispatchers.json');
}

function supersessionEvidenceCachePath(repositoryRoot: string, identityDigest: string): string {
  const cacheRoot = resolveRuntimeCacheRoot({
    platform: currentRuntimePlatform(),
    environment: runtimeStateEnvironment(),
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
      decodeCacheEnvelope(bytes, TCB_CLOSURE_RUNTIME_PATH)
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
    encodeCacheEnvelope(TCB_CLOSURE_RUNTIME_PATH, projection),
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
    && cached.inputDigests[TCB_CLOSURE_RUNTIME_PATH] !== undefined
    && cached.inputDigests[TRUSTED_BOOTSTRAP_REGISTRY_PATH] !== undefined
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
  const { trustedRuntimeClosure } = await import('../../verification/platform/trust/compiler.ts');
  const closure = trustedRuntimeClosure();
  const inputPaths = new Set([
    ...closure.closure,
    TRUSTED_BOOTSTRAP_REGISTRY_PATH
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
    // One source-program audit observes a working tree plus one exact baseline.
    // Select the canonical exact-tree envelope: the independent repository
    // content census still batches at 16 MiB, while exact source snapshots may
    // legitimately need the full bounded 128 MiB content/protocol command.
    maxStdoutBytes: GIT_READ_EXACT_TREE_OPERATION_BUDGET.maxStdoutBytes,
    maxCommandStdoutBytes: GIT_READ_EXACT_TREE_OPERATION_BUDGET.maxCommandStdoutBytes
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

export type { RepositoryAuditSeverity } from './cli-contract.ts';

export const REPOSITORY_AUDIT_FINDING_CLASSES = Object.freeze([
  'structural-defect',
  'reference-graph-defect',
  'evidence-insufficient',
  'behavior-counterevidence',
  'policy-rejection'
] as const);
export type RepositoryAuditFindingClass =
  typeof REPOSITORY_AUDIT_FINDING_CLASSES[number];

export interface RepositoryAuditFinding {
  code: string;
  findingClass: RepositoryAuditFindingClass;
  line?: number;
  message: string;
  path?: string;
  severity: RepositoryAuditSeverity;
  skills?: readonly AgentSkillId[];
}

type RepositoryModuleArchitectureWithPlacement = RepositoryModuleArchitectureProjection & Readonly<{
  /** Same-graph admission evidence compiled from this exact source snapshot. */
  readonly responsibilityAdmission: RepositoryModulePlacementAdmission;
}>;

export interface RepositoryAuditReport {
  architecture: RepositoryModuleArchitectureWithPlacement;
  declarationTopology: SourceProgramDeclarationTopology;
  behaviorCandidates: readonly BehaviorCandidate[];
  heuristicRoutes: typeof REPOSITORY_HEURISTIC_ROUTES;
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
    findingClasses: Readonly<Record<RepositoryAuditFindingClass, number>>;
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
  surfaces: Readonly<Record<RepositorySurfaceKind, number>>;
  unknowns: readonly string[];
}

export interface RepositoryAuditCliProjection {
  readonly architecture: Readonly<{
    readonly evidenceDigest: ReturnType<typeof sha256>;
    readonly feedbackProjections: number;
    readonly reciprocalPairs: number;
    readonly strongComponents: number;
    readonly violations: number;
    readonly responsibilityFrontier: Readonly<{
      readonly boundedUnknown: number;
      readonly criticalUnknown: number;
      readonly resolved: number;
    }>;
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

export interface RepositoryAuditFindingsCliProjection {
  readonly reportDigest: `sha256:${string}`;
  readonly revision: RepositoryAuditReport['revision'];
  readonly summary: RepositoryAuditReport['summary'];
  readonly findingCodes: readonly string[];
  readonly findings: RepositoryAuditReport['findings'];
  readonly unknowns: RepositoryAuditReport['unknowns'];
}

export class RepositoryAuditCliProjectionContractError extends Error {
  readonly code = 'repository-audit-cli-projection-source-invalid' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RepositoryAuditCliProjectionContractError';
  }
}

function assertRepositoryAuditCliProjectionSource(
  report: RepositoryAuditReport
): void {
  const architecture = report?.architecture;
  const declarationTopology = report?.declarationTopology;
  const sourceProgram = report?.sourceProgram;
  const sourceProgramCompilation = report?.sourceProgramCompilation;
  if (architecture === null || typeof architecture !== 'object'
      || !Array.isArray(architecture.feedbackCuts)
      || !Array.isArray(architecture.reciprocalPairs)
      || !Array.isArray(architecture.strongComponents)
      || !Array.isArray(architecture.violations)
      || architecture.responsibilityAdmission === null
      || typeof architecture.responsibilityAdmission !== 'object'
      || !/^sha256:[0-9a-f]{64}$/u.test(architecture.responsibilityAdmission.admissionDigest)
      || !Array.isArray(architecture.responsibilityAdmission.responsibilityFrontier)
      || !Array.isArray(architecture.responsibilityAdmission.violations)
      || declarationTopology === null || typeof declarationTopology !== 'object'
      || !/^sha256:[0-9a-f]{64}$/u.test(declarationTopology.topologyDigest)
      || !Array.isArray(declarationTopology.declarations)
      || !Array.isArray(declarationTopology.edges)
      || !Array.isArray(declarationTopology.strongComponents)
      || !Array.isArray(declarationTopology.unknowns)
      || report.revision === null || typeof report.revision !== 'object'
      || report.summary === null || typeof report.summary !== 'object'
      || report.summary.findingClasses === null
      || typeof report.summary.findingClasses !== 'object'
      || REPOSITORY_AUDIT_FINDING_CLASSES.some((findingClass) => (
        !Number.isSafeInteger(report.summary.findingClasses[findingClass])
        || report.summary.findingClasses[findingClass] < 0
      ))
      || sourceProgram === null || typeof sourceProgram !== 'object'
      || !/^sha256:[0-9a-f]{64}$/u.test(sourceProgram.modelDigest)
      || sourceProgramCompilation === null || typeof sourceProgramCompilation !== 'object'
      || Object.values(sourceProgramCompilation).some((value) => (
        typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)
      ))
      || !Array.isArray(report.behaviorCandidates)
      || !Array.isArray(report.contentCoverage)
      || !Array.isArray(report.findings)
      || report.findings.some((finding) => (
        finding === null || typeof finding !== 'object' || typeof finding.code !== 'string'
        || !REPOSITORY_AUDIT_FINDING_CLASSES.includes(finding.findingClass)
      ))
      || !Array.isArray(report.optimizations)
      || report.heuristicRoutes === null || typeof report.heuristicRoutes !== 'object'
      || report.surfaces === null || typeof report.surfaces !== 'object'
      || !Array.isArray(report.unknowns)
      || report.unknowns.some((unknown) => typeof unknown !== 'string')) {
    throw new RepositoryAuditCliProjectionContractError(
      'Repository audit CLI projection requires one complete canonical report source.'
    );
  }
}

function repositoryAuditReportIdentity(
  report: RepositoryAuditReport,
  architectureEvidenceDigest: ReturnType<typeof sha256>
) {
  const jsonDigest = (value: unknown) => rawSha256(JSON.stringify(value));
  return Object.freeze({
    schema: 'repository-audit-report-identity' as const,
    architectureEvidenceDigest,
    declarationTopologyDigest: report.declarationTopology.topologyDigest,
    behaviorCandidatesDigest: jsonDigest(report.behaviorCandidates),
    heuristicRoutesDigest: jsonDigest(report.heuristicRoutes),
    contentCoverageDigest: jsonDigest(report.contentCoverage),
    findingsDigest: jsonDigest(report.findings),
    optimizationsDigest: jsonDigest(report.optimizations),
    sourceProgramModelDigest: report.sourceProgram.modelDigest,
    sourceProgramCompilation: report.sourceProgramCompilation,
    revision: report.revision,
    summary: report.summary,
    surfaces: report.surfaces,
    unknownsDigest: jsonDigest(report.unknowns)
  });
}

/**
 * Interactive audit output is a decision projection, not a second report.
 * The exact full report remains available through --full or --output.
 */
export function projectRepositoryAuditCli(
  report: RepositoryAuditReport
): RepositoryAuditCliProjection {
  assertRepositoryAuditCliProjectionSource(report);
  const architecture = projectRepositoryModuleArchitectureCli(report.architecture);
  return Object.freeze({
    architecture,
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
    reportDigest: sha256(repositoryAuditReportIdentity(report, architecture.evidenceDigest)),
    revision: report.revision,
    summary: report.summary,
    findingCodes: Object.freeze([...new Set(report.findings.map(({ code }) => code))].sort()),
    unknownsDigest: rawSha256(JSON.stringify(report.unknowns))
  });
}

/** Exact finding ledger without the multi-hundred-megabyte Source Program body.
 * This is a presentation of the canonical report, bound by the same report digest;
 * it never becomes a second audit producer or authority. */
export function projectRepositoryAuditFindingsCli(
  report: RepositoryAuditReport
): RepositoryAuditFindingsCliProjection {
  const compact = projectRepositoryAuditCli(report);
  return Object.freeze({
    reportDigest: compact.reportDigest,
    revision: report.revision,
    summary: report.summary,
    findingCodes: compact.findingCodes,
    findings: report.findings,
    unknowns: report.unknowns
  });
}

export type RepositoryModuleArchitectureAudit = Readonly<{
  readonly feedbackProjections: RepositoryModuleArchitectureProjection['feedbackCuts'];
  readonly reciprocalPairs: RepositoryModuleArchitectureProjection['reciprocalPairs'];
  readonly strongComponents: RepositoryModuleArchitectureProjection['strongComponents'];
  readonly violations: RepositoryModuleArchitectureProjection['violations'];
}>;

export function projectRepositoryModuleArchitectureCli(
  architecture: RepositoryModuleArchitectureWithPlacement
): RepositoryAuditCliProjection['architecture'] {
  const frontier = architecture.responsibilityAdmission.responsibilityFrontier;
  return Object.freeze({
    evidenceDigest: sha256(Object.freeze({
      architecture: projectRepositoryModuleArchitectureAudit(architecture),
      responsibilityAdmissionDigest: architecture.responsibilityAdmission.admissionDigest
    })),
    feedbackProjections: architecture.feedbackCuts.length,
    reciprocalPairs: architecture.reciprocalPairs.length,
    strongComponents: architecture.strongComponents.length,
    violations: architecture.violations.length,
    responsibilityFrontier: Object.freeze({
      boundedUnknown: frontier.filter(({ status }) => status === 'bounded-unknown').length,
      criticalUnknown: frontier.filter(({ status, criticality }) => (
        status === 'bounded-unknown' && criticality.length > 0
      )).length,
      resolved: frontier.filter(({ status }) => status === 'resolved').length
    })
  });
}

/**
 * Bounded decision projection over the canonical repository-module graph.
 * Feedback projections retain their deterministic DFS witnesses. They are
 * diagnostic cycle evidence, not a minimum or automatically applicable cut.
 */
export function projectRepositoryModuleArchitectureAudit(
  architecture: RepositoryModuleArchitectureProjection
): RepositoryModuleArchitectureAudit {
  return Object.freeze({
    feedbackProjections: architecture.feedbackCuts,
    reciprocalPairs: architecture.reciprocalPairs,
    strongComponents: architecture.strongComponents,
    violations: architecture.violations
  });
}

export function repositoryModuleArchitectureShouldBlock(
  architecture: Pick<RepositoryModuleArchitectureProjection, 'violations'>
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
  skills: readonly AgentSkillId[];
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
  entries: readonly GitTreeEntry[],
  sourceFiles: readonly WorkspaceSourceFile[]
): Promise<Readonly<{
  bytesByPath: ReadonlyMap<string, Buffer>;
  contentCoverage: readonly RepositoryContentCoverage[];
  textByPath: ReadonlyMap<string, string | null>;
}>> {
  const sourceBytesByPath = new Map(sourceFiles.map(({ path: repositoryPath, source }) => (
    [repositoryPath, Buffer.from(source, 'utf8')] as const
  )));
  const readableEntries = entries.filter((entry) =>
    entry.type === 'blob'
    && (entry.mode === '100644' || entry.mode === '100755')
    && entry.size !== null
    && entry.size <= MAX_TEXT_FILE_BYTES
    && !sourceBytesByPath.has(entry.path));
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
    const sourceBytes = sourceBytesByPath.get(entry.path);
    const read = sourceBytes === undefined ? blobs.get(entry.object) : undefined;
    const bytes = sourceBytes ?? read?.bytes ?? null;
    if (bytes === null) {
      contentCoverage.push(
        coverageResult(entry, 'unknown', read?.reason ?? 'blob-unavailable')
      );
      textByPath.set(entry.path, null);
      continue;
    }
    if (bytes.length !== entry.size) {
      contentCoverage.push(coverageResult(entry, 'unknown', 'blob-size-mismatch'));
      textByPath.set(entry.path, null);
      continue;
    }
    bytesByPath.set(entry.path, bytes);
    if (MINIFIED_GENERATED_PATH.test(entry.path)) {
      contentCoverage.push(coverageResult(entry, 'excluded', 'minified-generated'));
      textByPath.set(entry.path, null);
      continue;
    }
    const binaryReason = knownBinaryReason(bytes);
    if (binaryReason !== null) {
      contentCoverage.push(coverageResult(entry, 'excluded', binaryReason));
      textByPath.set(entry.path, null);
      continue;
    }
    if (bytes.includes(0)) {
      contentCoverage.push(coverageResult(entry, 'unknown', 'nul-content'));
      textByPath.set(entry.path, null);
      continue;
    }
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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

async function compileRevisionSupersessionEvidence(
  repositoryRoot: string,
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot,
  identity: SourceProgramSupersessionEvidenceIdentity,
  dependencyGeneration: RetainedNoFollowProvenDirectoryGeneration,
  dependencyGenerationDigest: `sha256:${string}`,
  operation: SourceProgramCompilationOperation,
  cachedEvidence: SourceProgramSupersessionEvidence | null,
  cacheAccess: 'read-only' | 'read-write'
): Promise<Readonly<{
  compilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  evidence: SourceProgramSupersessionEvidence;
  membership: RepositoryModuleMembership;
  sourceFiles: readonly WorkspaceSourceFile[];
}>> {
  const files = workspaceSnapshot.files;
  const membership = workspaceSnapshot.moduleMembership;
  const revisionUnknowns: import('../source-program-model/contract.ts').SourceProgramUnknown[] = [];
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
  const projectInput = compileTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath,
    { dependencyGeneration, dependencyGenerationDigest }
  );
  const compilation = compileRepositorySourceProgramWithCache({
    cacheAccess,
    workspaceSnapshot,
    projectInput,
    operation,
    repositoryRoot,
    reviewedProcessDispatchers,
    unknowns: revisionUnknowns
  });
  const model = compilation.model;
  return Object.freeze({
    compilation,
    membership,
    sourceFiles: workspaceSnapshot.files,
    evidence: cachedEvidence ?? compileSourceProgramSupersessionEvidence({
      model,
      tests: compileSourceProgramTestValue({
        repositoryRoot: DEFAULT_REPOSITORY_ROOT,
        files,
        model,
        operation
      }),
      intentEvidence: compileOwnerIntentEvidence(model, membership, operation),
      identity,
      operation
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
  topology: RepositoryModuleTopologyProjection;
}>;

async function compileWorkingTreeModuleTopology(
  repositoryRoot: string
): Promise<WorkingTreeModuleTopology> {
  return withAuthorityGitReadSession(
    { cwd: repositoryRoot, budget: repositoryModuleTopologyGitBudget() },
    async (session) => {
      const workspaceSnapshot = await acquireWorkingTreeSnapshot({ session });
      if (workspaceSnapshot.moduleMembership.descriptors.length === 0) {
        throw new Error('Working-tree module topology requires at least one module.json descriptor');
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
        topology: compileRepositoryModuleTopologyProjection(
          graph,
          workspaceSnapshot.moduleMembership
        )
      });
    }
  );
}

function compileRepositoryModuleArchitectureAdmission(
  graph: RepositoryModuleGraph,
  membership: RepositoryModuleMembership,
  model: SourceProgramModel,
  sourceFiles: readonly WorkspaceSourceFile[]
): RepositoryModuleArchitectureWithPlacement {
  const sourceLinesByPath = new Map(sourceFiles.map(({ path: repositoryPath, source }) => (
    [repositoryPath, source.length === 0 ? 0 : source.split(/\r\n|\r|\n/u).length] as const
  )));
  const facts = Object.freeze({
    ...model,
    files: Object.freeze(model.files.map((file) => Object.freeze({
      ...file,
      sourceLines: sourceLinesByPath.get(file.path)
    })))
  });
  const architecture = compileRepositoryModuleArchitectureProjection(
    graph,
    membership,
    facts
  );
  const responsibilityAdmission = compileRepositoryModulePlacementAdmission({
    graph,
    membership,
    facts
  });
  const violations = Object.freeze([...new Map([
    ...architecture.violations,
    ...responsibilityAdmission.violations
  ].map((violation) => [
    `${violation.code}\0${violation.from}\0${violation.to}\0${violation.detail}`,
    violation
  ] as const)).values()].sort((left, right) => compareCodeUnits(
    `${left.code}\0${left.from}\0${left.to}\0${left.detail}`,
    `${right.code}\0${right.from}\0${right.to}\0${right.detail}`
  )));
  return Object.freeze({
    ...architecture,
    violations,
    responsibilityAdmission
  });
}

async function compileWorkingTreeSourceProgram(
  repositoryRoot: string,
  supersessionBaseline: string,
  deadlineAtUnixMs: number,
  allowSupersessionEvidenceCache: boolean,
  cacheAccess: 'read-only' | 'read-write',
  observeKnip: boolean
): Promise<Readonly<{
  cache: 'hit' | 'incremental' | 'miss';
  sourceProgramCompilation: Readonly<{
    subjectDigest: `sha256:${string}`;
    snapshotDigest: `sha256:${string}`;
    moduleGraphDigest: `sha256:${string}`;
    receiptDigest: `sha256:${string}`;
  }>;
  dependencyGenerationDigest: `sha256:${string}`;
  currentSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  invalidatedTypeScriptPaths: readonly string[];
  declarationTopology: SourceProgramDeclarationTopology;
  model: SourceProgramModel;
  moduleArchitecture: RepositoryModuleArchitectureWithPlacement;
  baselineTestPaths: readonly string[];
  baselineTestEvidence: readonly SourceProgramTestBaselineEvidence[];
  baselineSourceFiles: readonly WorkspaceSourceFile[];
  baselineSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  baselineModuleMembership: RepositoryModuleMembership;
  baselineSupersessionEvidence: SourceProgramSupersessionEvidence;
  baselineSupersessionEvidenceCacheCandidate: SourceProgramSupersessionEvidence | null;
  baselineSharesCurrentSourceRevision: boolean;
  currentSupersessionIdentity: SourceProgramSupersessionEvidenceIdentity;
  currentIntentEvidence: readonly SourceProgramOwnerIntentEvidence[];
  moduleMembership: RepositoryModuleMembership;
  reviewedProcessDispatchers: readonly string[];
  sourceFiles: readonly WorkspaceSourceFile[];
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
  compilationOperation: SourceProgramCompilationOperation;
  knipProvider: KnipProviderResult | null;
}>> {
  const runtime = await import('../../toolchain/dependencies/runtime.ts');
  const authority = await runtime.observeCompilerDependencyExecutionGenerationAuthority(
    { deadlineAtUnixMs },
    repositoryRoot
  );
  if (authority === null) {
    throw new Error('Working-tree Source Program audit requires one admitted compiler dependency generation.');
  }
  const retained = await runtime.retainCompilerDependencyReadGeneration(authority, {
    deadlineAtUnixMs
  });
  try {
    const compilation = await withAuthorityGitReadSession(
      { cwd: repositoryRoot, budget: repositoryAuditGitBudget(deadlineAtUnixMs) },
      async (session) => compileWorkingTreeSourceProgramWithSession(
        session,
        repositoryRoot,
        supersessionBaseline,
        deadlineAtUnixMs,
        retained.physicalGeneration,
        retained.generationDigest,
        allowSupersessionEvidenceCache,
        cacheAccess
      )
    );
    if (!observeKnip) return Object.freeze({ ...compilation, knipProvider: null });
    const cacheRoot = resolveRuntimeCacheRoot({
      platform: currentRuntimePlatform(),
      environment: runtimeStateEnvironment(),
      repositoryRoot
    });
    const generationParentPath = path.join(cacheRoot, 'repository-audit', 'knip-generations');
    await mkdir(generationParentPath, { recursive: true });
    const knipProvider = await executeKnipUnusedSymbolProvider({
      workspaceSnapshot: compilation.workspaceSnapshot,
      model: compilation.model,
      dependencyGeneration: retained,
      generationParent: inspectNoFollowDirectoryChain(
        generationParentPath,
        'Knip execution generation parent'
      ).target,
      deadlineAtUnixMs
    });
    return Object.freeze({ ...compilation, knipProvider });
  } finally {
    await retained.retire();
  }
}

async function compileWorkingTreeSourceProgramWithSession(
  session: GitReadSession,
  repositoryRoot: string,
  supersessionBaseline: string,
  deadlineAtUnixMs: number,
  dependencyGeneration: RetainedNoFollowProvenDirectoryGeneration,
  dependencyGenerationDigest: `sha256:${string}`,
  allowSupersessionEvidenceCache: boolean,
  cacheAccess: 'read-only' | 'read-write'
): Promise<Readonly<{
  cache: 'hit' | 'incremental' | 'miss';
  sourceProgramCompilation: Readonly<{
    subjectDigest: `sha256:${string}`;
    snapshotDigest: `sha256:${string}`;
    moduleGraphDigest: `sha256:${string}`;
    receiptDigest: `sha256:${string}`;
  }>;
  dependencyGenerationDigest: `sha256:${string}`;
  currentSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  invalidatedTypeScriptPaths: readonly string[];
  declarationTopology: SourceProgramDeclarationTopology;
  model: SourceProgramModel;
  moduleArchitecture: RepositoryModuleArchitectureWithPlacement;
  baselineTestPaths: readonly string[];
  baselineTestEvidence: readonly SourceProgramTestBaselineEvidence[];
  baselineSourceFiles: readonly WorkspaceSourceFile[];
  baselineSourceProgramCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
  baselineModuleMembership: RepositoryModuleMembership;
  baselineSupersessionEvidence: SourceProgramSupersessionEvidence;
  baselineSupersessionEvidenceCacheCandidate: SourceProgramSupersessionEvidence | null;
  baselineSharesCurrentSourceRevision: boolean;
  currentSupersessionIdentity: SourceProgramSupersessionEvidenceIdentity;
  currentIntentEvidence: readonly SourceProgramOwnerIntentEvidence[];
  moduleMembership: RepositoryModuleMembership;
  reviewedProcessDispatchers: readonly string[];
  sourceFiles: readonly WorkspaceSourceFile[];
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
  compilationOperation: SourceProgramCompilationOperation;
}>> {
  const compilationOperation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs,
    observePhase: (event) => reportExecutionProgress({
      command: 'audit:source-program',
      phase: `source-program.${event.phase}`,
      state: event.state,
      elapsedMs: event.elapsedMs
    })
  });
  const before = await runGitBytes(session, [
    '-c', 'core.quotepath=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ]);
  if (before === null) {
    throw new Error('Working-tree Source Program Model requires Git status');
  }
  const workspaceSnapshot = await acquireWorkingTreeSnapshot({ session });
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
  const baselineSnapshot = await acquireExactGitTreeSnapshot({
    session,
    commitSha: exactSupersessionBaseline
  });
  const cachedBaselineSupersessionEvidence = allowSupersessionEvidenceCache
    ? await readSupersessionEvidenceCache(repositoryRoot, baselineIdentity)
    : null;
  const baselineTestPaths = Object.freeze(
    baselineEntries
      .filter(({ path: repositoryPath }) => isRepositoryTestModulePath(repositoryPath))
      .map(({ path: repositoryPath }) => repositoryPath)
      .sort(compareCodeUnits)
  );
  const baselineTestRevision = rawSha256(JSON.stringify(
    baselineEntries
      .filter(({ path: repositoryPath }) => isRepositoryTestModulePath(repositoryPath))
      .map(({ mode, object, path: repositoryPath, size, type }) => ({
        mode,
        object,
        path: repositoryPath,
        size,
        type
      }))
  ));
  const files = workspaceSnapshot.files;
  const unknowns: import('../source-program-model/contract.ts').SourceProgramUnknown[] = [];
  const moduleMembership = workspaceSnapshot.moduleMembership;
  if (moduleMembership.descriptors.length === 0) {
    unknowns.push(Object.freeze({
      code: 'working-tree-module-ownership-unavailable',
      path: '.',
      detail: 'no module.json descriptor is present',
      span: null
    }));
  }
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
  const projectInput = compileTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath,
    { dependencyGeneration, dependencyGenerationDigest }
  );
  const compilation = compileRepositorySourceProgramWithCache({
    cacheAccess,
    workspaceSnapshot,
    projectInput,
    operation: compilationOperation,
    repositoryRoot,
    reviewedProcessDispatchers,
    unknowns
  });
  const moduleGraph = compilation.workspaceSnapshot.moduleGraph;
  const incrementalCompilation = compilation.typeScriptCompilation;
  const model = compilation.model;
  const baselineReconciliation = await (async () => {
    if (baselineSnapshot.sourceRevision !== workspaceSnapshot.sourceRevision) {
      return compileRevisionSupersessionEvidence(
        repositoryRoot,
        baselineSnapshot,
        baselineIdentity,
        dependencyGeneration,
        dependencyGenerationDigest,
        compilationOperation,
        cachedBaselineSupersessionEvidence,
        cacheAccess
      );
    }
    // The Source Program revision binds the complete admitted file bytes,
    // module membership and semantic graph. Observation route (working tree
    // versus exact Git blobs) cannot create a second semantic compilation for
    // the same revision. The exact assertion preserves collision/drift safety
    // before reusing the already-issued compilation and its model.
    baselineSnapshot.assertMatches({
      sourceRevision: workspaceSnapshot.sourceRevision,
      files,
      moduleMembership
    });
    return Object.freeze({
      compilation,
      membership: moduleMembership,
      sourceFiles: files,
      evidence: cachedBaselineSupersessionEvidence ?? compileSourceProgramSupersessionEvidence({
        model,
        tests: compileSourceProgramTestValue({
          repositoryRoot: DEFAULT_REPOSITORY_ROOT,
          files,
          model,
          operation: compilationOperation
        }),
        intentEvidence: compileOwnerIntentEvidence(
          model,
          moduleMembership,
          compilationOperation
        ),
        identity: baselineIdentity,
        operation: compilationOperation
      })
    });
  })();
  const baselineSupersessionEvidence = baselineReconciliation.evidence;
  const baselineTestEvidence = compileSourceProgramTestBaselineEvidence({
    baselineTestPaths,
    baselineModel: baselineReconciliation.compilation.typeScriptCompilation.model,
    candidateModel: incrementalCompilation.model,
    baselineRevision: baselineTestRevision,
    operation: compilationOperation
  });
  const declarationTopology = compileSourceProgramDeclarationTopology(compilation);
  const moduleArchitecture = compileRepositoryModuleArchitectureAdmission(
    moduleGraph,
    moduleMembership,
    model,
    files
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
    dependencyGenerationDigest,
    currentSourceProgramCompilation: compilation,
    invalidatedTypeScriptPaths: incrementalCompilation.invalidatedPaths,
    declarationTopology,
    model,
    moduleArchitecture,
    baselineTestPaths,
    baselineTestEvidence,
    baselineSourceFiles: baselineReconciliation.sourceFiles,
    baselineSourceProgramCompilation: baselineReconciliation.compilation,
    baselineModuleMembership: baselineReconciliation.membership,
    baselineSupersessionEvidence,
    baselineSupersessionEvidenceCacheCandidate: cachedBaselineSupersessionEvidence === null
      ? baselineSupersessionEvidence
      : null,
    baselineSharesCurrentSourceRevision:
      baselineSnapshot.sourceRevision === workspaceSnapshot.sourceRevision,
    currentSupersessionIdentity,
    currentIntentEvidence: compileOwnerIntentEvidence(
      model,
      moduleMembership,
      compilationOperation
    ),
    moduleMembership,
    reviewedProcessDispatchers,
    sourceFiles: Object.freeze(files),
    workspaceSnapshot,
    compilationOperation
  });
}

type PreparedWorkingTreeSourceProgramAudit = Readonly<{
  dependencyGenerationDigest: `sha256:${string}`;
  supersessionEvidenceCacheCandidates: readonly SourceProgramSupersessionEvidence[];
  operationInput: SourceProgramAuditOperationInput;
  producerCompilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
}>;

function compileRepositoryAuditPreparationPhase<T>(
  phase: string,
  compile: () => T
): T {
  reportExecutionProgress({ command: 'audit:source-program', phase, state: 'start' });
  try {
    const result = compile();
    reportExecutionProgress({ command: 'audit:source-program', phase, state: 'complete' });
    return result;
  } catch (error) {
    reportExecutionProgress({ command: 'audit:source-program', phase, state: 'failed' });
    throw error;
  }
}

async function prepareWorkingTreeSourceProgramAudit(
  options: WorkingTreeSourceProgramAuditOptions,
  deadlineAtUnixMs: number
): Promise<PreparedWorkingTreeSourceProgramAudit> {
  const worktreeAudit = await (async () => {
    try {
      return await compileWorkingTreeSourceProgram(
        DEFAULT_REPOSITORY_ROOT,
        options.supersessionBaseline,
        deadlineAtUnixMs,
        !options.enforce,
        options.enforce ? 'read-only' : 'read-write',
        options.reductionMode === 'graph-cut'
      );
    } finally {
      releaseTypeScriptWorkspace();
    }
  })();
  const { model } = worktreeAudit;
  const implementationDominance = compileRepositoryAuditPreparationPhase(
    'source-program.implementation-dominance',
    () => compileSourceProgramImplementationDominance({
      model,
      ownerIntents: worktreeAudit.currentIntentEvidence
    })
  );
  const knipReceipt = worktreeAudit.knipProvider?.status === 'completed'
    ? worktreeAudit.knipProvider.receipt
    : null;
  const reconciliation = compileRepositoryAuditPreparationPhase(
    'source-program.reconciliation',
    () => compileSourceProgramReconciliationProjection({
      before: worktreeAudit.baselineSourceProgramCompilation,
      after: worktreeAudit.currentSourceProgramCompilation,
      ...(options.reductionMode === 'graph-cut' ? {
        providerEvidence: [knipReceipt === null
          ? Object.freeze({
              provider: 'knip', status: 'unresolved' as const,
              providerRevision: null, configDigest: null, inputDigest: null, candidateDigest: null
            })
          : Object.freeze({
              provider: 'knip', status: 'observed' as const,
              providerRevision: knipReceipt.providerRevision,
              configDigest: knipReceipt.configurationDigest as `sha256:${string}`,
              inputDigest: knipReceipt.inputDigest as `sha256:${string}`,
              candidateDigest: knipReceipt.candidateDigest as `sha256:${string}`
            })]
      } : {})
    })
  );
  const architectureEvolution = compileRepositoryAuditPreparationPhase(
    'source-program.architecture-evolution',
    () => compileSourceProgramArchitectureEvolutionReference({ reconciliation })
  );
  const observedTestValue = compileSourceProgramTestValue({
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    files: worktreeAudit.sourceFiles,
    model,
    baselineTestPaths: worktreeAudit.baselineTestPaths,
    baselineEvidence: worktreeAudit.baselineTestEvidence,
    operation: worktreeAudit.compilationOperation
  });
  const rewriteDispositions = compileRepositoryAuditPreparationPhase(
    'source-program.test-rewrite-disposition',
    () => compileSourceProgramTestRewriteDispositions({
      compilation: observedTestValue,
      baselineEvidence: worktreeAudit.baselineTestEvidence,
      batches: REPOSITORY_TEST_REWRITE_DECISION_BATCHES
    })
  );
  const testValue = rewriteDispositions.length === 0
    ? observedTestValue
    : compileSourceProgramTestValue({
        repositoryRoot: DEFAULT_REPOSITORY_ROOT,
        files: worktreeAudit.sourceFiles,
        model,
        baselineTestPaths: worktreeAudit.baselineTestPaths,
        baselineEvidence: worktreeAudit.baselineTestEvidence,
        dispositions: rewriteDispositions,
        operation: worktreeAudit.compilationOperation
      });
  const baselineSupersessionEvidence = worktreeAudit.baselineSharesCurrentSourceRevision
    ? compileSourceProgramSupersessionEvidence({
        model,
        tests: testValue,
        intentEvidence: worktreeAudit.currentIntentEvidence,
        identity: worktreeAudit.baselineSupersessionEvidence.identity,
        operation: worktreeAudit.compilationOperation
      })
    : worktreeAudit.baselineSupersessionEvidence;
  const currentSupersessionEvidence = compileSourceProgramSupersessionEvidence({
    model,
    tests: testValue,
    intentEvidence: worktreeAudit.currentIntentEvidence,
    identity: worktreeAudit.currentSupersessionIdentity,
    operation: worktreeAudit.compilationOperation
  });
  const supersession = compileSourceProgramSupersessionReceipt({
    baseline: baselineSupersessionEvidence,
    current: currentSupersessionEvidence,
    operation: worktreeAudit.compilationOperation
  });
  const observedDisposition = compileRepositoryAuditPreparationPhase(
    'source-program.test-supersession-disposition',
    () => reconcileSourceProgramTestValueWithSupersession(testValue, supersession)
  );
  const testRetirement = compileSourceProgramTestRetirementReceipt({
    baseline: baselineSupersessionEvidence,
    current: currentSupersessionEvidence,
    supersession,
    currentModel: model,
    currentTestCompilation: testValue,
    baselineFiles: worktreeAudit.baselineSourceFiles,
    currentFiles: worktreeAudit.sourceFiles,
    operation: worktreeAudit.compilationOperation
  });
  const testDisposition = compileRepositoryAuditPreparationPhase(
    'source-program.test-retirement-disposition',
    () => projectSourceProgramTestRetirementDispositions(observedDisposition, testRetirement)
  );
  const blockingTestFindings = sourceProgramBlockingTestFindings(testDisposition.findings);
  const blockingCandidates = sourceProgramBlockingCandidates(model);
  const unknownDispositionClusters = summarizeSourceProgramTestUnknownDispositionClusters(
    testDisposition.dispositions,
    testDisposition.findings
  );
  const reductionCompilerContext = Object.freeze({
    operation: worktreeAudit.compilationOperation,
    typeScriptModel: worktreeAudit.currentSourceProgramCompilation.typeScriptCompilation.model,
    moduleMembership: worktreeAudit.moduleMembership,
    reviewedProcessDispatchers: worktreeAudit.reviewedProcessDispatchers
  });

  let reduction: SourceProgramAuditReduction = Object.freeze({ mode: 'none' });
  if (options.reductionMode === 'version') {
    const plan = compileSourceProgramVersionSuffixReductionPlan(
      model,
      worktreeAudit.sourceFiles,
      reductionCompilerContext
    );
    const patch = plan.reductions.every(({ status }) => status === 'blocked')
      ? null
      : renderSourceProgramVersionSuffixReductionPatch(plan, worktreeAudit.sourceFiles);
    reduction = Object.freeze({ mode: 'version', plan, patch });
  } else if (options.reductionMode === 'aggregate-import') {
    const plan = compileSourceProgramAggregateImportReductionPlan(
      model,
      worktreeAudit.sourceFiles,
      Object.freeze({
        sourceRevision: model.sourceRevision,
        architecture: worktreeAudit.moduleArchitecture
      }),
      reductionCompilerContext
    );
    const patch = plan.reductions.every(({ status }) => status === 'blocked')
      ? null
      : buildSourceProgramAggregateImportReductionPatch(plan, worktreeAudit.sourceFiles);
    reduction = Object.freeze({ mode: 'aggregate-import', plan, patch });
  } else if (options.reductionMode === 'graph-cut' && knipReceipt !== null) {
    const plan = compileSourceProgramGraphCutReductionPlan(
      model,
      worktreeAudit.sourceFiles,
      knipReceipt,
      reductionCompilerContext
    );
    const patch = plan.reductions.every(({ status }) => status === 'blocked')
      ? null
      : renderSourceProgramGraphCutReductionPatch(plan, worktreeAudit.sourceFiles);
    reduction = Object.freeze({
      mode: 'graph-cut',
      plan,
      patch,
      providerEvidence: Object.freeze({
        provider: knipReceipt.provider,
        receiptDigest: knipReceipt.receiptDigest,
        sourceRevision: knipReceipt.sourceRevision
      })
    });
  }

  const sourceFileIdentities = Object.freeze(model.files.map(({ path: repositoryPath, contentDigest }) =>
    Object.freeze({ path: repositoryPath, contentDigest })));

  return Object.freeze({
    dependencyGenerationDigest: worktreeAudit.dependencyGenerationDigest,
    supersessionEvidenceCacheCandidates: Object.freeze([
      ...(worktreeAudit.baselineSharesCurrentSourceRevision
        ? [baselineSupersessionEvidence]
        : worktreeAudit.baselineSupersessionEvidenceCacheCandidate === null
          ? []
          : [worktreeAudit.baselineSupersessionEvidenceCacheCandidate]),
      currentSupersessionEvidence
    ]),
    producerCompilation: worktreeAudit.currentSourceProgramCompilation,
    operationInput: compileSourceProgramAuditOperationInput(Object.freeze({
      architectureEvolution,
      blockingCandidates,
      blockingTestFindings,
      cache: worktreeAudit.cache,
      declarationTopology: worktreeAudit.declarationTopology,
      implementationDominance,
      invalidatedTypeScriptPaths: worktreeAudit.invalidatedTypeScriptPaths,
      sourceProgram: compileSourceProgramAuditSourceProgramProjection(
        model,
        sourceFileIdentities,
        options.includeCandidates,
        options.blockingDetails && options.blockingDetailsDomain === 'source-program'
      ),
      moduleArchitecture: worktreeAudit.moduleArchitecture,
      options: Object.freeze({
        blockingDetails: options.blockingDetails,
        blockingDetailsDomain: options.blockingDetailsDomain,
        blockingDetailsPage: options.blockingDetailsPage,
        enforce: options.enforce,
        full: options.full,
        includeCandidates: options.includeCandidates,
        outputPath: options.outputPath,
        queryProjection: options.query === null ? null : querySourceProgramModel(model, options.query)
      }),
      reconciliation,
      reduction,
      sourceFileIdentities,
      sourceProgramCompilation: worktreeAudit.sourceProgramCompilation,
      supersession,
      testDisposition,
      testRetirement,
      testValue: compileSourceProgramAuditTestValueProjection(testValue, options.full),
      topology: summarizeRepositoryTopology(model),
      unknownDispositionClusters
    }))
  });
}

function behaviorSkills(repositoryPath: string): AgentSkillId[] {
  const markdown = resolveMarkdownSkillCoverage(repositoryPath);
  return markdown?.skills ?? resolveRepositoryHeuristicSkills(repositoryPath);
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
  const markdown = resolveMarkdownSkillCoverage(repositoryPath);
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
    || (markdown === null && resolveRepositoryHeuristicSkills(repositoryPath).length > 0);
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

const SOURCE_PROGRAM_FINDING_CLASSES = Object.freeze({
  'causal-identity-unresolved': 'evidence-insufficient',
  'causal-relation-owner-bypass': 'policy-rejection',
  'direct-process-transport-outside-owner': 'policy-rejection',
  'process-resource-session-boundary-unresolved': 'evidence-insufficient',
  'durable-worker-domain-import': 'policy-rejection',
  'durable-worker-generic-input-exposed': 'policy-rejection',
  'duplicate-production-endpoint-literal': 'behavior-counterevidence',
  'duplicate-entrypoint-command': 'behavior-counterevidence',
  'duplicate-production-identity-token': 'behavior-counterevidence',
  'duplicate-production-source-path-owner': 'behavior-counterevidence',
  'production-embeds-executable-source-text': 'behavior-counterevidence',
  'operation-issuer-role-conflict': 'behavior-counterevidence',
  'operation-issuer-role-outside-owner': 'policy-rejection',
  'operation-critical-role-unresolved': 'evidence-insufficient',
  'operation-recovery-binding-unresolved': 'evidence-insufficient',
  'versioned-declaration-conflicts-with-canonical-name': 'behavior-counterevidence',
  'test-mirrors-production-identity-literal': 'behavior-counterevidence',
  'test-mirrors-production-literal-collection': 'behavior-counterevidence',
  'test-mirrors-production-source-path': 'behavior-counterevidence'
} as const satisfies Readonly<Record<
  (typeof SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODES)[number],
  RepositoryAuditFindingClass
>>);

const REPOSITORY_AUDIT_FIXED_FINDING_CLASSES = Object.freeze({
  'possible-heuristic-outside-governance': 'policy-rejection',
  'malformed-repository-reference': 'reference-graph-defect',
  'work-tracking-contract-missing': 'structural-defect',
  'work-tracking-contract-invalid': 'structural-defect',
  'work-tracking-contract-semantics-invalid': 'policy-rejection',
  'work-tracking-authority-invalid': 'reference-graph-defect',
  'work-tracking-authority-missing': 'reference-graph-defect',
  'work-tracking-problem-registry-unreadable': 'structural-defect',
  'work-tracking-problem-id-invalid': 'structural-defect',
  'work-tracking-problem-id-duplicate': 'structural-defect',
  'work-tracking-goal-registry-unreadable': 'structural-defect',
  'work-tracking-goal-id-duplicate': 'structural-defect',
  'work-tracking-registry-empty': 'structural-defect',
  'workflow-entrypoint-missing': 'reference-graph-defect',
  'control-plane-pointer-invalid': 'structural-defect',
  'control-plane-rolling-invalid': 'structural-defect',
  'control-plane-manifest-missing': 'reference-graph-defect',
  'control-plane-manifest-blob-unavailable': 'evidence-insufficient',
  'control-plane-digest-drift': 'behavior-counterevidence',
  'control-plane-rolling-drift': 'reference-graph-defect',
  'control-plane-live-manifest-census': 'reference-graph-defect',
  'repository-module-architecture-boundary-invalid': 'policy-rejection',
  'partial-discovery-named-all': 'behavior-counterevidence',
  'skill-without-heuristic-route': 'reference-graph-defect'
} as const satisfies Readonly<Record<string, RepositoryAuditFindingClass>>);

/** Severity answers "how strongly should this block?"; finding class answers
 * "what kind of failure is this?". Keep the two dimensions independent so
 * `high` never becomes a catch-all explanation for unrelated mechanisms. */
export function repositoryAuditFindingClass(
  code: string
): RepositoryAuditFindingClass {
  const sourceProgramPrefix = 'source-program-';
  if (code.startsWith(sourceProgramPrefix)) {
    const candidateCode = code.slice(sourceProgramPrefix.length) as
      (typeof SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODES)[number];
    const findingClass = SOURCE_PROGRAM_FINDING_CLASSES[candidateCode];
    if (findingClass !== undefined) return findingClass;
  }
  const findingClass = REPOSITORY_AUDIT_FIXED_FINDING_CLASSES[
    code as keyof typeof REPOSITORY_AUDIT_FIXED_FINDING_CLASSES
  ];
  if (findingClass !== undefined) return findingClass;
  throw new Error(`Unclassified repository audit finding code: ${code}`);
}

function countFindingClasses(
  findings: readonly RepositoryAuditFinding[]
): Readonly<Record<RepositoryAuditFindingClass, number>> {
  const counts = Object.fromEntries(
    REPOSITORY_AUDIT_FINDING_CLASSES.map((findingClass) => [findingClass, 0])
  ) as Record<RepositoryAuditFindingClass, number>;
  for (const finding of findings) counts[finding.findingClass] += 1;
  return Object.freeze(counts);
}

type RepositoryAuditFindingInput = Omit<RepositoryAuditFinding, 'findingClass'> & Readonly<{
  findingClass?: RepositoryAuditFindingClass;
}>;

function pushFinding(
  findings: RepositoryAuditFinding[],
  finding: RepositoryAuditFindingInput
): void {
  const findingClass = repositoryAuditFindingClass(finding.code);
  if (finding.findingClass !== undefined && finding.findingClass !== findingClass) {
    throw new Error(
      `Repository audit finding class mismatch for ${finding.code}: `
      + `expected=${findingClass} actual=${finding.findingClass}`
    );
  }
  findings.push(Object.freeze({
    ...finding,
    findingClass,
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


const WORK_TRACKING_CONTRACT_PATH = 'config/repository/work-tracking-contract.json';
const WORK_TRACKING_PROBLEM_FILES = Object.freeze([
  'docs/状态/作者与接口.md',
  'docs/状态/信息约束与验证.md',
  'docs/状态/执行与恢复.md',
  'docs/状态/编译与目标.md',
  'docs/状态/语义与领域.md'
] as const);
const WORK_TRACKING_FRONTIER_PATH = 'docs/状态/前沿与登记规则.md';
const WORK_TRACKING_MAINLINE_PATH = 'docs/演进/实施/主线前沿与准入.md';

type WorkTrackingContract = Readonly<{
  schema: 'sec-work-tracking-contract-v1';
  authorities: Readonly<{
    rootGoals: string;
    problemRegistry: string;
    implementationMainline: string;
    activeWorkPackage: string;
  }>;
  identities: Readonly<{
    G: Readonly<{ pattern: '^G\\d{2}$'; meaning: 'root-goal'; task: false; githubIssue: false; progressUnit: false }>;
    U: Readonly<{ pattern: '^U\\d{3}$'; meaning: 'stable-problem-theme'; task: false; githubIssue: false; progressUnit: false; allocation: 'monotonic-never-reuse' }>;
  }>;
  execution: Readonly<{
    mainlineUnit: 'implementation-delivery';
    coordinationUnit: 'work-group';
    actionUnit: 'work-package';
    evidenceUnit: 'revision-bound-evidence';
    branchRole: 'transport-or-candidate-not-work-identity';
    commitRole: 'durable-change-evidence-not-progress-unit';
  }>;
  progress: Readonly<{
    unit: 'activated-deliverable-obligation-closure';
    mustReport: readonly string[];
    mustNotUseAsProgress: readonly string[];
  }>;
  newProblemAdmission: readonly string[];
  duplicatePolicy: 'merge-source-into-existing-U-when-obligation-is-not-independent';
  githubIssueMapping: 'optional-explicit-mirror-only';
}>;

function workTrackingAuthorityPath(reference: string): string {
  return reference.split('#', 1)[0]!;
}

function workTrackingFinding(
  findings: RepositoryAuditFinding[],
  code: string,
  message: string,
  path = WORK_TRACKING_CONTRACT_PATH
): void {
  pushFinding(findings, { code, message, path, severity: 'high' });
}

export function projectWorkTrackingContractFindings(
  tracked: readonly string[],
  textByPath: ReadonlyMap<string, string | null>
): readonly RepositoryAuditFinding[] {
  const trackedSet = new Set(tracked);
  const applies = trackedSet.has(WORK_TRACKING_CONTRACT_PATH)
    || trackedSet.has(WORK_TRACKING_FRONTIER_PATH)
    || trackedSet.has(WORK_TRACKING_MAINLINE_PATH)
    || WORK_TRACKING_PROBLEM_FILES.some((repositoryPath) => trackedSet.has(repositoryPath));
  if (!applies) return Object.freeze([]);

  const findings: RepositoryAuditFinding[] = [];
  const source = textByPath.get(WORK_TRACKING_CONTRACT_PATH);
  if (source === undefined || source === null) {
    workTrackingFinding(findings, 'work-tracking-contract-missing',
      'SEC work tracking requires one readable machine contract');
    return Object.freeze(findings);
  }

  let contract: WorkTrackingContract;
  try { contract = JSON.parse(source) as WorkTrackingContract; }
  catch (error) {
    workTrackingFinding(findings, 'work-tracking-contract-invalid',
      error instanceof Error ? error.message : String(error));
    return Object.freeze(findings);
  }

  const reports = ['currentMainlineDelivery','activeWorkGroupOrWorkPackage','closedObligations','openObligations','evidence','blockers'];
  const forbidden = ['G-count','U-count','branch-count','commit-count'];
  const valid = contract.schema === 'sec-work-tracking-contract-v1'
    && contract.identities?.G?.meaning === 'root-goal'
    && contract.identities.G.task === false
    && contract.identities.G.githubIssue === false
    && contract.identities.G.progressUnit === false
    && contract.identities?.U?.meaning === 'stable-problem-theme'
    && contract.identities.U.task === false
    && contract.identities.U.githubIssue === false
    && contract.identities.U.progressUnit === false
    && contract.identities.U.allocation === 'monotonic-never-reuse'
    && contract.execution?.mainlineUnit === 'implementation-delivery'
    && contract.execution.coordinationUnit === 'work-group'
    && contract.execution.actionUnit === 'work-package'
    && contract.execution.evidenceUnit === 'revision-bound-evidence'
    && contract.execution.branchRole === 'transport-or-candidate-not-work-identity'
    && contract.execution.commitRole === 'durable-change-evidence-not-progress-unit'
    && contract.progress?.unit === 'activated-deliverable-obligation-closure'
    && reports.every((entry) => contract.progress.mustReport?.includes(entry))
    && forbidden.every((entry) => contract.progress.mustNotUseAsProgress?.includes(entry))
    && contract.githubIssueMapping === 'optional-explicit-mirror-only'
    && contract.duplicatePolicy === 'merge-source-into-existing-U-when-obligation-is-not-independent'
    && Array.isArray(contract.newProblemAdmission)
    && contract.newProblemAdmission.length >= 5;
  if (!valid) {
    workTrackingFinding(findings, 'work-tracking-contract-semantics-invalid',
      'G/U, delivery, Work Package, branch/commit and progress identities are not fail-closed');
    return Object.freeze(findings);
  }

  for (const reference of Object.values(contract.authorities ?? {})) {
    if (typeof reference !== 'string' || reference.length === 0) {
      workTrackingFinding(findings, 'work-tracking-authority-invalid',
        'work tracking authority references must be non-empty repository paths');
      continue;
    }
    const authorityPath = workTrackingAuthorityPath(reference);
    if (!trackedSet.has(authorityPath)) {
      workTrackingFinding(findings, 'work-tracking-authority-missing',
        `work tracking authority is not tracked: ${authorityPath}`, authorityPath);
    }
  }

  const problemIds = new Map<string, string>();
  for (const repositoryPath of WORK_TRACKING_PROBLEM_FILES) {
    const problemSource = textByPath.get(repositoryPath);
    if (problemSource === undefined || problemSource === null) {
      workTrackingFinding(findings, 'work-tracking-problem-registry-unreadable',
        'problem-registry source is not readable at the audited revision', repositoryPath);
      continue;
    }
    for (const match of problemSource.matchAll(/<a id="u(\d{3})"><\/a>/gu)) {
      const id = `U${match[1]}`;
      if (id === 'U000') {
        workTrackingFinding(findings, 'work-tracking-problem-id-invalid',
          'U000 is reserved and cannot identify a problem theme', repositoryPath);
      }
      const prior = problemIds.get(id);
      if (prior !== undefined) {
        workTrackingFinding(findings, 'work-tracking-problem-id-duplicate',
          `${id} is already owned by ${prior}`, repositoryPath);
      } else problemIds.set(id, repositoryPath);
    }
  }

  const frontier = textByPath.get(WORK_TRACKING_FRONTIER_PATH);
  if (frontier === undefined || frontier === null) {
    workTrackingFinding(findings, 'work-tracking-goal-registry-unreadable',
      'root-goal registry is not readable at the audited revision', WORK_TRACKING_FRONTIER_PATH);
  } else {
    const goals = new Set<string>();
    for (const match of frontier.matchAll(/<a id="g(\d{2})"><\/a>\*\*G\1\b/gu)) {
      const id = `G${match[1]}`;
      if (goals.has(id)) {
        workTrackingFinding(findings, 'work-tracking-goal-id-duplicate',
          `${id} is duplicated in the root-goal registry`, WORK_TRACKING_FRONTIER_PATH);
      }
      goals.add(id);
    }
    if (goals.size === 0 || problemIds.size === 0) {
      workTrackingFinding(findings, 'work-tracking-registry-empty',
        'root goals and stable problem themes must both remain addressable');
    }
  }
  return Object.freeze(findings);
}

const WORKFLOW_REPOSITORY_ENTRYPOINT = /\b(?:bun|node|python3?|bash|sh)\s+((?:src|scripts|tools)\/[A-Za-z0-9._/-]+(?:\.(?:ts|tsx|js|mjs|cjs|py|sh))?)/gu;

/**
 * Workflow entrypoints are repository-owned executable references. A source
 * move is incomplete while an authoritative workflow still names the retired
 * path, so audit the reference against the exact tracked revision instead of
 * waiting for CI to fail at runtime.
 */
export function projectWorkflowEntrypointFindings(
  tracked: readonly string[],
  textByPath: ReadonlyMap<string, string | null>
): readonly RepositoryAuditFinding[] {
  const trackedSet = new Set(tracked);
  const findings: RepositoryAuditFinding[] = [];
  for (const workflowPath of tracked.filter((repositoryPath) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(repositoryPath))) {
    const source = textByPath.get(workflowPath);
    if (source === undefined || source === null) continue;
    for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
      for (const match of rawLine.matchAll(WORKFLOW_REPOSITORY_ENTRYPOINT)) {
        const entrypoint = match[1];
        if (entrypoint === undefined || trackedSet.has(entrypoint)) continue;
        pushFinding(findings, {
          code: 'workflow-entrypoint-missing',
          line: index + 1,
          message: `workflow executes untracked repository entrypoint ${entrypoint}`,
          path: workflowPath,
          severity: 'high'
        });
      }
    }
  }
  return Object.freeze(findings);
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
  const pointerPath = 'config/repository/active-work-package.md';
  const rollingPath = 'config/repository/rolling-plan.md';
  if (!tracked.includes(pointerPath) || !tracked.includes(rollingPath)) {
    unknowns.push('config/repository control plane is incomplete');
    return { pointerManifestOnDefault: false };
  }

  const pointer = textByPath.get(pointerPath);
  const rollingPlan = textByPath.get(rollingPath);
  if (pointer === undefined || pointer === null
    || rollingPlan === undefined || rollingPlan === null) {
    unknowns.push('config/repository control plane is not readable as text at the audited revision');
    return { pointerManifestOnDefault: false };
  }
  let manifestPath: string;
  let expectedDigest: string;
  try {
    const parsedPointer = ParseActivePointer(pointer);
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
    rollingPackage = ParseRollingPlan(rollingPlan).activePackageId;
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
  const actualDigest = rawSha256Hex(manifestBytes);
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
  // commit; config/repository/README.md keeps it `conditional` while the pointer selects
  // it. Being present on default is the designed state, not a violation.
  const pointerManifestOnDefault = defaultManifestBytes !== null
    && rawSha256Hex(defaultManifestBytes) === expectedDigest;

  const manifestId = path.posix.basename(manifestPath, '.md');
  if (rollingPackage !== manifestId) {
    pushFinding(findings, {
      code: 'control-plane-rolling-drift',
      message: `rolling plan current package ${rollingPackage ?? '<missing>'} does not match ${manifestId}`,
      path: rollingPath,
      severity: 'high'
    });
  }

  const liveManifests = tracked.filter((file) => /^config\/repository\/work-packages\/[^/]+\.md$/u.test(file));
  try {
    const entries = [];
    for (const packagePath of liveManifests) {
      const candidateBytes = bytesByPath.get(packagePath);
      if (candidateBytes === undefined) {
        throw new Error(`candidate Git bytes are unavailable for ${packagePath}`);
      }
      entries.push({
        path: packagePath,
        candidateBytes,
        defaultBytes: packagePath === manifestPath
          ? null
          : await runGitBytes(session, ['show', `${defaultRef}:${packagePath}`], { allowFailure: true })
      });
    }
    const roadmapSource = textByPath.get('config/repository/work-selection.md');
    const census = ClassifyWorkPackageCensus({
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
        path: 'config/repository/work-packages',
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
      path: 'config/repository/work-packages',
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
  const defaultRefInput = options.defaultRef ?? process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF ?? DEFAULT_REPOSITORY_AUDIT_REF;
  const isExactSha = /^[0-9a-f]{40}$/u.test(defaultRefInput);
  // For exact SHA input, validate it resolves to a commit object. For ref input,
  // use rev-parse --verify <ref> (resolves through symbolic refs).
  const defaultRef = isExactSha ? `${defaultRefInput}^{commit}` : defaultRefInput;
  const findings: RepositoryAuditFinding[] = [];
  const unknowns: string[] = [];
  reportExecutionProgress({ command: 'audit:repository', phase: 'exact-tree-capture', state: 'start' });
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
  const workspaceSnapshot = await acquireExactGitTreeSnapshot({
    session,
    commitSha: head
  });
  const {
    bytesByPath,
    contentCoverage: initialContentCoverage,
    textByPath: initialTextByPath
  } = await revisionTextCandidates(session, entries, workspaceSnapshot.files);
  reportExecutionProgress({
    command: 'audit:repository',
    phase: 'exact-tree-capture',
    state: 'complete',
    detail: { trackedPaths: tracked.length }
  });
  const textByPath = new Map(initialTextByPath);
  const moduleMembership = workspaceSnapshot.moduleMembership;
  if (moduleMembership.descriptors.length === 0) {
    unknowns.push('source program module ownership is unavailable: exact snapshot has no module.json descriptors');
  }
  /*
   * This mode audits the complete immutable repository tree rather than one
   * executable TypeScript project. The Source Program compilation below owns
   * that exact-tree semantic census directly. Constructing a ProjectInput here
   * would build a second TypeScript Program only to derive project/cache
   * identity that this repository-wide audit does not consume. Project-bound
   * paths (typecheck, worktree source-program and supersession evidence) keep
   * their explicit ProjectInput + dependency-generation contract.
   */
  const compilationOperation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() + SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS,
    observePhase: (event) => reportExecutionProgress({
      command: 'audit:repository',
      phase: `source-program.${event.phase}`,
      state: event.state,
      elapsedMs: event.elapsedMs
    })
  });
  reportExecutionProgress({ command: 'audit:repository', phase: 'source-program-compilation', state: 'start' });
  const sourceProgramCompilation = compileRepositorySourceProgramWithCache({
    workspaceSnapshot,
    repositoryRoot,
    operation: compilationOperation,
    cacheAccess: 'read-write'
  });
  const moduleGraph = sourceProgramCompilation.workspaceSnapshot.moduleGraph;
  const sourceProgram = sourceProgramCompilation.model;
  reportExecutionProgress({ command: 'audit:repository', phase: 'test-syntax-filter', state: 'start' });
  const contentCoverage = Object.freeze(initialContentCoverage.map((coverage) => {
    if (coverage.status !== 'scanned' || !isRepositoryTestModulePath(coverage.path)) {
      return coverage;
    }
    const syntax = observeTypeScriptSyntax(
      sourceProgramCompilation.typeScriptCompilation.model,
      coverage.path
    );
    if (syntax.status === 'resolved' && syntax.syntax === 'valid') return coverage;
    textByPath.set(coverage.path, null);
    const reason = syntax.status === 'unresolved'
      ? `test-syntax-unresolved:${syntax.reason}`
      : `test-syntax-unresolved:${syntax.firstDiagnostic ?? 'invalid'}`;
    return coverageResult(
      entries.find(({ path: repositoryPath }) => repositoryPath === coverage.path)!,
      'unknown',
      reason
    );
  }));
  reportExecutionProgress({ command: 'audit:repository', phase: 'test-syntax-filter', state: 'complete' });
  reportExecutionProgress({ command: 'audit:repository', phase: 'declaration-topology', state: 'start' });
  const declarationTopology = compileSourceProgramDeclarationTopology(sourceProgramCompilation);
  reportExecutionProgress({ command: 'audit:repository', phase: 'declaration-topology', state: 'complete' });
  reportExecutionProgress({ command: 'audit:repository', phase: 'module-architecture', state: 'start' });
  const architecture = compileRepositoryModuleArchitectureAdmission(
    moduleGraph,
    workspaceSnapshot.moduleMembership,
    sourceProgram,
    workspaceSnapshot.files
  );
  reportExecutionProgress({ command: 'audit:repository', phase: 'module-architecture', state: 'complete' });
  reportExecutionProgress({ command: 'audit:repository', phase: 'source-program-compilation', state: 'complete' });
  if (repositoryModuleArchitectureShouldBlock(architecture)) {
    pushFinding(findings, {
      code: 'repository-module-architecture-boundary-invalid',
      message: `repository module architecture boundary violations (${architecture.violations.length})`,
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
  const surfaceCounts: Record<RepositorySurfaceKind, number> = {
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

  reportExecutionProgress({ command: 'audit:repository', phase: 'repository-surface-census', state: 'start' });
  for (const repositoryPath of tracked) {
    const compiledSurface = sourceProgramSurfaceByPath.get(repositoryPath);
    const surface = compiledSurface === 'test'
      ? { kind: 'verification-test' as const, skills: [] }
      : compiledSurface === 'production'
        ? { kind: 'product-implementation' as const, skills: [] }
        : classifyRepositorySurface(repositoryPath);
    surfaceCounts[surface.kind] += 1;
    if (repositoryPath.endsWith('.md')) markdown += 1;

    const source = textByPath.get(repositoryPath) ?? null;
    if (source === null) continue;

    const markdownCoverage = resolveMarkdownSkillCoverage(repositoryPath);
    if (markdownCoverage?.kind === 'active-authority'
      || markdownCoverage?.kind === 'agent-projection') {
      activeMarkdown += 1;
    }

    const sourceGovernance = projectRepositorySourceGovernance(repositoryPath, source);
    candidates.push(...sourceGovernance.candidates);
    findings.push(...sourceGovernance.blockingFindings);

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

  for (const skillId of AGENT_SKILL_IDS) {
    const routed = REPOSITORY_HEURISTIC_BEHAVIOR_IDS.filter(
      (behavior) => REPOSITORY_HEURISTIC_ROUTES[behavior].owner === skillId
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

  findings.push(...projectWorkflowEntrypointFindings(tracked, textByPath));
  reportExecutionProgress({ command: 'audit:repository', phase: 'repository-surface-census', state: 'complete' });

  reportExecutionProgress({ command: 'audit:repository', phase: 'control-plane-census', state: 'start' });
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
  reportExecutionProgress({ command: 'audit:repository', phase: 'control-plane-census', state: 'complete' });
  reportExecutionProgress({ command: 'audit:repository', phase: 'final-readback', state: 'start' });
  const finalHead = await runGitText(session, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const finalTree = await runGitText(session, ['rev-parse', '--verify', 'HEAD^{tree}']);
  const finalWorktree = await repositoryWorktreeState(session);
  reportExecutionProgress({ command: 'audit:repository', phase: 'final-readback', state: 'complete' });
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

  findings.sort((left, right) =>
    REPOSITORY_AUDIT_SEVERITY_RANK[left.severity] - REPOSITORY_AUDIT_SEVERITY_RANK[right.severity]
    || (left.path ?? '').localeCompare(right.path ?? '')
    || (left.line ?? 0) - (right.line ?? 0)
    || left.code.localeCompare(right.code));

  return Object.freeze({
    architecture,
    declarationTopology,
    behaviorCandidates: Object.freeze([...candidates]),
    heuristicRoutes: REPOSITORY_HEURISTIC_ROUTES,
    contentCoverage,
    findings: Object.freeze(findings),
    optimizations: Object.freeze([
      '把未覆盖的 Agent 行为交给 heuristic-governance，不在原文件追加孤立指令。',
      '把跨 owner 的架构 finding 交给 architecture-evolution，冻结 authority/contract 后再实现。',
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
      findingClasses: countFindingClasses(findings),
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
      skills: AGENT_SKILL_IDS.length,
      trackedPaths: tracked.length,
      unknowns: unknowns.length
    }),
    surfaces: Object.freeze({ ...surfaceCounts }),
    unknowns: Object.freeze(unknowns.sort())
  });
}

export async function runRepositoryAuditCli(
  args: readonly string[] = process.argv.slice(2),
  execution: Readonly<{ deadlineAtUnixMs?: number }> = {}
): Promise<void> {
  return runRepositoryAuditInput(parseRepositoryAuditCliOptions(args), execution);
}

async function runRepositoryAuditInput(
  input: RepositoryAuditCliOptions,
  execution: Readonly<{ deadlineAtUnixMs?: number }> = {}
): Promise<void> {
  const { diagnostic, full, findings, outputPath, query, failOn } = input;
  if (input.mode === 'module-topology') {
    const result = await compileWorkingTreeModuleTopology(DEFAULT_REPOSITORY_ROOT);
    if (repositoryModuleTopologyShouldFail(result, input.enforce)) process.exitCode = 1;
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
    if (outputPath !== null) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, encoded, 'utf8');
    }
    process.stdout.write(encoded);
    return;
  }

  if (input.mode === 'source-program') {
    const deadline = execution.deadlineAtUnixMs;
    const now = Date.now();
    if (!Number.isSafeInteger(deadline) || (deadline as number) <= now) {
      throw new Error('Working-tree Source Program audit requires one inherited absolute deadline.');
    }
    await runSupervisedWorkingTreeSourceProgramAudit(input, (deadline as number) - now);
    return;
  }

  // Freeze the original precedence before any asynchronous audit work.
  const defaultRef = input.defaultRef
    ?? process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF ?? DEFAULT_REPOSITORY_AUDIT_REF;

  const report = await auditRepository(undefined, { defaultRef });
  if (repositoryAuditShouldFail(report, { diagnostic, failOn })) process.exitCode = 1;
  const findingsEncoded = findings
    ? `${JSON.stringify(projectRepositoryAuditFindingsCli(report), null, 2)}\n`
    : null;
  const fullEncoded = full || outputPath !== null && !findings
    ? `${JSON.stringify(encodeRepositoryAuditFullReport(report), null, 2)}\n`
    : null;
  if (outputPath !== null) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, findingsEncoded ?? fullEncoded!, 'utf8');
  }
  process.stdout.write(query !== null
    ? `${JSON.stringify({
        modelDigest: report.sourceProgram.modelDigest,
        sourceRevision: report.sourceProgram.sourceRevision,
        result: querySourceProgramModel(report.sourceProgram, query)
      }, null, 2)}\n`
    : findings
      ? findingsEncoded!
      : full
        ? fullEncoded!
        : `${JSON.stringify(projectRepositoryAuditCli(report), null, 2)}\n`);
}

export type RepositoryAuditWorkerDiagnosticReason =
  | 'cancelled'
  | 'deadline-exhausted'
  | 'output-budget-exhausted'
  | 'physical-boundary-unavailable'
  | 'physical-boundary-unsettled'
  | 'protocol-invalid'
  | 'process-settlement-unproven';

export type RepositoryAuditWorkerFailureKind =
  | 'process-input-admission'
  | 'process-output-admission'
  | 'process-count-admission'
  | 'process-deadline-admission'
  | 'protocol-admission'
  | 'request-budget-admission'
  | 'retained-boundary-admission'
  | 'transport-settlement'
  | 'unclassified-physical-admission';

export type RepositoryAuditWorkerStage =
  | 'dependency-admission'
  | 'execution-generation'
  | 'executable-admission'
  | 'operation-compilation'
  | 'request-compilation'
  | 'request-encoding'
  | 'request-budget-admission'
  | 'boundary-admission'
  | 'process-execution'
  | 'protocol-readback'
  | 'settlement';

class RepositoryAuditWorkerStageError extends Error {
  readonly stage: RepositoryAuditWorkerStage;

  constructor(stage: RepositoryAuditWorkerStage, cause: unknown) {
    super(`Repository Audit worker failed during ${stage}.`, { cause });
    this.name = 'RepositoryAuditWorkerStageError';
    this.stage = stage;
  }
}

export type RepositoryAuditWorkerDiagnostic = Readonly<{
  kind: 'repository-audit-worker-diagnostic';
  authority: 'none-diagnostic-only';
  status: 'denied';
  reason: RepositoryAuditWorkerDiagnosticReason;
  failureKind: RepositoryAuditWorkerFailureKind;
  protocolErrorCode: RepositoryAuditWorkerProtocolErrorCode | null;
  stage: RepositoryAuditWorkerStage;
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
      loadedImplementation: RepositoryAuditLoadedImplementationObservation;
      resultDigest: `sha256:${string}`;
      resources: ProcessResourceSessionReceipt;
    }>
  | Readonly<{
      status: 'denied';
      diagnostic: RepositoryAuditWorkerDiagnostic;
    }>;

function sourceProgramAuditWorkerEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC'
  };
  for (const key of ['SYSTEMROOT', 'WINDIR'] as const) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return Object.freeze(environment);
}

function compileSourceProgramAuditWorkerOperation(input: Readonly<{
  bunDigest: `sha256:${string}`;
  dependencyGenerationDigest: `sha256:${string}`;
  environment: NodeJS.ProcessEnv;
  implementationDigest: `sha256:${string}`;
  payloadDigest: `sha256:${string}`;
  sealedGenerationDigest: `sha256:${string}`;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  const durationMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(durationMs) || durationMs < 1
      || durationMs > SOURCE_PROGRAM_AUDIT_DEADLINE_MS) {
    throw new Error('Repository audit worker deadline is outside its canonical bound.');
  }
  const contractDigest = sha256({
    operation: SOURCE_PROGRAM_AUDIT_OPERATION,
    process: 'one-retained-bun-worker-with-bounded-stdin',
    cwd: 'one-sealed-source-program-generation',
    childEffects: 'none-pure-operation',
    output: 'one-candidate-stream'
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: SOURCE_PROGRAM_AUDIT_OPERATION,
    intentDigest: sha256({
      bunDigest: input.bunDigest,
      dependencyGenerationDigest: input.dependencyGenerationDigest,
      environment: input.environment,
      implementationDigest: input.implementationDigest,
      payloadDigest: input.payloadDigest,
      sealedGenerationDigest: input.sealedGenerationDigest
    }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES },
      { resource: 'output-bytes', maximum: SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES },
      { resource: 'processes', maximum: 2 }
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
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: SOURCE_PROGRAM_AUDIT_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: sha256({
      provider: 'runtime-state.physical.process-resource-session',
      bunDigest: input.bunDigest,
      implementationDigest: input.implementationDigest,
      sealedGenerationDigest: input.sealedGenerationDigest
    }) as OperationDigest
  })]);
}

export function compileRepositoryAuditWorkerDiagnostic(
  error: unknown,
  resources: ProcessResourceSessionReceipt | null
): RepositoryAuditWorkerDiagnostic {
  const stageError = error instanceof RepositoryAuditWorkerStageError
    ? error
    : error instanceof PhysicalResourceCompositeSettlementError
      ? error.failures.map(({ error: failure }) => failure)
          .find((failure): failure is RepositoryAuditWorkerStageError => (
            failure instanceof RepositoryAuditWorkerStageError
          )) ?? null
      : null;
  const stage = stageError?.stage ?? 'settlement';
  const classifiedError = stageError?.cause ?? error;
  const transport = classifiedError instanceof RetainedCommandTransportError
    ? classifiedError.outcome
    : null;
  const detail = classifiedError instanceof Error ? classifiedError.message : String(classifiedError);
  const protocolErrorCode = classifiedError instanceof RepositoryAuditWorkerProtocolError
    ? classifiedError.code
    : null;
  const failureKind: RepositoryAuditWorkerFailureKind = transport !== null
    ? 'transport-settlement'
    : protocolErrorCode !== null
      ? 'protocol-admission'
    : detail.includes('request exceeds its process input budget')
      ? 'request-budget-admission'
      : detail.includes('input-byte budget') || detail.includes('stdin bound')
        ? 'process-input-admission'
        : detail.includes('output-byte admission')
          ? 'process-output-admission'
          : detail.includes('process budget')
            ? 'process-count-admission'
            : detail.includes('deadline')
              ? 'process-deadline-admission'
              : detail.includes('retained') || detail.includes('boundary')
                ? 'retained-boundary-admission'
                : 'unclassified-physical-admission';
  const settlementProven = transport === null || !transport.started || (
    transport.termination.childCloseObserved
    && transport.termination.streamsDrained
    && transport.termination.treeClosed
  );
  const reason: RepositoryAuditWorkerDiagnosticReason = !settlementProven
    ? 'process-settlement-unproven'
    : protocolErrorCode !== null
      ? 'protocol-invalid'
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
  const diagnosticDetail = error instanceof PhysicalResourceCompositeSettlementError
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
    failureKind,
    protocolErrorCode,
    stage,
    detailDigest: sha256({ detail: diagnosticDetail }) as `sha256:${string}`,
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
  const options = parseRepositoryAuditCliOptions(args, 'source-program');
  if (options.mode !== 'source-program') {
    throw new Error('Supervised Source Program entry requires source-program mode');
  }
  return executeAdmittedWorkingTreeSourceProgramAudit(options, maximumDurationMs);
}

async function executeAdmittedWorkingTreeSourceProgramAudit(
  options: WorkingTreeSourceProgramAuditOptions,
  maximumDurationMs: number
): Promise<RepositoryAuditWorkerExecution> {
  if (!Number.isSafeInteger(maximumDurationMs)
      || maximumDurationMs < 1
      || maximumDurationMs > SOURCE_PROGRAM_AUDIT_DEADLINE_MS) {
    throw new Error('Repository audit worker duration is outside its canonical bound.');
  }
  const deadlineAtUnixMs = Date.now() + maximumDurationMs;
  const settlementReserveMs = Math.max(
    1,
    Math.min(SOURCE_PROGRAM_AUDIT_MAX_SETTLEMENT_RESERVE_MS, Math.floor(maximumDurationMs / 20))
  );
  const workerDeadlineAtUnixMs = deadlineAtUnixMs - settlementReserveMs;
  reportExecutionProgress({
    command: 'audit:source-program', phase: 'preparation', state: 'start'
  });
  const prepared = await prepareWorkingTreeSourceProgramAudit(options, workerDeadlineAtUnixMs);
  reportExecutionProgress({
    command: 'audit:source-program', phase: 'preparation', state: 'complete',
    detail: { cache: prepared.operationInput.projection.cache }
  });
  reportExecutionProgress({
    command: 'audit:source-program', phase: 'worker-closure', state: 'start'
  });
  const producerClosure = compileProducerClosure(
    prepared.producerCompilation,
    Object.freeze({
      capability: 'repository-audit.source-program-operation',
      operation: 'executeRepositoryAuditSourceProgramOperation'
    })
  );
  reportExecutionProgress({
    command: 'audit:source-program', phase: 'worker-closure', state: 'complete',
    detail: { implementationFiles: producerClosure.implementationFiles.length }
  });
  const operationPayload = encodeSourceProgramAuditOperationInput(prepared.operationInput);
  if (operationPayload.byteLength
      > REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes) {
    const projectionFieldBytes = Object.freeze(Object.entries(prepared.operationInput.projection)
      .map(([field, value]) => Object.freeze({
        field,
        bytes: Buffer.byteLength(JSON.stringify(canonicalJson(value)), 'utf8')
      }))
      .sort((left, right) => right.bytes - left.bytes || compareCodeUnits(left.field, right.field)));
    throw new Error(
      `Repository Audit normalized operation exceeds its canonical input budget: ${JSON.stringify(projectionFieldBytes)}`
    );
  }
  const executablePath = path.resolve(process.execPath);
  let executable: RetainedNoFollowOrdinaryFile | null = null;
  let dependency: RetainedCompilerDependencyReadGeneration | null = null;
  let dependencyRetirement: CompilerDependencyReadGenerationRetirementReceipt | null = null;
  let generation: RetainedSealedExecutionTreeGeneration | null = null;
  let generationRetirement: SealedExecutionTreeRetirementReceipt | null = null;
  let session: ProcessResourceSession | null = null;
  let resources: ProcessResourceSessionReceipt | null = null;
  let run: ProcessResourceRunResult | null = null;
  let operation: BoundSemanticOperation | null = null;
  let boundary: RetainedCommandBoundary | null = null;
  let request: RepositoryAuditWorkerRequest | null = null;
  let requestBytes: Uint8Array | null = null;
  let processArgs: readonly string[] | null = null;
  let environment: NodeJS.ProcessEnv | null = null;
  let candidateStream: RepositoryAuditWorkerCandidateStream | null = null;
  let operationResult: SourceProgramAuditOperationResult | null = null;
  let stage: RepositoryAuditWorkerStage = 'dependency-admission';
  let primaryError: unknown;
  try {
    const runtime = await import('../../toolchain/dependencies/runtime.ts');
    const dependencyAuthority = await runtime.observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs: workerDeadlineAtUnixMs },
      DEFAULT_REPOSITORY_ROOT
    );
    if (dependencyAuthority === null) {
      throw new Error('Repository Audit sealed execution requires one dependency generation.');
    }
    dependency = await runtime.retainCompilerDependencyReadGeneration(
      dependencyAuthority,
      { deadlineAtUnixMs: workerDeadlineAtUnixMs }
    );
    if (dependency.generationDigest !== prepared.dependencyGenerationDigest) {
      throw new Error('Repository Audit dependency generation changed after Source Program compilation.');
    }

    stage = 'execution-generation';
    const cacheRoot = resolveRuntimeCacheRoot({
      platform: currentRuntimePlatform(),
      environment: runtimeStateEnvironment(),
      repositoryRoot: DEFAULT_REPOSITORY_ROOT
    });
    const generationParentPath = path.join(
      cacheRoot,
      'repository-audit',
      'execution-generations'
    );
    await mkdir(generationParentPath, { recursive: true });
    const generationFiles = Object.freeze(producerClosure.implementationFiles.map(
      ({ path: repositoryPath, source }) => Object.freeze({
        bytes: Buffer.from(source, 'utf8'),
        path: repositoryPath
      })
    ));
    generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs: workerDeadlineAtUnixMs,
      directoryNamePrefix: 'repository-audit-',
      files: generationFiles,
      generationParent: inspectNoFollowDirectoryChain(
        generationParentPath,
        'Repository Audit execution generation parent'
      ).target,
      links: [{ path: 'node_modules', source: dependency.physicalGeneration }],
      maximumBytes: SOURCE_PROGRAM_AUDIT_IMPLEMENTATION_BUDGET_BYTES,
      maximumEntries: SOURCE_PROGRAM_AUDIT_IMPLEMENTATION_ENTRY_BUDGET
    });

    stage = 'executable-admission';
    executable = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(executablePath), 'Source Program Bun parent'),
      path.basename(executablePath),
      undefined,
      'Source Program Bun executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    stage = 'operation-compilation';
    const implementationDigest = deriveRepositoryAuditImplementationDigest(
      producerClosure,
      generation,
      dependency.generationDigest
    );
    environment = sourceProgramAuditWorkerEnvironment();
    operation = compileSourceProgramAuditWorkerOperation({
      bunDigest: executable.digest().byteDigest,
      dependencyGenerationDigest: dependency.generationDigest,
      environment,
      implementationDigest,
      payloadDigest: rawSha256(operationPayload),
      sealedGenerationDigest: generation.identity.generationDigest,
      deadlineAtUnixMs: workerDeadlineAtUnixMs
    });
    const durationCeiling = operation.plan.execution.aggregateBudgets.find(
      ({ resource }) => resource === 'duration-ms'
    );
    if (durationCeiling === undefined) {
      throw new Error('Repository audit worker operation has no duration resource ceiling.');
    }
    session = openProcessResourceSession({
      operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation,
        requirementId: SOURCE_PROGRAM_AUDIT_REQUIREMENT,
        resourceCeilings: [
          {
            resource: 'duration-ms',
            maximum: durationCeiling.maximum
          },
          { resource: 'input-bytes', maximum: SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES },
          { resource: 'output-bytes', maximum: SOURCE_PROGRAM_AUDIT_STREAM_BUDGET_BYTES },
          { resource: 'processes', maximum: 2 }
        ]
      })
    });
    stage = 'request-compilation';
    request = compileRepositoryAuditWorkerRequest({
      operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      generationDigest: generation.identity.generationDigest,
      entrypointAddress: producerClosure.entrypoint.address,
      implementationDigest,
      dependencyGenerationDigest: dependency.generationDigest,
      subjectDigest: prepared.operationInput.binding.subjectDigest,
      payload: operationPayload
    });
    stage = 'request-encoding';
    requestBytes = encodeRepositoryAuditWorkerRequest(request);
    stage = 'request-budget-admission';
    if (requestBytes.byteLength > SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES) {
      throw new Error('Repository Audit request exceeds its process input budget.');
    }
    stage = 'boundary-admission';
    boundary = issueRetainedCommandBoundary({
      executable,
      workingDirectory: generation.workingDirectory
    });
    processArgs = Object.freeze(['--no-env-file', producerClosure.entrypoint.path]);
    stage = 'process-execution';
    reportExecutionProgress({
      command: 'audit:source-program', phase: 'worker-process', state: 'start'
    });
    run = await session.run(boundary, processArgs, {
      env: environment,
      envMode: 'replace',
      input: requestBytes,
      maxStdinBytes: SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES,
      maxStderrBytes: SOURCE_PROGRAM_AUDIT_STDERR_BUDGET_BYTES,
      maxStdoutBytes: REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumCandidateStreamBytes
    });
    reportExecutionProgress({
      command: 'audit:source-program', phase: 'worker-process', state: 'complete',
      detail: { exitCode: run.result.code, stdoutBytes: run.result.stdout.byteLength }
    });
    stage = 'protocol-readback';
    candidateStream = parseRepositoryAuditWorkerCandidateStream({
      bytes: run.result.stdout,
      eofObserved: true
    }, request, {
      maximumRequestBytes: SOURCE_PROGRAM_AUDIT_INPUT_BUDGET_BYTES,
      maximumResultBytes: REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumCandidateStreamBytes
    });
    operationResult = parseSourceProgramAuditOperationResult(
      candidateStream.payload,
      REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationResultBytes
    );
  } catch (error) {
    primaryError ??= new RepositoryAuditWorkerStageError(stage, error);
  } finally {
    const cleanup: Array<Readonly<{ label: string; settle(): void | Promise<void> }>> = [];
    if (session !== null) {
      const retainedSession = session;
      cleanup.push(Object.freeze({
        label: 'repository audit process resource session',
        settle: () => { resources = retainedSession.close(); }
      }));
    }
    if (generation !== null) {
      const retainedGeneration = generation;
      cleanup.push(Object.freeze({
        label: 'repository audit sealed generation',
        settle: async () => { generationRetirement = await retainedGeneration.retire(); }
      }));
    }
    if (dependency !== null) {
      const retainedDependency = dependency;
      cleanup.push(Object.freeze({
        label: 'repository audit dependency generation',
        settle: async () => { dependencyRetirement = await retainedDependency.retire(); }
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
      await settlePhysicalResourcesAsync({
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
  if (operation === null || boundary === null || request === null || requestBytes === null
      || processArgs === null || environment === null || candidateStream === null
      || operationResult === null || generation === null || generationRetirement === null
      || dependencyRetirement === null) {
    throw new Error('Repository Audit worker settled without its exact implementation closure.');
  }
  assertSealedExecutionTreeRetirementReceipt(generationRetirement, generation);
  const loadedImplementation = joinRepositoryAuditLoadedImplementationObservation({
    operation,
    producerClosure,
    generation,
    generationRetirement,
    dependencyGenerationDigest: prepared.dependencyGenerationDigest,
    dependencyRetirement,
    processRunResult: run,
    processReceipt: resources,
    processBoundary: boundary,
    processArgs,
    processInput: requestBytes,
    processEnvironment: environment,
    processEnvironmentMode: 'replace',
    request,
    candidateStream
  });

  reportExecutionProgress({
    command: 'audit:source-program', phase: 'final-readback', state: 'start'
  });
  await withAuthorityGitReadSession(
    { cwd: DEFAULT_REPOSITORY_ROOT, budget: repositoryAuditGitBudget(deadlineAtUnixMs) },
    async (git) => {
      const finalSnapshot = await acquireWorkingTreeSnapshot({ session: git });
      prepared.producerCompilation.workspaceSnapshot.assertMatches({
        sourceRevision: finalSnapshot.sourceRevision,
        files: finalSnapshot.files,
        moduleMembership: finalSnapshot.moduleMembership
      });
    }
  );
  reportExecutionProgress({
    command: 'audit:source-program', phase: 'final-readback', state: 'complete'
  });
  for (const evidence of prepared.supersessionEvidenceCacheCandidates) {
    await writeSupersessionEvidenceCache(DEFAULT_REPOSITORY_ROOT, evidence);
  }
  if (options.outputPath !== null) {
    if (operationResult.reductionPatch === null) {
      throw new Error('--output requires one reduction mode with at least one ready reduction');
    }
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, operationResult.reductionPatch.patch, 'utf8');
  }
  const stdout = Buffer.from(`${JSON.stringify(operationResult.projection, null, 2)}\n`, 'utf8');
  return Object.freeze({
    status: 'completed',
    code: operationResult.exitCode,
    stdout,
    stderr: '',
    loadedImplementation,
    resultDigest: operationResult.resultDigest,
    resources
  });
}

async function runSupervisedWorkingTreeSourceProgramAudit(
  input: WorkingTreeSourceProgramAuditOptions,
  maximumDurationMs = SOURCE_PROGRAM_AUDIT_DEADLINE_MS
): Promise<void> {
  const execution = await executeAdmittedWorkingTreeSourceProgramAudit(input, maximumDurationMs);
  if (execution.status === 'denied') {
    process.exitCode = 1;
    process.stderr.write(`${JSON.stringify(execution.diagnostic)}\n`);
    return;
  }
  // A successful invocation must not clear a failure already recorded by a
  // caller running several checks in this process.
  if (execution.code !== 0) process.exitCode = execution.code;
  process.stdout.write(execution.stdout);
  process.stderr.write(execution.stderr);
}

if (import.meta.main) {
  const input = parseRepositoryAuditCliOptions(process.argv.slice(2));
  const command = input.mode === 'source-program'
    ? 'audit:source-program'
    : input.mode === 'module-topology'
      ? 'audit:module-topology'
      : 'audit:repository';
  enableExecutionProgress();
  reportExecutionProgress({ command, phase: 'command', state: 'start' });
  try {
    await runRepositoryAuditInput(input, input.mode === 'source-program'
      ? { deadlineAtUnixMs: Date.now() + SOURCE_PROGRAM_AUDIT_DEADLINE_MS }
      : {});
    reportExecutionProgress({
      command,
      phase: 'command',
      state: process.exitCode === undefined || process.exitCode === 0 ? 'complete' : 'failed',
      detail: { exitCode: process.exitCode ?? 0 }
    });
  } catch (error) {
    reportExecutionProgress({ command, phase: 'command', state: 'failed' });
    if (!(error instanceof SourceProgramCompilationInterruptedError)) throw error;
    process.stderr.write(`${JSON.stringify({
      code: error.code,
      phase: error.phase,
      phaseEvents: error.phaseEvents
    })}\n`);
    process.exitCode = 1;
  }
}
