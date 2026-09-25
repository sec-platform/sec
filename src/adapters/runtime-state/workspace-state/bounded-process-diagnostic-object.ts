import path from 'node:path';

import {
  compareCodeUnits,
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import {
  assertSemanticOperationProjection,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import {
  PhysicalNoFollowError,
  deleteRetainedNoFollowEntry,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryTreeMetadata,
  type NoFollowDirectoryTreeInventoryEntry,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from '../physical/runtime/physical-no-follow.ts';
import {
  BOUNDED_PROCESS_DIAGNOSTIC_MAXIMUM_STREAM_BYTES,
  BOUNDED_PROCESS_DIAGNOSTIC_METADATA_MAXIMUM_BYTES,
  BoundedProcessDiagnosticObjectError,
  createBoundedProcessDiagnosticObjectReceipt,
  encodeBoundedProcessDiagnosticObjectReceipt,
  parseBoundedProcessDiagnosticObjectReceipt,
  type BoundedProcessDiagnosticFailureKind,
  type BoundedProcessDiagnosticObjectReadbackReceipt,
  type BoundedProcessDiagnosticObjectReceipt,
  type BoundedProcessDiagnosticPublishedObject,
  type BoundedProcessDiagnosticStream
} from './bounded-process-diagnostic-contract.ts';
import { resolveWorkspaceRuntimeRoots } from './paths.ts';
import {
  assertRuntimeStatePhysicalAuthority,
  type RuntimeStatePhysicalAuthority
} from './physical-authority.ts';

export {



  BoundedProcessDiagnosticObjectError,





  type BoundedProcessDiagnosticPublishedObject,
  type BoundedProcessDiagnosticStream
} from './bounded-process-diagnostic-contract.ts';

const BOUNDED_PROCESS_DIAGNOSTIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_MAXIMUM_DURATION_MS = 30_000;
const GC_MAXIMUM_RECORDS = 1_024;

type BoundedProcessDiagnosticRead = Readonly<{
  status: 'available';
  receipt: BoundedProcessDiagnosticObjectReceipt;
  bytes: Uint8Array;
  readback: BoundedProcessDiagnosticObjectReadbackReceipt;
}> | Readonly<{
  status: 'absent' | 'expired';
  receipt: BoundedProcessDiagnosticObjectReceipt;
}>;

type BoundedProcessDiagnosticGcReceipt = Readonly<{
  operationIdentityDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  observedObjects: number;
  retainedObjects: number;
  deletedObjects: number;
  incompleteObjects: number;
  unknownObjects: number;
  readBytes: number;
  receiptDigest: OperationDigest;
}>;

type BoundedProcessDiagnosticPublishInput = Readonly<{
  operation: BoundSemanticOperation;
  requirementId: string;
  subjectDigest: OperationDigest;
  settlementDigest: OperationDigest;
  streams: readonly Readonly<{
    stream: BoundedProcessDiagnosticStream;
    bytes: Uint8Array;
  }>[];
  signal?: AbortSignal;
}>;

type BoundedProcessDiagnosticReadInput = Readonly<{
  operation: BoundSemanticOperation;
  requirementId: string;
  receipt: BoundedProcessDiagnosticObjectReceipt;
  signal?: AbortSignal;
}>;

type BoundedProcessDiagnosticGcInput = Readonly<{
  operation: BoundSemanticOperation;
  requirementId: string;
  signal?: AbortSignal;
}>;

export interface BoundedProcessDiagnosticObjectStore {
  publish(input: BoundedProcessDiagnosticPublishInput):
    Promise<readonly BoundedProcessDiagnosticPublishedObject[]>;
  read(input: BoundedProcessDiagnosticReadInput): Promise<BoundedProcessDiagnosticRead>;
  gc(input: BoundedProcessDiagnosticGcInput): Promise<BoundedProcessDiagnosticGcReceipt>;
}

type OperationControl = Readonly<{
  deadlineAtMonotonicMs: number;
  maximumBytes: number;
  maximumRecords: number;
  signal?: AbortSignal;
  assertLive(): void;
}>;

function fail(
  kind: BoundedProcessDiagnosticFailureKind,
  message: string,
  cause?: unknown
): never {
  throw new BoundedProcessDiagnosticObjectError(kind, message, cause);
}

function exactDigest(value: unknown, label: string): OperationDigest {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail('corrupt-object', `${label} is not a canonical SHA-256 digest`);
  }
  return value as OperationDigest;
}

function operationControl(input: Readonly<{
  operation: BoundSemanticOperation;
  requirementId: string;
  signal?: AbortSignal;
}>, options: Readonly<{
  byteResource: 'input-bytes' | 'output-bytes';
  requireRecords?: boolean;
}>): OperationControl {
  assertSemanticOperationProjection(input.operation);
  const requirement = input.operation.plan.execution.requirements
    .find(({ id }) => id === input.requirementId);
  if (requirement === undefined || !requirement.effectKinds.includes('filesystem')) {
    fail('resource-exhausted', 'Diagnostic object operation requires one filesystem Effect');
  }
  if (!input.operation.bindings.some(({ requirementId, contractDigest }) => (
    requirementId === requirement.id && contractDigest === requirement.contractDigest
  ))) {
    fail('resource-exhausted', 'Diagnostic object filesystem Effect is unbound');
  }
  const budget = (
    resource: 'duration-ms' | 'input-bytes' | 'output-bytes' | 'records',
    ceiling: number
  ): number => {
    const value = input.operation.plan.execution.aggregateBudgets
      .find((candidate) => candidate.resource === resource)?.maximum;
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      fail('resource-exhausted', `Diagnostic object operation lacks ${resource} budget`);
    }
    return Math.min(value as number, ceiling);
  };
  const nowUnixMs = Date.now();
  const durationMs = Math.min(
    budget('duration-ms', OPERATION_MAXIMUM_DURATION_MS),
    input.operation.plan.attempt.deadlineAtUnixMs - nowUnixMs
  );
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || input.signal?.aborted === true) {
    fail('deadline-exhausted', 'Diagnostic object operation is cancelled or expired');
  }
  const deadlineAtMonotonicMs = performance.now() + durationMs;
  const control = Object.freeze({
    deadlineAtMonotonicMs,
    maximumBytes: budget(
      options.byteResource,
      BOUNDED_PROCESS_DIAGNOSTIC_MAXIMUM_STREAM_BYTES * 2
    ),
    maximumRecords: options.requireRecords === true ? budget('records', GC_MAXIMUM_RECORDS) : 1,
    signal: input.signal,
    assertLive(): void {
      if (input.signal?.aborted === true || performance.now() >= deadlineAtMonotonicMs
          || Date.now() >= input.operation.plan.attempt.deadlineAtUnixMs) {
        fail('deadline-exhausted', 'Diagnostic object operation deadline is exhausted');
      }
    }
  });
  control.assertLive();
  return control;
}

