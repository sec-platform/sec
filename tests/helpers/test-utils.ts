import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect } from 'vitest';

import { createDefaultRegistry } from '../../platform/cli/index.ts';
import {
  ACCEPTANCE_USAGE,
  LOCK_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  REPAIR_USAGE
} from '../../platform/cli/usage.ts';
import { buildReviewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { CI_ARTIFACT_FILES, emptyCiArtifactMissingReasonCounts } from '../../platform/shared/ci-artifact-contract.ts';
import type {
  CiArtifactKind,
  CiArtifactMissingReason,
  CiArtifactUploadGroup
} from '../../platform/shared/ci-artifact-types.ts';
import { PASS_STATUS_PENDING, SUPPORTED_STACK } from '../../platform/shared/constants.ts';
import { buildErrorProtocol } from '../../platform/shared/error-protocol.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import {
  compilerRoot,
  getWorkspacePaths,
  officialRegistryRelativePath,
  privateRegistryRelativePath
} from '../../platform/shared/paths.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ManifestEntry,
  PlanFile,
  PolicyReport,
  ProvenanceFile,
  RepairPlan,
  ReviewProvenanceRegistrySummary,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../../platform/shared/types.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';

const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
const deferredCleanupDirs = new Set<string>();

afterAll(async () => {
  for (const directory of deferredCleanupDirs) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {}
  }
}, 120000);

export async function createWorkspace(prefix = 'engineering-compiler-test-'): Promise<string> {
  await fs.mkdir(workspaceParent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspaceParent, prefix));
  deferredCleanupDirs.add(directory);
  return directory;
}

export async function withTempWorkspace<T>(
  callback: (workspaceRoot: string) => Promise<T>,
  prefix = 'engineering-compiler-test-'
): Promise<T> {
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, prefix));
  try {
    return await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

type WorkspacePipelineFixtureOptions = {
  prefix?: string;
  blockIds?: string[];
};

export async function prepareComposedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  const workspaceRoot = await createWorkspace(options.prefix);
  await initWorkspace(workspaceRoot, { reset: true });
  for (const blockId of options.blockIds ?? []) {
    await addBlock(workspaceRoot, blockId);
  }
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  return workspaceRoot;
}

export async function prepareAdaptedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  const workspaceRoot = await prepareComposedWorkspace(options);
  await adaptWorkspace(workspaceRoot);
  return workspaceRoot;
}

export async function prepareLockedWorkspace(options: WorkspacePipelineFixtureOptions = {}): Promise<string> {
  const workspaceRoot = await prepareAdaptedWorkspace(options);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);
  return workspaceRoot;
}

const compilerFileCache = new Map<string, string>();

