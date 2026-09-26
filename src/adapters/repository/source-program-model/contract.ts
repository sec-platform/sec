import { isRepositoryTestModulePath } from '../../../contracts/repository-test-path.ts';
import type { SemanticResponsibilityTargetKind } from '../../../semantics/definitions/types.ts';
import type {
  ModuleCausalRelation,
  ModuleOperationObligation,
  ModuleOperationRole,
  RepositoryModuleGraph,
  RepositoryModuleMembership
} from '../architecture/contract.ts';

export const REPOSITORY_AUDIT_ENTRYPOINT_PATH = 'src/adapters/repository/repository-audit/cli.ts' as const;

type SourceProgramObservationClass = 'observed' | 'derived' | 'unknown';

export type SourceProgramSurface =
  | 'production'
  | 'test'
  | 'fixture'
  | 'workflow'
  | 'resource';

const SOURCE_PROGRAM_TEST_DIRECTORY_PATH =
  /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/iu;
const SOURCE_PROGRAM_FIXTURE_PATH =
  /(?:^|\/)(?:fixtures?|snapshots?)(?:\/|$)/iu;
const SOURCE_PROGRAM_RESOURCE_EXTENSION =
  /\.(?:json|ya?ml|toml|md|markdown|txt|sql|prisma|ejs|template)$/iu;
const SOURCE_PROGRAM_CATALOG_RESOURCE_PATH =
  /^catalog\/registry\/[^/]+\/.+\/files\//iu;
const SOURCE_PROGRAM_GRAPH_EXTENSION = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml)$/iu;
const SOURCE_PROGRAM_ROOT_INPUT = new Set([
  '.documentation/documents.json',
  '.documentation/baseline.json',
  'bunfig.toml',
  '.gitignore',
  'knip.json',
  'package.json',
  'tsconfig.json'
]);

/**
 * Exact repository inputs owned by the SEC Source Program. Target workspaces,
 * generated artifacts, catalog payloads and documentation bodies are separate
 * domains; their tracked bytes cannot silently expand compiler identity.
 */
export function isSourceProgramInputPath(repositoryPath: string): boolean {
  if (SOURCE_PROGRAM_ROOT_INPUT.has(repositoryPath)) return true;
  if (/^\.githooks\/[^/]+$/u.test(repositoryPath)) return true;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/iu.test(repositoryPath)) return true;
  if (!SOURCE_PROGRAM_GRAPH_EXTENSION.test(repositoryPath)) return false;
  return repositoryPath.startsWith('src/') || repositoryPath.startsWith('tests/');
}

export function sourceProgramSurfaceForPath(repositoryPath: string): SourceProgramSurface {
  if (SOURCE_PROGRAM_FIXTURE_PATH.test(repositoryPath)) return 'fixture';
  if (SOURCE_PROGRAM_TEST_DIRECTORY_PATH.test(repositoryPath)
      || isRepositoryTestModulePath(repositoryPath)) return 'test';
  if (SOURCE_PROGRAM_CATALOG_RESOURCE_PATH.test(repositoryPath)) return 'resource';
  if (repositoryPath.startsWith('.github/workflows/')) return 'workflow';
  if (SOURCE_PROGRAM_RESOURCE_EXTENSION.test(repositoryPath)) return 'resource';
  return repositoryPath.startsWith('src/') ? 'production' : 'resource';
}