function objectLeaf(receipt: BoundedProcessDiagnosticObjectReceipt, suffix: 'bin' | 'json'): string {
  return `${receipt.objectDigest.slice('sha256:'.length)}.${suffix}`;
}

function pendingLeaf(receipt: BoundedProcessDiagnosticObjectReceipt): string {
  return `${receipt.objectDigest.slice('sha256:'.length)}.pending.json`;
}

function readRetainedLeaf(
  root: PhysicalDirectoryIdentity,
  name: string,
  maximumBytes: number,
  control: OperationControl
): Readonly<{ bytes: Uint8Array; physicalIdentityDigest: OperationDigest }> | null {
  control.assertLive();
  const chain = inspectNoFollowDirectoryChain(root.path, 'Diagnostic object root read');
  let retained: RetainedNoFollowOrdinaryFile;
  try {
    retained = retainNoFollowOrdinaryFile(chain, name, undefined, 'Diagnostic object retained leaf');
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw error;
  }
  try {
    if (retained.size > maximumBytes) {
      fail('resource-exhausted', `Diagnostic object leaf ${name} exceeds its byte ceiling`);
    }
    const bytes = retained.readBytes();
    control.assertLive();
    if (bytes.byteLength > maximumBytes) {
      fail('resource-exhausted', `Diagnostic object leaf ${name} read exceeds its byte ceiling`);
    }
    return Object.freeze({
      bytes: new Uint8Array(bytes),
      physicalIdentityDigest: sha256({
        parentObjectId: retained.parent.objectId,
        name: retained.name,
        device: retained.physical.device,
        inode: retained.physical.inode
      }) as OperationDigest
    });
  } finally {
    retained.dispose();
  }
}

