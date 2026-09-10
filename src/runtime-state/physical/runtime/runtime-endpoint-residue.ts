import { lstatSync } from 'node:fs';
import path from 'node:path';

import {
  PhysicalNoFollowError,
  inspectNoFollowDirectoryChain,
  observeNoFollowEntryAccessFailure,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryIdentity,
  type PhysicalNativeFailure,
  type PhysicalNoFollowEntryAccessFailureObservation
} from './physical-no-follow.ts';
import {
  settlePhysicalResources,
  type PhysicalResourceSettlementFailure
} from './resource-settlement.ts';
import {
  assertRetainedRuntimeStateDirectory,
  openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot,
  type RetainedRuntimeStateDirectory
} from './retained-runtime-state-directory.ts';

export const RUNTIME_ENDPOINT_RESIDUE_SCHEMA =
  'sec-runtime-endpoint-residue-observation-v1' as const;
export const RUNTIME_GENERATION_CENSUS_SCHEMA =
  'sec-runtime-generation-census-v1' as const;

export type RuntimeGenerationCensusState =
  | 'present'
  | 'absent'
  | 'access-unavailable'
  | 'unknown';

export interface RuntimeGenerationCensusEntry {
  readonly id: string;
  readonly path: string;
  readonly state: RuntimeGenerationCensusState;
  readonly ownerRoot: PhysicalDirectoryIdentity;
  readonly generationRoot: PhysicalDirectoryIdentity | null;
  readonly entryCount: number;
}

export interface RuntimeGenerationCensusReceipt {
  readonly schema: typeof RUNTIME_GENERATION_CENSUS_SCHEMA;
  readonly providerIdentityDigest: `sha256:${string}`;
  readonly entries: readonly RuntimeGenerationCensusEntry[];
}

export interface RetainedRuntimeGenerationCensus {
  readonly receipt: RuntimeGenerationCensusReceipt;
  readonly generations: readonly RetainedRuntimeStateDirectory[];
  close(): void;
}

const ISSUED_RUNTIME_GENERATION_CENSUS_RECEIPTS = new WeakSet<object>();

export function assertRuntimeGenerationCensusReceipt(
  value: unknown
): asserts value is RuntimeGenerationCensusReceipt {
  if (value === null || typeof value !== 'object'
      || !ISSUED_RUNTIME_GENERATION_CENSUS_RECEIPTS.has(value)) {
    throw new Error('Runtime generation census receipt was not issued by the physical owner.');
  }
}

export interface RuntimeEndpointResidueReceipt {
  readonly schema: typeof RUNTIME_ENDPOINT_RESIDUE_SCHEMA;
  readonly state: 'native-access-unavailable';
  readonly providerIdentityDigest: `sha256:${string}`;
  readonly root: PhysicalDirectoryIdentity;
  readonly generationRoot: PhysicalDirectoryIdentity;
  readonly parent: PhysicalDirectoryIdentity;
  readonly entry: Readonly<{
    path: string;
    kind: PhysicalNoFollowEntryAccessFailureObservation['kind'];
    device: string;
    inode: string;
    objectId: string;
  }>;
  readonly nativeFailure: PhysicalNativeFailure & Readonly<{
    namespace: 'win32';
    failureClass: 'access-unavailable';
  }>;
}

const ISSUED_RUNTIME_ENDPOINT_RESIDUE_RECEIPTS = new WeakSet<object>();

export function assertRuntimeEndpointResidueReceipt(
  value: unknown
): asserts value is RuntimeEndpointResidueReceipt {
  if (value === null || typeof value !== 'object'
      || !ISSUED_RUNTIME_ENDPOINT_RESIDUE_RECEIPTS.has(value)) {
    throw new Error('Runtime endpoint residue receipt was not issued by the physical owner.');
  }
}

function sameIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return left.path === right.path && left.finalPath === right.finalPath
    && left.device === right.device && left.inode === right.inode
    && left.objectId === right.objectId;
}

function physicalFailure(error: unknown): PhysicalNoFollowError | null {
  let current: unknown = error;
  const visited = new Set<object>();
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (current instanceof PhysicalNoFollowError) return current;
    current = current.cause;
  }
  return null;
}

