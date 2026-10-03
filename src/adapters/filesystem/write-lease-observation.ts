import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, sha256 } from '../../contracts/canonical.ts';
import { resolveWorkspaceLocalStateRoot } from '../../workspace/contract/local-state.ts';
import { isSemanticMutationStagingWorkspace } from '../../workspace/contract/semantic-mutation-staging.ts';
import { inspectNoFollowDirectoryChain } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../runtime-state/physical/runtime/process.ts';
import { GENERATION_WIDTH, HEARTBEAT_FILE, HOLDERS_DIRECTORY, LEASE_DIRECTORY, LEGACY_OWNER_FILE, OWNER_FILE, OWNER_GENERATION_PATTERN, PROTOCOL_CANDIDATE_PATTERN, PROTOCOL_FILE, TERMINAL_CANDIDATE_PATTERN, TERMINAL_GENERATION_PATTERN, WORKSPACE_WRITE_LEASE_INSPECTION_VERSION, WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION, type WorkspaceWriteLeaseAcquireOptions, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseGenerationState, type WorkspaceWriteLeaseHeartbeat, type WorkspaceWriteLeaseInspection, type WorkspaceWriteLeaseInventory, type WorkspaceWriteLeaseOwner, type WorkspaceWriteLeasePaths, type WorkspaceWriteLeaseTerminal, type WorkspaceWriteLeaseToken, exactKeys, heartbeatLooksValid, isMissingError, ownerLooksValid, positiveSafeInteger, sameToken, systemErrorCode, terminalLooksValid, tokenFromOwner } from './write-lease-contract.ts';

/** Read-only lease ledger and physical-identity observations. No recovery decision
 * or destructive effect is issued here; the canonical manager consumes these facts. */

type WorkspaceIdentityFailureReason = 'missing' | 'inaccessible' | 'not-directory' | 'unknown';

export function workspaceIdentityFailureReason(error: unknown): WorkspaceIdentityFailureReason {
  if (error instanceof WorkspaceWriteLeaseError &&
    (error.details.reason === 'not-directory' || error.details.reason === 'missing' || error.details.reason === 'inaccessible' || error.details.reason === 'unknown')) {
    return error.details.reason;
  }
  const code = systemErrorCode(error);
  if (code === 'PHYSICAL_NO_FOLLOW_ABSENT') return 'missing';
  switch (code) {
    case 'ENOENT':
      return 'missing';
    case 'EACCES':
    case 'EPERM':
      return 'inaccessible';
    case 'ENOTDIR':
      return 'not-directory';
    default:
      return 'unknown';
  }
}

function assertWorkspaceIdentityBoundary(
  workspaceRoot: string,
  executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): void {
  if (executionBoundary === undefined) return;
  if (executionBoundary !== 'windows-appcontainer' || process.platform !== 'win32' ||
    process.env[ISOLATED_VERIFICATION_ENV_KEY] !== '1' ||
    !isSemanticMutationStagingWorkspace(workspaceRoot)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace lexical identity boundary is invalid'
    );
  }
}

export async function workspaceIdentity(
  workspaceRoot: string,
  executionBoundary?: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<string> {
  assertWorkspaceIdentityBoundary(workspaceRoot, executionBoundary);
  if (executionBoundary === 'windows-appcontainer') {
    const resolved = path.resolve(workspaceRoot);
    const stat = await fs.lstat(resolved, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace lexical identity is not a real directory',
        { reason: 'not-directory' }
      );
    }
    return sha256({
      domain: 'workspace-write-lease-appcontainer-lexical-identity-v1',
      resolved,
      dev: String(stat.dev),
      ino: String(stat.ino),
      mode: String(stat.mode)
    });
  }
  if (process.platform === 'darwin') {
    // macOS ordinary writers still need the canonical lease protocol even
    // though #186 destructive no-follow effects deliberately have no macOS
    // backend.  Scope this fallback to the non-destructive lease resource:
    // reject links and bind the directory's native dev/inode, leaving physical
    // closeout to fail closed instead of silently reusing this identity.
    const resolved = path.resolve(workspaceRoot);
    let metadata;
    try { metadata = await fs.lstat(resolved, { bigint: true }); } catch (error) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace lexical identity cannot be inspected on macOS', {
        reason: workspaceIdentityFailureReason(error),
        systemCode: systemErrorCode(error) ?? 'UNKNOWN'
      });
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace lexical identity is not a real macOS directory', { reason: 'not-directory' });
    }
    return sha256({
      domain: 'workspace-write-lease-macos-directory-identity-v1',
      dev: String(metadata.dev),
      ino: String(metadata.ino)
    });
  }
  // The resource is the physical directory object, not its spelling.  This
  // permits an authorized retained-handle rename to move an active closeout
  // workspace while ensuring aliases and the post-rename location compete for
  // exactly the same lease token resource.
  try {
    return physicalWorkspaceIdentityDigest(
      inspectNoFollowDirectoryChain(path.resolve(workspaceRoot), 'Workspace lease physical identity').target
    );
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace physical identity cannot be proven', {
      reason: workspaceIdentityFailureReason(error),
      systemCode: systemErrorCode(error) ?? 'UNKNOWN'
    });
  }
}

