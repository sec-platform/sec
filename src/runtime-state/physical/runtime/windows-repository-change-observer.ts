import path from 'node:path';

import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  type RetainedNoFollowChildProcessDirectory
} from './physical-no-follow.ts';

const MAXIMUM_ROOTS = 8;
const MAXIMUM_EVENTS = 100_000;
const MAXIMUM_OBSERVATION_MS = 5 * 60_000;

const observerBrand: unique symbol = Symbol('windows-repository-change-observer');

export type WindowsRepositoryChangeAction =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed-from'
  | 'renamed-to';

export interface WindowsRepositoryChangeEvent {
  readonly rootIndex: number;
  readonly path: string;
  readonly action: WindowsRepositoryChangeAction;
}

export type WindowsRepositoryChangeObserverUnavailableReason =
  | 'unsupported-platform'
  | 'unsupported-architecture'
  | 'invalid-input'
  | 'root-unavailable'
  | 'native-provider-unavailable'
  | 'arm-failed'
  | 'deadline-exhausted';

export type WindowsRepositoryChangeObserverSettlement =
  | Readonly<{
    status: 'zero-events';
    rootIdentityDigest: `sha256:${string}`;
    observationDigest: `sha256:${string}`;
  }>
  | Readonly<{
    status: 'events';
    rootIdentityDigest: `sha256:${string}`;
    events: readonly WindowsRepositoryChangeEvent[];
    observationDigest: `sha256:${string}`;
  }>
  | Readonly<{
    status: 'overflow' | 'discontinuous' | 'identity-changed' | 'deadline-exhausted';
    rootIdentityDigest: `sha256:${string}`;
  }>;

export interface WindowsRepositoryChangeObserver {
  readonly [observerBrand]: never;
  readonly rootIdentityDigest: `sha256:${string}`;
}

export type WindowsRepositoryChangeObserverResolution =
  | Readonly<{ status: 'ready'; observer: WindowsRepositoryChangeObserver }>
  | Readonly<{
    status: 'unavailable';
    reason: WindowsRepositoryChangeObserverUnavailableReason;
  }>;

type WatchScope = 'subtree' | 'root-entry';

interface WatchRequest {
  readonly rootIndex: number;
  readonly watchPath: string;
  readonly subtree: boolean;
  readonly scope: WatchScope;
  readonly filterName: string | null;
  readonly maxEvents: number;
}

interface WorkerArmedMessage {
  readonly kind: 'armed';
  readonly stopEventHandle: bigint;
}

interface WorkerSettledMessage {
  readonly kind: 'settled';
  readonly status: 'zero-events' | 'events' | 'overflow' | 'discontinuous';
  readonly events: readonly WindowsRepositoryChangeEvent[];
}

interface WorkerFailedMessage {
  readonly kind: 'failed';
  readonly phase: 'provider' | 'arm' | 'observe';
}

type WorkerMessage = WorkerArmedMessage | WorkerSettledMessage | WorkerFailedMessage;

interface WorkerGlobal {
  onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
  postMessage(value: unknown): void;
}

interface WatcherLease {
  readonly worker: Worker;
  readonly stopEventHandle: bigint;
  readonly settlement: Promise<WorkerSettledMessage | WorkerFailedMessage>;
}

interface LiveObserver {
  readonly retainedRoots: readonly RetainedNoFollowChildProcessDirectory[];
  readonly watchers: readonly WatcherLease[];
  readonly rootIdentityDigest: `sha256:${string}`;
  readonly deadlineAtUnixMs: number;
  settled: boolean;
}

const liveObservers = new WeakMap<object, LiveObserver>();

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length
    && actual.every((entry, index) => entry === canonical[index]);
}

function canonicalRootPaths(values: readonly string[]): readonly string[] | null {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAXIMUM_ROOTS) return null;
  const canonical = values.map((value) => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
    const resolved = path.resolve(value);
    if (path.parse(resolved).root === resolved) return null;
    return resolved;
  });
  if (canonical.some((value) => value === null)) return null;
  const roots = canonical as string[];
  roots.sort((left, right) => left.localeCompare(right, 'en-US', { sensitivity: 'base' }));
  const identities = roots.map((value) => value.toLocaleLowerCase('en-US'));
  if (new Set(identities).size !== identities.length) return null;
  return Object.freeze(roots);
}