export interface SourceProgramSpan {
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface SourceProgramFileInput {
  readonly path: string;
  readonly source: string;
  readonly contentDigest: string;
}

/**
 * The smallest repository-compilation contract consumed by the TypeScript
 * frontend.  A workspace snapshot implements this contract; the frontend
 * must depend on these facts, never on that producer's implementation.
 */
export type SourceProgramCompilationMatchInput = Readonly<{
  sourceRevision?: string;
  productionModel?: SourceProgramModel;
  files: readonly SourceProgramFileInput[];
  moduleMembership: RepositoryModuleMembership;
}>;

export interface SourceProgramCompilation {
  readonly identityDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly moduleGraph: RepositoryModuleGraph;
  file(repositoryPath: string): SourceProgramFileInput | null;
  assertMatches(input: SourceProgramCompilationMatchInput): void;
}

export type SourceProgramSupersessionStatus =
  | 'equivalent'
  | 'superseded'
  | 'owner-decision-required';

export type SourceProgramSupersessionFindingCode =
  | 'baseline-evidence-invalid'
  | 'current-evidence-invalid'
  | 'dynamic-or-external-observation-unresolved'
  | 'design-intent-unresolved'
  | 'design-intent-regressed'
  | 'lifecycle-cost-not-reduced'
  | 'operation-obligation-unresolved'
  | 'required-entrypoint-missing'
  | 'required-production-behavior-missing'
  | 'required-resource-missing'
  | 'required-test-boundary-missing'
  | 'replacement-ambiguous';

export interface SourceProgramSupersessionFinding {
  readonly code: SourceProgramSupersessionFindingCode;
  readonly baselineId: string | null;
  readonly owner: string | null;
  readonly baselinePaths: readonly string[];
  readonly currentCandidateIds: readonly string[];
  readonly detail: string;
}

export interface SourceProgramSupersessionReplacement {
  readonly kind: 'entrypoint' | 'production' | 'resource' | 'test';
  readonly baselineId: string;
  readonly currentIds: readonly string[];
  readonly owner: string | null;
  readonly baselinePaths: readonly string[];
  readonly currentPaths: readonly string[];
  readonly proof: 'exact-semantic-obligation' | 'strict-observation-superset';
}

export interface SourceProgramSupersessionLifecycleCost {
  readonly productionUnits: number;
  readonly testUnits: number;
  readonly owners: number;
  readonly unresolvedObservations: number;
  readonly unobservedTestRisk: number;
}

export interface SourceProgramSupersessionReceipt {
  readonly status: SourceProgramSupersessionStatus;
  readonly baseline: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly testCompilationDigest: string;
    readonly intentEvidenceDigest: string;
  }>;
  readonly current: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly testCompilationDigest: string;
    readonly intentEvidenceDigest: string;
  }>;
  readonly lifecycleCost: Readonly<{
    readonly baseline: SourceProgramSupersessionLifecycleCost;
    readonly current: SourceProgramSupersessionLifecycleCost;
  }>;
  readonly replacements: readonly SourceProgramSupersessionReplacement[];
  readonly findings: readonly SourceProgramSupersessionFinding[];
  readonly receiptDigest: string;
}

export interface SourceProgramFile {
  readonly path: string;
  readonly contentDigest: string;
  readonly moduleId: string | null;
  readonly surface: SourceProgramSurface;
  readonly semanticKind: SourceProgramFileSemanticKind;
  readonly semanticObservationClass: SourceProgramObservationClass;
}

export type SourceProgramFileSemanticKind =
  | 'pure-reexport'
  | 'declaration-owner'
  | 'executable'
  | 'unknown';

export interface SourceProgramDeclaration {
  readonly observationId: string;
  readonly declarationDigest: string;
  readonly path: string;
  readonly moduleId: string | null;
  readonly name: string;
  readonly kind: string;
  readonly exported: boolean;
  readonly span: SourceProgramSpan;
}

export type SourceProgramReferenceKind =
  | 'reference'
  | 'import'
  | 'reexport'
  | 'call'
  | 'construct';

export interface SourceProgramReference {
  readonly path: string;
  readonly kind: SourceProgramReferenceKind;
  readonly name: string;
  /** Exact local module spelling that introduced this reference, when applicable. */
  readonly moduleSpecifier: string | null;
  /** Compiler-issued source declaration; null means module-initialization relation. */
  readonly sourceObservationId: string | null;
  readonly sourceRelation: 'declaration' | 'module-initialization';
  readonly targetObservationId: string | null;
  readonly targetPath: string | null;
  readonly observationClass: SourceProgramObservationClass;
  readonly span: SourceProgramSpan;
}

export type SourceProgramLiteralContext =
  | 'producer'
  | 'reader'
  | 'argument'
  | 'assertion'
  | 'literal';

export interface SourceProgramLiteral {
  readonly path: string;
  readonly value: string;
  readonly context: SourceProgramLiteralContext;
  /** Enclosing assertion/producer expression that owns this literal context. */
  readonly contextSpan: SourceProgramSpan | null;
  readonly span: SourceProgramSpan;
}

export interface SourceProgramUnknown {
  readonly code: string;
  readonly path: string;
  readonly detail: string;
  readonly span: SourceProgramSpan | null;
}

export type SourceProgramEntrypointKind =
  | 'package-script'
  | 'package-bin'
  | 'cli-command'
  | 'module-entrypoint'
  | 'git-hook'
  | 'workflow';

/**
 * Target references retain the entrypoint kind because a package can expose
 * a bin and a script with the same name.  A path/name pair alone is therefore
 * not an identity and lets one entrypoint silently replace the other.
 */
export type SourceProgramEntrypointAddress =
  `${SourceProgramEntrypointKind}:${string}#${string}`;

