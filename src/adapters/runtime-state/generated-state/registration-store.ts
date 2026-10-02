import { readdirSync } from 'node:fs';
import path from 'node:path';

import { acquirePhysicalMutationLease, observePhysicalJournalMutationEntry } from '../physical/runtime/mutation-lease.ts';
import {
  assertPhysicallyDisjointDirectoryChains,
  createExclusiveNoFollowDirectory,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  physicallyContainsDirectoryChain,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from '../physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem, runtimeStateJournalMutationLeaseName, withRuntimeStateJournalMutation } from '../workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority } from '../workspace-state/physical-authority.ts';
import {
  generatedStateDigest,
  normalizeGeneratedStateRelativePath,
  parseGeneratedStateRegistration,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateRegistration
} from './contract.ts';

/**
 * Registration storage owns immutable generations, ledger/pointer CAS and
 * schema migration under one physical mutation lease. Keep the migration
 * admission issuer and consumer private here: splitting them into a generic
 * migration service would expose authority or require a callback cycle.
 * Lifecycle keeps producer binding, cleanup and worktree Effect settlement;
 * these persistence primitives neither issue those capabilities nor adopt
 * caller-provided registration bytes as provenance.
 */
interface GeneratedStateRegistrationStoreOptions {
  readonly environment?: NodeJS.ProcessEnv;
}

const GENERATED_STATE_RUNTIME_VERSION = 'v1' as const;
export interface GeneratedStateRuntimeStore {
  readonly legacyRegistrationsRoot: string;
  readonly registrationsRoot: string;
  readonly settlementsRoot: string;
  readonly transactionsRoot: string;
  readonly fs: ReturnType<typeof createRuntimeStateJournalFileSystem>;
  readonly assertCurrent: () => Promise<void>;
}

interface GeneratedStateRuntimePaths {
  readonly workspaceStateRoot: string;
  readonly legacyRegistrationsRoot: string;
  readonly registrationsRoot: string;
  readonly settlementsRoot: string;
  readonly transactionsRoot: string;
}

interface GeneratedStateRuntimeDirectoryPlan {
  readonly ancestor: PhysicalDirectoryIdentity;
  readonly missingSegments: readonly string[];
  readonly targetPath: string;
}

function generatedStatePathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function planGeneratedStateRuntimeDirectory(
  directoryPath: string,
  repository: PhysicalDirectoryChain
): GeneratedStateRuntimeDirectoryPlan {
  const missing: string[] = [];
  const targetPath = path.resolve(directoryPath);
  if (generatedStatePathInside(targetPath, repository.target.path)) {
    throw new Error('Generated-state Runtime State root must remain outside the repository worktree.');
  }
  let ancestorPath = targetPath;
  while (true) {
    const presence = inspectExactNoFollowDirectoryPresence(
      ancestorPath,
      'Generated-state Runtime State layout ancestor'
    );
    if (presence.state === 'present') {
      if (ancestorPath === targetPath) {
        assertPhysicallyDisjointDirectoryChains(
          repository,
          presence.directory,
          'Generated-state Runtime State root and repository'
        );
      } else if (physicallyContainsDirectoryChain(repository, presence.directory)) {
        throw new Error('Generated-state Runtime State root is physically inside the repository worktree.');
      }
      return Object.freeze({
        ancestor: presence.directory.target,
        missingSegments: Object.freeze(missing.reverse()),
        targetPath
      });
    }
    const parentPath = path.dirname(ancestorPath);
    if (parentPath === ancestorPath) {
      throw new Error('Generated-state Runtime State layout has no retained existing ancestor.');
    }
    missing.push(path.basename(ancestorPath));
    ancestorPath = parentPath;
  }
}

function materializeGeneratedStateRuntimeDirectory(
  plan: GeneratedStateRuntimeDirectoryPlan
): PhysicalDirectoryIdentity {
  return plan.missingSegments.length === 0
    ? plan.ancestor
    : createNoFollowOrdinaryDirectoryChain(plan.ancestor, plan.missingSegments);
}

export function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function identityOf(value: Pick<PhysicalDirectoryIdentity, 'device' | 'inode' | 'objectId'>): GeneratedStatePhysicalIdentity {
  return Object.freeze({ device: value.device, inode: value.inode, objectId: value.objectId });
}

export function samePhysicalIdentity(
  left: Pick<GeneratedStatePhysicalIdentity, 'device' | 'inode' | 'objectId'>,
  right: Pick<GeneratedStatePhysicalIdentity, 'device' | 'inode' | 'objectId'>
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

export function registrationKey(relativePath: string): string {
  return generatedStateDigest(Object.freeze({
    schema: 'sec-generated-state-registration-key-v1',
    relativePath: normalizeGeneratedStateRelativePath(relativePath)
  })).slice('sha256:'.length);
}

function runtimePaths(
  workspaceRoot: string,
  options: GeneratedStateRegistrationStoreOptions
): GeneratedStateRuntimePaths {
  const roots = resolveSecWorkspaceRuntimeRoots({
    repositoryRoot: workspaceRoot,
    environment: options.environment
  });
  const generatedRoot = path.join(roots.workspaceStateRoot, 'generated-state', GENERATED_STATE_RUNTIME_VERSION);
  return Object.freeze({
    workspaceStateRoot: roots.workspaceStateRoot,
    legacyRegistrationsRoot: path.join(generatedRoot, 'registrations'),
    registrationsRoot: path.join(generatedRoot, 'registrations-v2'),
    settlementsRoot: path.join(generatedRoot, 'settlements'),
    transactionsRoot: path.join(generatedRoot, 'transactions')
  });
}

export async function openRuntimeStore(
  workspaceRoot: string,
  options: GeneratedStateRegistrationStoreOptions
): Promise<GeneratedStateRuntimeStore> {
  const roots = resolveSecWorkspaceRuntimeRoots({
    repositoryRoot: workspaceRoot,
    environment: options.environment
  });
  const locations = runtimePaths(workspaceRoot, options);
  const requiredDirectories = [
    roots.stateRoot,
    roots.cacheRoot,
    roots.workspaceStateRoot,
    path.dirname(locations.registrationsRoot),
    locations.registrationsRoot,
    locations.settlementsRoot,
    locations.transactionsRoot
  ];
  const repository = inspectNoFollowDirectoryChain(
    workspaceRoot,
    'Generated-state Runtime State repository admission'
  );
  const statePlan = planGeneratedStateRuntimeDirectory(roots.stateRoot, repository);
  const cachePlan = planGeneratedStateRuntimeDirectory(roots.cacheRoot, repository);
  if (generatedStatePathInside(statePlan.targetPath, cachePlan.targetPath) ||
      generatedStatePathInside(cachePlan.targetPath, statePlan.targetPath)) {
    throw new Error('Generated-state Runtime State state/cache roots must remain disjoint.');
  }
  const stateRoot = materializeGeneratedStateRuntimeDirectory(statePlan);
  const cacheRoot = materializeGeneratedStateRuntimeDirectory(cachePlan);
  const stateChain = inspectNoFollowDirectoryChain(stateRoot.path, 'Generated-state Runtime State state root');
  const cacheChain = inspectNoFollowDirectoryChain(cacheRoot.path, 'Generated-state Runtime State cache root');
  assertPhysicallyDisjointDirectoryChains(repository, stateChain, 'Generated-state state root and repository');
  assertPhysicallyDisjointDirectoryChains(repository, cacheChain, 'Generated-state cache root and repository');
  assertPhysicallyDisjointDirectoryChains(stateChain, cacheChain, 'Generated-state state and cache roots');
  // Runtime State layout owns namespace materialization.  On Windows every
  // descendant must exist before the state-root ACL/physical generation is
  // retained; creating a child after issuance legitimately changes the root
  // directory ChangeTime and invalidates that generation.
  for (const directoryPath of [...new Set(requiredDirectories)]
    .sort((left, right) => left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right))) {
    const root = generatedStatePathInside(directoryPath, roots.stateRoot) ? stateRoot
      : generatedStatePathInside(directoryPath, roots.cacheRoot) ? cacheRoot
        : null;
    if (root === null) {
      throw new Error('Generated-state Runtime State required directory escapes state/cache authority.');
    }
    const relative = path.relative(root.path, path.resolve(directoryPath));
    if (relative !== '') {
      createNoFollowOrdinaryDirectoryChain(root, relative.split(path.sep));
    }
  }
  const authority = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot: workspaceRoot,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories
  });
  return Object.freeze({
    legacyRegistrationsRoot: locations.legacyRegistrationsRoot,
    registrationsRoot: locations.registrationsRoot,
    settlementsRoot: locations.settlementsRoot,
    transactionsRoot: locations.transactionsRoot,
    fs: createRuntimeStateJournalFileSystem(authority.directory(roots.workspaceStateRoot)),
    assertCurrent: authority.assertCurrent
  });
}

