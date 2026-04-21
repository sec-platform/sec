export type PackageManager = 'pnpm' | 'npm' | 'yarn';
export type AppMode = 'single-tenant' | 'multi-tenant';
export type SlotKind = 'adapter' | 'policy' | 'ux' | 'repair';
export type ManifestKind = 'capability' | 'strategy' | 'infra' | 'governance';
export type PassState = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export interface AcceptanceItem {
  id: string;
}

export interface PlanApp {
  name: string;
  stack: string;
  packageManager: PackageManager;
  mode: AppMode;
}

export interface PlanBlock {
  id: string;
  version?: string;
}

export interface PlanSlot {
  id: string;
  block: string;
  kind: SlotKind;
  target: string;
  symbol: string;
  description: string;
}

export interface PlanFile {
  app: PlanApp;
  blocks: PlanBlock[];
  slots: PlanSlot[];
  acceptance: AcceptanceItem[];
}

export interface ManifestPin {
  id: string;
  type: string;
  required?: boolean;
}

export interface InstallInstruction {
  kind: string;
  from: string;
  to: string;
}

export interface ManifestSlot {
  id: string;
  kind: SlotKind;
  target: string;
  symbol: string;
  inputType?: string;
  outputType?: string;
  writableZones?: string[];
}

export interface ManifestRoute {
  path: string;
  file: string;
}

export interface ManifestPins {
  inputs: ManifestPin[];
  outputs: ManifestPin[];
}

export interface BlockManifest {
  id: string;
  version: string;
  kind: ManifestKind;
  stackProfiles: string[];
  requires: string[];
  provides: string[];
  conflicts: string[];
  installs: InstallInstruction[];
  pins: ManifestPins;
  slots: ManifestSlot[];
  acceptance: AcceptanceItem[];
  routes: ManifestRoute[];
}

export interface ManifestEntry {
  manifest: BlockManifest;
  manifestPath: string;
}

export interface ResolvedBlock {
  id: string;
  version: string;
  kind: ManifestKind;
  installOrder: number;
  manifestPath: string;
}

export interface InstallPlanStep {
  stepId: string;
  blockId: string;
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
  symbol: string;
  kind: SlotKind;
  inputType?: string;
  outputType?: string;
  status: 'pending' | 'generated' | 'filled' | 'verified' | 'failed';
  writableZones: string[];
  provenanceHints: SlotProvenanceHints;
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

export interface LockFile {
  formatVersion: string;
  app: {
    name: string;
    stack: string;
    mode: string;
  };
  resolvedBlocks: ResolvedBlock[];
  resolvedCapabilities: string[];
  installPlan: InstallPlanStep[];
  slotTasks: SlotTask[];
  generatedPaths: string[];
  acceptancePlan: string[];
  passStatus: PassStatus;
}

export interface WorkspacePaths {
  workspaceRoot: string;
  projectRoot: string;
  planPath: string;
  lockPath: string;
  generatedDir: string;
  installManifestPath: string;
  verificationReportPath: string;
  projectPackagePath: string;
  provenancePath: string;
}

export interface TaskEnvelope {
  taskId: string;
  taskKind: `${SlotKind}-slot`;
  phase: 'adapt';
  targetBlock: string;
  targetFile: string;
  allowedPaths: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  inputContracts: {
    description: string;
  };
  testsToPass: string[];
  budget: {
    maxAttempts: number;
    timeoutSeconds: number;
    maxTokens: number;
  };
  expectedOutput: {
    type: 'source-file';
    language: 'typescript';
  };
  lockSummary: {
    blocks: string[];
  };
}

export interface VerificationReport {
  build: {
    status: 'passed' | 'failed';
  };
  unit: {
    status: 'passed' | 'failed';
    passed: string[];
  };
  acceptance: {
    status: 'passed' | 'failed';
    passed: string[];
    failed: string[];
  };
  summary: {
    status: 'passed' | 'failed';
  };
  logs: {
    stdout: string;
    stderr: string;
  };
}