function censusStateFromFailure(error: unknown): RuntimeGenerationCensusState {
  const failure = physicalFailure(error);
  if (failure?.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return 'absent';
  if (failure?.nativeFailure?.namespace === 'win32'
      && failure.nativeFailure.failureClass === 'access-unavailable') {
    return 'access-unavailable';
  }
  return 'unknown';
}

export function censusRetainedRuntimeGenerations(input: Readonly<{
  providerIdentityDigest: `sha256:${string}`;
  maximumDurationMs: number;
  maximumBytesPerRoot: number;
  maximumEntriesPerRoot: number;
  profiles: readonly Readonly<{
    id: string;
    owner: RetainedRuntimeStateDirectory;
    segments: readonly string[];
    childDescriptor: number;
  }>[];
}>): RetainedRuntimeGenerationCensus {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.providerIdentityDigest)
      || !Number.isSafeInteger(input.maximumDurationMs) || input.maximumDurationMs < 1
      || !Number.isSafeInteger(input.maximumBytesPerRoot) || input.maximumBytesPerRoot < 0
      || !Number.isSafeInteger(input.maximumEntriesPerRoot)
      || input.maximumEntriesPerRoot < 1 || input.profiles.length < 1
      || input.profiles.length > 16) {
    throw new Error('Runtime generation census input is invalid.');
  }
  const retained: RetainedRuntimeStateDirectory[] = [];
  const entries: RuntimeGenerationCensusEntry[] = [];
  const deadlineAtMs = performance.now() + input.maximumDurationMs;
  let closed = false;
  let terminalCloseFailure: unknown;
  const close = (): void => {
    if (closed) {
      if (terminalCloseFailure !== undefined) throw terminalCloseFailure;
      return;
    }
    try {
      settlePhysicalResources({
        cleanup: [...retained].reverse().map((generation, index) => ({
          label: `runtime-generation-${index}-close`,
          settle: () => { generation.close(); }
        }))
      });
    } catch (error) {
      terminalCloseFailure = error;
      throw error;
    } finally {
      closed = true;
    }
  };
  try {
    const ids = new Set<string>();
    for (const profile of input.profiles) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(profile.id) || ids.has(profile.id)) {
        throw new Error('Runtime generation census profile identity is invalid.');
      }
      ids.add(profile.id);
      assertRetainedRuntimeStateDirectory(profile.owner);
      profile.owner.assertCurrent();
      let generation: RetainedRuntimeStateDirectory | null = null;
      try {
        generation = openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
          childDescriptor: profile.childDescriptor,
          mode: 'open-existing',
          root: inspectNoFollowDirectoryChain(
            profile.owner.root.path,
            'Runtime generation census owner root'
          ),
          owner: profile.owner,
          segments: profile.segments
        });
        retained.push(generation);
        const inventory = scanNoFollowDirectoryTreeMetadata(generation.directory, {
          deadlineAtMs,
          maximumEntries: input.maximumEntriesPerRoot,
          maximumBytes: input.maximumBytesPerRoot
        });
        generation.assertCurrent();
        profile.owner.assertCurrent();
        entries.push(Object.freeze({
          id: profile.id,
          path: generation.path,
          // Inventory is a bounded physical fact. Link presence does not
          // establish whether the provider generation is active or stale;
          // only the provider lifecycle can make that decision.
          state: 'present' as const,
          ownerRoot: profile.owner.root,
          generationRoot: generation.directory,
          entryCount: inventory.length
        }));
      } catch (error) {
        const state = censusStateFromFailure(error);
        entries.push(Object.freeze({
          id: profile.id,
          path: path.join(profile.owner.root.path, ...profile.segments),
          state,
          ownerRoot: profile.owner.root,
          generationRoot: generation?.directory ?? null,
          entryCount: 0
        }));
      }
    }
    const receipt: RuntimeGenerationCensusReceipt = Object.freeze({
      schema: RUNTIME_GENERATION_CENSUS_SCHEMA,
      providerIdentityDigest: input.providerIdentityDigest,
      entries: Object.freeze(entries)
    });
    ISSUED_RUNTIME_GENERATION_CENSUS_RECEIPTS.add(receipt);
    return Object.freeze({ receipt, generations: Object.freeze(retained), close });
  } catch (error) {
    settleRuntimeGenerationCensusAdmission(
      Object.freeze({ label: 'runtime-generation-census-admission', error }),
      close
    );
  }
}

function settleRuntimeGenerationCensusAdmission(
  primary: PhysicalResourceSettlementFailure,
  close: () => void
): never {
  settlePhysicalResources({
    primary,
    cleanup: [{ label: 'runtime-generation-census-close', settle: close }]
  });
  throw primary.error;
}

export function settleRuntimeGenerationCensusAdmissionForTests(input: Readonly<{
  primary: unknown;
  close(): void;
}>): never {
  return settleRuntimeGenerationCensusAdmission(
    Object.freeze({ label: 'runtime-generation-census-admission', error: input.primary }),
    input.close
  );
}

