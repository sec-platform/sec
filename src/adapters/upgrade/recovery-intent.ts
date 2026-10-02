import path from 'node:path';
import { CompilerError } from '../../compiler/errors.ts';
import { sha256 } from '../../contracts/canonical.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  publishExclusiveDurableCanonicalFile,
  scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowFileObservation
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { readOptionalRetainedOrdinaryLeaf } from '../runtime-state/physical/runtime/retained-file-read.ts';

export type UpgradeRecoveryProjectionEntry = Readonly<{
  relativePath: string;
  kind: 'directory' | 'file';
  size: number;
  contentDigest: `sha256:${string}` | null;
  permissionMode: number | null;
  identity?: Readonly<{ device: string; inode: string }>;
}>;
export interface UpgradeRecoveryBinding {
  readonly operationIdentityDigest: string;
  readonly attemptRevision: string;
}
const intentBrand: unique symbol = Symbol('upgrade-recovery-intent');
export interface UpgradeRecoveryIntent {
  readonly [intentBrand]: true;
}
export interface UpgradeFileMutation {
  readonly sequence: number;
}
/** Restore consumes B from its sealed snapshot. A needs exact comparison
 * facts, not a second payload copy or an unimplemented forward-replay store. */
interface Change {
  readonly relativePath: string;
  readonly before: UpgradeRecoveryProjectionEntry | null;
  readonly after: Readonly<{
    size: number;
    contentDigest: `sha256:${string}`;
    permissionMode: number | null | 'unresolved-creation';
  }> | null;
}
interface Prepared {
  readonly token: UpgradeFileMutation;
  readonly changes: readonly Change[];
  acknowledged: boolean;
}
export interface UpgradeRecoveryLimits {
  readonly maximumRecords: number;
  readonly maximumRecordBytes: number;
  readonly maximumTotalBytes: number;
}
interface State {
  readonly workspace: PhysicalDirectoryIdentity;
  readonly backup: PhysicalDirectoryIdentity;
  readonly expected: Map<string, UpgradeRecoveryProjectionEntry>;
  readonly original: Map<string, UpgradeRecoveryProjectionEntry>;
  readonly changed: Set<string>;
  readonly records: Array<{ name: string; bytes: Buffer }>;
  readonly prepared: Prepared[];
  sequence: number;
  unknown: boolean;
  direction: 'forward' | 'rollback';
  readonly limits: UpgradeRecoveryLimits;
  recordBytes: number;
}
const states = new WeakMap<UpgradeRecoveryIntent, State>();
function failure(message: string): never {
  throw new CompilerError('UPGRADE-BLOCKED-005', `Upgrade recovery required: ${message}`);
}
function digest(bytes: Uint8Array): `sha256:${string}` {
  return sha256({ bytes: Buffer.from(bytes).toString('hex') }) as `sha256:${string}`;
}
function same(
  left: UpgradeRecoveryProjectionEntry | null | undefined,
  right: UpgradeRecoveryProjectionEntry | null | undefined
): boolean {
  if (left == null || right == null) return left == null && right == null;
  return (
    left.kind === right.kind &&
    left.permissionMode === right.permissionMode &&
    (left.identity === undefined ||
      (left.identity.device === right.identity?.device && left.identity.inode === right.identity?.inode)) &&
    (left.kind === 'directory' || (left.size === right.size && left.contentDigest === right.contentDigest))
  );
}
function owned(intent: UpgradeRecoveryIntent): State {
  const state = states.get(intent);
  if (!state) failure('missing or legacy constituent intent is not automatic restore authority');
  assertSameNoFollowDirectoryIdentity(state.workspace, 'Upgrade recovery workspace');
  assertSameNoFollowDirectoryIdentity(state.backup, 'Upgrade recovery backup');
  return state;
}
function encodedRecord(kind: string, body: unknown): Buffer {
  return Buffer.from(formatJsonFile({ schema: 'sec-upgrade-recovery-record-v1', kind, body }));
}
function admitFileRecordBudget(state: State, sequence: number, changes: readonly Change[]): void {
  // Reserve acknowledgment and reverse progress before the live effect. This
  // is a cost upper bound for Physical's u64/u128 identity facts, not an identity
  // decoder or authority claim. Ordinary data/mode/path bytes remain exact.
  const identity = { device: '0'.repeat(128), inode: '0'.repeat(128) };
  const after = changes.map((change) =>
    change.after === null
      ? null
      : {
          relativePath: change.relativePath,
          kind: 'file',
          size: change.after.size,
          contentDigest: `sha256:${'0'.repeat(64)}`,
          permissionMode: 0o7777,
          identity
        }
  );
  const paths = new Set([...state.changed, ...changes.map((change) => change.relativePath)]);
  const future = [
    encodedRecord('prepared-file-mutation', { sequence, changes }),
    encodedRecord('acknowledged-file-mutation', { sequence, after }),
    encodedRecord('rollback-direction', {}),
    ...[...paths].map((relativePath) => {
      const before = state.original.get(relativePath);
      return encodedRecord('restored-file', {
        relativePath,
        value: before === undefined ? null : { ...before, identity, permissionMode: 0o7777 }
      });
    })
  ];
  if (
    future.some((bytes) => bytes.byteLength > state.limits.maximumRecordBytes) ||
    state.records.length + future.length > state.limits.maximumRecords ||
    future.reduce((sum, bytes) => sum + bytes.byteLength, state.recordBytes) > state.limits.maximumTotalBytes
  ) {
    failure('constituent budget cannot preserve acknowledgment and reverse progress');
  }
}