export function openRuntimeStoreReadOnly<Options extends GeneratedStateRegistrationStoreOptions>(
  workspaceRoot: string,
  options: Options
): GeneratedStateRuntimeStore | null {
  const locations = runtimePaths(workspaceRoot, options);
  const presence = inspectExactNoFollowDirectoryPresence(
    locations.workspaceStateRoot,
    'Generated-state read-only Runtime State root'
  );
  if (presence.state === 'absent') return null;
  return Object.freeze({
    legacyRegistrationsRoot: locations.legacyRegistrationsRoot,
    registrationsRoot: locations.registrationsRoot,
    settlementsRoot: locations.settlementsRoot,
    transactionsRoot: locations.transactionsRoot,
    fs: createRuntimeStateJournalFileSystem(presence.directory.target),
    assertCurrent: async () => {
      inspectNoFollowDirectoryChain(
        locations.workspaceStateRoot,
        'Generated-state read-only Runtime State readback'
      );
    }
  });
}

export function registrationPath(store: GeneratedStateRuntimeStore, relativePath: string): string {
  return path.join(store.registrationsRoot, `${registrationKey(relativePath)}.json`);
}

const GENERATED_STATE_REGISTRATION_POINTER_SCHEMA = 'sec-generated-state-registration-pointer-v2' as const;
const GENERATED_STATE_REGISTRATION_LEDGER_SCHEMA = 'sec-generated-state-registration-ledger-v2' as const;
const GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA = 'sec-generated-state-registration-migration-v1' as const;
const GENERATED_STATE_REGISTRATION_LEDGER_CAPACITY = 10_000;
const GENERATED_STATE_REGISTRATION_ROOT_ENTRY_CAPACITY = 30_000;

type GeneratedStateRegistrationPointer = Readonly<{
  readonly schema: typeof GENERATED_STATE_REGISTRATION_POINTER_SCHEMA;
  readonly registrationDigest: `sha256:${string}`;
  readonly ledgerRecordDigest: `sha256:${string}`;
}>;

type GeneratedStateRegistrationLedgerRecord = Readonly<{
  readonly schema: typeof GENERATED_STATE_REGISTRATION_LEDGER_SCHEMA;
  readonly recordDigest: `sha256:${string}`;
  readonly previousRecordDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}`;
  /** Base64 of the exact canonical immutable generation bytes. */
  readonly registrationBytes: string;
}>;

export type GeneratedStateRegistrationLedgerObservation = Readonly<{
  readonly tip: GeneratedStateRegistrationLedgerRecord | null;
  readonly registration: GeneratedStateRegistration | null;
  readonly retiredPredecessor: GeneratedStateRegistration | null;
  readonly previousRegistration: GeneratedStateRegistration | null;
}>;

type GeneratedStateRegistrationMigrationTarget = Readonly<{
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}`;
}>;

type GeneratedStateRegistrationMigrationIntent = Readonly<{
  readonly schema: typeof GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA;
  readonly phase: 'prepared' | 'complete';
  readonly migrationDigest: `sha256:${string}`;
  readonly sourceRoot: GeneratedStatePhysicalIdentity;
  readonly sourceInventoryDigest: `sha256:${string}`;
  readonly sourceGenerationCount: number;
  readonly sourcePointerCount: number;
  readonly targets: readonly GeneratedStateRegistrationMigrationTarget[];
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly intentDigest: `sha256:${string}`;
}>;

type LegacyGeneratedStateRegistrationCensus = Readonly<{
  readonly sourceRoot: PhysicalDirectoryIdentity;
  readonly sourceInventoryDigest: `sha256:${string}`;
  readonly sourceEntryIdentityDigest: `sha256:${string}`;
  readonly sourceGenerationCount: number;
  readonly sourcePointerCount: number;
  readonly generations: ReadonlyMap<`sha256:${string}`, Readonly<{
    readonly registration: GeneratedStateRegistration;
    readonly bytes: Buffer;
  }>>;
  readonly pointers: ReadonlyMap<string, Readonly<{
    readonly registration: GeneratedStateRegistration;
    readonly bytes: Buffer;
  }>>;
}>;

/**
 * A migration admission is intentionally an in-process capability.  The
 * durable intent below proves the bytes and physical roots involved, but a
 * digest is not an issuer credential.  Only the owner lease creates this
 * object, and the migration routine never accepts caller-shaped JSON as
 * authority.
 */
interface GeneratedStateRegistrationMigrationAdmission {
  readonly kind: 'generated-state-registration-migration-admission';
}

const generatedStateRegistrationMigrationAdmissions = new WeakSet<object>();

function issueGeneratedStateRegistrationMigrationAdmission(): GeneratedStateRegistrationMigrationAdmission {
  const admission = Object.freeze({
    kind: 'generated-state-registration-migration-admission' as const
  });
  generatedStateRegistrationMigrationAdmissions.add(admission);
  return admission;
}

function assertGeneratedStateRegistrationMigrationAdmission(
  admission: GeneratedStateRegistrationMigrationAdmission
): void {
  if (!generatedStateRegistrationMigrationAdmissions.has(admission)) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state registration migration requires an owner-issued admission.'
    );
  }
}