export async function readCompilerFile(relativePath: string): Promise<string> {
  const cached = compilerFileCache.get(relativePath);
  if (cached !== undefined) return cached;

  const absolutePath = path.join(compilerRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  compilerFileCache.set(relativePath, content);
  return content;
}

interface CompilerPackage {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

let cachedRootPackage: CompilerPackage | null = null;

export async function readCompilerPackageJson(): Promise<CompilerPackage> {
  if (cachedRootPackage) return cachedRootPackage;
  cachedRootPackage = await readJson<CompilerPackage>(path.join(compilerRoot, 'package.json'));
  return cachedRootPackage;
}

function buildSingleTenantPlanApp(options: Partial<PlanFile['app']> = {}): PlanFile['app'] {
  return {
    name: 'customer-admin',
    stack: SUPPORTED_STACK,
    packageManager: 'pnpm',
    mode: 'single-tenant',
    ...options
  };
}

function buildSingleTenantLockApp(options: Partial<LockFile['app']> = {}): LockFile['app'] {
  return {
    name: options.name ?? 'customer-admin',
    stack: options.stack ?? SUPPORTED_STACK,
    mode: options.mode ?? 'single-tenant'
  };
}

function buildOfficialPlanRegistrySource(): PlanFile['registry']['sources'][number] {
  return {
    id: 'official',
    kind: 'official',
    location: 'compiler',
    path: officialRegistryRelativePath.replaceAll('\\', '/')
  };
}

function buildPrivatePlanRegistrySource(): PlanFile['registry']['sources'][number] {
  return {
    id: 'private',
    kind: 'private',
    location: 'workspace',
    path: privateRegistryRelativePath.replaceAll('\\', '/')
  };
}

export function buildManifestValidationPlan(entry: ManifestEntry): PlanFile {
  return {
    app: buildSingleTenantPlanApp({ name: `validate-${entry.manifest.id.replaceAll('/', '-')}` }),
    registry: {
      sources: [buildOfficialPlanRegistrySource(), buildPrivatePlanRegistrySource()]
    },
    blocks: [{ id: entry.manifest.id, version: entry.manifest.version }],
    slots: entry.manifest.slots.map((slot) => ({
      id: slot.id,
      block: entry.manifest.id,
      kind: slot.kind,
      target: slot.target,
      symbol: slot.symbol,
      description: `Template validation placeholder for ${slot.id}`
    })),
    acceptance: []
  };
}

const officialRegistryMetadata = {
  registrySourceId: 'official',
  registryKind: 'official',
  registryLocation: 'compiler',
  registryPath: 'platform/registry/official'
} as const;

export function buildOfficialResolvedBlock(options: {
  id: string;
  installOrder: number;
  version?: string;
  kind?: LockFile['resolvedBlocks'][number]['kind'];
  manifestPath?: string;
}): LockFile['resolvedBlocks'][number] {
  return {
    version: '0.1.0',
    kind: 'capability',
    manifestPath: 'manifest.yaml',
    ...officialRegistryMetadata,
    ...options
  };
}

type OfficialInstallStepOptions = Omit<
  LockFile['installPlan'][number],
  'registrySourceId' | 'registryKind' | 'registryLocation' | 'registryPath'
>;

type OfficialCopyInstallStepOptions = Omit<OfficialInstallStepOptions, 'action'>;

export function buildOfficialInstallStep(options: OfficialInstallStepOptions): LockFile['installPlan'][number] {
  return {
    ...officialRegistryMetadata,
    ...options
  };
}

export function buildOfficialCopyInstallStep(options: OfficialCopyInstallStepOptions): LockFile['installPlan'][number] {
  return buildOfficialInstallStep({ action: 'copy', ...options });
}

type CustomerNormalizerPlanOptions = {
  slotDescription?: string;
};

export function buildCustomerNormalizerPlan(options: CustomerNormalizerPlanOptions = {}): PlanFile {
  return {
    app: buildSingleTenantPlanApp(),
    registry: { sources: [] },
    blocks: [{ id: 'entity/customer-basic', version: '0.1.0' }],
    slots: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        description: options.slotDescription ?? 'Normalize customer input.'
      }
    ],
    acceptance: [{ id: 'user_can_create_customer' }]
  };
}

type CustomerNormalizerLockOptions = {
  slotStatus?: LockFile['slotTasks'][number]['status'];
  passStatus?: Partial<LockFile['passStatus']>;
};

export function buildCustomerNormalizerLock(options: CustomerNormalizerLockOptions = {}): LockFile {
  return {
    formatVersion: '1',
    app: buildSingleTenantLockApp(),
    resolvedBlocks: [
      buildOfficialResolvedBlock({
        id: 'entity/customer-basic',
        installOrder: 1,
        manifestPath: 'block.manifest.yaml'
      })
    ],
    resolvedCapabilities: ['customer/write'],
    installPlan: [],
    slotTasks: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        kind: 'adapter',
        status: options.slotStatus ?? 'failed',
        writableZones: ['custom/customer_normalizer.ts'],
        provenanceHints: {
          generator: 'mock-local-synthesizer',
          verifiedBy: []
        }
      }
    ],
    generatedPaths: [],
    acceptancePlan: ['user_can_create_customer'],
    passStatus: {
      ...PASS_STATUS_PENDING,
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'failed',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending',
      ...options.passStatus
    }
  };
}

