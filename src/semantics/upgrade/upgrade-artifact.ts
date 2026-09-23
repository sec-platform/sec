import { z } from 'zod';

import { deepFreeze, sha256 } from '../../contracts/canonical.ts';
import { isDigest } from '../../contracts/digest.ts';
import {
  ExactJsonError,
  parseExactJson,
  type ExactJsonFailureKind
} from '../../contracts/exact-json.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';

export const UPGRADE_PLAN_FORMAT_VERSION = '1' as const;
const UPGRADE_EXECUTION_TERMINAL_FORMAT_VERSION = '1' as const;
export const UPGRADE_DIAGNOSTICS_FORMAT_VERSION = '1' as const;

export type UpgradeContractName = 'plan' | 'execution-terminal' | 'diagnostics';
export type UpgradeContractFailureKind =
  | ExactJsonFailureKind
  | 'schema'
  | 'status-impact'
  | 'provenance';

export class UpgradeContractError extends Error {
  readonly name = 'UpgradeContractError';

  constructor(
    readonly contract: UpgradeContractName,
    readonly kind: UpgradeContractFailureKind,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}

const nonemptyText = z.string().min(1);
const nonnegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const stringList = z.array(nonemptyText);
export type UpgradeDigest = `sha256:${string}`;

const digest = z.custom<UpgradeDigest>(
  (value) => isDigest(value, 'sha256'),
  'must be one canonical SHA-256 digest'
);
const semanticVersion = nonemptyText.regex(
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  'must be one exact semantic version'
);
const blockId = nonemptyText.refine(
  (value) => isCanonicalPortableLogicalPath(value),
  'must be one canonical portable block identity'
);
const migrationPath = nonemptyText.refine(
  (value) => isCanonicalPortableLogicalPath(value),
  'must be one canonical portable migration path'
);

const upgradeImpactListSchema = stringList.superRefine((impacts, context) => {
  const seen = new Set<string>();
  for (const [index, impact] of impacts.entries()) {
    if (!isCanonicalPortableLogicalPath(impact)) {
      context.addIssue({ code: 'custom', path: [index], message: 'impact must be one canonical portable logical path' });
    }
    if (seen.has(impact)) {
      context.addIssue({ code: 'custom', path: [index], message: 'impact paths must be unique' });
    }
    seen.add(impact);
  }
});

const upgradeMigrationSchema = z.object({
  id: nonemptyText,
  kind: nonemptyText,
  entry: migrationPath,
  fromVersion: semanticVersion.optional(),
  toVersion: semanticVersion.optional(),
  requiresVerification: z.boolean().optional()
}).strict();

const migrationOperationRoleSchema = z.enum(['file', 'directory', 'json', 'text', 'prisma']);
const upgradeMigrationOperationSchema = z.object({
  id: nonemptyText,
  kind: nonemptyText,
  target: migrationPath,
  role: migrationOperationRoleSchema,
  source: migrationPath.optional(),
  path: stringList.optional(),
  updateCount: nonnegativeInteger.optional(),
  itemCount: nonnegativeInteger.optional(),
  valueKeyCount: nonnegativeInteger.optional(),
  contentLength: nonnegativeInteger.optional(),
  searchLength: nonnegativeInteger.optional(),
  replacementLength: nonnegativeInteger.optional(),
  pattern: z.string().optional(),
  flags: z.string().optional(),
  entity: nonemptyText.optional(),
  expandField: nonemptyText.optional(),
  contractField: nonemptyText.optional()
}).strict();

const upgradeMigrationSummarySchema = z.object({
  id: nonemptyText,
  kind: nonemptyText,
  target: migrationPath,
  reason: nonemptyText,
  requiresVerification: z.boolean(),
  source: migrationPath.optional()
}).strict();

const upgradePreflightCheckIdSchema = z.enum([
  'version-range',
  'migration-entries',
  'migration-targets',
  'migration-file-operations',
  'migration-json-shapes',
  'migration-json-structure',
  'migration-text-patterns',
  'impact-scan',
  'override-conflicts'
]);

const upgradePreflightCheckSchema = z.object({
  id: upgradePreflightCheckIdSchema,
  status: z.literal('passed'),
  message: nonemptyText,
  evidence: stringList
}).strict();

const upgradeCompatibilitySchema = z.object({
  blockApi: nonemptyText,
  compilerApi: nonemptyText,
  stackProfiles: stringList
}).strict();

const upgradeOrderedStepSchema = z.object({
  ordinal: nonnegativeInteger,
  migrationId: nonemptyText,
  kind: nonemptyText,
  target: migrationPath,
  operationRevision: digest
}).strict();

const upgradePlanningFields = {
  blockId,
  fromVersion: semanticVersion,
  toVersion: semanticVersion,
  planningInputRevision: digest,
  sourceRevision: digest,
  lockRevision: digest,
  compatibility: upgradeCompatibilitySchema,
  preflightChecks: z.array(upgradePreflightCheckSchema),
  impacts: upgradeImpactListSchema,
  migrations: z.array(upgradeMigrationSchema),
  migrationKindCounts: z.record(nonemptyText, nonnegativeInteger),
  migrationSummaries: z.array(upgradeMigrationSummarySchema),
  migrationOperations: z.array(upgradeMigrationOperationSchema),
  orderedSteps: z.array(upgradeOrderedStepSchema)
} as const;

const UpgradePlanningMaterialSchema = z.object(upgradePlanningFields).strict();
type UpgradePlanningMaterial = z.infer<typeof UpgradePlanningMaterialSchema>;

function validatePlanRelations(plan: UpgradePlanningMaterial, context: z.RefinementCtx): void {
  if (plan.fromVersion === plan.toVersion) {
    context.addIssue({ code: 'custom', path: ['toVersion'], message: 'upgrade plan must describe a version transition' });
  }
  const preflightIds = plan.preflightChecks.map((check) => check.id);
  if (new Set(preflightIds).size !== preflightIds.length) {
    context.addIssue({ code: 'custom', path: ['preflightChecks'], message: 'preflight check ids must be unique' });
  }
  const ids = plan.migrations.map((entry) => entry.id);
  const summaryIds = plan.migrationSummaries.map((entry) => entry.id);
  const operationIds = plan.migrationOperations.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['migrations'], message: 'migration ids must be unique' });
  }
  if (JSON.stringify(summaryIds) !== JSON.stringify(ids)) {
    context.addIssue({ code: 'custom', path: ['migrationSummaries'], message: 'migration summaries must match migration order' });
  }
  if (JSON.stringify(operationIds) !== JSON.stringify(ids)) {
    context.addIssue({ code: 'custom', path: ['migrationOperations'], message: 'migration operations must match migration order' });
  }
  if (plan.orderedSteps.length !== operationIds.length) {
    context.addIssue({ code: 'custom', path: ['orderedSteps'], message: 'ordered steps must match migration operations' });
  }
  for (const [index, migration] of plan.migrations.entries()) {
    const summary = plan.migrationSummaries[index];
    const operation = plan.migrationOperations[index];
    const step = plan.orderedSteps[index];
    if (summary && summary.kind !== migration.kind) {
      context.addIssue({ code: 'custom', path: ['migrationSummaries', index, 'kind'], message: 'migration summary kind must match its migration' });
    }
    if (operation && operation.kind !== migration.kind) {
      context.addIssue({ code: 'custom', path: ['migrationOperations', index, 'kind'], message: 'migration operation kind must match its migration' });
    }
    if (operation && step && (
      step.ordinal !== index || step.migrationId !== operation.id || step.kind !== operation.kind ||
      step.target !== operation.target || step.operationRevision !== upgradeArtifactDigest(operation)
    )) {
      context.addIssue({ code: 'custom', path: ['orderedSteps', index], message: 'ordered step does not bind its migration operation' });
    }
  }
  const actualCounts = plan.migrations.reduce<Record<string, number>>((counts, migration) => {
    counts[migration.kind] = (counts[migration.kind] ?? 0) + 1;
    return counts;
  }, {});
  if (JSON.stringify(Object.entries(plan.migrationKindCounts).sort()) !== JSON.stringify(Object.entries(actualCounts).sort())) {
    context.addIssue({ code: 'custom', path: ['migrationKindCounts'], message: 'migration kind counts do not match migrations' });
  }
}

