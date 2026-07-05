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

export interface ManifestGenerator {
  id: string;
  kind: SemanticGeneratorKind;
  contract: string;
  state: string;
  target: string;
  consumes: SemanticGeneratorConsumeKind[];
  produces: SemanticGeneratorArtifactKind;
  typeBinding: ManifestGeneratorTypeBinding;
  verification: string[];
}

export interface SemanticGeneratorTask {
  id: string;
  blockId: string;
  generatorId: string;
  kind: SemanticGeneratorKind;
  contractId: string;
  contractPath: string;
  contractNamespace: string;
  stateId: string;
  target: string;
  consumes: SemanticGeneratorConsumeKind[];
  produces: SemanticGeneratorArtifactKind;
  typeBinding: ManifestGeneratorTypeBinding;
  verification: string[];
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
  status: SemanticGeneratorTaskStatus;
}