export function buildOfficialRegistrySummary(paths: string[]): ReviewProvenanceRegistrySummary {
  return {
    registrySourceId: 'official',
    registryKind: 'official',
    registryLocation: 'compiler',
    count: paths.length,
    paths
  };
}

export function emptyPolicyScopeReport(): PolicyReport['project'] {
  return {
    policies: [],
    sources: [],
    violations: []
  };
}

export function emptyVerificationLogs(): VerificationReport['logs'] {
  return { stdout: '', stderr: '' };
}

export function buildArtifactMissingReasonCounts(
  overrides: Partial<Record<CiArtifactMissingReason, number>> = {}
): Record<CiArtifactMissingReason, number> {
  return {
    ...emptyCiArtifactMissingReasonCounts(),
    ...overrides
  };
}

export function buildArtifactUploadGroup(
  kind: CiArtifactKind,
  count: number,
  paths: string[]
): CiArtifactUploadGroup {
  return { kind, count, paths };
}

export function expectContainsAll(haystack: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !haystack.includes(n));
  expect(missing, `Missing ${missing.length} marker(s): ${missing.map((m) => JSON.stringify(m)).join(', ')}`).toEqual([]);
}

export function expectContainsNone(haystack: string, needles: readonly string[]): void {
  const found = needles.filter((n) => haystack.includes(n));
  expect(found, `Unexpectedly found ${found.length} marker(s): ${found.map((f) => JSON.stringify(f)).join(', ')}`).toEqual([]);
}

export async function expectFileUnchanged(filePath: string, beforeText: string): Promise<void> {
  await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(beforeText);
}

type ReviewLockOptions = Partial<Omit<LockFile, 'app' | 'passStatus'>> & {
  app?: Partial<LockFile['app']>;
  passStatus?: Partial<LockFile['passStatus']>;
};

export function buildReviewLock(options: ReviewLockOptions = {}): LockFile {
  const base: LockFile = {
    formatVersion: '1',
    app: buildSingleTenantLockApp(),
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'pending',
      emit: 'pending'
    }
  };

  return {
    ...base,
    ...options,
    app: { ...base.app, ...options.app },
    passStatus: { ...base.passStatus, ...options.passStatus }
  };
}

export function buildReviewProvenance(
  artifacts: ProvenanceFile['artifacts'] = []
): ProvenanceFile {
  return {
    formatVersion: '1',
    artifacts
  };
}

export function buildPassingReviewCoverage(
  options: Partial<AcceptanceCoverageReport> = {}
): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: [],
    ...options
  };
}

type RuntimeVerificationReportOptions = Partial<
  Omit<VerificationReport['runtime'], 'build' | 'unit' | 'acceptance' | 'logs'>
> & {
  build?: Partial<VerificationReport['runtime']['build']>;
  unit?: Partial<VerificationReport['runtime']['unit']>;
  acceptance?: Partial<VerificationReport['runtime']['acceptance']>;
  logs?: VerificationReport['runtime']['logs'];
};

type ReviewReportOptions = Partial<Omit<VerificationReport, 'fast' | 'runtime' | 'summary'>> & {
  fast?: Partial<VerificationReport['fast']>;
  runtime?: Partial<VerificationReport['runtime']>;
  summary?: Partial<VerificationReport['summary']>;
};

export function buildRuntimeVerificationReport(
  options: RuntimeVerificationReportOptions = {}
): VerificationReport['runtime'] {
  const base: VerificationReport['runtime'] = {
    status: 'passed',
    build: { status: 'passed', passed: [], failed: [], command: 'npm run build' },
    unit: { status: 'passed', passed: [], failed: [], command: 'npm run test:unit' },
    acceptance: { status: 'passed', passed: [], failed: [], command: 'npm run test:acceptance' },
    logs: emptyVerificationLogs()
  };

  return {
    ...base,
    ...options,
    build: { ...base.build, ...options.build },
    unit: { ...base.unit, ...options.unit },
    acceptance: { ...base.acceptance, ...options.acceptance },
    logs: options.logs ?? base.logs
  };
}

