#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

import {
  classifySecRepositorySurface,
  resolveSecMarkdownSkillCoverage,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_BEHAVIOR_IDS,
  SEC_REPOSITORY_BEHAVIOR_ROUTES,
  type SecAgentSkillId,
  type SecRepositorySurfaceKind
} from '../../platform/shared/agent-skill-contract.ts';

const DEFAULT_REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const MAX_TEXT_FILE_BYTES = 2_000_000;
const GIT_BATCH_BYTE_BUDGET = 16 * 1024 * 1024;
const GIT_BATCH_OUTPUT_OVERHEAD = 2 * 1024 * 1024;
const HEURISTIC_MARKER = /(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|优先|默认|触发|停止|回退|重算|fail[- ]?closed|DO NOT MERGE|reload_if|gate_owner|\bmust\b|\bshould\b|\bnever\b|\bdo\s+not\b)/iu;
const AGENT_CONTEXT_MARKER = /(?:\bAgent\b|\bCodex\b|\bWork\s+Package\b|\bTask\s+Envelope\b|\bSkill\b|\bReview\b|\bCI\b|\bGate\b|\bmerge\b|\bbranch\b|\btool\b|工具|文档|验证|仓库|上下文|恢复|分派|权限|\bowner\b|\bauthority\b)/iu;
const STRONG_AGENT_CONTEXT_MARKER = /(?:\bAgent\b|\bCodex\b)/iu;
const NAVIGATION_AGENT_HEADING_MARKER = /(?:\bAgent\b|\bCodex\b)/iu;
const NAVIGATION_AGENT_DIRECTIVE_MARKER = /(?:(?:\bAgent\b|\bCodex\b)[^。；\n]{0,48}(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|优先|默认|触发|停止|回退|\bmust\b|\bshould\b|\bnever\b|\bdo\s+not\b)|(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|\bmust\b|\bshould\b|\bnever\b|\bdo\s+not\b)[^。；\n]{0,48}(?:\bAgent\b|\bCodex\b)|\b(?:Agent|Codex)\s+(?:rules?|instructions?)\b)/iu;
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
  behaviorRoutes: typeof SEC_REPOSITORY_BEHAVIOR_ROUTES;
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
  schema: 'sec-repository-audit-v2';
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

// ---------------------------------------------------------------------------
// Information Lifecycle facet (Issue #282 machine closure)
// ---------------------------------------------------------------------------

export const INFORMATION_LIFECYCLE_TRANSITION = Object.freeze({
  old: '2d7187f4fc16301e25a142bdd62340d9670a4a9f',
  next: '6cbe65d86a985678a123d466149be6fad990100d'
} as const);

export type InformationLifecycleDisposition =
  | 'superseded-duplicate-authority'
  | 'code-owned-contract'
  | 'test-owned-contract'
  | 'migrated-canonical-authority'
  | 'migrated-machine-ledger'
  | 'migrated-fixture'
  | 'historical-git-only'
  | 'extract-required'
  | 'unresolved';

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

/**
 * Exact machine manifest of every blob removed or renamed by PR #284
 * (`2d7187f4... → 6cbe65d8...`). Each tuple is
 * `[kind, oldBlob, rawDigest, bytes, lineCount, newPath?]`; rawDigest is the
 * SHA-256 of the raw Git blob bytes. The audit cross-checks this manifest
 * against the exact Git transition whenever the objects are available.
 */
