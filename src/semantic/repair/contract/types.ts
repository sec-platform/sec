import { z } from 'zod';

import { deepFreeze } from '../../../system-architecture/foundation/runtime/canonical.ts';

export const REPAIR_PLAN_FORMAT_VERSION = '1' as const;

const nonemptyText = z.string().min(1);
const nonnegativeInteger = z.number().int().nonnegative();
const stringList = z.array(nonemptyText);

const repairFailurePointSchema = z.object({
  lane: z.enum(['fast', 'runtime', 'all']),
  kind: z.enum([
    'build', 'unit', 'acceptance', 'policy', 'runtime-build',
    'runtime-unit', 'runtime-acceptance', 'summary'
  ]),
  issueType: z.enum(['slot', 'spec', 'kernel', 'unknown']),
  repairable: z.boolean(),
  artifactPath: nonemptyText,
  message: nonemptyText,
  targetIds: stringList.optional()
}).strict();

const repairTaskPreviewSchema = z.object({
  beforeLines: nonnegativeInteger,
  afterLines: nonnegativeInteger,
  addedLines: nonnegativeInteger,
  removedLines: nonnegativeInteger,
  changed: z.boolean()
}).strict();

const repairBlockerSchema = z.object({
  blockerId: nonemptyText,
  reason: nonemptyText,
  boundary: z.enum(['slot', 'spec', 'kernel', 'scope', 'unknown']),
  decisionRequired: nonemptyText,
  failurePoints: z.array(repairFailurePointSchema)
}).strict();

