import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { consumeSecOperationRequirementBindingContext, issueSecOperationRequirementBindingContext, type SecOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { assertSecSemanticOperationProjection, bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan, issueSecSemanticOperationAttemptContext, type SecBoundSemanticOperation, type SecCapabilityBinding } from '../../../../execution/operation/semantic.ts';
import { inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess } from './physical-directory-chain.ts';
import type { PhysicalDirectoryChain, PhysicalDirectoryIdentity, RetainedNoFollowChildProcessDirectory } from './physical-no-follow-contract.ts';
import { installLinuxRepositoryNamespaceFence, linuxRetainedFilesystemObservation } from './physical-no-follow-native.ts';

const REQUIREMENT = 'runtime-state.linux-immutable-repository-input.retained';
const CONTRACT = sha256({ domain: REQUIREMENT, filesystem: 'tmpfs-superblock-read-only',
  namespace: 'x64-seccomp-tsync-fixed-view-v1', authority: 'native-facts-only',
  privilegedOwner: 'trusted-exclusive-setup-and-terminal-cleanup', maximumRoots: 8 });
const brand: unique symbol = Symbol('linux-immutable-repository-input');

export type LinuxImmutableRepositoryInput = Readonly<{
  readonly [brand]: true;
  providerBinding: SecCapabilityBinding;
  rootIdentityDigest: `sha256:${string}`;
}>;

export type LinuxImmutableRepositoryInputSettlement = Readonly<{
  status: 'immutable-input'; rootIdentityDigest: `sha256:${string}`;
  enforcementDigest: `sha256:${string}`;
}> | Readonly<{
  status: 'discontinuous' | 'identity-changed' | 'deadline-exhausted';
  rootIdentityDigest: `sha256:${string}`;
}>;

type Mount = Readonly<{ id: string; parent: string; device: string; root: string;
  target: string; options: readonly string[]; optional: readonly string[];
  filesystem: string; superOptions: readonly string[] }>;
type Root = Readonly<{ chain: PhysicalDirectoryChain; retained: RetainedNoFollowChildProcessDirectory;
  filesystemRoot: PhysicalDirectoryIdentity; mount: Mount; filesystemId: string }>;
type State = { roots: readonly Root[]; processIdentity: string; mountNamespace: string; userNamespace: string;
  preparedAt: number; deadline: number | null; disposed: boolean; settled: boolean };
const issued = new WeakMap<object, State>();

function fail(message: string): never { throw new Error(`Immutable repository input unavailable: ${message}`); }

/** Read only kernel procfs, with an explicit bounded input, not an environment
 * locator or a caller-supplied observation. The trusted host/kernel is the TCB. */
function proc(relative: string, maximum = 1024 * 1024): string {
  const fd = openSync(`/proc/self/${relative}`, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (linuxRetainedFilesystemObservation(fd).type !== 0x9fa0n) fail('process facts are not procfs');
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > maximum) fail('process fact bound exceeded');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally { closeSync(fd); }
}

function processIdentity(): string {
  const value = proc('stat', 64 * 1024);
  const close = value.lastIndexOf(')');
  const pid = /^([1-9][0-9]*) \(/u.exec(value)?.[1];
  const startedAt = close < 0 ? undefined : value.slice(close + 2).trim().split(/\s+/u)[19];
  if (pid === undefined || startedAt === undefined || !/^[0-9]+$/u.test(startedAt)) fail('process identity');
  return `${pid}:${startedAt}`;
}

function namespace(name: 'mnt' | 'user'): string {
  const value = readlinkSync(`/proc/self/ns/${name}`);
  if (!new RegExp(`^${name}:\\[[1-9][0-9]*\\]$`, 'u').test(value)) fail('namespace identity');
  return value;
}

/** No physical effect. Unsupported ordinary Linux callers retain absence. */
export function linuxImmutableRepositoryInputPrerequisites(): boolean {
  if (process.platform !== 'linux' || process.arch !== 'x64') return false;
  try {
    const credentials = (status: string): string | null => {
      const ids = (name: string) => new RegExp(`^${name}:\\s+([0-9]+)\\s+([0-9]+)\\s+([0-9]+)\\s+([0-9]+)$`, 'mu').exec(status)?.slice(1);
      const uid = ids('Uid'); const gid = ids('Gid');
      if (uid === undefined || gid === undefined || uid[0] === '0' || gid[0] === '0'
          || !uid.every(value => value === uid[0]) || !gid.every(value => value === gid[0])
          || !/^NoNewPrivs:\s+1$/mu.test(status)) return null;
      if (['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].some(name =>
        !new RegExp(`^${name}:\\s+0+$`, 'mu').test(status))) return null;
      return `${uid[0]}:${gid[0]}`;
    };
    const identity = credentials(proc('status', 64 * 1024));
    if (identity === null) return false;
    const mountNamespace = namespace('mnt'); const userNamespace = namespace('user');
    const tasks = () => readdirSync('/proc/self/task').sort();
    const before = tasks();
    if (before.length < 1 || before.length > 4096 || before.some(id => !/^[1-9][0-9]*$/u.test(id))) return false;
    // TSYNC alone says nothing about credentials of existing threads. Both
    // sides of the irreversible fence reobserve every real task. A changing
    // census is unavailable; this is admission by a trusted pre-candidate
    // launcher, not a claim to defeat arbitrary hostile in-process scheduling.
    for (const id of before) {
      if (credentials(proc(`task/${id}/status`, 64 * 1024)) !== identity
          || readlinkSync(`/proc/self/task/${id}/ns/mnt`) !== mountNamespace
          || readlinkSync(`/proc/self/task/${id}/ns/user`) !== userNamespace) return false;
    }
    if (JSON.stringify(before) !== JSON.stringify(tasks())) return false;
    // An unprivileged user namespace cannot manufacture this complete identity
    // mapping. The original privileged setup remains within the stated TCB.
    return /^\s*0\s+0\s+4294967295\s*$/u.test(proc('uid_map', 4096))
      && /^\s*0\s+0\s+4294967295\s*$/u.test(proc('gid_map', 4096));
  } catch { return false; }
}

/** Pure parser used by focused negative tests; it issues no capability. */
export function parseLinuxImmutableInputMounts(text: string): readonly Mount[] {
  const decode = (value: string): string => value.replace(/\\(040|011|012|134)/gu,
    (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
  const rows = text.trimEnd().split('\n');
  if (rows.length === 0 || rows.length > 4096) fail('mount census size');
  const ids = new Set<string>();
  return Object.freeze(rows.map(row => {
    const fields = row.split(' '); const separator = fields.indexOf('-');
    if (separator < 6 || fields.length !== separator + 4
        || !/^[1-9][0-9]*$/u.test(fields[0]!) || ids.has(fields[0]!)) fail('mount census shape');
    ids.add(fields[0]!);
    const root = decode(fields[3]!); const target = decode(fields[4]!);
    if (!path.posix.isAbsolute(root) || !path.posix.isAbsolute(target)) fail('mount paths');
    return Object.freeze({ id: fields[0]!, parent: fields[1]!, device: fields[2]!, root, target,
      options: Object.freeze(fields[5]!.split(',')), optional: Object.freeze(fields.slice(6, separator)),
      filesystem: fields[separator + 1]!, superOptions: Object.freeze(fields[separator + 3]!.split(',')) });
  }));
}

/** The superblock field after '-' is essential. fstatfs/ST_RDONLY and the
 * per-mount options can both say read-only for a writable-superblock bind. */
export function assertLinuxImmutableInputMount(mounts: readonly Mount[], mountId: string,
  rootPath: string): Mount {
  const mount = mounts.find(entry => entry.id === mountId);
  if (mount === undefined || mount.filesystem !== 'tmpfs' || mount.root !== '/'
      || !mount.options.includes('ro') || mount.options.includes('rw')
      || !mount.superOptions.includes('ro') || mount.superOptions.includes('rw')
      || mount.optional.length !== 0
      || !(mount.target === '/' || rootPath === mount.target || rootPath.startsWith(`${mount.target}/`))) fail('superblock is not one private read-only tmpfs');
  if (mounts.some(entry => entry.id !== mountId &&
    (entry.target === rootPath || entry.target.startsWith(`${rootPath}/`)))) fail('input contains a covering or nested mount');
  // Any visible alias reports the same read-only superblock. An alias hidden
  // in another namespace shares SB_RDONLY, unlike a read-only bind mount.
  if (mounts.some(entry => entry.device === mount.device &&
    (!entry.superOptions.includes('ro') || entry.superOptions.includes('rw')))) fail('writable superblock alias');
  return mount;
}

function descriptorMount(fd: number): string {
  const id = /^mnt_id:\s+([1-9][0-9]*)$/mu.exec(proc(`fdinfo/${fd}`, 64 * 1024))?.[1];
  if (id === undefined) fail('retained descriptor mount identity');
  return id;
}

function assertRootAncestors(chain: PhysicalDirectoryChain, filesystemRoot: PhysicalDirectoryIdentity, rootFilesystemId: string,
  rootMount: Mount, mounts: readonly Mount[]): void {
  // The original Linux no-follow chain lists each path component but omits
  // '/'. Retain its preparation identity explicitly instead of assuming it
  // was part of that caller-independent inventory.
  for (const entry of [filesystemRoot, ...chain.ancestors.filter(value => value.path !== '/')]) {
    const value = lstatSync(entry.path, { bigint: true });
    if (!value.isDirectory() || value.isSymbolicLink() || String(value.dev) !== entry.device
        || String(value.ino) !== entry.inode) fail('input ancestor is mutable or changed');
    const fd = openSync(entry.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const retained = fstatSync(fd, { bigint: true });
      if (retained.dev !== value.dev || retained.ino !== value.ino) fail('input ancestor identity changed');
      const filesystem = linuxRetainedFilesystemObservation(fd);
      const mount = mounts.find(item => item.id === descriptorMount(fd));
      const protectedBySameSuperblock = filesystem.type === 0x01021994n
        && (filesystem.flags & 1n) === 1n && filesystem.filesystemId === rootFilesystemId
        && mount?.device === rootMount.device && mount.filesystem === 'tmpfs'
        && mount.optional.length === 0 && mount.superOptions.includes('ro')
        && !mount.superOptions.includes('rw');
      // On the proved RO superblock, ownership cannot re-enable writes or
      // chmod. Preserve original Git/dependency ownership and ctime. Outside
      // it, every replaceable ancestor, including '/', remains root-owned.
      if (!protectedBySameSuperblock && (retained.uid !== 0n || (retained.mode & 0o022n) !== 0n)) fail('input ancestor is writable outside its protected superblock');
    } finally { closeSync(fd); }
  }
}

function assertNoWriters(roots: readonly Root[]): void {
  const devices = new Set(roots.map(root => root.chain.target.device));
  for (const name of readdirSync('/proc/self/fd')) {
    if (!/^[0-9]+$/u.test(name)) fail('descriptor census');
    const fd = Number(name);
    let metadata: ReturnType<typeof fstatSync>;
    try { metadata = fstatSync(fd); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EBADF') continue; throw error; }
    if (!devices.has(String(metadata.dev))) continue;
    const flags = /^flags:\s+([0-7]+)$/mu.exec(proc(`fdinfo/${fd}`, 64 * 1024))?.[1];
    if (flags === undefined || (Number.parseInt(flags, 8) & 3) !== 0) fail('input has a retained writable descriptor');
  }
  const mountDevices = new Set(roots.map(root => root.mount.device));
  for (const line of proc('maps', 4 * 1024 * 1024).trimEnd().split('\n')) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 5) fail('mapping census');
    const parts = fields[3]!.split(':');
    const device = parts.length === 2 ? `${Number.parseInt(parts[0]!, 16)}:${Number.parseInt(parts[1]!, 16)}` : '';
    if (mountDevices.has(device) && fields[1]![1] === 'w' && fields[1]![3] === 's') fail('input has a shared writable mapping');
  }
}

function assertCurrent(state: State): void {
  if (state.disposed || processIdentity() !== state.processIdentity || !linuxImmutableRepositoryInputPrerequisites()
      || namespace('mnt') !== state.mountNamespace || namespace('user') !== state.userNamespace) fail('execution identity changed');
  const mounts = parseLinuxImmutableInputMounts(proc('mountinfo'));
  for (const root of state.roots) {
    root.retained.assertCurrent();
    const fd = root.retained.stdioSourceDescriptor!;
    const current = linuxRetainedFilesystemObservation(fd);
    const mount = assertLinuxImmutableInputMount(mounts, descriptorMount(fd), root.chain.target.path);
    if (current.type !== 0x01021994n || (current.flags & 1n) !== 1n
        || current.filesystemId !== root.filesystemId || JSON.stringify(mount) !== JSON.stringify(root.mount)) fail('retained input filesystem changed');
    assertRootAncestors(root.chain, root.filesystemRoot, current.filesystemId, mount, mounts);
  }
  assertNoWriters(state.roots);
}

/** This owner derives every authority-bearing fact from the retained kernel
 * objects. Root strings only choose the requested scope; ordinary copies,
 * chmod trees, read-only binds, JSON receipts and flags cannot qualify. */
export function prepareLinuxImmutableRepositoryInput(roots: readonly string[]): LinuxImmutableRepositoryInput {
  if (!linuxImmutableRepositoryInputPrerequisites()) fail('execution prerequisites');
  if (!Array.isArray(roots) || roots.length < 1 || roots.length > 8 || new Set(roots).size !== roots.length) fail('root set');
  const retained: Root[] = [];
  const boundaries: RetainedNoFollowChildProcessDirectory[] = [];
  try {
    const mounts = parseLinuxImmutableInputMounts(proc('mountinfo'));
    const filesystemRoot = inspectNoFollowDirectoryChain('/', 'immutable input filesystem root').target;
    for (const [index, name] of roots.entries()) {
      if (typeof name !== 'string' || !path.isAbsolute(name) || path.resolve(name) !== name || name === '/') fail('root path');
      const chain = inspectNoFollowDirectoryChain(name, 'immutable repository input');
      const boundary = retainNoFollowDirectoryForChildProcess(chain, 40 + index, 'immutable repository input');
      boundaries.push(boundary);
      const observed = linuxRetainedFilesystemObservation(boundary.stdioSourceDescriptor!);
      const mount = assertLinuxImmutableInputMount(mounts, descriptorMount(boundary.stdioSourceDescriptor!), name);
      if (observed.type !== 0x01021994n || (observed.flags & 1n) !== 1n) fail('retained filesystem is writable');
      assertRootAncestors(chain, filesystemRoot, observed.filesystemId, mount, mounts);
      retained.push({ chain, filesystemRoot, retained: boundary, mount, filesystemId: observed.filesystemId });
    }
    const state: State = { roots: Object.freeze(retained), processIdentity: processIdentity(),
      mountNamespace: namespace('mnt'), userNamespace: namespace('user'), preparedAt: Date.now(),
      deadline: null, disposed: false, settled: false };
    assertCurrent(state);
    const rootIdentityDigest = sha256({ roots: retained.map(({ chain, filesystemRoot, mount, filesystemId }) => ({ chain, filesystemRoot, mount, filesystemId })),
      processIdentity: state.processIdentity, mountNamespace: state.mountNamespace, userNamespace: state.userNamespace });
    const capability = Object.freeze({ [brand]: true as const, rootIdentityDigest,
      providerBinding: compileSecCapabilityBinding({ requirementId: REQUIREMENT,
        contractDigest: CONTRACT, providerIdentityDigest: sha256({ contract: CONTRACT, rootIdentityDigest }) }) });
    issued.set(capability, state);
    return capability;
  } catch (error) {
    const failures: unknown[] = [error];
    for (const boundary of boundaries.reverse()) { try { boundary.dispose(); } catch (error) { failures.push(error); } }
    throw failures.length === 1 ? error : new AggregateError(failures, 'Immutable input admission and settlement failed');
  }
}

function stateOf(capability: LinuxImmutableRepositoryInput): State {
  const state = issued.get(capability);
  if (state === undefined || state.disposed) fail('live owner-issued capability required');
  return state;
}

export function armLinuxImmutableRepositoryInput(input: Readonly<{ prepared: LinuxImmutableRepositoryInput;
  operation: SecBoundSemanticOperation; requirementBindingContext: SecOperationRequirementBindingContext }>): void {
  const prepared = input.prepared;
  const state = stateOf(prepared);
  const operation = input.operation;
  const requirementBindingContext = input.requirementBindingContext;
  if (state.deadline !== null || state.settled) fail('capability already consumed');
  assertSecSemanticOperationProjection(operation);
  const context = consumeSecOperationRequirementBindingContext(requirementBindingContext);
  const binding = operation.bindings.find(value => value.requirementId === REQUIREMENT);
  const requirement = operation.plan.execution.requirements.find(value => value.id === REQUIREMENT);
  const ceiling = context.resourceCeilings.find(value => value.resource === 'duration-ms');
  const deadline = Math.min(operation.plan.attempt.deadlineAtUnixMs, context.absoluteDeadlineAtUnixMs,
    Date.now() + (ceiling?.maximum ?? Number.NaN));
  if (binding?.bindingDigest !== prepared.providerBinding.bindingDigest
      || context.operationIdentityDigest !== operation.plan.identity.identityDigest
      || context.boundAttemptDigest !== operation.boundAttemptDigest
      || context.requirementId !== REQUIREMENT || context.requirementContractDigest !== CONTRACT
      || requirement?.contractDigest !== CONTRACT || !requirement.effectKinds.includes('filesystem')
      || !requirement.effectKinds.includes('process')
      || context.providerBindingDigest !== prepared.providerBinding.bindingDigest
      || !Number.isSafeInteger(deadline) || deadline <= Date.now()) fail('operation binding or deadline');
  assertCurrent(state);
  if (Date.now() >= deadline) fail('deadline exhausted before namespace fence');
  installLinuxRepositoryNamespaceFence();
  assertCurrent(state);
  if (Date.now() >= deadline) fail('deadline exhausted during namespace fence admission');
  state.deadline = deadline;
}

export function armStandaloneLinuxImmutableRepositoryInput(capability: LinuxImmutableRepositoryInput,
  deadlineAtUnixMs: number): void {
  stateOf(capability);
  const duration = deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 5 * 60_000) fail('standalone deadline');
  const operation = bindSecSemanticOperation(compileSecSemanticOperationPlan({
    operation: REQUIREMENT, intentDigest: capability.rootIdentityDigest, decisionDigest: CONTRACT,
    deadlineAtUnixMs, attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: capability.rootIdentityDigest }),
    aggregateBudgets: [{ resource: 'duration-ms', maximum: duration }],
    requirements: [{ id: REQUIREMENT, contractDigest: CONTRACT, effectKinds: ['filesystem', 'process'],
      failureKinds: ['provider.unavailable', 'provider.unverified'] }]
  }), [capability.providerBinding]);
  armLinuxImmutableRepositoryInput({ prepared: capability, operation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({ operation,
      requirementId: REQUIREMENT, resourceCeilings: [{ resource: 'duration-ms', maximum: duration }], absoluteDeadlineAtUnixMs: deadlineAtUnixMs }) });
}

