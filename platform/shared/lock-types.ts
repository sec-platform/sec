import type { ManifestKind, ManifestSlotExport, SlotKind } from './plan-manifest-types.ts';
import type { RegistryKind, RegistryLocation } from './registry-types.ts';

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
  compose: PassState;
  adapt: PassState;
  verify: PassState;
  repair: PassState;
  lock: PassState;
  emit: PassState;
}

export interface PassExecutionState {
  status: PassState;
  transactionId?: string;
  inputRevision?: string;
  outputRevision?: string;
  startedAt?: string;
  completedAt?: string;
  diagnosticIds: string[];
}

export type PassExecutionLedger = Partial<Record<keyof PassStatus, PassExecutionState>>;

export interface LockFile {
  formatVersion: string;
  app: {
    name: string;
    stack: string;
    mode: string;
    target?: 'monolith' | 'microservices';
  };
  resolvedBlocks: ResolvedBlock[];
  resolvedCapabilities: string[];
  installPlan: InstallPlanStep[];
  slotTasks: SlotTask[];
  generatedPaths: string[];
  acceptancePlan: string[];
  passStatus: PassStatus;
  passExecutions?: PassExecutionLedger;
}