export function issueRuntimeGenerationCensusReceiptForTests(input: Readonly<{
  providerIdentityDigest: `sha256:${string}`;
  states: readonly RuntimeGenerationCensusState[];
}>): RuntimeGenerationCensusReceipt {
  const identity = (index: number): PhysicalDirectoryIdentity => Object.freeze({
    path: path.resolve(`runtime-generation-test-${index}`),
    finalPath: path.resolve(`runtime-generation-test-${index}`),
    device: `test-device-${index}`,
    inode: `test-inode-${index}`,
    objectId: `test-object-${index}`
  });
  const receipt: RuntimeGenerationCensusReceipt = Object.freeze({
    schema: RUNTIME_GENERATION_CENSUS_SCHEMA,
    providerIdentityDigest: input.providerIdentityDigest,
    entries: Object.freeze(input.states.map((state, index) => Object.freeze({
      id: `test-generation-${index}`,
      path: identity(index).path,
      state,
      ownerRoot: identity(index),
      generationRoot: state === 'absent' ? null : identity(index),
      entryCount: state === 'present' ? 0 : 1
    })))
  });
  ISSUED_RUNTIME_GENERATION_CENSUS_RECEIPTS.add(receipt);
  return receipt;
}

function evidenceCandidates(
  roots: readonly RetainedRuntimeStateDirectory[],
  providerEvidence: string
): readonly Readonly<{ root: RetainedRuntimeStateDirectory; path: string }>[] {
  const candidates: Array<{ root: RetainedRuntimeStateDirectory; path: string }> = [];
  const seen = new Set<string>();
  for (const root of [...roots].sort((left, right) => right.path.length - left.path.length)) {
    const windowsPath = path.win32.isAbsolute(root.path);
    const pathOwner = windowsPath ? path.win32 : path;
    const evidence = windowsPath
      ? providerEvidence.slice(-8_192).replaceAll('/', '\\')
      : providerEvidence.slice(-8_192);
    const folded = evidence.toLowerCase();
    const rootText = windowsPath ? root.path.replaceAll('/', '\\') : root.path;
    const rootFolded = rootText.toLowerCase();
    let offset = 0;
    while (offset < folded.length) {
      const start = folded.indexOf(rootFolded, offset);
      if (start < 0) break;
      let end = start + rootText.length;
      const maximumEnd = Math.min(evidence.length, start + 1_024);
      while (end < maximumEnd) {
        const character = evidence[end]!;
        if (character === '\r' || character === '\n' || character === '"'
            || character === "'" || character === '<' || character === '>'
            || character === '|' || character === ';'
            || (character === ':' && /\s/u.test(evidence[end + 1] ?? ''))) break;
        end += 1;
      }
      const candidate = pathOwner.resolve(evidence.slice(start, end).trimEnd());
      const relative = pathOwner.relative(root.path, candidate);
      const key = `${root.root.objectId}\0${candidate.toLowerCase()}`;
      if (relative.length > 0 && !pathOwner.isAbsolute(relative)
          && !relative.split(pathOwner.sep).some((segment) => segment === '..')
          && !seen.has(key)) {
        seen.add(key);
        candidates.push(Object.freeze({ root, path: candidate }));
      }
      offset = Math.max(end, start + rootText.length);
    }
  }
  return Object.freeze(candidates);
}

export type RuntimeEndpointResidueProbe = (input: Readonly<{
  candidatePath: string;
  parent: PhysicalDirectoryIdentity;
  leafName: string;
}>) => PhysicalNoFollowEntryAccessFailureObservation | null;

function physicalProbe(input: Parameters<RuntimeEndpointResidueProbe>[0]):
ReturnType<RuntimeEndpointResidueProbe> {
  return observeNoFollowEntryAccessFailure(input.parent, input.leafName);
}

