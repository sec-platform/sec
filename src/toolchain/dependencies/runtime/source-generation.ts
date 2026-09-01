import path from 'node:path';

import {
  generatedStateDigest,
  type GeneratedStatePhysicalIdentity
} from '../../../runtime-state/generated-state/contract.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  scanNoFollowDirectoryTreeInventory
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import {
  generatedStatePhysicalIdentity,
  isSha256Digest,
  sameGeneratedStateIdentity,
  type RuntimeDependencySourceGeneration
} from './dependency-transition/contract.ts';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationOptions,
  runtimeDependencyOperationRemainingMs,
  type RuntimeDependencyOperationOptions
} from './operation-context.ts';
import { measureRuntimeDependencyOperationPhase } from './operation-telemetry.ts';

export const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES = 100_000;
export const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES = 2 * 1024 * 1024 * 1024;

export interface RuntimeDependencySourceGenerationBounds {
  readonly maximumBytes: number;
  readonly maximumEntries: number;
}

export type RuntimeDependencySourceGenerationInput = Readonly<{
  binding: unknown;
  options: RuntimeDependencyOperationOptions;
  ownerRoot: string;
  sourcePath: string;
}>;

type RuntimeDependencySourceGenerationInFlight = Readonly<{
  bounds: RuntimeDependencySourceGenerationBounds;
  deadlineAtMonotonicMs: number;
  promise: Promise<RuntimeDependencySourceGeneration>;
  signal: AbortSignal | undefined;
}>;

const canonicalRuntimeDependencySourceGenerationBounds = Object.freeze({
  maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
  maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES
});

const runtimeDependencySourceGenerationInFlight = new Map<
  string,
  RuntimeDependencySourceGenerationInFlight
>();

function runtimeDependencySourceGenerationBounds(
  requested: Partial<RuntimeDependencySourceGenerationBounds> | undefined
): RuntimeDependencySourceGenerationBounds {
  const maximumBytes = requested?.maximumBytes ?? RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES;
  const maximumEntries = requested?.maximumEntries ?? RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 ||
      maximumBytes > RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES ||
      !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 ||
      maximumEntries > RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES) {
    throw new SecError(
      'RUNTIME-DEPS-003',
      'Runtime dependency source-generation bounds must narrow the canonical capacity'
    );
  }
  return Object.freeze({ maximumBytes, maximumEntries });
}

function sourcePathIsWithinOwner(ownerRoot: string, sourcePath: string): boolean {
  const relative = path.relative(ownerRoot, sourcePath);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function runtimeDependencyTreeIdentity(
  treeInventory: readonly Readonly<{
    relativePath: string;
    kind: string;
    device: string;
    inode: string;
    size: number;
    contentDigest: `sha256:${string}` | null;
    linkTarget: string | null;
  }>[]
): Readonly<{ treeDigest: `sha256:${string}`; treeEntryCount: number }> {
  const entries = Object.freeze(treeInventory.map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest: entry.contentDigest,
    linkTarget: entry.linkTarget
  })));
  return Object.freeze({
    treeDigest: generatedStateDigest(Object.freeze({
      schema: 'sec-runtime-dependency-source-tree-v1',
      entries
    })),
    treeEntryCount: entries.length
  });
}

function runtimeDependencySourceGenerationKey(
  input: RuntimeDependencySourceGenerationInput
): string {
  return JSON.stringify([
    path.resolve(input.ownerRoot),
    path.resolve(input.sourcePath),
    generatedStateDigest(input.binding),
    runtimeDependencyOperationContext(input.options).operationId
  ]);
}

async function runtimeDependencySourceGenerationInternal(
  input: RuntimeDependencySourceGenerationInput,
  bounds: RuntimeDependencySourceGenerationBounds
): Promise<RuntimeDependencySourceGeneration> {
  const options = runtimeDependencyOperationOptions(input.options);
  const context = runtimeDependencyOperationContext(options);
  runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation admission');
  const ownerRoot = path.resolve(input.ownerRoot);
  const sourcePath = path.resolve(input.sourcePath);
  if (!sourcePathIsWithinOwner(ownerRoot, sourcePath)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Runtime dependency source generation is outside its owner topology'
    );
  }
  const owner = inspectNoFollowDirectoryChain(
    ownerRoot,
    'Runtime dependency source owner root'
  );
  const source = inspectNoFollowDirectoryChain(
    sourcePath,
    'Runtime dependency source generation'
  );
  const ownerRootPhysical = generatedStatePhysicalIdentity(owner.target);
  if (![...source.ancestors, source.target].some((entry) =>
    sameGeneratedStateIdentity(generatedStatePhysicalIdentity(entry), ownerRootPhysical))) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Runtime dependency source generation has no physical owner ancestry'
    );
  }
  const physical = generatedStatePhysicalIdentity(source.target);
  const bindingDigest = generatedStateDigest(input.binding);
  const treeInventory = measureRuntimeDependencyOperationPhase(options, 'source-scan', () =>
    scanNoFollowDirectoryTreeInventory(source.target, {
      deadlineAtMs: context.deadlineAtMonotonicMs,
      maximumBytes: bounds.maximumBytes,
      maximumEntries: bounds.maximumEntries,
      signal: context.signal
    }));
  runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation readback');
  const currentOwner = assertSameNoFollowDirectoryIdentity(
    owner.target,
    'Runtime dependency source owner root readback'
  ).target;
  const currentSource = assertSameNoFollowDirectoryIdentity(
    source.target,
    'Runtime dependency source generation readback'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(currentOwner),
    ownerRootPhysical
  ) || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(currentSource),
    physical
  )) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Runtime dependency source physical identity changed during generation inventory'
    );
  }
  const { treeDigest, treeEntryCount } = runtimeDependencyTreeIdentity(treeInventory);
  const epoch = generatedStateDigest(Object.freeze({
    schema: 'sec-runtime-dependency-generation-epoch-v1',
    ownerRoot,
    ownerRootPhysical,
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount
  }));
  return Object.freeze({
    schema: 'sec-runtime-dependency-source-generation-v1' as const,
    ownerRoot,
    ownerRootPhysical,
    sourcePath,
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount,
    epoch
  });
}