function append(state: State, kind: string, body: unknown): void {
  if (state.records.length >= state.limits.maximumRecords) failure('constituent record budget exhausted');
  const bytes = encodedRecord(kind, body);
  if (
    bytes.byteLength > state.limits.maximumRecordBytes ||
    bytes.byteLength > state.limits.maximumTotalBytes - state.recordBytes
  ) {
    failure('constituent aggregate record byte budget exhausted');
  }
  const name = `recovery-${String(state.records.length).padStart(8, '0')}.json`;
  publishExclusiveDurableCanonicalFile({
    parent: state.backup,
    name,
    bytes,
    validate: (actual) => {
      if (!Buffer.from(actual).equals(bytes)) failure('record readback differs');
    }
  });
  state.records.push({ name, bytes });
  state.recordBytes += bytes.byteLength;
}
export function assertUpgradeRecoveryIntent(intent: UpgradeRecoveryIntent): void {
  const state = owned(intent);
  const names = new Set(['preimage', ...state.records.map((record) => record.name)]);
  const direct = scanNoFollowDirectoryDirectMetadata(state.backup, {
    deadlineAtMs: performance.now() + 30_000,
    maximumEntries: state.limits.maximumRecords + 1,
    maximumBytes: state.limits.maximumTotalBytes,
    includePermissionMode: true
  });
  if (direct.length !== names.size || direct.some((entry) => !names.has(entry.relativePath))) {
    failure('backup envelope has unowned or missing members');
  }
  for (const record of state.records) {
    const current = readOptionalRetainedOrdinaryLeaf(state.backup, record.name, {
      maximumBytes: state.limits.maximumRecordBytes
    });
    if (current === null || !Buffer.from(current).equals(record.bytes))
      failure('durable constituent record changed or is missing');
  }
}
export function createUpgradeRecoveryIntent(
  input: Readonly<{
    workspace: PhysicalDirectoryIdentity;
    backup: PhysicalDirectoryIdentity;
    binding: UpgradeRecoveryBinding;
    projection: readonly UpgradeRecoveryProjectionEntry[];
    limits: UpgradeRecoveryLimits;
  }>
): UpgradeRecoveryIntent {
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(input.binding.operationIdentityDigest) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.binding.attemptRevision)
  )
    failure('invalid original operation binding');
  const limits = Object.freeze({ ...input.limits });
  if (
    [limits.maximumRecords, limits.maximumRecordBytes, limits.maximumTotalBytes].some(
      (value) => !Number.isSafeInteger(value) || value <= 0
    )
  )
    failure('invalid original backup recovery budget');
  const state: State = {
    workspace: input.workspace,
    backup: input.backup,
    expected: new Map(input.projection.map((entry) => [entry.relativePath, entry])),
    original: new Map(input.projection.map((entry) => [entry.relativePath, entry])),
    changed: new Set(),
    records: [],
    prepared: [],
    sequence: 0,
    unknown: false,
    direction: 'forward',
    limits,
    recordBytes: 0
  };
  append(state, 'prepared-intent', {
    binding: input.binding,
    workspace: input.workspace,
    backup: input.backup,
    projection: input.projection
  });
  const intent = Object.freeze({ [intentBrand]: true as const });
  states.set(intent, state);
  return intent;
}
export function markUpgradeRecoveryUnknown(intent: UpgradeRecoveryIntent | undefined, reason: string): void {
  if (intent === undefined) return;
  const state = owned(intent);
  // Set before durable publication: a failed record must not reopen restore.
  state.unknown = true;
  append(state, 'untracked-effect', { reason });
}
function relative(state: State, absolutePath: string): string {
  const value = path.relative(state.workspace.path, path.resolve(absolutePath)).split(path.sep).join('/');
  if (value === '' || value === '..' || value.startsWith('../') || path.posix.isAbsolute(value))
    failure('constituent escapes original workspace');
  return value;
}
function projected(
  relativePath: string,
  observation: RetainedNoFollowFileObservation | null
): UpgradeRecoveryProjectionEntry | null {
  return observation === null
    ? null
    : Object.freeze({
        relativePath,
        kind: 'file' as const,
        size: observation.bytes.byteLength,
        contentDigest: digest(observation.bytes),
        permissionMode: observation.permissionMode,
        identity: observation.identity
      });
}
export function prepareUpgradeFileMutation(
  intent: UpgradeRecoveryIntent | undefined,
  updates: readonly Readonly<{
    path: string;
    before: RetainedNoFollowFileObservation | null;
    after: Uint8Array | null;
    afterPermissionMode?: number | null;
  }>[]
): UpgradeFileMutation | undefined {
  if (intent === undefined) return undefined;
  const state = owned(intent);
  assertUpgradeRecoveryIntent(intent);
  if (state.direction !== 'forward' || state.prepared.some((step) => !step.acknowledged))
    failure('earlier constituent is unresolved');
  const changes = updates.map((update) => {
    const relativePath = relative(state, update.path);
    const before = projected(relativePath, update.before);
    if (!same(state.expected.get(relativePath), before)) failure(`constituent preimage drifted: ${relativePath}`);
    return Object.freeze({
      relativePath,
      before,
      after:
        update.after === null
          ? null
          : Object.freeze({
              size: update.after.byteLength,
              contentDigest: digest(update.after),
              permissionMode:
                update.afterPermissionMode === undefined
                  ? update.before === null
                    ? ('unresolved-creation' as const)
                    : update.before.permissionMode
                  : update.afterPermissionMode
            })
    });
  });
  admitFileRecordBudget(state, state.sequence + 1, changes);
  const token = Object.freeze({ sequence: ++state.sequence });
  append(state, 'prepared-file-mutation', { sequence: token.sequence, changes });
  state.prepared.push({ token, changes, acknowledged: false });
  return token;
}
export function acknowledgeUpgradeFileMutation(
  intent: UpgradeRecoveryIntent | undefined,
  token: UpgradeFileMutation | undefined,
  observations: readonly (RetainedNoFollowFileObservation | null)[]
): void {
  if (intent === undefined) return;
  const state = owned(intent);
  const prepared = state.prepared.find((step) => step.token === token);
  if (!prepared || prepared.acknowledged || observations.length !== prepared.changes.length)
    failure('invalid constituent acknowledgment');
  const after = prepared.changes.map((change, index) => {
    const observation = observations[index]!;
    if (
      (change.after === null) !== (observation === null) ||
      (observation !== null &&
        (observation.bytes.byteLength !== change.after!.size ||
          digest(observation.bytes) !== change.after!.contentDigest ||
          (change.after!.permissionMode !== 'unresolved-creation' &&
            observation.permissionMode !== change.after!.permissionMode) ||
          relative(state, observation.path) !== change.relativePath))
    )
      failure('physical constituent readback differs from intended A');
    return projected(change.relativePath, observation);
  });
  append(state, 'acknowledged-file-mutation', { sequence: prepared.token.sequence, after });
  prepared.changes.forEach((change, index) => {
    state.changed.add(change.relativePath);
    const value = after[index];
    if (value == null) state.expected.delete(change.relativePath);
    else state.expected.set(change.relativePath, value);
  });
  prepared.acknowledged = true;
}
/** Validate the complete live projection before selecting any reverse effect.
 * Unacknowledged effects are safe only when they left the exact admitted B. */
