import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { GeneratedStateProducerBindingBlockedError } from '../../../execution/generated-state/errors.ts';
import type {
  GeneratedStateMigrationPlan, GeneratedStateNativeMutationResource,
  GeneratedStateNativeObservationResource,
  GeneratedStateNativeResource,
  GeneratedStatePublicationAuthority,
  GeneratedStateRegistrationCensus,
  GeneratedStateRegistrationObservation as GeneratedStateRegistrationLedgerObservation,
  GeneratedStateRegistrationRecord as GeneratedStateRegistrationLedgerRecord,
  GeneratedStateMigrationIntent as GeneratedStateRegistrationMigrationIntent,
  GeneratedStateRegistrationMutationBackend,
  GeneratedStateRegistrationObservationBackend,
  GeneratedStateRegistrationResponsibilities,
  GeneratedStateMigrationSource as LegacyGeneratedStateRegistrationCensus
} from '../../../execution/generated-state/registration-port.ts';
import { consumeGeneratedStatePublication } from '../../../execution/generated-state/registration-session.ts';
import { assertGeneratedStateRegistrationResponsibilityAdmission, assertGeneratedStateRegistrationTransitionAdmission } from '../../../execution/generated-state/registration-transition.ts';
import { canonicalBytes } from './canonical-bytes.ts';
import { parseGeneratedStateCleanupIntentBytes, parseWorktreeRetirementIntent } from './journal-codec.ts';

import {
  generatedStateDigest,
  normalizeGeneratedStateRelativePath,
  parseGeneratedStateRegistration,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateRegistration
} from '../../../execution/generated-state/contract.ts';
import {
  acquirePhysicalMutationLease, assertPhysicalMutationLeaseOwned,
  ensurePhysicalMutationCoordinationNamespace,
  observePhysicalJournalMutationEntry,
  preparePhysicalMutationCoordinationResource
} from '../physical/runtime/mutation-lease.ts';
import {
  assertPhysicallyDisjointDirectoryChains,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowLinkEntry,
  inspectNoFollowOrdinaryFileEntry,
  physicallyContainsDirectoryChain,
  publishExclusiveDurableCanonicalFile,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from '../physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem, runtimeStateJournalMutationLeaseName } from '../workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority } from '../workspace-state/physical-authority.ts';

