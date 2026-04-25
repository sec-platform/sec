export type PackageManager = 'pnpm' | 'npm' | 'yarn';
export type AppMode = 'single-tenant' | 'multi-tenant';
export type SlotKind = 'adapter' | 'policy' | 'ux' | 'repair';
export type ManifestKind = 'capability' | 'strategy' | 'infra' | 'governance';
export type RegistryKind = 'official' | 'private' | 'community';
export type RegistryLocation = 'compiler' | 'workspace';
export type PassState = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';
export type VerificationLane = 'fast' | 'runtime' | 'all';
export type VerificationStatus = 'passed' | 'failed' | 'skipped';
export type ProvenanceOriginType = 'block' | 'slot' | 'generated' | 'override';
export type OverrideStatus = 'none' | 'manual' | 'rule-backed';
export type OverrideSource = 'manual' | 'rule-backed';
export type OverrideApplyPhase = 'compose' | 'adapt';
export type ExplainNodeType = 'app' | 'block' | 'capability' | 'pin' | 'slot' | 'file' | 'acceptance' | 'policy' | 'override';
export type ExplainEdgeType =
  | 'depends_on'
  | 'provides'
  | 'connects_to'
  | 'writes_to'
  | 'verified_by'
  | 'originates_from'
  | 'violates';
export type PolicySeverity = 'info' | 'warn' | 'error' | 'blocker';
export type PolicySourceScope = 'official' | 'project';

export interface AcceptanceItem {
  id: string;
  dependsOn?: string[];
  covers?: {
    blocks?: string[];
    slots?: string[];
  };
}

export interface PlanApp {
  name: string;
  stack: string;
  packageManager: PackageManager;
  mode: AppMode;
}

export interface PlanRegistrySource {
  id: string;
  kind: RegistryKind;
  location: RegistryLocation;
  path: string;
}

