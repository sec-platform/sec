import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256 } from '../../../../contracts/canonical.ts';
import { createNoFollowDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryChild, inspectNoFollowOrdinaryFileEntry, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { currentRuntimePlatform, resolveRuntimeCacheRoot, runtimeStateEnvironment } from '../../../runtime-state/workspace-state/layout.ts';
import { compilerRoot } from "../../../workspace-context.ts";
export { pathEnvKey } from '../../../runtime-state/physical/runtime/process.ts';

export const TEST_WORKSPACE_NAMESPACE_ENV = 'SEC_TEST_WORKSPACE_NAMESPACE';
export const TEST_WORKSPACE_RUN_CHILD_ENV = 'SEC_TEST_WORKSPACE_RUN_CHILD';
export const TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV = 'SEC_TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT';
export const TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV = 'SEC_TEST_WORKSPACE_BOUND_CHILD_LOCATOR';
export const TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA = 'sec-test-workspace-run-child-assignment-v1';
export const TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA = 'sec-test-workspace-supervisor-lease-v1';
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA = 'sec-test-workspace-supervisor-challenge-v1';
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_ACK_SCHEMA = 'sec-test-workspace-supervisor-challenge-ack-v1';
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_MAX_BYTES = 4_096;
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_TIMEOUT_MS = 5_000;
const TEST_WORKSPACE_CLEANUP_SCAN_BUDGET_MS = 10_000;

export type TestWorkspaceSupervisorLease = Readonly<{
  schema: typeof TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA;
  namespace: string;
  runId: string;
  repositoryRoot: string;
  executionSnapshotRoot: string;
  issuerProcessId: number;
  nonce: string;
  leaseDigest: `sha256:${string}`;
}>;

export type TestWorkspaceSupervisorLeaseBinding = Readonly<{
  record: TestWorkspaceSupervisorLease;
  path: string;
  device: string;
  inode: string;
}>;

export type TestWorkspaceRunNamespaceSeed = Readonly<{
  parentNamespace?: string;
  processId: number;
  processNonce: string;
  runSequence: number;
}>;

export type TestWorkspaceRunChildAssignment = Readonly<{
  schema: typeof TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA;
  name: string;
  nonce: string;
  nonceDigest: `sha256:${string}`;
  issuerProcessId: number;
  supervisorLeaseDigest: `sha256:${string}`;
  supervisorLeasePath: string;
  supervisorLeaseDevice: string;
  supervisorLeaseInode: string;
  namespaceDevice: string;
  namespaceInode: string;
  device: string;
  inode: string;
  assignmentDigest: `sha256:${string}`;
}>;

export interface PreparedTestWorkspaceRun {
  readonly schema: 'prepared-test-workspace-run-v1';
}

export interface TestWorkspaceRunChildAuthority {
  readonly schema: 'sec-test-workspace-run-child-authority-v1';
}

type PreparedTestWorkspaceRunState =
  | {
      readonly mode: 'retained';
      readonly target: PhysicalDirectoryIdentity;
      readonly parent: PhysicalDirectoryIdentity;
      settled: boolean;
    }
  | {
      readonly mode: 'darwin-os-managed';
      settled: boolean;
    };

const preparedTestWorkspaceRuns = new WeakMap<object, PreparedTestWorkspaceRunState>();
const testWorkspaceRunChildAuthorities = new WeakMap<object, TestWorkspaceRunChildAssignment>();
const consumedTestWorkspaceRunChildAuthorities = new WeakSet<object>();

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

type TestWorkspaceGateSnapshotBinding = Readonly<{
  namespace: string;
  repositoryRoot: string;
  executionSnapshotRoot: string;
  supervisorLeasePath: string;
  challengeEndpoint: string;
}>;

function canonicalFilesystemPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

export function testWorkspaceGateSnapshotBinding(
  executionSnapshotRoot: string
): TestWorkspaceGateSnapshotBinding {
  const snapshotRoot = path.resolve(executionSnapshotRoot);
  const snapshotParent = path.dirname(snapshotRoot);
  const dotTmpRoot = path.dirname(snapshotParent);
  const repositoryRoot = path.dirname(dotTmpRoot);
  const namespace = resolveTestWorkspaceNamespace({
    [TEST_WORKSPACE_NAMESPACE_ENV]: path.basename(snapshotRoot)
  });
  if (namespace === undefined || path.basename(snapshotParent) !== 'gate-execution-snapshots' ||
    path.basename(dotTmpRoot) !== '.tmp' || path.dirname(repositoryRoot) === repositoryRoot) {
    throw new Error('Test workspace Gate execution snapshot binding is invalid');
  }
  const endpointDigest = rawSha256(JSON.stringify({
    domain: 'sec-test-workspace-supervisor-challenge-endpoint-v1',
    executionSnapshotRoot: canonicalFilesystemPath(snapshotRoot)
  })).slice('sha256:'.length, 'sha256:'.length + 40);
  const challengeEndpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\sec-wpg-${endpointDigest}`
    : process.platform === 'linux'
      ? `\0sec-wpg-${endpointDigest}`
      : (() => { throw new Error('Test workspace Gate supervisor challenge is unavailable'); })();
  return Object.freeze({
    namespace,
    repositoryRoot,
    executionSnapshotRoot: snapshotRoot,
    supervisorLeasePath: path.join(
      repositoryRoot,
      '.tmp',
      'test-workspaces',
      '.gate-supervisor-leases',
      `${namespace}.lock`
    ),
    challengeEndpoint
  });
}

export function createTestWorkspaceSupervisorLease(input: {
  readonly namespace: string;
  readonly runId: string;
  readonly repositoryRoot: string;
  readonly executionSnapshotRoot: string;
  readonly issuerProcessId: number;
  readonly nonce: string;
}): TestWorkspaceSupervisorLease {
  const namespace = resolveTestWorkspaceNamespace({ [TEST_WORKSPACE_NAMESPACE_ENV]: input.namespace });
  const snapshot = testWorkspaceGateSnapshotBinding(input.executionSnapshotRoot);
  if (namespace === undefined || !input.runId || input.runId !== input.runId.trim() ||
    namespace !== snapshot.namespace ||
    canonicalFilesystemPath(input.repositoryRoot) !== canonicalFilesystemPath(snapshot.repositoryRoot) ||
    !Number.isSafeInteger(input.issuerProcessId) || input.issuerProcessId < 1 ||
    !/^[0-9a-f]{64}$/u.test(input.nonce)) {
    throw new Error('Test workspace supervisor lease material is invalid');
  }
  const draft = Object.freeze({
    schema: TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA,
    namespace,
    runId: input.runId,
    repositoryRoot: snapshot.repositoryRoot,
    executionSnapshotRoot: snapshot.executionSnapshotRoot,
    issuerProcessId: input.issuerProcessId,
    nonce: input.nonce
  });
  return Object.freeze({ ...draft, leaseDigest: rawSha256(JSON.stringify(draft)) });
}

export function testWorkspaceSupervisorLeasePath(namespace: string): string {
  const normalized = resolveTestWorkspaceNamespace({ [TEST_WORKSPACE_NAMESPACE_ENV]: namespace });
  if (normalized === undefined) throw new Error('Test workspace supervisor namespace is unavailable');
  return path.join(compilerRoot, '.tmp', 'test-workspaces', '.gate-supervisor-leases', `${normalized}.lock`);
}

function bindTestWorkspaceSupervisorLeaseProjection(
  leasePath: string,
  namespace: string,
  executionSnapshotRoot: string
): TestWorkspaceSupervisorLeaseBinding {
  const snapshot = testWorkspaceGateSnapshotBinding(executionSnapshotRoot);

  const normalizedNamespace = resolveTestWorkspaceNamespace({ [TEST_WORKSPACE_NAMESPACE_ENV]: namespace });
  if (normalizedNamespace === undefined || !path.isAbsolute(leasePath) ||
    normalizedNamespace !== snapshot.namespace ||
    canonicalFilesystemPath(leasePath) !== canonicalFilesystemPath(snapshot.supervisorLeasePath)) {
    throw new Error('runFastTests caller supervisor lease path is invalid');
  }
  const resolvedLeasePath = path.resolve(leasePath);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(resolvedLeasePath),
    'runFastTests caller supervisor lease parent'
  ).target;
  const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(resolvedLeasePath));
  if (entry === null || entry.bytes === null || entry.bytes.byteLength > 4_096) {
    throw new Error('runFastTests caller supervisor lease is not an exact bounded ordinary file');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes)) as unknown;
  } catch {
    throw new Error('runFastTests caller supervisor lease is malformed');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'schema', 'namespace', 'runId', 'repositoryRoot', 'executionSnapshotRoot',
    'issuerProcessId', 'nonce', 'leaseDigest'
  ])) throw new Error('runFastTests caller supervisor lease shape is invalid');
  const candidate = value as Record<string, unknown>;
  const draft = {
    schema: candidate.schema,
    namespace: candidate.namespace,
    runId: candidate.runId,
    repositoryRoot: candidate.repositoryRoot,
    executionSnapshotRoot: candidate.executionSnapshotRoot,
    issuerProcessId: candidate.issuerProcessId,
    nonce: candidate.nonce
  };
  if (candidate.schema !== TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA ||
    candidate.namespace !== normalizedNamespace || typeof candidate.runId !== 'string' || candidate.runId.length === 0 ||
    canonicalFilesystemPath(String(candidate.repositoryRoot)) !== canonicalFilesystemPath(snapshot.repositoryRoot) ||
    canonicalFilesystemPath(String(candidate.executionSnapshotRoot)) !==
      canonicalFilesystemPath(snapshot.executionSnapshotRoot) ||
    !Number.isSafeInteger(candidate.issuerProcessId) || Number(candidate.issuerProcessId) < 1 ||
    !/^[0-9a-f]{64}$/u.test(String(candidate.nonce)) ||
    candidate.leaseDigest !== rawSha256(JSON.stringify(draft))) {
    throw new Error('runFastTests caller supervisor lease binding is invalid');
  }
  return Object.freeze({
    record: Object.freeze(candidate as unknown as TestWorkspaceSupervisorLease),
    path: resolvedLeasePath,
    device: entry.device,
    inode: entry.inode
  });
}

export function bindTestWorkspaceSupervisorLease(
  leasePath: string,
  namespace: string
): TestWorkspaceSupervisorLeaseBinding {
  return bindTestWorkspaceSupervisorLeaseProjection(leasePath, namespace, compilerRoot);
}

export function bindTestWorkspaceSupervisorLeaseIssuerProjection(
  leasePath: string,
  namespace: string,
  executionSnapshotRoot: string
): TestWorkspaceSupervisorLeaseBinding {
  return bindTestWorkspaceSupervisorLeaseProjection(leasePath, namespace, executionSnapshotRoot);
}

export function resolveTestWorkspaceNamespace(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const namespace = env[TEST_WORKSPACE_NAMESPACE_ENV]?.trim();
  if (!namespace) return undefined;
  if (namespace === '.' || namespace === '..' || !/^[A-Za-z0-9._-]{1,128}$/u.test(namespace)) {
    throw new Error(`${TEST_WORKSPACE_NAMESPACE_ENV} must be a bounded safe single path segment`);
  }
  return namespace;
}

export function resolveTestWorkspaceRunChild(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const runChild = env[TEST_WORKSPACE_RUN_CHILD_ENV]?.trim();
  if (!runChild) return undefined;
  if (!/^fast-[0-9a-f]{64}$/u.test(runChild)) {
    throw new Error(`${TEST_WORKSPACE_RUN_CHILD_ENV} must be an exact run-owned child segment`);
  }
  return runChild;
}

/**
 * Derive one run-owned child name from a caller containment scope. When a
 * caller scope exists, getTestWorkspaceTempRoot physically places this child
 * beneath that scope so caller-scoped crash recovery can observe it.
 */
export function deriveTestWorkspaceRunNamespace(seed: TestWorkspaceRunNamespaceSeed): string {
  const parentNamespace = seed.parentNamespace === undefined
    ? undefined
    : resolveTestWorkspaceNamespace({ [TEST_WORKSPACE_NAMESPACE_ENV]: seed.parentNamespace });
  if (!Number.isSafeInteger(seed.processId) || seed.processId < 1 ||
    !Number.isSafeInteger(seed.runSequence) || seed.runSequence < 1 ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(seed.processNonce)) {
    throw new Error('Test workspace run namespace seed is invalid');
  }
  const digest = rawSha256(JSON.stringify({
    parentNamespace: parentNamespace ?? null,
    processId: seed.processId,
    processNonce: seed.processNonce,
    runSequence: seed.runSequence
  })).slice('sha256:'.length);
  return `fast-${digest}`;
}

export function deriveAssignedTestWorkspaceRunChild(input: {
  readonly parentNamespace: string;
  readonly nonceDigest: `sha256:${string}`;
  readonly issuerProcessId: number;
  readonly supervisorLeaseDigest: `sha256:${string}`;
}): string {
  const parentNamespace = resolveTestWorkspaceNamespace({
    [TEST_WORKSPACE_NAMESPACE_ENV]: input.parentNamespace
  });
  if (parentNamespace === undefined || !/^sha256:[0-9a-f]{64}$/u.test(input.nonceDigest) ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.supervisorLeaseDigest) ||
    !Number.isSafeInteger(input.issuerProcessId) || input.issuerProcessId < 1) {
    throw new Error('Test workspace run-child assignment seed is invalid');
  }
  return `fast-${rawSha256(JSON.stringify({
    domain: 'sec-test-workspace-run-child-assignment-name-v1',
    parentNamespace,
    nonceDigest: input.nonceDigest,
    issuerProcessId: input.issuerProcessId,
    supervisorLeaseDigest: input.supervisorLeaseDigest
  })).slice('sha256:'.length)}`;
}

export function createTestWorkspaceRunChildAssignment(input: {
  readonly parentNamespace: string;
  readonly issuerProcessId: number;
  readonly device: string;
  readonly inode: string;
  readonly nonce?: string;
  readonly supervisorLeaseDigest: `sha256:${string}`;
  readonly supervisorLeasePath: string;
  readonly supervisorLeaseDevice: string;
  readonly supervisorLeaseInode: string;
  readonly namespaceDevice: string;
  readonly namespaceInode: string;
}): TestWorkspaceRunChildAssignment {
  const nonce = input.nonce ?? randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{64}$/u.test(nonce) || !input.device || !input.inode ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.supervisorLeaseDigest) ||
    !path.isAbsolute(input.supervisorLeasePath) || !input.supervisorLeaseDevice || !input.supervisorLeaseInode ||
    !input.namespaceDevice || !input.namespaceInode) {
    throw new Error('Test workspace run-child assignment material is invalid');
  }
  const nonceDigest = rawSha256(nonce);
  const draft = Object.freeze({
    schema: TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA,
    name: deriveAssignedTestWorkspaceRunChild({
      parentNamespace: input.parentNamespace,
      nonceDigest,
      issuerProcessId: input.issuerProcessId,
      supervisorLeaseDigest: input.supervisorLeaseDigest
    }),
    nonce,
    nonceDigest,
    issuerProcessId: input.issuerProcessId,
    supervisorLeaseDigest: input.supervisorLeaseDigest,
    supervisorLeasePath: path.resolve(input.supervisorLeasePath),
    supervisorLeaseDevice: input.supervisorLeaseDevice,
    supervisorLeaseInode: input.supervisorLeaseInode,
    namespaceDevice: input.namespaceDevice,
    namespaceInode: input.namespaceInode,
    device: input.device,
    inode: input.inode
  });
  return Object.freeze({ ...draft, assignmentDigest: rawSha256(JSON.stringify(draft)) });
}

type TestWorkspaceSupervisorChallenge = Readonly<{
  schema: typeof TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA;
  name: string;
  nonceDigest: `sha256:${string}`;
  supervisorLeaseDigest: `sha256:${string}`;
  assignmentDigest: `sha256:${string}`;
  challengeDigest: `sha256:${string}`;
}>;

function testWorkspaceSupervisorChallenge(
  assignment: TestWorkspaceRunChildAssignment
): TestWorkspaceSupervisorChallenge {
  const draft = Object.freeze({
    schema: TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA,
    name: assignment.name,
    nonceDigest: assignment.nonceDigest,
    supervisorLeaseDigest: assignment.supervisorLeaseDigest,
    assignmentDigest: assignment.assignmentDigest
  });
  return Object.freeze({ ...draft, challengeDigest: rawSha256(JSON.stringify(draft)) });
}

function parseTestWorkspaceSupervisorChallenge(value: unknown): TestWorkspaceSupervisorChallenge {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'schema', 'name', 'nonceDigest', 'supervisorLeaseDigest', 'assignmentDigest', 'challengeDigest'
  ])) throw new Error('Test workspace supervisor challenge shape is invalid');
  const candidate = value as Record<string, unknown>;
  const draft = {
    schema: candidate.schema,
    name: candidate.name,
    nonceDigest: candidate.nonceDigest,
    supervisorLeaseDigest: candidate.supervisorLeaseDigest,
    assignmentDigest: candidate.assignmentDigest
  };
  if (candidate.schema !== TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA ||
    !/^fast-[0-9a-f]{64}$/u.test(String(candidate.name)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(candidate.nonceDigest)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(candidate.supervisorLeaseDigest)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(candidate.assignmentDigest)) ||
    candidate.challengeDigest !== rawSha256(JSON.stringify(draft))) {
    throw new Error('Test workspace supervisor challenge binding is invalid');
  }
  return Object.freeze(candidate as unknown as TestWorkspaceSupervisorChallenge);
}

export type TestWorkspaceSupervisorChallengeServer = Readonly<{
  authorize: (assignment: TestWorkspaceRunChildAssignment) => void;
  assertConsumed: (assignment: TestWorkspaceRunChildAssignment) => void;
  close: () => Promise<void>;
}>;

type TestWorkspaceSupervisorChallengeState = {
  authorizedDigest: `sha256:${string}` | null;
  consumedDigest: `sha256:${string}` | null;
  consumptionAsserted: boolean;
  closed: boolean;
};

function respondToSupervisorChallenge(
  socket: Socket,
  state: TestWorkspaceSupervisorChallengeState,
  expectedLeaseDigest: `sha256:${string}`
): void {
  let bytes = Buffer.alloc(0);
  let settled = false;
  const reject = (): void => {
    if (settled) return;
    settled = true;
    socket.destroy();
  };
  socket.setTimeout(TEST_WORKSPACE_SUPERVISOR_CHALLENGE_TIMEOUT_MS, reject);
  socket.on('error', () => undefined);
  socket.on('data', (chunk: Buffer) => {
    if (settled) return;
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.byteLength > TEST_WORKSPACE_SUPERVISOR_CHALLENGE_MAX_BYTES) {
      reject();
      return;
    }
    const newline = bytes.indexOf(0x0a);
    if (newline < 0) return;
    if (newline !== bytes.byteLength - 1) {
      reject();
      return;
    }
    try {
      const challenge = parseTestWorkspaceSupervisorChallenge(JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, newline))
      ));
      if (challenge.supervisorLeaseDigest !== expectedLeaseDigest ||
        state.authorizedDigest !== challenge.challengeDigest || state.consumedDigest !== null || state.closed) {
        reject();
        return;
      }
      state.authorizedDigest = null;
      state.consumedDigest = challenge.challengeDigest;
      settled = true;
      socket.end(`${JSON.stringify({
        schema: TEST_WORKSPACE_SUPERVISOR_CHALLENGE_ACK_SCHEMA,
        challengeDigest: challenge.challengeDigest
      })}\n`);
    } catch {
      reject();
    }
  });
}

export async function acquireTestWorkspaceSupervisorChallengeServer(input: {
  readonly executionSnapshotRoot: string;
  readonly supervisorLeaseDigest: `sha256:${string}`;
}): Promise<TestWorkspaceSupervisorChallengeServer> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.supervisorLeaseDigest)) {
    throw new Error('Test workspace supervisor challenge lease digest is invalid');
  }
  const snapshot = testWorkspaceGateSnapshotBinding(input.executionSnapshotRoot);
  const state: TestWorkspaceSupervisorChallengeState = {
    authorizedDigest: null,
    consumedDigest: null,
    consumptionAsserted: false,
    closed: false
  };
  const server: Server = createServer((socket) => {
    respondToSupervisorChallenge(socket, state, input.supervisorLeaseDigest);
  });
  server.unref();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      reject(error.code === 'EADDRINUSE'
        ? new Error('Test workspace supervisor challenge already has a live issuer')
        : new Error(`Test workspace supervisor challenge failed (${error.code ?? 'UNKNOWN'})`));
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ path: snapshot.challengeEndpoint, exclusive: true });
  });
  let closed = false;
  return Object.freeze({
    authorize: (assignment: TestWorkspaceRunChildAssignment): void => {
      const challenge = testWorkspaceSupervisorChallenge(assignment);
      if (assignment.supervisorLeaseDigest !== input.supervisorLeaseDigest ||
        state.closed || state.consumedDigest !== null || state.authorizedDigest !== null) {
        throw new Error('Test workspace supervisor challenge assignment is invalid or duplicated');
      }
      state.authorizedDigest = challenge.challengeDigest;
    },
    assertConsumed: (assignment: TestWorkspaceRunChildAssignment): void => {
      const challenge = testWorkspaceSupervisorChallenge(assignment);
      if (assignment.supervisorLeaseDigest !== input.supervisorLeaseDigest || state.closed ||
        state.authorizedDigest !== null || state.consumedDigest !== challenge.challengeDigest ||
        state.consumptionAsserted) {
        throw new Error('Test workspace supervisor challenge was not consumed exactly once');
      }
      state.consumptionAsserted = true;
    },
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      state.closed = true;
      state.authorizedDigest = null;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });
}

export async function consumeTestWorkspaceSupervisorChallenge(
  assignment: TestWorkspaceRunChildAssignment
): Promise<TestWorkspaceRunChildAuthority> {
  const snapshot = testWorkspaceGateSnapshotBinding(compilerRoot);
  const challenge = testWorkspaceSupervisorChallenge(assignment);
  const requestBytes = Buffer.from(`${JSON.stringify(challenge)}\n`, 'utf8');
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(snapshot.challengeEndpoint);
    let response = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error === undefined ? resolve() : reject(error);
    };
    socket.setTimeout(TEST_WORKSPACE_SUPERVISOR_CHALLENGE_TIMEOUT_MS, () => {
      finish(new Error('runFastTests caller supervisor challenge timed out'));
    });
    socket.once('connect', () => socket.write(requestBytes));
    socket.once('error', () => finish(new Error('runFastTests caller supervisor challenge is unavailable')));
    socket.once('close', () => {
      if (!settled) finish(new Error('runFastTests caller supervisor challenge was rejected'));
    });
    socket.on('data', (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.byteLength > TEST_WORKSPACE_SUPERVISOR_CHALLENGE_MAX_BYTES) {
        finish(new Error('runFastTests caller supervisor challenge response exceeded its bound'));
        return;
      }
      const newline = response.indexOf(0x0a);
      if (newline < 0) return;
      try {
        const ack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
          response.subarray(0, newline)
        )) as unknown;
        if (!ack || typeof ack !== 'object' || Array.isArray(ack) || !exactObjectKeys(ack, [
          'schema', 'challengeDigest'
        ]) || (ack as Record<string, unknown>).schema !== TEST_WORKSPACE_SUPERVISOR_CHALLENGE_ACK_SCHEMA ||
          (ack as Record<string, unknown>).challengeDigest !== challenge.challengeDigest ||
          newline !== response.byteLength - 1) {
          finish(new Error('runFastTests caller supervisor challenge response is invalid'));
          return;
        }
        finish();
      } catch {
        finish(new Error('runFastTests caller supervisor challenge response is malformed'));
      }
    });
  });
  const authority = Object.freeze({ schema: 'sec-test-workspace-run-child-authority-v1' as const });
  testWorkspaceRunChildAuthorities.set(authority, assignment);
  return authority;
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function parseTestWorkspaceRunChildAssignmentProjection(
  serialized: string | undefined,
  parentNamespace: string,
  runChild: string,
  input: Readonly<{
    executionSnapshotRoot: string;
    issuerBinding: 'direct-parent' | 'live-supervisor';
  }>
): TestWorkspaceRunChildAssignment {
  if (!serialized) throw new Error('runFastTests caller-assigned workspace child has no opaque assignment');
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('runFastTests caller-assigned workspace child assignment is malformed');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'schema', 'name', 'nonce', 'nonceDigest', 'issuerProcessId', 'supervisorLeaseDigest',
    'supervisorLeasePath', 'supervisorLeaseDevice', 'supervisorLeaseInode',
    'namespaceDevice', 'namespaceInode', 'device', 'inode', 'assignmentDigest'
  ])) throw new Error('runFastTests caller-assigned workspace child assignment shape is invalid');
  const candidate = value as Record<string, unknown>;
  const draft = {
    schema: candidate.schema,
    name: candidate.name,
    nonce: candidate.nonce,
    nonceDigest: candidate.nonceDigest,
    issuerProcessId: candidate.issuerProcessId,
    supervisorLeaseDigest: candidate.supervisorLeaseDigest,
    supervisorLeasePath: candidate.supervisorLeasePath,
    supervisorLeaseDevice: candidate.supervisorLeaseDevice,
    supervisorLeaseInode: candidate.supervisorLeaseInode,
    namespaceDevice: candidate.namespaceDevice,
    namespaceInode: candidate.namespaceInode,
    device: candidate.device,
    inode: candidate.inode
  };
  const supervisorLease = bindTestWorkspaceSupervisorLeaseProjection(
    String(candidate.supervisorLeasePath),
    parentNamespace,
    input.executionSnapshotRoot
  );
  const issuerProcessId = Number(candidate.issuerProcessId);
  const issuerBindingValid = input.issuerBinding === 'direct-parent'
    ? issuerProcessId === process.ppid
    : processIsAlive(issuerProcessId);
  if (candidate.schema !== TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA ||
    !/^[0-9a-f]{64}$/u.test(String(candidate.nonce)) ||
    candidate.nonceDigest !== rawSha256(String(candidate.nonce)) ||
    !Number.isSafeInteger(candidate.issuerProcessId) || issuerProcessId < 1 ||
    !issuerBindingValid ||
    issuerProcessId !== supervisorLease.record.issuerProcessId ||
    candidate.supervisorLeaseDigest !== supervisorLease.record.leaseDigest ||
    candidate.supervisorLeasePath !== supervisorLease.path ||
    candidate.supervisorLeaseDevice !== supervisorLease.device ||
    candidate.supervisorLeaseInode !== supervisorLease.inode ||
    typeof candidate.namespaceDevice !== 'string' || candidate.namespaceDevice.length === 0 ||
    typeof candidate.namespaceInode !== 'string' || candidate.namespaceInode.length === 0 ||
    typeof candidate.device !== 'string' || candidate.device.length === 0 ||
    typeof candidate.inode !== 'string' || candidate.inode.length === 0 ||
    candidate.name !== runChild ||
    candidate.name !== deriveAssignedTestWorkspaceRunChild({
      parentNamespace,
      nonceDigest: candidate.nonceDigest as `sha256:${string}`,
      issuerProcessId,
      supervisorLeaseDigest: candidate.supervisorLeaseDigest as `sha256:${string}`
    }) ||
    candidate.assignmentDigest !== rawSha256(JSON.stringify(draft))) {
    throw new Error('runFastTests caller-assigned workspace child assignment is invalid');
  }
  return Object.freeze(candidate as unknown as TestWorkspaceRunChildAssignment);
}

export function parseTestWorkspaceRunChildAssignment(
  serialized: string | undefined,
  parentNamespace: string,
  runChild: string
): TestWorkspaceRunChildAssignment {
  return parseTestWorkspaceRunChildAssignmentProjection(serialized, parentNamespace, runChild, {
    executionSnapshotRoot: compilerRoot,
    issuerBinding: 'direct-parent'
  });
}

function bindTestWorkspaceChildLocator(
  serialized: string,
  parentNamespace: string,
  runChild: string
): TestWorkspaceRunChildAssignment {
  const assignment = parseTestWorkspaceRunChildAssignmentProjection(
    serialized,
    parentNamespace,
    runChild,
    { executionSnapshotRoot: compilerRoot, issuerBinding: 'live-supervisor' }
  );
  const snapshot = testWorkspaceGateSnapshotBinding(compilerRoot);
  const namespaceRoot = inspectNoFollowDirectoryChain(
    path.join(snapshot.executionSnapshotRoot, '.tmp', 'test-workspaces', parentNamespace),
    'Bound test workspace namespace locator'
  ).target;
  const child = inspectNoFollowDirectoryChild(
    namespaceRoot,
    runChild,
    'Bound test workspace child locator'
  );
  if (namespaceRoot.device !== assignment.namespaceDevice ||
    namespaceRoot.inode !== assignment.namespaceInode || child === null ||
    child.device !== assignment.device || child.inode !== assignment.inode) {
    throw new Error('Bound test workspace child locator physical identity changed');
  }
  return assignment;
}

export function getTestWorkspaceTempRoot(env: NodeJS.ProcessEnv = process.env): string {
  const effectiveEnvironment = { ...process.env, ...env };
  const namespace = resolveTestWorkspaceNamespace(effectiveEnvironment);
  const runChild = resolveTestWorkspaceRunChild(effectiveEnvironment);
  if (runChild && !namespace) {
    throw new Error(`${TEST_WORKSPACE_RUN_CHILD_ENV} requires ${TEST_WORKSPACE_NAMESPACE_ENV}`);
  }
  const boundChildLocator = effectiveEnvironment[TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV]?.trim();
  if (boundChildLocator !== undefined && (namespace === undefined || runChild === undefined)) {
    throw new Error(`${TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV} requires an exact namespace and run child`);
  }
  const hasBoundGateChild = boundChildLocator !== undefined && namespace !== undefined && runChild !== undefined;
  if (hasBoundGateChild) bindTestWorkspaceChildLocator(boundChildLocator, namespace, runChild);
  const physicalCompilerRoot = realpathSync.native(compilerRoot);
  const root = hasBoundGateChild
    ? path.join(compilerRoot, '.tmp', 'test-workspaces')
    : process.platform === 'darwin'
      ? path.join(
          tmpdir(),
          'sec-test-workspaces',
          'runs',
          rawSha256(physicalCompilerRoot).slice('sha256:'.length)
        )
    : path.join(
        resolveRuntimeCacheRoot({
          platform: currentRuntimePlatform(),
          environment: runtimeStateEnvironment(effectiveEnvironment),
          repositoryRoot: physicalCompilerRoot
        }),
        'test-workspaces',
        'runs',
        rawSha256(process.platform === 'win32'
          ? physicalCompilerRoot.toLocaleLowerCase('en-US')
          : physicalCompilerRoot).slice('sha256:'.length)
      );
  if (!namespace) return root;
  return runChild ? path.join(root, namespace, runChild) : path.join(root, namespace);
}

export function getTestWorkspaceTemplateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getTestWorkspaceTempRoot({ ...env,
    [TEST_WORKSPACE_NAMESPACE_ENV]: undefined,
    [TEST_WORKSPACE_RUN_CHILD_ENV]: undefined,
    [TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV]: undefined
  }), '.templates');
}

export function testWorkspaceCleanupModeForPlatform(
  platform: NodeJS.Platform,
  callerAssigned: boolean
): 'darwin-os-managed' | 'retained' | 'unavailable' {
  if (platform === 'win32' || platform === 'linux') return 'retained';
  if (platform === 'darwin' && !callerAssigned) return 'darwin-os-managed';
  return 'unavailable';
}

export function prepareTestWorkspaceRun(
  env: NodeJS.ProcessEnv,
  authority: TestWorkspaceRunChildAuthority | null
): PreparedTestWorkspaceRun {
  let expectedAssignment: TestWorkspaceRunChildAssignment | null = null;
  if (authority !== null) {
    const boundAssignment = testWorkspaceRunChildAuthorities.get(authority);
    if (boundAssignment === undefined || consumedTestWorkspaceRunChildAuthorities.has(authority)) {
      throw new Error('Test workspace run-child cleanup authority is invalid or already consumed');
    }
    consumedTestWorkspaceRunChildAuthorities.add(authority);
    expectedAssignment = boundAssignment;
  }
  const targetPath = getTestWorkspaceTempRoot(env);
  const parentPath = path.dirname(targetPath);
  const cleanupMode = testWorkspaceCleanupModeForPlatform(process.platform, expectedAssignment !== null);
  if (cleanupMode === 'unavailable') {
    throw new Error('Test workspace cleanup capability is unavailable on this platform');
  }
  if (cleanupMode === 'darwin-os-managed') {
    mkdirSync(parentPath, { recursive: true });
    mkdirSync(targetPath);
    const token = Object.freeze({ schema: 'prepared-test-workspace-run-v1' as const });
    preparedTestWorkspaceRuns.set(token, {
      mode: 'darwin-os-managed',
      settled: false
    });
    return token;
  }
  if (expectedAssignment === null) mkdirSync(parentPath, { recursive: true });
  const parent = inspectNoFollowDirectoryChain(parentPath, 'Test workspace run parent').target;
  let target: PhysicalDirectoryIdentity;
  if (expectedAssignment === null) {
    target = createNoFollowDirectoryChain(parent, [path.basename(targetPath)]);
  } else {
    if (parent.device !== expectedAssignment.namespaceDevice || parent.inode !== expectedAssignment.namespaceInode) {
      throw new Error('Test workspace caller-assigned parent physical identity changed before adoption');
    }
    const observed = inspectNoFollowDirectoryChild(
      parent,
      path.basename(targetPath),
      'Test workspace caller-assigned child'
    );
    if (observed === null || observed.device !== expectedAssignment.device ||
      observed.inode !== expectedAssignment.inode) {
      throw new Error('Test workspace caller-assigned child physical identity changed before adoption');
    }
    target = observed;
  }
  const token = Object.freeze({ schema: 'prepared-test-workspace-run-v1' as const });
  preparedTestWorkspaceRuns.set(token, { mode: 'retained', target, parent, settled: false });
  return token;
}

export function settlePreparedTestWorkspaceRun(token: PreparedTestWorkspaceRun): void {
  const state = preparedTestWorkspaceRuns.get(token);
  if (state === undefined || state.settled) {
    throw new Error('Test workspace run cleanup capability is invalid or already consumed');
  }
  if (state.mode === 'darwin-os-managed') {
    // Darwin's path APIs cannot condition recursive deletion on the directory
    // identity retained at creation. The OS temporary lifecycle owns eventual
    // reclamation; SEC deliberately holds no destructive cleanup authority.
    state.settled = true;
    return;
  }
  const inventory = scanNoFollowDirectoryTreeMetadata(state.target, {
    deadlineAtMs: performance.now() + TEST_WORKSPACE_CLEANUP_SCAN_BUDGET_MS,
    maximumEntries: 100_000
  });
  const directories = new Map(inventory
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => [entry.relativePath, entry]));
  for (const entry of [...inventory].sort((left, right) => {
    const depth = (value: string): number => value.split('/').length;
    return depth(right.relativePath) - depth(left.relativePath) ||
      right.relativePath.localeCompare(left.relativePath);
  })) {
    const components = entry.relativePath.split('/');
    components.pop();
    const ancestorDirectories = components.map((_, index) => {
      const relativePath = components.slice(0, index + 1).join('/');
      const ancestor = directories.get(relativePath);
      if (ancestor === undefined) throw new Error('Test workspace run cleanup ancestor inventory is incomplete');
      return Object.freeze({ relativePath, device: ancestor.device, inode: ancestor.inode });
    });
    deleteRetainedNoFollowEntry({
      root: state.target,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories
    });
  }
  deleteRetainedNoFollowEntry({
    root: state.parent,
    relativePath: path.basename(state.target.path),
    kind: 'directory',
    device: state.target.device,
    inode: state.target.inode,
    ancestorDirectories: []
  });
  if (inspectExactNoFollowDirectoryPresence(state.target.path, 'Test workspace run cleanup readback').state !== 'absent') {
    throw new Error('Test workspace run cleanup did not reach exact absence');
  }
  state.settled = true;
}

export function commandPath(binPath: string, base: string): string {
  return path.join(binPath, process.platform === 'win32' ? `${base}.exe` : base);
}