const GENERATED_STATE_REGISTRATION_POINTER_KEYS = Object.freeze([
  'ledgerRecordDigest', 'registrationDigest', 'schema'
]);
const GENERATED_STATE_REGISTRATION_LEDGER_KEYS = Object.freeze([
  'previousRecordDigest', 'recordDigest', 'registrationBytes', 'registrationDigest',
  'relativePath', 'schema', 'sequence'
]);
const GENERATED_STATE_REGISTRATION_MIGRATION_KEYS = Object.freeze([
  'intentDigest', 'migrationDigest', 'phase', 'previousIntentDigest', 'schema',
  'sourceGenerationCount', 'sourceInventoryDigest', 'sourcePointerCount',
  'sourceRoot', 'targets'
]);
const GENERATED_STATE_REGISTRATION_MIGRATION_TARGET_KEYS = Object.freeze([
  'registrationDigest', 'relativePath'
]);
function hasExactObjectKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function registrationMigrationMaterial(input: Readonly<{
  sourceRoot: GeneratedStatePhysicalIdentity;
  sourceInventoryDigest: `sha256:${string}`;
  sourceGenerationCount: number;
  sourcePointerCount: number;
  targets: readonly GeneratedStateRegistrationMigrationTarget[];
}>): Readonly<{
  schema: typeof GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA;
  sourceRoot: GeneratedStatePhysicalIdentity;
  sourceInventoryDigest: `sha256:${string}`;
  sourceGenerationCount: number;
  sourcePointerCount: number;
  targets: readonly GeneratedStateRegistrationMigrationTarget[];
}> {
  return Object.freeze({
    schema: GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA,
    sourceRoot: input.sourceRoot,
    sourceInventoryDigest: input.sourceInventoryDigest,
    sourceGenerationCount: input.sourceGenerationCount,
    sourcePointerCount: input.sourcePointerCount,
    targets: Object.freeze([...input.targets].sort((left, right) => left.relativePath.localeCompare(right.relativePath)))
  });
}

function makeRegistrationMigrationIntent(
  material: ReturnType<typeof registrationMigrationMaterial>,
  phase: GeneratedStateRegistrationMigrationIntent['phase'],
  previousIntentDigest: `sha256:${string}` | null
): GeneratedStateRegistrationMigrationIntent {
  const migrationDigest = generatedStateDigest(material);
  const unsigned = Object.freeze({
    ...material,
    phase,
    migrationDigest,
    previousIntentDigest
  });
  return Object.freeze({ ...unsigned, intentDigest: generatedStateDigest(unsigned) });
}

function registrationMigrationIntentName(intent: GeneratedStateRegistrationMigrationIntent): string {
  return `registration-migration-${intent.migrationDigest.slice('sha256:'.length)}-${intent.phase}.json`;
}

function parseRegistrationMigrationIntent(
  bytes: Uint8Array,
  expectedName?: string
): GeneratedStateRegistrationMigrationIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration migration intent is malformed.');
  }
  if (!hasExactObjectKeys(value, GENERATED_STATE_REGISTRATION_MIGRATION_KEYS) ||
      value.schema !== GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA ||
      (value.phase !== 'prepared' && value.phase !== 'complete') ||
      typeof value.migrationDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.migrationDigest) ||
      typeof value.sourceInventoryDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.sourceInventoryDigest) ||
      !Number.isSafeInteger(value.sourceGenerationCount) || (value.sourceGenerationCount as number) < 0 ||
      !Number.isSafeInteger(value.sourcePointerCount) || (value.sourcePointerCount as number) < 0 ||
      !Array.isArray(value.targets) ||
      (value.previousIntentDigest !== null && (
        typeof value.previousIntentDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.previousIntentDigest)
      )) ||
      typeof value.intentDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.intentDigest) ||
      !hasExactObjectKeys(value.sourceRoot, ['device', 'inode', 'objectId']) ||
      typeof value.sourceRoot.device !== 'string' || typeof value.sourceRoot.inode !== 'string' ||
      typeof value.sourceRoot.objectId !== 'string') {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration migration intent is malformed.');
  }
  const targets: GeneratedStateRegistrationMigrationTarget[] = [];
  const targetPaths = new Set<string>();
  for (const target of value.targets) {
    if (!hasExactObjectKeys(target, GENERATED_STATE_REGISTRATION_MIGRATION_TARGET_KEYS) ||
        typeof target.relativePath !== 'string' ||
        target.relativePath !== normalizeGeneratedStateRelativePath(target.relativePath) ||
        typeof target.registrationDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(target.registrationDigest) ||
        targetPaths.has(target.relativePath)) {
      throw new GeneratedStateProducerBindingBlockedError('Generated-state registration migration target is malformed.');
    }
    targetPaths.add(target.relativePath);
    targets.push(Object.freeze({
      relativePath: target.relativePath,
      registrationDigest: target.registrationDigest as `sha256:${string}`
    }));
  }
  const material = registrationMigrationMaterial({
    sourceRoot: Object.freeze({
      device: value.sourceRoot.device,
      inode: value.sourceRoot.inode,
      objectId: value.sourceRoot.objectId
    }),
    sourceInventoryDigest: value.sourceInventoryDigest as `sha256:${string}`,
    sourceGenerationCount: value.sourceGenerationCount as number,
    sourcePointerCount: value.sourcePointerCount as number,
    targets
  });
  const rebuilt = makeRegistrationMigrationIntent(
    material,
    value.phase,
    value.previousIntentDigest as `sha256:${string}` | null
  );
  if (rebuilt.migrationDigest !== value.migrationDigest || rebuilt.intentDigest !== value.intentDigest ||
      canonicalBytes(rebuilt) !== Buffer.from(bytes).toString('utf8') ||
      (expectedName !== undefined && expectedName !== registrationMigrationIntentName(rebuilt))) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration migration intent is invalid.');
  }
  return rebuilt;
}

function registrationGenerationName(registrationDigest: `sha256:${string}`): string {
  return `registration-${registrationDigest.slice('sha256:'.length)}.json`;
}

function registrationLedgerName(
  relativePath: string,
  recordDigest: `sha256:${string}`
): string {
  return `registration-ledger-${registrationKey(relativePath)}-${recordDigest.slice('sha256:'.length)}.json`;
}

function registrationLedgerStableDigest(
  record: Omit<GeneratedStateRegistrationLedgerRecord, 'recordDigest'>
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: record.schema,
    previousRecordDigest: record.previousRecordDigest,
    sequence: record.sequence,
    relativePath: record.relativePath,
    registrationDigest: record.registrationDigest,
    registrationBytes: record.registrationBytes
  }));
}

function makeRegistrationLedgerRecord(
  registration: GeneratedStateRegistration,
  previousRecordDigest: `sha256:${string}` | null,
  sequence: number
): GeneratedStateRegistrationLedgerRecord {
  const registrationBytes = Buffer.from(canonicalBytes(registration), 'utf8');
  const unsigned: Omit<GeneratedStateRegistrationLedgerRecord, 'recordDigest'> = Object.freeze({
    schema: GENERATED_STATE_REGISTRATION_LEDGER_SCHEMA,
    previousRecordDigest,
    sequence,
    relativePath: registration.relativePath,
    registrationDigest: registration.registrationDigest,
    registrationBytes: registrationBytes.toString('base64')
  });
  return Object.freeze({
    ...unsigned,
    recordDigest: registrationLedgerStableDigest(unsigned)
  });
}

function parseRegistrationPointer(bytes: Uint8Array): GeneratedStateRegistrationPointer {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration pointer is malformed.');
  }
  if (!hasExactObjectKeys(value, GENERATED_STATE_REGISTRATION_POINTER_KEYS) ||
      value.schema !== GENERATED_STATE_REGISTRATION_POINTER_SCHEMA ||
      typeof value.registrationDigest !== 'string' ||
      typeof value.ledgerRecordDigest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.registrationDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.ledgerRecordDigest) ||
      canonicalBytes(value) !== Buffer.from(bytes).toString('utf8')) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration pointer is malformed.');
  }
  return Object.freeze(value) as GeneratedStateRegistrationPointer;
}