export type ReviewInputsOptions = {
  lock?: ReviewLockOptions;
  provenance?: ProvenanceFile['artifacts'];
  report?: ReviewReportOptions;
  coverage?: Partial<AcceptanceCoverageReport>;
};

export type ReviewInputs = {
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  coverage: AcceptanceCoverageReport;
};

export function buildPassingReviewReport(options: ReviewReportOptions = {}): VerificationReport {
  const base: VerificationReport = {
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'passed',
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      logs: emptyVerificationLogs()
    },
    runtime: {
      status: 'skipped',
      build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
      unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
      acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
      logs: emptyVerificationLogs()
    },
    summary: {
      status: 'passed',
      requestedLane: 'fast',
      failedLanes: []
    },
    logs: emptyVerificationLogs()
  };

  return {
    ...base,
    ...options,
    fast: { ...base.fast, ...options.fast },
    runtime: { ...base.runtime, ...options.runtime },
    summary: { ...base.summary, ...options.summary },
    logs: options.logs ?? base.logs
  };
}

export function buildReviewInputs(options: ReviewInputsOptions = {}): ReviewInputs {
  return {
    lock: buildReviewLock(options.lock),
    provenance: buildReviewProvenance(options.provenance),
    report: buildPassingReviewReport(options.report),
    coverage: buildPassingReviewCoverage(options.coverage)
  };
}

export async function buildReviewSummaryFromInputs(
  workspaceRoot: string,
  options: ReviewInputsOptions = {}
): Promise<ReviewSummary> {
  const { lock, provenance, report, coverage } = buildReviewInputs(options);
  return buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);
}

type RepairFailurePoint = RepairPlan['tasks'][number]['failurePoints'][number];
type RepairTask = RepairPlan['tasks'][number];
type RepairBlocker = NonNullable<RepairPlan['blockers']>[number];

export function buildRepairFailurePoint(options: Partial<RepairFailurePoint> = {}): RepairFailurePoint {
  return {
    lane: 'fast',
    kind: 'unit',
    issueType: 'slot',
    repairable: true,
    artifactPath: 'tests/unit',
    message: 'Unit verification failed',
    targetIds: ['zeta.test.ts'],
    ...options
  };
}

export function buildRepairTask(options: Partial<RepairTask> = {}): RepairTask {
  const sourceSlotId = options.sourceSlotId ?? 'customer_normalizer';
  const targetFile = options.targetFile ?? `custom/${sourceSlotId}.ts`;
  return {
    taskId: options.taskId ?? `repair_slot_${sourceSlotId}`,
    taskKind: 'repair-slot',
    phase: 'repair',
    sourceSlotId,
    targetBlock: 'entity/customer-basic',
    targetFile,
    allowedPaths: [targetFile],
    requiredSymbols: ['normalizeCustomerInput'],
    forbiddenOperations: [],
    testsToPass: [],
    failureSummary: 'build=passed; unit=failed; acceptance=passed; policy=passed; runtime=skipped',
    failurePoints: [buildRepairFailurePoint()],
    ...options
  };
}

export function buildRepairBlocker(options: Partial<RepairBlocker> = {}): RepairBlocker {
  return {
    blockerId: 'repair_blocker_policy',
    boundary: 'spec',
    reason: 'policy failure is outside automatic slot repair: tenant scope missing',
    decisionRequired: 'Decide whether to change policy/spec, installed source, or project plan before repair can proceed.',
    failurePoints: [
      buildRepairFailurePoint({
        kind: 'policy',
        issueType: 'spec',
        repairable: false,
        artifactPath: CI_ARTIFACT_FILES.policyReport,
        message: 'tenant scope missing',
        targetIds: ['tenant-scope-required']
      })
    ],
    ...options
  };
}

