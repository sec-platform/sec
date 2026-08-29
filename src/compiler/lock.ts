import path from 'node:path';
import { z } from 'zod';

import { expandCiGeneratedArtifactPaths } from '../verification/ci-artifacts/contract/manifest.ts';
import { uniqueSorted } from '../system-architecture/foundation/runtime/canonical.ts';
import { formatJsonFile, type CommitFence } from '../workspace/files.ts';
import {
  LOCK_APP_TARGETS,
  LOCK_FILE_FORMAT_VERSION,
  LOCK_PASS_STATES,
  LOCK_SLOT_TASK_STATUSES,
  MANIFEST_KINDS,
  SLOT_KINDS,
  type LockFile,
  type PassState,
  type PassStatus
} from './contract.ts';
import { REGISTRY_KINDS, REGISTRY_LOCATIONS } from './registry/contract/types.ts';
import { SEMANTIC_ENTITY_KINDS } from '../semantic/engineering-ir/contract/entity-types.ts';
import { FACT_PROVENANCE_KINDS, SEMANTIC_AUTHORITIES, SEMANTIC_PREDICATES } from '../semantic/engineering-ir/contract/fact-types.ts';
import { SEMANTIC_GENERATOR_ARTIFACT_KINDS, SEMANTIC_GENERATOR_CONSUME_KINDS, SEMANTIC_GENERATOR_KINDS, SEMANTIC_GENERATOR_TASK_STATUSES } from '../semantic/generation/contract/types.ts';
import { AUTHORITY_OVERLAY_STATUSES, INSPECTOR_SECTION_IDS, SEMANTIC_VIEW_FORMAT_VERSION, SEMANTIC_VIEW_KINDS, SEMANTIC_VIEW_SET_FORMAT_VERSION, VIEW_BADGES, VIEW_REFERENCE_KINDS } from '../semantic/projection/contract/types.ts';
import { getWorkspacePaths } from '../workspace/paths.ts';
import { createNoFollowDirectoryChain, inspectNoFollowDirectoryChain, PhysicalNoFollowError, readNoFollowOrdinaryFile, replaceDurableCanonicalFile, type PhysicalDirectoryIdentity } from '../runtime-state/physical/runtime/physical-no-follow.ts';

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
  slotTasks: z.array(z.strictObject({
    id: z.string(),
    block: z.string(),
    target: z.string(),
    sourcePath: z.string().optional(),
    symbol: z.string(),
    kind: z.enum(SLOT_KINDS),
    inputType: z.string().optional(),
    outputType: z.string().optional(),
    status: z.enum(LOCK_SLOT_TASK_STATUSES),
    writableZones: stringArraySchema,
    provenanceHints: z.strictObject({
      generator: z.string().nullable(),
      verifiedBy: stringArraySchema
    })
  })),
  semanticLoweringTasks: z.array(semanticGeneratorTaskSchema).optional(),
  semanticViews: z.strictObject({
    formatVersion: z.literal(SEMANTIC_VIEW_SET_FORMAT_VERSION),
    inputRevision: z.string(),
    semanticRevision: z.string(),
    views: z.array(semanticViewSchema)
  }).optional(),
  generatedPaths: stringArraySchema,
  acceptancePlan: stringArraySchema,
  passStatus: z.strictObject({
    parse: z.enum(LOCK_PASS_STATES),
    align: z.enum(LOCK_PASS_STATES),
    resolve: z.enum(LOCK_PASS_STATES),
    'build-ir': z.enum(LOCK_PASS_STATES).optional(),
    compose: z.enum(LOCK_PASS_STATES),
    adapt: z.enum(LOCK_PASS_STATES),
    verify: z.enum(LOCK_PASS_STATES),
    repair: z.enum(LOCK_PASS_STATES),
    lock: z.enum(LOCK_PASS_STATES),
    emit: z.enum(LOCK_PASS_STATES)
  })
});

