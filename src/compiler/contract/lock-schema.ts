import { z } from 'zod';
import { SEMANTIC_ENTITY_KINDS } from '../../semantics/engineering-ir/entity-types.ts';
import { FACT_PROVENANCE_KINDS, SEMANTIC_AUTHORITIES, SEMANTIC_PREDICATES } from '../../semantics/engineering-ir/fact-types.ts';
import { SEMANTIC_GENERATOR_ARTIFACT_KINDS, SEMANTIC_GENERATOR_CONSUME_KINDS, SEMANTIC_GENERATOR_KINDS, SEMANTIC_GENERATOR_TASK_STATUSES } from '../../semantics/generation/types.ts';
import { AUTHORITY_OVERLAY_STATUSES, INSPECTOR_SECTION_IDS, SEMANTIC_VIEW_FORMAT_VERSION, SEMANTIC_VIEW_KINDS, SEMANTIC_VIEW_SET_FORMAT_VERSION, VIEW_BADGES, VIEW_REFERENCE_KINDS, type SemanticViewSet } from '../../semantics/projection/types.ts';
import { uniqueSorted } from '../../contracts/canonical.ts';
import { LOCK_APP_TARGETS, LOCK_FILE_FORMAT_VERSION, LOCK_PASS_STATES, MANIFEST_KINDS, type LockFile, type PassState, type PassStatus } from '../contract.ts';
import { REGISTRY_KINDS, REGISTRY_LOCATIONS } from '../../contracts/registry-source.ts';

const stringArraySchema = z.array(z.string());
const semanticValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(semanticValueSchema),
  z.record(z.string(), semanticValueSchema)
]));

const registryIdentitySchema = {
  registrySourceId: z.string(),
  registryKind: z.enum(REGISTRY_KINDS),
  registryLocation: z.enum(REGISTRY_LOCATIONS),
  registryPath: z.string()
} as const;

const semanticGeneratorTaskSchema = z.strictObject({
  id: z.string(),
  blockId: z.string(),
  generatorId: z.string(),
  generatorEntityId: z.string(),
  artifactEntityId: z.string(),
  inputRevision: z.string(),
  semanticRevision: z.string(),
  contractId: z.string(),
  contractPath: z.string(),
  contractNamespace: z.string(),
  target: z.string(),
  consumes: z.array(z.enum(SEMANTIC_GENERATOR_CONSUME_KINDS)),
  produces: z.enum(SEMANTIC_GENERATOR_ARTIFACT_KINDS),
  verification: stringArraySchema,
  verifiedByEntityIds: stringArraySchema,
  ...registryIdentitySchema,
  kind: z.enum(SEMANTIC_GENERATOR_KINDS),
  stateId: z.string(),
  stateEntityId: z.string(),
  stateValues: stringArraySchema,
  transitions: z.array(z.strictObject({
    from: z.string(),
    to: z.string(),
    by: z.string(),
    operationEntityId: z.string()
  })),
  typeBinding: z.strictObject({
    name: z.string(),
    importFrom: z.string()
  }),
  status: z.enum(SEMANTIC_GENERATOR_TASK_STATUSES),
  artifactBinding: z.strictObject({
    generatorEntityId: z.string(),
    artifactEntityId: z.string(),
    semanticRevision: z.string(),
    compilationTransactionId: z.string()
  }).optional()
});

const viewReferenceSchema = z.strictObject({
  kind: z.enum(VIEW_REFERENCE_KINDS),
  ref: z.string()
});

