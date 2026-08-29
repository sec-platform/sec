import type { ManifestKind, ManifestSlotExport, SlotKind } from './plan-manifest.ts';
import type { RegistryKind, RegistryLocation } from '../../registry/index.ts';
import type { SemanticGeneratorTask as SemanticLoweringTask } from '../../semantic/generation/index.ts';
import type { SemanticViewSet } from '../../semantic/projection/index.ts';

export type PassState = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export interface ResolvedBlock {
  id: string;
  version: string;
  kind: ManifestKind;
  installOrder: number;
  manifestPath: string;
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
}

export interface InstallPlanStep {
  stepId: string;
  blockId: string;
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
  sourceRoot: string;
  action: string;
  from: string;
  to: string;
}

export interface SlotProvenanceHints {
  generator: string | null;
  verifiedBy: string[];
}

export interface SlotTask {
  id: string;
  block: string;
  target: string;
  sourcePath?: string;
  symbol: string;
  kind: SlotKind;
  inputType?: string;
  outputType?: string;
  status: 'pending' | 'generated' | 'filled' | 'verified' | 'failed';
  writableZones: string[];
  provenanceHints: SlotProvenanceHints;
  exports?: ManifestSlotExport[];
  mockTemplate?: string;
}

export interface PassStatus {
  parse: PassState;
  align: PassState;
  resolve: PassState;
  /** Optional only while pre-P0-3 lock fixtures/artifacts remain readable. */
  'build-ir'?: PassState;
  compose: PassState;
  adapt: PassState;
  verify: PassState;
  repair: PassState;
  lock: PassState;
  emit: PassState;
}

export interface LockFile {
  formatVersion: string;
  app: {
    id: string;
    name: string;
    stack: string;
    mode: string;
    target?: 'monolith' | 'microservices';
  };
  resolvedBlocks: ResolvedBlock[];
  resolvedCapabilities: string[];
  installPlan: InstallPlanStep[];
  slotTasks: SlotTask[];
  semanticLoweringTasks?: SemanticLoweringTask[];
  semanticViews?: SemanticViewSet;
  generatedPaths: string[];
  acceptancePlan: string[];
  passStatus: PassStatus;
}