export async function assertLeaseParent(
  workspaceRoot: string,
  parent: string,
  executionBoundary?: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<void> {
  assertWorkspaceIdentityBoundary(workspaceRoot, executionBoundary);
  if (executionBoundary === 'windows-appcontainer') {
    const resolvedWorkspace = path.resolve(workspaceRoot);
    const resolvedParent = path.resolve(parent);
    const expectedParent = resolveWorkspaceLocalStateRoot(resolvedWorkspace);
    const [workspaceMetadata, parentMetadata] = await Promise.all([
      fs.lstat(resolvedWorkspace),
      fs.lstat(resolvedParent)
    ]);
    if (resolvedParent !== expectedParent ||
      !workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink() ||
      !parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease parent is not a lexical real directory inside the AppContainer workspace'
      );
    }
    return;
  }
  const [canonicalWorkspace, parentMetadata, canonicalParent] = await Promise.all([
    fs.realpath(workspaceRoot),
    fs.lstat(parent),
    fs.realpath(parent)
  ]);
  const relative = path.relative(canonicalWorkspace, canonicalParent);
  const escapesWorkspace = relative === '..' || relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || escapesWorkspace) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease parent is not a real directory inside the workspace'
    );
  }
}

export async function assertProtocolDirectory(
  parent: string,
  root: string,
  holders: string,
  executionBoundary?: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<void> {
  const [rootMetadata, holdersMetadata] = await Promise.all([
    fs.lstat(root),
    fs.lstat(holders)
  ]);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() ||
    !holdersMetadata.isDirectory() || holdersMetadata.isSymbolicLink()) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root is not canonical'
    );
  }
  if (executionBoundary === 'windows-appcontainer') {
    if (path.resolve(root) !== path.join(path.resolve(parent), LEASE_DIRECTORY) ||
      path.resolve(holders) !== path.join(path.resolve(root), HOLDERS_DIRECTORY)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol root escaped its lexical parent'
      );
    }
    return;
  }
  const [canonicalParent, canonicalRoot, canonicalHolders] = await Promise.all([
    fs.realpath(parent),
    fs.realpath(root),
    fs.realpath(holders)
  ]);
  if (canonicalRoot !== path.join(canonicalParent, LEASE_DIRECTORY) ||
    canonicalHolders !== path.join(canonicalRoot, HOLDERS_DIRECTORY)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root escaped its canonical parent'
    );
  }
}

export function ownerFileIdentity(metadata: { readonly dev: bigint | number; readonly ino: bigint | number }): string {
  return sha256({
    domain: 'workspace-write-lease-owner-file-identity-v2',
    dev: String(metadata.dev),
    ino: String(metadata.ino)
  });
}

export function sameFileIdentity(
  left: { readonly dev: bigint | number; readonly ino: bigint | number },
  right: { readonly dev: bigint | number; readonly ino: bigint | number }
): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

async function readJsonValue(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease record cannot be proven'
    );
  }
}

async function readOwner(filePath: string): Promise<WorkspaceWriteLeaseOwner> {
  const value = await readJsonValue(filePath);
  if (!ownerLooksValid(value)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease owner record is invalid'
    );
  }
  return value;
}

async function readHeartbeat(filePath: string): Promise<WorkspaceWriteLeaseHeartbeat> {
  const value = await readJsonValue(filePath);
  if (!heartbeatLooksValid(value)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease heartbeat record is invalid'
    );
  }
  return value;
}

export async function readOptionalTerminal(filePath: string): Promise<WorkspaceWriteLeaseTerminal | null> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (isMissingError(error)) return null;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease terminal record cannot be proven'
    );
  }
  if (!terminalLooksValid(value)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease terminal record is invalid'
    );
  }
  return value;
}

function generationStem(generation: number): string {
  if (!positiveSafeInteger(generation)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease generation is invalid'
    );
  }
  const stem = String(generation).padStart(GENERATION_WIDTH, '0');
  if (stem.length !== GENERATION_WIDTH) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease generation space is exhausted'
    );
  }
  return stem;
}