export function admitUpgradeRecovery(
  intent: UpgradeRecoveryIntent,
  current: readonly UpgradeRecoveryProjectionEntry[]
): readonly string[] {
  const state = owned(intent);
  assertUpgradeRecoveryIntent(intent);
  if (state.unknown) failure('an untracked or incomplete effect has no admitted postimage');
  const observed = new Map(current.map((entry) => [entry.relativePath, entry]));
  if (
    observed.size !== state.expected.size ||
    [...state.expected].some(([name, entry]) => !same(entry, observed.get(name)))
  ) {
    failure('live content, mode or membership differs from admitted postimage; foreign changes are preserved');
  }
  if (state.direction !== 'rollback') {
    append(state, 'rollback-direction', {});
    state.direction = 'rollback';
  }
  return Object.freeze([...state.changed].sort());
}
/** Bind a freshly acquired Physical observation to the admitted constituent A.
 * Global inventory is not authority for a later arbitrary current observation. */
export function assertUpgradeRecoveryFileCurrent(
  intent: UpgradeRecoveryIntent,
  relativePath: string,
  observation: RetainedNoFollowFileObservation | null
): void {
  const state = owned(intent);
  if (!same(state.expected.get(relativePath), projected(relativePath, observation))) {
    failure(`constituent changed after recovery admission: ${relativePath}`);
  }
}

export function acknowledgeUpgradeRestoredFile(
  intent: UpgradeRecoveryIntent,
  relativePath: string,
  observation: RetainedNoFollowFileObservation | null
): void {
  const state = owned(intent);
  const value = projected(relativePath, observation);
  append(state, 'restored-file', { relativePath, value });
  if (value === null) state.expected.delete(relativePath);
  else state.expected.set(relativePath, value);
}