const semanticViewSchema = z.strictObject({
  formatVersion: z.literal(SEMANTIC_VIEW_FORMAT_VERSION),
  viewKind: z.enum(SEMANTIC_VIEW_KINDS),
  subject: z.string().optional(),
  nodes: z.array(z.strictObject({
    id: z.string(),
    entityId: z.string(),
    entityKind: z.enum(SEMANTIC_ENTITY_KINDS),
    label: z.string(),
    role: z.string().optional(),
    badges: z.array(z.enum(VIEW_BADGES)),
    group: z.string().optional(),
    references: z.array(viewReferenceSchema)
  })),
  edges: z.array(z.strictObject({
    id: z.string(),
    source: z.string(),
    target: z.string().optional(),
    value: semanticValueSchema.optional(),
    relation: z.enum(SEMANTIC_PREDICATES),
    label: z.string(),
    references: z.array(viewReferenceSchema)
  }).refine((edge) => (edge.target === undefined) !== (edge.value === undefined), {
    message: 'semantic view edge must have exactly one of target or value'
  })),
  inspector: z.array(z.strictObject({
    id: z.enum(INSPECTOR_SECTION_IDS),
    items: z.array(z.strictObject({
      key: z.string(),
      value: semanticValueSchema,
      references: z.array(viewReferenceSchema)
    }))
  })),
  overlays: z.array(z.strictObject({
    kind: z.literal('provenance-authority'),
    entries: z.array(z.strictObject({
      targetId: z.string(),
      factIds: stringArraySchema,
      status: z.enum(AUTHORITY_OVERLAY_STATUSES),
      authorities: z.array(z.enum(SEMANTIC_AUTHORITIES)),
      hasInferred: z.boolean(),
      hasConflict: z.boolean(),
      confidence: z.strictObject({ min: z.number(), max: z.number() }),
      provenanceKinds: z.array(z.enum(FACT_PROVENANCE_KINDS)),
      evidenceRefs: stringArraySchema
    }))
  }))
});

const semanticViewSetSchema = z.strictObject({
  formatVersion: z.literal(SEMANTIC_VIEW_SET_FORMAT_VERSION),
  inputRevision: z.string(),
  semanticRevision: z.string(),
  views: z.array(semanticViewSchema)
}).superRefine((semanticViews, context) => {
  const architectureViewCount = semanticViews.views.filter(
    (view) => view.viewKind === 'architecture'
  ).length;
  if (architectureViewCount !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['views'],
      message: `semantic view set must contain exactly one architecture view; received ${architectureViewCount}`
    });
  }
});

const lockFileSchema = z.strictObject({
  formatVersion: z.literal(LOCK_FILE_FORMAT_VERSION),
  app: z.strictObject({
    id: z.string(),
    name: z.string(),
    stack: z.string(),
    mode: z.string(),
    target: z.enum(LOCK_APP_TARGETS).optional()
  }),
  resolvedBlocks: z.array(z.strictObject({
    id: z.string(),
    version: z.string(),
    kind: z.enum(MANIFEST_KINDS),
    installOrder: z.number().int().nonnegative(),
    manifestPath: z.string(),
    ...registryIdentitySchema
  })),
  resolvedCapabilities: stringArraySchema,
  installPlan: z.array(z.strictObject({
    stepId: z.string(),
    blockId: z.string(),
    ...registryIdentitySchema,
    sourceRoot: z.string(),
    action: z.string(),
    from: z.string(),
    to: z.string()
  })),
  semanticLoweringTasks: z.array(semanticGeneratorTaskSchema).optional(),
  semanticViews: semanticViewSetSchema.optional(),
  generatedPaths: stringArraySchema,
  acceptancePlan: stringArraySchema,
  passStatus: z.strictObject({
    parse: z.enum(LOCK_PASS_STATES),
    align: z.enum(LOCK_PASS_STATES),
    resolve: z.enum(LOCK_PASS_STATES),
    'build-ir': z.enum(LOCK_PASS_STATES).optional(),
    compose: z.enum(LOCK_PASS_STATES),
    verify: z.enum(LOCK_PASS_STATES),
    repair: z.enum(LOCK_PASS_STATES),
    lock: z.enum(LOCK_PASS_STATES),
    emit: z.enum(LOCK_PASS_STATES)
  })
});

export function requireSemanticViewSetSchema(
  value: unknown,
  source: string
): SemanticViewSet {
  const result = semanticViewSetSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `SemanticViewSet from ${source} does not match ${SEMANTIC_VIEW_SET_FORMAT_VERSION}: ${z.prettifyError(result.error)}`
    );
  }
  return result.data as SemanticViewSet;
}

export function requireLockFileSchema(value: unknown, source: string): LockFile {
  const result = lockFileSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Lock file from ${source} does not match ${LOCK_FILE_FORMAT_VERSION}: ${z.prettifyError(result.error)}`
    );
  }
  return result.data as LockFile;
}

export function addGeneratedPaths(lock: Pick<LockFile, 'generatedPaths'>, paths: readonly string[]): void {
  lock.generatedPaths = uniqueSorted([...lock.generatedPaths, ...paths]);
}

export function assertPassStatus(lock: LockFile, pass: keyof PassStatus, state: PassState, error: Error, mode: 'equals' | 'differs' = 'equals'): void {
  if ((lock.passStatus[pass] === state) !== (mode === 'equals')) throw error;
}