export function buildRepairPlanArtifact(options: Partial<RepairPlan> = {}): RepairPlan {
  return {
    formatVersion: '1',
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [],
    ...options
  };
}

export function buildUpgradeDiagnostics(options: Partial<UpgradeDiagnostics> = {}): UpgradeDiagnostics {
  return {
    formatVersion: '1',
    status: 'blocked',
    phase: 'planning',
    blockId: 'private/slot-contract',
    targetVersion: '0.2.0',
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    message: 'Migration path "../outside-project.md" escapes project root',
    ...options
  };
}

export function buildUpgradePlanArtifact(options: Partial<UpgradePlan> = {}): UpgradePlan {
  const base: UpgradePlan = {
    formatVersion: '1',
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    status: 'planned',
    preflightChecks: [
      {
        id: 'version-range',
        status: 'passed',
        message: 'Upgrade path 0.1.0 -> 0.1.1 is allowed',
        evidence: ['0.1.x']
      },
      {
        id: 'migration-entries',
        status: 'passed',
        message: '1 migration entries loaded and validated',
        evidence: ['mig-auth-session-refresh:migrations/auth-session-refresh.json']
      },
      {
        id: 'migration-targets',
        status: 'passed',
        message: '1 migration paths checked',
        evidence: ['mig-auth-session-refresh:target:src/installed/auth/session.ts:exists']
      },
      {
        id: 'migration-file-operations',
        status: 'passed',
        message: '1 file operations checked',
        evidence: ['mig-auth-session-refresh:manifest-source:exists']
      },
      {
        id: 'migration-json-shapes',
        status: 'passed',
        message: '0 JSON migration shapes checked',
        evidence: []
      },
      {
        id: 'migration-json-structure',
        status: 'passed',
        message: '0 JSON migration targets checked',
        evidence: []
      },
      {
        id: 'migration-text-patterns',
        status: 'passed',
        message: '0 text replacement patterns checked',
        evidence: []
      },
      {
        id: 'migration-slot-contracts',
        status: 'passed',
        message: '0 slot contract fields checked',
        evidence: []
      },
      {
        id: 'impact-scan',
        status: 'passed',
        message: '1 upgrade impacts calculated',
        evidence: ['src/installed/auth/session.ts']
      },
      {
        id: 'override-conflicts',
        status: 'passed',
        message: '0 overrides scanned with no conflicts',
        evidence: []
      }
    ],
    impacts: ['src/installed/auth/session.ts'],
    migrations: [
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        entry: 'migrations/auth-session-refresh.json',
        requiresVerification: true
      }
    ],
    migrationKindCounts: {
      'file-replace': 1
    },
    migrationSummaries: [
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
        requiresVerification: true,
        source: 'files/src/installed/auth/session.ts'
      }
    ],
    migrationOperations: [
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        role: 'file',
        source: 'files/src/installed/auth/session.ts'
      }
    ]
  };

  return { ...base, ...options };
}

export async function installRuntimeDeps(cwd: string): Promise<void> {
  const nextPackagePath = path.join(cwd, 'node_modules', 'next', 'package.json');
  await fs.mkdir(path.dirname(nextPackagePath), { recursive: true });
  await fs.writeFile(nextPackagePath, '{\n  "name": "next"\n}\n', 'utf8');
}

export type CliResult = { code: number; stdout: string; stderr: string };

export async function expectCliSuccess(
  workspaceRoot: string,
  args: string[],
  expectedStdout?: string
): Promise<CliResult> {
  const result = await runCliInProcess(workspaceRoot, args);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  if (expectedStdout !== undefined) {
    expect(result.stdout).toBe(expectedStdout);
  }
  return result;
}

export async function expectCliText(
  workspaceRoot: string,
  args: string[],
  expectedMarkers: readonly string[]
): Promise<CliResult> {
  const result = await expectCliSuccess(workspaceRoot, args);
  expectContainsAll(result.stdout, expectedMarkers);
  return result;
}

