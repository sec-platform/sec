import path from 'node:path';
import { cloneAndDeepFreeze } from '../../../../contracts/canonical.ts';

import { CodedFailure } from '../../../../contracts/failure.ts';
import {
  generatedStateDigest,
  type GeneratedStatePhysicalIdentity
} from '../../../../execution/generated-state/contract.ts';
import {
  assertPhysicallyDisjointDirectoryChains,
  assertRetainedNoFollowProvenDirectoryGeneration,
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  scanNoFollowDirectoryTreeInventory,
  type ProvenDirectoryGenerationBinding,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { isRuntimeDependencyMaterializationBinding } from '../contract/runtime-dependency-spec.ts';
import { assertCompilerDependencySourceScope, compilerDependencySourcePathIsInScope } from './dependency-storage-layout.ts';
import {
  generatedStatePhysicalIdentity,
  isSha256Digest,
  runtimeDependencySourceGenerationEpoch,
  sameGeneratedStateIdentity,
  type RuntimeDependencySourceGeneration
} from './dependency-transition/contract.ts';
import type { CompilerDepsBinding } from './materialization-binding.ts';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  runtimeDependencyOperationRemainingMs,
  type BoundRuntimeDependencyOperationControls,
  type RuntimeDependencyOperationControlInput
} from './operation-controls.ts';
import { measureRuntimeDependencyOperationPhase } from './operation-telemetry.ts';

export const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES = 100_000;
export const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES = 2 * 1024 * 1024 * 1024;

export interface RuntimeDependencySourceGenerationBounds {
  readonly maximumBytes: number;
  readonly maximumEntries: number;
}

export type RuntimeDependencySourceGenerationInput = Readonly<{
  binding: unknown;
  options: RuntimeDependencyOperationControlInput;
  ownerRoot: string;
  sourcePath: string;
}>;

/** Private observation decision: no installation, lifecycle or test capabilities. */
type BoundSourceGenerationInput = Readonly<{
  options: BoundRuntimeDependencyOperationControls;
  ownerRoot: string;
  sourcePath: string;
  bindingDigest: `sha256:${string}`;
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

const issuedRuntimeDependencySourceGenerations = new WeakSet<object>();

function issueRuntimeDependencySourceGeneration(
  source: RuntimeDependencySourceGeneration
): RuntimeDependencySourceGeneration {
  issuedRuntimeDependencySourceGenerations.add(source);
  return source;
}

/**
 * Projects a publisher-authenticated physical generation proof into the
 * dependency source identity without rescanning every descendant. The
 * retained physical capability authenticates the exact tree and excludes
 * mutation; this owner only binds that proof to the dependency topology and
 * its canonical binding.
 */
export function issueRuntimeDependencySourceGenerationFromProvenDirectory(
  input: Readonly<{
    binding: unknown;
    generation: RetainedNoFollowProvenDirectoryGeneration;
    ownerRoot: string;
    proofBinding: ProvenDirectoryGenerationBinding;
    sourcePath: string;
  }>
): RuntimeDependencySourceGeneration {
  assertRetainedNoFollowProvenDirectoryGeneration(
    input.generation,
    'Runtime dependency proven source generation'
  );
  const ownerRoot = path.resolve(input.ownerRoot);
  const sourcePath = path.resolve(input.sourcePath);
  const owner = inspectNoFollowDirectoryChain(
    ownerRoot,
    'Runtime dependency proven source owner root'
  );
  const source = inspectNoFollowDirectoryChain(
    sourcePath,
    'Runtime dependency proven source generation'
  );
  const ownerRootPhysical = generatedStatePhysicalIdentity(owner.target);
  // A retained native publisher proof binds this exact physical source and
  // canonical owner epoch below. Ambient cache selection cannot revoke that
  // read-only object; ordinary unproven scans keep the current scope contract.
  if (compilerDependencySourcePathIsInScope(ownerRoot, sourcePath)) {
    assertCompilerDependencySourceScope(ownerRoot, sourcePath);
  } else {
    assertPhysicallyDisjointDirectoryChains(owner, source, 'Published dependency source and engineering owner');
  }
  const physical = generatedStatePhysicalIdentity(source.target);
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(input.generation.root),
    physical
  ) || path.resolve(input.generation.root.path) !== sourcePath) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime dependency physical proof belongs to another source generation');
  }
  const bindingDigest = generatedStateDigest(input.binding);
  const { treeDigest, treeEntryCount, generationDigest } = input.proofBinding;
  if (!isSha256Digest(treeDigest) || !isSha256Digest(generationDigest)
      || !Number.isSafeInteger(treeEntryCount) || treeEntryCount < 0) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime dependency physical proof binding is invalid');
  }
  const epoch = runtimeDependencySourceGenerationEpoch(Object.freeze({
    ownerRoot,
    ownerRootPhysical,
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount
  }));
  if (epoch !== generationDigest) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime dependency physical proof is not bound to the canonical source epoch');
  }
  return issueRuntimeDependencySourceGeneration(Object.freeze({
    schema: 'sec-runtime-dependency-source-generation-v1' as const,
    ownerRoot,
    ownerRootPhysical,
    sourcePath,
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount,
    epoch
  }));
}

