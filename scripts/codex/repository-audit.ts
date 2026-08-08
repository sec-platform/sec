#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

import {
  DELETED_BLOB_MACHINE_MANIFEST_V1,
  INFORMATION_LIFECYCLE_CLAIM_FAMILIES,
  INFORMATION_LIFECYCLE_TRANSITION,
  type InformationLifecycleClaimFamily,
  type InformationLifecycleDisposition
} from '../sec-dev/repository-analysis/repository-information-lifecycle.ts';

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
const INFORMATION_LIFECYCLE_MACHINE_DATA_PATH = 'scripts/sec-dev/repository-analysis/repository-information-lifecycle.json';
const NON_AUTHORITY_BEHAVIOR_PATH = /^(?:docs\/(?:archive|evidence|superpowers)\/)|(?:^|\/)[^/]+\.min\.(?:css|js)$/iu;
const MINIFIED_GENERATED_PATH = /(?:^|\/)[^/]+\.min\.(?:css|js)$/iu;

function isNonAuthorityBehaviorPath(repositoryPath: string): boolean {
  return repositoryPath === INFORMATION_LIFECYCLE_MACHINE_DATA_PATH
    || NON_AUTHORITY_BEHAVIOR_PATH.test(repositoryPath);
}
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
  informationLifecycle: InformationLifecycleReport;
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

// ---------------------------------------------------------------------------
// Information Lifecycle facet (Issue #282 machine closure)
// ---------------------------------------------------------------------------

export type InformationLifecyclePathClass =
  | 'product-source'
  | 'product-contract'
  | 'stable-authority'
  | 'generated-projection'
  | 'machine-control'
  | 'current-evidence'
  | 'test-fixture'
  | 'historical-record'
  | 'vendor-adapter'
  | 'repository-tooling'
  | 'maintainer-overlay-forbidden'
  | 'ephemeral-forbidden'
  | 'unknown';

export type InformationLifecycleRetentionClass =
  | 'keep'
  | 'keep-while-active'
  | 'keep-while-licensed'
  | 'keep-while-generated'
  | 'historical-git-only'
  | 'prune-on-invalidation'
  | 'ephemeral'
  | 'forbidden'
  | 'unresolved';

export interface InformationLifecycleClassProfile {
  owner: string;
  consumer: string;
  retention: InformationLifecycleRetentionClass;
  invalidation: string;
  generatedFrom: string | null;
  provider: string | null;
  privacy: string;
}

export const INFORMATION_LIFECYCLE_CLASS_PROFILES: Readonly<
  Record<InformationLifecyclePathClass, InformationLifecycleClassProfile>
> = Object.freeze({
  'product-source': Object.freeze({
    owner: 'product-implementation-owner',
    consumer: 'compiler/runtime/workbench',
    retention: 'keep',
    invalidation: 'source-owner-change',
    generatedFrom: null,
    provider: null,
    privacy: 'public-source'
  }),
  'product-contract': Object.freeze({
    owner: 'contract-owner',
    consumer: 'compiler/verification/workbench',
    retention: 'keep',
    invalidation: 'contract-change',
    generatedFrom: null,
    provider: null,
    privacy: 'public-contract'
  }),
  'stable-authority': Object.freeze({
    owner: 'canonical-documentation-owner',
    consumer: 'docs-reader/agents',
    retention: 'keep',
    invalidation: 'authority-change',
    generatedFrom: null,
    provider: null,
    privacy: 'public'
  }),
  'generated-projection': Object.freeze({
    owner: 'generator-owner',
    consumer: 'docs-reader',
    retention: 'keep-while-generated',
    invalidation: 'generator-input-change',
    generatedFrom: 'docs/authority.json',
    provider: null,
    privacy: 'public'
  }),
  'machine-control': Object.freeze({
    owner: 'control-plane-owner',
    consumer: 'document-control-plane',
    retention: 'keep-while-active',
    invalidation: 'work-package-switch',
    generatedFrom: null,
    provider: null,
    privacy: 'public'
  }),
  'current-evidence': Object.freeze({
    owner: 'verification-evidence-owner',
    consumer: 'verification/merge-gate',
    retention: 'prune-on-invalidation',
    invalidation: 'evidence-invalidation',
    generatedFrom: null,
    provider: null,
    privacy: 'evidence'
  }),
  'test-fixture': Object.freeze({
    owner: 'test-fixture-owner',
    consumer: 'contract-tests',
    retention: 'keep',
    invalidation: 'fixture-change',
    generatedFrom: null,
    provider: null,
    privacy: 'fixture'
  }),
  'historical-record': Object.freeze({
    owner: 'historical-git-only',
    consumer: 'none-exact-ref-only',
    retention: 'historical-git-only',
    invalidation: 'never-restore',
    generatedFrom: null,
    provider: null,
    privacy: 'historical'
  }),
  'vendor-adapter': Object.freeze({
    owner: 'vendor-third-party',
    consumer: 'runtime',
    retention: 'keep-while-licensed',
    invalidation: 'vendor-upgrade',
    generatedFrom: null,
    provider: 'vendored',
    privacy: 'vendor'
  }),
  'repository-tooling': Object.freeze({
    owner: 'tooling-owner',
    consumer: 'developers/ci',
    retention: 'keep',
    invalidation: 'tooling-change',
    generatedFrom: null,
    provider: null,
    privacy: 'public'
  }),
  'maintainer-overlay-forbidden': Object.freeze({
    owner: 'none',
    consumer: 'none',
    retention: 'forbidden',
    invalidation: 'delete-on-discovery',
    generatedFrom: null,
    provider: null,
    privacy: 'secret'
  }),
  'ephemeral-forbidden': Object.freeze({
    owner: 'none',
    consumer: 'none',
    retention: 'ephemeral',
    invalidation: 'delete-on-discovery',
    generatedFrom: null,
    provider: null,
    privacy: 'local'
  }),
  unknown: Object.freeze({
    owner: 'unresolved',
    consumer: 'unresolved',
    retention: 'unresolved',
    invalidation: 'unresolved',
    generatedFrom: null,
    provider: null,
    privacy: 'unresolved'
  })
});

export const INFORMATION_LIFECYCLE_RETENTION_CLASSES: ReadonlySet<
  InformationLifecycleRetentionClass
> = new Set(Object.values(INFORMATION_LIFECYCLE_CLASS_PROFILES).map((profile) =>
  profile.retention));

export interface InformationLifecycleDeletedBlobRecord {
  kind: 'deleted' | 'renamed';
  oldPath: string;
  oldBlob: string;
  rawDigest: string;
  bytes: number;
  lineCount: number;
  newPath: string | null;
  disposition: InformationLifecycleDisposition;
  documentRole: string;
  claimFamilies: readonly string[];
  currentOwner: string;
  currentReferences: readonly string[];
  consumers: readonly string[];
  reason: string;
}

export interface NexusEprBindingRecord {
  eprId: string;
  requirement: string;
  secOwner: readonly string[];
  mechanism: readonly string[];
  affectedIrEntities: readonly string[];
  positiveAcceptance: string;
  negativeAcceptance: string;
  failureAcceptance: string;
  historicalRegression: string;
  applicableGate: string;
  binding: 'bound' | 'blocked';
  blockingEvidence: string | null;
}

export interface InformationLifecycleReport {
  schema: 'sec-repository-information-lifecycle-v1';
  transition: Readonly<{ old: string; next: string }>;
  controlPlane: Readonly<{ pointerManifestOnDefault: boolean }>;
  gitCrossCheck: 'verified' | 'unavailable';
  deletedBlobs: Readonly<{
    total: number;
    deleted: number;
    renamed: number;
    dispositions: Readonly<Record<InformationLifecycleDisposition, number>>;
    unresolved: number;
    records: readonly InformationLifecycleDeletedBlobRecord[];
  }>;
  trackedPaths: Readonly<{
    total: number;
    byClass: Readonly<Record<InformationLifecyclePathClass, number>>;
    unknown: number;
    records: readonly Readonly<{ path: string; kind: InformationLifecyclePathClass }>[];
  }>;
  claimFamilies: Readonly<{
    total: number;
    withoutOwner: number;
    records: readonly InformationLifecycleClaimFamily[];
  }>;
  nexusLedger: Readonly<{
    sourceRepository: string;
    baselineCommit: string | null;
    baselineTree: string | null;
    trackedPaths: number | null;
    eprExpected: number;
    eprBound: number;
    eprBlocked: number;
    validation: 'passed' | 'failed' | 'not-applicable';
    failures: readonly string[];
  }>;
  detectors: Readonly<{
    total: number;
    findings: number;
    firedCodes: readonly string[];
  }>;
  machineUnresolved: number;
}

export interface InformationLifecycleDispositionRule {
  match: RegExp;
  disposition: Exclude<InformationLifecycleDisposition, 'unresolved'>;
  documentRole: string;
  currentOwner: string;
  currentReferences: readonly string[];
  consumers: readonly string[];
  reason: string;
}

const FIXTURE_DOCUMENTATION_HISTORY_PATH =
  'tests/fixtures/documentation-history/AGENTS.authority-v5.historical.md';
const FIXTURE_WORK_PACKAGE_GATE_MANIFESTS = [
  'tests/fixtures/work-package-gate-manifests/sm3-r1-focused-blocker-repair-v1.md',
  'tests/fixtures/work-package-gate-manifests/sm3-r2-bounded-runtime-gate-v1.md',
  'tests/fixtures/work-package-gate-manifests/sm3-r3-actionable-runtime-gate-v4.md'
] as const;
const NEXUS_CORPUS_CONTRACT_PATH = 'docs/corpus/nexus/contract.md';

