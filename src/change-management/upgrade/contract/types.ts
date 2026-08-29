import { z } from 'zod';

import { deepFreeze } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { isCanonicalPortableLogicalPath } from '../../../system-architecture/foundation/contract/logical-path.ts';

export const UPGRADE_PLAN_FORMAT_VERSION = '1' as const;
export const UPGRADE_DIAGNOSTICS_FORMAT_VERSION = '1' as const;

export type UpgradeContractName = 'plan' | 'diagnostics';
export type UpgradeContractFailureKind =
  | 'invalid-json'
  | 'duplicate-key'
  | 'schema'
  | 'status-impact'
  | 'provenance';

/**
 * A durable upgrade artifact is accepted only through this owner.  Keeping
 * the failure class machine-readable is important: a malformed or
 * unproven artifact must not be mistaken for an absent upgrade plan.
 */
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
const stringList = z.array(nonemptyText);
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
      context.addIssue({
        code: 'custom',
        path: [index],
        message: 'impact must be one canonical portable logical path'
      });
    }
    if (seen.has(impact)) {
      context.addIssue({
        code: 'custom',
        path: [index],
        message: 'impact paths must be unique'
      });
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

const migrationOperationRoleSchema = z.enum(['file', 'directory', 'json', 'text', 'slot', 'prisma']);
const upgradeMigrationOperationSchema = z.object({
  id: nonemptyText,
  kind: nonemptyText,
  target: migrationPath,
  role: migrationOperationRoleSchema,
  source: migrationPath.optional(),
  slotId: nonemptyText.optional(),
  inputType: nonemptyText.optional(),
  outputType: nonemptyText.optional(),
  writableZones: stringList.optional(),
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
  slotId: nonemptyText.optional(),
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
  'migration-slot-contracts',
  'impact-scan',
  'override-conflicts'
]);

const upgradePreflightCheckSchema = z.object({
  id: upgradePreflightCheckIdSchema,
  status: z.literal('passed'),
  message: nonemptyText,
  evidence: stringList
}).strict();

export const UpgradePlanSchema = z.object({
  formatVersion: z.literal(UPGRADE_PLAN_FORMAT_VERSION),
  blockId,
  fromVersion: semanticVersion,
  toVersion: semanticVersion,
  status: z.enum(['planned', 'applied']),
  preflightChecks: z.array(upgradePreflightCheckSchema),
  impacts: upgradeImpactListSchema,
  migrations: z.array(upgradeMigrationSchema),
  migrationKindCounts: z.record(nonemptyText, nonnegativeInteger),
  migrationSummaries: z.array(upgradeMigrationSummarySchema),
  migrationOperations: z.array(upgradeMigrationOperationSchema)
}).strict().superRefine((plan, context) => {
  if (plan.fromVersion === plan.toVersion) {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'upgrade plan must describe a version transition'
    });
  }

  const preflightIds = plan.preflightChecks.map((check) => check.id);
  if (new Set(preflightIds).size !== preflightIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['preflightChecks'],
      message: 'preflight check ids must be unique'
    });
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
  for (const [index, migration] of plan.migrations.entries()) {
    const summary = plan.migrationSummaries[index];
    const operation = plan.migrationOperations[index];
    if (summary && summary.kind !== migration.kind) {
      context.addIssue({
        code: 'custom',
        path: ['migrationSummaries', index, 'kind'],
        message: 'migration summary kind must match its migration'
      });
    }
    if (operation && operation.kind !== migration.kind) {
      context.addIssue({
        code: 'custom',
        path: ['migrationOperations', index, 'kind'],
        message: 'migration operation kind must match its migration'
      });
    }
  }
  const actualCounts = plan.migrations.reduce<Record<string, number>>((counts, migration) => {
    counts[migration.kind] = (counts[migration.kind] ?? 0) + 1;
    return counts;
  }, {});
  if (JSON.stringify(Object.entries(plan.migrationKindCounts).sort()) !== JSON.stringify(Object.entries(actualCounts).sort())) {
    context.addIssue({ code: 'custom', path: ['migrationKindCounts'], message: 'migration kind counts do not match migrations' });
  }
});

export const UpgradeDiagnosticsSchema = z.object({
  formatVersion: z.literal(UPGRADE_DIAGNOSTICS_FORMAT_VERSION),
  status: z.literal('blocked'),
  phase: z.enum(['planning', 'apply']),
  blockId,
  targetVersion: semanticVersion,
  failedCheck: z.union([upgradePreflightCheckIdSchema, z.enum(['target-manifest', 'plan-block'])]),
  errorCode: nonemptyText,
  message: nonemptyText,
  details: z.unknown().optional()
}).strict();

export type UpgradeMigrationOperation = z.infer<typeof upgradeMigrationOperationSchema>;
export type UpgradePreflightCheck = z.infer<typeof upgradePreflightCheckSchema>;
export type UpgradePlan = z.infer<typeof UpgradePlanSchema>;
export type UpgradeDiagnosticsPhase = z.infer<typeof UpgradeDiagnosticsSchema>['phase'];
export type UpgradeDiagnostics = z.infer<typeof UpgradeDiagnosticsSchema>;

function validationFailureKind(
  contract: UpgradeContractName,
  issues: readonly { path: readonly unknown[] }[]
): UpgradeContractFailureKind {
  const firstPath = issues[0]?.path[0];
  if (firstPath === 'formatVersion') return 'schema';
  if (contract === 'plan' && (firstPath === 'status' || firstPath === 'preflightChecks' || firstPath === 'impacts')) {
    return 'status-impact';
  }
  if (firstPath === 'blockId' || firstPath === 'fromVersion' || firstPath === 'toVersion' || firstPath === 'targetVersion') {
    return 'provenance';
  }
  if (contract === 'plan' && (firstPath === 'migrations' || firstPath === 'migrationSummaries' || firstPath === 'migrationOperations')) {
    return 'provenance';
  }
  return 'schema';
}