function sameRuntimeDependencySourceGenerationBounds(
  left: RuntimeDependencySourceGenerationBounds,
  right: RuntimeDependencySourceGenerationBounds
): boolean {
  return left.maximumBytes === right.maximumBytes && left.maximumEntries === right.maximumEntries;
}

export async function runtimeDependencySourceGeneration(
  input: RuntimeDependencySourceGenerationInput,
  requestedBounds?: Partial<RuntimeDependencySourceGenerationBounds>
): Promise<RuntimeDependencySourceGeneration> {
  const options = runtimeDependencyOperationOptions(input.options);
  const context = runtimeDependencyOperationContext(options);
  runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation caller admission');
  const bounds = requestedBounds === undefined
    ? canonicalRuntimeDependencySourceGenerationBounds
    : runtimeDependencySourceGenerationBounds(requestedBounds);
  const key = runtimeDependencySourceGenerationKey({ ...input, options });
  const existing = runtimeDependencySourceGenerationInFlight.get(key);
  if (existing !== undefined) {
    if (existing.deadlineAtMonotonicMs !== context.deadlineAtMonotonicMs ||
        existing.signal !== context.signal ||
        !sameRuntimeDependencySourceGenerationBounds(existing.bounds, bounds)) {
      throw new SecError(
        'RUNTIME-DEPS-003',
        'Runtime dependency source-generation in-flight observation exceeds caller bounds'
      );
    }
    const result = await existing.promise;
    runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation joined readback');
    return result;
  }
  // Schedule the synchronous retained scan after publishing the in-flight
  // record. Calls admitted in the same turn can then share one exact
  // operation observation instead of starting a second full traversal.
  const pending = Promise.resolve().then(() => runtimeDependencySourceGenerationInternal(
    { ...input, options },
    bounds
  ));
  runtimeDependencySourceGenerationInFlight.set(key, Object.freeze({
    bounds,
    deadlineAtMonotonicMs: context.deadlineAtMonotonicMs,
    promise: pending,
    signal: context.signal
  }));
  try {
    const result = await pending;
    runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation caller readback');
    return result;
  } finally {
    if (runtimeDependencySourceGenerationInFlight.get(key)?.promise === pending) {
      runtimeDependencySourceGenerationInFlight.delete(key);
    }
  }
}

export function sameRuntimeDependencySourceGenerationContent(
  left: RuntimeDependencySourceGeneration,
  right: RuntimeDependencySourceGeneration
): boolean {
  return left.treeDigest === right.treeDigest && left.treeEntryCount === right.treeEntryCount;
}

export function isGeneratedStatePhysicalIdentity(
  value: unknown
): value is GeneratedStatePhysicalIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Partial<GeneratedStatePhysicalIdentity>;
  return typeof identity.device === 'string' && identity.device.length > 0 &&
    typeof identity.inode === 'string' && identity.inode.length > 0 &&
    typeof identity.objectId === 'string' && identity.objectId.length > 0;
}

export function isRuntimeDependencySourceGeneration(
  value: unknown
): value is RuntimeDependencySourceGeneration {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Partial<RuntimeDependencySourceGeneration>;
  return source.schema === 'sec-runtime-dependency-source-generation-v1' &&
    typeof source.ownerRoot === 'string' && path.isAbsolute(source.ownerRoot) &&
    typeof source.sourcePath === 'string' && path.isAbsolute(source.sourcePath) &&
    isGeneratedStatePhysicalIdentity(source.ownerRootPhysical) &&
    isGeneratedStatePhysicalIdentity(source.physical) &&
    isSha256Digest(source.bindingDigest) &&
    isSha256Digest(source.treeDigest) &&
    typeof source.treeEntryCount === 'number' && Number.isSafeInteger(source.treeEntryCount) &&
    source.treeEntryCount >= 0 && isSha256Digest(source.epoch);
}