function parseRegistrationLedgerRecord(
  bytes: Uint8Array,
  expectedName?: string
): GeneratedStateRegistrationLedgerRecord {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration ledger record is malformed.');
  }
  if (!hasExactObjectKeys(value, GENERATED_STATE_REGISTRATION_LEDGER_KEYS)) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration ledger record has noncanonical keys.');
  }
  const record = value as unknown as GeneratedStateRegistrationLedgerRecord;
  if (record.schema !== GENERATED_STATE_REGISTRATION_LEDGER_SCHEMA ||
      !/^sha256:[0-9a-f]{64}$/u.test(record.recordDigest) ||
      (record.previousRecordDigest !== null && !/^sha256:[0-9a-f]{64}$/u.test(record.previousRecordDigest)) ||
      !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
      typeof record.relativePath !== 'string' || record.relativePath !== normalizeGeneratedStateRelativePath(record.relativePath) ||
      !/^sha256:[0-9a-f]{64}$/u.test(record.registrationDigest) ||
      typeof record.registrationBytes !== 'string' || record.registrationBytes.length === 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(record.registrationBytes) ||
      Buffer.from(record.registrationBytes, 'base64').toString('base64') !== record.registrationBytes ||
      registrationLedgerStableDigest({
        schema: record.schema,
        previousRecordDigest: record.previousRecordDigest,
        sequence: record.sequence,
        relativePath: record.relativePath,
        registrationDigest: record.registrationDigest,
        registrationBytes: record.registrationBytes
      }) !== record.recordDigest ||
      (expectedName !== undefined && expectedName !== registrationLedgerName(record.relativePath, record.recordDigest)) ||
      canonicalBytes(record) !== Buffer.from(bytes).toString('utf8')) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration ledger record is invalid.');
  }
  let registration: GeneratedStateRegistration;
  try {
    const registrationBytes = Buffer.from(record.registrationBytes, 'base64');
    if (canonicalBytes(JSON.parse(registrationBytes.toString('utf8')) as unknown) !== registrationBytes.toString('utf8')) {
      throw new Error('registration bytes are not canonical');
    }
    registration = parseGeneratedStateRegistration(JSON.parse(registrationBytes.toString('utf8')) as unknown);
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration ledger generation is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (registration.relativePath !== record.relativePath ||
      registration.registrationDigest !== record.registrationDigest) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration ledger generation binding is invalid.');
  }
  return Object.freeze(record);
}

function readLegacyRegistrationCensus(
  store: GeneratedStateRuntimeStore
): LegacyGeneratedStateRegistrationCensus | null {
  const presence = inspectExactNoFollowDirectoryPresence(
    store.legacyRegistrationsRoot,
    'Legacy generated-state registration root'
  );
  if (presence.state === 'absent') return null;
  const sourceRoot = presence.directory.target;
  const generations = new Map<`sha256:${string}`, Readonly<{
    registration: GeneratedStateRegistration;
    bytes: Buffer;
  }>>();
  const pointers = new Map<string, Readonly<{
    registration: GeneratedStateRegistration;
    bytes: Buffer;
  }>>();
  const inventory: Array<Readonly<{ name: string; bytesDigest: `sha256:${string}` }>> = [];
  const entryIdentities: Array<Readonly<{
    name: string;
    device: string;
    inode: string;
    objectId: string;
    size: number;
  }>> = [];
  const names = readdirSync(sourceRoot.path, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort();
  if (names.length > GENERATED_STATE_REGISTRATION_ROOT_ENTRY_CAPACITY) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Legacy generated-state registration root exceeds its bounded capacity: ${names.length}.`
    );
  }
  for (const name of names) {
    if (name === '.generated-state-registration-mutation.lock') continue;
    if (!/^registration-[0-9a-f]{64}\.json$/u.test(name) && !/^[0-9a-f]{64}\.json$/u.test(name)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Legacy generated-state registration root contains unknown residue: ${name}.`
      );
    }
    const entry = inspectNoFollowOrdinaryFileEntry(sourceRoot, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Legacy generated-state registration entry is absent or foreign: ${name}.`
      );
    }
    const bytes = Buffer.from(entry.bytes);
    let registration: GeneratedStateRegistration;
    try {
      registration = parseGeneratedStateRegistration(JSON.parse(bytes.toString('utf8')) as unknown);
      if (canonicalBytes(registration) !== bytes.toString('utf8')) {
        throw new Error('registration bytes are not canonical');
      }
    } catch (error) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Legacy generated-state registration entry is invalid: ${name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    inventory.push(Object.freeze({
      name,
      bytesDigest: generatedStateDigest(Object.freeze({
        encoding: 'base64',
        bytes: bytes.toString('base64')
      }))
    }));
    entryIdentities.push(Object.freeze({
      name,
      device: entry.device,
      inode: entry.inode,
      objectId: `${entry.device}:${entry.inode}`,
      size: entry.size
    }));
    if (name.startsWith('registration-')) {
      if (registrationGenerationName(registration.registrationDigest) !== name ||
          generations.has(registration.registrationDigest)) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Legacy generated-state registration generation identity is invalid: ${name}.`
        );
      }
      generations.set(registration.registrationDigest, Object.freeze({ registration, bytes }));
      continue;
    }
    if (`${registrationKey(registration.relativePath)}.json` !== name || pointers.has(registration.relativePath)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Legacy generated-state registration pointer identity is invalid: ${name}.`
      );
    }
    pointers.set(registration.relativePath, Object.freeze({ registration, bytes }));
  }
  for (const [relativePath, pointer] of pointers) {
    const generation = generations.get(pointer.registration.registrationDigest);
    if (generation === undefined || !generation.bytes.equals(pointer.bytes)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Legacy generated-state registration pointer does not bind an immutable generation: ${relativePath}.`
      );
    }
  }
  const sourceRootAfter = inspectNoFollowDirectoryChain(
    store.legacyRegistrationsRoot,
    'Legacy generated-state registration root readback'
  ).target;
  if (!samePhysicalIdentity(sourceRoot, sourceRootAfter)) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Legacy generated-state registration root changed during migration census.'
    );
  }
  return Object.freeze({
    sourceRoot,
    sourceInventoryDigest: generatedStateDigest(Object.freeze(inventory)),
    sourceEntryIdentityDigest: generatedStateDigest(Object.freeze(entryIdentities)),
    sourceGenerationCount: generations.size,
    sourcePointerCount: pointers.size,
    generations,
    pointers
  });
}

function assertRegistrationMigrationBoundary(
  store: GeneratedStateRuntimeStore,
  intents: readonly GeneratedStateRegistrationMigrationIntent[]
): void {
  const legacyPresence = inspectExactNoFollowDirectoryPresence(
    store.legacyRegistrationsRoot,
    'Legacy generated-state registration migration evidence'
  );
  if (legacyPresence.state === 'absent') {
    if (intents.length !== 0) {
      throw new GeneratedStateProducerBindingBlockedError(
        'Generated-state registration migration source evidence is absent.'
      );
    }
    return;
  }
  const prepared = intents.filter(({ phase }) => phase === 'prepared');
  const complete = intents.filter(({ phase }) => phase === 'complete');
  if (prepared.length !== 1 || complete.length !== 1 ||
      prepared[0]!.migrationDigest !== complete[0]!.migrationDigest ||
      complete[0]!.previousIntentDigest !== prepared[0]!.intentDigest ||
      !samePhysicalIdentity(prepared[0]!.sourceRoot, identityOf(legacyPresence.directory.target)) ||
      !samePhysicalIdentity(complete[0]!.sourceRoot, prepared[0]!.sourceRoot)) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state registration schema migration is required or incomplete.'
    );
  }
}