function validateUpgradeContract<T>(
  contract: UpgradeContractName,
  schema: { safeParse(value: unknown): unknown },
  value: unknown
): T {
  const result = schema.safeParse(value) as
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly unknown[] }[]; message: string } };
  if (!result.success) {
    throw new UpgradeContractError(
      contract,
      validationFailureKind(contract, result.error.issues),
      `${contract === 'plan' ? 'UpgradePlan authorization' : 'UpgradeDiagnostics artifact'} failed canonical validation: ${result.error.message}`,
      { cause: result.error }
    );
  }
  return deepFreeze(result.data);
}

export function validateUpgradePlan(value: unknown): UpgradePlan {
  return validateUpgradeContract('plan', UpgradePlanSchema, value);
}

export function validateUpgradeDiagnostics(value: unknown): UpgradeDiagnostics {
  return validateUpgradeContract('diagnostics', UpgradeDiagnosticsSchema, value);
}

function parseJsonStringWithUniqueObjectKeys(
  source: string,
  contract: UpgradeContractName
): unknown {
  if (typeof source !== 'string') {
    throw new UpgradeContractError(contract, 'invalid-json', `Invalid ${contract} JSON: expected UTF-8 text`);
  }
  let offset = 0;

  const fail = (
    kind: UpgradeContractFailureKind,
    message: string,
    cause?: unknown
  ): never => {
    throw new UpgradeContractError(contract, kind, message, cause === undefined ? undefined : { cause });
  };

  const skipWhitespace = (): void => {
    while (offset < source.length && /[\u0009\u000A\u000D\u0020]/u.test(source[offset]!)) offset += 1;
  };

  const parseStringToken = (): string => {
    const start = offset;
    if (source[offset] !== '"') fail('invalid-json', `Invalid ${contract} JSON: expected a string at offset ${offset}`);
    offset += 1;
    while (offset < source.length) {
      const character = source[offset]!;
      offset += 1;
      if (character === '"') return source.slice(start, offset);
      if (character === '\\') {
        if (offset >= source.length) fail('invalid-json', `Invalid ${contract} JSON: incomplete escape at offset ${offset}`);
        if (source[offset] === 'u') offset += 5;
        else offset += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        fail('invalid-json', `Invalid ${contract} JSON: unescaped control character at offset ${offset - 1}`);
      }
    }
    return fail('invalid-json', `Invalid ${contract} JSON: unterminated string`);
  };

  const parseValue = (): void => {
    skipWhitespace();
    const character = source[offset];
    if (character === '{') {
      offset += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        skipWhitespace();
        if (source[offset] !== '"') fail('invalid-json', `Invalid ${contract} JSON: expected an object key at offset ${offset}`);
        const keyToken = parseStringToken();
        let key = '';
        try {
          key = JSON.parse(keyToken) as string;
        } catch (error) {
          fail('invalid-json', `Invalid ${contract} JSON object key at offset ${offset}`, error);
        }
        if (keys.has(key)) {
          fail('duplicate-key', `${contract} JSON contains duplicate object key "${key}"`);
        }
        keys.add(key);
        skipWhitespace();
        if (source[offset] !== ':') fail('invalid-json', `Invalid ${contract} JSON: expected ':' at offset ${offset}`);
        offset += 1;
        parseValue();
        skipWhitespace();
        if (source[offset] === '}') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') fail('invalid-json', `Invalid ${contract} JSON: expected ',' or '}' at offset ${offset}`);
        offset += 1;
      }
      fail('invalid-json', `Invalid ${contract} JSON: unterminated object`);
    }
    if (character === '[') {
      offset += 1;
      skipWhitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        parseValue();
        skipWhitespace();
        if (source[offset] === ']') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') fail('invalid-json', `Invalid ${contract} JSON: expected ',' or ']' at offset ${offset}`);
        offset += 1;
      }
      fail('invalid-json', `Invalid ${contract} JSON: unterminated array`);
    }
    if (character === '"') {
      parseStringToken();
      return;
    }
    if (character === undefined) fail('invalid-json', `Invalid ${contract} JSON: expected a value at offset ${offset}`);
    const start = offset;
    while (offset < source.length && !/[\u0009\u000A\u000D\u0020,\]}]/u.test(source[offset]!)) offset += 1;
    if (start === offset) fail('invalid-json', `Invalid ${contract} JSON: expected a value at offset ${offset}`);
  };

  parseValue();
  skipWhitespace();
  if (offset !== source.length) fail('invalid-json', `Invalid ${contract} JSON: trailing content at offset ${offset}`);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail('invalid-json', `Invalid ${contract} JSON`, error);
  }
}

/**
 * Parses the raw durable plan bytes after rejecting duplicate JSON keys. A
 * caller that already has an object may use validateUpgradePlan, but it
 * cannot recover duplicate-key information that JSON.parse discarded.
 */
export function parseUpgradePlanJson(source: string): UpgradePlan {
  return validateUpgradePlan(parseJsonStringWithUniqueObjectKeys(source, 'plan'));
}

/** Parses raw durable diagnostics with the same exact-key and schema gate. */
export function parseUpgradeDiagnosticsJson(source: string): UpgradeDiagnostics {
  return validateUpgradeDiagnostics(parseJsonStringWithUniqueObjectKeys(source, 'diagnostics'));
}
