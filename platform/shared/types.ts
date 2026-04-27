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
export type ExplainNodeType =
  | 'app'
  | 'block'
  | 'capability'
  | 'pin'
  | 'slot'
  | 'file'
  | 'acceptance'
  | 'policy'
  | 'override'
  | 'repair'
  | 'upgrade';
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

export interface UpgradeJsonArrayAppendMigrationEntry {
  id: string;
  kind: 'json-array-append';
  reason: string;
  target: string;
  path: string[];
  items: unknown[];
}

export interface UpgradeJsonArrayRemoveMigrationEntry {
  id: string;
  kind: 'json-array-remove';
  reason: string;
  target: string;
  path: string[];
  items: unknown[];
}

export interface UpgradeJsonObjectMergeMigrationEntry {
  id: string;
  kind: 'json-object-merge';
  reason: string;
  target: string;
  path: string[];
  value: Record<string, unknown>;
}

export interface UpgradeTextAppendMigrationEntry {
  id: string;
  kind: 'text-append';
  reason: string;
  target: string;
  content: string;
}

export interface UpgradeTextReplaceRegexMigrationEntry {
  id: string;
  kind: 'text-replace-regex';
  reason: string;
  target: string;
  pattern: string;
  replacement: string;
  flags?: string;
}

export interface UpgradeCreateDirectoryMigrationEntry {
  id: string;
  kind: 'create-directory';
  reason: string;
  target: string;
}

export interface UpgradeDeleteFileMigrationEntry {
  id: string;
  kind: 'delete-file';
  reason: string;
  target: string;
}

export interface UpgradeRenameFileMigrationEntry {
  id: string;
  kind: 'rename-file';
  reason: string;
  source: string;
  target: string;
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
  | UpgradeJsonArrayAppendMigrationEntry
  | UpgradeJsonArrayRemoveMigrationEntry
  | UpgradeJsonObjectMergeMigrationEntry
  | UpgradeTextAppendMigrationEntry
  | UpgradeTextReplaceRegexMigrationEntry
  | UpgradeCreateDirectoryMigrationEntry
  | UpgradeDeleteFileMigrationEntry
  | UpgradeRenameFileMigrationEntry
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
  ciArtifactsPath: string;
  sourceViewPath: string;
  slotRuleViewPath: string;
  repairPlanPath: string;
  upgradePlanPath: string;
  upgradeDiagnosticsPath: string;
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
  registrySourceId?: string;
  registryKind?: RegistryKind;
  registryLocation?: RegistryLocation;
  registryPath?: string;
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
  kind: 'summary' | 'policy' | 'build' | 'unit' | 'acceptance' | 'upgrade' | 'repair';
  message: string;
  artifactPath: string;
}

export interface ReviewRegressionRisk {
  kind: 'coverage-gap' | 'override-active' | 'upgrade-impact' | 'upgrade-verification' | 'repair-verification';
  message: string;
  blockId?: string;
  slotId?: string;
}

export interface ReviewConflictHint {
  kind:
    | 'override-conflict'
    | 'upgrade-plan-present'
    | 'upgrade-preflight-passed'
    | 'repair-plan-present'
    | 'repair-blocked';
  message: string;
  relatedId: string;
}

export type ReviewRuntimeEntryKind = 'page' | 'api';

export interface ReviewRuntimeEntry {
  path: string;
  kind: ReviewRuntimeEntryKind;
  vertical?: string;
  relatedBlocks: string[];
}

export interface ReviewVerticalSlice {
  id: string;
  runtimeEntries: string[];
  relatedBlocks: string[];
}

export interface ReviewInstallImpact {
  blockId: string;
  actionKinds: string[];
  sourceRoots: string[];
  targetPaths: string[];
  verticals: string[];
  runtimeEntries: string[];
}

export interface ReviewCiSummary {
  status: 'passed' | 'attention' | 'failed';
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  impactedBlockCount: number;
  impactedSlotCount: number;
  runtimeEntryCount: number;
}

export interface ReviewArtifactMissingEntry {
  path: string;
  reason: string;
  declaredBy: string;
}

export interface ReviewArtifactUploadGroup {
  kind: string;
  count: number;
  paths: string[];
}

export interface ReviewArtifactSummary {
  artifactStatus?: 'passed' | 'attention';
  artifactCount: number;
  governanceCount: number;
  viewCount: number;
  testCount?: number;
  missingCount: number;
  missingReasonCounts?: Record<string, number>;
  uploadGroups?: ReviewArtifactUploadGroup[];
  missing?: ReviewArtifactMissingEntry[];
}

export interface ReviewRepairTaskSummary {
  taskId: string;
  sourceSlotId: string;
  targetBlock: string;
  targetFile: string;
  previewStatus: 'changed' | 'unchanged' | 'missing';
  addedLines: number;
  removedLines: number;
  failurePointCount: number;
  targetIds: string[];
}

export interface ReviewRepairBlockerSummary {
  blockerId: string;
  boundary: string;
  reason: string;
  decisionRequired: string;
  failurePointCount: number;
}

