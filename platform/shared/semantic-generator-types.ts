import type { RegistryKind, RegistryLocation } from './registry-types.ts';

export const SEMANTIC_GENERATOR_KINDS = ['generate-state-transition-map'] as const;
export const SEMANTIC_GENERATOR_CONSUME_KINDS = ['state', 'transition'] as const;
export const SEMANTIC_GENERATOR_ARTIFACT_KINDS = ['typescript-runtime-contract'] as const;

export type SemanticGeneratorKind = (typeof SEMANTIC_GENERATOR_KINDS)[number];
export type SemanticGeneratorConsumeKind = (typeof SEMANTIC_GENERATOR_CONSUME_KINDS)[number];
export type SemanticGeneratorArtifactKind = (typeof SEMANTIC_GENERATOR_ARTIFACT_KINDS)[number];
export type SemanticGeneratorTaskStatus = 'pending' | 'generated' | 'verified' | 'failed';

export interface ManifestGeneratorTypeBinding {
  name: string;
  importFrom: string;
}

interface ManifestGeneratorBase {
  id: string;
  target: string;
  consumes: SemanticGeneratorConsumeKind[];
  produces: SemanticGeneratorArtifactKind;
  verification: string[];
}

export interface StateTransitionMapManifestGenerator extends ManifestGeneratorBase {
  kind: 'generate-state-transition-map';
  contract: string;
  state: string;
  typeBinding: ManifestGeneratorTypeBinding;
}

export type ManifestGenerator = StateTransitionMapManifestGenerator;

export interface SemanticGeneratorDeclaration {
  blockId: string;
  manifestPath: string;
  declaration: ManifestGenerator;
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
}

export interface StateTransitionPlanEntry {
  from: string;
  to: string;
  by: string;
  operationEntityId: string;
}

interface SemanticGeneratorPlanTaskBase {
  id: string;
  blockId: string;
  generatorId: string;
  generatorEntityId: string;
  artifactEntityId: string;
  inputRevision: string;
  semanticRevision: string;
  contractId: string;
  contractPath: string;
  contractNamespace: string;
  target: string;
  consumes: SemanticGeneratorConsumeKind[];
  produces: SemanticGeneratorArtifactKind;
  verification: string[];
  verifiedByEntityIds: string[];
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
}

export interface StateTransitionMapGeneratorPlanTask extends SemanticGeneratorPlanTaskBase {
  kind: 'generate-state-transition-map';
  stateId: string;
  stateEntityId: string;
  stateValues: string[];
  transitions: StateTransitionPlanEntry[];
  typeBinding: ManifestGeneratorTypeBinding;
}

export type SemanticGeneratorPlanTask = StateTransitionMapGeneratorPlanTask;

export interface SemanticGeneratorPlan {
  inputRevision: string;
  semanticRevision: string;
  tasks: readonly SemanticGeneratorPlanTask[];
}

export interface SemanticGeneratorArtifactBinding {
  generatorEntityId: string;
  artifactEntityId: string;
  semanticRevision: string;
  compilationTransactionId: string;
}

export type SemanticGeneratorTask = SemanticGeneratorPlanTask & {
  status: SemanticGeneratorTaskStatus;
  artifactBinding?: SemanticGeneratorArtifactBinding;
};