const UpgradePreviewSchema = z.object({
  artifactKind: z.literal('unbound-upgrade-preview'),
  ...upgradePlanningFields
}).strict().superRefine(validatePlanRelations);

const UpgradePlanSchema = z.object({
  formatVersion: z.literal(UPGRADE_PLAN_FORMAT_VERSION),
  artifactKind: z.literal('upgrade-plan'),
  workspaceIdentityDigest: digest,
  operationIdentityDigest: digest,
  ...upgradePlanningFields,
  planRevision: digest
}).strict().superRefine((plan, context) => {
  validatePlanRelations(plan, context);
  const expectedOperationIdentity = upgradeOperationIdentity(plan);
  if (plan.operationIdentityDigest !== expectedOperationIdentity) {
    context.addIssue({ code: 'custom', path: ['operationIdentityDigest'], message: 'operation identity does not match plan inputs' });
  }
  const { planRevision: ignoredPlanRevision, ...unsigned } = plan;
  if (plan.planRevision !== upgradePlanMaterialRevision(unsigned)) {
    context.addIssue({ code: 'custom', path: ['planRevision'], message: 'plan revision does not match canonical plan material' });
  }
});

const upgradeExecutionAttemptSchema = z.object({
  leaseGeneration: positiveInteger,
  leaseId: nonemptyText,
  ownerFileIdentityDigest: nonemptyText,
  attemptRevision: digest
}).strict().superRefine((attempt, context) => {
  const { attemptRevision: ignoredAttemptRevision, ...unsigned } = attempt;
  if (attempt.attemptRevision !== upgradeArtifactDigest({ domain: 'sec.upgrade.execution-attempt', attempt: unsigned })) {
    context.addIssue({ code: 'custom', path: ['attemptRevision'], message: 'attempt revision does not match lease attempt' });
  }
});