type CliJsonOptions = {
  compact?: boolean;
  stdoutMarkers?: readonly string[];
};

export async function expectCliJson<T = unknown>(
  workspaceRoot: string,
  args: string[],
  expected?: object,
  options: CliJsonOptions = {}
): Promise<T> {
  const result = await expectCliSuccess(workspaceRoot, args);
  if (options.compact === true) {
    expect(result.stdout.trim()).not.toContain('\n');
  }
  if (options.stdoutMarkers !== undefined) {
    expectContainsAll(result.stdout, options.stdoutMarkers);
  }
  const payload = JSON.parse(result.stdout) as T;
  if (expected !== undefined) {
    expect(payload).toMatchObject(expected);
  }
  return payload;
}

type CliVariantExpectations = {
  text: readonly string[];
  json?: object;
  compactJson?: object;
  jsonStdoutMarkers?: readonly string[];
  compactJsonStdoutMarkers?: readonly string[];
};

export async function expectCliVariants<TJson = unknown, TCompactJson = unknown>(
  workspaceRoot: string,
  args: string[],
  expectations: CliVariantExpectations
): Promise<{ text: CliResult; json: TJson; compactJson: TCompactJson }> {
  const text = await expectCliText(workspaceRoot, args, expectations.text);
  const json = await expectCliJson<TJson>(workspaceRoot, [...args, '--json'], expectations.json, {
    stdoutMarkers: expectations.jsonStdoutMarkers
  });
  const compactJson = await expectCliJson<TCompactJson>(
    workspaceRoot,
    [...args, '--json', '--compact'],
    expectations.compactJson ?? expectations.json,
    {
      compact: true,
      stdoutMarkers: expectations.compactJsonStdoutMarkers
    }
  );
  return { text, json, compactJson };
}

export async function runCliPipeline(
  workspaceRoot: string,
  options: { init?: boolean; verifyLane?: 'fast' | 'all'; lock?: boolean; explain?: boolean } = {}
): Promise<void> {
  if (options.init !== false) {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
  }
  await expectCliSuccess(workspaceRoot, ['resolve'], 'Resolved 3 blocks\n');
  await expectCliSuccess(workspaceRoot, ['compose'], 'Composed project\n');
  await expectCliSuccess(workspaceRoot, ['adapt'], 'Adapted slots\n');
  if (options.verifyLane) {
    const verification = await expectCliSuccess(workspaceRoot, ['verify', '--lane', options.verifyLane]);
    expect(verification.stdout).toContain(`Verification passed (${options.verifyLane})`);
  }
  if (options.lock) {
    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');
  }
  if (options.explain) {
    await expectCliSuccess(workspaceRoot, ['explain']);
  }
}

export function usageErrorStderr(usage: string): string {
  return [
    `UNEXPECTED ${usage}`,
    JSON.stringify({
      code: 'UNEXPECTED',
      message: usage,
      recoverable: true,
      issueType: 'usage',
      suggestedActions: ['retry-with-supported-arguments'],
      artifactPaths: []
    }),
    ''
  ].join('\n');
}

export async function expectCliUsageError(
  workspaceRoot: string,
  command: string,
  args: string[],
  usage: string
): Promise<void> {
  await expect(runCliInProcess(workspaceRoot, [command, ...args])).resolves.toMatchObject({
    code: 1,
    stdout: '',
    stderr: usageErrorStderr(usage)
  });
}

export async function expectRepairUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expectCliUsageError(workspaceRoot, 'repair', args, REPAIR_USAGE);
}

export async function expectLockUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expectCliUsageError(workspaceRoot, 'lock', args, LOCK_USAGE);
}

export async function expectPolicyUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expectCliUsageError(workspaceRoot, 'policy', args, POLICY_USAGE);
}

export async function expectAcceptanceUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expectCliUsageError(workspaceRoot, 'acceptance', args, ACCEPTANCE_USAGE);
}

