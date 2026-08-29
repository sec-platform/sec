import type { ManifestKind, SlotKind } from './plan-manifest.ts';
import type { RegistryKind, RegistryLocation } from '../registry/contract/types.ts';
import type { SemanticGeneratorTask as SemanticLoweringTask } from '../../semantic/generation/contract/types.ts';
import type { SemanticViewSet } from '../../semantic/projection/contract/types.ts';

export const LOCK_FILE_FORMAT_VERSION = '1' as const;
export const LOCK_PASS_STATES = ['pending', 'running', 'succeeded', 'failed', 'blocked', 'skipped'] as const;
export const LOCK_SLOT_TASK_STATUSES = ['pending', 'generated', 'filled', 'verified', 'failed'] as const;
export const LOCK_APP_TARGETS = ['monolith', 'microservices'] as const;

export type PassState = (typeof LOCK_PASS_STATES)[number];

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
  status: (typeof LOCK_SLOT_TASK_STATUSES)[number];
  writableZones: string[];
  provenanceHints: SlotProvenanceHints;
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
  formatVersion: typeof LOCK_FILE_FORMAT_VERSION;
  app: {
    id: string;
    name: string;
    stack: string;
    mode: string;
    target?: (typeof LOCK_APP_TARGETS)[number];
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