/**
 * Registration storage owns immutable self-contained chain publication and
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
  readonly workspaceRoot: string;
  readonly legacyRegistrationsRoot: string;
  readonly previousRegistrationsRoot: string;
  readonly registrationsRoot: string;
  readonly settlementsRoot: string;
  readonly transactionsRoot: string;
  readonly fs: ReturnType<typeof createRuntimeStateJournalFileSystem>;
  readonly assertCurrent: () => Promise<void>;
}

interface GeneratedStateRuntimePaths {
  readonly workspaceStateRoot: string;
  readonly legacyRegistrationsRoot: string;
  readonly previousRegistrationsRoot: string;
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

type ObservedGeneratedStateRoot = Readonly<{
  kind: 'directory' | 'file' | 'link' | 'missing';
  identity: GeneratedStatePhysicalIdentity | null;
  directory: PhysicalDirectoryIdentity | null;
  linkTarget: string | null;
}>;

export function observeGeneratedStatePhysicalRoot(workspaceRoot: string, relativePath: string): ObservedGeneratedStateRoot {
  const absolutePath = path.join(workspaceRoot, ...normalizeGeneratedStateRelativePath(relativePath).split('/'));
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    const parent = inspectNoFollowDirectoryChain(path.dirname(absolutePath), 'Generated-state link parent').target;
    const entry = inspectNoFollowLinkEntry(parent, path.basename(absolutePath));
    if (entry === null || entry.linkTarget === null) {
      return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
    }
    return Object.freeze({
      kind: 'link',
      identity: Object.freeze({
        device: entry.device,
        inode: entry.inode,
        objectId: generatedStateDigest({ kind: 'link', target: entry.linkTarget })
      }),
      directory: null,
      linkTarget: entry.linkTarget
    });
  }
  if (metadata.isDirectory()) {
    const directory = inspectNoFollowDirectoryChain(absolutePath, 'Generated-state root').target;
    return Object.freeze({ kind: 'directory', identity: identityOf(directory), directory, linkTarget: null });
  }
  if (!metadata.isFile()) return Object.freeze({ kind: 'link', identity: null, directory: null, linkTarget: null });
  const parent = inspectNoFollowDirectoryChain(path.dirname(absolutePath), 'Generated-state file parent').target;
  const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(absolutePath));
  if (entry === null) return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
  return Object.freeze({
    kind: 'file',
    identity: Object.freeze({
      device: entry.device,
      inode: entry.inode,
      objectId: `${entry.device}:${entry.inode}`
    }),
    directory: null,
    linkTarget: null
  });
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
    previousRegistrationsRoot: path.join(generatedRoot, 'registrations-v2'),
    registrationsRoot: path.join(generatedRoot, 'registrations-v3'),
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
    workspaceRoot: path.resolve(workspaceRoot),
    previousRegistrationsRoot: locations.previousRegistrationsRoot,
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
    workspaceRoot: path.resolve(workspaceRoot),
    previousRegistrationsRoot: locations.previousRegistrationsRoot,
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

const GENERATED_STATE_REGISTRATION_POINTER_SCHEMA = 'sec-generated-state-registration-pointer-v2' as const;
const GENERATED_STATE_REGISTRATION_LEDGER_SCHEMA = 'sec-generated-state-registration-ledger-v2' as const;
const GENERATED_STATE_REGISTRATION_CHAIN_SCHEMA = 'sec-generated-state-registration-chain-v3' as const;
const GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA = 'sec-generated-state-registration-migration-v1' as const;
const GENERATED_STATE_REGISTRATION_CHAIN_MIGRATION_SCHEMA = 'sec-generated-state-registration-migration-v3' as const;
const GENERATED_STATE_REGISTRATION_LEDGER_CAPACITY = 10_000;
const GENERATED_STATE_REGISTRATION_ROOT_ENTRY_CAPACITY = 30_000;

type GeneratedStateRegistrationPointer = Readonly<{
  readonly schema: typeof GENERATED_STATE_REGISTRATION_POINTER_SCHEMA;
  readonly registrationDigest: `sha256:${string}`;
  readonly ledgerRecordDigest: `sha256:${string}`;
}>;



type GeneratedStateRegistrationMigrationTarget = Readonly<{
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}`;
}>;







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
  physicalPreimageDigest?: `sha256:${string}`;
  sourceRoot: GeneratedStatePhysicalIdentity;
  sourceInventoryDigest: `sha256:${string}`;
  sourceGenerationCount: number;
  sourcePointerCount: number;
  targets: readonly GeneratedStateRegistrationMigrationTarget[];
}>): Readonly<{
  schema: typeof GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA | typeof GENERATED_STATE_REGISTRATION_CHAIN_MIGRATION_SCHEMA;
  physicalPreimageDigest?: `sha256:${string}`;
  sourceRoot: GeneratedStatePhysicalIdentity;
  sourceInventoryDigest: `sha256:${string}`;
  sourceGenerationCount: number;
  sourcePointerCount: number;
  targets: readonly GeneratedStateRegistrationMigrationTarget[];
}> {
  return Object.freeze({
    schema: input.physicalPreimageDigest === undefined ? GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA : GENERATED_STATE_REGISTRATION_CHAIN_MIGRATION_SCHEMA,
    ...(input.physicalPreimageDigest === undefined ? {} : { physicalPreimageDigest: input.physicalPreimageDigest }),
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
  const chain = typeof value === 'object' && value !== null &&
    (value as Record<string, unknown>).schema === GENERATED_STATE_REGISTRATION_CHAIN_MIGRATION_SCHEMA;
  if (!hasExactObjectKeys(value, chain ? [...GENERATED_STATE_REGISTRATION_MIGRATION_KEYS, 'physicalPreimageDigest'] : GENERATED_STATE_REGISTRATION_MIGRATION_KEYS) ||
      (value.schema !== GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA && value.schema !== GENERATED_STATE_REGISTRATION_CHAIN_MIGRATION_SCHEMA) ||
      (chain && (typeof value.physicalPreimageDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.physicalPreimageDigest))) ||
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
    ...(chain ? { physicalPreimageDigest: value.physicalPreimageDigest as `sha256:${string}` } : {}),
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
    ...(record.schema === GENERATED_STATE_REGISTRATION_CHAIN_SCHEMA ? { event: record.event } : {}),
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
  sequence: number,
  event: 'registered' | 'disposed' = 'registered'
): GeneratedStateRegistrationLedgerRecord {
  const registrationBytes = Buffer.from(canonicalBytes(registration), 'utf8');
  const unsigned: Omit<GeneratedStateRegistrationLedgerRecord, 'recordDigest'> = Object.freeze({
    schema: GENERATED_STATE_REGISTRATION_CHAIN_SCHEMA,
    event,
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
  const chain = typeof value === 'object' && value !== null &&
    (value as Record<string, unknown>).schema === GENERATED_STATE_REGISTRATION_CHAIN_SCHEMA;
  if (!hasExactObjectKeys(value, chain ? [...GENERATED_STATE_REGISTRATION_LEDGER_KEYS, 'event'] : GENERATED_STATE_REGISTRATION_LEDGER_KEYS)) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state registration ledger record has noncanonical keys.');
  }
  const record = value as unknown as GeneratedStateRegistrationLedgerRecord;
  if ((record.schema !== GENERATED_STATE_REGISTRATION_LEDGER_SCHEMA && record.schema !== GENERATED_STATE_REGISTRATION_CHAIN_SCHEMA) ||
      (chain && record.event !== 'registered' && record.event !== 'disposed') ||
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
        ...(chain ? { event: record.event } : {}),
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
      registration.registrationDigest !== record.registrationDigest ||
      (record.event === 'disposed' && registration.phase !== 'retired')) {
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
  const previousPresence = inspectExactNoFollowDirectoryPresence(store.previousRegistrationsRoot,
    'Previous registration migration evidence');
  const legacyPresence = inspectExactNoFollowDirectoryPresence(
    store.registrationsRoot !== store.previousRegistrationsRoot && previousPresence.state === 'present'
      ? store.previousRegistrationsRoot : store.legacyRegistrationsRoot,
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
  relativePath: string,
  legacyMigration = false
): GeneratedStateRegistrationLedgerObservation {
  const normalized = normalizeGeneratedStateRelativePath(relativePath);
  const presence = inspectExactNoFollowDirectoryPresence(store.registrationsRoot, 'Generated-state registration chain reader');
  if (presence.state === 'absent' && !legacyMigration) {
    const previous = inspectExactNoFollowDirectoryPresence(store.previousRegistrationsRoot, 'Previous registration reader');
    if (previous.state === 'present') {
      // Observation is zero-write. Stable registration identity may guide
      // continuation; adoption/publication still requires the original owner
      // lease and the complete migration protocol.
      return readRegistrationLedgerObservation(Object.freeze({ ...store,
        registrationsRoot: store.previousRegistrationsRoot }), normalized, true);
    }
    const legacy = readLegacyRegistrationCensus(store);
    const registration = legacy?.pointers.get(normalized)?.registration ?? null;
    return Object.freeze({ tip: null, registration, retiredPredecessor: null, previousRegistration: null });
  }
  return readRegistrationLedgerCensus(store, legacyMigration).observations.get(normalized) ??
    Object.freeze({ tip: null, registration: null, retiredPredecessor: null, previousRegistration: null });
}


/** One fresh physical namespace snapshot, never cached across publication. */
function readRegistrationLedgerCensus(
  store: GeneratedStateRuntimeStore,
  legacyMigration = false
): GeneratedStateRegistrationCensus {
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
    if (guardedPointer !== null) {
      if (!legacyMigration) throw new GeneratedStateProducerBindingBlockedError('Current registration chain contains a forbidden pointer guard.');
      guardedPointers.add(guardedPointer); continue;
    }
    if (/^[0-9a-f]{64}\.json$/u.test(name)) {
      if (!legacyMigration) throw new GeneratedStateProducerBindingBlockedError('Current registration chain contains a forbidden pointer.');
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
      if (!legacyMigration) throw new GeneratedStateProducerBindingBlockedError('Current registration chain contains a forbidden generation.');
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
      const record = parseRegistrationLedgerRecord(entry.bytes, name);
      if (record.schema !== (legacyMigration ? GENERATED_STATE_REGISTRATION_LEDGER_SCHEMA : GENERATED_STATE_REGISTRATION_CHAIN_SCHEMA)) {
        throw new GeneratedStateProducerBindingBlockedError('Registration record belongs to a different format namespace.');
      }
      records.push(record);
      if (!legacyMigration) {
        const bytes = Buffer.from(record.registrationBytes, 'base64');
        generations.set(record.registrationDigest, Object.freeze({
          registration: parseGeneratedStateRegistration(JSON.parse(bytes.toString('utf8')) as unknown), bytes
        }));
      }
      continue;
    }
    if (/^registration-migration-[0-9a-f]{64}-(?:prepared|complete)\.json$/u.test(name)) {
      const entry = inspectNoFollowOrdinaryFileEntry(registrationsRoot, name);
      if (entry === null || entry.bytes === null || entry.kind !== 'file') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration migration intent is absent or foreign: ${name}.`
        );
      }
      const intent = parseRegistrationMigrationIntent(entry.bytes, name);
      if (intent.schema !== (legacyMigration ? GENERATED_STATE_REGISTRATION_MIGRATION_SCHEMA : GENERATED_STATE_REGISTRATION_CHAIN_MIGRATION_SCHEMA)) {
        throw new GeneratedStateProducerBindingBlockedError('Registration migration intent belongs to a different format namespace.');
      }
      migrationIntents.push(intent);
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
  if (legacyMigration) {
    const legacyStore = Object.freeze({ ...store, registrationsRoot: store.previousRegistrationsRoot });
    assertRegistrationMigrationBoundary(legacyStore, migrationIntents);
  } else {
    assertRegistrationMigrationBoundary(store, migrationIntents);
  }

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
  const pathByKey = new Map<string, string>();
  for (const [recordPath, pathRecords] of recordsByPath) {
    const key = registrationKey(recordPath);
    if (pathByKey.has(key)) throw new GeneratedStateProducerBindingBlockedError('Registration path key collision.');
    pathByKey.set(key, recordPath);
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
      if (record.event !== 'disposed' && registrationDigests.has(record.registrationDigest)) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration ledger repeats one generation in a path chain: ${recordPath}.`
        );
      }
      if (record.event !== 'disposed') registrationDigests.add(record.registrationDigest);
      if (record.previousRecordDigest === null) {
        if (record.sequence !== 1 || record.event === 'disposed') {
          throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger root sequence is invalid: ${recordPath}.`);
        }
        roots.push(record);
        continue;
      }
      const predecessor = byDigest.get(record.previousRecordDigest);
      if (predecessor === undefined || predecessor.sequence !== record.sequence - 1) {
        throw new GeneratedStateProducerBindingBlockedError(`Generated-state registration ledger predecessor is missing: ${recordPath}.`);
      }
      if (record.event === 'disposed' &&
          (predecessor.event === 'disposed' || predecessor.registrationDigest !== record.registrationDigest)) {
        throw new GeneratedStateProducerBindingBlockedError(`Disposed registration does not bind its exact retired predecessor: ${recordPath}.`);
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
    if (!legacyMigration) continue;
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
      const pointedRecord = recordByDigest.get(pointer.ledgerRecordDigest);
      const pointedRegistration = generations.get(pointer.registrationDigest)?.registration;
      const retired = generation.registration;
      if (pointedRecord === undefined || pointedRegistration === undefined ||
          pointedRecord.registrationDigest !== pointer.registrationDigest ||
          tip.previousRecordDigest !== pointedRecord.recordDigest ||
          retired.phase !== 'retired' || pointedRegistration.phase !== 'active' ||
          retired.operationId !== pointedRegistration.operationId ||
          retired.registrationId !== pointedRegistration.registrationId ||
          !samePhysicalIdentity(retired.root, pointedRegistration.root) ||
          !samePhysicalIdentity(retired.workspace, pointedRegistration.workspace) ||
          retired.retirementRef === null) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state registration pointer does not bind a legal unique retirement successor: ${recordPath}.`
        );
      }
    }
  }
  for (const name of guardedPointers) {
    if (!pathByKey.has(name.slice(0, -'.json'.length))) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration pointer guard has no ledger chain: ${name}.`
      );
    }
  }
  for (const pointerKey of pointers.keys()) {
    if (!pathByKey.has(pointerKey)) {
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
  const observations = new Map<string, GeneratedStateRegistrationLedgerObservation>();
  for (const [normalized, tip] of tipsByPath) {
    const generation = generations.get(tip.registrationDigest);
    if (generation === undefined) throw new GeneratedStateProducerBindingBlockedError('Generated-state registration tip generation disappeared.');
    const registeredTip = tip.event === 'disposed' && tip.previousRecordDigest !== null
      ? recordByDigest.get(tip.previousRecordDigest) ?? tip : tip;
    const previousRecord = registeredTip.previousRecordDigest === null ? null : recordByDigest.get(registeredTip.previousRecordDigest) ?? null;
    const previousRegistration = previousRecord === null
      ? null
      : generations.get(previousRecord.registrationDigest)?.registration ?? null;
    if (registeredTip.previousRecordDigest !== null && previousRegistration === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration predecessor disappeared: ${normalized}.`
      );
    }
    const disposed = legacyMigration ? !pointers.has(registrationKey(normalized)) : tip.event === 'disposed';
    observations.set(normalized, Object.freeze({
      tip,
      registration: disposed ? null : generation.registration,
      retiredPredecessor: disposed ? generation.registration : null,
      previousRegistration
    }));
  }
  return Object.freeze({ observations, recordsByPath });
}