/** Recognize only an exact idle pair bound to this original pointer owner. */
function observeRegistrationPointerGuard(
  store: GeneratedStateRuntimeStore,
  parent: PhysicalDirectoryIdentity,
  name: string
): string | null {
  if (!/^(?:\.journal-mutation-|\.sec-journal-guard-)[0-9a-f]{64}\.lock$/u.test(name)) return null;
  const guard = observePhysicalJournalMutationEntry(parent, name);
  if (guard === null || guard.state !== 'idle' || !/^[0-9a-f]{64}\.json$/u.test(guard.resourceName)
      || guard.leaseName !== runtimeStateJournalMutationLeaseName(store.fs.rootPath, path.join(parent.path, guard.resourceName))) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration pointer guard is unqualified or active: ${name}.`
    );
  }
  return guard.resourceName;
}

export function readRegistrationLedgerObservation(
  store: GeneratedStateRuntimeStore,
  relativePath: string
): GeneratedStateRegistrationLedgerObservation {
  const normalized = normalizeGeneratedStateRelativePath(relativePath);
  const registrationsRoot = inspectNoFollowDirectoryChain(
    store.registrationsRoot,
    'Generated-state registration ledger root'
  ).target;
  const names = readdirSync(registrationsRoot.path, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort();
  if (names.length > GENERATED_STATE_REGISTRATION_ROOT_ENTRY_CAPACITY) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration ledger exceeds its bounded root capacity: ${names.length}.`
    );
  }
  const generations = new Map<`sha256:${string}`, Readonly<{
    readonly registration: GeneratedStateRegistration;
    readonly bytes: Buffer;
  }>>();
  const records: GeneratedStateRegistrationLedgerRecord[] = [];
  const pointers = new Map<string, GeneratedStateRegistrationPointer>();
  const migrationIntents: GeneratedStateRegistrationMigrationIntent[] = [];
  const guardedPointers = new Set<string>();
  for (const name of names) {
    const guardedPointer = observeRegistrationPointerGuard(store, registrationsRoot, name);
    if (guardedPointer !== null) { guardedPointers.add(guardedPointer); continue; }
    if (/^[0-9a-f]{64}\.json$/u.test(name)) {
      const entry = inspectNoFollowOrdinaryFileEntry(registrationsRoot, name);
      if (entry === null || entry.bytes === null || entry.kind !== 'file') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration pointer is absent or foreign: ${name}.`
        );
      }
      pointers.set(name.slice(0, -'.json'.length), parseRegistrationPointer(entry.bytes));
      continue;
    }
    if (/^registration-[0-9a-f]{64}\.json$/u.test(name)) {
      const entry = inspectNoFollowOrdinaryFileEntry(registrationsRoot, name);
      if (entry === null || entry.bytes === null || entry.kind !== 'file') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration generation is absent or foreign: ${name}.`
        );
      }
      let registration: GeneratedStateRegistration;
      try {
        const bytes = Buffer.from(entry.bytes);
        registration = parseGeneratedStateRegistration(JSON.parse(bytes.toString('utf8')) as unknown);
        if (canonicalBytes(registration) !== bytes.toString('utf8')) throw new Error('generation bytes are not canonical');
        if (registrationGenerationName(registration.registrationDigest) !== name) {
          throw new Error('generation filename does not match its digest');
        }
        if (generations.has(registration.registrationDigest)) throw new Error('duplicate generation digest');
        generations.set(registration.registrationDigest, Object.freeze({ registration, bytes }));
      } catch (error) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration generation is invalid: ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      continue;
    }
    if (/^registration-ledger-[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(name)) {
      const entry = inspectNoFollowOrdinaryFileEntry(registrationsRoot, name);
      if (entry === null || entry.bytes === null || entry.kind !== 'file') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration ledger record is absent or foreign: ${name}.`
        );
      }
      records.push(parseRegistrationLedgerRecord(entry.bytes, name));
      continue;
    }
    if (/^registration-migration-[0-9a-f]{64}-(?:prepared|complete)\.json$/u.test(name)) {
      const entry = inspectNoFollowOrdinaryFileEntry(registrationsRoot, name);
      if (entry === null || entry.bytes === null || entry.kind !== 'file') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration migration intent is absent or foreign: ${name}.`
        );
      }
      migrationIntents.push(parseRegistrationMigrationIntent(entry.bytes, name));
      continue;
    }
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration root contains unknown residue: ${name}.`
    );
  }
  const registrationsRootAfter = inspectNoFollowDirectoryChain(
    store.registrationsRoot,
    'Generated-state registration ledger root readback'
  ).target;
  if (!samePhysicalIdentity(registrationsRoot, registrationsRootAfter)) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state registration ledger root changed during immutable census.'
    );
  }
  assertRegistrationMigrationBoundary(store, migrationIntents);

  const recordsByPath = new Map<string, GeneratedStateRegistrationLedgerRecord[]>();
  const recordByDigest = new Map<`sha256:${string}`, GeneratedStateRegistrationLedgerRecord>();
  const referencedGenerationDigests = new Set<`sha256:${string}`>();
  for (const record of records) {
    if (recordByDigest.has(record.recordDigest)) {
      throw new GeneratedStateProducerBindingBlockedError('Generated-state registration ledger contains a duplicate record digest.');
    }
    const generation = generations.get(record.registrationDigest);
    if (generation === undefined || !generation.bytes.equals(Buffer.from(record.registrationBytes, 'base64'))) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration ledger record does not bind its immutable generation: ${record.relativePath}.`
      );
    }
    recordByDigest.set(record.recordDigest, record);
    referencedGenerationDigests.add(record.registrationDigest);
    const pathRecords = recordsByPath.get(record.relativePath) ?? [];
    pathRecords.push(record);
    recordsByPath.set(record.relativePath, pathRecords);
  }

  const rootsByPath = new Map<string, GeneratedStateRegistrationLedgerRecord>();
  const tipsByPath = new Map<string, GeneratedStateRegistrationLedgerRecord>();
  for (const [recordPath, pathRecords] of recordsByPath) {
    if (pathRecords.length > GENERATED_STATE_REGISTRATION_LEDGER_CAPACITY) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration ledger exceeds its bounded path capacity: ${recordPath}.`
      );
    }
    const byDigest = new Map(pathRecords.map((record) => [record.recordDigest, record]));
    const children = new Map<`sha256:${string}`, `sha256:${string}`>();
    const roots: GeneratedStateRegistrationLedgerRecord[] = [];
    const registrationDigests = new Set<`sha256:${string}`>();
    for (const record of pathRecords) {
      if (registrationDigests.has(record.registrationDigest)) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration ledger repeats one generation in a path chain: ${recordPath}.`
        );
      }
      registrationDigests.add(record.registrationDigest);
      if (record.previousRecordDigest === null) {
        if (record.sequence !== 1) {
          throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger root sequence is invalid: ${recordPath}.`);
        }
        roots.push(record);
        continue;
      }
      const predecessor = byDigest.get(record.previousRecordDigest);
      if (predecessor === undefined || predecessor.sequence !== record.sequence - 1) {
        throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger predecessor is missing: ${recordPath}.`);
      }
      const previousChild = children.get(record.previousRecordDigest);
      if (previousChild !== undefined && previousChild !== record.recordDigest) {
        throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger predecessor forks: ${recordPath}.`);
      }
      children.set(record.previousRecordDigest, record.recordDigest);
    }
    if (roots.length !== 1) {
      throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger has multiple roots: ${recordPath}.`);
    }
    rootsByPath.set(recordPath, roots[0]!);
    const visited = new Set<`sha256:${string}`>();
    let cursor: GeneratedStateRegistrationLedgerRecord | undefined = roots[0];
    while (cursor !== undefined) {
      if (visited.has(cursor.recordDigest)) {
        throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger contains a cycle: ${recordPath}.`);
      }
      visited.add(cursor.recordDigest);
      const childDigest = children.get(cursor.recordDigest);
      cursor = childDigest === undefined ? undefined : byDigest.get(childDigest);
      if (childDigest !== undefined && cursor === undefined) {
        throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger child disappeared: ${recordPath}.`);
      }
    }
    if (visited.size !== pathRecords.length) {
      throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger has a disconnected fork: ${recordPath}.`);
    }
    const tips = pathRecords.filter((record) => !children.has(record.recordDigest));
    if (tips.length !== 1) {
      throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger has no unique tip: ${recordPath}.`);
    }
    tipsByPath.set(recordPath, tips[0]!);
  }

  for (const [recordPath, tip] of tipsByPath) {
    const pointer = pointers.get(registrationKey(recordPath));
    const generation = generations.get(tip.registrationDigest);
    if (generation === undefined) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration ledger tip generation disappeared: ${recordPath}.`
      );
    }
    if (pointer === undefined) {
      if (generation.registration.phase !== 'retired') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state active registration pointer is absent: ${recordPath}.`
        );
      }
      continue;
    }
    if (pointer.registrationDigest !== tip.registrationDigest ||
        pointer.ledgerRecordDigest !== tip.recordDigest) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration pointer does not bind the ledger tip: ${recordPath}.`
      );
    }
  }
  for (const name of guardedPointers) {
    if (![...tipsByPath.keys()].some(recordPath => `${registrationKey(recordPath)}.json` === name)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration pointer guard has no ledger chain: ${name}.`
      );
    }
  }
  for (const pointerKey of pointers.keys()) {
    if (![...tipsByPath.keys()].some((recordPath) => registrationKey(recordPath) === pointerKey)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration pointer has no ledger chain: ${pointerKey}.`
      );
    }
  }
  if (migrationIntents.length > 0) {
    const complete = migrationIntents.find(({ phase }) => phase === 'complete');
    if (complete === undefined) {
      throw new GeneratedStateProducerBindingBlockedError(
        'Generated-state registration migration lacks a completed intent.'
      );
    }
    for (const target of complete.targets) {
      if (rootsByPath.get(target.relativePath)?.registrationDigest !== target.registrationDigest) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration migration target differs: ${target.relativePath}.`
        );
      }
    }
  }

  for (const generation of generations.values()) {
    if (referencedGenerationDigests.has(generation.registration.registrationDigest)) continue;
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration generation is not bound to the immutable ledger: ${generation.registration.relativePath}.`
    );
  }
  const tip = tipsByPath.get(normalized);
  if (tip !== undefined) {
    const generation = generations.get(tip.registrationDigest);
    if (generation === undefined) throw new GeneratedStateProducerBindingBlockedError('Generated-state registration tip generation disappeared.');
    const previousRecord = tip.previousRecordDigest === null ? null : recordByDigest.get(tip.previousRecordDigest) ?? null;
    const previousRegistration = previousRecord === null
      ? null
      : generations.get(previousRecord.registrationDigest)?.registration ?? null;
    if (tip.previousRecordDigest !== null && previousRegistration === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration predecessor disappeared: ${normalized}.`
      );
    }
    if (!pointers.has(registrationKey(normalized))) {
      return Object.freeze({
        tip,
        registration: null,
        retiredPredecessor: generation.registration,
        previousRegistration
      });
    }
    return Object.freeze({
      tip,
      registration: generation.registration,
      retiredPredecessor: null,
      previousRegistration
    });
  }
  return Object.freeze({ tip: null, registration: null, retiredPredecessor: null, previousRegistration: null });
}