function canonicalReceipt(receipt: BoundedProcessDiagnosticObjectReceipt) {
  return parseBoundedProcessDiagnosticObjectReceipt(
    encodeBoundedProcessDiagnosticObjectReceipt(receipt)
  );
}

async function atDiagnosticBoundary<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BoundedProcessDiagnosticObjectError) throw error;
    const kind: BoundedProcessDiagnosticFailureKind = error instanceof PhysicalNoFollowError
      ? 'physical-replacement'
      : 'corrupt-object';
    fail(kind, 'Bounded process diagnostic object operation failed', error);
  }
}

function deleteInventoriedFile(
  root: PhysicalDirectoryIdentity,
  entry: NoFollowDirectoryTreeInventoryEntry
): void {
  deleteRetainedNoFollowEntry({
    root,
    relativePath: entry.relativePath,
    kind: 'file',
    device: entry.device,
    inode: entry.inode,
    ancestorDirectories: []
  });
}

export function createBoundedProcessDiagnosticObjectStore(input: Readonly<{
  authority: RuntimeStatePhysicalAuthority;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): BoundedProcessDiagnosticObjectStore {
  assertRuntimeStatePhysicalAuthority(input.authority);
  const roots = resolveWorkspaceRuntimeRoots({
    repositoryRoot: input.repositoryRoot,
    environment: input.environment
  });
  const root = input.authority.directory(roots.processDiagnosticObjectRoot);

  const readCurrent = async (
    readInput: BoundedProcessDiagnosticReadInput,
    assertAuthority: boolean
  ): Promise<BoundedProcessDiagnosticRead> => atDiagnosticBoundary(async () => {
    const control = operationControl(readInput, { byteResource: 'input-bytes' });
    const receipt = canonicalReceipt(readInput.receipt);
    if (assertAuthority) input.authority.assertRootIdentityCurrent();
    const metadata = readRetainedLeaf(
      root,
      objectLeaf(receipt, 'json'),
      BOUNDED_PROCESS_DIAGNOSTIC_METADATA_MAXIMUM_BYTES,
      control
    );
    if (metadata === null) {
      if (inspectNoFollowDirectoryChild(root, objectLeaf(receipt, 'bin')) !== null) {
        fail('incomplete-object', 'Diagnostic payload exists without canonical metadata');
      }
      return Object.freeze({ status: 'absent' as const, receipt });
    }
    const observed = parseBoundedProcessDiagnosticObjectReceipt(
      new TextDecoder('utf-8', { fatal: true }).decode(metadata.bytes)
    );
    if (observed.objectDigest !== receipt.objectDigest
        || encodeBoundedProcessDiagnosticObjectReceipt(observed)
          !== encodeBoundedProcessDiagnosticObjectReceipt(receipt)) {
      fail('corrupt-object', 'Diagnostic metadata conflicts with the supplied receipt');
    }
    if (Date.now() >= receipt.retainedUntilUnixMs) {
      return Object.freeze({ status: 'expired' as const, receipt });
    }
    if (metadata.bytes.byteLength + receipt.byteLength > control.maximumBytes) {
      fail('resource-exhausted', 'Diagnostic readback exceeds its input byte budget');
    }
    const payload = readRetainedLeaf(root, objectLeaf(receipt, 'bin'), receipt.byteLength, control);
    if (payload === null) fail('incomplete-object', 'Diagnostic metadata has no payload');
    if (payload.bytes.byteLength !== receipt.byteLength
        || rawSha256(payload.bytes) !== receipt.contentDigest) {
      fail('corrupt-object', 'Diagnostic payload differs from its receipt');
    }
    control.assertLive();
    input.authority.assertRootIdentityCurrent();
    const readbackUnsigned = Object.freeze({
      disposition: 'current' as const,
      objectDigest: receipt.objectDigest,
      physicalIdentityDigest: payload.physicalIdentityDigest,
      contentDigest: receipt.contentDigest,
      byteLength: receipt.byteLength
    });
    return Object.freeze({
      status: 'available' as const,
      receipt,
      bytes: payload.bytes,
      readback: Object.freeze({
        ...readbackUnsigned,
        readbackDigest: sha256(readbackUnsigned) as OperationDigest
      })
    });
  });
  const read = async (
    readInput: BoundedProcessDiagnosticReadInput
  ): Promise<BoundedProcessDiagnosticRead> => readCurrent(readInput, true);

  return Object.freeze({
    async publish(publishInput: BoundedProcessDiagnosticPublishInput) {
      return atDiagnosticBoundary(async () => {
        const control = operationControl(publishInput, { byteResource: 'output-bytes' });
        exactDigest(publishInput.subjectDigest, 'Diagnostic subject');
        exactDigest(publishInput.settlementDigest, 'Diagnostic process settlement');
        const streams = [...publishInput.streams].sort((left, right) => (
          compareCodeUnits(left.stream, right.stream)
        ));
        if (streams.length < 1 || streams.length > 2
            || new Set(streams.map(({ stream }) => stream)).size !== streams.length
            || streams.some(({ stream }) => (
              stream !== 'combined-tail' && stream !== 'stdout' && stream !== 'stderr'
            ))
            || (streams.some(({ stream }) => stream === 'combined-tail') && streams.length !== 1)) {
          fail('corrupt-object', 'Diagnostic publication requires one or two unique canonical streams');
        }
        const totalBytes = streams.reduce((total, { bytes }) => total + bytes.byteLength, 0);
        if (streams.some(({ bytes }) => (
          bytes.byteLength > BOUNDED_PROCESS_DIAGNOSTIC_MAXIMUM_STREAM_BYTES
        )) || totalBytes > control.maximumBytes) {
          fail('resource-exhausted', 'Diagnostic publication exceeds its output byte budget');
        }
        const retainedUntilUnixMs = publishInput.operation.plan.attempt.deadlineAtUnixMs
          + BOUNDED_PROCESS_DIAGNOSTIC_RETENTION_MS;
        if (!Number.isSafeInteger(retainedUntilUnixMs)) {
          fail('resource-exhausted', 'Diagnostic retention deadline exceeds safe integer range');
        }
        const receipts = streams.map(({ stream, bytes }) => createBoundedProcessDiagnosticObjectReceipt({
          operationIdentityDigest: publishInput.operation.plan.identity.identityDigest,
          executionPlanDigest: publishInput.operation.plan.execution.executionPlanDigest,
          boundAttemptDigest: publishInput.operation.boundAttemptDigest,
          subjectDigest: publishInput.subjectDigest,
          settlementDigest: publishInput.settlementDigest,
          stream,
          bytes,
          retainedUntilUnixMs
        }));
        input.authority.assertRootIdentityCurrent();
        for (let index = 0; index < streams.length; index += 1) {
          control.assertLive();
          const receipt = receipts[index]!;
          const bytes = new Uint8Array(streams[index]!.bytes);
          const metadata = new TextEncoder().encode(
            encodeBoundedProcessDiagnosticObjectReceipt(receipt)
          );
          // The object-local pending receipt is not read authority. It gives
          // GC an exact owner/retention proof for every partial publication.
          publishExclusiveDurableCanonicalFile({
            parent: root,
            name: pendingLeaf(receipt),
            bytes: metadata,
            validate: (candidate) => {
              const parsed = parseBoundedProcessDiagnosticObjectReceipt(
                new TextDecoder('utf-8', { fatal: true }).decode(candidate)
              );
              if (parsed.objectDigest !== receipt.objectDigest) {
                fail('corrupt-object', 'Diagnostic pending publication differs from receipt');
              }
            }
          });
          control.assertLive();
          publishExclusiveDurableCanonicalFile({
            parent: root,
            name: objectLeaf(receipt, 'json'),
            bytes: metadata,
            validate: (candidate) => {
              const parsed = parseBoundedProcessDiagnosticObjectReceipt(
                new TextDecoder('utf-8', { fatal: true }).decode(candidate)
              );
              if (parsed.objectDigest !== receipt.objectDigest) {
                fail('corrupt-object', 'Diagnostic metadata publication differs from receipt');
              }
            }
          });
          control.assertLive();
          publishExclusiveDurableCanonicalFile({
            parent: root,
            name: objectLeaf(receipt, 'bin'),
            bytes,
            validate: (candidate) => {
              if (candidate.byteLength !== receipt.byteLength
                  || rawSha256(candidate) !== receipt.contentDigest) {
                fail('corrupt-object', 'Diagnostic payload publication differs from receipt');
              }
            }
          });
          input.authority.assertRootIdentityCurrent();
        }
        const published: BoundedProcessDiagnosticPublishedObject[] = [];
        for (const receipt of receipts) {
          const loaded = await readCurrent({ ...publishInput, receipt }, false);
          if (loaded.status !== 'available') {
            fail('incomplete-object', 'Diagnostic publication did not produce strict readback');
          }
          published.push(Object.freeze({ receipt, readback: loaded.readback }));
        }
        return Object.freeze(published);
      });
    },
    read,
    async gc(gcInput: BoundedProcessDiagnosticGcInput) {
      return atDiagnosticBoundary(async () => {
        const control = operationControl(gcInput, {
          byteResource: 'input-bytes',
          requireRecords: true
        });
        input.authority.assertRootIdentityCurrent();
        const inventory = scanNoFollowDirectoryTreeMetadata(root, {
          deadlineAtMs: control.deadlineAtMonotonicMs,
          maximumEntries: control.maximumRecords,
          signal: control.signal
        });
        const entries = new Map(inventory.map((entry) => [entry.relativePath, entry] as const));
        if (inventory.some(({ relativePath, kind }) => (
          kind !== 'file' || !/^[0-9a-f]{64}\.(?:bin|json|pending\.json)$/u.test(relativePath)
        ))) {
          fail('foreign-residue', 'Diagnostic object root contains noncanonical residue');
        }
        let remainingInputBytes = control.maximumBytes;
        let readBytes = 0;
        const readAdmittedMetadata = (
          entry: NoFollowDirectoryTreeInventoryEntry,
          label: string
        ): BoundedProcessDiagnosticObjectReceipt => {
          control.assertLive();
          if (entry.size > BOUNDED_PROCESS_DIAGNOSTIC_METADATA_MAXIMUM_BYTES) {
            fail('resource-exhausted', `${label} exceeds its metadata byte ceiling`);
          }
          if (entry.size > remainingInputBytes) {
            fail('resource-exhausted', 'Diagnostic GC input byte budget is exhausted before metadata read');
          }
          remainingInputBytes -= entry.size;
          const observed = readRetainedLeaf(
            root,
            entry.relativePath,
            BOUNDED_PROCESS_DIAGNOSTIC_METADATA_MAXIMUM_BYTES,
            control
          );
          if (observed === null) {
            fail('physical-replacement', `${label} disappeared during GC census`);
          }
          readBytes += observed.bytes.byteLength;
          return parseBoundedProcessDiagnosticObjectReceipt(
            new TextDecoder('utf-8', { fatal: true }).decode(observed.bytes)
          );
        };
        const metadataEntries = inventory.filter(({ relativePath }) => (
          /^[0-9a-f]{64}\.json$/u.test(relativePath)
        )).sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
        const committed: Readonly<{
          receipt: BoundedProcessDiagnosticObjectReceipt;
          metadata: NoFollowDirectoryTreeInventoryEntry;
          payload: NoFollowDirectoryTreeInventoryEntry | null;
        }>[] = metadataEntries.map((metadata) => {
          const receipt = readAdmittedMetadata(metadata, 'Diagnostic metadata');
          if (metadata.relativePath !== objectLeaf(receipt, 'json')) {
            fail('corrupt-object', 'Diagnostic metadata filename does not bind its object digest');
          }
          return Object.freeze({
            receipt,
            metadata,
            payload: entries.get(objectLeaf(receipt, 'bin')) ?? null
          });
        });
        const pendingEntries = inventory.filter(({ relativePath }) => (
          relativePath.endsWith('.pending.json')
        )).sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
        const pending = new Map<OperationDigest, Readonly<{
          receipt: BoundedProcessDiagnosticObjectReceipt;
          entry: NoFollowDirectoryTreeInventoryEntry;
        }>>();
        for (const entry of pendingEntries) {
          const receipt = readAdmittedMetadata(entry, 'Diagnostic pending receipt');
          if (entry.relativePath !== pendingLeaf(receipt)) {
            fail('corrupt-object', 'Diagnostic pending filename does not bind its object digest');
          }
          pending.set(receipt.objectDigest, Object.freeze({ receipt, entry }));
        }
        const committedDigests = new Set(committed.map(({ receipt }) => receipt.objectDigest));
        const pendingDigests = new Set(pending.keys());
        const payloadEntries = inventory
          .filter(({ relativePath }) => relativePath.endsWith('.bin'))
          .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
        const unknownPayloads = payloadEntries.filter(({ relativePath }) => {
          const digest = `sha256:${path.basename(relativePath, '.bin')}` as OperationDigest;
          return !committedDigests.has(digest) && !pendingDigests.has(digest);
        });
        for (const { receipt, payload } of committed) {
          control.assertLive();
          if (payload === null) continue;
          if (payload.size !== receipt.byteLength) {
            fail('corrupt-object', 'Diagnostic payload inventory length differs from its receipt');
          }
          if (payload.size > remainingInputBytes) {
            fail('resource-exhausted', 'Diagnostic GC input byte budget is exhausted before payload read');
          }
          remainingInputBytes -= payload.size;
          const payloadBytes = readRetainedLeaf(
            root,
            payload.relativePath,
            receipt.byteLength,
            control
          );
          if (payloadBytes === null) fail('physical-replacement', 'Diagnostic payload disappeared during GC readback');
          if (payloadBytes.bytes.byteLength !== receipt.byteLength
              || rawSha256(payloadBytes.bytes) !== receipt.contentDigest) {
            fail('corrupt-object', 'Diagnostic payload differs from its receipt during GC');
          }
          readBytes += payloadBytes.bytes.byteLength;
        }
        const now = Date.now();
        let deletedObjects = 0;
        let retainedObjects = 0;
        let incompleteObjects = unknownPayloads.length;
        for (const object of committed) {
          control.assertLive();
          const lifecycle = pending.get(object.receipt.objectDigest) ?? null;
          if (now >= object.receipt.retainedUntilUnixMs) {
            if (object.payload !== null) deleteInventoriedFile(root, object.payload);
            deleteInventoriedFile(root, object.metadata);
            if (lifecycle !== null) deleteInventoriedFile(root, lifecycle.entry);
            deletedObjects += 1;
          } else {
            retainedObjects += 1;
            if (object.payload === null) incompleteObjects += 1;
            if (object.payload !== null && lifecycle !== null) {
              // Exact committed metadata and validated payload make the
              // non-authoritative pending marker safely disposable.
              deleteInventoriedFile(root, lifecycle.entry);
            }
          }
          input.authority.assertRootIdentityCurrent();
        }
        for (const [digest, lifecycle] of pending) {
          if (committedDigests.has(digest)) continue;
          control.assertLive();
          const payload = entries.get(objectLeaf(lifecycle.receipt, 'bin')) ?? null;
          if (now >= lifecycle.receipt.retainedUntilUnixMs) {
            if (payload !== null) deleteInventoriedFile(root, payload);
            deleteInventoriedFile(root, lifecycle.entry);
            deletedObjects += 1;
          } else {
            retainedObjects += 1;
            incompleteObjects += 1;
          }
          input.authority.assertRootIdentityCurrent();
        }
        retainedObjects += unknownPayloads.length;
        const observedDigests = new Set<OperationDigest>([
          ...committedDigests,
          ...pendingDigests,
          ...payloadEntries.map(({ relativePath }) => (
            `sha256:${path.basename(relativePath, '.bin')}` as OperationDigest
          ))
        ]);
        const unsigned = Object.freeze({
          operationIdentityDigest: gcInput.operation.plan.identity.identityDigest,
          boundAttemptDigest: gcInput.operation.boundAttemptDigest,
          observedObjects: observedDigests.size,
          retainedObjects,
          deletedObjects,
          incompleteObjects,
          unknownObjects: unknownPayloads.length,
          readBytes
        });
        return Object.freeze({
          ...unsigned,
          receiptDigest: sha256(unsigned) as OperationDigest
        });
      });
    }
  });
}
