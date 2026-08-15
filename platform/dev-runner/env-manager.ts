import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';

import { rawSha256 } from '../shared/canonical-primitives.ts';
import { compilerRoot } from '../shared/paths.ts';
import {
  createNoFollowDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChildV1,
  inspectNoFollowOrdinaryFileEntryV1,
  scanNoFollowDirectoryTreeMetadataV1,
  type PhysicalDirectoryIdentityV1
} from '../shared/physical-no-follow.ts';

export { pathEnvKey } from '../shared/process.ts';

export const TEST_WORKSPACE_NAMESPACE_ENV = 'SEC_TEST_WORKSPACE_NAMESPACE';
export const TEST_WORKSPACE_RUN_CHILD_ENV = 'SEC_TEST_WORKSPACE_RUN_CHILD';
export const TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV = 'SEC_TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT';
export const TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA_V1 = 'sec-test-workspace-run-child-assignment-v1';
export const TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA_V1 = 'sec-test-workspace-supervisor-lease-v1';
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA_V1 = 'sec-test-workspace-supervisor-challenge-v1';
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_ACK_SCHEMA_V1 = 'sec-test-workspace-supervisor-challenge-ack-v1';
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_MAX_BYTES = 4_096;
const TEST_WORKSPACE_SUPERVISOR_CHALLENGE_TIMEOUT_MS = 5_000;
const TEST_WORKSPACE_CLEANUP_SCAN_BUDGET_MS = 10_000;

export type TestWorkspaceSupervisorLeaseV1 = Readonly<{
  schema: typeof TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA_V1;
  namespace: string;
  runId: string;
  repositoryRoot: string;
  executionSnapshotRoot: string;
  issuerProcessId: number;
  nonce: string;
  leaseDigest: `sha256:${string}`;
}>;

export type TestWorkspaceSupervisorLeaseBindingV1 = Readonly<{
  record: TestWorkspaceSupervisorLeaseV1;
  path: string;
  device: string;
  inode: string;
}>;

export type TestWorkspaceRunNamespaceSeedV1 = Readonly<{
  parentNamespace?: string;
  processId: number;
  processNonce: string;
  runSequence: number;
}>;