const upgradeExecutionReceiptsSchema = z.object({
  workspacePlanRevision: digest,
  resultLockRevision: digest,
  planArtifactRevision: digest
}).strict();

const upgradeExecutionReadbackSchema = z.object({
  workspaceBlockVersion: semanticVersion.nullable(),
  resolvedBlockVersion: semanticVersion.nullable()
}).strict();

const UpgradeExecutionTerminalSchema = z.object({
  formatVersion: z.literal(UPGRADE_EXECUTION_TERMINAL_FORMAT_VERSION),
  artifactKind: z.literal('upgrade-execution-terminal'),
  workspaceIdentityDigest: digest,
  operationIdentityDigest: digest,
  planRevision: digest,
  attempt: upgradeExecutionAttemptSchema,
  receipts: upgradeExecutionReceiptsSchema,
  settlement: z.enum(['applied', 'rolled-back', 'recovery-required']),
  readback: upgradeExecutionReadbackSchema,
  terminalRevision: digest
}).strict().superRefine((terminal, context) => {
  const { terminalRevision: ignoredTerminalRevision, ...unsigned } = terminal;
  if (terminal.terminalRevision !== upgradeExecutionTerminalMaterialRevision(unsigned)) {
    context.addIssue({ code: 'custom', path: ['terminalRevision'], message: 'terminal revision does not match canonical terminal material' });
  }
});

const diagnosticsCommonFields = {
  formatVersion: z.literal(UPGRADE_DIAGNOSTICS_FORMAT_VERSION),
  artifactKind: z.literal('upgrade-diagnostics'),
  status: z.literal('blocked'),
  workspaceIdentityDigest: digest,
  blockId,
  targetVersion: semanticVersion,
  failedCheck: z.union([upgradePreflightCheckIdSchema, z.enum(['target-manifest', 'plan-block'])]),
  errorCode: nonemptyText,
  message: nonemptyText,
  details: z.unknown().optional()
} as const;

const planningDiagnosticsSchema = z.object({
  ...diagnosticsCommonFields,
  phase: z.literal('planning'),
  planningRequestRevision: digest
}).strict();

const executionDiagnosticsSchema = z.object({
  ...diagnosticsCommonFields,
  phase: z.enum(['apply', 'recovery']),
  operationIdentityDigest: digest,
  planRevision: digest,
  attemptRevision: digest,
  executionTerminalRevision: digest
}).strict();

const UpgradeDiagnosticsSchema = z.discriminatedUnion('phase', [
  planningDiagnosticsSchema,
  executionDiagnosticsSchema
]);

export type UpgradeMigrationOperation = z.infer<typeof upgradeMigrationOperationSchema>;
export type UpgradePreflightCheck = z.infer<typeof upgradePreflightCheckSchema>;
export type UpgradePreview = z.infer<typeof UpgradePreviewSchema>;
export type UpgradePlan = z.infer<typeof UpgradePlanSchema>;
export type UpgradeExecutionTerminal = z.infer<typeof UpgradeExecutionTerminalSchema>;
export type UpgradeDiagnosticsPhase = z.infer<typeof UpgradeDiagnosticsSchema>['phase'];
export type UpgradeDiagnostics = z.infer<typeof UpgradeDiagnosticsSchema>;
export type UpgradePlanInput = Omit<UpgradePlan, 'formatVersion' | 'artifactKind' | 'operationIdentityDigest' | 'planRevision'>;
export type UpgradeExecutionTerminalInput = Omit<UpgradeExecutionTerminal, 'formatVersion' | 'artifactKind' | 'terminalRevision'>;