export function loadRegistration(
  store: GeneratedStateRuntimeStore | null,
  relativePath: string
): GeneratedStateRegistration | null {
  if (store === null) return null;
  const currentPresence = inspectExactNoFollowDirectoryPresence(
    store.registrationsRoot,
    'Generated-state registration ledger root'
  );
  if (currentPresence.state === 'absent') {
    const legacyPresence = inspectExactNoFollowDirectoryPresence(
      store.legacyRegistrationsRoot,
      'Legacy generated-state registration root'
    );
    if (legacyPresence.state === 'present') {
      throw new GeneratedStateProducerBindingBlockedError(
        'Generated-state registration schema migration is required.'
      );
    }
    return null;
  }
  return readRegistrationLedgerObservation(store, relativePath).registration;
}

type GeneratedStateRegistrationPointerSnapshot = Readonly<{
  readonly identity: Readonly<{ device: string; inode: string }> | null;
  readonly bytes: Buffer | null;
}>;

function assertGeneratedStateRegistrationBytes(bytes: Uint8Array): void {
  parseGeneratedStateRegistration(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown);
}

function assertGeneratedStateRegistrationPointerBytes(bytes: Uint8Array): void {
  parseRegistrationPointer(bytes);
}

export function inspectRegistrationPointer(
  store: GeneratedStateRuntimeStore,
  relativePath: string
): Readonly<{
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly snapshot: GeneratedStateRegistrationPointerSnapshot;
}> {
  const locator = registrationPath(store, relativePath);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(locator),
    'Generated-state registration pointer parent'
  ).target;
  const name = path.basename(locator);
  const entry = inspectNoFollowOrdinaryFileEntry(parent, name);
  return Object.freeze({
    parent,
    name,
    snapshot: Object.freeze({
      identity: entry === null ? null : Object.freeze({ device: entry.device, inode: entry.inode }),
      bytes: entry?.bytes === null || entry?.bytes === undefined ? null : Buffer.from(entry.bytes)
    })
  });
}

function sameRegistrationPointerSnapshot(
  left: GeneratedStateRegistrationPointerSnapshot,
  right: GeneratedStateRegistrationPointerSnapshot
): boolean {
  return (left.identity === null) === (right.identity === null) &&
    (left.identity === null || (
      left.identity.device === right.identity!.device &&
      left.identity.inode === right.identity!.inode
    )) &&
    (left.bytes === null) === (right.bytes === null) &&
    (left.bytes === null || left.bytes.equals(right.bytes!));
}