export function loadRegistration(
  store: GeneratedStateRuntimeStore | null,
  relativePath: string
): GeneratedStateRegistration | null {
  if (store === null) return null;
  return readRegistrationLedgerObservation(store, relativePath).registration;
}

function persistRegistration(
  store: GeneratedStateRuntimeStore,
  registration: GeneratedStateRegistration,
  expectedPreviousRecordDigest: `sha256:${string}` | null,
  event: 'registered' | 'disposed' = 'registered'
): void {
  if (!generatedStateMutationStores.has(store)) {
    throw new GeneratedStateProducerBindingBlockedError('Registration publication requires the original owner mutation lease.');
  }
  const observation = readRegistrationLedgerObservation(store, registration.relativePath);
  assertGeneratedStateRegistrationResponsibilityAdmission({ kind: 'registration', registration,
    previousRecordDigest: expectedPreviousRecordDigest, event }, observation,
    readNativeRegistrationResponsibilities(store, registration.relativePath));
  const predecessor = observation.tip;
  if ((predecessor?.recordDigest ?? null) !== expectedPreviousRecordDigest) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration predecessor changed before publication: ${registration.relativePath}.`
    );
  }
  if (event === 'disposed' && (registration.phase !== 'retired' ||
      observation.registration?.registrationDigest !== registration.registrationDigest)) {
    throw new GeneratedStateProducerBindingBlockedError('Disposal requires the exact current retired registration.');
  }
  if (event === 'disposed' && observeGeneratedStatePhysicalRoot(store.workspaceRoot, registration.relativePath).kind !== 'missing') {
    throw new GeneratedStateProducerBindingBlockedError('Disposal cannot be published before exact source physical absence readback.');
  }
  const sequence = (predecessor?.sequence ?? 0) + 1;
  if (sequence > GENERATED_STATE_REGISTRATION_LEDGER_CAPACITY) {
    throw new GeneratedStateProducerBindingBlockedError('Registration chain reached its bounded capacity.');
  }
  const record = makeRegistrationLedgerRecord(registration, expectedPreviousRecordDigest, sequence, event);
  const name = registrationLedgerName(record.relativePath, record.recordDigest);
  const parent = inspectNoFollowDirectoryChain(store.registrationsRoot, 'Registration publication root').target;
  const published = publishExclusiveDurableCanonicalFile({
    parent, name, bytes: Buffer.from(canonicalBytes(record), 'utf8'),
    validate: candidate => parseRegistrationLedgerRecord(candidate, name)
  });
  if (!published.created) {
    throw new GeneratedStateProducerBindingBlockedError('Registration publication became occupied.');
  }
  const readback = readRegistrationLedgerObservation(store, registration.relativePath);
  if (readback.tip?.recordDigest !== record.recordDigest) {
    throw new GeneratedStateProducerBindingBlockedError('Registration publication failed exact terminal readback.');
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

/** Old formats are strict, read-only inputs. The original census/parser owns
 * their byte and graph semantics; no pointer guard is acquired or rewritten. */
function readRegistrationMigrationSource(store: GeneratedStateRuntimeStore): LegacyGeneratedStateRegistrationCensus | null {
  const legacy = readLegacyRegistrationCensus(store);
  const previous = inspectExactNoFollowDirectoryPresence(store.previousRegistrationsRoot, 'Previous registration source');
  if (previous.state === 'absent') return legacy;
  const root = previous.directory.target;
  const names = readdirSync(root.path).sort();
  if (names.length > GENERATED_STATE_REGISTRATION_ROOT_ENTRY_CAPACITY) {
    throw new GeneratedStateProducerBindingBlockedError('Previous registration source exceeds bounded capacity.');
  }
  const entries = names.map(name => {
    const guarded = observeRegistrationPointerGuard(store, root, name);
    if (guarded !== null) return Object.freeze({ name, guard: guarded });
    const entry = inspectNoFollowOrdinaryFileEntry(root, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
      throw new GeneratedStateProducerBindingBlockedError('Previous registration source contains a foreign entry.');
    }
    return Object.freeze({ name, bytes: Buffer.from(entry.bytes).toString('base64'), device: entry.device, inode: entry.inode });
  });
  const sourceStore = Object.freeze({ ...store, registrationsRoot: store.previousRegistrationsRoot });
  const census = readRegistrationLedgerCensus(sourceStore, true);
  const pointers = new Map<string, Readonly<{ registration: GeneratedStateRegistration; bytes: Buffer }>>();
  const disposedPaths = new Set<string>();
  const generations = new Map<`sha256:${string}`, Readonly<{ registration: GeneratedStateRegistration; bytes: Buffer }>>();
  for (const [relativePath, observation] of census.observations) {
    const registration = observation.registration ?? observation.retiredPredecessor;
    if (registration === null) continue;
    if (observation.registration === null) disposedPaths.add(relativePath);
    const value = Object.freeze({ registration, bytes: Buffer.from(canonicalBytes(registration), 'utf8') });
    pointers.set(relativePath, value);
    generations.set(registration.registrationDigest, value);
  }
  const after = inspectNoFollowDirectoryChain(root.path, 'Previous registration source readback').target;
  if (!samePhysicalIdentity(root, after)) throw new GeneratedStateProducerBindingBlockedError('Previous registration source root changed.');
  return Object.freeze({ sourceRoot: root,
    sourceInventoryDigest: generatedStateDigest({ entries, legacyInventory: legacy?.sourceInventoryDigest ?? null }),
    sourceEntryIdentityDigest: generatedStateDigest({ entries, legacyIdentity: legacy?.sourceEntryIdentityDigest ?? null }),
    sourceGenerationCount: names.filter(name => /^registration-[0-9a-f]{64}\.json$/u.test(name)).length,
    sourcePointerCount: names.filter(name => /^[0-9a-f]{64}\.json$/u.test(name)).length,
    generations, pointers, disposedPaths, recordsByPath: census.recordsByPath
  });
}

function registrationMigrationRecords(source: LegacyGeneratedStateRegistrationCensus,
  registration: GeneratedStateRegistration): readonly GeneratedStateRegistrationLedgerRecord[] {
  const historical = source.recordsByPath?.get(registration.relativePath);
  const records: GeneratedStateRegistrationLedgerRecord[] = [];
  for (const old of historical === undefined ? [] : [...historical].sort((left, right) => left.sequence - right.sequence)) {
    const value = parseGeneratedStateRegistration(JSON.parse(Buffer.from(old.registrationBytes, 'base64').toString('utf8')) as unknown);
    records.push(makeRegistrationLedgerRecord(value, records.at(-1)?.recordDigest ?? null, records.length + 1));
  }
  if (records.length === 0) records.push(makeRegistrationLedgerRecord(registration, null, 1));
  if (source.disposedPaths?.has(registration.relativePath)) {
    records.push(makeRegistrationLedgerRecord(registration, records.at(-1)!.recordDigest, records.length + 1, 'disposed'));
  }
  if (records.length > GENERATED_STATE_REGISTRATION_LEDGER_CAPACITY) {
    throw new GeneratedStateProducerBindingBlockedError('Migrated registration chain exceeds its bounded capacity.');
  }
  return Object.freeze(records);
}

function observeRegistrationMigrationPhysicalPreimage(
  store: GeneratedStateRuntimeStore,
  source: LegacyGeneratedStateRegistrationCensus
): `sha256:${string}` {
  const workspace = inspectNoFollowDirectoryChain(store.workspaceRoot, 'Registration migration workspace preimage').target;
  const roots = [...source.pointers.values()].map(({ registration }) => {
    if (!samePhysicalIdentity(registration.workspace, workspace)) {
      throw new GeneratedStateProducerBindingBlockedError('Registration migration workspace physical preimage is foreign.');
    }
    const observed = observeGeneratedStatePhysicalRoot(store.workspaceRoot, registration.relativePath);
    if (observed.kind !== 'missing' &&
        (observed.identity === null || !samePhysicalIdentity(observed.identity, registration.root))) {
      throw new GeneratedStateProducerBindingBlockedError('Registration migration root physical preimage is foreign.');
    }
    return Object.freeze({ relativePath: registration.relativePath, kind: observed.kind,
      identity: observed.identity, linkTarget: observed.linkTarget });
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return generatedStateDigest({ workspace: identityOf(workspace), roots });
}


const generatedStateMutationStores = new WeakSet<object>();

interface NativeRegistrationMutation {
  readonly store: GeneratedStateRuntimeStore;
  readonly lease: NonNullable<ReturnType<typeof acquirePhysicalMutationLease>>;
  readonly sources: WeakMap<object, LegacyGeneratedStateRegistrationCensus>;
  readonly plans: WeakMap<object, GeneratedStateMigrationPlan>;
  plan: GeneratedStateMigrationPlan | null;
  records: ReadonlyMap<string, GeneratedStateRegistrationLedgerRecord>;
}
const nativeRegistrationMutations = new WeakMap<object, NativeRegistrationMutation>();
const nativeRegistrationObservations = new WeakMap<object, Readonly<{ workspaceRoot: string;
  workspace: PhysicalDirectoryIdentity; store: GeneratedStateRuntimeStore | null;
  options: GeneratedStateRegistrationStoreOptions }>>();
const nativeObservationEvidence = new WeakMap<object, Readonly<{ resource: GeneratedStateNativeObservationResource;
  scope: import('../../../execution/generated-state/observation.ts').GeneratedStateObservationScope;
  factsDigest: `sha256:${string}` }>>();

function immutableObservationFacts<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutableObservationFacts(child);
    Object.freeze(value);
  }
  return value;
}
function nativeObservationFacts(resource: GeneratedStateNativeObservationResource, relativePath: string):
  import('../../../execution/generated-state/observation.ts').GeneratedStateObservationFacts {
  const state = nativeRegistrationObservations.get(resource);
  if (state === undefined || !samePhysicalIdentity(state.workspace,
      inspectNoFollowDirectoryChain(state.workspaceRoot, 'Observation evidence workspace readback').target)) {
    throw new GeneratedStateProducerBindingBlockedError('Observation evidence resource is foreign or physically stale.');
  }
  const store = retainedGeneratedStateObservationStore(resource);
  const physical = observeGeneratedStatePhysicalRoot(state.workspaceRoot, relativePath);
  const ledger = store === null ? { tip: null, registration: null, retiredPredecessor: null, previousRegistration: null } :
    readRegistrationLedgerObservation(store, relativePath);
  return immutableObservationFacts(structuredClone({ ledger, physical: { kind: physical.kind, identity: physical.identity } }));
}
/** Canonical native consumer verification, never a caller-provided predicate. */
export async function readVerifiedGeneratedStateObservationFacts(
  evidence: import('../../../execution/generated-state/observation.ts').GeneratedStateNativeObservationEvidence,
  expectedScope: Readonly<{ workspaceRoot: string; relativePath: string; expectedPhysical?: GeneratedStatePhysicalIdentity }>
): Promise<import('../../../execution/generated-state/observation.ts').GeneratedStateObservationFacts> {
  const original = nativeObservationEvidence.get(evidence);
  if (original === undefined || path.resolve(expectedScope.workspaceRoot) !== path.resolve(original.scope.workspaceRoot) ||
      normalizeGeneratedStateRelativePath(expectedScope.relativePath) !== original.scope.relativePath ||
      (expectedScope.expectedPhysical !== undefined && (original.scope.expected?.physical === undefined ||
        !samePhysicalIdentity(expectedScope.expectedPhysical, original.scope.expected.physical)))) {
    throw new GeneratedStateProducerBindingBlockedError('Observation evidence is forged or belongs to another exact scope.');
  }
  const facts = nativeObservationFacts(original.resource, original.scope.relativePath);
  if (generatedStateDigest(facts) !== original.factsDigest) throw new GeneratedStateProducerBindingBlockedError('Observation evidence ledger or physical facts changed.');
  await retainedGeneratedStateObservationStore(original.resource)?.assertCurrent();
  return facts;
}

function nativeRegistrationMutation(resource: GeneratedStateNativeMutationResource): NativeRegistrationMutation {
  const state = nativeRegistrationMutations.get(resource);
  if (state === undefined) throw new GeneratedStateProducerBindingBlockedError('Generated-state native mutation resource is foreign or settled.');
  assertPhysicalMutationLeaseOwned(state.lease);
  return state;
}

/** Adapter-internal retained resource lookup. It never adopts caller JSON. */
export function retainedGeneratedStateMutationStore(resource: GeneratedStateNativeMutationResource): GeneratedStateRuntimeStore {
  return nativeRegistrationMutation(resource).store;
}
export function retainedGeneratedStateObservationStore(resource: GeneratedStateNativeResource): GeneratedStateRuntimeStore | null {
  const observation = nativeRegistrationObservations.get(resource);
  return observation === undefined ? nativeRegistrationMutation(resource as GeneratedStateNativeMutationResource).store :
    observation.store ?? openRuntimeStoreReadOnly(observation.workspaceRoot, observation.options);
}

function readNativeRegistrationResponsibilities(store: GeneratedStateRuntimeStore, relativePath: string): GeneratedStateRegistrationResponsibilities {
  let cleanupIntent: GeneratedStateRegistrationResponsibilities['cleanupIntent'] = null;
  const normalized = normalizeGeneratedStateRelativePath(relativePath);
  for (const name of readdirSync(store.transactionsRoot)) {
    if (!/^current-[0-9a-f]{64}\.json$/u.test(name)) continue;
    const source = store.fs.readText(path.join(store.transactionsRoot, name));
    const candidate = JSON.parse(source) as { relativePath?: unknown };
    if (typeof candidate.relativePath !== 'string' || name !== `current-${registrationKey(candidate.relativePath)}.json`) {
      throw new GeneratedStateProducerBindingBlockedError('Cleanup responsibility pointer has a foreign path binding.');
    }
    const intent = parseGeneratedStateCleanupIntentBytes(source, candidate.relativePath);
    if (normalized === intent.relativePath || normalized.startsWith(`${intent.relativePath}/`) || intent.relativePath.startsWith(`${normalized}/`)) {
      if (cleanupIntent !== null) throw new GeneratedStateProducerBindingBlockedError('Registration intersects multiple cleanup responsibilities.');
      cleanupIntent = intent;
    }
  }
  const worktreePath = path.join(store.transactionsRoot, 'worktree-retirement-active.json');
  return Object.freeze({
    cleanupIntent,
    cleanupTombstoneState: cleanupIntent === null ? 'absent' : inspectExactNoFollowDirectoryPresence(path.join(store.workspaceRoot,
      '.tmp', 'generated-state-quarantine', cleanupIntent.tombstoneName), 'Registration cleanup tombstone terminal readback').state === 'absent' ? 'absent' : 'present',
    worktreeIntent: store.fs.exists(worktreePath) ? parseWorktreeRetirementIntent(JSON.parse(store.fs.readText(worktreePath))) : null
  });
}

export function createGeneratedStateRegistrationObservationBackend(): GeneratedStateRegistrationObservationBackend {
  return Object.freeze({
    captureObservationEvidence: (resource, scope) => {
      const state = nativeRegistrationObservations.get(resource);
      if (state === undefined || path.resolve(scope.workspaceRoot) !== state.workspaceRoot) throw new GeneratedStateProducerBindingBlockedError('Observation capture has a foreign original workspace resource.');
      const retainedScope = immutableObservationFacts(structuredClone({ ...scope, relativePath: normalizeGeneratedStateRelativePath(scope.relativePath) }));
      const facts = nativeObservationFacts(resource, retainedScope.relativePath);
      const evidence = Object.freeze({ kind: 'generated-state-native-observation-evidence' as const });
      nativeObservationEvidence.set(evidence, Object.freeze({ resource, scope: retainedScope, factsDigest: generatedStateDigest(facts) }));
      return Object.freeze({ evidence, facts });
    },
    openObservation: input => {
      const store = openRuntimeStoreReadOnly(input.workspaceRoot, input);
      const workspace = inspectNoFollowDirectoryChain(input.workspaceRoot, 'Read-only generated-state workspace').target;
      const resource = Object.freeze({ kind: 'generated-state-native-observation-resource' as const });
      nativeRegistrationObservations.set(resource, Object.freeze({ workspaceRoot: path.resolve(input.workspaceRoot), workspace,
        store, options: Object.freeze({ environment: input.environment === undefined ? undefined : Object.freeze({ ...input.environment }) }) })); return resource;
    },
    assertObservationCurrent: async resource => {
      const observation = nativeRegistrationObservations.get(resource);
      if (observation !== undefined && !samePhysicalIdentity(observation.workspace,
          inspectNoFollowDirectoryChain(observation.workspaceRoot, 'Read-only generated-state workspace readback').target)) {
        throw new GeneratedStateProducerBindingBlockedError('Read-only generated-state workspace identity changed.');
      }
      await retainedGeneratedStateObservationStore(resource)?.assertCurrent();
    },
    observePhysicalRoot: (resource, relativePath) => {
      const observation = nativeRegistrationObservations.get(resource);
      const workspaceRoot = observation?.workspaceRoot ?? nativeRegistrationMutation(resource as GeneratedStateNativeMutationResource).store.workspaceRoot;
      const physical = observeGeneratedStatePhysicalRoot(workspaceRoot, relativePath);
      return Object.freeze({ kind: physical.kind, identity: physical.identity });
    },
    readRegistrationObservation: (resource, relativePath) => {
      const store = retainedGeneratedStateObservationStore(resource);
      return store === null ? Object.freeze({ tip: null, registration: null, retiredPredecessor: null, previousRegistration: null }) :
        readRegistrationLedgerObservation(store, relativePath);
    },
    readRegistrationCensus: resource => {
      const store = retainedGeneratedStateObservationStore(resource);
      if (store === null) return Object.freeze({ recordsByPath: new Map(), observations: new Map() });
      if (inspectExactNoFollowDirectoryPresence(store.registrationsRoot, 'Registration observation current namespace').state === 'present') {
        return readRegistrationLedgerCensus(store);
      }
      if (inspectExactNoFollowDirectoryPresence(store.previousRegistrationsRoot, 'Registration observation previous namespace').state === 'present') {
        return readRegistrationLedgerCensus(Object.freeze({ ...store, registrationsRoot: store.previousRegistrationsRoot }), true);
      }
      const legacy = readLegacyRegistrationCensus(store);
      return Object.freeze({ recordsByPath: new Map(), observations: new Map([...(legacy?.pointers ?? [])].map(([relativePath, entry]) =>
        [relativePath, Object.freeze({ tip: null, registration: entry.registration, retiredPredecessor: null, previousRegistration: null })])) });
    }
  } satisfies GeneratedStateRegistrationObservationBackend);
}

function copyMigrationSource(source: LegacyGeneratedStateRegistrationCensus): LegacyGeneratedStateRegistrationCensus {
  return Object.freeze({ ...source, sourceRoot: Object.freeze({ ...source.sourceRoot }),
    generations: new Map([...source.generations].map(([key, entry]) => [key, Object.freeze({
      registration: entry.registration, bytes: Buffer.from(entry.bytes) })])),
    pointers: new Map([...source.pointers].map(([key, entry]) => [key, Object.freeze({
      registration: entry.registration, bytes: Buffer.from(entry.bytes) })])),
    disposedPaths: source.disposedPaths === undefined ? undefined : new Set(source.disposedPaths),
    recordsByPath: source.recordsByPath === undefined ? undefined : new Map([...source.recordsByPath]
      .map(([key, records]) => [key, Object.freeze([...records])])) });
}

function retainedMigrationPlan(state: NativeRegistrationMutation, plan: GeneratedStateMigrationPlan): GeneratedStateMigrationPlan {
  const original = state.plans.get(plan);
  if (original === undefined || original !== state.plan) throw new GeneratedStateProducerBindingBlockedError(
    'Generated-state migration plan is not bound to this native mutation resource.');
  return original;
}

function assertNativeMigrationSource(state: NativeRegistrationMutation, plan: GeneratedStateMigrationPlan): void {
  const source = readRegistrationMigrationSource(state.store);
  const original = plan.source;
  if (source === null || !samePhysicalIdentity(source.sourceRoot, original.sourceRoot) ||
      source.sourceInventoryDigest !== original.sourceInventoryDigest ||
      source.sourceEntryIdentityDigest !== original.sourceEntryIdentityDigest ||
      source.sourceGenerationCount !== original.sourceGenerationCount ||
      source.sourcePointerCount !== original.sourcePointerCount) {
    throw new GeneratedStateProducerBindingBlockedError('Legacy generated-state registration source changed during migration.');
  }
  if (observeRegistrationMigrationPhysicalPreimage(state.store, original) !== plan.prepared.physicalPreimageDigest) {
    throw new GeneratedStateProducerBindingBlockedError('Registration migration physical preimage changed before completion.');
  }
}

function assertNativeMigrationRecords(state: NativeRegistrationMutation, plan: GeneratedStateMigrationPlan,
  complete: boolean): void {
  const root = inspectNoFollowDirectoryChain(state.store.registrationsRoot, 'Migration target readback').target;
  const allowed = new Set([registrationMigrationIntentName(plan.prepared), registrationMigrationIntentName(plan.complete),
    ...plan.records.map(record => registrationLedgerName(record.relativePath, record.recordDigest))]);
  for (const name of readdirSync(root.path)) {
    if (!allowed.has(name) && !complete) throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state registration migration target contains unknown residue: ${name}.`);
  }
  for (const record of plan.records) {
    const name = registrationLedgerName(record.relativePath, record.recordDigest);
    const entry = inspectNoFollowOrdinaryFileEntry(root, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null || Buffer.from(entry.bytes).toString('utf8') !== canonicalBytes(record)) {
      throw new GeneratedStateProducerBindingBlockedError(`Generated-state migration record differs: ${name}.`);
    }
  }
  if (complete) readRegistrationLedgerCensus(state.store);
}