export function assertRuntimeDependencySourceGenerationIssued(
  source: RuntimeDependencySourceGeneration
): void {
  if (!issuedRuntimeDependencySourceGenerations.has(source)) {
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Dependency transition source generation was not issued by the physical source compiler'
    );
  }
}

/** Rebind one already qualified immutable tree to the exact nested runtime
 * contract. This derives a new source epoch; it does not rename the native
 * publisher proof or claim that its compiler epoch belongs to this binding. */
export function deriveRuntimeMaterializationSourceGeneration(
  source: RuntimeDependencySourceGeneration,
  fullCompilerBinding: Readonly<CompilerDepsBinding>
): RuntimeDependencySourceGeneration {
  assertRuntimeDependencySourceGenerationIssued(source);
  // The existing binding digest hashes its owner-defined JSON property order.
  // Snapshot once without sorting that preimage, then consume only the clone.
  const captured = cloneAndDeepFreeze(fullCompilerBinding);
  if (captured.formatVersion !== 'compiler-deps-binding-v5' ||
      generatedStateDigest(captured) !== source.bindingDigest ||
      !isRuntimeDependencyMaterializationBinding(captured.runtimeMaterialization)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime source is not derived from its exact qualified compiler binding');
  }
  const owner = inspectNoFollowDirectoryChain(source.ownerRoot, 'Runtime source derived owner').target;
  const physical = inspectNoFollowDirectoryChain(source.sourcePath, 'Runtime source derived physical source').target;
  if (!sameGeneratedStateIdentity(generatedStatePhysicalIdentity(owner), source.ownerRootPhysical) ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(physical), source.physical)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime source derived physical identities changed');
  }
  const rebound = { ...source, bindingDigest: generatedStateDigest(captured.runtimeMaterialization) };
  return issueRuntimeDependencySourceGeneration(Object.freeze({ ...rebound,
    epoch: runtimeDependencySourceGenerationEpoch(rebound) }));
}

export function issuedRuntimeDependencySourceGenerationWithPath(
  source: RuntimeDependencySourceGeneration,
  sourcePath: string
): RuntimeDependencySourceGeneration {
  assertRuntimeDependencySourceGenerationIssued(source);
  return issueRuntimeDependencySourceGeneration(Object.freeze({
    ...source,
    sourcePath: path.resolve(sourcePath)
  }));
}