export const INFORMATION_LIFECYCLE_DISPOSITION_RULES: readonly InformationLifecycleDispositionRule[] =
  Object.freeze([
    Object.freeze({
      match: /^docs\/archive\/work-packages\/(?:sm3-r1-focused-blocker-repair-v1|sm3-r2-bounded-runtime-gate-v1|sm3-r3-actionable-runtime-gate-v4)\.md$/u,
      disposition: 'migrated-fixture',
      documentRole: 'frozen-work-package-manifest',
      currentOwner: 'test-fixture-owner',
      currentReferences: [...FIXTURE_WORK_PACKAGE_GATE_MANIFESTS],
      consumers: ['work-package-gate-contract-tests'],
      reason: 'exact old/new Git blob identity preserved as test fixture (R100)'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/root\/AGENTS\.historical\.md$/u,
      disposition: 'migrated-fixture',
      documentRole: 'historical-agent-projection',
      currentOwner: 'test-fixture-owner',
      currentReferences: [FIXTURE_DOCUMENTATION_HISTORY_PATH],
      consumers: ['documentation-authority-tests'],
      reason: 'exact old/new Git blob identity preserved as test fixture (R100)'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/governance\/nexus-absorption-and-conformance\.md$/u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'nexus-conformance-corpus-spec',
      currentOwner: 'nexus-corpus-owner',
      currentReferences: [
        NEXUS_CORPUS_CONTRACT_PATH,
        'docs/governance/nexus-absorption-ledger.yaml',
        'docs/external-provider-policy.md'
      ],
      consumers: ['nexus-absorption-ledger', 'external-provider-policy'],
      reason: 'durable EPR/corpus/parity semantics absorbed into the Nexus corpus contract; 29 EPR requirement bindings are machine-bound in this audit and the ledger'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/governance\/external-capability-and-provider-policy\.md$/u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'external-provider-policy-spec',
      currentOwner: 'external-provider-owner',
      currentReferences: ['docs/external-provider-policy.md', 'docs/governance/external-capability-ledger.yaml'],
      consumers: ['external-capability-ledger', 'brownfield', 'compiler-target-ir'],
      reason: 'Phase 0 audit: current policy doc absorbs and strengthens every durable provider mechanism'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/governance\/external-capability-ledger\.yaml$/u,
      disposition: 'migrated-machine-ledger',
      documentRole: 'external-capability-machine-ledger',
      currentOwner: 'external-provider-owner',
      currentReferences: ['docs/governance/external-capability-ledger.yaml'],
      consumers: ['sec-external-capability-governance'],
      reason: 'machine ledger state moved to the current governance ledger'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/governance\/nexus-absorption-ledger\.yaml$/u,
      disposition: 'migrated-machine-ledger',
      documentRole: 'nexus-absorption-machine-ledger',
      currentOwner: 'nexus-corpus-owner',
      currentReferences: ['docs/governance/nexus-absorption-ledger.yaml'],
      consumers: ['docs-doctor', 'repository-audit'],
      reason: 'machine ledger state moved to the current governance ledger (schema v2)'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/governance\/nexus-absorption-report\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'nexus-absorption-report-narrative',
      currentOwner: 'nexus-corpus-owner',
      currentReferences: ['docs/governance/nexus-absorption-ledger.yaml'],
      consumers: [],
      reason: 'report narrative superseded by the machine ledger; exact Git history remains addressable'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/14-Engineering IR与语义事实规范\.md$/u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'engineering-ir-semantic-fact-spec',
      currentOwner: 'semantic-model/delta-impact/mutation/compiler-target-ir owners',
      currentReferences: [
        'docs/semantic-model.md',
        'docs/delta-and-impact.md',
        'docs/semantic-mutation.md',
        'docs/compiler-target-ir.md'
      ],
      consumers: ['compiler', 'verification', 'workbench-ai'],
      reason: 'Phase 0 audit: all 2,068 lines re-reviewed; durable semantics split by domain into current owners plus code/test contracts'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/governance\/agent-skills-and-development-run-kernel\.md$/u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'agent-governance-and-run-kernel-spec',
      currentOwner: 'development-governance owner',
      currentReferences: ['docs/development-governance.md', 'platform/shared/agent-skill-contract.ts'],
      consumers: ['agents-entry', 'sec-heuristic-governance'],
      reason: 'durable agent/skill/run-kernel semantics absorbed into development governance and the agent skill contract'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/architecture\//u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'architecture-spec',
      currentOwner: 'system-architecture owner',
      currentReferences: ['docs/system-architecture.md', 'docs/compiler-target-ir.md', 'docs/brownfield-import.md'],
      consumers: ['compiler-target-ir', 'brownfield', 'system-architecture'],
      reason: 'architecture durable semantics absorbed into current canonical architecture owners'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/goals\//u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'product-goal-spec',
      currentOwner: 'product owner',
      currentReferences: ['docs/product.md', 'docs/roadmap.md'],
      consumers: ['roadmap', 'product'],
      reason: 'product boundary and roadmap semantics absorbed into current product authority'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/00-文档索引与一致性规则\.md$/u,
      disposition: 'superseded-duplicate-authority',
      documentRole: 'superseded-documentation-index',
      currentOwner: 'canonical-documentation-owner',
      currentReferences: ['docs/authority.json', 'docs/README.md'],
      consumers: ['docs-doctor'],
      reason: 'old documentation index superseded by the authority registry and its generated projection'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/0\d-|^docs\/archive\/authority-v5\/1[0-3]-/u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'domain-authority-spec',
      currentOwner: 'canonical-documentation-owner',
      currentReferences: [
        'docs/authority.json',
        'docs/system-architecture.md',
        'docs/compiler-target-ir.md',
        'docs/capability-and-block-model.md',
        'docs/verification-governance.md',
        'docs/change-management.md',
        'docs/workbench-and-ai-operations.md',
        'docs/runtime-and-distribution.md'
      ],
      consumers: ['docs-reader', 'agents'],
      reason: 'numbered authority-v5 specs superseded by the current canonical authority set registered in docs/authority.json'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/test-|^docs\/archive\/authority-v5\/slow-suite-registry\.md$/u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'ci-test-lane-spec',
      currentOwner: 'verification owner',
      currentReferences: [
        'docs/verification-governance.md',
        'platform/shared/ci-verification-plan.ts',
        'platform/shared/test-impact-contract.ts'
      ],
      consumers: ['ci', 'test-impact'],
      reason: 'CI/test lane semantics absorbed into the current verification plan and test impact contracts'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/代码库可视化流程图工具与编译原理综合指南\.md$/u,
      disposition: 'migrated-canonical-authority',
      documentRole: 'visualization-tooling-guide',
      currentOwner: 'workbench-ai owner',
      currentReferences: ['docs/workbench-and-ai-operations.md', 'docs/system-architecture.md'],
      consumers: ['workbench'],
      reason: 'projection/visualization durable claims absorbed into workbench-and-ai operations; tool-specific history stays in Git'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/work\//u,
      disposition: 'historical-git-only',
      documentRole: 'transient-control-plane-history',
      currentOwner: 'control-plane-owner',
      currentReferences: ['docs/work/current-state.yaml', 'docs/work/active-work-package.md', 'docs/work/rolling-plan.md'],
      consumers: [],
      reason: 'transient control-plane snapshots; current state is owned by the live control plane'
    }),
    Object.freeze({
      match: /^docs\/archive\/authority-v5\/root\/README\.md$/u,
      disposition: 'superseded-duplicate-authority',
      documentRole: 'superseded-root-entry',
      currentOwner: 'canonical-documentation-owner',
      currentReferences: ['README.md', 'docs/README.md'],
      consumers: [],
      reason: 'superseded by the current README entry projections'
    }),
    Object.freeze({
      match: /^docs\/archive\/work-packages\/.*\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'completed-work-package-manifest',
      currentOwner: 'work-package-lifecycle owner',
      currentReferences: ['docs/work/README.md'],
      consumers: [],
      reason: 'completed or superseded Work Package manifests; exact commit/path/blob remains addressable in Git history'
    }),
    Object.freeze({
      match: /^docs\/archive\/2026-07-23-.*\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'transient-migration-note',
      currentOwner: 'documentation-governance owner',
      currentReferences: ['docs/work/README.md'],
      consumers: [],
      reason: 'transient migration notes; durable claims absorbed by current owners'
    }),
    Object.freeze({
      match: /^docs\/archive\/用户能力模块化开发-信息抽取台账\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'raw-chat-extraction-ledger',
      currentOwner: 'documentation-governance owner',
      currentReferences: ['docs/authority.json', 'docs/work/README.md'],
      consumers: [],
      reason: 'extraction ledger; every durable claim was independently re-verified and routed during Phase 0'
    }),
    Object.freeze({
      match: /^docs\/archive\/用户能力模块化开发\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'raw-design-conversation',
      currentOwner: 'canonical-documentation-owner',
      currentReferences: [
        'docs/system-architecture.md',
        'docs/capability-and-block-model.md',
        'docs/brownfield-import.md',
        'docs/semantic-model.md',
        'docs/workbench-and-ai-operations.md',
        'docs/runtime-and-distribution.md'
      ],
      consumers: ['architecture'],
      reason: 'all 26,893 lines re-read with truncated ranges backfilled; durable designs absorbed by current owners; industry/product/market claims are historical-git-only'
    }),
    Object.freeze({
      match: /^docs\/evidence\/.*\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'superseded-evidence-narrative',
      currentOwner: 'verification-evidence-owner',
      currentReferences: ['docs/verification-governance.md'],
      consumers: [],
      reason: 'narrative evidence superseded by machine verification artifacts and receipts'
    }),
    Object.freeze({
      match: /^docs\/superpowers\/.*\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'superseded-plan-spec',
      currentOwner: 'documentation-governance owner',
      currentReferences: ['docs/work/README.md'],
      consumers: [],
      reason: 'superseded project plans/specs; current tree forbids narrative Markdown return'
    }),
    Object.freeze({
      match: /^docs\/work-packages\/default-branch-health-repair-v1\.md$/u,
      disposition: 'historical-git-only',
      documentRole: 'completed-work-package-manifest',
      currentOwner: 'work-package-lifecycle owner',
      currentReferences: ['docs/work/README.md'],
      consumers: [],
      reason: 'retired manifest superseded by the branch/ref lifecycle enforcement package (#313)'
    })
  ]);

export function dispositionForDeletedPath(oldPath: string): {
  disposition: InformationLifecycleDisposition;
  documentRole: string;
  currentOwner: string;
  currentReferences: readonly string[];
  consumers: readonly string[];
  reason: string;
} | null {
  for (const rule of INFORMATION_LIFECYCLE_DISPOSITION_RULES) {
    if (rule.match.test(oldPath)) {
      return {
        disposition: rule.disposition,
        documentRole: rule.documentRole,
        currentOwner: rule.currentOwner,
        currentReferences: rule.currentReferences,
        consumers: rule.consumers,
        reason: rule.reason
      };
    }
  }
  return null;
}