export function generationOwnerPath(root: string, generation: number): string {
  return path.join(root, `${generationStem(generation)}.owner.json`);
}

export function generationTerminalPath(root: string, generation: number): string {
  return path.join(root, `${generationStem(generation)}.terminal.json`);
}

export function holderDirectory(holders: string, token: Pick<WorkspaceWriteLeaseToken, 'generation' | 'leaseId'>): string {
  const digestHex = digest(JSON.stringify({
    domain: 'workspace-write-lease-holder-v2',
    generation: token.generation,
    leaseId: token.leaseId
  }));
  return path.join(holders, `${generationStem(token.generation)}-${digestHex}`);
}

export function workspaceWriteLeasePathsFor(workspaceRoot: string): WorkspaceWriteLeasePaths {
  const parent = resolveWorkspaceLocalStateRoot(workspaceRoot);
  const root = path.join(parent, LEASE_DIRECTORY);
  return { parent, root, holders: path.join(root, HOLDERS_DIRECTORY) };
}

export function physicalWorkspaceIdentityDigest(workspace: Pick<import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity, 'device' | 'inode'>): string {
  return sha256({
    domain: 'workspace-write-lease-physical-directory-identity-v2',
    dev: workspace.device,
    ino: workspace.inode
  });
}

export async function assertNoLegacyOwner(root: string): Promise<void> {
  try {
    await fs.lstat(path.join(root, LEGACY_OWNER_FILE));
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Legacy workspace writer lease requires proven quiescence before migration',
      { reason: 'legacy-v1-owner' }
    );
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    if (!isMissingError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Legacy workspace writer lease state could not be classified'
      );
    }
  }
}

export async function assertProtocolMarker(protocolPath: string): Promise<void> {
  const existing = await readJsonValue(protocolPath);
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing) ||
    !exactKeys(existing, ['formatVersion']) ||
    (existing as Record<string, unknown>).formatVersion !== WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker is invalid'
    );
  }
}

export async function readProtocolMarkerMetadata(protocolPath: string) {
  await assertProtocolMarker(protocolPath);
  try {
    const metadata = await fs.lstat(protocolPath, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol marker is noncanonical'
      );
    }
    return metadata;
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol marker could not be inspected'
    );
  }
}

async function sameIdentityEntries(
  directory: string,
  targetMetadata: { readonly dev: bigint | number; readonly ino: bigint | number }
): Promise<readonly Readonly<{
  name: string;
  path: string;
  metadata: Awaited<ReturnType<typeof fs.lstat>>;
}>[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol aliases could not be enumerated'
    );
  }
  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    try {
      const metadata = await fs.lstat(entryPath, { bigint: true });
      if (sameFileIdentity(metadata, targetMetadata)) {
        matches.push(Object.freeze({ name: entry.name, path: entryPath, metadata }));
      }
    } catch (error) {
      if (isMissingError(error)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease protocol alias topology changed during inspection'
        );
      }
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease protocol alias could not be inspected'
      );
    }
  }
  return Object.freeze(matches);
}

export async function inspectProtocolMarkerAlias(
  paths: WorkspaceWriteLeasePaths,
  protocolPath: string
): Promise<Readonly<{
  marker: Awaited<ReturnType<typeof readProtocolMarkerMetadata>>;
  alias: Awaited<ReturnType<typeof sameIdentityEntries>>[number] | null;
}>> {
  const initialMarker = await readProtocolMarkerMetadata(protocolPath);
  if (initialMarker.nlink === 1n) {
    return Object.freeze({ marker: initialMarker, alias: null });
  }
  if (initialMarker.nlink !== 2n) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker link topology is not recoverable'
    );
  }

  const initialAliases = await sameIdentityEntries(paths.holders, initialMarker);
  if (initialAliases.length !== 1) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker alias is not uniquely recoverable'
    );
  }
  const [initialAlias] = initialAliases;
  if (!initialAlias || !PROTOCOL_CANDIDATE_PATTERN.test(initialAlias.name) ||
    !initialAlias.metadata.isFile() || initialAlias.metadata.isSymbolicLink() ||
    initialAlias.metadata.nlink !== 2n) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker alias is noncanonical'
    );
  }
  return Object.freeze({ marker: initialMarker, alias: initialAlias });
}