export const DELETED_BLOB_MACHINE_MANIFEST_V1: Readonly<Record<string, readonly [
  kind: 'D' | 'R',
  oldBlob: string,
  rawDigest: string,
  bytes: number,
  lineCount: number,
  newPath?: string
]>> = Object.freeze({
  'docs/archive/2026-07-23-document-system-v4-migration-note.md': ['D', '415e9a23d4a61e1be60d165d8e888b89d3243432', '00bb27a77e5dbb57152ee15f5ce05868b5d95e9dbc0b95c98e890d74303f30b6', 5437, 74],
  'docs/archive/2026-07-23-test-feedback-and-ci-evidence-history.md': ['D', 'f9dca48a0f155f09aa7a2cff6ed3582fbca42bb3', '935945597e2430183b946d3225be2b2a5c2f2cd0f05d0ac44dac0e4dc12f6466', 69504, 477],
  'docs/archive/authority-v5/00-文档索引与一致性规则.md': ['D', '622aae24e6b3a517d82c2928b7cde957ddf139b6', '9520df15b8eeb833b16db450836f66bb52b12662c8d282cb11e055c7e1f0322b', 11330, 137],
  'docs/archive/authority-v5/01-用户能力模块化开发-主题整理稿.md': ['D', 'a673153faa0cef2f193776abb2e44055c96a603f', 'cd4df885825d741ca7eb30432c4e03d47894cae39f06349a01055a019828972d', 4742, 123],
  'docs/archive/authority-v5/02-工程编译器-MVP-PRD与架构稿.md': ['D', '40dc3547e34516ac47b107189bf9450df7bc52b4', 'f2e60cdd6d891fd41862c9a3ef59504e33a131c0283a146aa7b6c57f881432ce', 9603, 200],
  'docs/archive/authority-v5/03-MVP实施计划与路线图.md': ['D', 'c6a2fe3c1a02a64b09275707891f3306e28f59d5', '78175d40a55863ceadf8bdc9468541efaf49129694c52c05c5f3c88b1e200ad2', 8386, 190],
  'docs/archive/authority-v5/04-AI自主实现执行蓝图.md': ['D', '49b8424bac8deb236faceb0e6ffbb765bae2d7bd', '18bc25c78c8523f39ce73eeef35f6e632c7d76596e491ca37ca05230a79b8b90', 10003, 163],
  'docs/archive/authority-v5/05-编译器核心实现规格.md': ['D', 'dc43d5715f22c5e3dc94e6c88d97e41119d02e9c', 'bac9fc184f8ac6f6053df0788790d25755bcaeb81793be60d2a11f3e5551fa62', 13088, 198],
  'docs/archive/authority-v5/06-Registry与Block协议规范.md': ['D', '7fa3a2158fe6b3f151a6b254cc35512d75ac8e10', '9e5a42aba47f77d516bfb945f0172b4a2dbfdfc3d8add8592b166e0819c56cf0', 10649, 348],
  'docs/archive/authority-v5/07-Pass状态机、错误码与恢复机制.md': ['D', '1b1d6ab397b83262ac5b8da00d84a32dc605f641', '2a69349fd0da7f586ebb6f2c4acafe2980effc00bce41324ef4835fdfc0e4b40', 5724, 141],
  'docs/archive/authority-v5/08-Verification、Provenance与Graph规范.md': ['D', '6eb1bfadb3b6e1a673befd4253b83358f445b6a4', 'b7fe813dd3e09e217682451d44701c6b39c2cd41342e1af03c11ad53f4e6166b', 12872, 258],
  'docs/archive/authority-v5/09-AI Runtime、任务信封与治理规范.md': ['D', '6bfc24f050f5324e7e901765e18c83825b2e026a', '59d77417b964843f10ecded90a3ff39e0c5d9b2979a41be923c8ab83e26d1a08', 7139, 246],
  'docs/archive/authority-v5/10-升级迁移与Override规范.md': ['D', 'eb6ba5a9bcc56eca9f81234b81f9587990cbd06f', 'ef012a2f2adb4dccd366f16ba1bdd719df7a318eed92472c8225eca1ca3f6c70', 4794, 178],
  'docs/archive/authority-v5/11-Workbench与可视化规范.md': ['D', '281b032407d3a98238fad25c1583ad764b60bb06', '4f5a5b84db1ec6799d6de3191f12242460cd84abee6cd1fe1a22754841b564ba', 12759, 297],
  'docs/archive/authority-v5/12-编译管道与行为流图示.md': ['D', '73afaa01c9c922d00e78bf172b4dd0fa20baeb4c', '7c8d150cfbdee0d0482210405ec059cfe6e29cfba3f4cfe2b948ad543b9861fe', 4503, 152],
  'docs/archive/authority-v5/13-独立工具分发与打包规划.md': ['D', 'd85c8fcb04f198bb1c6ec15183d3679b4dfc041c', 'affd810db45e32836a06d5cc84ad32813ee51a50dbbff43ccc86c77c03391b28', 13537, 164],
  'docs/archive/authority-v5/14-Engineering IR与语义事实规范.md': ['D', '697f766c90ba837080f3fee5ad3dc0b234983d5c', 'd258f2290d35bd1afa4cd3e325211745883a5400a776f2173f46c9ea5138e0d4', 122253, 2069],
  'docs/archive/authority-v5/architecture/brownfield-import.md': ['D', '2a7230a89c907ba2f875a1e3fdb030e08315b19a', 'a7aca636e926416b4b25699f0ee50143d2cb17a853501957e51477a3e506c594', 7435, 131],
  'docs/archive/authority-v5/architecture/engineering-workspace-ir.md': ['D', 'd4908ae32a09d95a2874ea430ef18e814db0ddcf', '27dc9f0da7a8fac39c81d62322515e8bdbf73fbc506165bf2cac73926133686a', 14479, 203],
  'docs/archive/authority-v5/architecture/sec-ts-ir-layers.md': ['D', '7e849058ceeb85fbd6319d76dde055a67f88e9f3', '8376ec673f969a6c2e54cfe677a1a3ce702bcaaf56ec9a48521fc5aac9d005b3', 12905, 214],
  'docs/archive/authority-v5/goals/SEC-Engineering-Workspace-Compiler.md': ['D', 'b486c78d55c160bc4e18f2b7c71b2f57cf441bbe', '3cf6c4c5525aef44b7888bc9df98fb5dcde7f06cc65d3ee1fdb552a14a25ae9b', 4316, 56],
  'docs/archive/authority-v5/governance/agent-skills-and-development-run-kernel.md': ['D', 'd788a25b71983a11ad51d7de516143b0de2cfe09', 'e41a13c50a3e065b27ea0cc09693f62f7fd9af3f2b211b7435fdd384915d1589', 8984, 201],
  'docs/archive/authority-v5/governance/external-capability-and-provider-policy.md': ['D', '0565aae8e909b2342dbd0a8254621e835308d3ac', 'da38d8c2e71304425bc8d5515d234f1c16847f81e2b332c8a686f8b40f0ac867', 17482, 605],
  'docs/archive/authority-v5/governance/external-capability-ledger.yaml': ['D', 'b698b9098633d58a0815b1aa0c73f7457374fe2f', '48402ecc592f01bd860fec1d1aef32f7d8c4680b094227cc44a137c715eae893', 11134, 387],
  'docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md': ['D', '87173796a83ae361d27a1121f4c6fdbdc794da76', 'b61a1d1a39d9bceb348119ae2f16411ff65f2d313e99a70b3b9213de9c0b1980', 28166, 944],
  'docs/archive/authority-v5/governance/nexus-absorption-ledger.yaml': ['D', '1fdafeb3c1385252f485b1e79a6baa4de2718b16', 'a98a7f13e28179e6a2e6f77a027afe9bb419aea67d2337b0a54b756177d80814', 9054, 246],
  'docs/archive/authority-v5/governance/nexus-absorption-report.md': ['D', 'e166b45061a1632c595868e0a171df6f06fb7928', '601cec3735985cf1d2258bb11debd9fd43af6761e05a4721d093f2733eda9692', 5290, 72],
  'docs/archive/authority-v5/root/README.md': ['D', '9247dfe17f2bfeceaec40b9b9c0a2a0de5423f3d', 'e6074613776d54d03fd6853cbab85d14c6e1340758ba2a7e29ae46bc3278da81', 6025, 123],
  'docs/archive/authority-v5/slow-suite-registry.md': ['D', '8fb5527ae47ae27c6b510e372002be218c557287', '194f294bee9cd5c7000c4ef1cec287d183bb886603525443bf13f2f86ea69116', 2118, 61],
  'docs/archive/authority-v5/test-and-package-architecture.md': ['D', 'e05343f35af170aa8a2ea30a9846aca5f4aef9ea', '2facb51891b2064d762f7b9aad051623fdca7b0843b0f391b49d10011068aa06', 927, 21],
  'docs/archive/authority-v5/test-architecture.md': ['D', 'e53a97936a1bed682a163c384a108d62519f3801', 'd37e8185ef08fa473d70ce5efd5d29dc479907fd90b4849b271dcdf94f3fe822', 14521, 170],
  'docs/archive/authority-v5/test-feedback-and-ci-lanes.md': ['D', 'e2caa0a9cc84f5c926a484030053490a627ffec3', '666cc8b820f709f1f2b04a6624a1c7ca347c03ce243b189a371a89ad7bda6817', 21684, 222],
  'docs/archive/authority-v5/work/README.md': ['D', '080949931f9053a938376100652f3e972bd34bb8', 'a83f10fc5c54b95f71d9514f648e5d250ce78525d13b308648f954e4b6bdc8b5', 457, 12],
  'docs/archive/authority-v5/work/active-work-package.md': ['D', '9997d4f32ea01ff43e247dbbf78d42334aa075af', '1ca2e6fce33fb88bdb249563548fda1ec5fbecec59d3b7dfd9e5f26d645b6eb3', 1008, 23],
  'docs/archive/authority-v5/work/current-state.yaml': ['D', '11f59f43ce87f19a3bc56ad271a0e076b61dd756', '59262c6cca8ff1cf7d28cc60c3629c0748d389ae2823fc3d5bf9bb9f19332f4a', 1165, 32],
  'docs/archive/authority-v5/work/rolling-plan.md': ['D', '0bd08088b7b87ee59fcbd2a8471725267cf84c2b', '1aaa52bc7d127afe4255e31cf10f97de0167e460c952db02c05be2f0ea4e8917', 4834, 59],
  'docs/archive/authority-v5/代码库可视化流程图工具与编译原理综合指南.md': ['D', '5356f9cf7fd78409f527437f651823e9a1db922d', '0e8398ff91e6ddc920d17cefe2778e5f622f110db0962eb415c69f9d6126ab39', 4912, 143],
  'docs/archive/work-packages/active-documentation-corpus-v1.md': ['D', '7afb396f0a39bcf013817808fcf2e3a7b30e9a04', '30ef0ce29e00a692130b47a32887368c92550bb0d593964c26992151a5417e10', 10242, 132],
  'docs/archive/work-packages/affected-fast-timeout-contract-v1.md': ['D', 'fd6aa812067f5792b7de82fd735e8a0b93e25329', '1084f3bd9df2a0ad94899f7cf86bca80b78dda0d8e0f0deaf10d95d6344693b8', 12658, 127],
  'docs/archive/work-packages/affected-selection-trust-boundary-v1.md': ['D', '28a189efc36a14b27ec55ad474982599e0ae1833', '3ed5cd46e4433d7bd2b9ffbea1e4ba74ae5c3c30ec327bc086a316d8c92ab87d', 8037, 129],
  'docs/archive/work-packages/agent-skills-and-v19-alignment-v2.md': ['D', 'fe52be2b5ab8daee23b454e31268a78f5d72bfc7', 'a871d7e210d0bd7ca058a04209e184585d26e2826338b32a5d7ca98f72cb85ce', 5142, 78],
  'docs/archive/work-packages/b0-bootstrap-v1.md': ['D', 'bca0d4d6121f066831bfaeecd9811d5203db1b1e', '8f43e54f3fca89820067e441e20dc7487bbc824106e443c95d8c12c39e2fd657', 4566, 78],
  'docs/archive/work-packages/b1-draft-revalidation-v1.md': ['D', '7eeb89f220cc87b215d6ef5815f771fc3bcf3f12', 'dd233831bb20431ee1e9471823f720be825e9d50d6149326edcd6ed0b0589019', 3822, 69],
  'docs/archive/work-packages/b2-sm3-verifier-bootstrap-v1.md': ['D', '49c41d734a13aeb267a609ef8f176451114261e2', 'f75037779c60be881a9fb494179a6bd97d552469d2f2077150f8d5fc54a10ccf', 4989, 76],
  'docs/archive/work-packages/b3-active-documentation-bootstrap-v1.md': ['D', '79ffe8ec52a99af05d0a997be68e4d476a81f31d', '013ecff5ccd85e9f6552a03d9882a18a07598a577bbd26d444a0e0c1145a6767', 15997, 118],
  'docs/archive/work-packages/branch-ref-lifecycle-v1.md': ['D', '1048933c02bb8da3b66edcda4e92aac3bc808c53', 'cccc57b7e6d4e86cc059ec087d1cb75bc0695666e085f2a636d5b3223e5a5a97', 5498, 100],
  'docs/archive/work-packages/bun-1-3-14-toolchain-migration-v1.md': ['D', 'e17b44542d3aad4539c014462dc5e745436f77b9', '226eeaf59aca24526fd024030c1720ea6b850df55510c50d21f68936df77d53c', 2834, 51],
  'docs/archive/work-packages/canonical-architecture-convergence-v1.md': ['D', '86b77e6c6f782d4d89778ddea878fe8f1c62a7d8', '878ec1c02d44b4c496f828bc4ef4aaabf35cdbf412fdb3a9c4942190e1d7657d', 5952, 119],
  'docs/archive/work-packages/canonical-text-bytes-phase-a-v1.md': ['D', '71efc62bc549bc2a84af137868a1cc12b493dffd', '2182efcfba960601e5d8472f86d3543095c5d8da76bf4b6adc3e24840338c1a2', 7586, 121],
  'docs/archive/work-packages/ci-artifact-timestamp-adapter-v1.md': ['D', 'df76dc6ab4fc41372689068a56d772d4ceeb0e7a', '0c931a3f64cd66d97cc6f9cd6cb16eb00a497c04d76fe973ddb816eb6cf8c9fb', 3383, 51],
  'docs/archive/work-packages/ci-linux-reference-sentinels-v1.md': ['D', '0dc3db32e4ae917e3eacd14606771d13a84a6a81', 'dba0ba664d9c506dd97d7c1e7af266376307878f4aa7ba003f4861d25ec436a1', 3696, 49],
  'docs/archive/work-packages/ci-sm3-p0-contract-transition-v1.md': ['D', 'da1de6b26f1e752f6487f105a30cbaa6f1062030', '2faba7f61a02484799b5ec5de87425466a9795c86639eeb7271c07b1b7c19bd8', 3246, 51],
  'docs/archive/work-packages/ci-sm3-p0-runtime-portability-transition-v1.md': ['D', 'ce16a1ce0211b034f7829b51c6c40ace8868e49a', '93364b3ceaeea0627f190f8716b84a8ca9585c2dfc5c50f251dbaaf10b08a107', 4923, 54],
  'docs/archive/work-packages/ci-speed-optimization-v1.md': ['D', 'e9ab8160fd8e37bc9a32d73c01f591cd1be6333b', '926b636f1af4dcd1a654df8a8ecba5c8b3abd76cc93f2b847ed124d648a9ad9c', 4503, 94],
  'docs/archive/work-packages/ci-v7-changed-imports-gate-v1.md': ['D', 'aba1ded941ff56e0775491a0c346a55495a812b8', '74aeb9df598d241ffd8702044e383f2dcc87e6c792076d44f806de0fae217a7d', 3016, 47],
  'docs/archive/work-packages/ci-v7-evidence-composition-bootstrap-v1.md': ['D', '86a814121615e54021b3791ae751f32031ac3994', 'd331039aad9b607fc6f100f4ce13204efc0ae0b35ed2674f61d059263844e184', 2102, 50],
  'docs/archive/work-packages/ci-v7-run-name-bootstrap-v1.md': ['D', 'f045f802321c0939562c81d00dd3ff3c623fae2f', '6df60af1b922b07faa4ae941ecd9af82a4b8b54b4753398bf93655ab067ce038', 2107, 40],
  'docs/archive/work-packages/ci-v7-tree-adapter-fix-v1.md': ['D', 'fdfa89412a8e11964b3825e768ddd9f2de7c4a47', '4e3c1cd85c4a45e7d4fdb079306dd189f719376ea70162715fb514dbf4370760', 2372, 43],
  'docs/archive/work-packages/ci-verification-flow-fix-v1.md': ['D', '4a1380f904cae4774b0fc9401313bdb9d34d8a62', '45ab0b409795c912870d3be83e75cfb12f3c545f52964f847cf31b1894f115e1', 4648, 71],
  'docs/archive/work-packages/dev-loop-speed-v1.md': ['D', '0315b42a242ea636e285958b913fea65a1c4e0fd', 'e3b5b2f254b67537e10c3f4357d10886b8bcbaf4953249dd8da552d106bde730', 8790, 136],
  'docs/archive/work-packages/dev-loop-speed-v2.md': ['D', '9d25ced7893fad308ff9b7732edbafac3f8bc572', '689a07b6ff42f98112a2611bb3de723c379858d9166685388de4232636919992', 12767, 179],
  'docs/archive/work-packages/dev-runner-precise-test-impact-v1.md': ['D', '958e2bf86e57df1d7a6b1e91184fe77bda17f0aa', 'b94b933f6688fca3e1423aa3e6ca3880770a4852547754806664c76657f7b081', 9521, 119],
  'docs/archive/work-packages/development-feedback-loop-hardening-v1.md': ['D', '9aa9471468b9f0078995dccaffc7f7d0adc64954', 'c64c6c599353da83759d34a6b1cccf94fd904630100e18ffb05b2da7e7bca09c', 5590, 87],
  'docs/archive/work-packages/development-throughput-v12-bootstrap-v1.md': ['D', 'db271a665a7948c39689e2265ebe903ba5c61d27', '447e7c57135c1e7ca5e6c8580cea05a279dfe803e98390234a9d3614d89f0ebf', 8763, 138],
  'docs/archive/work-packages/docs-authority-content-normalization-v1.md': ['D', 'a5a6834a0f1dd028a8d8194df40cbe29d0a800ba', '476231018a1459724f20d2f00243c32660eabc3f77ef9837a6ee6c5deeab3080', 9570, 109],
  'docs/archive/work-packages/docs-control-plane-publication-lifecycle-v1.md': ['D', 'f5c7047f409134c3764875883cb9dbc48985f237', 'd78210c4640caf5f620391431083b0ce18917691755b47c4b2740b1ef0fbb53e', 9544, 105],
  'docs/archive/work-packages/docs-doctor-v5-semantic-superset-bootstrap-v1.md': ['D', 'e26aa25632c5b4249e42b3ea8b24005e5f109000', 'eb8da07591f9bf51baa9dcad0b9177e4de8241d7b82c2f4537032bd13e62d98d', 8450, 121],
  'docs/archive/work-packages/docs-document-authority-v5-reconciliation-v1.md': ['D', '38588d4c4d920056743ed661656e6728430aa50e', '1e34c24aa14f1ff099e4a70286d72d748dab380a23687c68dca799aa73cae16a', 9865, 114],
  'docs/archive/work-packages/docs-document-authority-v5-reconciliation-v2.md': ['D', 'c04c2c282731da9a912aa32937fc4d2dca56785e', '6531989d3d32527a998c44008ef7ea1f76fec79c1cf589025f78733ddc8a68bf', 11297, 118],
  'docs/archive/work-packages/docs-v5-postmerge-reconciliation-v1.md': ['D', '9a8ce514da233c0ec6f3252bd3899fd137d8db49', 'c82669744167c48a82e1dfe2a79c46310bf8187055edfe0ddf21fe03894ed1b2', 8188, 100],
  'docs/archive/work-packages/exact-default-base-identity-v1.md': ['D', 'fc2036478d7c186d5de2957b080e51cdceaba772', 'c3f54ef6006f50fc1c3e1b989f6469bb38a3740732876c70435bf92d11a0637e', 5525, 85],
  'docs/archive/work-packages/fast-feedback-closure-v2.md': ['D', '35da2a979dbf25b94db8d35d76b7da34edaa8b44', 'e5adb80263932b2030d89adf71303d50dcdc8a372f08f77d241afffafd1870b6', 13681, 159],
  'docs/archive/work-packages/fast-feedback-postmerge-pointer-v1.md': ['D', '8f56f38007d1c33b21e83fd9d8be29af42737e6e', '2037c52d064e2983339d03f8188c00baf8c1ddf3d392f2cb659e2ae6070fad93', 2338, 52],
  'docs/archive/work-packages/fast-feedback-seconds-v1.md': ['D', 'f737100cf6181e1e8bcb90299df0bd255c84df84', '9caa86cbca874146e3d5c56d92acdcc8f17c28600198aa7e1940caa4d38469e5', 6642, 114],
  'docs/archive/work-packages/hosted-verifier-zero-install-v1.md': ['D', '6fd502282c06b50653acf84c3b82d9b8b59f538b', '773a98ffe705d5dddce2eb11be866aff48f6416df2d7310a9f352dd5e3c7e61e', 7990, 123],
  'docs/archive/work-packages/hot-import-feedback-v1.md': ['D', '83fdbc9fd1df3a21f9dd4f1cfdb6a20ce8d6a82f', '31a5268a118d717531c038c569d87363a8219480c0fad334d6a31baedcbe09de', 10353, 139],
  'docs/archive/work-packages/hot-typecheck-incremental-cache-v1.md': ['D', 'c8e4c9019cb2707954f2aebcb58a8d3b430f8ca2', '3ac0bdf3802f14c8cc83f9435d437e20b8280a2ebb7eefd6fa311eb68f3ff053', 7497, 123],
  'docs/archive/work-packages/import-test-feedback-v1.md': ['D', '1622a7f6c7db5c45fd45319259216b32f62ef045', '7ba9f168169e8f1107d9fe9242510f60083a70d9bc2bbe6bc5cfbe1056f4ca8c', 7411, 111],
  'docs/archive/work-packages/imports-authoring-closure-v1.md': ['D', '635c57c4e097b5aaa8dcf692822792b49de2c0e9', '5c4d019e4782bdc4fbc4f2146df391cde345a831c52239e7f56e1e1d487dd1a6', 3772, 54],
  'docs/archive/work-packages/imports-authority-closure-v2.md': ['D', '3ea981df1fb4f73d884eafa607fec33298534888', 'fc8d76931fe9fe97b6d5b9eccbc38ad973ebba7b226040ec2044b84735f0c001', 1994, 40],
  'docs/archive/work-packages/imports-candidate-freeze-v2.md': ['D', 'ee5365c30ff24eb6147743114302e1e70b7748d9', '9b9b3add0ed0de00112a8ec4e1dc2e0acdc3510975ec01f8654df662ec0dc98d', 4564, 63],
  'docs/archive/work-packages/imports-candidate-seal-v1.md': ['D', '758f4094b45d8dd0992fe890dcebaa59a40ca135', 'ee61854f43bbe47044b3bb5f7e20a4cdb4790100b1d9bcf71139073ecbe00714', 2615, 49],
  'docs/archive/work-packages/imports-common-hook-generation-v1.md': ['D', 'b0f1ae21efe22021bfaf98ed0e188d5f5b371327', '0954cf71d358a9fba20fff7a0815e11a23dddaf4cc7f04f2ccae86cb478ee5ef', 3093, 46],
  'docs/archive/work-packages/imports-dependency-generation-v1.md': ['D', '54f361b19720d07bbd9c3a7882874df81b1b906e', 'ce6ebeef700e49892c583e1ae617b2e2f6d6d1f6f7295d17e9accd047b117ac0', 2737, 42],
  'docs/archive/work-packages/imports-explicit-base-selection-v1.md': ['D', 'f9a1baaef2ebbabb879d44be632fd34c5cfca779', '0d213d0aca67cd7c4949d9c8f19d619c16bd6e47fc271c9ff599b7f6196cd320', 3893, 64],
  'docs/archive/work-packages/imports-hook-self-bootstrap-v1.md': ['D', 'f584dd197ec71024b61d5b0c99406e05af547103', '2328978cce64ffa53506d14568fc95ac52fb9d7f604fdc6e86275b61007a22fb', 2845, 44],
  'docs/archive/work-packages/imports-index-normalization-v1.md': ['D', '0fad5682a507474506490550ecbcbf07a60cf987', '93e26228a94cb51980155e8186ce83d911d982d922e50df2e8d156b6e2c205ca', 5609, 67],
  'docs/archive/work-packages/imports-permanent-closure-v1.md': ['D', '62610cfbdad1a1ea2bd5974001a8a52dd2851c9c', 'e9d0e2720db4be60bbc6f841b470b3db91b190421d009ec99c3bef82e4972b7d', 3980, 67],
  'docs/archive/work-packages/imports-toolchain-closure-v1.md': ['D', '7a686739d29359688149df0bc597b3a459e684f1', 'aa32b9ad1f252fbab56938b3f9639aac31c904b054689db073d706a3cac20904', 5690, 90],
  'docs/archive/work-packages/imports-worktree-bootstrap-v1.md': ['D', '7e0ef4a8d7b9d1cab9dc62382afb17c33a8acf1c', 'f216814c84ecd1e1a287c29663b2f2606bd2718a8f9a5c5c4697b743573b6a17', 2926, 44],
  'docs/archive/work-packages/ir-canonical-primitives-cycle-removal-v1.md': ['D', '5f47d37dc3f80a9e8df76a88d5f1e66122112f2d', '36c5c451a589464633005acc2a1dd46b48fa3c1834677baf65336388aabd584a', 9105, 96],
  'docs/archive/work-packages/isolated-runtime-bundle-layout-v1.md': ['D', '107acc5307ceb7da6b7b06ac31782b17ee26528a', 'ebd5fc80382e4cb4283736c2cd101fe35e181aa740eeb8debf8918a96fd9b69b', 5960, 67],
  'docs/archive/work-packages/local-gate-union-v1.md': ['D', '8995d18cadc14b61a9eeef14b2de5952849ca59b', 'f737848823085f9ce6ec6645ce1b752e8b8baa03430b9d13ea526449d4983475', 7981, 122],
  'docs/archive/work-packages/merge-gate-changed-record-identity-v1.md': ['D', '90e57e5170a6b58af865028988c93176dcdc56b1', 'af26f70990ea2f5e150a5d463608800128d4358ce590f9aa189af8f61c088b3e', 3930, 54],
  'docs/archive/work-packages/parallel-work-package-contract-v1.md': ['D', '1edf0ce30b745e61baee1ca6229c554a8582dd40', '28ed0fc175d4e1548e17864ad1f7ef353df1f04b7b94b9c053d474e14d7d9209', 7413, 129],
  'docs/archive/work-packages/phase-0-current-reality-rebase-v1.md': ['D', '9a270cd93532e4ef7975f009ccff373d3934f7ba', 'f9c4569dd2528583e1e7932b0e3f6ef1022b8b64f3f6645e507f5e3731a9fcd3', 8867, 92],
  'docs/archive/work-packages/project-runtime-owner-split-v1.md': ['D', '9e7735420a163b416534aff38e33adf7dde9cdaa', 'e6a987cd3b2edfcc999a34fcb8407d805f424a01fec493f78aa0eaca0966bb5d', 14870, 162],
  'docs/archive/work-packages/repository-audit-skill-v1.md': ['D', '113ad68778a4e5cbb71b7713c3c2002015bbb49b', '88179a8ad8b7a5c50095a2a41eee3c3e0b4c201c306c2af7b8c707ed6a0a7aa1', 4684, 71],
  'docs/archive/work-packages/repository-audit-trust-root-closure-v2.md': ['D', 'cae16c45743c667146df9e698559174ffe24e060', '37501cff46a70df344cbc5fe0285cb0fbe051fca16a4cceff95e9409ee72f5ae', 6520, 95],
  'docs/archive/work-packages/root-hygiene-closeout-v1.md': ['D', '0a63fc6dfe0ac1a0bd7cb9e2621c5e8c3bc8a843', '7188d5b7092bc38d37167492ab78e580725c11a18cbce632c61398f11306e72d', 4172, 74],
  'docs/archive/work-packages/root-hygiene-postmerge-reconciliation-v1.md': ['D', '8bab841b34191d1a92fb3dc77d7b1de6aa60f729', '7e05d884a83710d06f2a64435e9699cc932a01fc2da98fdaa5c7a78268430e49', 3123, 71],
  'docs/archive/work-packages/runtime-authority-and-package-layout-v1.md': ['D', '0d52004aebb919c666853587032f16507c3c1e93', '57da710399fe86925b7220d0f754124dacdbc603bd25056185ffa1b97a5cc6ae', 7489, 94],
  'docs/archive/work-packages/runtime-canonical-line-and-pr137-reconciliation-v1.md': ['D', 'd8ad2b2ff2cc511e5916bf83e177c85ac9920385', '003f02bbaee054d7b62f1d1f05645da381b7fd1b6df79595491c696a48324a7e', 10840, 169],
  'docs/archive/work-packages/semantic-mutation-classification-v1.md': ['D', '08e70762ed13e06a14a98bce896683513c2f2216', 'cd217441ada45100d170b969bf12ab8b8d4b4511a89375201f2d63b33e93755b', 5907, 111],
  'docs/archive/work-packages/sm3-exit-closure-v1.md': ['D', '0cff56920d909db781da768aa08f3a7d68321c9a', '3dd488daf95559b453285cfc02db3f1b9fad4af1a7855e2209a665a8fd2f2a13', 3907, 49],
  'docs/archive/work-packages/sm3-exit-closure-v2.md': ['D', '922168e8baa9979044b1d9129584c57ec14e13ef', 'c9970d072c1ea3e4c8908d8b50302461584deb979f247bc54465d9ded351dc90', 4230, 59],
  'docs/archive/work-packages/sm3-exit-closure-v3.md': ['D', 'eebb8030463b56fedd958044a24a25d50cebb253', 'e6b599f7bcce209da8720efdc1cdf8335711a59cdb172817b2982ec3be273e8e', 4439, 60],
  'docs/archive/work-packages/sm3-exit-closure-v4.md': ['D', '0a71f0d003d70d40f70a458d1dd6af8ced353f3e', 'f10f6ef435f6a3afd59f6bf4ecdc1fd4e1e00807643db56520268b182638dd50', 4158, 63],
  'docs/archive/work-packages/sm3-exit-closure-v5.md': ['D', '11498d3c860ead88688e70b85e905a9b7fdc46e3', '7a6c470ad494c3b97dcb588dfc263cde0e061784262db76be418106e67839be1', 5143, 69],
  'docs/archive/work-packages/sm3-exit-closure-v6.md': ['D', '6c74a9649f3c0fd39a88400f450b162ac5168071', 'd745efed19b4e9822363dd2a8896bca7a663829ae0a995e67bb7812b3988f248', 5156, 70],
  'docs/archive/work-packages/sm3-exit-closure-v7.md': ['D', '7ae0b2e58c55458637b7a43c4459f39f7f322a35', '5afd4be54047cfef18f06ffd9e093c954c07d63a30146b37c318f3edc07b705a', 5544, 74],
  'docs/archive/work-packages/sm3-exit-closure-v8.md': ['D', '640d8d73cf12e462e29ec30ae0c86d4736c373e7', '147487b177ed4695c853e50942d9006d5745b5912c8cf80708d8dea17631c721', 3867, 49],
  'docs/archive/work-packages/sm3-p0-local-isolated-runner-v1.md': ['D', 'cfec90d5d86443bfed5269633e025cafa37d4977', 'f87c19c5bcded4c5fc031a13278a9f089d4b877da4923e91aa279226d5f2b55f', 5345, 81],
  'docs/archive/work-packages/sm3-r3-actionable-runtime-gate-v1.md': ['D', '105b375c98837e22923ab71c147ae14f96b05c9e', '9f22ea4bab729864adb2a570338b6fb4f9fd9991cda8c1281a7ede101e6923ca', 11636, 164],
  'docs/archive/work-packages/sm3-r3-actionable-runtime-gate-v2.md': ['D', 'c5e004184f88153acbf1699d6ec893f7c1439428', 'c52948a492cdd90b55b5716b250f1756daa84547265c1f5520b2e2e2c5bddb04', 20563, 234],
  'docs/archive/work-packages/sm3-r3-actionable-runtime-gate-v3.md': ['D', '81426c3501572edfc51cff4211581fd7f8d86bf4', '40ca3a7a81ee630100001786c45daf50584df86c09bbb29b16a1a864d08122c3', 18679, 212],
  'docs/archive/work-packages/sm4a-trusted-authorization-ingress-reconciliation-v10.md': ['D', '253e2423874275e3149690c104d7066e781f37e3', '4cdb3373aed10e192dd583668ccd23fab889f8e2b9694a10790bc60b522687cb', 4904, 98],
  'docs/archive/work-packages/test-runtime-performance-v1.md': ['D', '7e6d22c796fe21e7a4376349c9050da9c3a11175', '14b6d779b1c9207d9bc63f5da875929c55e8d118d1aeb1f032994f0bfa7f9d45', 3802, 80],
  'docs/archive/work-packages/test-runtime-template-settlement-v1.md': ['D', '7369de2b331efaff8c7cc46fe5a2e860506214f8', 'f2304cdc1396d4ee08fa046f7965725ff2a04d44fdb26b824ce9716e87b061f9', 2744, 57],
  'docs/archive/work-packages/verification-acceptance-coverage-v1.md': ['D', 'e10ed198336d0eecf7fcb652cf6bcec496f2df59', 'ae9a23891ef1b8cbab21aec84f094fca277dc9bd2fba63e12aa918258bb29c94', 6567, 118],
  'docs/archive/work-packages/verification-aggregate-lattice-v1.md': ['D', '71f8110a55c32fc421a665876b007434d92439ec', '98f247a75d86fa17d7defb2a49194389ed533e1169f9b084080ae3a51bc1db32', 6749, 115],
  'docs/archive/work-packages/verification-artifact-claim-summary-v1.md': ['D', '36986b2cdc13c97e483ab6f727cb09f96fe182e6', 'affb15a21586db42a944e61067db2bb414f42c64aed1b40c6d2ec32ca80c46c6', 37668, 295],
  'docs/archive/work-packages/verification-fast-runner-resource-isolation-v1.md': ['D', 'e83681b2b30cc0bd839000cbf0ca30cd5aa70908', 'c57917dbacb961c6dc1ed00d5558255128c45e3a7e95e097e281c6b24dc45ff6', 3438, 60],
  'docs/archive/work-packages/verification-result-claim-migration-v1.md': ['D', 'd25ec44d198720917dd932f5d3a261d1dce61507', '81a5b7cd54f7c70d42d0f272a5467de43ee5d2120748f404ed6f27decf71b449', 5037, 81],
  'docs/archive/work-packages/verification-result-core-v1.md': ['D', 'bcf17b4c3fa6aed6c690443424e72493e3aac56a', '291a1bec00d1d142dfd365c1ff3eefb8c957c9492bebbf3b95c4f538f784184a', 11118, 176],
  'docs/archive/work-packages/verification-writer-profile-v1.md': ['D', 'e8ad7160aa13176a5f67388984629715d08e9514', '0a6857a6e72b7bd8675c88476e66969970156f7872f6d9123ee78ccbf1cbb239', 7616, 125],
  'docs/archive/work-packages/windows-browser-launch-path-authority-v1.md': ['D', '1f10b308c0393c632f710f741912fe3dfd25f692', '6d7934d951dfb23b081f605c9a379516dbf31ca18c268d196f9b0537a4067554', 18064, 199],
  'docs/archive/work-packages/work-readme-conditional-state-clarification-v1.md': ['D', '02ab7e48b8b9ea8d80f73a5f0fa4bd680d0ecdf9', 'd20036cd311b3b31d13f5a865c733c478380a8dec21a1c97a96dfd78c6c8e571', 2275, 58],
  'docs/archive/work-packages/workspace-write-lease-portability-v1.md': ['D', 'db4da0fe8ec89a471aedc2a6dd3d7d9a171f4116', '67f6b91dd77fafd753caf63d7e321cd0277b489b27f0a3832cb5eb69403038ba', 10833, 100],
  'docs/archive/用户能力模块化开发-信息抽取台账.md': ['D', '916ecbdb4fae03e10b11e9e1209ad42bf350bbec', '965465e9fdcb227b6e0c867c7406f7d6da42c4e0bedc576811b2ca60c93985f1', 58170, 593],
  'docs/archive/用户能力模块化开发.md': ['D', 'aec45af1ee1e89ef0bf8717591eb0e0e3f9409a4', 'ccbfa0ee91a95d105df33c09580403ccec551b1f563e730e724d3fb3a1a27a95', 713962, 26893],
  'docs/evidence/2026-07-26-development-throughput-audit.md': ['D', 'a5d9288ea251f86d1226b591517790e42628bdcf', '01244d9b25e74983628a1e49aaad7053fcc597e4aa293841375a7d5fd27e765e', 3013, 52],
  'docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md': ['D', 'c8ca8eab4bd1873a6c08ed90cb9b2dca877c3527', 'effa1a5ab2f8440d5f8b6bea01e335b87f394c70635f6416102867726be26aa5', 6522, 70],
  'docs/evidence/2026-08-04-canonical-architecture-convergence.md': ['D', 'f4b178506ece8c3ff867ce8ca0c12b5778cded8d', '3c05cc75561de46d59809eb0b783efa8c94efd27614f39bb55e699b8554a5bc3', 14911, 252],
  'docs/evidence/2026-08-04-full-architecture-asset-audit.md': ['D', '8f09bf4513d611497f94377ebd17fc5140d925b2', 'ae9f92cc88641d8b7c113c384c1fb295197ee909dba9df48a187751106ed5371', 25193, 477],
  'docs/evidence/documentation/active-documentation-corpus-v1-parent-reconciliation.md': ['D', '9afa4bd1210a1b4cad6d15a1d03ed6553eae5da7', '198a80b35844d93e3944c731b2e65b8affeda36dec52bf50fc16935d975839ef', 1787, 35],
  'docs/evidence/documentation/active-documentation-corpus-v1.md': ['D', '318aeafc94bbe3f995b928807417978876fbd92f', '62a07a7a259830b70ef324c40b416ec0ac2a962fb4f4d7ff88bc4b1eef8afcf1', 33879, 387],
  'docs/superpowers/plans/2026-05-02-project-overview.md': ['D', '47fb22d86e1e9a652fe3397c91da63a840392192', '76dd76d8d42971b2d04bfea08231b76de4071256442fac4232e28cf688ea2e11', 848, 21],
  'docs/superpowers/plans/2026-05-08-graph-it-live-runtime-evidence.md': ['D', '62dd6d0af494ff66c24fd258db1e496d63887d98', '9713b0a7461cb2a74278ea729b01f257e02a38e0fe94dcba30fa2cb858160169', 726, 21],
  'docs/superpowers/specs/2026-05-02-project-overview-design.md': ['D', 'bf79212a90a83d8d47ab1bef3eb7d491e22f8989', '3815f2438c3f93c6a2010511d39b19d6ce1b4b14780d2f01b1bc0529481697a3', 1154, 28],
  'docs/superpowers/specs/2026-05-08-graph-it-live-runtime-evidence-design.md': ['D', '76f5aef4e2ba445ca6dbf31fa64264168a6c01a6', '073218d958b16737b268b9cbb7e10520fc83a272eb7bcf2fc3a5d1f9876ec5f1', 1041, 34],
  'docs/work-packages/default-branch-health-repair-v1.md': ['D', '479ab895960b2e2e8d18e7542926961535ed9fa1', '8895bc6a2503bf02f4ab0154135c6e8c37079a4c8f994124605f6ae8a080b428', 4750, 104],
  'docs/archive/authority-v5/root/AGENTS.historical.md': ['R', 'ec0ba211b4ceaa754973859ad69fd7819b221751', '855110d9fd778b92576576b734d712dc206a1aa3dd142bdf07c21d064984681a', 7815, 56, 'tests/fixtures/documentation-history/AGENTS.authority-v5.historical.md'],
  'docs/archive/work-packages/sm3-r1-focused-blocker-repair-v1.md': ['R', '2e6fd9a72ab0b33785a526d6cf0f7928bc5030e2', 'a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6', 9763, 112, 'tests/fixtures/work-package-gate-manifests/sm3-r1-focused-blocker-repair-v1.md'],
  'docs/archive/work-packages/sm3-r2-bounded-runtime-gate-v1.md': ['R', '44dc8889c8ead1bb3a6ebaba57c4004fa175d71c', '158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951', 12659, 177, 'tests/fixtures/work-package-gate-manifests/sm3-r2-bounded-runtime-gate-v1.md'],
  'docs/archive/work-packages/sm3-r3-actionable-runtime-gate-v4.md': ['R', 'b2e87ca9f88b84c50aa69bfe7dc0c8d8a9285ae0', '752d8c32c01ecf67cda207a900953493d75ab1c949c97c44cb7f0eb8e0ab3d24', 18211, 215, 'tests/fixtures/work-package-gate-manifests/sm3-r3-actionable-runtime-gate-v4.md']
} as const);

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