export const NEXUS_EPR_BINDINGS_V1: readonly NexusEprBindingRecord[] = Object.freeze([
  Object.freeze({
    eprId: 'EPR-001',
    requirement: '单一事实源：每域一个 canonical owner；alias/cache/projection 只读；迁移路径不形成第二 writer。',
    secOwner: ['docs/semantic-model.md', 'docs/authority.json', 'docs/work/README.md'],
    mechanism: [
      'platform/shared/documentation-authority-contract.ts',
      'platform/shared/workspace-write-lease.ts',
      'scripts/codex/repository-audit.ts'
    ],
    affectedIrEntities: ['documentation.identity', 'semantic.authority', 'semantic.entity'],
    positiveAcceptance: 'registry 对每个 domain 解析出唯一 owner 记录。',
    negativeAcceptance: '重复 owner/路径映射被 parser/audit 拒绝。',
    failureAcceptance: 'registry 缺失或漂移时 docs-doctor 与 repository-audit 均失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/agent-skills-and-development-run-kernel.md',
    applicableGate: 'docs:doctor + repository-audit',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-002',
    requirement: 'Desired/Actual/ACK 与乐观态分离：request/setter 不等于成功；ACK 需要实际 readback/event/processor 证据。',
    secOwner: ['docs/semantic-mutation.md', 'docs/delta-and-impact.md'],
    mechanism: ['platform/compiler/semantic-mutation/', 'tests/contract/semantic-mutation-contract.test.ts', 'tests/contract/semantic-mutation-apply-contract.test.ts'],
    affectedIrEntities: ['semantic.mutation', 'semantic.fact-delta', 'semantic.assertion'],
    positiveAcceptance: 'mutation 只有 publish/readback 后成为 actual 事实。',
    negativeAcceptance: '未授权/未提交的 desired 状态不生效。',
    failureAcceptance: '事务失败回滚并写入 terminal/recovery record。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 6 节',
    applicableGate: 'semantic-mutation contract tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-003',
    requirement: 'ACK 绑定身份、generation 与 revision；late result 不能更新新对象。',
    secOwner: ['docs/semantic-model.md'],
    mechanism: ['platform/compiler/semantic-mutation/transaction-identity.ts', 'platform/compiler/semantic-mutation/mutation-terminal-record.ts', 'tests/unit/canonical-ir-identity-revision.test.ts'],
    affectedIrEntities: ['semantic.entity', 'semantic.revision', 'semantic.assertion'],
    positiveAcceptance: 'ACK 记录携带 scope identity/generation/revision。',
    negativeAcceptance: '旧 generation 的 result 被拒绝。',
    failureAcceptance: '身份漂移在 contract 层抛出结构化失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 7 节',
    applicableGate: 'semantic-mutation + identity-revision tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-004',
    requirement: 'READY 是完整能力屏障：依赖/owner/resource/health 全满足才可用；不把“对象存在”当“能力可用”。',
    secOwner: ['docs/verification-governance.md'],
    mechanism: ['platform/shared/ci-verification-plan.ts', 'scripts/codex/merge-gate.ts'],
    affectedIrEntities: ['verification.gate', 'verification.result', 'verification.environment'],
    positiveAcceptance: '全部 gate 通过后才产生 merge authority。',
    negativeAcceptance: 'skipped/missing/pending/manual-bootstrap-required 不算 PASS。',
    failureAcceptance: 'verification artifact 缺失/过期时 merge gate 失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 8 节',
    applicableGate: 'compiler-pr-validation + sec/merge-gate',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-005',
    requirement: 'Scope 级唯一可写 runtime：明确 lifecycle/lease/consumer；最后 consumer 释放；stale generation 不能写入。',
    secOwner: ['docs/semantic-mutation.md'],
    mechanism: ['platform/shared/workspace-write-lease.ts', 'platform/compiler/semantic-mutation/transaction-identity.ts'],
    affectedIrEntities: ['semantic.mutation', 'semantic.transaction-recovery'],
    positiveAcceptance: 'lease 唯一持有者可以写入 scope。',
    negativeAcceptance: '第二个 writer 被 lease 拒绝。',
    failureAcceptance: 'lease 失效后写入抛出结构化失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 9 节',
    applicableGate: 'semantic-mutation contract tests + repository-audit',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-006',
    requirement: '唯一 writer 与 disposer：Adapter 不能形成第二写路径；resource owner/disposer 明确。',
    secOwner: ['docs/semantic-mutation.md'],
    mechanism: ['platform/shared/workspace-write-lease.ts', 'tests/contract/semantic-mutation-source-adapter-contract.test.ts'],
    affectedIrEntities: ['semantic.source-ownership', 'semantic.mutation'],
    positiveAcceptance: '每字段恰有一个 writer。',
    negativeAcceptance: '第二写路径被 contract 拒绝。',
    failureAcceptance: 'source ownership 冲突在 adapter 层失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 10 节',
    applicableGate: 'semantic-mutation source-adapter tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-007',
    requirement: '按 Capability 选择最小完整策略：不用粗粒度 mode 代替能力选择；用户声明目标不选择内部路线。',
    secOwner: ['docs/capability-and-block-model.md', 'docs/external-provider-policy.md'],
    mechanism: ['docs/governance/external-capability-ledger.yaml', 'docs/scripts/docs-doctor-ledgers.ts'],
    affectedIrEntities: ['capability.block', 'capability.contract', 'provider.adoption'],
    positiveAcceptance: '策略按 capability contract 选择且完整满足。',
    negativeAcceptance: '粗粒度/整页 mode 被政策拒绝。',
    failureAcceptance: '策略不满足 capability contract 时无法通过 ledger 校验。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 11 节',
    applicableGate: 'docs:doctor',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-008',
    requirement: '不可逆资源按需 Admission：昂贵/特权/外部资源只在闭合 gate 下建立；失败恢复旧稳定路径。',
    secOwner: ['docs/semantic-mutation.md'],
    mechanism: ['platform/compiler/semantic-mutation/preflight-semantic-mutation.ts', 'tests/contract/semantic-mutation-contract.test.ts'],
    affectedIrEntities: ['semantic.mutation', 'semantic.transaction-recovery'],
    positiveAcceptance: 'admission gate 通过后才建立资源。',
    negativeAcceptance: '未 admission 的 mutation 被 preflight 拒绝。',
    failureAcceptance: 'admission 失败保留旧路径并返回结构化结果。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 12 节',
    applicableGate: 'semantic-mutation contract tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-009',
    requirement: '规范身份与实际 Activation 分离：canonical identity 只有一条 route；cache selection 不等于 activation。',
    secOwner: ['docs/semantic-model.md'],
    mechanism: ['platform/shared/documentation-authority-contract.ts', 'scripts/codex/repository-audit.ts'],
    affectedIrEntities: ['semantic.entity', 'semantic.identity', 'documentation.identity'],
    positiveAcceptance: 'canonical identity 路由唯一且可解析。',
    negativeAcceptance: '重复/歧义 route 被 registry/audit 拒绝。',
    failureAcceptance: 'identity 不可解析时 registry 校验失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 13 节',
    applicableGate: 'docs:doctor + repository-audit',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-010',
    requirement: '特权和外部动作前置 Admission：不可逆/特权/网络/权限/激活前必须 admit；denied/unsupported 是结构化结果。',
    secOwner: ['docs/external-provider-policy.md', 'docs/semantic-mutation.md'],
    mechanism: ['platform/compiler/semantic-mutation/preflight-semantic-mutation.ts', 'docs/governance/external-capability-ledger.yaml'],
    affectedIrEntities: ['provider.adoption', 'provider.security', 'semantic.mutation'],
    positiveAcceptance: '特权/外部动作在闭合 gate 下执行。',
    negativeAcceptance: '未 admit 的特权动作被拒绝。',
    failureAcceptance: 'denied/unsupported 返回结构化失败而非猜测。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 14 节',
    applicableGate: 'docs:doctor + semantic-mutation preflight tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-011',
    requirement: '读取纯净、观察显式提交：read 不产生 write；observation 成为 authority 必须显式 commit。',
    secOwner: ['docs/delta-and-impact.md'],
    mechanism: ['scripts/codex/repository-audit.ts', 'tests/contract/repository-audit.test.ts', 'tests/contract/fact-delta-contract.test.ts'],
    affectedIrEntities: ['semantic.fact', 'semantic.fact-delta', 'implementation.impact'],
    positiveAcceptance: 'audit 只读 immutable HEAD tree，不产生 write。',
    negativeAcceptance: '观察结果不显式 commit 不算 authority。',
    failureAcceptance: 'HEAD 变化时 audit 标记 unknown 而非静默通过。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 15 节',
    applicableGate: 'repository-audit contract tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-012',
    requirement: '控制事务与失败隔离：串行或有明确并发语义；字段失败隔离；补偿按合同。',
    secOwner: ['docs/semantic-mutation.md'],
    mechanism: ['platform/compiler/semantic-mutation/mutation-recovery-record.ts', 'platform/compiler/semantic-mutation/mutation-terminal-record.ts', 'tests/contract/semantic-mutation-apply-contract.test.ts'],
    affectedIrEntities: ['semantic.transaction-recovery', 'semantic.mutation'],
    positiveAcceptance: '事务原子发布并记录 recovery。',
    negativeAcceptance: '字段失败不吞掉无关成功。',
    failureAcceptance: '事务失败写入 terminal record 并支持恢复。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 16 节',
    applicableGate: 'semantic-mutation apply/recovery tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-013',
    requirement: 'Selection、Restore 与 Observation 分离：fact registry 与 selection engine 分离；restore 不伪装新 selection。',
    secOwner: ['docs/roadmap.md'],
    mechanism: [],
    affectedIrEntities: ['compiler.implementation-resolution', 'semantic.fact'],
    positiveAcceptance: '未定义：SEC 尚无 fact registry/selection engine。',
    negativeAcceptance: '未定义：无机器合同可拒绝错误 selection。',
    failureAcceptance: '未定义：无机器失败路径。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 17 节',
    applicableGate: 'none',
    binding: 'blocked',
    blockingEvidence: 'Implementation Resolution Kernel 未实现：PR #308 仅融合稳定架构（result=implementation-resolution-architecture-specified），Resolver/Provider catalog/TypedInvocation/Binding comparator/Compatibility evaluator/Workbench selector 均未实现；Issue #307 保持开放。docs/roadmap.md 记录该轨道。'
  }),
  Object.freeze({
    eprId: 'EPR-014',
    requirement: '事件先归因再改变状态：区分用户/系统/平台/remote/self-write；归因失败保持 unknown。',
    secOwner: ['docs/semantic-mutation.md'],
    mechanism: ['platform/compiler/semantic-mutation/mutation-terminal-record.ts', 'platform/shared/errors.ts'],
    affectedIrEntities: ['semantic.mutation', 'semantic.assertion'],
    positiveAcceptance: 'mutation record 携带 attempted/delta/impact/verification 归因。',
    negativeAcceptance: '无归因的 mutation 不被接受。',
    failureAcceptance: '归因失败保持 unknown 而非擅自修改。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 18 节',
    applicableGate: 'semantic-mutation contract tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-015',
    requirement: '尊重平台原生生命周期：不模拟旁路真实 activation/event/readback；platform boundary 失败是合法结构化失败。',
    secOwner: ['docs/runtime-and-distribution.md', 'docs/brownfield-import.md'],
    mechanism: ['platform/shared/windows-appcontainer-executor.ts', 'tests/contract/sandbox-architecture-contract.test.ts'],
    affectedIrEntities: ['runtime.environment', 'runtime.host-profile', 'brownfield.typed-invocation'],
    positiveAcceptance: '平台边界使用真实 provider 能力。',
    negativeAcceptance: '模拟旁路被架构拒绝。',
    failureAcceptance: 'platform boundary 失败返回结构化错误。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 19 节',
    applicableGate: 'sandbox-architecture contract tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-016',
    requirement: '快捷操作完整生命周期：ensure/repeat/cancel/feedback 显式；feedback 只由明确 intent 触发。',
    secOwner: ['docs/workbench-and-ai-operations.md'],
    mechanism: [],
    affectedIrEntities: ['workbench.interaction', 'workbench.operation'],
    positiveAcceptance: '未定义：SEC Core 无 workbench Operation 机器合同。',
    negativeAcceptance: '未定义：无机器合同拒绝无 intent feedback。',
    failureAcceptance: '未定义：无机器失败路径。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 20 节',
    applicableGate: 'none',
    binding: 'blocked',
    blockingEvidence: 'SEC Core 没有 workbench UI 产品与 Operation 机器合同；docs/workbench-and-ai-operations.md 是政策 owner；Workbench 单一 Operation 写路径（Issue #288）开放，路由到该 owner。'
  }),
  Object.freeze({
    eprId: 'EPR-017',
    requirement: 'UI 与可访问性受合同治理：text/tooltip/icon/state/accessibility 统一；i18n key 完整；UI 不拥有业务事实。',
    secOwner: ['docs/workbench-and-ai-operations.md'],
    mechanism: [],
    affectedIrEntities: ['workbench.interaction', 'workbench.projection'],
    positiveAcceptance: '未定义：SEC Core 无 UI/a11y 机器合同。',
    negativeAcceptance: '未定义：无机器合同可拒绝 UI 事实所有权。',
    failureAcceptance: '未定义：无机器失败路径。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 21 节',
    applicableGate: 'none',
    binding: 'blocked',
    blockingEvidence: 'SEC Core 无前端 UI 面；Web Frontend Source/Semantic/Backend Support（Issue #222）开放；docs/workbench-and-ai-operations.md 为政策 owner。'
  }),
  Object.freeze({
    eprId: 'EPR-018',
    requirement: '观察只消费已有资源：visualizer/observer 不新建第二 active resource；无 active owner 时零后台工作。',
    secOwner: ['docs/workbench-and-ai-operations.md'],
    mechanism: ['scripts/codex/repository-audit.ts'],
    affectedIrEntities: ['workbench.projection', 'semantic.fact'],
    positiveAcceptance: 'audit 观察复用 immutable HEAD tree，不创建第二资源。',
    negativeAcceptance: '观察路径产生 write 时被 audit 拒绝。',
    failureAcceptance: '无 active owner 时无后台工作（audit 为一次性只读）。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 22 节',
    applicableGate: 'repository-audit contract tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-019',
    requirement: '生命周期变化使旧状态失效：navigation/update/restart/close 使旧 identity/ACK/lease 失效；恢复来自真实证据。',
    secOwner: ['docs/work/README.md'],
    mechanism: ['scripts/codex/repository-audit.ts', 'platform/compiler/semantic-mutation/mutation-recovery-record.ts', 'tests/contract/document-control-plane-lifecycle.test.ts'],
    affectedIrEntities: ['semantic.revision', 'semantic.transaction-recovery', 'control.rolling-plan'],
    positiveAcceptance: 'default branch 变化使旧 candidate 证据失效。',
    negativeAcceptance: 'stale 证据不能通过 gate。',
    failureAcceptance: '失效未检测时 resolver/audit fail closed。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 23 节',
    applicableGate: 'document-control-plane + repository-audit tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-020',
    requirement: '结构化错误：code/message/retryable/phase/causal identity；禁止空 catch/未处理 Promise/泛化 timeout。',
    secOwner: ['docs/verification-governance.md'],
    mechanism: ['platform/shared/errors.ts', 'tests/contract/error-protocol.test.ts'],
    affectedIrEntities: ['verification.result', 'semantic.assertion'],
    positiveAcceptance: '失败携带稳定 code 与结构化 details。',
    negativeAcceptance: '空 catch/未处理 Promise 被 contract 拒绝。',
    failureAcceptance: 'infrastructure 与 product failure 分离。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 24 节',
    applicableGate: 'error-protocol contract tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-021',
    requirement: '边界输入验证：message/sender/URL/origin/path/external bytes 在边界验证；secret 不进 public projection。',
    secOwner: ['docs/external-provider-policy.md'],
    mechanism: ['scripts/codex/work-package-contract.ts', 'platform/shared/repository-path-contract.ts', 'scripts/codex/merge-gate.ts', 'tests/unit/codex-work-package-contract.test.ts'],
    affectedIrEntities: ['provider.security', 'capability.contract', 'verification.environment'],
    positiveAcceptance: '边界输入按 contract 校验。',
    negativeAcceptance: '畸形路径/manifest/URL 被拒绝。',
    failureAcceptance: '未知输入返回结构化失败而非误处理。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 25 节',
    applicableGate: 'work-package-contract + merge-gate tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-022',
    requirement: 'Authenticated Remote 最小披露：remote 默认关闭；认证前不披露状态；session/sequence/generation 防重放。',
    secOwner: ['docs/external-provider-policy.md'],
    mechanism: ['docs/governance/external-capability-ledger.yaml', 'docs/scripts/docs-doctor-ledgers.ts'],
    affectedIrEntities: ['provider.security', 'provider.adoption'],
    positiveAcceptance: 'provider 采用 gate 要求 remote 默认关闭与最小披露。',
    negativeAcceptance: '未认证披露被政策/ledger 拒绝。',
    failureAcceptance: 'policy 违规使 ledger 校验失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 26 节',
    applicableGate: 'docs:doctor',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-023',
    requirement: 'Privacy 与物理数据流一致：optional network 明确 opt-in；signaling/provider metadata/transmitted fields 披露。',
    secOwner: ['docs/external-provider-policy.md'],
    mechanism: ['docs/governance/external-capability-ledger.yaml', 'docs/scripts/docs-doctor-ledgers.ts'],
    affectedIrEntities: ['provider.security', 'provider.privacy', 'provider.adoption'],
    positiveAcceptance: 'provider 采用 gate 要求数据流披露与 opt-in。',
    negativeAcceptance: '未披露数据流被政策/ledger 拒绝。',
    failureAcceptance: 'privacy 违反使 ledger 校验失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 27 节',
    applicableGate: 'docs:doctor',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-024',
    requirement: '性能优化不牺牲正确性：不跳过 identity/READY/validation；每项优化有可重现指标与日期/范围/环境。',
    secOwner: ['docs/roadmap.md'],
    mechanism: ['platform/shared/test-budget-contract.ts', 'tests/contract/benchmark-budget.test.ts', 'tests/contract/slow-suite-resource-budget.test.ts'],
    affectedIrEntities: ['verification.environment', 'verification.result'],
    positiveAcceptance: 'test budget 合同限制慢套件资源。',
    negativeAcceptance: '超预算/无证据优化被拒绝。',
    failureAcceptance: 'budget 违反使 CI 失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 28 节',
    applicableGate: 'benchmark-budget + slow-suite tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-025',
    requirement: '合同纯度与单向依赖：contracts 不导入 runtime 实现；public facade 唯一；禁止跨域 deep import；dependency direction 进规则。',
    secOwner: ['docs/system-architecture.md'],
    mechanism: ['.dependency-cruiser.json', 'tests/contract/contract-freeze.test.ts'],
    affectedIrEntities: ['architecture.layering', 'architecture.single-writer', 'semantic.assertion'],
    positiveAcceptance: 'depcruise gate 验证依赖方向。',
    negativeAcceptance: '跨域 deep import 被依赖图拒绝。',
    failureAcceptance: '合同漂移使 contract-freeze 失败。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 29 节',
    applicableGate: 'depcruise + contract-freeze',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-026',
    requirement: '测试按机制匹配：unit/contract/state/integration/browser/artifact 分别证明不同性质；race 需多次与故障注入。',
    secOwner: ['docs/verification-governance.md'],
    mechanism: ['platform/shared/test-impact-contract.ts', 'platform/shared/ci-pr-risk-selection.ts', 'tests/contract/test-impact.test.ts'],
    affectedIrEntities: ['verification.applicability', 'verification.result'],
    positiveAcceptance: 'test impact 选择与机制匹配的 suite。',
    negativeAcceptance: '错误 suite 替身被 selection 拒绝。',
    failureAcceptance: '影响未解析时 fail closed。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 30 节',
    applicableGate: 'test:affected + test-impact tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-027',
    requirement: '每次变化形成可逆 Closure：contract+implementation+focused tests+owner docs+migration+public projection+rollback。',
    secOwner: ['docs/verification-governance.md'],
    mechanism: ['scripts/codex/merge-gate.ts', 'scripts/codex/branch-lifecycle.ts', 'tests/contract/sec-merge-gate.test.ts', 'tests/unit/branch-closeout-receipt.test.ts'],
    affectedIrEntities: ['verification.merge-authority', 'semantic.transaction-recovery'],
    positiveAcceptance: 'Work Package 带 manifest/acceptance/tests 并 squash merge。',
    negativeAcceptance: '无 manifest 或 scope 越界的 candidate 不能过 gate。',
    failureAcceptance: 'merge 后 readback/closeout receipt 记录结果。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 31 节',
    applicableGate: 'sec/merge-gate + branch closeout',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-028',
    requirement: 'Public Claim 不超过 Evidence：all/zero/guaranteed 等强承诺有明确 scope 与 Gate；public copy 是窄 Projection。',
    secOwner: ['docs/verification-governance.md'],
    mechanism: ['platform/shared/ci-evidence-contract.ts', 'scripts/codex/merge-gate.ts', 'scripts/publish-public.ts', 'tests/contract/verification-result-contract.test.ts'],
    affectedIrEntities: ['verification.claim', 'verification.evidence', 'verification.provenance'],
    positiveAcceptance: 'public 投影只含 Evidence 支撑的 claim。',
    negativeAcceptance: '无证据强承诺被 gate 拒绝。',
    failureAcceptance: 'Evidence 失效使 claim 不能发布。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 32 节',
    applicableGate: 'verification-result + merge-gate tests',
    binding: 'bound',
    blockingEvidence: null
  }),
  Object.freeze({
    eprId: 'EPR-029',
    requirement: 'AI Hook、Git、CI 与 Review 共用质量底线：Hook 是 early feedback 不是 security boundary；actual GitHub check 才是发布证据。',
    secOwner: ['docs/verification-governance.md'],
    mechanism: ['.github/workflows/compiler-pr-validation.yml', 'platform/shared/ci-verification-plan.ts', 'scripts/install-git-hooks.ts', 'scripts/codex/merge-gate.ts'],
    affectedIrEntities: ['verification.gate', 'verification.environment', 'development.roles'],
    positiveAcceptance: 'CI 调用 canonical scripts 并产生 verification artifact。',
    negativeAcceptance: 'workflow YAML 存在不算 CI 执行；missing check 不算 PASS。',
    failureAcceptance: 'actual check 失败使 merge authority 不成立。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 33 节',
    applicableGate: 'compiler-pr-validation + sec/merge-gate',
    binding: 'bound',
    blockingEvidence: null
  })
]);