export interface ReviewRepairSummary {
  status: 'pending' | 'applied' | 'skipped' | 'blocked';
  sourceVerificationStatus: 'passed' | 'failed';
  requiresVerification: boolean;
  taskCount: number;
  blockerCount: number;
  previewCount: number;
  changedPreviewCount: number;
  failurePointCount: number;
  targetFiles: string[];
  taskSummaries: ReviewRepairTaskSummary[];
  blockerSummaries: ReviewRepairBlockerSummary[];
}

export interface ReviewUpgradePreflightSummary {
  group: string;
  checkCount: number;
  evidenceCount: number;
}

export interface ReviewUpgradeMigrationSummary {
  id: string;
  kind: string;
  target: string;
  reason: string;
  requiresVerification: boolean;
  source?: string;
  slotId?: string;
}

export interface ReviewUpgradeDiagnosticsSummary {
  status: 'blocked';
  failedCheck: string;
  errorCode: string;
  message: string;
}

export interface ReviewUpgradeSummary {
  status: 'planned' | 'applied' | 'blocked';
  blockId: string;
  fromVersion?: string;
  toVersion: string;
  preflightCheckCount: number;
  preflightEvidenceCount: number;
  migrationCount: number;
  migrationKindCounts: Record<string, number>;
  requiresVerification: boolean;
  requiresVerificationCount: number;
  impactCount: number;
  impacts: string[];
  preflightSummaries: ReviewUpgradePreflightSummary[];
  migrationSummaries: ReviewUpgradeMigrationSummary[];
  diagnostics?: ReviewUpgradeDiagnosticsSummary;
}

export interface ReviewPolicySourceSummary {
  scope: PolicySourceScope;
  path: string;
  policyIds: string[];
}

export interface ReviewPolicyMergedSummary {
  id: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
  targetCount: number;
  targets: string[];
}

export interface ReviewPolicyViolationSummary {
  id: string;
  severity: PolicySeverity;
  rule: string;
  fileCount: number;
  files: string[];
  appliesTo: string[];
  message: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
}

export interface ReviewPolicySummary {
  status: 'passed' | 'failed' | 'skipped';
  officialPolicyCount: number;
  projectPolicyCount: number;
  mergedPolicyCount: number;
  sourceCount: number;
  violationCount: number;
  severityCounts: Partial<Record<PolicySeverity, number>>;
  sourceSummaries: ReviewPolicySourceSummary[];
  mergedSummaries: ReviewPolicyMergedSummary[];
  violationSummaries: ReviewPolicyViolationSummary[];
}

export interface ReviewSummary {
  formatVersion: '2';
  ciSummary: ReviewCiSummary;
  artifactSummary?: ReviewArtifactSummary;
  repairSummary?: ReviewRepairSummary;
  upgradeSummary?: ReviewUpgradeSummary;
  policySummary?: ReviewPolicySummary;
  changeSources: Array<{
    path: string;
    originType: ProvenanceOriginType;
    originId: string;
    registrySourceId?: string;
    registryKind?: RegistryKind;
    registryLocation?: RegistryLocation;
    runtimeKind?: ReviewRuntimeEntryKind;
    vertical?: string;
    relatedBlocks?: string[];
  }>;
  runtimeEntries: ReviewRuntimeEntry[];
  verticalSlices: ReviewVerticalSlice[];
  installImpacts: ReviewInstallImpact[];
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
  targetIds?: string[];
}

export interface RepairTaskPreview {
  beforeLines: number;
  afterLines: number;
  addedLines: number;
  removedLines: number;
  changed: boolean;
}

export interface RepairBlocker {
  blockerId: string;
  reason: string;
  boundary: 'slot' | 'spec' | 'kernel' | 'scope' | 'unknown';
  decisionRequired: string;
  failurePoints: RepairFailurePoint[];
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
  preview?: RepairTaskPreview;
}

export interface RepairPlan {
  formatVersion: string;
  status: 'pending' | 'applied' | 'skipped' | 'blocked';
  sourceVerificationStatus: 'passed' | 'failed';
  requiresVerification: boolean;
  tasks: RepairTask[];
  blockers?: RepairBlocker[];
}

export interface UpgradeMigrationSummary {
  id: string;
  kind: string;
  target: string;
  reason: string;
  requiresVerification: boolean;
  slotId?: string;
  source?: string;
}

export type UpgradePreflightCheckId =
  | 'version-range'
  | 'migration-entries'
  | 'migration-targets'
  | 'migration-file-operations'
  | 'migration-json-shapes'
  | 'migration-json-structure'
  | 'migration-text-patterns'
  | 'migration-slot-contracts'
  | 'impact-scan'
  | 'override-conflicts';

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
  migrationKindCounts: Record<string, number>;
  migrationSummaries: UpgradeMigrationSummary[];
}

export interface UpgradeDiagnostics {
  formatVersion: string;
  status: 'blocked';
  blockId: string;
  targetVersion: string;
  failedCheck: UpgradePreflightCheckId | 'target-manifest' | 'plan-block';
  errorCode: string;
  message: string;
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
