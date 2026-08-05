import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

import { compilerRoot } from './paths.ts';

type HeavyVerificationGateOwnerV1 = Readonly<{
  command: readonly string[];
  gateId: string;
  host: string;
  pid: number;
  startedAt: string;
  token: string;
}>;

export type HeavyVerificationGateLease = Readonly<{
  owner: HeavyVerificationGateOwnerV1;
  release: () => Promise<void>;
}>;

export type HeavyVerificationGateLeaseOptions = Readonly<{
  gateId: string;
  isProcessAlive?: (pid: number) => boolean;
  lockPath?: string;
  namespace?: string;
  ownerHost?: string;
  ownerPid?: number;
  startedAt?: string;
  token?: string;
  waitTimeoutMs?: number;
}>;

export type HeavyVerificationGateLeaseCallOptions = Readonly<
  Pick<HeavyVerificationGateLeaseOptions, 'namespace' | 'waitTimeoutMs'>
>;

const HEAVY_VERIFICATION_GATE_LOCK_NAME = 'heavy-verification-gate-v1';
const HEAVY_VERIFICATION_GATE_ID_PATTERN = /^[a-z0-9][a-z0-9:-]*$/u;
const HEAVY_VERIFICATION_GATE_DEFAULT_WAIT_TIMEOUT_MS = 0;
const OWNER_FILE = 'owner.json';
const INITIALIZATION_GRACE_MS = 30_000;
const WINDOWS_WAIT_OBJECT_0 = 0x0000_0000;
const WINDOWS_WAIT_ABANDONED_0 = 0x0000_0080;
const WINDOWS_WAIT_TIMEOUT = 0x0000_0102;

interface HeavyVerificationGateKernel32Symbols {
  CreateMutexW: (security: null, initialOwner: number, name: Buffer) => bigint;
  WaitForSingleObject: (handle: bigint, milliseconds: number) => number;
  ReleaseMutex: (handle: bigint) => number;
  CloseHandle: (handle: bigint) => number;
}

interface HeavyVerificationGateKernel32 {
  symbols: HeavyVerificationGateKernel32Symbols;
}

let heavyVerificationGateKernel32Promise: Promise<HeavyVerificationGateKernel32> | undefined;
let windowsHeavyVerificationGateHeld = false;

async function loadHeavyVerificationGateKernel32(): Promise<HeavyVerificationGateKernel32> {
  heavyVerificationGateKernel32Promise ??= (async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    return dlopen('kernel32.dll', {
      CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.u64 },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      ReleaseMutex: { args: [FFIType.u64], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
    } as const) as unknown as HeavyVerificationGateKernel32;
  })();
  return heavyVerificationGateKernel32Promise;
}

function windowsWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

export function heavyVerificationGateMutexName(worktreeRoot: string, namespace?: string): string {
  const canonical = path.resolve(worktreeRoot).toLocaleLowerCase('en-US');
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  if (!namespace) {
    return `Global\\sec-heavy-verification-gate-${digest}`;
  }
  const namespaceDigest = createHash('sha256').update(namespace).digest('hex').slice(0, 16);
  return `Global\\sec-heavy-verification-gate-${digest}-${namespaceDigest}`;
}

function validateHeavyVerificationGateNamespace(namespace: string): void {
  if (!HEAVY_VERIFICATION_GATE_ID_PATTERN.test(namespace)) {
    throw new Error('Heavy verification gate namespace must be canonical.');
  }
}

function heavyVerificationGateNamespaceSegment(namespace: string): string {
  return createHash('sha256').update(namespace).digest('hex').slice(0, 16);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}

function isOwner(value: unknown): value is HeavyVerificationGateOwnerV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const owner = value as Partial<HeavyVerificationGateOwnerV1>;
  return Array.isArray(owner.command) && owner.command.every((part) => typeof part === 'string') &&
    typeof owner.gateId === 'string' && owner.gateId.length > 0 &&
    typeof owner.host === 'string' && owner.host.length > 0 &&
    Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.startedAt === 'string' && !Number.isNaN(Date.parse(owner.startedAt)) &&
    typeof owner.token === 'string' && /^[0-9a-f]{32}$/u.test(owner.token);
}