export type TestWorkspaceRunChildAssignmentV1 = Readonly<{
  schema: typeof TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA_V1;
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

export interface PreparedTestWorkspaceRunV1 {
  readonly schema: 'prepared-test-workspace-run-v1';
}

type PreparedTestWorkspaceRunStateV1 =
  | {
      readonly mode: 'retained';
      readonly target: PhysicalDirectoryIdentityV1;
      readonly parent: PhysicalDirectoryIdentityV1;
      settled: boolean;
    }
  | {
      readonly mode: 'darwin-ordinary';
      readonly targetPath: string;
      readonly tombstonePath: string;
      readonly device: bigint;
      readonly inode: bigint;
      settled: boolean;
    };

const preparedTestWorkspaceRuns = new WeakMap<object, PreparedTestWorkspaceRunStateV1>();

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

type TestWorkspaceGateSnapshotBindingV1 = Readonly<{
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

export function testWorkspaceGateSnapshotBindingV1(
  executionSnapshotRoot: string
): TestWorkspaceGateSnapshotBindingV1 {
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

export function createTestWorkspaceSupervisorLeaseV1(input: {
  readonly namespace: string;
  readonly runId: string;
  readonly repositoryRoot: string;
  readonly executionSnapshotRoot: string;
  readonly issuerProcessId: number;
  readonly nonce: string;
}): TestWorkspaceSupervisorLeaseV1 {
  const namespace = resolveTestWorkspaceNamespace({ [TEST_WORKSPACE_NAMESPACE_ENV]: input.namespace });
  const snapshot = testWorkspaceGateSnapshotBindingV1(input.executionSnapshotRoot);
  if (namespace === undefined || !input.runId || input.runId !== input.runId.trim() ||
    namespace !== snapshot.namespace ||
    canonicalFilesystemPath(input.repositoryRoot) !== canonicalFilesystemPath(snapshot.repositoryRoot) ||
    !Number.isSafeInteger(input.issuerProcessId) || input.issuerProcessId < 1 ||
    !/^[0-9a-f]{64}$/u.test(input.nonce)) {
    throw new Error('Test workspace supervisor lease material is invalid');
  }
  const draft = Object.freeze({
    schema: TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA_V1,
    namespace,
    runId: input.runId,
    repositoryRoot: snapshot.repositoryRoot,
    executionSnapshotRoot: snapshot.executionSnapshotRoot,
    issuerProcessId: input.issuerProcessId,
    nonce: input.nonce
  });
  return Object.freeze({ ...draft, leaseDigest: rawSha256(JSON.stringify(draft)) });
}

export function testWorkspaceSupervisorLeasePathV1(namespace: string): string {
  const normalized = resolveTestWorkspaceNamespace({ [TEST_WORKSPACE_NAMESPACE_ENV]: namespace });
  if (normalized === undefined) throw new Error('Test workspace supervisor namespace is unavailable');
  return path.join(compilerRoot, '.tmp', 'test-workspaces', '.gate-supervisor-leases', `${normalized}.lock`);
}

function bindTestWorkspaceSupervisorLeaseProjectionV1(
  leasePath: string,
  namespace: string,
  executionSnapshotRoot: string
): TestWorkspaceSupervisorLeaseBindingV1 {
  const snapshot = testWorkspaceGateSnapshotBindingV1(executionSnapshotRoot);

  const normalizedNamespace = resolveTestWorkspaceNamespace({ [TEST_WORKSPACE_NAMESPACE_ENV]: namespace });
  if (normalizedNamespace === undefined || !path.isAbsolute(leasePath) ||
    normalizedNamespace !== snapshot.namespace ||
    canonicalFilesystemPath(leasePath) !== canonicalFilesystemPath(snapshot.supervisorLeasePath)) {
    throw new Error('runFastTests caller supervisor lease path is invalid');
  }
  const resolvedLeasePath = path.resolve(leasePath);
  const parent = inspectNoFollowDirectoryChainV1(
    path.dirname(resolvedLeasePath),
    'runFastTests caller supervisor lease parent'
  ).target;
  const entry = inspectNoFollowOrdinaryFileEntryV1(parent, path.basename(resolvedLeasePath));
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
  if (candidate.schema !== TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA_V1 ||
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
    record: Object.freeze(candidate as unknown as TestWorkspaceSupervisorLeaseV1),
    path: resolvedLeasePath,
    device: entry.device,
    inode: entry.inode
  });
}

export function bindTestWorkspaceSupervisorLeaseV1(
  leasePath: string,
  namespace: string
): TestWorkspaceSupervisorLeaseBindingV1 {
  return bindTestWorkspaceSupervisorLeaseProjectionV1(leasePath, namespace, compilerRoot);
}

export function bindTestWorkspaceSupervisorLeaseIssuerProjectionV1(
  leasePath: string,
  namespace: string,
  executionSnapshotRoot: string
): TestWorkspaceSupervisorLeaseBindingV1 {
  return bindTestWorkspaceSupervisorLeaseProjectionV1(leasePath, namespace, executionSnapshotRoot);
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
export function deriveTestWorkspaceRunNamespaceV1(seed: TestWorkspaceRunNamespaceSeedV1): string {
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

export function deriveAssignedTestWorkspaceRunChildV1(input: {
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

export function createTestWorkspaceRunChildAssignmentV1(input: {
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
}): TestWorkspaceRunChildAssignmentV1 {
  const nonce = input.nonce ?? randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{64}$/u.test(nonce) || !input.device || !input.inode ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.supervisorLeaseDigest) ||
    !path.isAbsolute(input.supervisorLeasePath) || !input.supervisorLeaseDevice || !input.supervisorLeaseInode ||
    !input.namespaceDevice || !input.namespaceInode) {
    throw new Error('Test workspace run-child assignment material is invalid');
  }
  const nonceDigest = rawSha256(nonce);
  const draft = Object.freeze({
    schema: TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA_V1,
    name: deriveAssignedTestWorkspaceRunChildV1({
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

type TestWorkspaceSupervisorChallengeV1 = Readonly<{
  schema: typeof TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA_V1;
  name: string;
  nonceDigest: `sha256:${string}`;
  supervisorLeaseDigest: `sha256:${string}`;
  assignmentDigest: `sha256:${string}`;
  challengeDigest: `sha256:${string}`;
}>;

function testWorkspaceSupervisorChallengeV1(
  assignment: TestWorkspaceRunChildAssignmentV1
): TestWorkspaceSupervisorChallengeV1 {
  const draft = Object.freeze({
    schema: TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA_V1,
    name: assignment.name,
    nonceDigest: assignment.nonceDigest,
    supervisorLeaseDigest: assignment.supervisorLeaseDigest,
    assignmentDigest: assignment.assignmentDigest
  });
  return Object.freeze({ ...draft, challengeDigest: rawSha256(JSON.stringify(draft)) });
}

function parseTestWorkspaceSupervisorChallengeV1(value: unknown): TestWorkspaceSupervisorChallengeV1 {
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
  if (candidate.schema !== TEST_WORKSPACE_SUPERVISOR_CHALLENGE_SCHEMA_V1 ||
    !/^fast-[0-9a-f]{64}$/u.test(String(candidate.name)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(candidate.nonceDigest)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(candidate.supervisorLeaseDigest)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(candidate.assignmentDigest)) ||
    candidate.challengeDigest !== rawSha256(JSON.stringify(draft))) {
    throw new Error('Test workspace supervisor challenge binding is invalid');
  }
  return Object.freeze(candidate as unknown as TestWorkspaceSupervisorChallengeV1);
}

export type TestWorkspaceSupervisorChallengeServerV1 = Readonly<{
  authorize: (assignment: TestWorkspaceRunChildAssignmentV1) => void;
  assertConsumed: (assignment: TestWorkspaceRunChildAssignmentV1) => void;
  close: () => Promise<void>;
}>;

type TestWorkspaceSupervisorChallengeStateV1 = {
  authorizedDigest: `sha256:${string}` | null;
  consumedDigest: `sha256:${string}` | null;
  consumptionAsserted: boolean;
  closed: boolean;
};

function respondToSupervisorChallenge(
  socket: Socket,
  state: TestWorkspaceSupervisorChallengeStateV1,
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
      const challenge = parseTestWorkspaceSupervisorChallengeV1(JSON.parse(
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
        schema: TEST_WORKSPACE_SUPERVISOR_CHALLENGE_ACK_SCHEMA_V1,
        challengeDigest: challenge.challengeDigest
      })}\n`);
    } catch {
      reject();
    }
  });
}

export async function acquireTestWorkspaceSupervisorChallengeServerV1(input: {
  readonly executionSnapshotRoot: string;
  readonly supervisorLeaseDigest: `sha256:${string}`;
}): Promise<TestWorkspaceSupervisorChallengeServerV1> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.supervisorLeaseDigest)) {
    throw new Error('Test workspace supervisor challenge lease digest is invalid');
  }
  const snapshot = testWorkspaceGateSnapshotBindingV1(input.executionSnapshotRoot);
  const state: TestWorkspaceSupervisorChallengeStateV1 = {
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
    authorize: (assignment: TestWorkspaceRunChildAssignmentV1): void => {
      const challenge = testWorkspaceSupervisorChallengeV1(assignment);
      if (assignment.supervisorLeaseDigest !== input.supervisorLeaseDigest ||
        state.closed || state.consumedDigest !== null || state.authorizedDigest !== null) {
        throw new Error('Test workspace supervisor challenge assignment is invalid or duplicated');
      }
      state.authorizedDigest = challenge.challengeDigest;
    },
    assertConsumed: (assignment: TestWorkspaceRunChildAssignmentV1): void => {
      const challenge = testWorkspaceSupervisorChallengeV1(assignment);
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

export async function consumeTestWorkspaceSupervisorChallengeV1(
  assignment: TestWorkspaceRunChildAssignmentV1
): Promise<void> {
  const snapshot = testWorkspaceGateSnapshotBindingV1(compilerRoot);
  const challenge = testWorkspaceSupervisorChallengeV1(assignment);
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
        ]) || (ack as Record<string, unknown>).schema !== TEST_WORKSPACE_SUPERVISOR_CHALLENGE_ACK_SCHEMA_V1 ||
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
}

export function parseTestWorkspaceRunChildAssignmentV1(
  serialized: string | undefined,
  parentNamespace: string,
  runChild: string
): TestWorkspaceRunChildAssignmentV1 {
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
  const supervisorLease = bindTestWorkspaceSupervisorLeaseV1(
    String(candidate.supervisorLeasePath),
    parentNamespace
  );
  if (candidate.schema !== TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA_V1 ||
    !/^[0-9a-f]{64}$/u.test(String(candidate.nonce)) ||
    candidate.nonceDigest !== rawSha256(String(candidate.nonce)) ||
    !Number.isSafeInteger(candidate.issuerProcessId) || Number(candidate.issuerProcessId) < 1 ||
    candidate.issuerProcessId !== process.ppid ||
    candidate.issuerProcessId !== supervisorLease.record.issuerProcessId ||
    candidate.supervisorLeaseDigest !== supervisorLease.record.leaseDigest ||
    candidate.supervisorLeasePath !== supervisorLease.path ||
    candidate.supervisorLeaseDevice !== supervisorLease.device ||
    candidate.supervisorLeaseInode !== supervisorLease.inode ||
    typeof candidate.namespaceDevice !== 'string' || candidate.namespaceDevice.length === 0 ||
    typeof candidate.namespaceInode !== 'string' || candidate.namespaceInode.length === 0 ||
    typeof candidate.device !== 'string' || candidate.device.length === 0 ||
    typeof candidate.inode !== 'string' || candidate.inode.length === 0 ||
    candidate.name !== runChild ||
    candidate.name !== deriveAssignedTestWorkspaceRunChildV1({
      parentNamespace,
      nonceDigest: candidate.nonceDigest as `sha256:${string}`,
      issuerProcessId: Number(candidate.issuerProcessId),
      supervisorLeaseDigest: candidate.supervisorLeaseDigest as `sha256:${string}`
    }) ||
    candidate.assignmentDigest !== rawSha256(JSON.stringify(draft))) {
    throw new Error('runFastTests caller-assigned workspace child assignment is invalid');
  }
  return Object.freeze(candidate as unknown as TestWorkspaceRunChildAssignmentV1);
}

export function getTestWorkspaceTempRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = path.join(compilerRoot, '.tmp', 'test-workspaces');
  const namespace = resolveTestWorkspaceNamespace(env);
  const runChild = resolveTestWorkspaceRunChild(env);
  if (runChild && !namespace) {
    throw new Error(`${TEST_WORKSPACE_RUN_CHILD_ENV} requires ${TEST_WORKSPACE_NAMESPACE_ENV}`);
  }
  if (!namespace) return root;
  return runChild ? path.join(root, namespace, runChild) : path.join(root, namespace);
}

export function getTestWorkspaceTemplateRoot(): string {
  return path.join(compilerRoot, '.tmp', 'test-workspaces', '.templates');
}

export function testWorkspaceCleanupModeForPlatformV1(
  platform: NodeJS.Platform,
  callerAssigned: boolean
): 'darwin-ordinary' | 'retained' | 'unavailable' {
  if (platform === 'win32' || platform === 'linux') return 'retained';
  if (platform === 'darwin' && !callerAssigned) return 'darwin-ordinary';
  return 'unavailable';
}

export function prepareTestWorkspaceRunV1(
  env: NodeJS.ProcessEnv,
  expectedAssignment: TestWorkspaceRunChildAssignmentV1 | null
): PreparedTestWorkspaceRunV1 {
  const targetPath = getTestWorkspaceTempRoot(env);
  const parentPath = path.dirname(targetPath);
  const cleanupMode = testWorkspaceCleanupModeForPlatformV1(process.platform, expectedAssignment !== null);
  if (cleanupMode === 'unavailable') {
    throw new Error('Test workspace cleanup capability is unavailable on this platform');
  }
  if (cleanupMode === 'darwin-ordinary') {
    mkdirSync(parentPath, { recursive: true });
    const parentMetadata = lstatSync(parentPath, { bigint: true });
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() ||
      path.resolve(realpathSync(parentPath)) !== path.resolve(parentPath)) {
      throw new Error('Darwin ordinary test workspace parent is not an exact directory');
    }
    mkdirSync(targetPath);
    const targetMetadata = lstatSync(targetPath, { bigint: true });
    if (!targetMetadata.isDirectory() || targetMetadata.isSymbolicLink() ||
      path.resolve(realpathSync(targetPath)) !== path.resolve(targetPath) ||
      targetMetadata.dev === 0n || targetMetadata.ino === 0n) {
      throw new Error('Darwin ordinary test workspace identity is ambiguous');
    }
    const token = Object.freeze({ schema: 'prepared-test-workspace-run-v1' as const });
    preparedTestWorkspaceRuns.set(token, {
      mode: 'darwin-ordinary',
      targetPath,
      tombstonePath: path.join(parentPath, `.retired-${randomBytes(32).toString('hex')}`),
      device: targetMetadata.dev,
      inode: targetMetadata.ino,
      settled: false
    });
    return token;
  }
  if (expectedAssignment === null) mkdirSync(parentPath, { recursive: true });
  const parent = inspectNoFollowDirectoryChainV1(parentPath, 'Test workspace run parent').target;
  let target: PhysicalDirectoryIdentityV1;
  if (expectedAssignment === null) {
    target = createNoFollowDirectoryChainV1(parent, [path.basename(targetPath)]);
  } else {
    if (parent.device !== expectedAssignment.namespaceDevice || parent.inode !== expectedAssignment.namespaceInode) {
      throw new Error('Test workspace caller-assigned parent physical identity changed before adoption');
    }
    const observed = inspectNoFollowDirectoryChildV1(
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

export function settlePreparedTestWorkspaceRunV1(token: PreparedTestWorkspaceRunV1): void {
  const state = preparedTestWorkspaceRuns.get(token);
  if (state === undefined || state.settled) {
    throw new Error('Test workspace run cleanup capability is invalid or already consumed');
  }
  if (state.mode === 'darwin-ordinary') {
    const before = lstatSync(state.targetPath, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || before.dev !== state.device || before.ino !== state.inode ||
      path.resolve(realpathSync(state.targetPath)) !== path.resolve(state.targetPath)) {
      throw new Error('Darwin ordinary test workspace identity changed before cleanup');
    }
    renameSync(state.targetPath, state.tombstonePath);
    const moved = lstatSync(state.tombstonePath, { bigint: true });
    if (!moved.isDirectory() || moved.isSymbolicLink() || moved.dev !== state.device || moved.ino !== state.inode) {
      throw new Error('Darwin ordinary test workspace rename selected a replacement');
    }
    rmSync(state.tombstonePath, { recursive: true, force: false });
    try {
      lstatSync(state.tombstonePath);
      throw new Error('Darwin ordinary test workspace cleanup did not reach absence');
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    state.settled = true;
    return;
  }
  const inventory = scanNoFollowDirectoryTreeMetadataV1(state.target, {
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
    deleteRetainedNoFollowEntryV1({
      root: state.target,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories
    });
  }
  deleteRetainedNoFollowEntryV1({
    root: state.parent,
    relativePath: path.basename(state.target.path),
    kind: 'directory',
    device: state.target.device,
    inode: state.target.inode,
    ancestorDirectories: []
  });
  if (inspectExactNoFollowDirectoryPresenceV1(state.target.path, 'Test workspace run cleanup readback').state !== 'absent') {
    throw new Error('Test workspace run cleanup did not reach exact absence');
  }
  state.settled = true;
}

export function commandPath(binPath: string, base: string): string {
  return path.join(binPath, process.platform === 'win32' ? `${base}.exe` : base);
}