export interface InformationLifecycleClaimFamily {
  claimId: string;
  normalizedStatement: string;
  oldLines: string;
  disposition: InformationLifecycleDisposition;
  currentOwner: string;
  currentReferences: readonly string[];
  consumers: readonly string[];
  positiveEvidence: readonly string[];
  negativeEvidence: readonly string[];
  conflicts: readonly string[];
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

export const INFORMATION_LIFECYCLE_CLAIM_FAMILIES: readonly InformationLifecycleClaimFamily[] =
  Object.freeze([
    Object.freeze({
      claimId: 'engineering-ir-legacy-spec',
      normalizedStatement: '旧 Engineering IR 总规范（2,068 行）的 durable 语义按域进入当前唯一 owner。',
      oldLines: 'docs/archive/authority-v5/14-Engineering IR与语义事实规范.md（2d7187f4…，2,069 行）',
      disposition: 'migrated-canonical-authority',
      currentOwner: 'semantic-model/delta-impact/mutation/compiler-target-ir owners',
      currentReferences: [
        'docs/semantic-model.md',
        'docs/delta-and-impact.md',
        'docs/semantic-mutation.md',
        'docs/compiler-target-ir.md'
      ],
      consumers: ['compiler', 'verification', 'workbench-ai'],
      positiveEvidence: [
        'tests/contract/fact-delta-contract.test.ts',
        'tests/contract/impact-propagation-contract.test.ts',
        'tests/unit/engineering-ir.test.ts',
        'tests/unit/canonical-ir-identity-revision.test.ts'
      ],
      negativeEvidence: ['tests/contract/semantic-mutation-contract.test.ts'],
      conflicts: [],
      reason: 'Phase 0 逐段复核；predicate/signature、SEMANTIC-LINK-*、IMPACT-*、SEMANTIC-MUTATION-*、hard-link/reparse/no-follow 等精确合同已由 current code/tests 接管'
    }),
    Object.freeze({
      claimId: 'external-provider-legacy-policy',
      normalizedStatement: '旧 wheel-first/capability 分解/安全审查/Provider Evidence/退休机制由当前 provider 政策吸收并强化。',
      oldLines: 'docs/archive/authority-v5/governance/external-capability-and-provider-policy.md（2d7187f4…，605 行）',
      disposition: 'migrated-canonical-authority',
      currentOwner: 'external-provider-owner',
      currentReferences: ['docs/external-provider-policy.md', 'docs/governance/external-capability-ledger.yaml'],
      consumers: ['external-capability-ledger', 'brownfield', 'compiler-target-ir'],
      positiveEvidence: ['tests/contract/docs-doctor-ledgers.test.ts'],
      negativeEvidence: [],
      conflicts: [],
      reason: 'Phase 0 确认当前政策包含 L0–L5、black/gray/white、Provider/Adapter/Reference/Custom 与 Implementation Resolution 边界'
    }),
    Object.freeze({
      claimId: 'nexus-epr-definitions',
      normalizedStatement: 'EPR-001…EPR-029 的 requirement 定义与 29 项 SEC owner/mechanism/parity binding 全部机器化。',
      oldLines: 'docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md（2d7187f4…，第 5–33 节）',
      disposition: 'migrated-machine-ledger',
      currentOwner: 'nexus-corpus-owner',
      currentReferences: [
        NEXUS_CORPUS_CONTRACT_PATH,
        'docs/governance/nexus-absorption-ledger.yaml'
      ],
      consumers: ['docs-doctor', 'repository-audit'],
      positiveEvidence: ['tests/contract/docs-doctor-ledgers.test.ts', 'tests/contract/repository-audit.test.ts'],
      negativeEvidence: [],
      conflicts: [],
      reason: 'requirement 定义进入 corpus contract；29 项 binding 由本包 ledger 与 repository-audit 机器 manifest 完成（bound 26 + blocked 3，均有证据）'
    }),
    Object.freeze({
      claimId: 'raw-design-conversation',
      normalizedStatement: '26,893 行原始设计对话的耐久设计已由 current owners 吸收；行业/产品/竞品/远期愿景不反向成为 SEC 事实。',
      oldLines: 'docs/archive/用户能力模块化开发.md（2d7187f4…，26,893 行）',
      disposition: 'historical-git-only',
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
      positiveEvidence: ['tests/contract/documentation-authority.test.ts', 'tests/contract/repository-audit.test.ts'],
      negativeEvidence: [],
      conflicts: [],
      reason: 'Phase 0 全量读取并回补截断区间；确定性实现/生成物非 authority/Block-Provider-Adapter/Responsibility 分层等已吸收'
    }),
    Object.freeze({
      claimId: 'conversation-extraction-ledger',
      normalizedStatement: '原始抽取台账只作为历史记录；durable claims 已独立复核并路由。',
      oldLines: 'docs/archive/用户能力模块化开发-信息抽取台账.md（2d7187f4…，593 行）',
      disposition: 'historical-git-only',
      currentOwner: 'documentation-governance owner',
      currentReferences: ['docs/work/README.md'],
      consumers: [],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: '台账不恢复；claims 已由 Phase 0 独立复核'
    }),
    Object.freeze({
      claimId: 'fixture-renames',
      normalizedStatement: '四个 R100 重命名的 old/new Git blob SHA 完全相同，作为 fixture 保留。',
      oldLines: 'docs/archive/authority-v5/root/AGENTS.historical.md + docs/archive/work-packages/sm3-r{1,2,3}-*.md（2d7187f4…）',
      disposition: 'migrated-fixture',
      currentOwner: 'test-fixture-owner',
      currentReferences: [
        FIXTURE_DOCUMENTATION_HISTORY_PATH,
        ...FIXTURE_WORK_PACKAGE_GATE_MANIFESTS
      ],
      consumers: ['documentation-authority-tests', 'work-package-gate-contract-tests'],
      positiveEvidence: ['tests/contract/repository-audit.test.ts'],
      negativeEvidence: [],
      conflicts: [],
      reason: 'exact blob identity machine-verified by the deleted-blob cross-check'
    }),
    Object.freeze({
      claimId: 'bounded-recursive-composition',
      normalizedStatement: '跨 semantic kind 的受限递归 containment 需要 typed parent/child legality、identity/revision 与负面合法证明。',
      oldLines: 'docs/archive/authority-v5/06-Registry与Block协议规范.md 及 11-Workbench与可视化规范.md（2d7187f4…）',
      disposition: 'extract-required',
      currentOwner: 'issue-317',
      currentReferences: ['docs/capability-and-block-model.md'],
      consumers: ['compiler-target-ir'],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: '已建立 Issue #317；最终吸收到现有 Engineering IR/Capability/Contract machine owner，不建立第二 graph'
    }),
    Object.freeze({
      claimId: 'semantic-engineering-benchmark',
      normalizedStatement: '需要版本化任务/corpus/reference truth/anti-gaming 的 Intent→Spec→System→Acceptance 端到端评测。',
      oldLines: 'docs/archive/authority-v5/03-MVP实施计划与路线图.md（2d7187f4…）',
      disposition: 'extract-required',
      currentOwner: 'issue-318',
      currentReferences: ['docs/roadmap.md'],
      consumers: ['verification'],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: '已建立 Issue #318；#316 只拥有 performance truth，#311 只拥有 Verification Session'
    }),
    Object.freeze({
      claimId: 'completed-work-package-manifests',
      normalizedStatement: '已完成/被取代的 Work Package manifest 是历史记录，不恢复到 active docs/work-packages。',
      oldLines: 'docs/archive/work-packages/*.md（2d7187f4…，95 个）',
      disposition: 'historical-git-only',
      currentOwner: 'work-package-lifecycle owner',
      currentReferences: ['docs/work/README.md'],
      consumers: [],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: 'active 目录只保留 pointer 选中的 manifest；历史由 exact Git 定位'
    }),
    Object.freeze({
      claimId: 'old-evidence-narratives',
      normalizedStatement: '旧 Evidence 叙事由机器 Verification 事实与 receipt 取代。',
      oldLines: 'docs/evidence/**/*.md（2d7187f4…，6 个）',
      disposition: 'historical-git-only',
      currentOwner: 'verification-evidence-owner',
      currentReferences: ['docs/verification-governance.md'],
      consumers: [],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: 'Verification Session registry/FreezeSession/Candidate Tree 成为机器事实来源'
    }),
    Object.freeze({
      claimId: 'superpowers-plans-specs',
      normalizedStatement: 'Superpowers 计划/规格是过期叙事，不回流入当前树。',
      oldLines: 'docs/superpowers/**/*.md（2d7187f4…，4 个）',
      disposition: 'historical-git-only',
      currentOwner: 'documentation-governance owner',
      currentReferences: ['docs/work/README.md'],
      consumers: [],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: 'corpus census 拒绝 Evidence/Superpowers 叙事 Markdown 回流'
    }),
    Object.freeze({
      claimId: 'transient-control-plane-history',
      normalizedStatement: '旧 control-plane 快照与迁移记录是历史，不恢复为当前事实。',
      oldLines: 'docs/archive/2026-07-23-*.md + docs/archive/authority-v5/work/*（2d7187f4…）',
      disposition: 'historical-git-only',
      currentOwner: 'control-plane-owner',
      currentReferences: ['docs/work/current-state.yaml', 'docs/work/active-work-package.md', 'docs/work/rolling-plan.md'],
      consumers: [],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: '当前状态由 live control plane 拥有'
    }),
    Object.freeze({
      claimId: 'authority-v5-architecture-goals',
      normalizedStatement: 'authority-v5 架构/goal 文档的 durable 语义进入当前架构与产品 owner。',
      oldLines: 'docs/archive/authority-v5/architecture/** + goals/**（2d7187f4…）',
      disposition: 'migrated-canonical-authority',
      currentOwner: 'system-architecture/product owners',
      currentReferences: ['docs/system-architecture.md', 'docs/product.md', 'docs/roadmap.md'],
      consumers: ['compiler-target-ir', 'brownfield', 'roadmap'],
      positiveEvidence: ['tests/contract/documentation-authority.test.ts'],
      negativeEvidence: [],
      conflicts: [],
      reason: 'PR #308 已将 Implementation Resolution 稳定架构融合进 main；历史文档不恢复'
    }),
    Object.freeze({
      claimId: 'documentation-index-v5',
      normalizedStatement: '旧文档索引/一致性规则由 docs/authority.json registry 与 docs/README.md 投影取代。',
      oldLines: 'docs/archive/authority-v5/00-文档索引与一致性规则.md（2d7187f4…，137 行）',
      disposition: 'superseded-duplicate-authority',
      currentOwner: 'canonical-documentation-owner',
      currentReferences: ['docs/authority.json', 'docs/README.md'],
      consumers: ['docs-doctor'],
      positiveEvidence: ['tests/contract/docs-doctor-byte-exact.test.ts'],
      negativeEvidence: [],
      conflicts: [],
      reason: 'registry + generated projection 是唯一文档权威'
    }),
    Object.freeze({
      claimId: 'ci-and-test-lanes-v5',
      normalizedStatement: '旧 CI/test lane 语义由当前 verification plan 与 test impact 合同接管。',
      oldLines: 'docs/archive/authority-v5/{test-architecture,test-and-package-architecture,test-feedback-and-ci-lanes,slow-suite-registry}.md（2d7187f4…）',
      disposition: 'migrated-canonical-authority',
      currentOwner: 'verification owner',
      currentReferences: [
        'docs/verification-governance.md',
        'platform/shared/ci-verification-plan.ts',
        'platform/shared/test-impact-contract.ts',
        'platform/shared/test-budget-contract.ts'
      ],
      consumers: ['ci', 'test-impact'],
      positiveEvidence: ['tests/contract/ci-lanes.test.ts', 'tests/contract/test-impact.test.ts'],
      negativeEvidence: [],
      conflicts: [],
      reason: 'ci-verification-v19 与 test impact/budget 合同为唯一机器事实'
    }),
    Object.freeze({
      claimId: 'default-branch-health-repair-manifest',
      normalizedStatement: 'default-branch-health-repair-v1 已退役并被 branch/ref lifecycle 包取代。',
      oldLines: 'docs/work-packages/default-branch-health-repair-v1.md（2d7187f4…，104 行）',
      disposition: 'historical-git-only',
      currentOwner: 'work-package-lifecycle owner',
      currentReferences: ['tests/contract/default-branch-revision-health.test.ts'],
      consumers: [],
      positiveEvidence: [],
      negativeEvidence: [],
      conflicts: [],
      reason: '#313 branch-ref-lifecycle-enforcement-v1 完全闭合后该 manifest 退役'
    })
  ]);

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
    mechanism: [
      'platform/shared/project-runtime.ts',
      'platform/shared/windows-appcontainer-executor.ts',
      'tests/integration/project-dependency-runtime.test.ts'
    ],
    affectedIrEntities: ['runtime.environment', 'runtime.host-profile', 'brownfield.typed-invocation'],
    positiveAcceptance: '平台边界使用真实 provider 能力。',
    negativeAcceptance: '模拟旁路被架构拒绝。',
    failureAcceptance: 'platform boundary 失败返回结构化错误。',
    historicalRegression: '2d7187f4:docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md 第 19 节',
    applicableGate: 'runtime dependency and AppContainer contract tests',
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

  // archiveCurrentConsumers: current code/scripts/workflows consuming removed archive paths.
  // The audit's own machine manifest and test-impact tombstone registries are the
  // intentional exact-reference consumers and are excluded. docs/scripts/** is the
  // governance tombstone mechanism that rejects archive/superpowers re-entry.
  const ARCHIVE_PATH_REFERENCE = /docs\/(?:archive|superpowers)\//u;
  for (const repositoryPath of tracked) {
    if (
      !/^(?:scripts|control|\.github)\//u.test(repositoryPath)
      || repositoryPath === 'scripts/codex/repository-audit.ts'
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
    const routed = SEC_REPOSITORY_BEHAVIOR_IDS.filter(
      (behavior) => {
        const route = SEC_REPOSITORY_BEHAVIOR_ROUTES[behavior];
        return route.kind === 'skill' && route.owner === skillId;
      }
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
    behaviorRoutes: SEC_REPOSITORY_BEHAVIOR_ROUTES,
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
    schema: 'sec-repository-audit-v2',
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
