import type { SourceProgramOwnerIntentEvidence } from './contract.ts';
import type { SourceProgramTestDefinitionContext, SourceProgramTestDefinitionInputs, SourceProgramTestSemanticClass } from './test-observations.ts';

export interface SourceProgramSupersessionEvidenceIdentity {
  /** Digest of the exact repository revision locator resolved by the Git owner. */
  readonly revisionDigest: string;
  /** Digest of the exact repository tree compiled into the Source Program. */
  readonly treeDigest: string;
  /** Digest of the compiler and provider capability closure. */
  readonly toolchainDigest: string;
  /** Digest of every configuration input that can change compiled facts. */
  readonly configurationDigest: string;
  /** Digest of the strict evidence grammar consumed by this compiler. */
  readonly schemaDigest: string;
}

export type SourceProgramSupersessionEvidenceIdentityInput = Omit<
  SourceProgramSupersessionEvidenceIdentity,
  'schemaDigest'
>;

export interface SourceProgramSemanticUnit {
  readonly id: string;
  readonly occurrenceId: string;
  readonly owner: string | null;
  readonly path: string;
  readonly signature: string;
}

export interface SourceProgramSupersessionTestUnit {
  readonly testId: string;
  readonly path: string;
  readonly owner: string | null;
  readonly registrationContentDigest: string;
  readonly semanticClasses: readonly SourceProgramTestSemanticClass[];
  readonly observedProductionPaths: readonly string[];
  readonly capabilityOperations: readonly string[];
  readonly unknowns: readonly string[];
  readonly definitionInputDigest: string;
}

export interface SourceProgramSupersessionEvidence {
  readonly actionKey: string;
  readonly identity: Readonly<SourceProgramSupersessionEvidenceIdentity & {
    readonly sourceRevision: string;
  }>;
  readonly source: Readonly<{
    readonly modelDigest: string;
    readonly testCompilationDigest: string;
    readonly intentEvidenceDigest: string;
  }>;
  readonly productionUnits: readonly SourceProgramSemanticUnit[];
  readonly resourceUnits: readonly SourceProgramSemanticUnit[];
  readonly entrypointUnits: readonly SourceProgramSemanticUnit[];
  readonly tests: readonly SourceProgramSupersessionTestUnit[];
  readonly testDefinitionInputs: readonly SourceProgramTestDefinitionInputs[];
  readonly testDefinitionContext: SourceProgramTestDefinitionContext | null;
  readonly intentEvidence: readonly SourceProgramOwnerIntentEvidence[];
  readonly unknowns: readonly Readonly<{
    readonly code: string;
    readonly path: string;
    readonly detail: string;
    readonly spanDigest: string;
    readonly sourceContentDigest: string | null;
    readonly dependencyInputDigest: string;
  }>[];
  readonly evidenceDigest: string;
}