function rootIdentityProjection(root: ReturnType<typeof inspectNoFollowDirectoryChain>) {
  return Object.freeze({
    target: Object.freeze({
      path: root.target.path,
      finalPath: root.target.finalPath,
      device: root.target.device,
      inode: root.target.inode,
      objectId: root.target.objectId
    }),
    ancestors: Object.freeze(root.ancestors.map((entry) => Object.freeze({
      path: entry.path,
      finalPath: entry.finalPath,
      device: entry.device,
      inode: entry.inode,
      objectId: entry.objectId
    })))
  });
}

function workerMessage(value: unknown): WorkerMessage | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'armed' && exactKeys(candidate, ['kind', 'stopEventHandle'])
      && typeof candidate.stopEventHandle === 'bigint') {
    return candidate as unknown as WorkerArmedMessage;
  }
  if (candidate.kind === 'failed' && exactKeys(candidate, ['kind', 'phase'])
      && (candidate.phase === 'provider' || candidate.phase === 'arm' || candidate.phase === 'observe')) {
    return candidate as unknown as WorkerFailedMessage;
  }
  if (candidate.kind !== 'settled' || !exactKeys(candidate, ['events', 'kind', 'status'])
      || !['zero-events', 'events', 'overflow', 'discontinuous'].includes(String(candidate.status))
      || !Array.isArray(candidate.events)) return null;
  const events: WindowsRepositoryChangeEvent[] = [];
  for (const event of candidate.events) {
    if (event === null || typeof event !== 'object' || Array.isArray(event)
        || !exactKeys(event, ['action', 'path', 'rootIndex'])) return null;
    const record = event as Record<string, unknown>;
    if (!Number.isSafeInteger(record.rootIndex) || (record.rootIndex as number) < 0
        || typeof record.path !== 'string'
        || !['added', 'removed', 'modified', 'renamed-from', 'renamed-to'].includes(String(record.action))) {
      return null;
    }
    events.push(Object.freeze({
      rootIndex: record.rootIndex as number,
      path: record.path,
      action: record.action as WindowsRepositoryChangeAction
    }));
  }
  return Object.freeze({
    kind: 'settled',
    status: candidate.status as WorkerSettledMessage['status'],
    events: Object.freeze(events)
  });
}

async function setWindowsEvent(handle: bigint): Promise<boolean> {
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    const library = dlopen('kernel32.dll', {
      SetEvent: { args: [FFIType.u64], returns: FFIType.i32 }
    } as const);
    try {
      return library.symbols.SetEvent(handle) !== 0;
    } finally {
      library.close();
    }
  } catch {
    return false;
  }
}

function watchRequest(root: string, rootIndex: number): readonly WatchRequest[] {
  return Object.freeze([
    Object.freeze({
      rootIndex,
      watchPath: root,
      subtree: true,
      scope: 'subtree' as const,
      filterName: null,
      maxEvents: MAXIMUM_EVENTS
    }),
    Object.freeze({
      rootIndex,
      watchPath: path.dirname(root),
      subtree: false,
      scope: 'root-entry' as const,
      filterName: path.basename(root),
      maxEvents: MAXIMUM_EVENTS
    })
  ]);
}

function startWatcher(request: WatchRequest, deadlineAtUnixMs: number): Promise<WatcherLease | null> {
  return new Promise((resolve) => {
    const worker = new Worker(import.meta.url, { ref: true });
    let terminal = false;
    let resolveSettlement!: (value: WorkerSettledMessage | WorkerFailedMessage) => void;
    const settlement = new Promise<WorkerSettledMessage | WorkerFailedMessage>((settle) => {
      resolveSettlement = settle;
    });
    const timeout = setTimeout(() => {
      if (terminal) return;
      terminal = true;
      void worker.terminate();
      resolve(null);
    }, Math.max(1, deadlineAtUnixMs - Date.now()));
    const fail = (): void => {
      if (terminal) return;
      terminal = true;
      clearTimeout(timeout);
      void worker.terminate();
      resolve(null);
    };
    worker.onmessageerror = fail;
    worker.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    worker.onmessage = (event) => {
      const message = workerMessage(event.data);
      if (message === null) return fail();
      if (message.kind === 'armed') {
        if (terminal) return;
        clearTimeout(timeout);
        resolve(Object.freeze({ worker, stopEventHandle: message.stopEventHandle, settlement }));
        return;
      }
      if (terminal) return;
      terminal = true;
      clearTimeout(timeout);
      resolveSettlement(message);
    };
    worker.postMessage(request);
  });
}