export interface PlanRegistry {
  sources: PlanRegistrySource[];
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
  registry: PlanRegistry;
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

export interface ManifestCompatibility {
  blockApi: string;
  compilerApi: string;
  stackProfiles: string[];
}

export interface UpgradeMigration {
  id: string;
  kind: string;
  entry: string;
  fromVersion?: string;
  toVersion?: string;
  requiresVerification?: boolean;
}

export interface UpgradeFileReplaceMigrationEntry {
  id: string;
  kind: 'file-replace';
  reason: string;
  source: string;
  target: string;
}

export interface UpgradeConfigRewriteMigrationEntry {
  id: string;
  kind: 'config-rewrite';
  reason: string;
  target: string;
  updates: Array<{
    path: string[];
    value?: unknown;
    operation?: 'set' | 'delete';
  }>;
}

export interface UpgradeSlotContractUpdateMigrationEntry {
  id: string;
  kind: 'slot-contract-update';
  reason: string;
  target: string;
  slotId: string;
  inputType?: string;
  outputType?: string;
  writableZones?: string[];
}

export type UpgradeMigrationEntry =
  | UpgradeFileReplaceMigrationEntry
  | UpgradeConfigRewriteMigrationEntry
  | UpgradeSlotContractUpdateMigrationEntry;

export interface UpgradeConfig {
  from: string[];
  migrations: UpgradeMigration[];
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
  compatibility?: ManifestCompatibility;
  requires: string[];
  provides: string[];
  conflicts: string[];
  installs: InstallInstruction[];
  pins: ManifestPins;
  slots: ManifestSlot[];
  acceptance: AcceptanceItem[];
  routes: ManifestRoute[];
  upgrade?: UpgradeConfig;
}

export interface ManifestEntry {
  manifest: BlockManifest;
  manifestPath: string;
  manifestRoot: string;
  registryRoot: string;
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
}

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
  privateRegistryRoot: string;
  generatedViewsDir: string;
  planPath: string;
  lockPath: string;
  generatedDir: string;
  overrideManifestPath: string;
  policySpecPath: string;
  officialPoliciesRoot: string;
  projectPoliciesRoot: string;
  installManifestPath: string;
  verificationReportPath: string;
  acceptanceCoveragePath: string;
  policyReportPath: string;
  runtimeReportPath: string;
  explainGraphPath: string;
  reviewSummaryPath: string;
  sourceViewPath: string;
  slotRuleViewPath: string;
  repairPlanPath: string;
  upgradePlanPath: string;
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

export interface VerificationStepReport {
  status: VerificationStatus;
  passed: string[];
  failed: string[];
  command: string | null;
}

export interface VerificationLogs {
  stdout: string;
  stderr: string;
}

export interface PolicyReport {
  status: 'passed' | 'failed' | 'skipped';
  official: {
    policies: string[];
    sources: PolicySourceFileReport[];
    violations: PolicyViolation[];
  };
  project: {
    policies: string[];
    sources: PolicySourceFileReport[];
    violations: PolicyViolation[];
  };
  merged: {
    policies: MergedPolicyReportEntry[];
  };
  violations: PolicyViolation[];
}

export interface FastVerificationLaneReport {
  status: VerificationStatus;
  build: {
    status: VerificationStatus;
  };
  unit: {
    status: VerificationStatus;
    passed: string[];
  };
  acceptance: {
    status: VerificationStatus;
    passed: string[];
    failed: string[];
  };
  policy: {
    status: 'passed' | 'failed' | 'skipped';
    violations: PolicyViolation[];
  };
  policyReport?: PolicyReport;
  logs: VerificationLogs;
}

export interface RuntimeVerificationLaneReport {
  status: VerificationStatus;
  build: VerificationStepReport;
  unit: VerificationStepReport;
  acceptance: VerificationStepReport;
  logs: VerificationLogs;
}

export interface VerificationReport {
  build: FastVerificationLaneReport['build'];
  unit: FastVerificationLaneReport['unit'];
  acceptance: FastVerificationLaneReport['acceptance'];
  policy: FastVerificationLaneReport['policy'];
  fast: FastVerificationLaneReport;
  runtime: RuntimeVerificationLaneReport;
  summary: {
    status: 'passed' | 'failed';
    requestedLane: VerificationLane;
    failedLanes: Array<'fast' | 'runtime'>;
  };
  logs: VerificationLogs;
}

export interface PolicyRule {
  id: string;
  severity: PolicySeverity;
  appliesTo: string[];
  rule: string;
}

export interface PolicySpec {
  policies: PolicyRule[];
}

export interface PolicySourceFileReport {
  path: string;
  policyIds: string[];
}

export interface MergedPolicyReportEntry {
  id: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
  targets: string[];
}

export interface PolicyViolation {
  id: string;
  severity: PolicySeverity;
  appliesTo: string[];
  rule: string;
  files: string[];
  message: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
}

export interface ProvenanceArtifact {
  path: string;
  originType: ProvenanceOriginType;
  originId: string;
  sourceBlock?: string;
  generatedByPass?: string;
  generatorTaskId?: string;
  verifiedBy: string[];
  overrideStatus: OverrideStatus;
}

export interface ProvenanceFile {
  formatVersion: string;
  artifacts: ProvenanceArtifact[];
}

export interface ExplainGraphNode {
  id: string;
  type: ExplainNodeType;
  label: string;
}

export interface ExplainGraphEdge {
  from: string;
  to: string;
  type: ExplainEdgeType;
}

export interface CoverageOverlay {
  blocks: Array<{
    id: string;
    coveredBy: string[];
  }>;
  slots: Array<{
    id: string;
    coveredBy: string[];
  }>;
}

export interface ExplainGraph {
  nodes: ExplainGraphNode[];
  edges: ExplainGraphEdge[];
  overlays: {
    provenance: ProvenanceArtifact[];
    coverage: CoverageOverlay;
  };
}

export interface AcceptanceCoverageEntry {
  id: string;
  declaredAcceptance: string[];
  coveredBy: string[];
  uncovered: boolean;
}

export interface AcceptanceCoverageReport {
  formatVersion: string;
  status: VerificationStatus;
  acceptancePassed: string[];
  blocks: AcceptanceCoverageEntry[];
  slots: AcceptanceCoverageEntry[];
  uncoveredBlocks: string[];
  uncoveredSlots: string[];
}

export interface ReviewFailurePoint {
  lane: 'fast' | 'runtime' | 'all';
  kind: 'summary' | 'policy' | 'build' | 'unit' | 'acceptance';
  message: string;
  artifactPath: string;
}

export interface ReviewRegressionRisk {
  kind: 'coverage-gap' | 'override-active' | 'upgrade-impact' | 'upgrade-verification';
  message: string;
  blockId?: string;
  slotId?: string;
}

export interface ReviewConflictHint {
  kind: 'override-conflict' | 'upgrade-plan-present' | 'upgrade-preflight-passed' | 'repair-plan-present';
  message: string;
  relatedId: string;
}

export interface ReviewSummary {
  formatVersion: '2';
  changeSources: Array<{
    path: string;
    originType: ProvenanceOriginType;
    originId: string;
  }>;
  impactedBlocks: string[];
  impactedSlots: string[];
  failurePoints: ReviewFailurePoint[];
  regressionRisks: ReviewRegressionRisk[];
  conflictHints: ReviewConflictHint[];
}

export interface RepairFailurePoint {
  lane: 'fast' | 'runtime' | 'all';
  kind: 'build' | 'unit' | 'acceptance' | 'policy' | 'runtime-build' | 'runtime-unit' | 'runtime-acceptance' | 'summary';
  issueType: 'slot' | 'spec' | 'kernel' | 'unknown';
  repairable: boolean;
  artifactPath: string;
  message: string;
}

export interface RepairTask {
  taskId: string;
  taskKind: 'repair-slot';
  phase: 'repair';
  sourceSlotId: string;
  targetBlock: string;
  targetFile: string;
  allowedPaths: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  testsToPass: string[];
  failureSummary: string;
  failurePoints: RepairFailurePoint[];
}

export interface RepairPlan {
  formatVersion: string;
  status: 'pending' | 'applied' | 'skipped';
  sourceVerificationStatus: 'passed' | 'failed';
  tasks: RepairTask[];
}

export interface UpgradeMigrationSummary {
  id: string;
  kind: string;
  target: string;
  reason: string;
  requiresVerification: boolean;
  slotId?: string;
}

export type UpgradePreflightCheckId = 'version-range' | 'migration-entries' | 'impact-scan' | 'override-conflicts';

export interface UpgradePreflightCheck {
  id: UpgradePreflightCheckId;
  status: 'passed';
  message: string;
  evidence: string[];
}

export interface UpgradePlan {
  formatVersion: string;
  blockId: string;
  fromVersion: string;
  toVersion: string;
  status: 'planned' | 'applied';
  preflightChecks: UpgradePreflightCheck[];
  impacts: string[];
  migrations: UpgradeMigration[];
  migrationSummaries: UpgradeMigrationSummary[];
}

export interface OverrideEntry {
  id: string;
  entry: string;
  target: string;
  reason: string;
  source: OverrideSource;
  appliesAfter: OverrideApplyPhase[];
  conflictsWith: string[];
}

export interface OverrideManifest {
  overrides: OverrideEntry[];
}