export async function expectPostgresUsageError(workspaceRoot: string, args: string[]): Promise<void> {
  await expectCliUsageError(workspaceRoot, 'postgres', args, POSTGRES_USAGE);
}

export async function installPrivateBannerBlock(workspaceRoot: string): Promise<void> {
  const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const blockRoot = path.join(privateRegistryRoot, 'private.banner-basic');

  await fs.mkdir(path.join(blockRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
  await fs.mkdir(path.join(blockRoot, 'files', 'tests', 'unit'), { recursive: true });

  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), {
    id: 'private/banner-basic',
    version: '0.1.0',
    kind: 'governance',
    stackProfiles: ['nextjs-ts-prisma-sqlite'],
    compatibility: {
      blockApi: '1',
      compilerApi: '1',
      stackProfiles: ['nextjs-ts-prisma-sqlite']
    },
    requires: [],
    provides: ['governance/banner'],
    conflicts: [],
    installs: [
      {
        kind: 'copy',
        from: 'files/src/installed/private/banner.ts',
        to: 'src/installed/private/banner.ts'
      },
      {
        kind: 'copy',
        from: 'files/tests/unit/private-banner.test.ts',
        to: 'tests/unit/private-banner.test.ts'
      }
    ],
    pins: {
      inputs: [],
      outputs: [
        {
          id: 'banner_message',
          type: 'string',
          required: true
        }
      ]
    },
    slots: [],
    acceptance: [],
    routes: []
  });

  await fs.writeFile(
    path.join(blockRoot, 'files', 'src', 'installed', 'private', 'banner.ts'),
    `export function projectBanner(projectName: string): string {\n  return \`private-banner:\${projectName}\`;\n}\n`,
    'utf8'
  );

  await fs.writeFile(
    path.join(blockRoot, 'files', 'tests', 'unit', 'private-banner.test.ts'),
    `import assert from 'node:assert/strict';\nimport { projectBanner } from '../../src/installed/private/banner.ts';\n\nexport async function runSuite() {\n  assert.equal(projectBanner('customer-admin'), 'private-banner:customer-admin');\n}\n`,
    'utf8'
  );
}

type SlotUpgradeDryRunFixtureContext = {
  workspaceRoot: string;
  paths: ReturnType<typeof getWorkspacePaths>;
  versionRoot: string;
};

type SlotUpgradeMigrationFixture = {
  id: string;
  kind: string;
  entry: string;
  requiresVerification: boolean;
  body?: Record<string, unknown>;
};

type SlotUpgradeDryRunFixtureOptions = {
  prefix: string;
  setup?: (context: SlotUpgradeDryRunFixtureContext) => Promise<void>;
} & ({ migration: SlotUpgradeMigrationFixture } | { migrations: SlotUpgradeMigrationFixture[] });

export async function prepareSlotUpgradeDryRunFixture(
  options: SlotUpgradeDryRunFixtureOptions
): Promise<SlotUpgradeDryRunFixtureContext & { beforePlan: string }> {
  const workspaceRoot = await createWorkspace(options.prefix);
  await writeSlotUpgradeFixture(workspaceRoot);

  const paths = getWorkspacePaths(workspaceRoot);
  const versionRoot = path.join(paths.privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0');
  const manifestPath = path.join(versionRoot, 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  const beforePlan = await fs.readFile(paths.planPath, 'utf8');
  const migrations = 'migrations' in options ? options.migrations : [options.migration];

  await options.setup?.({ workspaceRoot, paths, versionRoot });
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      from: ['0.1.x'],
      migrations: migrations.map((migration) => ({
        id: migration.id,
        kind: migration.kind,
        entry: migration.entry,
        fromVersion: '0.1.0',
        toVersion: '0.2.0',
        requiresVerification: migration.requiresVerification
      }))
    }
  });

  for (const migration of migrations) {
    if (migration.body !== undefined) {
      await writeJson(path.join(versionRoot, ...migration.entry.split('/')), migration.body);
    }
  }

  return { workspaceRoot, paths, versionRoot, beforePlan };
}