function disposeRoots(roots: readonly RetainedNoFollowChildProcessDirectory[]): boolean {
  let success = true;
  for (const root of [...roots].reverse()) {
    try { root.dispose(); } catch { success = false; }
  }
  return success;
}

function unavailable(
  reason: WindowsRepositoryChangeObserverUnavailableReason
): WindowsRepositoryChangeObserverResolution {
  return Object.freeze({ status: 'unavailable', reason });
}

/**
 * Arms one direct Win32 directory-change observation for each retained root
 * and its parent entry. Returning `ready` is the baseline barrier: every
 * overlapped ReadDirectoryChangesW request is already pending.
 */
export async function armWindowsRepositoryChangeObserver(input: Readonly<{
  roots: readonly string[];
  deadlineAtUnixMs: number;
}>): Promise<WindowsRepositoryChangeObserverResolution> {
  if (process.platform !== 'win32') return unavailable('unsupported-platform');
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    return unavailable('unsupported-architecture');
  }
  const roots = canonicalRootPaths(input.roots);
  const now = Date.now();
  if (roots === null || !Number.isSafeInteger(input.deadlineAtUnixMs)
      || input.deadlineAtUnixMs <= now
      || input.deadlineAtUnixMs - now > MAXIMUM_OBSERVATION_MS) {
    return unavailable('invalid-input');
  }
  const retainedRoots: RetainedNoFollowChildProcessDirectory[] = [];
  const watchers: WatcherLease[] = [];
  try {
    const projections = [];
    for (const [index, root] of roots.entries()) {
      const chain = inspectNoFollowDirectoryChain(root, `repository change root[${index}]`);
      projections.push(rootIdentityProjection(chain));
      retainedRoots.push(retainNoFollowDirectoryForChildProcess(
        chain,
        40 + index,
        `repository change root[${index}]`
      ));
    }
    const rootIdentityDigest = sha256(Object.freeze(projections)) as `sha256:${string}`;
    for (const [rootIndex, root] of roots.entries()) {
      for (const request of watchRequest(root, rootIndex)) {
        const watcher = await startWatcher(request, input.deadlineAtUnixMs);
        if (watcher === null) throw new Error('observer arm failed');
        watchers.push(watcher);
      }
    }
    for (const retained of retainedRoots) retained.assertCurrent();
    const observer = Object.freeze({
      [observerBrand]: undefined as never,
      rootIdentityDigest
    }) as WindowsRepositoryChangeObserver;
    liveObservers.set(observer, {
      retainedRoots: Object.freeze(retainedRoots),
      watchers: Object.freeze(watchers),
      rootIdentityDigest,
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      settled: false
    });
    return Object.freeze({ status: 'ready', observer });
  } catch {
    for (const watcher of watchers) {
      void setWindowsEvent(watcher.stopEventHandle);
      void watcher.worker.terminate();
    }
    disposeRoots(retainedRoots);
    return unavailable(Date.now() >= input.deadlineAtUnixMs ? 'deadline-exhausted' : 'arm-failed');
  }
}