/** Native primitives retain the original lease, source census and exact plan.
 * They never choose a migration stage or silently continue an old operation. */
export function createGeneratedStateRegistrationMutationBackend(): GeneratedStateRegistrationMutationBackend {
  const publishIntent = (resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority,
    phase: 'prepared' | 'complete'): void => {
    const state = nativeRegistrationMutation(resource);
    const request = consumeGeneratedStatePublication(authority, resource);
    const plan = state.plan;
    const expected = phase === 'prepared' ? plan?.prepared : plan?.complete;
    const migrationRequest = request.kind === 'migration-prepared' || request.kind === 'migration-complete'
      ? request : null;
    if (plan === null || expected === undefined || migrationRequest === null ||
        migrationRequest.kind !== `migration-${phase}` ||
        canonicalBytes(migrationRequest.intent) !== canonicalBytes(expected)) throw new GeneratedStateProducerBindingBlockedError(
      'Migration publication does not bind the exact retained native plan.');
    const root = inspectNoFollowDirectoryChain(state.store.registrationsRoot, 'Migration publication root').target;
    if (phase === 'prepared') {
      const allowed = new Set([registrationMigrationIntentName(plan.prepared), registrationMigrationIntentName(plan.complete),
        ...plan.records.map(record => registrationLedgerName(record.relativePath, record.recordDigest))]);
      for (const name of readdirSync(root.path)) if (!allowed.has(name)) throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state registration migration target contains unknown residue: ${name}.`);
    } else {
      assertNativeMigrationSource(state, plan);
      assertNativeMigrationRecords(state, plan, false);
    }
    const name = registrationMigrationIntentName(expected);
    publishExactRegistrationMigrationFile(root, name, Buffer.from(canonicalBytes(expected)),
      candidate => parseRegistrationMigrationIntent(candidate, name));
  };
  return Object.freeze({
    acquireMutation: async input => {
      const store = await openRuntimeStore(input.workspaceRoot, input);
      const root = inspectNoFollowDirectoryChain(path.dirname(store.registrationsRoot), 'Registration mutation owner root').target;
      const coordinationResource = preparePhysicalMutationCoordinationResource(root,
        '.generated-state-registration-mutation.lock', path.basename(store.registrationsRoot));
      const lease = acquirePhysicalMutationLease(root, '.generated-state-registration-mutation.lock', { coordinationResource });
      if (lease === null) throw new GeneratedStateProducerBindingBlockedError('Generated-state registration mutation lease is unavailable; registration bytes are preserved.');
      try {
        await store.assertCurrent();
        ensurePhysicalMutationCoordinationNamespace(lease);
        await store.assertCurrent();
      } catch (error) {
        try { if (lease.recoveryPending) lease.restoreReclaimedOwner(); else await lease.release(); }
        catch (settlement) {
          throw new AggregateError([error, settlement], 'Registration acquisition and native lease settlement both failed.', { cause: error });
        }
        throw error;
      }
      const resource = Object.freeze({ kind: 'generated-state-native-mutation-resource' as const });
      nativeRegistrationMutations.set(resource, { store, lease, sources: new WeakMap(), plans: new WeakMap(), plan: null, records: new Map() });
      generatedStateMutationStores.add(store);
      return resource;
    },
    assertCurrent: async resource => { await nativeRegistrationMutation(resource).store.assertCurrent(); },
    acknowledgeRecovery: resource => {
      const state = nativeRegistrationMutation(resource);
      readRegistrationLedgerCensus(state.store);
      state.lease.acknowledgeReclaimedRecovery();
    },
    settleMutation: async resource => {
      const state = nativeRegistrationMutations.get(resource);
      if (state === undefined) throw new GeneratedStateProducerBindingBlockedError('Generated-state native mutation resource is foreign or settled.');
      try { if (state.lease.recoveryPending) state.lease.restoreReclaimedOwner(); else await state.lease.release(); }
      finally { generatedStateMutationStores.delete(state.store); nativeRegistrationMutations.delete(resource); }
    },
    readRegistrationCensus: resource => readRegistrationLedgerCensus(nativeRegistrationMutation(resource).store),
    readRegistrationResponsibilities: (resource, relativePath) => readNativeRegistrationResponsibilities(nativeRegistrationMutation(resource).store, relativePath),
    observeWorkspace: resource => identityOf(inspectNoFollowDirectoryChain(nativeRegistrationMutation(resource).store.workspaceRoot,
      'Generated-state workspace root').target),
    observeRoot: (resource, relativePath) => {
      const value = observeGeneratedStatePhysicalRoot(nativeRegistrationMutation(resource).store.workspaceRoot, relativePath);
      return Object.freeze({ kind: value.kind, identity: value.identity, linkTarget: value.linkTarget });
    },
    readMigrationSource: resource => {
      const state = nativeRegistrationMutation(resource);
      const source = readRegistrationMigrationSource(state.store);
      if (source === null) return null;
      const exposed = copyMigrationSource(source);
      state.sources.set(exposed, copyMigrationSource(source));
      return exposed;
    },
    readMigrationIntents: resource => readRegistrationMigrationIntents(inspectNoFollowDirectoryChain(
      nativeRegistrationMutation(resource).store.registrationsRoot, 'Migration intent observation').target),
    observeMigrationPhysicalPreimage: (resource, source) => {
      const state = nativeRegistrationMutation(resource);
      const original = state.sources.get(source);
      if (original === undefined) throw new GeneratedStateProducerBindingBlockedError('Migration source is foreign.');
      return observeRegistrationMigrationPhysicalPreimage(state.store, original);
    },
    describeMigration: (resource, source, physicalPreimageDigest) => {
      const state = nativeRegistrationMutation(resource);
      const original = state.sources.get(source);
      if (original === undefined) throw new GeneratedStateProducerBindingBlockedError('Migration source is foreign.');
      const intents = readRegistrationMigrationIntents(inspectNoFollowDirectoryChain(state.store.registrationsRoot,
        'Migration plan native observation').target);
      const completed = intents.find(intent => intent.phase === 'complete');
      const expectedPreimage = completed?.physicalPreimageDigest ?? observeRegistrationMigrationPhysicalPreimage(state.store, original);
      if (physicalPreimageDigest !== expectedPreimage) throw new GeneratedStateProducerBindingBlockedError('Migration physical preimage is not native-bound.');
      const records = Object.freeze([...original.pointers.values()].flatMap(({ registration }) => registrationMigrationRecords(original, registration)));
      const targets = Object.freeze([...original.pointers.values()].map(({ registration }) => Object.freeze({
        relativePath: registration.relativePath, registrationDigest: registrationMigrationRecords(original, registration)[0]!.registrationDigest
      })).sort((a, b) => a.relativePath.localeCompare(b.relativePath)));
      const material = registrationMigrationMaterial({ physicalPreimageDigest, sourceRoot: identityOf(original.sourceRoot),
        sourceInventoryDigest: original.sourceInventoryDigest, sourceGenerationCount: original.sourceGenerationCount,
        sourcePointerCount: original.sourcePointerCount, targets });
      const prepared = makeRegistrationMigrationIntent(material, 'prepared', null);
      const complete = makeRegistrationMigrationIntent(material, 'complete', prepared.intentDigest);
      const retained = Object.freeze({ source: original, prepared, complete, records });
      const exposed = Object.freeze({ ...retained, source: copyMigrationSource(original) });
      state.plan = retained; state.plans.set(exposed, retained);
      state.records = new Map(records.map(record => [record.recordDigest, record]));
      return exposed;
    },
    assertMigrationSourceUnchanged: (resource, plan) => {
      const state = nativeRegistrationMutation(resource); assertNativeMigrationSource(state, retainedMigrationPlan(state, plan));
    },
    assertMigrationTarget: (resource, plan) => {
      const state = nativeRegistrationMutation(resource); assertNativeMigrationRecords(state, retainedMigrationPlan(state, plan), true);
    },
    publishRegistration: (resource, authority) => {
      const state = nativeRegistrationMutation(resource);
      const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'registration') throw new GeneratedStateProducerBindingBlockedError('Foreign registration publication kind.');
      const current = readRegistrationLedgerObservation(state.store, request.registration.relativePath);
      assertGeneratedStateRegistrationResponsibilityAdmission(request, current,
        readNativeRegistrationResponsibilities(state.store, request.registration.relativePath));
      const workspace = inspectNoFollowDirectoryChain(state.store.workspaceRoot, 'Registration publication workspace').target;
      const physical = observeGeneratedStatePhysicalRoot(state.store.workspaceRoot, request.registration.relativePath);
      assertGeneratedStateRegistrationTransitionAdmission(request, current, workspace, physical);
      persistRegistration(state.store, request.registration, request.previousRecordDigest, request.event);
    },
    publishMigrationPrepared: (resource, authority) => publishIntent(resource, authority, 'prepared'),
    publishMigrationComplete: (resource, authority) => publishIntent(resource, authority, 'complete'),
    publishMigrationEvent: (resource, authority) => {
      const state = nativeRegistrationMutation(resource);
      const request = consumeGeneratedStatePublication(authority, resource);
      if (request.kind !== 'migration-event' || state.plan === null) throw new GeneratedStateProducerBindingBlockedError('Foreign migration event publication.');
      const expected = state.records.get(request.record.recordDigest);
      if (expected === undefined || canonicalBytes(request.record) !== canonicalBytes(expected)) throw new GeneratedStateProducerBindingBlockedError('Migration event is outside the retained native plan.');
      const root = inspectNoFollowDirectoryChain(state.store.registrationsRoot, 'Migration event publication root').target;
      const preparedName = registrationMigrationIntentName(state.plan.prepared);
      const prepared = inspectNoFollowOrdinaryFileEntry(root, preparedName);
      if (prepared === null || prepared.kind !== 'file' || prepared.bytes === null || Buffer.from(prepared.bytes).toString('utf8') !== canonicalBytes(state.plan.prepared)) throw new GeneratedStateProducerBindingBlockedError('Migration event requires exact prepared publication.');
      if (expected.previousRecordDigest !== null) {
        const previous = state.records.get(expected.previousRecordDigest);
        const entry = previous === undefined ? null : inspectNoFollowOrdinaryFileEntry(root,
          registrationLedgerName(previous.relativePath, previous.recordDigest));
        if (previous === undefined || entry === null || entry.kind !== 'file' || entry.bytes === null || Buffer.from(entry.bytes).toString('utf8') !== canonicalBytes(previous)) throw new GeneratedStateProducerBindingBlockedError('Migration event predecessor is absent or foreign.');
      }
      const name = registrationLedgerName(expected.relativePath, expected.recordDigest);
      publishExactRegistrationMigrationFile(root, name, Buffer.from(canonicalBytes(expected)), candidate => parseRegistrationLedgerRecord(candidate, name));
    }
  } satisfies GeneratedStateRegistrationMutationBackend);
}