export interface SourceProgramEntrypoint {
  readonly observationId: string;
  readonly path: string;
  readonly kind: SourceProgramEntrypointKind;
  readonly name: string;
  readonly command: string | null;
  readonly targetEntrypoints: readonly SourceProgramEntrypointAddress[];
  readonly targetPaths: readonly string[];
  readonly targetPackages: readonly string[];
  readonly observationClass: SourceProgramObservationClass;
  readonly span: SourceProgramSpan | null;
}

export interface SourceProgramEntrypointClosure {
  readonly entrypointObservationId: string;
  readonly path: string;
  readonly name: string;
  readonly targetPaths: readonly string[];
  readonly targetPackages: readonly string[];
  /** Modules containing the statically resolved handler roots; not semantic authority by itself. */
  readonly handlerModuleIds: readonly string[];
  readonly reachablePaths: readonly string[];
  readonly capabilityPaths: readonly string[];
  readonly transports: readonly SourceProgramCapabilityTransport[];
  readonly providerModuleIds: readonly string[];
  readonly unknownPaths: readonly string[];
  readonly observationClass: SourceProgramObservationClass;
}

export type SourceProgramOperationIdentity = Readonly<{
  readonly capability: string;
  readonly operation: string;
}>;

declare const sourceProgramOperationProducerClosureBrand: unique symbol;

export type SourceProgramOperationSourceEvidence = Readonly<{
  readonly path: string;
  readonly source: string;
  readonly contentDigest: `sha256:${string}`;
}>;

/**
 * Process-local Source Program proof of the complete implementation reachable
 * from the one descriptor-owned entrypoint of a semantic operation. This is
 * source evidence only: it cannot prove a retained file, a sealed execution
 * generation, loaded implementation bytes, or process authority. Consumers
 * select only the operation identity; all paths and bytes remain compiler-owned.
 */
export interface OperationProducerClosure {
  readonly [sourceProgramOperationProducerClosureBrand]: true;
  readonly authority: 'source-evidence-only';
  readonly operation: SourceProgramOperationIdentity;
  readonly moduleId: string;
  readonly descriptor: SourceProgramOperationSourceEvidence;
  readonly entrypoint: SourceProgramOperationSourceEvidence & Readonly<{
    readonly address: SourceProgramEntrypointAddress;
  }>;
  readonly implementationFiles: readonly SourceProgramOperationSourceEvidence[];
  readonly closureDigest: `sha256:${string}`;
}

export interface SourceProgramPackage {
  readonly manifestPath: string;
  readonly name: string;
  readonly version: string | null;
  readonly private: boolean | null;
}

export type SourceProgramDependencyScope = 'runtime' | 'development' | 'peer' | 'optional';

export interface SourceProgramDependency {
  readonly manifestPath: string;
  readonly name: string;
  readonly requirement: string;
  readonly scope: SourceProgramDependencyScope;
  readonly consumerPaths: readonly string[];
  readonly observationClass: SourceProgramObservationClass;
}

type SourceProgramCapabilityKind =
  | 'process'
  | 'filesystem'
  | 'network'
  | 'dynamic-code'
  | 'provider';

type SourceProgramCapabilityTransport =
  | 'native-runtime'
  | 'repository-provider'
  | 'runtime-built-in-api'
  | 'package-api'
  | 'unknown';

export type SourceProgramCapabilityAuthorityClass =
  | 'repository-provider'
  | 'runtime-built-in-api'
  | 'external-package-api'
  | 'unresolved-transport';

export interface SourceProgramCapabilityInvocation {
  /** Stable identity of this exact compiler-observed invocation. */
  readonly observationId: string;
  readonly path: string;
  readonly moduleId: string | null;
  readonly surface: SourceProgramSurface;
  readonly capability: SourceProgramCapabilityKind;
  readonly operation: string;
  readonly subject: string | null;
  readonly transport: SourceProgramCapabilityTransport;
  /** Exact import/module source observed at the callsite, when applicable. */
  readonly moduleSpecifier: string | null;
  /** Exact descriptor capability when this call crosses a repository provider boundary. */
  readonly providerCapability: string | null;
  readonly providerModuleId: string | null;
  /** Exact enclosing declaration/scope. Null is restricted to module initialization. */
  readonly owningDeclarationObservationId: string | null;
  readonly observationClass: SourceProgramObservationClass;
  readonly span: SourceProgramSpan;
}

/** Exact module-role binding projected onto one compiler-issued declaration. */
export interface SourceProgramOperationRoleProvenance {
  readonly declarationObservationId: string;
  readonly moduleId: string;
  readonly capability: string;
  readonly operation: string;
  readonly role: ModuleOperationRole;
  readonly semanticOperation: string;
  readonly requirementId: string | null;
}