export async function settleWindowsRepositoryChangeObserver(
  observer: WindowsRepositoryChangeObserver
): Promise<WindowsRepositoryChangeObserverSettlement> {
  const live = liveObservers.get(observer);
  if (live === undefined || live.settled) {
    return Object.freeze({
      status: 'discontinuous',
      rootIdentityDigest: observer.rootIdentityDigest
    });
  }
  live.settled = true;
  let identityCurrent = true;
  try {
    for (const root of live.retainedRoots) root.assertCurrent();
  } catch {
    identityCurrent = false;
  }
  const signals = await Promise.all(live.watchers.map((watcher) =>
    setWindowsEvent(watcher.stopEventHandle)));
  const remaining = live.deadlineAtUnixMs - Date.now();
  let settlements: readonly (WorkerSettledMessage | WorkerFailedMessage)[] | null = null;
  if (signals.every(Boolean) && remaining > 0) {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      settlements = await Promise.race([
        Promise.all(live.watchers.map((watcher) => watcher.settlement)),
        new Promise<null>((resolve) => {
          deadlineTimer = setTimeout(() => resolve(null), remaining);
        })
      ]);
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    }
  }
  for (const watcher of live.watchers) void watcher.worker.terminate();
  try {
    for (const root of live.retainedRoots) root.assertCurrent();
  } catch {
    identityCurrent = false;
  }
  if (!disposeRoots(live.retainedRoots)) identityCurrent = false;
  liveObservers.delete(observer);
  if (!identityCurrent) {
    return Object.freeze({ status: 'identity-changed', rootIdentityDigest: live.rootIdentityDigest });
  }
  if (settlements === null || Date.now() >= live.deadlineAtUnixMs) {
    return Object.freeze({ status: 'deadline-exhausted', rootIdentityDigest: live.rootIdentityDigest });
  }
  if (settlements.some((entry) => entry.kind === 'failed'
      || (entry.kind === 'settled' && entry.status === 'discontinuous'))) {
    return Object.freeze({ status: 'discontinuous', rootIdentityDigest: live.rootIdentityDigest });
  }
  if (settlements.some((entry) => entry.kind === 'settled' && entry.status === 'overflow')) {
    return Object.freeze({ status: 'overflow', rootIdentityDigest: live.rootIdentityDigest });
  }
  const events = settlements.flatMap((entry) => entry.kind === 'settled' ? entry.events : []);
  if (events.length === 0) {
    const canonical = Object.freeze({
      status: 'zero-events' as const,
      rootIdentityDigest: live.rootIdentityDigest
    });
    return Object.freeze({
      ...canonical,
      observationDigest: sha256(canonical) as `sha256:${string}`
    });
  }
  const canonical = Object.freeze({
    status: 'events' as const,
    rootIdentityDigest: live.rootIdentityDigest,
    events: Object.freeze(events)
  });
  return Object.freeze({
    ...canonical,
    observationDigest: sha256(canonical) as `sha256:${string}`
  });
}

const FILE_LIST_DIRECTORY = 0x0000_0001;
const FILE_SHARE_READ_WRITE_DELETE = 0x0000_0007;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x0200_0000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x0020_0000;
const FILE_FLAG_OVERLAPPED = 0x4000_0000;
const CHANGE_FILTER = 0x0000_0001 | 0x0000_0002 | 0x0000_0004 | 0x0000_0008
  | 0x0000_0010 | 0x0000_0040 | 0x0000_0100;
const INVALID_HANDLE = 0xffff_ffff_ffff_ffffn;
const ERROR_IO_PENDING = 997;
const ERROR_OPERATION_ABORTED = 995;
const ERROR_NOTIFY_ENUM_DIR = 1022;
const ERROR_NOT_FOUND = 1168;
const WAIT_OBJECT_0 = 0;
const WAIT_FAILED = 0xffff_ffff;
const INFINITE = 0xffff_ffff;
const CHANGE_BUFFER_BYTES = 64 * 1024;

function wide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

function canonicalEventPath(value: string, request: WatchRequest): string | null {
  const normalized = value.replace(/\\/gu, '/').normalize('NFC');
  if (normalized.length === 0 || normalized.includes('\0') || normalized.startsWith('/')
      || normalized.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    return null;
  }
  if (request.scope === 'root-entry') {
    if (normalized.toLocaleLowerCase('en-US')
      !== request.filterName!.toLocaleLowerCase('en-US')) return '';
    return '.';
  }
  return normalized;
}

function actionFor(value: number): WindowsRepositoryChangeAction | null {
  if (value === 1) return 'added';
  if (value === 2) return 'removed';
  if (value === 3) return 'modified';
  if (value === 4) return 'renamed-from';
  if (value === 5) return 'renamed-to';
  return null;
}

