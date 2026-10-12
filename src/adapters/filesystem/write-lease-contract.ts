import { canonicalEquals } from '../../contracts/canonical.ts';

/** The existing V3 lease byte contract and validation only. No live authority,
 * filesystem mutation or manager instance is created by importing this module. */

export const WORKSPACE_WRITE_LEASE_TOKEN_VERSION = 'workspace-write-lease-token-v3' as const;

export const WORKSPACE_WRITE_LEASE_INSPECTION_VERSION =
  'workspace-write-lease-inspection-v1' as const;

export const WORKSPACE_WRITE_LEASE_DIRECTORY_NAME = 'workspace-write-lease' as const;

export const WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION = 'workspace-write-lease-protocol-v3' as const;

export const WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION = 'workspace-write-lease-heartbeat-v3' as const;

export const WORKSPACE_WRITE_LEASE_TERMINAL_VERSION = 'workspace-write-lease-terminal-v3' as const;

export const LEASE_DIRECTORY = WORKSPACE_WRITE_LEASE_DIRECTORY_NAME;

export const PROTOCOL_FILE = 'protocol.json';

export const HOLDERS_DIRECTORY = 'holders';

export const LEGACY_OWNER_FILE = 'owner.json';

export const OWNER_FILE = 'owner.json';

export const HEARTBEAT_FILE = 'heartbeat.json';

export const GENERATION_WIDTH = 16;

export const PROTOCOL_CANDIDATE_PATTERN = /^\.protocol-[0-9a-f]{64}\.candidate$/u;

export const TERMINAL_CANDIDATE_PATTERN = /^\.terminal-[0-9a-f]{64}\.candidate$/u;

export const OWNER_GENERATION_PATTERN = /^([0-9]{16})\.owner\.json$/u;

export const TERMINAL_GENERATION_PATTERN = /^([0-9]{16})\.terminal\.json$/u;

export type WorkspaceWriteLeaseErrorCode =
  | 'WORKSPACE-WRITE-LEASE-001'
  | 'WORKSPACE-WRITE-LEASE-002'
  | 'WORKSPACE-WRITE-LEASE-003'
  | 'WORKSPACE-WRITE-LEASE-004';

export class WorkspaceWriteLeaseError extends Error {
  readonly code: WorkspaceWriteLeaseErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: WorkspaceWriteLeaseErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean>> = {}
  ) {
    super(message);
    this.name = 'WorkspaceWriteLeaseError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface WorkspaceWriteLeaseToken {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_TOKEN_VERSION;
  readonly workspaceIdentityDigest: string;
  readonly generation: number;
  readonly ownerFileIdentityDigest: string;
  readonly hostname: string;
  readonly pid: number;
  readonly processNonce: string;
  readonly leaseId: string;
}

export interface WorkspaceWriteLeaseOwner extends WorkspaceWriteLeaseToken {
  readonly createdAtMs: number;
}

export interface WorkspaceWriteLeaseHeartbeat {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION;
  readonly token: WorkspaceWriteLeaseToken;
  readonly heartbeatAtMs: number;
}

export interface WorkspaceWriteLeaseTerminal {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_TERMINAL_VERSION;
  readonly token: WorkspaceWriteLeaseToken;
  readonly outcome: 'released' | 'recovered';
  readonly terminalAtMs: number;
}

export interface WorkspaceWriteLeasePaths {
  readonly parent: string;
  readonly root: string;
  readonly holders: string;
}

export interface WorkspaceWriteLeaseInventory {
  readonly ownerGenerations: readonly number[];
  readonly terminalGenerations: ReadonlySet<number>;
  readonly highestGeneration: number | undefined;
}

export interface WorkspaceWriteLeaseGenerationState {
  readonly owner: WorkspaceWriteLeaseOwner;
  readonly ownerFileIdentityDigest: string;
  readonly ownerLinkCount: number;
  readonly terminal: WorkspaceWriteLeaseTerminal | null;
}

export interface WorkspaceWriteLeaseInspection {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_INSPECTION_VERSION;
  readonly protocolRoot: string;
  readonly state: 'active' | 'quiescent';
  readonly activeGeneration: number | null;
  readonly ownerGenerations: readonly number[];
  readonly terminalGenerations: readonly number[];
  readonly authorityPaths: readonly string[];
  readonly stateDigest: string;
}

export interface WorkspaceWriteLeaseHandle {
  readonly token: WorkspaceWriteLeaseToken;
  heartbeat(): Promise<void>;
  assertOwned(): Promise<void>;
  /**
   * Closeout-only retained-identity relocation.  The caller performs the
   * same-parent rename through its physical handle authority first; this
   * method proves the new lexical root is the token's same directory object
   * before moving subsequent heartbeat/assert/release operations there.
   */
  relocate(nextWorkspaceRoot: string): Promise<void>;
  /** Exact active mutable subtree; valid only after `assertOwned()`. */
  ownedNamespace(): Promise<Readonly<{ workspaceRoot: string; relativePath: '.sec/workspace-write-lease' }>>;
  retireOwnedNamespace(intentDigest: string, proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity): Promise<WorkspaceWriteLeaseRetirementReceipt>;
  release(): Promise<void>;
}