export async function writeSlotUpgradeFixture(workspaceRoot: string): Promise<void> {
  const { lockPath, planPath, privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const blockRoot = path.join(privateRegistryRoot, 'private.slot-contract');
  const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
  const baseManifest = {
    id: 'private/slot-contract',
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: ['nextjs-ts-prisma-sqlite'],
    requires: [],
    provides: ['private/slot-contract'],
    conflicts: [],
    installs: [
      {
        kind: 'copy',
        from: 'files/src/installed/private/slot-contract.ts',
        to: 'src/installed/private/slot-contract.ts'
      }
    ],
    pins: {
      inputs: [],
      outputs: []
    },
    slots: [
      {
        id: 'customer_normalizer',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomer',
        inputType: 'CustomerInputV1',
        outputType: 'CustomerRecordInput',
        writableZones: ['custom/customer_normalizer.ts']
      }
    ],
    acceptance: [],
    routes: []
  };

  await writeYaml(planPath, {
    app: buildSingleTenantPlanApp(),
    registry: {
      sources: [buildPrivatePlanRegistrySource()]
    },
    blocks: [{ id: 'private/slot-contract', version: '0.1.0' }],
    slots: [],
    acceptance: []
  });
  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), baseManifest);
  await writeYaml(path.join(versionRoot, 'block.manifest.yaml'), {
    ...baseManifest,
    version: '0.2.0',
    slots: [
      {
        id: 'customer_normalizer',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomer',
        inputType: 'CustomerInputV2',
        outputType: 'CustomerRecordInput',
        writableZones: ['custom/customer_normalizer.ts']
      }
    ],
    upgrade: {
      from: ['0.1.x'],
      migrations: [
        {
          id: 'mig-customer-normalizer-contract',
          kind: 'slot-contract-update',
          entry: 'migrations/customer-normalizer-contract.json',
          fromVersion: '0.1.0',
          toVersion: '0.2.0',
          requiresVerification: true
        }
      ]
    }
  });
  await writeJson(path.join(versionRoot, 'migrations', 'customer-normalizer-contract.json'), {
    id: 'mig-customer-normalizer-contract',
    kind: 'slot-contract-update',
    reason: 'Update customer normalizer input contract to v2.',
    target: 'custom/customer_normalizer.ts',
    slotId: 'customer_normalizer',
    inputType: 'CustomerInputV2',
    outputType: 'CustomerRecordInput',
    writableZones: ['custom/customer_normalizer.ts']
  });

  const lock: LockFile = {
    formatVersion: '1',
    app: buildSingleTenantLockApp(),
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'succeeded',
      emit: 'succeeded'
    }
  };
  await writeJson(lockPath, lock);
}

export async function runCliInProcess(workspaceRoot: string, args: string[]): Promise<CliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...chunks: unknown[]) => { stdoutChunks.push(`${chunks.map(String).join(' ')}\n`); };
  console.error = (...chunks: unknown[]) => { stderrChunks.push(`${chunks.map(String).join(' ')}\n`); };
  console.warn = (...chunks: unknown[]) => { stderrChunks.push(`${chunks.map(String).join(' ')}\n`); };

  try {
    const registry = createDefaultRegistry();
    await registry.dispatch(args, {
      cwd: workspaceRoot,
      logger: registry.logger
    });
    return { code: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string; details?: unknown };
    const protocol = buildErrorProtocol(failure);
    console.error(protocol.code, protocol.message);
    console.error(JSON.stringify({
      code: protocol.code,
      message: protocol.message,
      recoverable: protocol.recoverable,
      issueType: protocol.issueType,
      suggestedActions: protocol.suggestedActions,
      artifactPaths: protocol.artifactPaths
    }));
    if (protocol.details) {
      console.error(JSON.stringify(protocol.details, null, 2));
    }
    return { code: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}