export function classifyInformationLifecyclePath(repositoryPath: string): InformationLifecyclePathClass {
  if (/^docs\/archive\//u.test(repositoryPath)) return 'historical-record';
  if (/^docs\/superpowers\//u.test(repositoryPath)) return 'historical-record';
  if (/^docs\/evidence\//u.test(repositoryPath)) return 'current-evidence';
  if (/^docs\/work\//u.test(repositoryPath)) return 'machine-control';
  if (/^docs\/work-packages\//u.test(repositoryPath)) return 'machine-control';
  if (/^docs\/governance\/.*\.yaml$/u.test(repositoryPath)) return 'machine-control';
  if (/^docs\/scripts\//u.test(repositoryPath)) return 'repository-tooling';
  if (repositoryPath === 'docs/README.md') return 'generated-projection';
  if (/^docs\//u.test(repositoryPath)) return 'stable-authority';
  if (/^platform\/compiler\//u.test(repositoryPath)) return 'product-source';
  if (/^platform\/shared\//u.test(repositoryPath)) return 'product-contract';
  if (/^platform\/cli\//u.test(repositoryPath)) return 'product-source';
  if (/^platform\/dev-runner\//u.test(repositoryPath)) return 'repository-tooling';
  if (/^platform\//u.test(repositoryPath)) return 'product-source';
  if (/^control\/workbench\/views\/[^/]+\.min\.(?:css|js)$/u.test(repositoryPath)) return 'vendor-adapter';
  if (/^control\//u.test(repositoryPath)) return 'product-source';
  if (/^source\//u.test(repositoryPath)) return 'product-source';
  if (/^tests\/.*(?:fixtures?|snapshots?)/u.test(repositoryPath) && !/\.(?:ts|tsx|js|jsx)$/u.test(repositoryPath)) {
    return 'test-fixture';
  }
  if (/^tests\//u.test(repositoryPath)) return 'repository-tooling';
  if (/^scripts\//u.test(repositoryPath)) return 'repository-tooling';
  if (/^\.githooks\//u.test(repositoryPath)) return 'repository-tooling';
  if (/^\.agents\//u.test(repositoryPath)) return 'repository-tooling';
  if (/^\.github\//u.test(repositoryPath)) return 'repository-tooling';
  if (/^\.codex\//u.test(repositoryPath)) return 'repository-tooling';
  if (/^node_modules\//u.test(repositoryPath)) return 'vendor-adapter';
  if (/^\.shared-deps\//u.test(repositoryPath)) return 'vendor-adapter';
  if (/^\.env/u.test(repositoryPath)) return 'maintainer-overlay-forbidden';
  if (/^(?:\.tmp|report|dist|build|coverage|test-results|playwright-report|\.next|\.cache)\//u.test(repositoryPath)) {
    return 'ephemeral-forbidden';
  }
  if (repositoryPath === 'AGENTS.md' || repositoryPath === 'README.md') return 'stable-authority';
  if (/^\.(?:gitattributes|gitignore|gitmodules|npmrc|bun-version)$/u.test(repositoryPath)) {
    return 'repository-tooling';
  }
  if (
    repositoryPath === 'bun.lock'
    || repositoryPath === 'bunfig.toml'
    || repositoryPath === 'package.json'
    || repositoryPath === 'tsconfig.json'
    || repositoryPath === 'mise.toml'
    || repositoryPath === '.dependency-cruiser.json'
    || repositoryPath === '.editorconfig'
    || repositoryPath === '.prettierrc.json'
  ) return 'repository-tooling';
  return 'unknown';
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
    const behaviorIrrelevant = isNonAuthorityBehaviorPath(entry.path);
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
    isNonAuthorityBehaviorPath(repositoryPath)
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

interface DeletedBlobGitFact {
  oldBlob: string;
  bytes: number;
  lineCount: number;
}

function parseDeletedTransition(
  repositoryRoot: string,
  oldRevision: string,
  nextRevision: string
): Readonly<{
  deletedPaths: readonly string[];
  renamedPaths: Readonly<Record<string, string>>;
}> | null {
  const diffText = runGitText(
    repositoryRoot,
    ['-c', 'core.quotepath=false', 'diff', '--name-status', oldRevision, nextRevision],
    { allowFailure: true }
  );
  if (diffText === null) return null;
  const deletedPaths: string[] = [];
  const renamedPaths: Record<string, string> = {};
  for (const line of diffText.split(/\r?\n/u)) {
    const rename = /^R\d+\t(.+)\t(.+)$/u.exec(line);
    if (rename) {
      renamedPaths[rename[1]!] = rename[2]!;
      continue;
    }
    const deleted = /^D\t(.+)$/u.exec(line);
    if (deleted) deletedPaths.push(deleted[1]!);
  }
  return Object.freeze({
    deletedPaths: Object.freeze(deletedPaths.sort()),
    renamedPaths: Object.freeze(renamedPaths)
  });
}

function revisionBlobMap(
  repositoryRoot: string,
  revision: string
): Readonly<Record<string, string>> | null {
  const raw = runGitBytes(repositoryRoot, [
    'ls-tree', '-r', '-z', '-l', '--full-tree', revision
  ], { allowFailure: true });
  if (raw === null) return null;
  const blobByPath: Record<string, string> = {};
  for (const record of raw.toString('utf8').split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    if (separator < 0) continue;
    const match = /^([0-7]{6}) (blob) ([0-9a-f]{40,64})\s+(?:-|\d+)$/u.exec(record.slice(0, separator));
    if (!match) continue;
    blobByPath[record.slice(separator + 1)] = match[3]!;
  }
  return Object.freeze(blobByPath);
}

function deletedBlobGitFact(
  repositoryRoot: string,
  oldRevision: string,
  oldPath: string
): DeletedBlobGitFact | null {
  const bytes = runGitBytes(repositoryRoot, ['cat-file', 'blob', `${oldRevision}:${oldPath}`], {
    allowFailure: true
  });
  if (bytes === null) return null;
  const blobSha = runGitText(
    repositoryRoot,
    ['rev-parse', '--verify', `${oldRevision}:${oldPath}`],
    { allowFailure: true }
  );
  const lineCount = bytes.length === 0 ? 0 : bytes.toString('utf8').split(/\r?\n/u).length;
  return Object.freeze({
    oldBlob: blobSha ?? 'unavailable',
    bytes: bytes.length,
    lineCount
  });
}

function detectorFinding(
  code: string,
  message: string,
  repositoryPath: string,
  severity: RepositoryAuditSeverity,
  line?: number
): RepositoryAuditFinding {
  return {
    code,
    message,
    path: repositoryPath,
    severity,
    ...(line === undefined ? {} : { line })
  };
}

function informationLifecycleDetectors(
  repositoryRoot: string,
  tracked: readonly string[],
  textByPath: ReadonlyMap<string, string | null>,
  defaultRef: string,
  findings: RepositoryAuditFinding[]
): void {
  const trackedSet = new Set(tracked);
  const isFixturePath = (repositoryPath: string): boolean =>
    /^tests\/.*(?:fixtures?|snapshots?)/u.test(repositoryPath)
    || /^\.agents\//u.test(repositoryPath);
  // tests/** is verification material: pollution samples exercised by the
  // contract tests are focused negative fixtures and must not self-trigger.
  const isVerificationMaterial = (repositoryPath: string): boolean =>
    repositoryPath.startsWith('tests/');
  const isStableAuthorityDoc = (repositoryPath: string): boolean =>
    /^docs\/[^/]+\.md$/u.test(repositoryPath)
    || /^docs\/[^/]+\/[^/]+\.md$/u.test(repositoryPath)
    || repositoryPath === 'AGENTS.md';

  // rawChatArtifacts: transcript markers in tracked documentation.
  const CHAT_TRANSCRIPT_MARKER = /(?:ChatGPT|Claude|Gemini|Copilot)(?:\s*(?:said|says|回答|回复|输出|认为))?\s*[:：]|(?:You said|User said|Assistant said)\s*[:：]/iu;
  for (const repositoryPath of tracked) {
    if (
      !repositoryPath.startsWith('docs/')
      || isFixturePath(repositoryPath)
      || isVerificationMaterial(repositoryPath)
    ) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      if (CHAT_TRANSCRIPT_MARKER.test(line)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-raw-chat-artifact',
          `raw chat transcript marker: ${line.trim()}`,
          repositoryPath,
          'high',
          index + 1
        ));
      }
    }
  }

  // privateConversationUrls: private conversation share URLs anywhere outside fixtures.
  const PRIVATE_CONVERSATION_URL = /(?:https?:\/\/)?(?:chatgpt\.com\/c\/|chat\.openai\.com\/|oai\.chatgpt\.com\/|claude\.ai\/chat\/)/iu;
  for (const repositoryPath of tracked) {
    if (
      isFixturePath(repositoryPath)
      || isVerificationMaterial(repositoryPath)
      || /\.min\.(?:css|js)$/u.test(repositoryPath)
    ) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      if (PRIVATE_CONVERSATION_URL.test(line)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-private-conversation-url',
          `private conversation URL: ${line.trim()}`,
          repositoryPath,
          'high',
          index + 1
        ));
      }
    }
  }

  // trackedEphemeralOutputs: ephemeral output paths that are tracked.
  const EPHEMERAL_OUTPUT_PATH = /(?:^|\/)(?:\.tmp|report|dist|build|coverage|test-results|playwright-report|\.next|\.cache)\/|\.(?:log|tmp)$/iu;
  for (const repositoryPath of tracked) {
    if (EPHEMERAL_OUTPUT_PATH.test(repositoryPath)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-tracked-ephemeral-output',
        'tracked ephemeral output path',
        repositoryPath,
        'high'
      ));
    }
  }

  // absoluteLocalPathsOutsideFixtures: machine-local absolute paths in documentation.
  // docs/evidence/** machine records are pinned by sha256 in gate contracts and
  // legitimately carry physical environment facts (junctionPath etc.); they are
  // classified current-evidence, not pollution.
  const ABSOLUTE_LOCAL_PATH = /(?:\b[A-Za-z]:[\\\/]|\/Users\/|\/home\/|\/mnt\/[a-z]\/)/u;
  for (const repositoryPath of tracked) {
    if (
      !repositoryPath.startsWith('docs/')
      || isFixturePath(repositoryPath)
      || repositoryPath.startsWith('docs/evidence/')
      || isVerificationMaterial(repositoryPath)
    ) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      if (ABSOLUTE_LOCAL_PATH.test(line)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-absolute-local-path',
          `machine-local absolute path in documentation: ${line.trim()}`,
          repositoryPath,
          'high',
          index + 1
        ));
      }
    }
  }

  // placeholderEvidenceIdentities: placeholder identity values in machine ledgers.
  const PLACEHOLDER_IDENTITY = /(?:PLACEHOLDER|<sha(?:256)?>|0{16,}|TODO:?\s+(?:sha|digest|identity)|TBD:?\s+(?:sha|digest|identity))/iu;
  for (const repositoryPath of tracked) {
    if (!/^docs\/governance\/.*\.yaml$/u.test(repositoryPath) && repositoryPath !== 'docs/authority.json') continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      if (PLACEHOLDER_IDENTITY.test(line)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-placeholder-evidence-identity',
          `placeholder identity value: ${line.trim()}`,
          repositoryPath,
          'high',
          index + 1
        ));
      }
    }
  }

  // epochEvidenceTimestampsOutsideFixtures: datetime/epoch evidence in stable authority docs.
  const EPOCH_EVIDENCE_TIMESTAMP = /\b20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\b|\b\d{12,}\b/u;
  for (const repositoryPath of tracked) {
    if (
      !isStableAuthorityDoc(repositoryPath)
      || repositoryPath.startsWith('docs/work/')
      || isVerificationMaterial(repositoryPath)
    ) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '');
    for (const [index, line] of body.split(/\r?\n/u).entries()) {
      if (EPOCH_EVIDENCE_TIMESTAMP.test(line)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-epoch-evidence-timestamp',
          `epoch evidence timestamp in stable authority: ${line.trim()}`,
          repositoryPath,
          'high',
          index + 1
        ));
      }
    }
  }

  // staleAuthorityReferences: old authority paths referenced by stable authority docs.
  const STALE_AUTHORITY_REFERENCE = /(?:docs\/archive\/[^\s`\)\]]+|docs\/(?:0\d|1[0-4])-[^\s`\)\]]+\.md)/u;
  for (const repositoryPath of tracked) {
    if (
      !isStableAuthorityDoc(repositoryPath)
      || repositoryPath.startsWith('docs/work/')
      || isVerificationMaterial(repositoryPath)
    ) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      if (STALE_AUTHORITY_REFERENCE.test(line)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-stale-authority-reference',
          `stale authority path reference: ${line.trim()}`,
          repositoryPath,
          'high',
          index + 1
        ));
      }
    }
  }

  // missingHistoricalSourceReferences: historical fixtures must be exact-ref
  // addressable. Byte-pinned R100 fixtures are addressable through the machine
  // manifest rename map and must not be edited (that would break blob identity);
  // other historical fixtures must carry an exact Git reference in content.
  const EXACT_HISTORICAL_REFERENCE = /(?:blob [0-9a-f]{40}\b|commit [0-9a-f]{40}\b|[0-9a-f]{40}:tests\/fixtures\/|\b2d7187f4\b)/u;
  const manifestRenameTargets = new Set(
    Object.entries(DELETED_BLOB_MACHINE_MANIFEST_V1)
      .filter(([, tuple]) => tuple[0] === 'R')
      .map(([, tuple]) => tuple[5]!)
  );
  for (const repositoryPath of tracked) {
    if (!/^tests\/fixtures\/documentation-history\//u.test(repositoryPath)) continue;
    if (manifestRenameTargets.has(repositoryPath)) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    if (!EXACT_HISTORICAL_REFERENCE.test(source)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-missing-historical-source-reference',
        'historical fixture lacks an exact Git blob/commit reference',
        repositoryPath,
        'high'
      ));
    }
  }

  // archiveCurrentConsumers: current executable code/scripts/workflows consuming removed archive paths.
  // The canonical information-lifecycle machine data and the audit's own detector are
  // intentional exact-reference records/consumers and are excluded. docs/scripts/** is the
  // governance tombstone mechanism that rejects archive/superpowers re-entry.
  const ARCHIVE_PATH_REFERENCE = /docs\/(?:archive|superpowers)\//u;
  for (const repositoryPath of tracked) {
    if (
      !/^(?:scripts|control|\.github)\//u.test(repositoryPath)
      || repositoryPath === 'scripts/codex/repository-audit.ts'
      || repositoryPath === INFORMATION_LIFECYCLE_MACHINE_DATA_PATH
    ) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    if (ARCHIVE_PATH_REFERENCE.test(source)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-archive-current-consumer',
        'current code references removed archive/superpowers paths',
        repositoryPath,
        'high'
      ));
    }
  }

  // duplicateInstructionOwners: instruction files outside the canonical instruction surface.
  const INSTRUCTION_FILE_PATH = /(?:^|\/)(?:AGENTS|CLAUDE)[^/]*\.md$|(?:^|\/)\.[a-z]*rules$/iu;
  for (const repositoryPath of tracked) {
    if (
      repositoryPath === 'AGENTS.md'
      || isFixturePath(repositoryPath)
      || isVerificationMaterial(repositoryPath)
      || /^docs\//u.test(repositoryPath)
      || /^\.agents\//u.test(repositoryPath)
      || /^\.github\//u.test(repositoryPath)
    ) continue;
    if (INSTRUCTION_FILE_PATH.test(repositoryPath)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-duplicate-instruction-owner',
        'instruction file outside the canonical instruction surface',
        repositoryPath,
        'high'
      ));
    }
  }

  // staleProviderProfiles: retired provider tooling referenced by the current provider policy.
  const STALE_PROVIDER_PROFILE = /(?:wheel-first|mihomo|FlClash|ClashX|v2ray|shadowsocks|surge)/iu;
  for (const repositoryPath of tracked) {
    if (repositoryPath !== 'docs/external-provider-policy.md') continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      if (STALE_PROVIDER_PROFILE.test(line)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-stale-provider-profile',
          `stale provider profile reference: ${line.trim()}`,
          repositoryPath,
          'high',
          index + 1
        ));
      }
    }
  }

  // unsafePublisherNetworkPaths: publisher scripts must not force-push or remove broad roots.
  for (const repositoryPath of tracked) {
    if (!/^scripts\/(?:publish-public|build-release)\.ts$/u.test(repositoryPath)) continue;
    const source = textByPath.get(repositoryPath);
    if (source === null || source === undefined) continue;
    if (/git\s+push\s+--force(?!-with-lease)/u.test(source)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-unsafe-publisher-network-path',
        'publisher uses unleased force push',
        repositoryPath,
        'high'
      ));
    }
    if (/rm\s+-rf\s+(?:\/|~(?:\s|$|\\)|\$HOME)/u.test(source)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-unsafe-publisher-network-path',
        'publisher removes a broad root path',
        repositoryPath,
        'high'
      ));
    }
  }

  // meaninglessNewCommitSubjects + ungovernedAiAttributionTrailers: candidate commit hygiene.
  const MEANINGLESS_SUBJECT = /^(?:update|fix|wip|sync|tmp|stuff|xxx|asdf|foo|bar|test|commit|merge|rebase|clean|cleanup|chore|docs|refactor|n\/a|na)\s*$|^.{0,4}$|^[\s\p{P}]+$/iu;
  const UNGOVERNED_AI_TRAILER = /(?:Co-authored-by|Authored-by|Signed-off-by):\s*(?:(?:gpt|copilot|claude|openai|gemini|bard|deepseek|qwen|mistral|llama)[-\w]*\s*<[^>]+>)/iu;
  const commitListing = runGitText(
    repositoryRoot,
    ['log', '--format=%H%x09%s%n%b', `${defaultRef}..HEAD`],
    { allowFailure: true }
  );
  if (commitListing !== null) {
    const commits = commitListing.split(/(?=\b[0-9a-f]{40}\t)/u).filter((entry) => entry.includes('\t'));
    for (const entry of commits) {
      const lines = entry.split(/\r?\n/u).filter(Boolean);
      const subject = lines[0]?.split('\t', 2)[1]?.trim() ?? '';
      if (MEANINGLESS_SUBJECT.test(subject)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-meaningless-commit-subject',
          `meaningless commit subject: ${subject}`,
          '<candidate-commit>',
          'medium'
        ));
      }
      for (const line of lines.slice(1)) {
        if (UNGOVERNED_AI_TRAILER.test(line)) {
          pushFinding(findings, detectorFinding(
            'information-lifecycle-ungoverned-ai-attribution-trailer',
            `ungoverned AI attribution trailer: ${line.trim()}`,
            '<candidate-commit>',
            'high'
          ));
        }
      }
    }
  }

  // unownedCurrentEvidence: narrative evidence/superpowers are forbidden in the
  // current tree. Machine evidence JSON under docs/evidence is current-evidence
  // with consumers (sha256-pinned gate contracts), not narrative.
  for (const repositoryPath of tracked) {
    if (/^docs\/superpowers\//u.test(repositoryPath) || /^docs\/evidence\/.*\.md$/u.test(repositoryPath)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-unowned-current-evidence',
        'current tree tracks narrative evidence/superpowers content',
        repositoryPath,
        'critical'
      ));
    }
  }

  // manualGeneratedProjectionDrift: docs/README.md must carry the generated marker
  // and mention every registry document (docs-doctor owns the byte-exact check).
  const readmeSource = textByPath.get('docs/README.md');
  const registrySource = textByPath.get('docs/authority.json');
  if (readmeSource !== undefined && readmeSource !== null && registrySource !== undefined && registrySource !== null) {
    let registryRecords: readonly { path?: unknown }[] = [];
    try {
      const registry = JSON.parse(registrySource) as { documents?: unknown };
      if (registry && typeof registry === 'object' && Array.isArray(registry.documents)) {
        registryRecords = registry.documents as { path?: unknown }[];
      }
    } catch {
      registryRecords = [];
    }
    if (!/generated-from:\s*docs\/authority\.json/u.test(readmeSource)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-generated-projection-drift',
        'docs/README.md lacks the registry generated-from marker',
        'docs/README.md',
        'high'
      ));
    }
    for (const record of registryRecords) {
      if (typeof record.path !== 'string') continue;
      const projectionToken = record.path.endsWith('.md')
        ? record.path.replace(/^docs\//u, '')
        : record.path;
      if (!readmeSource.includes(projectionToken)) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-generated-projection-drift',
          `docs/README.md projection omits registry document ${record.path}`,
          'docs/README.md',
          'high'
        ));
      }
    }
  }

  // externalTextInstructionPaths: prompt/instruction files outside canonical surfaces.
  const EXTERNAL_INSTRUCTION_PATH = /(?:^|\/)(?:instructions?|prompts?|guidelines?|rules)\.[^/]*$/iu;
  for (const repositoryPath of tracked) {
    if (
      isFixturePath(repositoryPath)
      || isVerificationMaterial(repositoryPath)
      || /^docs\//u.test(repositoryPath)
      || /^\.github\//u.test(repositoryPath)
    ) continue;
    if (EXTERNAL_INSTRUCTION_PATH.test(repositoryPath)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-external-text-instruction-path',
        'external text instruction file outside canonical surfaces',
        repositoryPath,
        'high'
      ));
    }
  }

  // unknownRetentionClasses: every class profile must resolve to a bounded retention class.
  for (const kind of Object.keys(INFORMATION_LIFECYCLE_CLASS_PROFILES) as InformationLifecyclePathClass[]) {
    if (!INFORMATION_LIFECYCLE_RETENTION_CLASSES.has(
      INFORMATION_LIFECYCLE_CLASS_PROFILES[kind].retention
    )) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-unknown-retention-class',
        `class profile ${kind} has an unknown retention class`,
        '<classification-profiles>',
        'critical'
      ));
    }
  }
  void trackedSet;
}