export function persistRegistration(
  store: GeneratedStateRuntimeStore,
  registration: GeneratedStateRegistration,
  expectedPointer: GeneratedStateRegistrationPointerSnapshot,
  expectedPreviousRecordDigest: `sha256:${string}` | null
): void {
  const bytes = canonicalBytes(registration);
  const pointer = inspectRegistrationPointer(store, registration.relativePath);
  if (!sameRegistrationPointerSnapshot(pointer.snapshot, expectedPointer)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration pointer changed before durable CAS: ${registration.relativePath}.`
    );
  }
  const observation = readRegistrationLedgerObservation(store, registration.relativePath);
  let predecessor = observation.tip;
  if (expectedPreviousRecordDigest === null) {
    if (predecessor !== null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state birth cannot replace an existing immutable registration generation: ${registration.relativePath}.`
      );
    }
  } else {
    if (predecessor === null || predecessor.recordDigest !== expectedPreviousRecordDigest) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration predecessor changed or is unavailable: ${registration.relativePath}.`
      );
    }
  }
  const generationName = registrationGenerationName(registration.registrationDigest);
  publishExclusiveDurableCanonicalFile({
    parent: pointer.parent,
    name: generationName,
    bytes: Buffer.from(bytes, 'utf8'),
    validate: assertGeneratedStateRegistrationBytes
  });
  const recordSequence = predecessor === null ? 1 : predecessor.sequence + 1;
  if (!Number.isSafeInteger(recordSequence) || recordSequence < 1 ||
      recordSequence > GENERATED_STATE_REGISTRATION_LEDGER_CAPACITY) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration ledger reached its bounded capacity: ${registration.relativePath}.`
    );
  }
  const record = makeRegistrationLedgerRecord(
    registration,
    predecessor?.recordDigest ?? null,
    recordSequence
  );
  const recordName = registrationLedgerName(record.relativePath, record.recordDigest);
  publishExclusiveDurableCanonicalFile({
    parent: pointer.parent,
    name: recordName,
    bytes: Buffer.from(canonicalBytes(record), 'utf8'),
    validate: (candidate) => parseRegistrationLedgerRecord(candidate, recordName)
  });
  const pointerValue: GeneratedStateRegistrationPointer = Object.freeze({
    schema: GENERATED_STATE_REGISTRATION_POINTER_SCHEMA,
    registrationDigest: registration.registrationDigest,
    ledgerRecordDigest: record.recordDigest
  });
  const pointerBytes = Buffer.from(canonicalBytes(pointerValue), 'utf8');
  const pointerPublished = withRuntimeStateJournalMutation(
    store.fs,
    path.join(pointer.parent.path, pointer.name),
    completeFirstPublication => {
      if (expectedPointer.identity === null) {
        const published = publishExclusiveDurableCanonicalFile({
          parent: pointer.parent,
          name: pointer.name,
          bytes: pointerBytes,
          validate: assertGeneratedStateRegistrationPointerBytes
        });
        if (!published.created) {
          throw new GeneratedStateProducerBindingBlockedError(
            `Generated-state registration pointer became occupied during durable CAS: ${registration.relativePath}.`
          );
        }
        completeFirstPublication(published);
      } else {
        replaceDurableCanonicalFile({
          parent: pointer.parent,
          name: pointer.name,
          bytes: pointerBytes,
          expectedExisting: expectedPointer.identity,
          validate: assertGeneratedStateRegistrationPointerBytes
        });
      }
    },
    expectedPointer.identity === null ? 'create-absent-data' : undefined
  );
  if (pointerPublished === null) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration pointer mutation is contended.');
  }

  const finalPointer = inspectRegistrationPointer(store, registration.relativePath).snapshot;
  if (finalPointer.bytes === null || !finalPointer.bytes.equals(pointerBytes) || finalPointer.identity === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration pointer failed exact durable readback: ${registration.relativePath}.`
    );
  }
}

function publishExactRegistrationMigrationFile(
  parent: PhysicalDirectoryIdentity,
  name: string,
  bytes: Buffer,
  validate: (candidate: Uint8Array) => void
): void {
  const existing = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (existing !== null) {
    if (existing.kind !== 'file' || existing.bytes === null || !Buffer.from(existing.bytes).equals(bytes)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration migration target collides with different bytes: ${name}.`
      );
    }
    validate(existing.bytes);
    return;
  }
  const published = publishExclusiveDurableCanonicalFile({ parent, name, bytes, validate });
  if (!published.created) {
    const readback = inspectNoFollowOrdinaryFileEntry(parent, name);
    if (readback === null || readback.kind !== 'file' || readback.bytes === null ||
        !Buffer.from(readback.bytes).equals(bytes)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration migration target was occupied during publish: ${name}.`
      );
    }
  }
}

function readRegistrationMigrationIntents(
  registrationsRoot: PhysicalDirectoryIdentity
): readonly GeneratedStateRegistrationMigrationIntent[] {
  const intents: GeneratedStateRegistrationMigrationIntent[] = [];
  for (const name of readdirSync(registrationsRoot.path, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort()) {
    if (!/^registration-migration-[0-9a-f]{64}-(?:prepared|complete)\.json$/u.test(name)) continue;
    const entry = inspectNoFollowOrdinaryFileEntry(registrationsRoot, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration migration intent is absent or foreign: ${name}.`
      );
    }
    intents.push(parseRegistrationMigrationIntent(entry.bytes, name));
  }
  return Object.freeze(intents);
}

