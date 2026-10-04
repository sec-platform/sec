import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import type {
  AgentSkillId,
  REPOSITORY_HEURISTIC_ROUTES,
  RepositorySurfaceKind
} from '../../self-hosting/control/agent/skill.ts';
import type { RepositoryModuleArchitectureProjection } from '../architecture/contract.ts';
import type { RepositoryModulePlacementAdmission } from '../architecture/placement.ts';
import type { SourceProgramModel } from '../source-program-model/contract.ts';
import type { SourceProgramDeclarationTopology } from '../source-program-model/declaration-topology.ts';
import type { RepositoryAuditSeverity } from './cli-contract.ts';

// This owner projects already-produced reports without acquiring source or
// running an audit. Keep full report shapes and fail-closed validation here;
// cli.ts retains its historical exports and the effectful command boundary.

export interface RepositoryAuditFinding {
  code: string;
  line?: number;
  message: string;
  path?: string;
  severity: RepositoryAuditSeverity;
  skills?: readonly AgentSkillId[];
}

export type RepositoryModuleArchitectureWithPlacement = RepositoryModuleArchitectureProjection & Readonly<{
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
      || !Array.isArray(report.findings)
      || report.findings.some((finding) => (
        finding === null || typeof finding !== 'object' || typeof finding.code !== 'string'
      ))
      || !Array.isArray(report.unknowns)
      || report.unknowns.some((unknown) => typeof unknown !== 'string')) {
    throw new RepositoryAuditCliProjectionContractError(
      'Repository audit CLI projection requires one complete canonical report source.'
    );
  }
}

/**
 * Interactive audit output is a decision projection, not a second report.
 * The exact full report remains available through --full or --output.
 */
export function projectRepositoryAuditCli(
  report: RepositoryAuditReport
): RepositoryAuditCliProjection {
  assertRepositoryAuditCliProjectionSource(report);
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