function observeWithProbe(input: Readonly<{
  admittedGenerationRoots: readonly PhysicalDirectoryIdentity[];
  providerIdentityDigest: `sha256:${string}`;
  providerEvidence: string;
  roots: readonly RetainedRuntimeStateDirectory[];
  probe: RuntimeEndpointResidueProbe;
}>): RuntimeEndpointResidueReceipt | null {
  if (typeof input.providerEvidence !== 'string') return null;
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.providerIdentityDigest)) return null;
  if (input.admittedGenerationRoots.length < 1) return null;
  for (const root of input.roots) assertRetainedRuntimeStateDirectory(root);
  for (const candidate of evidenceCandidates(input.roots, input.providerEvidence)) {
    candidate.root.assertCurrent();
    const pathOwner = path.win32.isAbsolute(candidate.root.path) ? path.win32 : path;
    const relative = pathOwner.relative(candidate.root.path, candidate.path);
    const segments = relative.split(pathOwner.sep);
    if (segments.length < 1) continue;
    const leafName = segments.pop()!;
    const parentPath = pathOwner.join(candidate.root.path, ...segments);
    let parent: PhysicalDirectoryIdentity;
    try {
      const chain = inspectNoFollowDirectoryChain(
        parentPath,
        'Runtime endpoint residue parent'
      );
      const retainedRoot = chain.ancestors.find((identity) => (
        pathOwner.normalize(identity.path).toLowerCase()
          === pathOwner.normalize(candidate.root.root.path).toLowerCase()
      )) ?? (pathOwner.normalize(chain.target.path).toLowerCase()
        === pathOwner.normalize(candidate.root.root.path).toLowerCase()
        ? chain.target
        : null);
      if (retainedRoot === null || !sameIdentity(retainedRoot, candidate.root.root)) continue;
      parent = chain.target;
      const generationRoot = input.admittedGenerationRoots.find((admitted) => (
        [...chain.ancestors, chain.target].some((identity) => sameIdentity(identity, admitted))
      )) ?? null;
      if (generationRoot === null) continue;
      const observed = input.probe({
        candidatePath: candidate.path,
        parent,
        leafName
      });
      candidate.root.assertCurrent();
      if (observed === null
          || pathOwner.normalize(observed.path).toLowerCase()
            !== pathOwner.normalize(candidate.path).toLowerCase()
          || observed.nativeFailure.namespace !== 'win32'
          || observed.nativeFailure.failureClass !== 'access-unavailable') continue;
      const receipt: RuntimeEndpointResidueReceipt = Object.freeze({
        schema: RUNTIME_ENDPOINT_RESIDUE_SCHEMA,
        state: 'native-access-unavailable' as const,
        providerIdentityDigest: input.providerIdentityDigest,
        root: candidate.root.root,
        generationRoot,
        parent,
        entry: Object.freeze({
          path: observed.path,
          kind: observed.kind,
          device: observed.device,
          inode: observed.inode,
          objectId: observed.objectId
        }),
        nativeFailure: Object.freeze({
          namespace: 'win32' as const,
          code: observed.nativeFailure.code,
          failureClass: 'access-unavailable' as const
        })
      });
      ISSUED_RUNTIME_ENDPOINT_RESIDUE_RECEIPTS.add(receipt);
      return receipt;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Converts provider text only into bounded candidate paths. A terminal receipt
 * exists only after the retained physical owner re-observes the exact root,
 * parent, entry preimage, and native Win32 failure.
 */
export function observeRetainedRuntimeEndpointResidue(input: Readonly<{
  admittedGenerationRoots: readonly PhysicalDirectoryIdentity[];
  providerIdentityDigest: `sha256:${string}`;
  providerEvidence: string;
  roots: readonly RetainedRuntimeStateDirectory[];
}>): RuntimeEndpointResidueReceipt | null {
  return observeWithProbe({ ...input, probe: physicalProbe });
}

/** Test seam for the platform probe only; root and receipt issuance stay real. */
export function observeRuntimeEndpointResidueCandidatesForTests(input: Readonly<{
  admittedGenerationRoots: readonly PhysicalDirectoryIdentity[];
  providerIdentityDigest: `sha256:${string}`;
  providerEvidence: string;
  roots: readonly RetainedRuntimeStateDirectory[];
  probe: RuntimeEndpointResidueProbe;
}>): RuntimeEndpointResidueReceipt | null {
  return observeWithProbe(input);
}

/** Builds a test probe observation from an exact on-disk entry preimage. */
export function runtimeEndpointAccessFailureObservationForTests(input: Readonly<{
  candidatePath: string;
  nativeCode?: number;
}>): PhysicalNoFollowEntryAccessFailureObservation {
  const stats = lstatSync(input.candidatePath, { bigint: true });
  return Object.freeze({
    path: input.candidatePath,
    kind: stats.isDirectory() ? 'directory'
      : stats.isFile() ? 'file'
        : stats.isSymbolicLink() ? 'link' : 'other',
    device: String(stats.dev),
    inode: String(stats.ino),
    objectId: `lstat:${stats.dev}:${stats.ino}`,
    nativeFailure: Object.freeze({
      namespace: 'win32' as const,
      code: input.nativeCode ?? 1_920,
      failureClass: 'access-unavailable' as const
    })
  });
}