function ensureRegistrationLedgerMigration(
  store: GeneratedStateRuntimeStore,
  legacy: LegacyGeneratedStateRegistrationCensus | null,
  admission: GeneratedStateRegistrationMigrationAdmission
): void {
  assertGeneratedStateRegistrationMigrationAdmission(admission);
  const registrationsRoot = inspectNoFollowDirectoryChain(
    store.registrationsRoot,
    'Generated-state registration migration target root'
  ).target;
  const existingIntents = readRegistrationMigrationIntents(registrationsRoot);
  if (legacy === null) {
    if (existingIntents.length !== 0) {
      throw new GeneratedStateProducerBindingBlockedError(
        'Generated-state registration migration source evidence is absent.'
      );
    }
    return;
  }
  const targets = Object.freeze([...legacy.pointers.values()]
    .map(({ registration }) => Object.freeze({
      relativePath: registration.relativePath,
      registrationDigest: registration.registrationDigest
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath)));
  const material = registrationMigrationMaterial({
    sourceRoot: identityOf(legacy.sourceRoot),
    sourceInventoryDigest: legacy.sourceInventoryDigest,
    sourceGenerationCount: legacy.sourceGenerationCount,
    sourcePointerCount: legacy.sourcePointerCount,
    targets
  });
  const prepared = makeRegistrationMigrationIntent(material, 'prepared', null);
  const complete = makeRegistrationMigrationIntent(material, 'complete', prepared.intentDigest);
  for (const intent of existingIntents) {
    const expected = intent.phase === 'prepared' ? prepared : complete;
    if (intent.intentDigest !== expected.intentDigest) {
      throw new GeneratedStateProducerBindingBlockedError(
        'Generated-state registration migration intent does not bind the current legacy inventory.'
      );
    }
  }
  if (existingIntents.some(({ phase }) => phase === 'complete')) {
    assertRegistrationMigrationBoundary(store, existingIntents);
    // A complete marker is historical evidence, not a permanent bypass.  A
    // later mutation must perform one complete target census before it can
    // continue.  The census validates every generation, ledger chain,
    // pointer, migration target and unknown-residue boundary; it also fences
    // the target root identity before and after the read.  One call is enough
    // because the census covers the whole namespace rather than only the
    // requested registration path.
    readRegistrationLedgerObservation(
      store,
      complete.targets[0]?.relativePath ?? '.generated-state-registration-migration-empty'
    );
    return;
  }

  const allowedTargetNames = new Set<string>([
    registrationMigrationIntentName(prepared),
    registrationMigrationIntentName(complete)
  ]);
  for (const { registration } of legacy.pointers.values()) {
    const record = makeRegistrationLedgerRecord(registration, null, 1);
    allowedTargetNames.add(registrationGenerationName(registration.registrationDigest));
    allowedTargetNames.add(registrationLedgerName(record.relativePath, record.recordDigest));
    allowedTargetNames.add(`${registrationKey(registration.relativePath)}.json`);
  }
  for (const name of readdirSync(registrationsRoot.path, { withFileTypes: true }).map((entry) => entry.name)) {
    const guardedPointer = observeRegistrationPointerGuard(store, registrationsRoot, name);
    if (!allowedTargetNames.has(guardedPointer ?? name)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration migration target contains unknown residue: ${name}.`
      );
    }
  }

  const preparedName = registrationMigrationIntentName(prepared);
  publishExactRegistrationMigrationFile(
    registrationsRoot,
    preparedName,
    Buffer.from(canonicalBytes(prepared), 'utf8'),
    (candidate) => parseRegistrationMigrationIntent(candidate, preparedName)
  );
  for (const { registration, bytes } of legacy.pointers.values()) {
    const generationName = registrationGenerationName(registration.registrationDigest);
    publishExactRegistrationMigrationFile(
      registrationsRoot,
      generationName,
      bytes,
      assertGeneratedStateRegistrationBytes
    );
    const record = makeRegistrationLedgerRecord(registration, null, 1);
    const recordName = registrationLedgerName(record.relativePath, record.recordDigest);
    publishExactRegistrationMigrationFile(
      registrationsRoot,
      recordName,
      Buffer.from(canonicalBytes(record), 'utf8'),
      (candidate) => parseRegistrationLedgerRecord(candidate, recordName)
    );
    const pointer: GeneratedStateRegistrationPointer = Object.freeze({
      schema: GENERATED_STATE_REGISTRATION_POINTER_SCHEMA,
      registrationDigest: registration.registrationDigest,
      ledgerRecordDigest: record.recordDigest
    });
    const pointerName = `${registrationKey(registration.relativePath)}.json`;
    const pointerPath = path.join(registrationsRoot.path, pointerName);
    const pointerBytes = Buffer.from(canonicalBytes(pointer), 'utf8');
    const existing = inspectNoFollowOrdinaryFileEntry(registrationsRoot, pointerName);
    const published = withRuntimeStateJournalMutation(store.fs, pointerPath, completeFirstPublication => {
      if (existing !== null) {
        publishExactRegistrationMigrationFile(registrationsRoot, pointerName, pointerBytes,
          assertGeneratedStateRegistrationPointerBytes);
        return;
      }
      const receipt = publishExclusiveDurableCanonicalFile({
        parent: registrationsRoot, name: pointerName, bytes: pointerBytes,
        validate: assertGeneratedStateRegistrationPointerBytes
      });
      completeFirstPublication(receipt);
    }, existing === null ? 'create-absent-data' : undefined);
    if (published === null) {
      throw new GeneratedStateProducerBindingBlockedError('Generated-state migration pointer mutation is contended.');
    }
  }
  const sourceReadback = readLegacyRegistrationCensus(store);
  if (sourceReadback === null ||
      !samePhysicalIdentity(sourceReadback.sourceRoot, legacy.sourceRoot) ||
      sourceReadback.sourceInventoryDigest !== legacy.sourceInventoryDigest ||
      sourceReadback.sourceEntryIdentityDigest !== legacy.sourceEntryIdentityDigest ||
      sourceReadback.sourceGenerationCount !== legacy.sourceGenerationCount ||
      sourceReadback.sourcePointerCount !== legacy.sourcePointerCount) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Legacy generated-state registration source changed during migration.'
    );
  }
  const completeName = registrationMigrationIntentName(complete);
  publishExactRegistrationMigrationFile(
    registrationsRoot,
    completeName,
    Buffer.from(canonicalBytes(complete), 'utf8'),
    (candidate) => parseRegistrationMigrationIntent(candidate, completeName)
  );
  const finalIntents = readRegistrationMigrationIntents(registrationsRoot);
  assertRegistrationMigrationBoundary(store, finalIntents);
  for (const { registration } of legacy.pointers.values()) {
    const readback = readRegistrationLedgerObservation(store, registration.relativePath);
    if (readback.registration?.registrationDigest !== registration.registrationDigest ||
        readback.tip?.registrationDigest !== registration.registrationDigest) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration migration readback differs: ${registration.relativePath}.`
      );
    }
  }
}

export async function withGeneratedStateMutationLease<Value>(
  workspaceRoot: string,
  options: GeneratedStateRegistrationStoreOptions,
  execute: (store: GeneratedStateRuntimeStore) => Promise<Value>
): Promise<Value> {
  const store = await openRuntimeStore(workspaceRoot, options);
  const generatedRoot = inspectNoFollowDirectoryChain(
    path.dirname(store.registrationsRoot),
    'Generated-state registration mutation owner root'
  ).target;
  const lease = acquirePhysicalMutationLease(
    generatedRoot,
    '.generated-state-registration-mutation.lock'
  );
  if (lease === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state registration mutation lease is unavailable; registration bytes are preserved.'
    );
  }
  let value: Value | undefined;
  let primaryFailed = false;
  let primaryFailure: unknown;
  try {
    // Registration recovery uses its durable ledger, not predecessor lease identity.
    lease.acknowledgeReclaimedRecovery();
    await store.assertCurrent();
    // Validate the legacy source before materializing the new namespace.  A
    // malformed/foreign source must leave no target directory behind; the
    // parent lease is the only transient effect in that case.
    const legacy = readLegacyRegistrationCensus(store);
    const currentTarget = inspectExactNoFollowDirectoryPresence(
      store.registrationsRoot,
      'Generated-state registration mutation target'
    );
    if (currentTarget.state === 'absent') {
      createExclusiveNoFollowDirectory(
        generatedRoot,
        path.basename(store.registrationsRoot)
      );
    }
    await store.assertCurrent();
    ensureRegistrationLedgerMigration(
      store,
      legacy,
      issueGeneratedStateRegistrationMigrationAdmission()
    );
    await store.assertCurrent();
    value = await execute(store);
    await store.assertCurrent();
  } catch (error) {
    primaryFailed = true;
    primaryFailure = error;
  }
  let settlementFailed = false;
  let settlementFailure: unknown;
  try {
    if (lease.recoveryPending) lease.restoreReclaimedOwner();
    else await lease.release();
  } catch (error) {
    settlementFailed = true;
    settlementFailure = error;
  }
  if (primaryFailed && settlementFailed) {
    throw new AggregateError(
      [primaryFailure, settlementFailure],
      'Generated-state registration mutation and lease settlement both failed.'
    );
  }
  if (primaryFailed) throw primaryFailure;
  if (settlementFailed) throw settlementFailure;
  return value as Value;
}

export async function ensureGeneratedStateRegistrationLedger(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
}>, options: GeneratedStateRegistrationStoreOptions = {}): Promise<void> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const locations = runtimePaths(workspaceRoot, options);
  const legacy = inspectExactNoFollowDirectoryPresence(
    locations.legacyRegistrationsRoot,
    'Generated-state legacy registration ledger admission'
  );
  const current = inspectExactNoFollowDirectoryPresence(
    locations.registrationsRoot,
    'Generated-state registration ledger admission'
  );
  if (legacy.state === 'absent' && current.state === 'absent') return;
  await withGeneratedStateMutationLease(workspaceRoot, options, async () => undefined);
}

/**
 * A producer may only retire state for which it can prove an issuer-created
 * active registration.  This error is deliberately distinct from an ordinary
 * lifecycle failure: callers must preserve the physical target and surface a
 * typed provenance blocker rather than retrying with a new birth.
 */
export class GeneratedStateProducerBindingBlockedError extends Error {
  readonly code = 'GENERATED_STATE_PROVENANCE_BLOCKED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'GeneratedStateProducerBindingBlockedError';
  }
}
