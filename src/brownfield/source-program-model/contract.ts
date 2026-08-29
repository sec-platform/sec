export const REPOSITORY_AUDIT_ENTRYPOINT_PATH = 'src/brownfield/repository-audit/cli.ts' as const;

export type SourceProgramObservationClass = 'observed' | 'derived' | 'unknown';

export type SourceProgramSurface =
  | 'production'
  | 'test'
  | 'fixture'
  | 'workflow'
  | 'resource';

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

export interface SourceProgramFile {
  readonly path: string;
  readonly contentDigest: string;
  readonly moduleId: string | null;
  readonly surface: SourceProgramSurface;
}

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

export type SourceProgramCapabilityKind =
  | 'process'
  | 'filesystem'
  | 'network'
  | 'dynamic-code'
  | 'provider';

export type SourceProgramCapabilityTransport =
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
  readonly observationClass: SourceProgramObservationClass;
  readonly span: SourceProgramSpan;
}

export type SourceProgramCandidateCode =
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
  | 'production-mirrors-source-path'
  | 'duplicate-production-source-path-owner'
  | 'duplicate-production-identity-token'
  | 'duplicate-production-endpoint-literal'
  | 'versioned-declaration-conflicts-with-canonical-name'
  | 'versioned-declaration-without-coexisting-version'
  | 'direct-process-transport-outside-owner';

/**
 * Derived contradictions that are never valid migration residue.
 *
 * Other candidates can describe incomplete discovery or an explicitly tracked
 * owner migration. These two mean the compiled source program already proves
 * that two repository surfaces claim the same fact, so repository admission
 * must reject them instead of merely reporting them.
 */
export const SOURCE_PROGRAM_BLOCKING_CANDIDATE_CODES = Object.freeze([
  'direct-process-transport-outside-owner',
  'duplicate-production-endpoint-literal',
  'duplicate-entrypoint-command',
  'duplicate-production-identity-token',
  'duplicate-production-source-path-owner',
  'versioned-declaration-conflicts-with-canonical-name',
  'versioned-declaration-without-coexisting-version',
  'test-mirrors-production-identity-literal',
  'test-mirrors-production-literal-collection',
  'test-mirrors-production-source-path'
] as const satisfies readonly SourceProgramCandidateCode[]);


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