export async function verifyProtocolRoot(
  paths: WorkspaceWriteLeasePaths,
  executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<void> {
  await assertProtocolDirectory(paths.parent, paths.root, paths.holders, executionBoundary);
  await assertNoLegacyOwner(paths.root);
  await assertProtocolMarker(path.join(paths.root, PROTOCOL_FILE));
}

function generationFromMatch(match: RegExpMatchArray): number {
  const generation = Number(match[1]);
  if (!positiveSafeInteger(generation) || generationStem(generation) !== match[1]) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease generation record is noncanonical'
    );
  }
  return generation;
}

export async function readInventory(root: string): Promise<WorkspaceWriteLeaseInventory> {
  const ownerGenerations: number[] = [];
  const terminalGenerations = new Set<number>();
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === PROTOCOL_FILE) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease protocol marker is noncanonical'
        );
      }
      continue;
    }
    if (entry.name === HOLDERS_DIRECTORY) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease holder root is noncanonical'
        );
      }
      continue;
    }
    const ownerMatch = entry.name.match(OWNER_GENERATION_PATTERN);
    if (ownerMatch) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease owner generation is noncanonical'
        );
      }
      ownerGenerations.push(generationFromMatch(ownerMatch));
      continue;
    }
    const terminalMatch = entry.name.match(TERMINAL_GENERATION_PATTERN);
    if (terminalMatch) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease terminal generation is noncanonical'
        );
      }
      terminalGenerations.add(generationFromMatch(terminalMatch));
      continue;
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root contains an unknown record'
    );
  }
  ownerGenerations.sort((left, right) => left - right);
  if (new Set(ownerGenerations).size !== ownerGenerations.length ||
    [...terminalGenerations].some((generation) => !ownerGenerations.includes(generation))) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease generation ledger is inconsistent'
    );
  }
  return Object.freeze({
    ownerGenerations: Object.freeze(ownerGenerations),
    terminalGenerations,
    highestGeneration: ownerGenerations.at(-1)
  });
}

export async function readGenerationState(
  root: string,
  generation: number
): Promise<WorkspaceWriteLeaseGenerationState> {
  const ownerPath = generationOwnerPath(root, generation);
  const [owner, ownerMetadata, terminal] = await Promise.all([
    readOwner(ownerPath),
    fs.lstat(ownerPath, { bigint: true }),
    readOptionalTerminal(generationTerminalPath(root, generation))
  ]);
  if (!ownerMetadata.isFile() || ownerMetadata.isSymbolicLink()) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease owner generation is not a regular file'
    );
  }
  const identity = ownerFileIdentity(ownerMetadata);
  const token = tokenFromOwner(owner);
  if (owner.generation !== generation || owner.ownerFileIdentityDigest !== identity ||
    (terminal && !sameToken(terminal.token, token))) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease generation identity is inconsistent'
    );
  }
  return Object.freeze({
    owner,
    ownerFileIdentityDigest: identity,
    ownerLinkCount: Number(ownerMetadata.nlink),
    terminal
  });
}

export async function readBoundHeartbeat(
  paths: WorkspaceWriteLeasePaths,
  state: WorkspaceWriteLeaseGenerationState
): Promise<WorkspaceWriteLeaseHeartbeat> {
  const token = tokenFromOwner(state.owner);
  const holder = holderDirectory(paths.holders, token);
  const holderOwnerPath = path.join(holder, OWNER_FILE);
  const [holderMetadata, holderOwner, holderOwnerMetadata, heartbeat] = await Promise.all([
    fs.lstat(holder),
    readOwner(holderOwnerPath),
    fs.lstat(holderOwnerPath, { bigint: true }),
    readHeartbeat(path.join(holder, HEARTBEAT_FILE))
  ]);
  if (!holderMetadata.isDirectory() || holderMetadata.isSymbolicLink() ||
    !holderOwnerMetadata.isFile() || holderOwnerMetadata.isSymbolicLink() ||
    ownerFileIdentity(holderOwnerMetadata) !== state.ownerFileIdentityDigest ||
    !sameToken(tokenFromOwner(holderOwner), token) ||
    !sameToken(heartbeat.token, token) ||
    heartbeat.heartbeatAtMs < state.owner.createdAtMs) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease holder state is inconsistent'
    );
  }
  return heartbeat;
}

export async function readBoundHeartbeatUnlessTerminalized(
  paths: WorkspaceWriteLeasePaths,
  state: WorkspaceWriteLeaseGenerationState
): Promise<WorkspaceWriteLeaseHeartbeat | null> {
  try {
    return await readBoundHeartbeat(paths, state);
  } catch (error) {
    const inventory = await readInventory(paths.root);
    if (inventory.terminalGenerations.has(state.owner.generation)) return null;
    throw error;
  }
}