export type SourceProgramCandidateCode =
  | 'causal-identity-unresolved'
  | 'causal-relation-owner-bypass'
  | 'capability-provider-operation-unresolved'
  | 'declared-dependency-without-source-consumer'
  | 'duplicate-entrypoint-command'
  | 'entrypoint-resolution-unknown'
  | 'generated-output-unresolved'
  | 'identity-token-without-consumer'
  | 'test-mirrors-production-identity-literal'
  | 'test-mirrors-production-literal-collection'
  | 'test-mirrors-production-source-path'
  | 'production-declaration-without-consumer'
  | 'production-declaration-only-test-consumers'
  | 'production-embeds-executable-source-text'
  | 'production-mirrors-source-path'
  | 'duplicate-production-source-path-owner'
  | 'duplicate-production-identity-token'
  | 'duplicate-production-endpoint-literal'
  | 'versioned-declaration-conflicts-with-canonical-name'
  | 'direct-process-transport-outside-owner'
  | 'process-resource-session-boundary-unresolved'
  | 'durable-worker-domain-import'
  | 'durable-worker-generic-input-exposed'
  | 'operation-issuer-role-conflict'
  | 'operation-issuer-role-outside-owner'
  | 'operation-critical-role-unresolved'
  | 'operation-recovery-binding-unresolved';

/**
 * Derived contradictions that are never valid migration residue.
 *
 * Other candidates can describe incomplete discovery or an explicitly tracked
 * owner migration. These two mean the compiled source program already proves
 * that two repository surfaces claim the same fact, so repository admission
 * must reject them instead of merely reporting them.
 */
export const SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODES = Object.freeze([
  'causal-identity-unresolved',
  'causal-relation-owner-bypass',
  'direct-process-transport-outside-owner',
  'process-resource-session-boundary-unresolved',
  'durable-worker-domain-import',
  'durable-worker-generic-input-exposed',
  'duplicate-production-endpoint-literal',
  'duplicate-entrypoint-command',
  'duplicate-production-identity-token',
  'duplicate-production-source-path-owner',
  'production-embeds-executable-source-text',
  'operation-issuer-role-conflict',
  'operation-issuer-role-outside-owner',
  'operation-critical-role-unresolved',
  'operation-recovery-binding-unresolved',
  'versioned-declaration-conflicts-with-canonical-name',
  'test-mirrors-production-identity-literal',
  'test-mirrors-production-literal-collection',
  'test-mirrors-production-source-path'
] as const satisfies readonly SourceProgramCandidateCode[]);

export interface SourceProgramCausalRelationEvidence {
  readonly owner: string;
  readonly intent: ModuleCausalRelation;
  readonly declaration: Readonly<{
    readonly observationId: string | null;
    readonly declarationDigest: string | null;
  }>;
  readonly sourceRevision: string;
  readonly observationClass: 'derived' | 'unknown';
  readonly reason: 'exact-symbol' | 'symbol-ambiguous' | 'symbol-missing';
  readonly evidenceDigest: string;
}

type SourceProgramReturnArgumentProvenance =
  | Readonly<{ readonly kind: 'parameter'; readonly index: number }>
  | Readonly<{ readonly kind: 'literal' }>
  | Readonly<{ readonly kind: 'opaque' }>;

export type SourceProgramReturnValueProvenance =
  | Readonly<{
    readonly kind: 'call-result';
    readonly targetObservationId: string;
    readonly arguments: readonly (readonly SourceProgramReturnArgumentProvenance[])[];
  }>
  | SourceProgramReturnArgumentProvenance;

/**
 * Bounded normal-return provenance cache hint. Causal consumers must use the
 * current exact live Program receipt instead of trusting a persisted copy.
 */
export interface SourceProgramReturnProvenance {
  readonly path: string;
  readonly declarationObservationId: string;
  readonly normalReturns: readonly SourceProgramReturnValueProvenance[];
}


export interface SourceProgramCandidate {
  readonly code: SourceProgramCandidateCode;
  readonly subject: string;
  readonly paths: readonly string[];
  readonly reason: string;
  readonly observationClass: 'derived' | 'unknown';
}

export interface SourceProgramModel {
  readonly sourceRevision: string;
  readonly providers: readonly Readonly<{
    readonly id: string;
    readonly revision: string;
  }>[];
  readonly files: readonly SourceProgramFile[];
  readonly declarations: readonly SourceProgramDeclaration[];
  readonly references: readonly SourceProgramReference[];
  readonly returnProvenances: readonly SourceProgramReturnProvenance[];
  readonly literals: readonly SourceProgramLiteral[];
  readonly entrypoints: readonly SourceProgramEntrypoint[];
  readonly entrypointClosures: readonly SourceProgramEntrypointClosure[];
  readonly packages: readonly SourceProgramPackage[];
  readonly dependencies: readonly SourceProgramDependency[];
  readonly capabilities: readonly SourceProgramCapabilityInvocation[];
  readonly candidates: readonly SourceProgramCandidate[];
  readonly unknowns: readonly SourceProgramUnknown[];
  readonly modelDigest: string;
}