function runtimeDependencySourceGenerationBounds(
  requested: Partial<RuntimeDependencySourceGenerationBounds> | undefined
): RuntimeDependencySourceGenerationBounds {
  if (requested !== undefined && (requested === null || typeof requested !== 'object')) {
    throw new CodedFailure('RUNTIME-DEPS-003', 'Runtime dependency source-generation bounds must be an object');
  }
  const { maximumBytes: requestedBytes, maximumEntries: requestedEntries } = requested ?? {};
  const maximumBytes = requestedBytes === undefined ? RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES : requestedBytes;
  const maximumEntries = requestedEntries === undefined ? RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES : requestedEntries;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 ||
      maximumBytes > RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES ||
      !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 ||
      maximumEntries > RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES) {
    throw new CodedFailure(
      'RUNTIME-DEPS-003',
      'Runtime dependency source-generation bounds must narrow the canonical capacity'
    );
  }
  return Object.freeze({ maximumBytes, maximumEntries });
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

function runtimeDependencySourceGenerationKey(input: BoundSourceGenerationInput): string {
  return JSON.stringify([
    input.ownerRoot,
    input.sourcePath,
    input.bindingDigest,
    runtimeDependencyOperationContext(input.options).operationId
  ]);
}

async function runtimeDependencySourceGenerationInternal(
  input: BoundSourceGenerationInput,
  bounds: RuntimeDependencySourceGenerationBounds
): Promise<RuntimeDependencySourceGeneration> {
  const { options, ownerRoot, sourcePath, bindingDigest } = input;
  const context = runtimeDependencyOperationContext(options);
  runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation admission');
  const owner = inspectNoFollowDirectoryChain(
    ownerRoot,
    'Runtime dependency source owner root'
  );
  const source = inspectNoFollowDirectoryChain(
    sourcePath,
    'Runtime dependency source generation'
  );
  const ownerRootPhysical = generatedStatePhysicalIdentity(owner.target);
  assertCompilerDependencySourceScope(ownerRoot, sourcePath);
  const physical = generatedStatePhysicalIdentity(source.target);
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
    throw new CodedFailure(
      'RUNTIME-DEPS-004',
      'Runtime dependency source physical identity changed during generation inventory'
    );
  }
  const { treeDigest, treeEntryCount } = runtimeDependencyTreeIdentity(treeInventory);
  const epoch = runtimeDependencySourceGenerationEpoch(Object.freeze({
    ownerRoot,
    ownerRootPhysical,
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount
  }));
  return issueRuntimeDependencySourceGeneration(Object.freeze({
    schema: 'sec-runtime-dependency-source-generation-v1' as const,
    ownerRoot,
    ownerRootPhysical,
    sourcePath,
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount,
    epoch
  }));
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
  // Fix all decision inputs before the first clock callback or asynchronous
  // scan. The in-flight key, scan and issued result must describe this same
  // observation; never re-spread the caller after publishing the key.
  const cwd = process.cwd();
  const { ownerRoot: rawOwnerRoot, sourcePath: rawSourcePath, binding, options: rawOptions } = input;
  const ownerRoot = path.resolve(cwd, rawOwnerRoot);
  const sourcePath = path.resolve(cwd, rawSourcePath);
  if (!compilerDependencySourcePathIsInScope(ownerRoot, sourcePath)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Runtime dependency source generation is outside its owner topology');
  }
  const bounds = requestedBounds === undefined
    ? canonicalRuntimeDependencySourceGenerationBounds
    : runtimeDependencySourceGenerationBounds(requestedBounds);
  const bindingDigest = generatedStateDigest(binding);
  // The scan needs controls only. Do not enumerate the install compatibility
  // facade or transport lifecycle/test capabilities through a read operation.
  const options = runtimeDependencyOperationControls(rawOptions);
  const captured: BoundSourceGenerationInput = Object.freeze({ ownerRoot, sourcePath, bindingDigest, options });
  const context = runtimeDependencyOperationContext(options);
  runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation caller admission');
  const key = runtimeDependencySourceGenerationKey(captured);
  const existing = runtimeDependencySourceGenerationInFlight.get(key);
  if (existing !== undefined) {
    if (existing.deadlineAtMonotonicMs !== context.deadlineAtMonotonicMs ||
        existing.signal !== context.signal ||
        !sameRuntimeDependencySourceGenerationBounds(existing.bounds, bounds)) {
      throw new CodedFailure(
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
    captured,
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