export interface WorkspaceWriteLeaseRetirementReceipt {
  readonly formatVersion: 'workspace-write-lease-retirement-receipt-v1';
  readonly workspaceIdentityDigest: string;
  readonly workspaceDevice: string;
  readonly workspaceInode: string;
  readonly intentDigest: string;
  readonly tokenGeneration: number;
  readonly ownerFileIdentityDigest: string;
  readonly terminalDigest: string;
  readonly transitionDigest: string;
  readonly namespaceDevice: string;
  readonly namespaceInode: string;
  readonly namespaceTombstoneName: string;
  readonly fenceName: string;
  readonly retirementDigest: string;
}

export interface WorkspaceWriteLeaseManager {
  acquire(
    workspaceRoot: string,
    options?: WorkspaceWriteLeaseAcquireOptions
  ): Promise<WorkspaceWriteLeaseHandle>;
  assertOwned(workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void>;
  release(workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void>;
  withControlPlaneQuiesced<Value>(
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken,
    execute: () => Promise<Value>
  ): Promise<Value>;
  withLease<Value>(
    workspaceRoot: string,
    reentrantToken: WorkspaceWriteLeaseToken | undefined,
    execute: (token: WorkspaceWriteLeaseToken) => Promise<Value>,
    options?: WorkspaceWriteLeaseAcquireOptions
  ): Promise<Value>;
}

export interface WorkspaceWriteLeaseAcquireOptions {
  readonly executionBoundary?: 'windows-appcontainer';
}

export interface WorkspaceWriteLeaseManagerOptions {
  readonly heartbeatIntervalMs?: number;
  readonly staleAfterMs?: number;
  readonly hostname?: string;
  readonly pid?: number;
  readonly processNonce?: string;
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly processAlive?: (pid: number) => 'alive' | 'dead' | 'unknown';
  /** Internal deterministic fault seam for the owner-publication directory sync only. */
  readonly ownerPublicationDirectorySync?: (directory: string) => Promise<void>;
}

export function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function positiveSafeInteger(value: unknown): value is number {
  return safeInteger(value) && value > 0;
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

export function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return canonicalEquals(actual, expected);
}

export function tokenLooksValid(value: unknown): value is WorkspaceWriteLeaseToken {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, [
    'formatVersion',
    'workspaceIdentityDigest',
    'generation',
    'ownerFileIdentityDigest',
    'hostname',
    'pid',
    'processNonce',
    'leaseId'
  ])) return false;
  const token = value as Record<string, unknown>;
  return token.formatVersion === WORKSPACE_WRITE_LEASE_TOKEN_VERSION &&
    nonEmpty(token.workspaceIdentityDigest) && positiveSafeInteger(token.generation) &&
    nonEmpty(token.ownerFileIdentityDigest) && nonEmpty(token.hostname) &&
    safeInteger(token.pid) && nonEmpty(token.processNonce) && nonEmpty(token.leaseId);
}

export function ownerLooksValid(value: unknown): value is WorkspaceWriteLeaseOwner {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, [
    'formatVersion',
    'workspaceIdentityDigest',
    'generation',
    'ownerFileIdentityDigest',
    'hostname',
    'pid',
    'processNonce',
    'leaseId',
    'createdAtMs'
  ])) return false;
  const owner = value as Record<string, unknown>;
  return tokenLooksValid({
    formatVersion: owner.formatVersion,
    workspaceIdentityDigest: owner.workspaceIdentityDigest,
    generation: owner.generation,
    ownerFileIdentityDigest: owner.ownerFileIdentityDigest,
    hostname: owner.hostname,
    pid: owner.pid,
    processNonce: owner.processNonce,
    leaseId: owner.leaseId
  }) && safeInteger(owner.createdAtMs);
}

export function heartbeatLooksValid(value: unknown): value is WorkspaceWriteLeaseHeartbeat {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
    !exactKeys(value, ['formatVersion', 'token', 'heartbeatAtMs'])) return false;
  const heartbeat = value as Record<string, unknown>;
  return heartbeat.formatVersion === WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION &&
    tokenLooksValid(heartbeat.token) && safeInteger(heartbeat.heartbeatAtMs);
}

export function terminalLooksValid(value: unknown): value is WorkspaceWriteLeaseTerminal {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
    !exactKeys(value, ['formatVersion', 'token', 'outcome', 'terminalAtMs'])) return false;
  const terminal = value as Record<string, unknown>;
  return terminal.formatVersion === WORKSPACE_WRITE_LEASE_TERMINAL_VERSION &&
    tokenLooksValid(terminal.token) &&
    (terminal.outcome === 'released' || terminal.outcome === 'recovered') &&
    safeInteger(terminal.terminalAtMs);
}

export function tokenFromOwner(owner: WorkspaceWriteLeaseOwner): WorkspaceWriteLeaseToken {
  return Object.freeze({
    formatVersion: owner.formatVersion,
    workspaceIdentityDigest: owner.workspaceIdentityDigest,
    generation: owner.generation,
    ownerFileIdentityDigest: owner.ownerFileIdentityDigest,
    hostname: owner.hostname,
    pid: owner.pid,
    processNonce: owner.processNonce,
    leaseId: owner.leaseId
  });
}

export function sameToken(left: WorkspaceWriteLeaseToken, right: WorkspaceWriteLeaseToken): boolean {
  return canonicalEquals(left, right);
}

export function systemErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  if (typeof error.code !== 'string') return undefined;
  const normalized = error.code.toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(normalized) ? normalized : undefined;
}

export function isExistsError(error: unknown): boolean {
  return systemErrorCode(error) === 'EEXIST';
}

export function isMissingError(error: unknown): boolean {
  return systemErrorCode(error) === 'ENOENT';
}