export interface UpgradeArtifactSet {
  readonly plan: UpgradePlan | null;
  readonly executionTerminal: UpgradeExecutionTerminal | null;
  readonly diagnostics: UpgradeDiagnostics | null;
}

export function upgradeArtifactDigest(value: unknown): UpgradeDigest {
  const computed = sha256(value);
  if (!isDigest(computed, 'sha256')) {
    throw new UpgradeContractError('plan', 'provenance', 'Canonical SHA-256 provider returned a noncanonical digest');
  }
  return computed;
}

export function requireUpgradeDigest(value: string, label: string): UpgradeDigest {
  if (!isDigest(value, 'sha256')) {
    throw new UpgradeContractError('plan', 'provenance', `${label} must be one canonical SHA-256 digest`);
  }
  return value;
}

function upgradeOperationIdentity(input: Pick<UpgradePlan, 'workspaceIdentityDigest' | 'planningInputRevision' | 'sourceRevision' | 'lockRevision'>): UpgradeDigest {
  return upgradeArtifactDigest({
    domain: 'sec.upgrade.operation',
    workspaceIdentityDigest: input.workspaceIdentityDigest,
    planningInputRevision: input.planningInputRevision,
    sourceRevision: input.sourceRevision,
    lockRevision: input.lockRevision
  });
}

function upgradePlanMaterialRevision(value: unknown): UpgradeDigest {
  return upgradeArtifactDigest({ domain: 'sec.upgrade.plan', plan: value });
}

function upgradeExecutionTerminalMaterialRevision(value: unknown): UpgradeDigest {
  return upgradeArtifactDigest({ domain: 'sec.upgrade.execution-terminal', terminal: value });
}

function validateUpgradeContract<T>(
  contract: UpgradeContractName,
  schema: z.ZodType<T>,
  value: unknown
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const firstPath = result.error.issues[0]?.path[0];
    const kind: UpgradeContractFailureKind = firstPath === 'formatVersion'
      ? 'schema'
      : firstPath === 'impacts' || firstPath === 'preflightChecks'
        ? 'status-impact'
        : ['blockId', 'fromVersion', 'toVersion', 'targetVersion', 'workspaceIdentityDigest', 'operationIdentityDigest', 'planningInputRevision', 'sourceRevision', 'lockRevision', 'planRevision', 'attempt', 'receipts', 'readback', 'terminalRevision'].includes(String(firstPath))
          ? 'provenance'
          : 'schema';
    throw new UpgradeContractError(
      contract,
      kind,
      `${contract} artifact failed canonical validation: ${result.error.message}`,
      { cause: result.error }
    );
  }
  return deepFreeze(result.data);
}

export function createUpgradePreview(value: unknown): UpgradePreview {
  return validateUpgradeContract('plan', UpgradePreviewSchema, value);
}

export function createUpgradePlan(input: UpgradePlanInput): UpgradePlan {
  const operationIdentityDigest = upgradeOperationIdentity(input);
  const unsigned = {
    formatVersion: UPGRADE_PLAN_FORMAT_VERSION,
    artifactKind: 'upgrade-plan' as const,
    operationIdentityDigest,
    ...input
  };
  return validateUpgradePlan({ ...unsigned, planRevision: upgradePlanMaterialRevision(unsigned) });
}

function validateUpgradePlan(value: unknown): UpgradePlan {
  return validateUpgradeContract('plan', UpgradePlanSchema, value);
}

export function createUpgradeExecutionAttempt(input: Omit<UpgradeExecutionTerminal['attempt'], 'attemptRevision'>): UpgradeExecutionTerminal['attempt'] {
  return deepFreeze({
    ...input,
    attemptRevision: upgradeArtifactDigest({ domain: 'sec.upgrade.execution-attempt', attempt: input })
  });
}

export function createUpgradeExecutionTerminal(input: UpgradeExecutionTerminalInput): UpgradeExecutionTerminal {
  const unsigned = {
    formatVersion: UPGRADE_EXECUTION_TERMINAL_FORMAT_VERSION,
    artifactKind: 'upgrade-execution-terminal' as const,
    ...input
  };
  return validateUpgradeExecutionTerminal({
    ...unsigned,
    terminalRevision: upgradeExecutionTerminalMaterialRevision(unsigned)
  });
}

function validateUpgradeExecutionTerminal(value: unknown): UpgradeExecutionTerminal {
  return validateUpgradeContract('execution-terminal', UpgradeExecutionTerminalSchema, value);
}

export function validateUpgradeDiagnostics(value: unknown): UpgradeDiagnostics {
  return validateUpgradeContract('diagnostics', UpgradeDiagnosticsSchema, value);
}