function requireLockFileSchema(value: unknown, source: string): LockFile {
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

function decodeExactLockJson(bytes: Uint8Array, filePath: string): LockFile {
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Lock file at "${filePath}" is not exact UTF-8`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Lock file at "${filePath}" is not valid JSON`, { cause: error });
  }
  if (formatJsonFile(parsed) !== raw) {
    throw new Error(`Lock file at "${filePath}" is not canonical JSON`);
  }
  return requireLockFileSchema(parsed, `"${filePath}"`);
}

function readOptionalLockAtPath(filePath: string): LockFile | null {
  const absolutePath = path.resolve(filePath);
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absolutePath),
      'Lock parent directory'
    ).target;
    const bytes = readNoFollowOrdinaryFile(parent, path.basename(absolutePath));
    return bytes === null ? null : decodeExactLockJson(bytes, absolutePath);
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw error;
  }
}

function missingLockError(lockPath: string): NodeJS.ErrnoException {
  const absolutePath = path.resolve(lockPath);
  const error = new Error(`Lock file not found: ${absolutePath}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  error.path = absolutePath;
  return error;
}

/** Retained Lock observation is synchronous; publication remains asynchronous. */
export function readLockFile(workspaceRoot: string): LockFile {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const canonical = readOptionalLockAtPath(lockPath);
  if (canonical !== null) return canonical;
  throw missingLockError(lockPath);
}

function canonicalWorkspaceRootForLockPath(lockPath: string): string {
  const absolutePath = path.resolve(lockPath);
  const stateRoot = path.dirname(absolutePath);
  const controlRoot = path.dirname(stateRoot);
  const workspaceRoot = path.dirname(controlRoot);
  const expectedLockPath = path.resolve(getWorkspacePaths(workspaceRoot).lockPath);
  if (absolutePath !== expectedLockPath) {
    throw new Error(`Refusing non-canonical Lock publication path: ${absolutePath}`);
  }
  return workspaceRoot;
}

async function retainedLockParent(
  lockPath: string,
  commitFence?: CommitFence
): Promise<PhysicalDirectoryIdentity> {
  const absolutePath = path.resolve(lockPath);
  const workspaceRoot = canonicalWorkspaceRootForLockPath(absolutePath);
  const parentPath = path.dirname(absolutePath);
  try {
    return inspectNoFollowDirectoryChain(parentPath, 'Lock parent directory').target;
  } catch (error) {
    if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') {
      throw error;
    }
  }

  const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'Lock workspace root').target;
  await commitFence?.();
  return createNoFollowDirectoryChain(workspace, ['control', 'state']);
}

async function publishLockAtPath(
  lockPath: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const validatedLock = requireLockFileSchema(lock, 'the compiler producer');
  const parent = await retainedLockParent(lockPath, commitFence);
  const bytes = Buffer.from(formatJsonFile(validatedLock), 'utf8');
  await commitFence?.();
  replaceDurableCanonicalFile({
    parent,
    name: 'graph.lock.json',
    bytes,
    validate: (current) => {
      if (!Buffer.from(current).equals(bytes)) {
        throw new Error('Lock readback differs from canonical JSON bytes');
      }
    }
  });
}

export async function saveLock(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  await publishLockAtPath(lockPath, lock, commitFence);
}

export async function writeLockWithGeneratedPaths(
  lockPath: string,
  lock: LockFile,
  paths: readonly string[],
  commitFence?: CommitFence
): Promise<void> {
  const previousGeneratedPaths = [...lock.generatedPaths];
  addGeneratedPaths(lock, paths);
  try {
    await publishLockAtPath(lockPath, lock, commitFence);
  } catch (error) {
    lock.generatedPaths = previousGeneratedPaths;
    throw error;
  }
}

export async function writeGeneratedArtifactWithLock<T>(
  lockPath: string,
  lock: LockFile,
  paths: readonly string[],
  writeArtifact: () => Promise<T>,
  commitFence?: CommitFence
): Promise<T> {
  const previousGeneratedPaths = [...lock.generatedPaths];
  addGeneratedPaths(lock, expandCiGeneratedArtifactPaths(paths));
  try {
    const artifact = await writeArtifact();
    await publishLockAtPath(lockPath, lock, commitFence);
    return artifact;
  } catch (error) {
    lock.generatedPaths = previousGeneratedPaths;
    throw error;
  }
}