const repairTaskReviewSchema = z.object({
  allowedPathCount: nonnegativeInteger,
  requiredSymbolCount: nonnegativeInteger,
  forbiddenOperationCount: nonnegativeInteger,
  testCount: nonnegativeInteger,
  failureTargetCount: nonnegativeInteger,
  writeBounds: stringList,
  requiredSymbols: stringList,
  forbiddenOperations: stringList,
  testsToPass: stringList,
  failureTargets: stringList
}).strict().superRefine((review, context) => {
  const counts: Array<[number, number, string]> = [
    [review.allowedPathCount, review.writeBounds.length, 'allowedPathCount'],
    [review.requiredSymbolCount, review.requiredSymbols.length, 'requiredSymbolCount'],
    [review.forbiddenOperationCount, review.forbiddenOperations.length, 'forbiddenOperationCount'],
    [review.testCount, review.testsToPass.length, 'testCount'],
    [review.failureTargetCount, review.failureTargets.length, 'failureTargetCount']
  ];
  for (const [declared, actual, field] of counts) {
    if (declared !== actual) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} does not match its canonical inventory`
      });
    }
  }
});

const repairTaskSchema = z.object({
  taskId: nonemptyText,
  taskKind: z.literal('repair-slot'),
  category: z.enum(['slot-rewrite', 'config-repair', 'generated-artifact-refresh']).optional(),
  phase: z.literal('repair'),
  sourceSlotId: nonemptyText,
  targetBlock: nonemptyText,
  targetFile: nonemptyText,
  allowedPaths: stringList,
  requiredSymbols: stringList,
  forbiddenOperations: stringList,
  testsToPass: stringList,
  failureSummary: nonemptyText,
  failurePoints: z.array(repairFailurePointSchema),
  review: repairTaskReviewSchema.optional(),
  preview: repairTaskPreviewSchema.optional()
}).strict().superRefine((task, context) => {
  if (task.review === undefined) return;
  const reviewedLists: Array<[readonly string[], readonly string[], string]> = [
    [task.allowedPaths, task.review.writeBounds, 'writeBounds'],
    [task.requiredSymbols, task.review.requiredSymbols, 'requiredSymbols'],
    [task.forbiddenOperations, task.review.forbiddenOperations, 'forbiddenOperations'],
    [task.testsToPass, task.review.testsToPass, 'testsToPass']
  ];
  for (const [taskValues, reviewedValues, field] of reviewedLists) {
    if (taskValues.length !== reviewedValues.length || taskValues.some((value, index) => value !== reviewedValues[index])) {
      context.addIssue({
        code: 'custom', path: ['review', field],
        message: `review.${field} must exactly match the repair task inventory`
      });
    }
  }
});

export const RepairPlanSchema = z.object({
  formatVersion: z.literal(REPAIR_PLAN_FORMAT_VERSION),
  status: z.enum(['pending', 'applied', 'skipped', 'blocked']),
  sourceVerificationStatus: z.enum(['passed', 'failed']),
  requiresVerification: z.boolean(),
  tasks: z.array(repairTaskSchema),
  blockers: z.array(repairBlockerSchema).optional()
}).strict().superRefine((plan, context) => {
  if (plan.status === 'skipped' && (plan.sourceVerificationStatus !== 'passed' || plan.tasks.length !== 0)) {
    context.addIssue({
      code: 'custom', path: ['status'],
      message: 'skipped repair plans require a passed source and zero tasks'
    });
  }
  if (plan.status === 'blocked' && (plan.tasks.length !== 0 || (plan.blockers?.length ?? 0) === 0)) {
    context.addIssue({
      code: 'custom', path: ['status'],
      message: 'blocked repair plans require blockers and zero tasks'
    });
  }
  if (
    (plan.status === 'pending' || plan.status === 'applied' || plan.status === 'blocked') &&
    plan.sourceVerificationStatus !== 'failed'
  ) {
    context.addIssue({
      code: 'custom', path: ['sourceVerificationStatus'],
      message: `${plan.status} repair plans require a failed source verification`
    });
  }
  if (plan.status === 'skipped' && plan.requiresVerification) {
    context.addIssue({
      code: 'custom', path: ['requiresVerification'],
      message: 'skipped repair plans cannot require verification'
    });
  }
  if (plan.status === 'skipped' && (plan.blockers?.length ?? 0) !== 0) {
    context.addIssue({
      code: 'custom', path: ['blockers'],
      message: 'skipped repair plans cannot carry failure blockers'
    });
  }
  if (plan.status === 'pending' && plan.requiresVerification) {
    context.addIssue({
      code: 'custom', path: ['requiresVerification'],
      message: 'pending repair plans cannot require verification before application'
    });
  }
  if (plan.status === 'blocked' && plan.requiresVerification) {
    context.addIssue({
      code: 'custom', path: ['requiresVerification'],
      message: 'blocked repair plans cannot require verification'
    });
  }
  if (plan.status === 'applied' && !plan.requiresVerification) {
    context.addIssue({
      code: 'custom', path: ['requiresVerification'],
      message: 'applied repair plans require verification'
    });
  }
  if ((plan.status === 'pending' || plan.status === 'applied') && plan.tasks.length === 0) {
    context.addIssue({
      code: 'custom', path: ['tasks'],
      message: `${plan.status} repair plans require at least one task`
    });
  }
  const taskIds = new Set<string>();
  for (const [index, task] of plan.tasks.entries()) {
    if (taskIds.has(task.taskId)) {
      context.addIssue({
        code: 'custom', path: ['tasks', index, 'taskId'],
        message: 'repair task IDs must be unique'
      });
    }
    taskIds.add(task.taskId);
  }
  const blockerIds = new Set<string>();
  for (const [index, blocker] of (plan.blockers ?? []).entries()) {
    if (blockerIds.has(blocker.blockerId)) {
      context.addIssue({
        code: 'custom', path: ['blockers', index, 'blockerId'],
        message: 'repair blocker IDs must be unique'
      });
    }
    blockerIds.add(blocker.blockerId);
  }
});

export type RepairFailurePoint = z.infer<typeof repairFailurePointSchema>;
export type RepairTaskPreview = z.infer<typeof repairTaskPreviewSchema>;
export type RepairBlocker = z.infer<typeof repairBlockerSchema>;
export type RepairTask = z.infer<typeof repairTaskSchema>;
export type RepairTaskCategory = NonNullable<RepairTask['category']>;
export type RepairPlan = z.infer<typeof RepairPlanSchema>;

export function validateRepairPlan(value: unknown): RepairPlan {
  return deepFreeze(RepairPlanSchema.parse(value));
}

function rejectDuplicateJsonKeys(source: string): void {
  let offset = 0;

  function fail(message: string): never {
    throw new Error(`Repair plan JSON ${message}`);
  }

  function skipWhitespace(): void {
    while (offset < source.length && /\s/u.test(source[offset] ?? '')) offset += 1;
  }

  function readString(): string {
    const start = offset;
    if (source[offset] !== '"') fail(`expected a string at offset ${offset}`);
    offset += 1;
    let escaped = false;
    while (offset < source.length) {
      const character = source[offset] ?? '';
      offset += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        try {
          const value: unknown = JSON.parse(source.slice(start, offset));
          if (typeof value !== 'string') fail(`contains a non-string key at offset ${start}`);
          return value;
        } catch (error) {
          fail(`contains an invalid string at offset ${start}: ${String(error)}`);
        }
      }
      if (character < '\u0020') fail(`contains an unescaped control character at offset ${offset - 1}`);
    }
    fail(`contains an unterminated string at offset ${start}`);
  }

  function readValue(): void {
    skipWhitespace();
    const character = source[offset];
    if (character === '{') {
      readObject();
      return;
    }
    if (character === '[') {
      readArray();
      return;
    }
    if (character === '"') {
      readString();
      return;
    }

    const start = offset;
    while (
      offset < source.length &&
      !/[\s,\]}]/u.test(source[offset] ?? '')
    ) {
      offset += 1;
    }
    if (start === offset) fail(`contains an invalid value at offset ${offset}`);
  }

  function readObject(): void {
    offset += 1;
    skipWhitespace();
    const keys = new Set<string>();
    if (source[offset] === '}') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      skipWhitespace();
      const key = readString();
      if (keys.has(key)) fail(`contains duplicate key "${key}"`);
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') fail(`expected ':' after key "${key}" at offset ${offset}`);
      offset += 1;
      readValue();
      skipWhitespace();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') fail(`expected ',' or '}' at offset ${offset}`);
      offset += 1;
      skipWhitespace();
      if (source[offset] === '}') fail(`contains a trailing comma at offset ${offset}`);
    }
    fail('contains an unterminated object');
  }

  function readArray(): void {
    offset += 1;
    skipWhitespace();
    if (source[offset] === ']') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      readValue();
      skipWhitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') fail(`expected ',' or ']' at offset ${offset}`);
      offset += 1;
      skipWhitespace();
      if (source[offset] === ']') fail(`contains a trailing comma at offset ${offset}`);
    }
    fail('contains an unterminated array');
  }

  readValue();
  skipWhitespace();
  if (offset !== source.length) fail(`contains trailing data at offset ${offset}`);
}

/**
 * Parse the retained RepairPlan artifact. JSON.parse alone silently accepts
 * duplicate object keys, so the durable reader rejects that ambiguity before
 * applying the canonical schema and provenance checks above.
 */
export function parseRepairPlanJson(source: string): RepairPlan {
  rejectDuplicateJsonKeys(source);
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error('Repair plan is not valid JSON', { cause: error });
  }
  return validateRepairPlan(value);
}