function parseChangeBuffer(
  buffer: Buffer,
  byteLength: number,
  request: WatchRequest
): readonly WindowsRepositoryChangeEvent[] | null {
  if (byteLength <= 0 || byteLength > buffer.byteLength) return null;
  const events: WindowsRepositoryChangeEvent[] = [];
  let offset = 0;
  for (;;) {
    if (offset + 12 > byteLength) return null;
    const next = buffer.readUInt32LE(offset);
    const action = actionFor(buffer.readUInt32LE(offset + 4));
    const nameBytes = buffer.readUInt32LE(offset + 8);
    if (action === null || nameBytes === 0 || nameBytes % 2 !== 0
        || offset + 12 + nameBytes > byteLength) return null;
    const observed = buffer.subarray(offset + 12, offset + 12 + nameBytes).toString('utf16le');
    const eventPath = canonicalEventPath(observed, request);
    if (eventPath === null) return null;
    if (eventPath !== '') {
      events.push(Object.freeze({ rootIndex: request.rootIndex, path: eventPath, action }));
    }
    if (next === 0) break;
    if (next < 12 + nameBytes || offset + next >= byteLength) return null;
    offset += next;
  }
  return Object.freeze(events);
}

function workerRequest(value: unknown): WatchRequest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || !exactKeys(value, [
        'filterName', 'maxEvents', 'rootIndex', 'scope', 'subtree', 'watchPath'
      ])) return null;
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.rootIndex) || (candidate.rootIndex as number) < 0
      || typeof candidate.watchPath !== 'string' || !path.isAbsolute(candidate.watchPath)
      || typeof candidate.subtree !== 'boolean'
      || (candidate.scope !== 'subtree' && candidate.scope !== 'root-entry')
      || (candidate.filterName !== null && typeof candidate.filterName !== 'string')
      || !Number.isSafeInteger(candidate.maxEvents) || (candidate.maxEvents as number) <= 0
      || (candidate.maxEvents as number) > MAXIMUM_EVENTS) return null;
  if ((candidate.scope === 'subtree') !== candidate.subtree
      || (candidate.scope === 'root-entry') !== (candidate.filterName !== null)) return null;
  return Object.freeze(candidate as unknown as WatchRequest);
}