type SourceProgramResponsibilityEvidenceReason =
  | 'validated'
  | 'semantic-binding-invalid'
  | 'exported-declaration-missing'
  | 'exported-declaration-ambiguous'
  | 'declaration-binding-conflict';

/**
 * Exact Source Program readback of one validated semantic responsibility
 * binding. Unknown evidence is retained as data; it never becomes a role.
 */
export interface SourceProgramResponsibilityEvidence {
  readonly bindingId: string;
  readonly responsibilityId: string;
  readonly target: Readonly<{
    readonly kind: SemanticResponsibilityTargetKind;
    readonly id: string;
  }>;
  readonly declaration: Readonly<{
    readonly path: string;
    readonly exportName: string;
    readonly observationId: string | null;
    readonly declarationDigest: string | null;
    readonly moduleId: string | null;
  }>;
  readonly sourceRevision: string;
  readonly semanticRevision: string;
  readonly observationClass: 'observed' | 'unknown';
  readonly reason: SourceProgramResponsibilityEvidenceReason;
  readonly evidenceDigest: string;
}

/**
 * Machine-owned design purpose for one repository module.  This is compiled
 * only from the strict module descriptor and the exact Source Program
 * entrypoint closure; prose, filenames and dormant declarations are not
 * intent evidence.
 */
export interface SourceProgramOwnerIntentEvidence {
  readonly owner: string;
  readonly capabilityEnvelope: readonly Readonly<{
    readonly capability: string;
    readonly operations: readonly string[];
  }>[];
  readonly publicEntrypointEnvelope: readonly Readonly<{
    readonly kind: SourceProgramEntrypointKind;
    readonly name: string;
    readonly targetPackages: readonly string[];
    readonly targetPaths: readonly string[];
    readonly transports: readonly SourceProgramCapabilityTransport[];
  }>[];
  readonly operationObligations: readonly SourceProgramOperationObligationEvidence[];
  readonly evidenceDigest: string;
}

export interface SourceProgramOperationObligationEvidence {
  readonly obligation: ModuleOperationObligation;
  readonly observation: Readonly<{
    readonly status: 'unknown' | 'verified';
    readonly reason: 'consumer-closure-unresolved' | 'effect-closure-unresolved' | 'identity-unresolved' | 'verified';
    readonly consumerModuleIds: readonly string[];
    readonly effectKinds: readonly string[];
  }>;
  readonly evidenceDigest: string;
}

export interface SourceProgramTopologySummary {
  readonly packages: number;
  readonly dependencyScopes: Readonly<Record<string, number>>;
  readonly entrypointKinds: Readonly<Record<string, number>>;
  /** Separates repository operations from executables supplied by dependencies. */
  readonly entrypointRoles: Readonly<Record<string, number>>;
  readonly entrypointHandlerModules: Readonly<Record<string, number>>;
  readonly entrypointObservationClasses: Readonly<Record<string, number>>;
  readonly capabilityKinds: Readonly<Record<string, number>>;
  readonly capabilityTransports: Readonly<Record<string, number>>;
  /** Distinguishes repository providers, mature package APIs and unresolved transports. */
  readonly capabilityAuthorityClasses: Readonly<Record<SourceProgramCapabilityAuthorityClass, number>>;
  readonly providerModules: Readonly<Record<string, number>>;
  readonly candidateCodes: Readonly<Record<string, number>>;
  readonly unknownCodes: Readonly<Record<string, number>>;
  readonly directProcessTransportPaths: number;
}

export interface SourceProgramQueryResult {
  readonly query: string;
  readonly declarations: readonly SourceProgramDeclaration[];
  readonly references: readonly SourceProgramReference[];
  readonly literals: readonly SourceProgramLiteral[];
  readonly entrypoints: readonly SourceProgramEntrypoint[];
  readonly entrypointClosures: readonly SourceProgramEntrypointClosure[];
  readonly packages: readonly SourceProgramPackage[];
  readonly dependencies: readonly SourceProgramDependency[];
  readonly capabilities: readonly SourceProgramCapabilityInvocation[];
  readonly candidates: readonly SourceProgramCandidate[];
  readonly files: readonly SourceProgramFile[];
  readonly unknowns: readonly SourceProgramUnknown[];
}