function validateNexusAbsorptionLedger(
  source: string | null | undefined,
  tracked: readonly string[],
  enforceCurrentTreeReferences: boolean,
  findings: RepositoryAuditFinding[]
): Readonly<{
  sourceRepository: string;
  baselineCommit: string | null;
  baselineTree: string | null;
  trackedPaths: number | null;
  eprExpected: number;
  eprBound: number;
  eprBlocked: number;
  validation: 'passed' | 'failed' | 'not-applicable';
  failures: readonly string[];
}> {
  const failures: string[] = [];
  const trackedSet = new Set(tracked);
  const boundCount = NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'bound').length;
  const blockedCount = NEXUS_EPR_BINDINGS_V1.length - boundCount;
  const report = {
    sourceRepository: 'QzCrane/nexus',
    baselineCommit: null as string | null,
    baselineTree: null as string | null,
    trackedPaths: null as number | null,
    eprExpected: NEXUS_EPR_BINDINGS_V1.length,
    eprBound: 0,
    eprBlocked: blockedCount,
    validation: 'failed' as 'passed' | 'failed' | 'not-applicable',
    failures: failures as readonly string[]
  };
  if (source === null || source === undefined) {
    failures.push('Nexus ledger is not readable as text');
    pushFinding(findings, detectorFinding(
      'information-lifecycle-nexus-ledger-unreadable',
      'Nexus absorption ledger is not readable as text',
      'docs/governance/nexus-absorption-ledger.yaml',
      'critical'
    ));
    return Object.freeze(report);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(source) as Record<string, unknown>;
  } catch (error) {
    failures.push(`Nexus ledger YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
    pushFinding(findings, detectorFinding(
      'information-lifecycle-nexus-ledger-invalid',
      failures[0]!,
      'docs/governance/nexus-absorption-ledger.yaml',
      'critical'
    ));
    return Object.freeze(report);
  }
  if (parsed?.schema !== 'sec-nexus-corpus-ledger-v2') {
    failures.push('Nexus ledger schema must be sec-nexus-corpus-ledger-v2');
  }
  const sourceRecord = parsed.source as Record<string, unknown> | undefined;
  const baselineCommit = typeof sourceRecord?.baselineCommit === 'string'
    ? sourceRecord.baselineCommit
    : null;
  const baselineTree = typeof sourceRecord?.baselineTree === 'string'
    ? sourceRecord.baselineTree
    : null;
  const trackedPaths = typeof sourceRecord?.trackedPaths === 'number'
    ? sourceRecord.trackedPaths
    : null;
  const coverage = parsed.coverage as Record<string, unknown> | undefined;
  const eprBindings = coverage?.eprBindings as Record<string, unknown> | undefined;
  const ledgerBound = typeof eprBindings?.bound === 'number' ? eprBindings.bound : -1;
  const ledgerExpected = typeof eprBindings?.expected === 'number' ? eprBindings.expected : -1;
  if (sourceRecord?.repository !== 'QzCrane/nexus') {
    failures.push('Nexus ledger source.repository must be QzCrane/nexus');
  }
  if (baselineCommit === null || !/^[0-9a-f]{40}$/u.test(baselineCommit)) {
    failures.push('Nexus ledger source.baselineCommit must be an exact Git object ID');
  }
  if (baselineTree === null || !/^[0-9a-f]{40}$/u.test(baselineTree)) {
    failures.push('Nexus ledger source.baselineTree must be an exact Git object ID');
  }
  if (trackedPaths === null || trackedPaths <= 0) {
    failures.push('Nexus ledger source.trackedPaths must be a positive integer');
  }
  if (ledgerBound !== boundCount) {
    failures.push(`Nexus ledger eprBindings.bound ${ledgerBound} does not match machine manifest bound ${boundCount}`);
  }
  if (ledgerExpected !== NEXUS_EPR_BINDINGS_V1.length) {
    failures.push(`Nexus ledger eprBindings.expected ${ledgerExpected} does not match machine manifest total ${NEXUS_EPR_BINDINGS_V1.length}`);
  }
  const seenEprIds = new Set<string>();
  for (const entry of NEXUS_EPR_BINDINGS_V1) {
    if (!/^EPR-\d{3}$/u.test(entry.eprId)) {
      failures.push(`${entry.eprId} is not a canonical EPR identifier`);
    }
    if (seenEprIds.has(entry.eprId)) {
      failures.push(`duplicate EPR binding ${entry.eprId}`);
    }
    seenEprIds.add(entry.eprId);
    if (entry.requirement.trim().length === 0) {
      failures.push(`${entry.eprId} requirement must be non-empty`);
    }
    if (entry.binding === 'blocked' && (entry.blockingEvidence === null || entry.blockingEvidence.trim().length === 0)) {
      failures.push(`${entry.eprId} is blocked without blocking evidence`);
    }
    if (entry.binding === 'bound' && entry.mechanism.length === 0) {
      failures.push(`${entry.eprId} is bound without a machine mechanism`);
    }
    for (const reference of [...entry.secOwner, ...entry.mechanism]) {
      if (!enforceCurrentTreeReferences) break;
      const normalized = reference.replace(/\/$/u, '');
      if (!trackedSet.has(normalized) && !tracked.some((repositoryPath) =>
        repositoryPath.startsWith(normalized))) {
        failures.push(`${entry.eprId} references missing current-tree path ${reference}`);
      }
    }
  }
  if (failures.length > 0) {
    pushFinding(findings, detectorFinding(
      'information-lifecycle-nexus-ledger-invalid',
      `Nexus ledger/EPR binding validation failed: ${failures.join('; ')}`,
      'docs/governance/nexus-absorption-ledger.yaml',
      'critical'
    ));
  }
  return Object.freeze({
    sourceRepository: 'QzCrane/nexus',
    baselineCommit,
    baselineTree,
    trackedPaths,
    eprExpected: NEXUS_EPR_BINDINGS_V1.length,
    eprBound: boundCount,
    eprBlocked: blockedCount,
    validation: failures.length === 0 ? 'passed' : 'failed',
    failures: Object.freeze(failures)
  });
}

export async function auditInformationLifecycle(
  repositoryRoot: string,
  tracked: readonly string[],
  defaultRef: string,
  bytesByPath: ReadonlyMap<string, Buffer>,
  textByPath: ReadonlyMap<string, string | null>,
  findings: RepositoryAuditFinding[],
  unknowns: string[],
  pointerManifestOnDefault: boolean
): Promise<InformationLifecycleReport> {
  // --- Deleted-blob machine census -----------------------------------------
  const manifestEntries = Object.entries(DELETED_BLOB_MACHINE_MANIFEST_V1);
  const transition = parseDeletedTransition(
    repositoryRoot,
    INFORMATION_LIFECYCLE_TRANSITION.old,
    INFORMATION_LIFECYCLE_TRANSITION.next
  );
  let gitCrossCheck: 'verified' | 'unavailable' = 'unavailable';
  if (transition !== null) {
    const manifestDeleted = manifestEntries
      .filter(([, tuple]) => tuple[0] === 'D')
      .map(([oldPath]) => oldPath)
      .sort();
    const manifestRenamed = new Map(
      manifestEntries
        .filter(([, tuple]) => tuple[0] === 'R')
        .map(([oldPath, tuple]) => [oldPath, tuple[5]!])
    );
    const diffDeleted = transition.deletedPaths;
    const diffRenamed = Object.keys(transition.renamedPaths).sort();
    const manifestRenamedKeys = [...manifestRenamed.keys()].sort();
    if (
      JSON.stringify(manifestDeleted) !== JSON.stringify(diffDeleted)
      || JSON.stringify(manifestRenamedKeys) !== JSON.stringify(diffRenamed)
      || diffRenamed.some((oldPath) => transition.renamedPaths[oldPath] !== manifestRenamed.get(oldPath))
    ) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-census-manifest-mismatch',
        'deleted-blob machine manifest does not match the exact Git transition',
        '<deleted-blob-census>',
        'critical'
      ));
      unknowns.push('deleted-blob machine manifest mismatch with exact Git transition');
    }
    const oldBlobMap = revisionBlobMap(repositoryRoot, INFORMATION_LIFECYCLE_TRANSITION.old);
    const nextBlobMap = revisionBlobMap(repositoryRoot, INFORMATION_LIFECYCLE_TRANSITION.next);
    if (oldBlobMap !== null && nextBlobMap !== null) {
      let verified = true;
      for (const [oldPath, tuple] of manifestEntries) {
        const liveOldBlob = oldBlobMap[oldPath];
        if (liveOldBlob !== tuple[1]) {
          verified = false;
          pushFinding(findings, detectorFinding(
            'information-lifecycle-census-blob-drift',
            `old blob identity drift for ${oldPath}: manifest=${tuple[1]} git=${liveOldBlob ?? '<missing>'}`,
            oldPath,
            'critical'
          ));
        }
        if (tuple[0] === 'R') {
          const newPath = tuple[5]!;
          if (nextBlobMap[newPath] !== tuple[1]) {
            verified = false;
            pushFinding(findings, detectorFinding(
              'information-lifecycle-census-blob-drift',
              `rename target blob mismatch for ${oldPath} → ${newPath}`,
              oldPath,
              'critical'
            ));
          }
        }
        const fact = deletedBlobGitFact(
          repositoryRoot,
          INFORMATION_LIFECYCLE_TRANSITION.old,
          oldPath
        );
        if (fact !== null) {
          if (fact.bytes !== tuple[3]) {
            verified = false;
            pushFinding(findings, detectorFinding(
              'information-lifecycle-census-blob-drift',
              `old blob byte count drift for ${oldPath}: manifest=${tuple[3]} git=${fact.bytes}`,
              oldPath,
              'critical'
            ));
          }
          if (fact.lineCount !== tuple[4]) {
            verified = false;
            pushFinding(findings, detectorFinding(
              'information-lifecycle-census-blob-drift',
              `old blob line count drift for ${oldPath}: manifest=${tuple[4]} git=${fact.lineCount}`,
              oldPath,
              'critical'
            ));
          }
          if (fact.oldBlob !== 'unavailable') {
            const rawBytes = runGitBytes(
              repositoryRoot,
              ['cat-file', 'blob', fact.oldBlob],
              { allowFailure: true }
            );
            if (rawBytes !== null) {
              const liveDigest = createHash('sha256').update(rawBytes).digest('hex');
              if (liveDigest !== tuple[2]) {
                verified = false;
                pushFinding(findings, detectorFinding(
                  'information-lifecycle-census-blob-drift',
                  `old blob sha256 drift for ${oldPath}`,
                  oldPath,
                  'critical'
                ));
              }
            }
          }
        }
      }
      gitCrossCheck = verified ? 'verified' : 'unavailable';
      if (!verified) {
        unknowns.push('deleted-blob Git identity cross-check failed');
      }
    }
  }

  const dispositions: Record<InformationLifecycleDisposition, number> = {
    'superseded-duplicate-authority': 0,
    'code-owned-contract': 0,
    'test-owned-contract': 0,
    'migrated-canonical-authority': 0,
    'migrated-machine-ledger': 0,
    'migrated-fixture': 0,
    'historical-git-only': 0,
    'extract-required': 0,
    unresolved: 0
  };
  const records: InformationLifecycleDeletedBlobRecord[] = [];
  for (const [oldPath, tuple] of manifestEntries) {
    const rule = dispositionForDeletedPath(oldPath);
    const disposition: InformationLifecycleDisposition = rule?.disposition ?? 'unresolved';
    dispositions[disposition] += 1;
    if (disposition === 'unresolved') {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-unclassified-deleted-blob',
        `deleted blob without machine disposition: ${oldPath}`,
        oldPath,
        'critical'
      ));
      unknowns.push(`unclassified deleted blob: ${oldPath}`);
    }
    records.push(Object.freeze({
      kind: tuple[0] === 'R' ? 'renamed' : 'deleted',
      oldPath,
      oldBlob: tuple[1],
      rawDigest: tuple[2],
      bytes: tuple[3],
      lineCount: tuple[4],
      newPath: tuple[5] ?? null,
      disposition,
      documentRole: rule?.documentRole ?? 'unresolved',
      claimFamilies: rule === null ? [] : INFORMATION_LIFECYCLE_CLAIM_FAMILIES
        .filter((family) => family.disposition === disposition
          || family.currentReferences.some((reference) => oldPath.startsWith(reference)
            || reference.startsWith(oldPath)))
        .map((family) => family.claimId),
      currentOwner: rule?.currentOwner ?? 'unresolved',
      currentReferences: rule?.currentReferences ?? [],
      consumers: rule?.consumers ?? [],
      reason: rule?.reason ?? 'unresolved'
    }));
  }

  // --- Current-tree classification -----------------------------------------
  const byClass: Record<InformationLifecyclePathClass, number> = {
    'product-source': 0,
    'product-contract': 0,
    'stable-authority': 0,
    'generated-projection': 0,
    'machine-control': 0,
    'current-evidence': 0,
    'test-fixture': 0,
    'historical-record': 0,
    'vendor-adapter': 0,
    'repository-tooling': 0,
    'maintainer-overlay-forbidden': 0,
    'ephemeral-forbidden': 0,
    unknown: 0
  };
  const classificationRecords: { path: string; kind: InformationLifecyclePathClass }[] = [];
  for (const repositoryPath of tracked) {
    const kind = classifyInformationLifecyclePath(repositoryPath);
    byClass[kind] += 1;
    classificationRecords.push(Object.freeze({ path: repositoryPath, kind }));
    if (kind === 'unknown') {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-unclassified-tracked-path',
        `tracked path without information-lifecycle class: ${repositoryPath}`,
        repositoryPath,
        'critical'
      ));
      unknowns.push(`unclassified tracked path: ${repositoryPath}`);
    }
  }

  // --- Claim family closure -------------------------------------------------
  const enforceCurrentTreeReferences = tracked.includes('docs/governance/nexus-absorption-ledger.yaml');
  const claimIds = new Set<string>();
  let familiesWithoutOwner = 0;
  for (const family of INFORMATION_LIFECYCLE_CLAIM_FAMILIES) {
    if (claimIds.has(family.claimId)) {
      pushFinding(findings, detectorFinding(
        'information-lifecycle-deleted-claim-without-owner',
        `duplicate claim family id ${family.claimId}`,
        '<claim-families>',
        'critical'
      ));
    }
    claimIds.add(family.claimId);
    if (family.currentOwner.trim().length === 0) {
      familiesWithoutOwner += 1;
      pushFinding(findings, detectorFinding(
        'information-lifecycle-deleted-claim-without-owner',
        `claim family ${family.claimId} has no current owner`,
        '<claim-families>',
        'critical'
      ));
    }
    for (const reference of [...family.currentReferences, ...family.positiveEvidence, ...family.negativeEvidence]) {
      if (!enforceCurrentTreeReferences) break;
      if (reference.length === 0) continue;
      const normalized = reference.replace(/\/$/u, '');
      if (
        !tracked.includes(normalized)
        && !tracked.some((repositoryPath) => repositoryPath.startsWith(normalized))
      ) {
        pushFinding(findings, detectorFinding(
          'information-lifecycle-deleted-claim-without-owner',
          `claim family ${family.claimId} references missing current-tree path ${reference}`,
          '<claim-families>',
          'critical'
        ));
      }
    }
  }

  // --- Detectors -------------------------------------------------------------
  const detectorCountBefore = findings.length;
  informationLifecycleDetectors(repositoryRoot, tracked, textByPath, defaultRef, findings);
  const detectorFindings = findings.slice(detectorCountBefore);

  // --- Nexus ledger ----------------------------------------------------------
  const nexusLedgerPath = 'docs/governance/nexus-absorption-ledger.yaml';
  let nexusLedger: ReturnType<typeof validateNexusAbsorptionLedger>;
  if (!tracked.includes(nexusLedgerPath)) {
    nexusLedger = Object.freeze({
      sourceRepository: 'QzCrane/nexus',
      baselineCommit: null,
      baselineTree: null,
      trackedPaths: null,
      eprExpected: NEXUS_EPR_BINDINGS_V1.length,
      eprBound: NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'bound').length,
      eprBlocked: NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'blocked').length,
      validation: 'not-applicable',
      failures: Object.freeze([])
    });
  } else {
    nexusLedger = validateNexusAbsorptionLedger(
      textByPath.get(nexusLedgerPath),
      tracked,
      enforceCurrentTreeReferences,
      findings
    );
  }

  const machineUnresolved = unknownCount(unknowns, [
    'unclassified deleted blob',
    'unclassified tracked path',
    'deleted-blob machine manifest mismatch',
    'deleted-blob Git identity cross-check failed'
  ]);
  void bytesByPath;

  return Object.freeze({
    schema: 'sec-repository-information-lifecycle-v1',
    transition: INFORMATION_LIFECYCLE_TRANSITION,
    controlPlane: Object.freeze({ pointerManifestOnDefault }),
    gitCrossCheck,
    deletedBlobs: Object.freeze({
      total: records.length,
      deleted: records.filter((record) => record.kind === 'deleted').length,
      renamed: records.filter((record) => record.kind === 'renamed').length,
      dispositions: Object.freeze({ ...dispositions }),
      unresolved: dispositions.unresolved,
      records: Object.freeze(records)
    }),
    trackedPaths: Object.freeze({
      total: tracked.length,
      byClass: Object.freeze({ ...byClass }),
      unknown: byClass.unknown,
      records: Object.freeze(classificationRecords)
    }),
    claimFamilies: Object.freeze({
      total: INFORMATION_LIFECYCLE_CLAIM_FAMILIES.length,
      withoutOwner: familiesWithoutOwner,
      records: INFORMATION_LIFECYCLE_CLAIM_FAMILIES
    }),
    nexusLedger,
    detectors: Object.freeze({
      total: 21,
      findings: detectorFindings.length,
      firedCodes: Object.freeze([...new Set(detectorFindings.map((finding) => finding.code))].sort())
    }),
    machineUnresolved
  });
}

function unknownCount(unknowns: readonly string[], markers: readonly string[]): number {
  return unknowns.filter((unknown) => markers.some((marker) => unknown.includes(marker))).length;
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

  const defaultManifestBytes = runGitBytes(
    repositoryRoot,
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
  if (liveManifests.length !== 1 || liveManifests[0] !== manifestPath) {
    pushFinding(findings, {
      code: 'control-plane-live-manifest-census',
      message: `docs/work-packages must contain only the selected manifest; found ${liveManifests.join(', ') || '<none>'}`,
      path: 'docs/work-packages',
      severity: 'high'
    });
  }
  return { pointerManifestOnDefault };
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

  const controlPlane = await auditControlPlane(
    repositoryRoot,
    tracked,
    head,
    defaultRefInput,
    bytesByPath,
    textByPath,
    findings,
    unknowns
  );
  const informationLifecycle = await auditInformationLifecycle(
    repositoryRoot,
    tracked,
    defaultRefInput,
    bytesByPath,
    textByPath,
    findings,
    unknowns,
    controlPlane.pointerManifestOnDefault
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
    informationLifecycle,
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