async function runWatcher(requestValue: unknown, output: WorkerGlobal): Promise<void> {
  const request = workerRequest(requestValue);
  if (request === null) {
    output.postMessage(Object.freeze({ kind: 'failed', phase: 'arm' }));
    return;
  }
  let directoryHandle: bigint | null = null;
  let changeEvent: bigint | null = null;
  let stopEvent: bigint | null = null;
  let closeResources = (): void => undefined;
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    const library = dlopen('kernel32.dll', {
      CreateFileW: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr,
          FFIType.u32, FFIType.u32, FFIType.ptr],
        returns: FFIType.u64
      },
      CreateEventW: {
        args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr],
        returns: FFIType.u64
      },
      ReadDirectoryChangesW: {
        args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.i32,
          FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32
      },
      GetOverlappedResult: {
        args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32
      },
      CancelIoEx: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      WaitForMultipleObjects: {
        args: [FFIType.u32, FFIType.ptr, FFIType.i32, FFIType.u32],
        returns: FFIType.u32
      },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
      GetLastError: { args: [], returns: FFIType.u32 }
    } as const);
    const close = (handle: bigint | null): void => {
      if (handle !== null && handle !== 0n && handle !== INVALID_HANDLE) {
        library.symbols.CloseHandle(handle);
      }
    };
    closeResources = (): void => {
      close(stopEvent);
      close(changeEvent);
      close(directoryHandle);
      stopEvent = null;
      changeEvent = null;
      directoryHandle = null;
      library.close();
      closeResources = (): void => undefined;
    };
    directoryHandle = library.symbols.CreateFileW(
      wide(request.watchPath),
      FILE_LIST_DIRECTORY,
      FILE_SHARE_READ_WRITE_DELETE,
      null,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OVERLAPPED,
      null
    );
    changeEvent = library.symbols.CreateEventW(null, 0, 0, null);
    stopEvent = library.symbols.CreateEventW(null, 1, 0, null);
    if (directoryHandle === INVALID_HANDLE || changeEvent === 0n || stopEvent === 0n) {
      closeResources();
      output.postMessage(Object.freeze({ kind: 'failed', phase: 'provider' }));
      return;
    }
    const changeBuffer = Buffer.alloc(CHANGE_BUFFER_BYTES);
    const overlapped = Buffer.alloc(32);
    const transferred = Buffer.alloc(4);
    const handles = Buffer.alloc(16);
    handles.writeBigUInt64LE(changeEvent, 0);
    handles.writeBigUInt64LE(stopEvent, 8);
    const events: WindowsRepositoryChangeEvent[] = [];
    let status: WorkerSettledMessage['status'] = 'zero-events';
    const prepareOverlapped = (): void => {
      overlapped.fill(0);
      overlapped.writeBigUInt64LE(changeEvent!, 24);
      transferred.fill(0);
    };
    const arm = (): boolean => {
      prepareOverlapped();
      const result = library.symbols.ReadDirectoryChangesW(
        directoryHandle!,
        changeBuffer,
        changeBuffer.byteLength,
        request.subtree ? 1 : 0,
        CHANGE_FILTER,
        null,
        overlapped,
        null
      );
      return result !== 0 || library.symbols.GetLastError() === ERROR_IO_PENDING;
    };
    const consume = (): boolean => {
      if (library.symbols.GetOverlappedResult(directoryHandle!, overlapped, transferred, 0) === 0) {
        const error = library.symbols.GetLastError();
        if (error === ERROR_OPERATION_ABORTED) return true;
        if (error === ERROR_NOTIFY_ENUM_DIR) status = 'overflow';
        else status = 'discontinuous';
        return false;
      }
      const byteLength = transferred.readUInt32LE(0);
      if (byteLength === 0) {
        status = 'overflow';
        return false;
      }
      const parsed = parseChangeBuffer(changeBuffer, byteLength, request);
      if (parsed === null) {
        status = 'discontinuous';
        return false;
      }
      events.push(...parsed);
      if (events.length > request.maxEvents) {
        status = 'overflow';
        return false;
      }
      if (events.length > 0) status = 'events';
      return true;
    };
    if (!arm()) {
      closeResources();
      output.postMessage(Object.freeze({ kind: 'failed', phase: 'arm' }));
      return;
    }
    output.postMessage(Object.freeze({ kind: 'armed', stopEventHandle: stopEvent }));
    for (;;) {
      const wait = library.symbols.WaitForMultipleObjects(2, handles, 0, INFINITE);
      if (wait === WAIT_FAILED) {
        status = 'discontinuous';
        break;
      }
      if (wait === WAIT_OBJECT_0) {
        // `consume` is the sole owner of terminal read classification and
        // returns false for every overflow/discontinuity settlement.  Keeping
        // that transition atomic also prevents the coordinator from inventing
        // a second interpretation of the mutable native state.
        if (!consume()) break;
        if (!arm()) {
          status = 'discontinuous';
          break;
        }
        continue;
      }
      if (wait === WAIT_OBJECT_0 + 1) {
        if (library.symbols.GetOverlappedResult(directoryHandle, overlapped, transferred, 0) !== 0) {
          consume();
        } else {
          const error = library.symbols.GetLastError();
          if (error !== ERROR_OPERATION_ABORTED) {
            const cancelled = library.symbols.CancelIoEx(directoryHandle, overlapped);
            if (cancelled === 0 && library.symbols.GetLastError() !== ERROR_NOT_FOUND) {
              status = 'discontinuous';
            } else {
              library.symbols.WaitForSingleObject(changeEvent, INFINITE);
              consume();
            }
          }
        }
        break;
      }
      status = 'discontinuous';
      break;
    }
    const settlement = Object.freeze({
      kind: 'settled',
      status,
      events: Object.freeze(events)
    });
    // The settlement message is the terminal resource receipt. A consumer may
    // delete a watched temporary root as soon as it receives this message, so
    // every native handle and the FFI library must be closed first.
    closeResources();
    output.postMessage(settlement);
  } catch {
    closeResources();
    output.postMessage(Object.freeze({ kind: 'failed', phase: 'observe' }));
  }
}

const workerGlobal = globalThis as unknown as WorkerGlobal;
if (!Bun.isMainThread) {
  workerGlobal.onmessage = (event): void => {
    workerGlobal.onmessage = null;
    void runWatcher(event.data, workerGlobal);
  };
}