async function readOwner(lockPath: string): Promise<HeavyVerificationGateOwnerV1 | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(lockPath, OWNER_FILE), 'utf8')) as unknown;
    return isOwner(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function publishCandidate(
  lockPath: string,
  owner: HeavyVerificationGateOwnerV1
): Promise<string> {
  const candidatePath = `${lockPath}.candidate-${owner.token}`;
  await mkdir(candidatePath);
  try {
    await writeFile(
      path.join(candidatePath, OWNER_FILE),
      `${JSON.stringify(owner)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    await rename(candidatePath, lockPath);
    return candidatePath;
  } catch (error) {
    await rm(candidatePath, { recursive: true, force: true });
    throw error;
  }
}

async function reclaimStaleLock(lockPath: string, token: string): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim-${token}`;
  try {
    await rename(lockPath, reclaimPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error &&
      (error.code === 'ENOENT' || error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'ENOTEMPTY')) {
      return false;
    }
    throw error;
  }
  await rm(reclaimPath, { recursive: true, force: false });
  return true;
}

async function acquireWindowsHeavyVerificationGateLease(
  owner: HeavyVerificationGateOwnerV1,
  namespace: string | undefined,
  waitTimeoutMs: number
): Promise<HeavyVerificationGateLease> {
  if (windowsHeavyVerificationGateHeld) {
    throw new Error('Another heavy verification gate is already active in this process.');
  }
  const physicalWorktreeRoot = await realpath(compilerRoot);
  const kernel32 = await loadHeavyVerificationGateKernel32();
  const handle = kernel32.symbols.CreateMutexW(
    null,
    0,
    windowsWide(heavyVerificationGateMutexName(physicalWorktreeRoot, namespace))
  );
  if (handle === 0n) {
    throw new Error('Heavy verification gate mutex could not be created.');
  }
  const wait = kernel32.symbols.WaitForSingleObject(handle, waitTimeoutMs);
  if (wait !== WINDOWS_WAIT_OBJECT_0 && wait !== WINDOWS_WAIT_ABANDONED_0) {
    kernel32.symbols.CloseHandle(handle);
    if (wait === WINDOWS_WAIT_TIMEOUT) {
      throw new Error('Another heavy verification gate is already active in this worktree.');
    }
    throw new Error('Heavy verification gate mutex wait failed.');
  }
  windowsHeavyVerificationGateHeld = true;
  let released = false;
  return Object.freeze({
    owner,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      windowsHeavyVerificationGateHeld = false;
      kernel32.symbols.ReleaseMutex(handle);
      kernel32.symbols.CloseHandle(handle);
    }
  });
}

export async function acquireHeavyVerificationGateLease(
  options: HeavyVerificationGateLeaseOptions
): Promise<HeavyVerificationGateLease> {
  if (!HEAVY_VERIFICATION_GATE_ID_PATTERN.test(options.gateId)) {
    throw new Error('Heavy verification gate id must be canonical.');
  }
  const namespace = options.namespace;
  if (namespace !== undefined) {
    validateHeavyVerificationGateNamespace(namespace);
  }
  const waitTimeoutMs = options.waitTimeoutMs ?? HEAVY_VERIFICATION_GATE_DEFAULT_WAIT_TIMEOUT_MS;
  const namespaceSegment = namespace
    ? heavyVerificationGateNamespaceSegment(namespace)
    : undefined;
  const baseLockPath = options.lockPath
    ?? path.join(compilerRoot, '.tmp', HEAVY_VERIFICATION_GATE_LOCK_NAME);
  const lockPath = namespaceSegment
    ? path.join(baseLockPath, namespaceSegment)
    : path.resolve(baseLockPath);
  const token = options.token ?? randomUUID().replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(token)) {
    throw new Error('Heavy verification gate token must be 128-bit lowercase hex.');
  }
  const owner = Object.freeze({
    command: Object.freeze([...process.argv]),
    gateId: options.gateId,
    host: options.ownerHost ?? hostname(),
    pid: options.ownerPid ?? process.pid,
    startedAt: options.startedAt ?? new Date().toISOString(),
    token
  });
  if (process.platform === 'win32' && options.lockPath === undefined) {
    return acquireWindowsHeavyVerificationGateLease(owner, namespace, waitTimeoutMs);
  }
  const ownerIsAlive = options.isProcessAlive ?? isProcessAlive;
  await mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await publishCandidate(lockPath, owner);
      let released = false;
      return Object.freeze({
        owner,
        release: async (): Promise<void> => {
          if (released) return;
          const current = await readOwner(lockPath);
          if (!current || current.token !== owner.token) {
            throw new Error('Heavy verification gate lease ownership was lost before release.');
          }
          const releasePath = `${lockPath}.release-${owner.token}`;
          await rename(lockPath, releasePath);
          await rm(releasePath, { recursive: true, force: false });
          released = true;
        }
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error &&
        (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'ENOTEMPTY'))) {
        throw error;
      }
    }

    const current = await readOwner(lockPath);
    if (current) {
      if (current.host !== owner.host) {
        throw new Error(
          `Heavy verification gate ${current.gateId} is owned by another host (${current.host}).`
        );
      }
      if (ownerIsAlive(current.pid)) {
        throw new Error(
          `Heavy verification gate ${current.gateId} is already active ` +
          `(pid ${current.pid}, started ${current.startedAt}).`
        );
      }
    }
    if (!current) {
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs < INITIALIZATION_GRACE_MS) {
        throw new Error('Heavy verification gate owner publication is still initializing.');
      }
      throw new Error('Heavy verification gate owner publication is invalid and requires recovery.');
    }
    await reclaimStaleLock(lockPath, owner.token);
  }
  throw new Error('Heavy verification gate could not acquire its worktree-local lease.');
}

export async function withHeavyVerificationGateLease<T>(
  gateId: string,
  callback: () => Promise<T>,
  options?: HeavyVerificationGateLeaseCallOptions
): Promise<T> {
  const lease = await acquireHeavyVerificationGateLease({ gateId, ...options });
  try {
    return await callback();
  } finally {
    await lease.release();
  }
}