export function settleLinuxImmutableRepositoryInput(capability: LinuxImmutableRepositoryInput): LinuxImmutableRepositoryInputSettlement {
  const state = stateOf(capability);
  const failure = (status: 'discontinuous' | 'identity-changed' | 'deadline-exhausted') =>
    Object.freeze({ status, rootIdentityDigest: capability.rootIdentityDigest });
  if (state.settled || state.deadline === null) return failure('discontinuous');
  state.settled = true;
  if (Date.now() >= state.deadline) return failure('deadline-exhausted');
  try { assertCurrent(state); } catch { return failure('identity-changed'); }
  if (Date.now() >= state.deadline) return failure('deadline-exhausted');
  return Object.freeze({ status: 'immutable-input', rootIdentityDigest: capability.rootIdentityDigest,
    enforcementDigest: sha256({ contract: CONTRACT, rootIdentityDigest: capability.rootIdentityDigest,
      preparedAt: state.preparedAt, deadline: state.deadline, settledAt: Date.now(), method: 'prevent-write' }) });
}

export function disposeLinuxImmutableRepositoryInput(capability: LinuxImmutableRepositoryInput): void {
  const state = issued.get(capability);
  if (state === undefined) fail('owner-issued capability required');
  if (state.disposed) return;
  const failures: unknown[] = [];
  for (const root of [...state.roots].reverse()) { try { root.retained.dispose(); } catch (error) { failures.push(error); } }
  if (failures.length !== 0) throw new AggregateError(failures, 'Immutable input retained-root settlement failed');
  state.disposed = true;
}