export async function inspectWorkspaceWriteLease(
  workspaceRoot: string
): Promise<WorkspaceWriteLeaseInspection> {
  const workspaceIdentityDigest = await workspaceIdentity(workspaceRoot);
  const paths = workspaceWriteLeasePathsFor(workspaceRoot);
  await assertLeaseParent(workspaceRoot, paths.parent);
  await verifyProtocolRoot(paths, undefined);
  const protocolPath = path.join(paths.root, PROTOCOL_FILE);
  const protocol = await inspectProtocolMarkerAlias(paths, protocolPath);
  const inventory = await readInventory(paths.root);
  const authorityPaths = new Set<string>([paths.root, paths.holders, protocolPath]);
  if (protocol.alias !== null) authorityPaths.add(protocol.alias.path);
  const generationSummaries: Array<Readonly<Record<string, unknown>>> = [];
  let activeGeneration: number | null = null;

  for (const generation of inventory.ownerGenerations) {
    const state = await readGenerationState(paths.root, generation);
    if (state.owner.workspaceIdentityDigest !== workspaceIdentityDigest) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease generation targets a different workspace'
      );
    }
    const ownerPath = generationOwnerPath(paths.root, generation);
    authorityPaths.add(ownerPath);
    let heartbeat: WorkspaceWriteLeaseHeartbeat | null = null;
    if (state.terminal === null) {
      if (generation !== inventory.highestGeneration || activeGeneration !== null ||
        state.ownerLinkCount !== 2) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease active generation topology is inconsistent'
        );
      }
      activeGeneration = generation;
      heartbeat = await readBoundHeartbeat(paths, state);
    } else if (state.ownerLinkCount === 2) {
      heartbeat = await readBoundHeartbeat(paths, state);
    } else if (state.ownerLinkCount !== 1) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease terminalized owner topology is inconsistent'
      );
    }

    if (state.ownerLinkCount === 2) {
      const holder = holderDirectory(paths.holders, tokenFromOwner(state.owner));
      authorityPaths.add(holder);
      authorityPaths.add(path.join(holder, OWNER_FILE));
      authorityPaths.add(path.join(holder, HEARTBEAT_FILE));
    }

    let terminalLinkCount: number | null = null;
    let terminalAlias: string | null = null;
    if (state.terminal !== null) {
      const terminalPath = generationTerminalPath(paths.root, generation);
      authorityPaths.add(terminalPath);
      const terminalMetadata = await fs.lstat(terminalPath, { bigint: true });
      if (!terminalMetadata.isFile() || terminalMetadata.isSymbolicLink() ||
        (terminalMetadata.nlink !== 1n && terminalMetadata.nlink !== 2n)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease terminal publication topology is inconsistent'
        );
      }
      terminalLinkCount = Number(terminalMetadata.nlink);
      if (terminalMetadata.nlink === 2n) {
        const aliases = await sameIdentityEntries(paths.holders, terminalMetadata);
        if (aliases.length !== 1 || !aliases[0] ||
          !TERMINAL_CANDIDATE_PATTERN.test(aliases[0].name) ||
          !aliases[0].metadata.isFile() || aliases[0].metadata.isSymbolicLink() ||
          aliases[0].metadata.nlink !== 2n) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-003',
            'Workspace writer lease terminal publication alias is not canonical'
          );
        }
        terminalAlias = aliases[0].name;
        authorityPaths.add(aliases[0].path);
      }
    }

    generationSummaries.push(Object.freeze({
      generation,
      owner: state.owner,
      ownerLinkCount: state.ownerLinkCount,
      heartbeat,
      terminal: state.terminal,
      terminalLinkCount,
      terminalAlias
    }));
  }

  const terminalGenerations = Object.freeze([...inventory.terminalGenerations].sort(
    (left, right) => left - right
  ));
  const sortedAuthorityPaths = Object.freeze([...authorityPaths].sort());
  const stateDigest = sha256({
    domain: WORKSPACE_WRITE_LEASE_INSPECTION_VERSION,
    workspaceIdentityDigest,
    protocol: {
      identity: ownerFileIdentity(protocol.marker),
      linkCount: Number(protocol.marker.nlink),
      alias: protocol.alias?.name ?? null
    },
    generations: generationSummaries
  });
  return Object.freeze({
    formatVersion: WORKSPACE_WRITE_LEASE_INSPECTION_VERSION,
    protocolRoot: paths.root,
    state: activeGeneration === null ? 'quiescent' : 'active',
    activeGeneration,
    ownerGenerations: inventory.ownerGenerations,
    terminalGenerations,
    authorityPaths: sortedAuthorityPaths,
    stateDigest
  });
}