export function upgradePlanDigest(value: unknown): UpgradeDigest {
  return validateUpgradePlan(value).planRevision;
}

export function upgradeDiagnosticsDigest(value: unknown): UpgradeDigest {
  return upgradeArtifactDigest(validateUpgradeDiagnostics(value));
}

export function validateUpgradeArtifactSet(input: UpgradeArtifactSet): UpgradeArtifactSet {
  const plan = input.plan === null ? null : validateUpgradePlan(input.plan);
  const executionTerminal = input.executionTerminal === null
    ? null
    : validateUpgradeExecutionTerminal(input.executionTerminal);
  const diagnostics = input.diagnostics === null ? null : validateUpgradeDiagnostics(input.diagnostics);

  if (plan === null) {
    if (executionTerminal !== null || (diagnostics !== null && diagnostics.phase !== 'planning')) {
      throw new UpgradeContractError('execution-terminal', 'provenance', 'Execution artifacts require one retained UpgradePlan');
    }
  } else {
    if (diagnostics?.phase === 'planning') {
      throw new UpgradeContractError('diagnostics', 'provenance', 'Planning diagnostics cannot be combined with a durable UpgradePlan');
    }
    if (executionTerminal !== null && (
      executionTerminal.workspaceIdentityDigest !== plan.workspaceIdentityDigest ||
      executionTerminal.operationIdentityDigest !== plan.operationIdentityDigest ||
      executionTerminal.planRevision !== plan.planRevision ||
      executionTerminal.receipts.planArtifactRevision !== plan.planRevision
    )) {
      throw new UpgradeContractError('execution-terminal', 'provenance', 'Execution terminal does not match the retained UpgradePlan');
    }
    if (diagnostics !== null) {
      if (executionTerminal === null ||
        diagnostics.workspaceIdentityDigest !== plan.workspaceIdentityDigest ||
        diagnostics.operationIdentityDigest !== plan.operationIdentityDigest ||
        diagnostics.planRevision !== plan.planRevision ||
        diagnostics.attemptRevision !== executionTerminal.attempt.attemptRevision ||
        diagnostics.executionTerminalRevision !== executionTerminal.terminalRevision ||
        diagnostics.blockId !== plan.blockId || diagnostics.targetVersion !== plan.toVersion) {
        throw new UpgradeContractError('diagnostics', 'provenance', 'Execution diagnostics do not match the retained Plan and terminal');
      }
    }
    if (executionTerminal?.settlement === 'applied' && diagnostics !== null) {
      throw new UpgradeContractError('diagnostics', 'provenance', 'Applied execution cannot retain blocked diagnostics');
    }
    if (executionTerminal !== null && executionTerminal.settlement !== 'applied' && diagnostics === null) {
      throw new UpgradeContractError('diagnostics', 'provenance', 'Non-applied execution requires typed diagnostics');
    }
    if (executionTerminal?.settlement === 'applied' && (
      executionTerminal.readback.workspaceBlockVersion !== plan.toVersion ||
      executionTerminal.readback.resolvedBlockVersion !== plan.toVersion
    )) {
      throw new UpgradeContractError('execution-terminal', 'provenance', 'Applied terminal readback does not prove the target version');
    }
    if (executionTerminal?.settlement === 'rolled-back' && (
      executionTerminal.readback.workspaceBlockVersion !== plan.fromVersion ||
      (executionTerminal.readback.resolvedBlockVersion !== null && executionTerminal.readback.resolvedBlockVersion !== plan.fromVersion)
    )) {
      throw new UpgradeContractError('execution-terminal', 'provenance', 'Rolled-back terminal readback does not prove the source version');
    }
  }

  return deepFreeze({ plan, executionTerminal, diagnostics });
}

function parseJson(source: string, contract: UpgradeContractName): unknown {
  try {
    return parseExactJson(source, `${contract} JSON`);
  } catch (error) {
    throw new UpgradeContractError(
      contract,
      error instanceof ExactJsonError ? error.kind : 'invalid-json',
      `Invalid ${contract} JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export function parseUpgradePlanJson(source: string): UpgradePlan {
  return validateUpgradePlan(parseJson(source, 'plan'));
}

export function parseUpgradeExecutionTerminalJson(source: string): UpgradeExecutionTerminal {
  return validateUpgradeExecutionTerminal(parseJson(source, 'execution-terminal'));
}

export function parseUpgradeDiagnosticsJson(source: string): UpgradeDiagnostics {
  return validateUpgradeDiagnostics(parseJson(source, 'diagnostics'));
}
