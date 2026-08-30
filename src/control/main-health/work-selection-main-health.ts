import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

import { readGitHubToken } from '../../external-capabilities/github-read/credential.ts';
import { acquirePhysicalMutationLease, type PhysicalMutationLeaseHandle } from '../../runtime-state/physical/runtime/mutation-lease.ts';
import { createNoFollowDirectoryChain, inspectExactNoFollowDirectoryPresence, inspectNoFollowOrdinaryFileEntry, PhysicalNoFollowError, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, scanNoFollowDirectoryTree, type PhysicalDirectoryIdentity } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecRuntimeStateForRepository } from '../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority, type SecRuntimeStatePhysicalAuthority } from '../../runtime-state/workspace-state/physical-authority.ts';
import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { encodeVerificationActionData } from '../../verification/action/contract/action.ts';
import type { GitHubCheckObservation } from '../../verification/ci/contract/github-observation.ts';
import { createTrustedRuntimeMainHealthSupersessionAuthorization, createTrustedRuntimeMainHealthSupersessionIntent, createTrustedRuntimeMainHealthSupersessionPermit, createTrustedRuntimeMainHealthSupersessionReceipt, parseTrustedRuntimeMainHealthReceipt, parseTrustedRuntimeMainHealthSupersessionIntent, parseTrustedRuntimeMainHealthSupersessionPermit, parseTrustedRuntimeMainHealthSupersessionReceipt, trustedRuntimeMainHealthSupersessionPermitBytes, trustedRuntimeMainHealthSupersessionReceiptBytes, trustedRuntimeMainHealthSupersessionRequestDigest, trustedRuntimeMainHealthSupersessionStatusRequest, type TrustedRuntimeMainHealthSupersessionAuthorization, type TrustedRuntimeMainHealthSupersessionIntent, type TrustedRuntimeMainHealthSupersessionPermit, type TrustedRuntimeMainHealthSupersessionReceipt } from '../../verification/trusted-runtime/trusted-runtime-container.ts';
import { dispatchGitHubApiRequest } from '../integration/integration-authorization-status-github.ts';
import type {
  SecCurrentWorkLifecycle,
  SecWorkDigest
} from '../work-selection/contract.ts';
import {
  createMainHealthLedger,
  resolveOrdinaryMainHealthLane,
  type MainHealthLedger
} from './contract.ts';
import {
  createRegisteredHostedMainHealthInputs,
  createTrustedLocalMainHealthInput,
  GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY,
  TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS
} from './main-health-observation.ts';
import {
  compileMainHealthRepairDecision,
  type MainHealthRepairDecision,
  type MainHealthRepairObservation
} from './repair.ts';

const WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA =
  'sec-work-selection-main-health-providers-v1' as const;

export type WorkSelectionMainHealthProviderObservation =
  | Readonly<{ kind: 'available'; ledger: MainHealthLedger }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'unavailable'; ref: SecWorkDigest }>
  | Readonly<{ kind: 'invalid'; ref: SecWorkDigest }>;

export type MainHealthGitHubFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type MainHealthGitHubCapabilityIssuer = Readonly<{
  transport: 'github-rest-token';
  login: string;
  nodeId: string;
  permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
}>;

declare const mainHealthGitHubCapabilityBrand: unique symbol;

/**
 * An in-process attenuated capability.  Deliberately do not put the token,
 * fetch function, repository or effect on this value: a caller must not be
 * able to recover the bearer credential and issue an unconstrained request.
 * The private WeakMap below is the only transport owner.
 */
export type MainHealthGitHubCapability = Readonly<{
  readonly [mainHealthGitHubCapabilityBrand]: true;
}>;

type MainHealthGitHubCapabilityBinding = Readonly<{
  repository: string;
  token: string;
  issuer: MainHealthGitHubCapabilityIssuer;
  effect: 'read' | 'status-write';
  fetchImpl: MainHealthGitHubFetch;
  origin: 'production' | 'test';
}>;

const mainHealthGitHubCapabilityBindings =
  new WeakMap<object, MainHealthGitHubCapabilityBinding>();

type MainHealthGitHubRequestSession = {
  capability: MainHealthGitHubCapability | undefined;
  readonly repository: string;
  readonly effect: 'read' | 'status-write';
  readonly origin: 'production' | 'test';
  readonly operationBudget: MainHealthGitHubOperationBudget | undefined;
  readonly now: () => number;
  readonly deadlineAt: number;
  readonly abortController: AbortController;
  readonly deadlineTimer: ReturnType<typeof setTimeout>;
  requestCount: number;
  responseBytes: number;
};

/**
 * A parent budget is deliberately not a capability.  It carries no token,
 * fetch function, issuer or provider authority; it only prevents a logical
 * operation from silently resetting its transport budget by opening an
 * unbounded sequence of independent sessions.
 */
type MainHealthGitHubOperationBudget = {
  readonly repositoryRoot: string;
  readonly repository: string;
  readonly effect: 'read' | 'status-write';
  readonly origin: 'production' | 'test';
  readonly now: () => number;
  readonly deadlineAt: number;
  readonly maxSessions: number;
  sessionCount: number;
  requestCount: number;
  responseBytes: number;
};

const mainHealthGitHubRequestSession =
  new AsyncLocalStorage<MainHealthGitHubRequestSession>();
const mainHealthGitHubOperationBudget =
  new AsyncLocalStorage<MainHealthGitHubOperationBudget>();

const MAIN_HEALTH_GITHUB_MAX_REQUESTS = 2_048;
const MAIN_HEALTH_GITHUB_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAIN_HEALTH_GITHUB_MAX_READ_SESSIONS = 2;
export const MAIN_HEALTH_GITHUB_READ_OPERATION_TIMEOUT_MS = 10 * 60_000;
const MAIN_HEALTH_GITHUB_API_ORIGIN = 'https://api.github.com' as const;
const MAIN_HEALTH_GITHUB_CREDENTIAL_MAX_TOKEN_BYTES = 1024 as const;

function createMainHealthGitHubRequestSession(input: Readonly<{
  capability?: MainHealthGitHubCapability;
  repository: string;
  effect: 'read' | 'status-write';
  origin: 'production' | 'test';
  operationBudget?: MainHealthGitHubOperationBudget;
  now?: () => number;
  timeoutMs?: number;
}>): MainHealthGitHubRequestSession {
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? MAIN_HEALTH_GITHUB_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation timeout must be a positive safe integer'
    );
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new MainHealthGitHubProviderError('MainHealth GitHub operation clock is invalid');
  }
  const deadlineAt = Math.min(
    startedAt + timeoutMs,
    input.operationBudget?.deadlineAt ?? Number.POSITIVE_INFINITY
  );
  if (!Number.isFinite(deadlineAt) || deadlineAt <= startedAt) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation parent deadline exceeded'
    );
  }
  const abortController = new AbortController();
  const deadlineTimer = setTimeout(
    () => abortController.abort(),
    Math.max(1, Math.ceil(deadlineAt - startedAt))
  );
  return {
    capability: input.capability,
    repository: input.repository,
    effect: input.effect,
    origin: input.origin,
    operationBudget: input.operationBudget,
    now,
    deadlineAt,
    abortController,
    deadlineTimer,
    requestCount: 0,
    responseBytes: 0
  };
}

function disposeMainHealthGitHubRequestSession(
  session: MainHealthGitHubRequestSession
): void {
  clearTimeout(session.deadlineTimer);
  if (!session.abortController.signal.aborted) session.abortController.abort();
}

function assertMainHealthGitHubOperationBudgetBoundary(
  budget: MainHealthGitHubOperationBudget,
  input: Readonly<{
    repositoryRoot: string;
    repository: string;
    effect: 'read' | 'status-write';
    origin: 'production' | 'test';
  }>
): void {
  const remainingMs = budget.deadlineAt - budget.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub parent operation deadline exceeded'
    );
  }
  if (budget.origin !== input.origin
      || budget.repositoryRoot !== path.resolve(input.repositoryRoot)
      || budget.repository !== input.repository
      || budget.effect !== input.effect) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub parent operation is not bound to this repository/effect/origin'
    );
  }
}

function remainingMainHealthGitHubOperationBudgetMs(
  budget: MainHealthGitHubOperationBudget
): number {
  const remainingMs = budget.deadlineAt - budget.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub parent operation deadline exceeded'
    );
  }
  return Math.max(1, Math.ceil(remainingMs));
}

function remainingMainHealthGitHubSessionMs(
  session: MainHealthGitHubRequestSession
): number {
  const parentRemainingMs = session.operationBudget === undefined
    ? Number.POSITIVE_INFINITY
    : remainingMainHealthGitHubOperationBudgetMs(session.operationBudget);
  const remainingMs = Math.min(session.deadlineAt - session.now(), parentRemainingMs);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    if (!session.abortController.signal.aborted) session.abortController.abort();
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation deadline exceeded'
    );
  }
  return Math.max(1, Math.ceil(remainingMs));
}

function assertMainHealthGitHubSessionBoundary(
  session: MainHealthGitHubRequestSession,
  repository: string,
  effect: 'read' | 'status-write',
  origin: 'production' | 'test'
): void {
  remainingMainHealthGitHubSessionMs(session);
  if (session.origin !== origin
      || session.repository !== repository || session.effect !== effect) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation session is not bound to this repository/effect/origin'
    );
  }
  if (session.capability !== undefined) {
    const binding = mainHealthGitHubCapabilityBinding(session.capability);
    if (binding.origin !== origin
        || binding.repository !== repository || binding.effect !== effect) {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub capability is not bound to this repository/effect/origin'
      );
    }
  }
}

function reserveMainHealthGitHubRequest(
  session: MainHealthGitHubRequestSession
): void {
  const budget = session.operationBudget;
  if (session.requestCount >= MAIN_HEALTH_GITHUB_MAX_REQUESTS
      || (budget !== undefined && budget.requestCount >= MAIN_HEALTH_GITHUB_MAX_REQUESTS)) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation request-count budget exceeded'
    );
  }
  session.requestCount += 1;
  if (budget !== undefined) budget.requestCount += 1;
}

function recordMainHealthGitHubResponseBytes(
  session: MainHealthGitHubRequestSession,
  bytes: number
): void {
  session.responseBytes += bytes;
  if (session.operationBudget !== undefined) {
    session.operationBudget.responseBytes += bytes;
  }
  if (session.responseBytes > MAIN_HEALTH_GITHUB_MAX_RESPONSE_BYTES
      || (session.operationBudget !== undefined
        && session.operationBudget.responseBytes > MAIN_HEALTH_GITHUB_MAX_RESPONSE_BYTES)) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation response-byte budget exceeded'
    );
  }
}

async function withMainHealthGitHubRequestSession<T>(
  capability: MainHealthGitHubCapability,
  operation: () => Promise<T>,
  options: Readonly<{
    now?: () => number;
    timeoutMs?: number;
  }> = {}
): Promise<T> {
  const binding = mainHealthGitHubCapabilityBinding(capability);
  const current = mainHealthGitHubRequestSession.getStore();
  if (current !== undefined) {
    const parentBudget = mainHealthGitHubOperationBudget.getStore();
    if (parentBudget !== undefined && current.operationBudget !== parentBudget) {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub request session is not bound to the active parent operation budget'
      );
    }
    if (current.capability !== capability) {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub nested session must reuse the exact bound capability'
      );
    }
    remainingMainHealthGitHubSessionMs(current);
    const result = await operation();
    remainingMainHealthGitHubSessionMs(current);
    return result;
  }
  const session = createMainHealthGitHubRequestSession({
    capability,
    repository: binding.repository,
    effect: binding.effect,
    origin: binding.origin,
    now: options.now,
    timeoutMs: options.timeoutMs
  });
  try {
    return await mainHealthGitHubRequestSession.run(session, async () => {
      const result = await operation();
      remainingMainHealthGitHubSessionMs(session);
      return result;
    });
  } finally {
    disposeMainHealthGitHubRequestSession(session);
  }
}

async function withMainHealthGitHubProductionSessionUsingBudget<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: 'read' | 'status-write';
  operation: () => Promise<T>;
  budget: MainHealthGitHubOperationBudget;
}>): Promise<T> {
  assertMainHealthGitHubOperationBudgetBoundary(input.budget, {
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    effect: input.effect,
    origin: 'production'
  });
  if (input.budget.sessionCount >= input.budget.maxSessions) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub parent operation session-count budget exceeded'
    );
  }
  const timeoutMs = Math.min(
    MAIN_HEALTH_GITHUB_REQUEST_TIMEOUT_MS,
    remainingMainHealthGitHubOperationBudgetMs(input.budget)
  );
  input.budget.sessionCount += 1;
  const session = createMainHealthGitHubRequestSession({
    repository: input.repository,
    effect: input.effect,
    origin: 'production',
    operationBudget: input.budget,
    now: input.budget.now,
    timeoutMs
  });
  try {
    return await mainHealthGitHubRequestSession.run(session, async () => {
      await resolveMainHealthGitHubCapability({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        effect: input.effect
      });
      remainingMainHealthGitHubSessionMs(session);
      const result = await input.operation();
      remainingMainHealthGitHubSessionMs(session);
      return result;
    });
  } finally {
    disposeMainHealthGitHubRequestSession(session);
  }
}

async function withMainHealthGitHubOperationBudget<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: 'read' | 'status-write';
  origin: 'production' | 'test';
  timeoutMs: number;
  maxSessions: number;
  now?: () => number;
  operation: () => Promise<T>;
}>): Promise<T> {
  const current = mainHealthGitHubOperationBudget.getStore();
  if (current !== undefined) {
    assertMainHealthGitHubOperationBudgetBoundary(current, {
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      effect: input.effect,
      origin: input.origin
    });
    const result = await input.operation();
    remainingMainHealthGitHubOperationBudgetMs(current);
    return result;
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1
      || !Number.isSafeInteger(input.maxSessions) || input.maxSessions < 1) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub parent operation budget is invalid'
    );
  }
  const now = input.now ?? Date.now;
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new MainHealthGitHubProviderError('MainHealth GitHub operation clock is invalid');
  }
  const budget: MainHealthGitHubOperationBudget = {
    repositoryRoot: path.resolve(input.repositoryRoot),
    repository: input.repository,
    effect: input.effect,
    origin: input.origin,
    now,
    deadlineAt: startedAt + input.timeoutMs,
    maxSessions: input.maxSessions,
    sessionCount: 0,
    requestCount: 0,
    responseBytes: 0
  };
  return await mainHealthGitHubOperationBudget.run(budget, async () => {
    const result = await input.operation();
    remainingMainHealthGitHubOperationBudgetMs(budget);
    return result;
  });
}

function currentMainHealthGitHubCapability(
  repository: string,
  effect: 'read' | 'status-write'
): MainHealthGitHubCapability {
  const current = mainHealthGitHubRequestSession.getStore();
  if (current === undefined || current.origin !== 'production') {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation requires a live owner-issued session'
    );
  }
  assertMainHealthGitHubSessionBoundary(current, repository, effect, 'production');
  if (current.capability === undefined) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub operation requires an enrolled production capability'
    );
  }
  return current.capability;
}

async function withMainHealthGitHubProductionSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: 'read' | 'status-write';
  operation: () => Promise<T>;
}>): Promise<T> {
  const current = mainHealthGitHubRequestSession.getStore();
  if (current !== undefined) {
    assertMainHealthGitHubSessionBoundary(
      current,
      input.repository,
      input.effect,
      'production'
    );
    const result = await input.operation();
    remainingMainHealthGitHubSessionMs(current);
      return result;
  }
  const parentBudget = mainHealthGitHubOperationBudget.getStore();
  if (parentBudget !== undefined) {
    return await withMainHealthGitHubProductionSessionUsingBudget({
      ...input,
      budget: parentBudget
    });
  }
  const session = createMainHealthGitHubRequestSession({
    repository: input.repository,
    effect: input.effect,
    origin: 'production'
  });
  try {
    return await mainHealthGitHubRequestSession.run(session, async () => {
      await resolveMainHealthGitHubCapability({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        effect: input.effect
      });
      remainingMainHealthGitHubSessionMs(session);
      const result = await input.operation();
      remainingMainHealthGitHubSessionMs(session);
      return result;
    });
  } finally {
    disposeMainHealthGitHubRequestSession(session);
  }
}

/**
 * Opens the sole production read session. The callback receives no bearer
 * token or transport object; all provider requests stay inside this owner.
 * A same-capability nested read reuses the operation budget, while a nested
 * repository/effect session is rejected instead of silently creating a new
 * authority.
 */
export async function withMainHealthGitHubReadSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: () => Promise<T>;
}>): Promise<T> {
  return await withMainHealthGitHubProductionSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    effect: 'read',
    operation: input.operation
  });
}

/**
 * Bounds one logical read operation that may need two independently live
 * hosted snapshots.  Each nested MainHealth read session gets its own
 * per-request 30-second transport deadline, while credential, request-count,
 * response-byte and absolute parent deadlines remain shared.  Only two
 * session roots are admitted (T1 and a fresh T2); a third session is a typed
 * provider failure rather than a silent budget reset.
 */
export async function withMainHealthGitHubReadOperationBudget<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: () => Promise<T>;
}>): Promise<T> {
  return await withMainHealthGitHubOperationBudget({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    effect: 'read',
    origin: 'production',
    timeoutMs: MAIN_HEALTH_GITHUB_READ_OPERATION_TIMEOUT_MS,
    maxSessions: MAIN_HEALTH_GITHUB_MAX_READ_SESSIONS,
    operation: input.operation
  });
}

/**
 * Checks the current parent budget at an effect owner's final admission
 * boundary. The check is intentionally unavailable outside the composition
 * helper, so a caller cannot manufacture a future deadline or use it as an
 * effect authority.
 */
export function assertMainHealthGitHubReadOperationBudgetCurrent(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): void {
  const budget = mainHealthGitHubOperationBudget.getStore();
  if (budget === undefined) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub parent operation budget is not active'
    );
  }
  assertMainHealthGitHubOperationBudgetBoundary(budget, {
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    effect: 'read',
    origin: 'production'
  });
  remainingMainHealthGitHubOperationBudgetMs(budget);
}

/** Opens the separate production status-write session used only by reconcile. */
export async function withMainHealthGitHubStatusWriteSession<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  operation: () => Promise<T>;
}>): Promise<T> {
  return await withMainHealthGitHubProductionSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    effect: 'status-write',
    operation: input.operation
  });
}

/**
 * Lower test-only transport seam. Production callers must use the
 * caller-free read/status-write session helpers above; this function exists
 * only so provider unit tests can supply an isolated fake transport without
 * making a fake capability a production authority.
 */
export async function withMainHealthGitHubTestSessionV2<T>(input: Readonly<{
  capability: MainHealthGitHubCapability;
  operation: () => Promise<T>;
  now?: () => number;
  timeoutMs?: number;
}>): Promise<T> {
  if (mainHealthGitHubCapabilityBinding(input.capability).origin !== 'test') {
    throw new MainHealthGitHubProviderError(
      'MainHealth test session cannot consume a production capability'
    );
  }
  return await withMainHealthGitHubRequestSession(input.capability, input.operation, {
    now: input.now,
    timeoutMs: input.timeoutMs
  });
}

/**
 * Internal capability constructor. Production capabilities are minted only
 * by resolveMainHealthGitHubCapabilityV2 after the canonical github.com
 * token/principal/permission readback. The separately named test seam below
 * is intentionally not used by production entrypoints.
 */
function issueMainHealthGitHubCapability(input: Readonly<{
  repository: string;
  token: string;
  issuer: MainHealthGitHubCapabilityIssuer;
  effect: 'read' | 'status-write';
  fetchImpl: MainHealthGitHubFetch;
  origin: 'production' | 'test';
}>): MainHealthGitHubCapability {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.repository)
      || input.token.length === 0
      || typeof input.fetchImpl !== 'function'
      || input.issuer.transport !== 'github-rest-token'
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(input.issuer.login)
      || input.issuer.nodeId.length === 0
      || !['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(input.issuer.permission)
      || (input.effect === 'status-write' && input.fetchImpl !== dispatchGitHubApiRequest)
      || !['production', 'test'].includes(input.origin)) {
    throw new Error('MainHealth GitHub capability issue request is invalid or not canonical');
  }
  const capability = Object.freeze({}) as MainHealthGitHubCapability;
  mainHealthGitHubCapabilityBindings.set(capability, Object.freeze({
    repository: input.repository,
    token: input.token,
    issuer: Object.freeze({ ...input.issuer }),
    effect: input.effect,
    fetchImpl: input.fetchImpl,
    origin: input.origin
  }));
  return capability;
}

/** @internal Test-only isolated transport seam; never a production issuer. */
export function issueMainHealthGitHubTestCapabilityV2(input: Readonly<{
  repository: string;
  token: string;
  issuer: MainHealthGitHubCapabilityIssuer;
  effect: 'read' | 'status-write';
  fetchImpl: MainHealthGitHubFetch;
}>): MainHealthGitHubCapability {
  return issueMainHealthGitHubCapability({ ...input, origin: 'test' });
}

function mainHealthGitHubCapabilityBinding(
  capability: MainHealthGitHubCapability
): MainHealthGitHubCapabilityBinding {
  const binding = mainHealthGitHubCapabilityBindings.get(capability);
  if (binding === undefined) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub capability is forged or not issued in this process'
    );
  }
  return binding;
}

declare const mainHealthRuntimeAuthorityBrand: unique symbol;

export type MainHealthRuntimeAuthority = Readonly<{
  /** Opaque in-process handle; the physical authority is held in a private map. */
  readonly [mainHealthRuntimeAuthorityBrand]: true;
}>;

type MainHealthRuntimeAuthorityBinding = Readonly<{
  binding: SecWorkDigest;
  assertCurrent: () => Promise<void>;
  directory: (absolutePath: string) => PhysicalDirectoryIdentity;
}>;

const mainHealthRuntimeAuthorityBindings =
  new WeakMap<object, MainHealthRuntimeAuthorityBinding>();

type HostedMainHealthObservation =
  | Readonly<{ kind: 'observed'; checks: readonly GitHubCheckObservation[] }>
  | Readonly<{ kind: 'unavailable'; ref: SecWorkDigest }>
  | Readonly<{ kind: 'invalid'; ref: SecWorkDigest }>;

export type WorkSelectionMainHealthProjection = Readonly<{
  state: SecCurrentWorkLifecycle['mainHealthState'];
  ref: SecWorkDigest;
}>;

function digestRef(value: unknown): SecWorkDigest {
  return sha256(value) as SecWorkDigest;
}

function invalidRef(label: string, value: Uint8Array | string): SecWorkDigest {
  return digestRef(Object.freeze({
    schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
    label,
    valueDigest: rawSha256(value)
  }));
}

export async function issueTrustedRuntimeMainHealthAuthorityV2(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<MainHealthRuntimeAuthority> {
  const acquired = await acquireTrustedRuntimeMainHealthAuthority(input);
  return acquired.authority;
}

/**
 * Canonical Runtime State enrollment for MainHealth.  The physical authority
 * and its opaque semantic handle are minted together so a caller cannot
 * acquire one physical root for receipt work and silently re-resolve another
 * root for the later effect/publication fence.
 */
export async function acquireTrustedRuntimeMainHealthAuthority(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  environment?: NodeJS.ProcessEnv;
  requiredDirectories?: readonly string[];
}>): Promise<Readonly<{
  authority: MainHealthRuntimeAuthority;
  physicalAuthority: SecRuntimeStatePhysicalAuthority;
}>> {
  const layout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    environment: input.environment
  });
  const authority = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot: input.repositoryRoot,
    stateRoot: layout.stateRoot,
    cacheRoot: layout.cacheRoot,
    // MainHealth effects always use this exact durable subject directory for
    // both the preimage and its namespace lease. Include it in the authority
    // even when a caller did not spell it out so a handle can never fall back
    // to an independently resolved lease root.
    requiredDirectories: Object.freeze([
      ...new Set([
        path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1'),
        ...(input.requiredDirectories ?? [])
      ])
    ])
  });
  await authority.assertCurrent();
  const requiredDirectoryBindings = Object.freeze(
    [...new Set([
      path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1'),
      ...(input.requiredDirectories ?? [])
    ])]
      .map((directoryPath) => {
        const directory = authority.directory(path.resolve(directoryPath));
        return Object.freeze({
          path: directory.path,
          finalPath: directory.finalPath,
          device: directory.device,
          inode: directory.inode,
          objectId: directory.objectId
        });
      })
      .sort((left, right) => left.path.localeCompare(right.path))
  );
  const binding = digestRef(Object.freeze({
    schema: 'sec-main-health-runtime-authority-binding-v2',
    stateRoot: Object.freeze({
      path: authority.stateRoot.path,
      finalPath: authority.stateRoot.finalPath,
      device: authority.stateRoot.device,
      inode: authority.stateRoot.inode,
      objectId: authority.stateRoot.objectId
    }),
    cacheRoot: Object.freeze({
      path: authority.cacheRoot.path,
      finalPath: authority.cacheRoot.finalPath,
      device: authority.cacheRoot.device,
      inode: authority.cacheRoot.inode,
      objectId: authority.cacheRoot.objectId
    }),
    requiredDirectories: requiredDirectoryBindings
  }));
  const handle = Object.freeze({}) as MainHealthRuntimeAuthority;
  mainHealthRuntimeAuthorityBindings.set(handle, Object.freeze({
    binding,
    assertCurrent: authority.assertCurrent,
    directory: authority.directory
  }));
  return Object.freeze({ authority: handle, physicalAuthority: authority });
}

function mainHealthRuntimeAuthorityBinding(
  authority: MainHealthRuntimeAuthority
): MainHealthRuntimeAuthorityBinding {
  const binding = mainHealthRuntimeAuthorityBindings.get(authority);
  if (binding === undefined) {
    throw new Error('MainHealth Runtime authority is forged or not issued in this process');
  }
  return binding;
}

export function trustedRuntimeMainHealthAuthorityBinding(
  authority: MainHealthRuntimeAuthority
): SecWorkDigest {
  return mainHealthRuntimeAuthorityBinding(authority).binding;
}

async function assertCurrentMainHealthRuntimeAuthority(
  authority: MainHealthRuntimeAuthority
): Promise<void> {
  await mainHealthRuntimeAuthorityBinding(authority).assertCurrent();
}

function mainHealthRuntimeAuthorityDirectory(
  authority: MainHealthRuntimeAuthority,
  expected: PhysicalDirectoryIdentity
): PhysicalDirectoryIdentity {
  const bound = mainHealthRuntimeAuthorityBinding(authority).directory(expected.path);
  if (bound.device !== expected.device
      || bound.inode !== expected.inode
      || bound.objectId !== expected.objectId) {
    throw new Error('MainHealth Runtime authority directory differs from the exact preimage root');
  }
  return bound;
}

function decodeExactUtf8(bytes: Uint8Array): string {
  const source = Buffer.from(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  if (!Buffer.from(text, 'utf8').equals(source)) {
    throw new Error('trusted local MainHealth receipt is not exact UTF-8');
  }
  return text;
}

function projectLedger(input: Readonly<{
  ledger: MainHealthLedger;
  now: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): WorkSelectionMainHealthProjection {
  const decision = resolveOrdinaryMainHealthLane({
    ledger: input.ledger,
    now: input.now,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.mainSha
  });
  const state: SecCurrentWorkLifecycle['mainHealthState'] =
    decision.observationValidity === 'invalid' || decision.ledger === null
      ? 'unresolved'
      : input.ledger.status === 'degraded'
        ? 'unhealthy'
        : input.ledger.status === 'healthy' && decision.allowed
          ? 'healthy'
          : 'unresolved';
  return Object.freeze({
    state,
    ref: input.ledger.healthRevision as SecWorkDigest
  });
}

function observeTrustedLocalProvider(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  environment?: NodeJS.ProcessEnv;
}>): WorkSelectionMainHealthProviderObservation {
  let receiptBytes: Uint8Array | null = null;
  try {
    const layout = resolveSecRuntimeStateForRepository({
      repository: input.repository,
      repositoryRoot: input.repositoryRoot,
      environment: input.environment
    });
    const root = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    const presence = inspectExactNoFollowDirectoryPresence(
      root,
      'WorkSelection trusted MainHealth root'
    );
    if (presence.state === 'absent') return Object.freeze({ kind: 'absent' });
    receiptBytes = readNoFollowOrdinaryFile(
      presence.directory.target,
      `main-${input.mainSha}.json`
    );
    if (receiptBytes === null) return Object.freeze({ kind: 'absent' });

    const receipt = parseTrustedRuntimeMainHealthReceipt(decodeExactUtf8(receiptBytes));
    const canonicalReceiptBytes = Buffer.from(
      `${encodeVerificationActionData(receipt)}\n`,
      'utf8'
    );
    if (!Buffer.from(receiptBytes).equals(canonicalReceiptBytes)) {
      return Object.freeze({
        kind: 'invalid',
        ref: invalidRef('trusted-local-noncanonical-bytes', receiptBytes)
      });
    }
    if (receipt.repository !== input.repository
        || receipt.mainSha !== input.mainSha
        || receipt.mainTreeSha !== input.mainTreeSha) {
      return Object.freeze({
        kind: 'invalid',
        ref: invalidRef('trusted-local-subject-mismatch', receiptBytes)
      });
    }
    const nowMs = Date.parse(input.now);
    const receiptObservedAtMs = Date.parse(receipt.observedAt);
    if (!Number.isFinite(receiptObservedAtMs) || !Number.isFinite(nowMs)
        || receiptObservedAtMs > nowMs) {
      return Object.freeze({
        kind: 'invalid',
        ref: invalidRef('trusted-local-time-invalid', receiptBytes)
      });
    }
    // The physical receipt is immutable exact-subject Evidence. Freshness
    // belongs to this read observation, so an unchanged main never needs the
    // four commands rerun merely because wall time advanced.
    const expiresAtMs = nowMs + TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    return Object.freeze({
      kind: 'available',
      ledger: createMainHealthLedger(createTrustedLocalMainHealthInput({
        schema: 'sec-trusted-local-main-health-observation-v1',
        repository: input.repository,
        mainSha: input.mainSha,
        mainTreeSha: input.mainTreeSha,
        trustRevision: input.mainSha,
        runtimeRef: `trusted-main-health-receipt:${receipt.receiptDigest}`,
        executionId: receipt.executionId,
        verificationReceiptDigest: receipt.receiptDigest,
        observedAt: input.now,
        expiresAt
      }))
    });
  } catch (error) {
    return classifyTrustedLocalMainHealthObservationFailure(error, receiptBytes);
  }
}

export function classifyTrustedLocalMainHealthObservationFailure(
  error: unknown,
  receiptBytes: Uint8Array | null = null
): WorkSelectionMainHealthProviderObservation {
  if (error instanceof PhysicalNoFollowError) {
    if (error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return Object.freeze({ kind: 'absent' });
    }
    if (error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') {
      return Object.freeze({
        kind: 'unavailable',
        ref: invalidRef('trusted-local-no-follow-capability-unavailable', error.code)
      });
    }
  }
  return Object.freeze({
    kind: 'invalid',
    ref: invalidRef(
      'trusted-local-observation-invalid',
      receiptBytes ?? (error instanceof Error ? error.message : String(error))
    )
  });
}

function observeTrustedLocalSupersessionPreimage(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  environment?: NodeJS.ProcessEnv;
}>) {
  const layout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    environment: input.environment
  });
  const root = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
  const presence = inspectExactNoFollowDirectoryPresence(
    root,
    'WorkSelection trusted MainHealth supersession root'
  );
  if (presence.state === 'absent') {
    throw new Error('trusted local MainHealth supersession source root is absent');
  }
  const sourceName = `main-${input.mainSha}.json`;
  const source = inspectNoFollowOrdinaryFileEntry(presence.directory.target, sourceName);
  if (source === null || source.bytes === null) {
    throw new Error('trusted local MainHealth supersession source is absent');
  }
  const receipt = parseTrustedRuntimeMainHealthReceipt(decodeExactUtf8(source.bytes));
  const canonicalReceiptBytes = Buffer.from(`${encodeVerificationActionData(receipt)}\n`, 'utf8');
  if (!Buffer.from(source.bytes).equals(canonicalReceiptBytes)
      || receipt.repository !== input.repository
      || receipt.mainSha !== input.mainSha
      || receipt.mainTreeSha !== input.mainTreeSha) {
    throw new Error('trusted local MainHealth supersession preimage is not exact');
  }
  return Object.freeze({ directory: presence.directory.target, source, receipt });
}

const MAIN_HEALTH_SUPERSESSION_EFFECT_CAPABILITY_SCHEMA =
  'sec-main-health-supersession-effect-capability-v2' as const;

type MainHealthSupersessionEffectCapability = Readonly<{
  schema: typeof MAIN_HEALTH_SUPERSESSION_EFFECT_CAPABILITY_SCHEMA;
  effect: 'prefer-exact-registered-hosted-provider';
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  hostedAuthorityDigest: SecWorkDigest;
  issuedAt: string;
  expiresAt: string;
  authorizationDigest: SecWorkDigest;
}>;

const issuedMainHealthSupersessionCapabilities = new WeakSet<object>();

function hostedMainHealthAuthorityDigest(ledger: MainHealthLedger): SecWorkDigest {
  return digestRef(Object.freeze({
    schema: 'sec-hosted-main-health-live-authority-v1',
    repository: ledger.repository,
    defaultBranch: ledger.defaultBranch,
    mainSha: ledger.mainSha,
    mainTreeSha: ledger.mainTreeSha,
    healthRevision: ledger.healthRevision,
    trustRevision: ledger.trustRevision,
    producer: ledger.producer
  }));
}

function issueMainHealthSupersessionEffectCapability(input: Readonly<{
  preimage: ReturnType<typeof observeTrustedLocalSupersessionPreimage>;
  hostedLedger: MainHealthLedger;
  runtimeAuthorityBinding: SecWorkDigest;
  issuedAt: string;
  issuer: Readonly<{
    transport: 'github-rest-token';
    login: string;
    nodeId: string;
    permission: 'admin' | 'maintain';
  }>;
  predecessorRecordDigest: SecWorkDigest | null;
}>): MainHealthSupersessionEffectCapability {
  const hostedAuthorityDigest = hostedMainHealthAuthorityDigest(input.hostedLedger);
  const authorization = createTrustedRuntimeMainHealthSupersessionAuthorization({
    defaultBranch: input.hostedLedger.defaultBranch,
    sourceName: input.preimage.source.relativePath,
    source: input.preimage.source,
    localReceipt: input.preimage.receipt,
    hostedLedger: input.hostedLedger,
    hostedAuthorityDigest,
    runtimeAuthorityBinding: input.runtimeAuthorityBinding,
    predecessorRecordDigest: input.predecessorRecordDigest,
    issuer: input.issuer
  });
  return issueMainHealthSupersessionEffectCapabilityFromAuthorization({
    authorization,
    hostedAuthorityDigest,
    issuedAt: input.issuedAt
  });
}

function issueMainHealthSupersessionEffectCapabilityFromAuthorization(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  hostedAuthorityDigest: SecWorkDigest;
  issuedAt: string;
}>): MainHealthSupersessionEffectCapability {
  if (hostedMainHealthAuthorityDigest(input.authorization.hostedLedger)
      !== input.authorization.hostedAuthorityDigest
      || input.hostedAuthorityDigest !== input.authorization.hostedAuthorityDigest) {
    throw new Error('MainHealth supersession authorization hosted authority is not exact');
  }
  const semantic = Object.freeze({
    schema: MAIN_HEALTH_SUPERSESSION_EFFECT_CAPABILITY_SCHEMA,
    effect: 'prefer-exact-registered-hosted-provider' as const,
    authorization: input.authorization,
    hostedAuthorityDigest: input.hostedAuthorityDigest,
    issuedAt: input.issuedAt,
    expiresAt: input.authorization.hostedLedger.expiresAt
  });
  const capability = Object.freeze({
    ...semantic,
    authorizationDigest: digestRef(semantic)
  });
  issuedMainHealthSupersessionCapabilities.add(capability);
  return capability;
}

function consumeMainHealthSupersessionEffectCapability(
  capability: MainHealthSupersessionEffectCapability
): TrustedRuntimeMainHealthSupersessionAuthorization {
  if (!issuedMainHealthSupersessionCapabilities.has(capability)) {
    throw new Error('MainHealth supersession Effect capability is forged or already consumed');
  }
  issuedMainHealthSupersessionCapabilities.delete(capability);
  const authorization = createTrustedRuntimeMainHealthSupersessionAuthorization({
    defaultBranch: capability.authorization.hostedLedger.defaultBranch,
    sourceName: capability.authorization.sourceName,
    source: Object.freeze({
      relativePath: capability.authorization.sourceName,
      kind: 'file' as const,
      device: capability.authorization.source.device,
      inode: capability.authorization.source.inode,
      size: capability.authorization.source.size,
      bytes: Buffer.from(
        `${encodeVerificationActionData(capability.authorization.localReceipt)}\n`,
        'utf8'
      ),
      linkTarget: null
    }),
    localReceipt: capability.authorization.localReceipt,
    hostedLedger: capability.authorization.hostedLedger,
    hostedAuthorityDigest: capability.authorization.hostedAuthorityDigest,
    runtimeAuthorityBinding: capability.authorization.runtimeAuthorityBinding,
    predecessorRecordDigest: capability.authorization.predecessorRecordDigest,
    issuer: capability.authorization.issuer
  });
  const semantic = Object.freeze({
    schema: MAIN_HEALTH_SUPERSESSION_EFFECT_CAPABILITY_SCHEMA,
    effect: 'prefer-exact-registered-hosted-provider' as const,
    authorization,
    hostedAuthorityDigest: hostedMainHealthAuthorityDigest(authorization.hostedLedger),
    issuedAt: capability.issuedAt,
    expiresAt: capability.expiresAt
  });
  if (encodeVerificationActionData(authorization)
        !== encodeVerificationActionData(capability.authorization)
      || semantic.hostedAuthorityDigest !== capability.hostedAuthorityDigest
      || digestRef(semantic) !== capability.authorizationDigest
      || !Number.isFinite(Date.parse(capability.issuedAt))
      || Date.parse(capability.expiresAt) < Date.now()) {
    throw new Error('MainHealth supersession Effect capability binding is stale or invalid');
  }
  return authorization;
}

function mainHealthSupersessionAuthorizationStableValue(
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization
): unknown {
  return Object.freeze({
    schema: 'sec-main-health-supersession-authorization-stable-v2',
    repository: authorization.repository,
    mainSha: authorization.mainSha,
    mainTreeSha: authorization.mainTreeSha,
    operationId: authorization.operationId,
    operationLeaseName: authorization.operationLeaseName,
    predecessorRecordDigest: authorization.predecessorRecordDigest,
    runtimeAuthorityBinding: authorization.runtimeAuthorityBinding,
    issuer: authorization.issuer,
    sourceName: authorization.sourceName,
    source: authorization.source,
    localReceiptDigest: authorization.localReceipt.receiptDigest,
    localHealthRevision: authorization.localHealthRevision,
    hostedAuthorityDigest: authorization.hostedAuthorityDigest,
    hostedLedgerAuthorityDigest: hostedMainHealthAuthorityDigest(authorization.hostedLedger),
    effectAuthorizationDigest: authorization.effectAuthorizationDigest
  });
}

function assertMainHealthSupersessionAuthorizationStableMatch(
  expected: TrustedRuntimeMainHealthSupersessionAuthorization,
  current: TrustedRuntimeMainHealthSupersessionAuthorization,
  phase: string
): void {
  if (encodeVerificationActionData(mainHealthSupersessionAuthorizationStableValue(expected))
      !== encodeVerificationActionData(mainHealthSupersessionAuthorizationStableValue(current))) {
    throw new Error(`MainHealth supersession prepared authorization differs from current preimage ${phase}`);
  }
}

function assertMainHealthSupersessionAuthorizationSource(
  preimage: ReturnType<typeof observeTrustedLocalSupersessionPreimage>,
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization,
  phase: string
): void {
  if (authorization.repository !== preimage.receipt.repository
      || authorization.mainSha !== preimage.receipt.mainSha
      || authorization.mainTreeSha !== preimage.receipt.mainTreeSha
      || authorization.sourceName !== preimage.source.relativePath
      || authorization.source.device !== preimage.source.device
      || authorization.source.inode !== preimage.source.inode
      || authorization.source.size !== preimage.source.size
      || preimage.source.bytes === null
      || rawSha256(preimage.source.bytes) !== authorization.source.byteDigest
      || authorization.localReceipt.receiptDigest !== preimage.receipt.receiptDigest) {
    throw new Error(`MainHealth supersession authorization source differs from exact preimage ${phase}`);
  }
}

async function assertCurrentMainHealthSupersessionIssuer(input: Readonly<{
  authorization: Readonly<{
    repository: string;
    issuer: TrustedRuntimeMainHealthSupersessionAuthorization['issuer'];
  }>;
  capability: MainHealthGitHubCapability;
}>): Promise<void> {
  assertMainHealthGitHubCapability(input.capability, input.authorization.repository, 'read');
  const capabilityBinding = mainHealthGitHubCapabilityBinding(input.capability);
  if (capabilityBinding.issuer.login !== input.authorization.issuer.login
      || capabilityBinding.issuer.nodeId !== input.authorization.issuer.nodeId
      || capabilityBinding.issuer.permission !== input.authorization.issuer.permission) {
    throw new MainHealthGitHubProviderError(
      'MainHealth supersession issuer capability differs from its authorization'
    );
  }
  const viewer = await requestMainHealthGitHubJson<unknown>({
    capability: input.capability,
    repository: input.authorization.repository,
    method: 'GET',
    endpoint: '/user'
  });
  if (viewer === null || typeof viewer !== 'object' || Array.isArray(viewer)) {
    throw new MainHealthGitHubProviderError('MainHealth supersession viewer response is invalid');
  }
  const viewerRecord = viewer as Record<string, unknown>;
  if (viewerRecord.login !== input.authorization.issuer.login
      || viewerRecord.node_id !== input.authorization.issuer.nodeId) {
    throw new MainHealthGitHubProviderError('MainHealth supersession issuer identity changed');
  }
  const permission = await requestMainHealthGitHubJson<unknown>({
    capability: input.capability,
    repository: input.authorization.repository,
    method: 'GET',
    endpoint: `/repos/${input.authorization.repository}/collaborators/`
      + `${encodeURIComponent(input.authorization.issuer.login)}/permission`
  });
  if (permission === null || typeof permission !== 'object' || Array.isArray(permission)
      || (permission as Record<string, unknown>).permission
        !== input.authorization.issuer.permission) {
    throw new MainHealthGitHubProviderError(
      'MainHealth supersession issuer identity or live permission changed'
    );
  }
}

type MainHealthSupersessionProviderAuthorization =
  TrustedRuntimeMainHealthSupersessionReceipt['providerAuthorization'];

class MainHealthGitHubProviderError extends Error {
  constructor(message: string, readonly statusCode: number | null = null) {
    super(message);
    this.name = 'MainHealthGitHubProviderError';
  }
}

export type MainHealthGitHubCredentialUnavailableReason =
  'credential-provider-unavailable';

/**
 * Typed provider-unavailable result for the credential admission boundary.
 * Its fixed redacted digest carries no host path, executable, configuration,
 * or other credential-adjacent material into semantic observations.
 */
export class MainHealthGitHubCredentialUnavailableError extends MainHealthGitHubProviderError {
  readonly code = 'credential-provider-unavailable' as const;
  readonly detailDigest: `sha256:${string}`;

  constructor(readonly reason: MainHealthGitHubCredentialUnavailableReason) {
    const detailDigest = sha256(Object.freeze({
      schema: 'sec-main-health-github-credential-unavailable-v1',
      reason,
      detailDigest: rawSha256('canonical physical credential provider has not issued')
    })) as `sha256:${string}`;
    super(`MainHealth GitHub credential provider is unavailable (${detailDigest})`);
    this.name = 'MainHealthGitHubCredentialUnavailableErrorV1';
    this.detailDigest = detailDigest;
  }
}

/**
 * The status effect is authorized for one exact default/main subject only.
 * A live ref change is a typed external drift, not a provider-unavailable
 * retry signal: the caller must abandon this effect and re-resolve MainHealth.
 */
export class MainHealthExternalMainDriftError extends MainHealthGitHubProviderError {
  readonly code = 'external-main-drift' as const;

  constructor(expectedMainSha: string, observedMainSha: string) {
    super(
      `MainHealth status effect default/main ref drifted: expected ${expectedMainSha}, `
      + `observed ${observedMainSha}`
    );
    this.name = 'MainHealthExternalMainDriftError';
  }
}

/** One bounded transport deadline owned by the MainHealth provider boundary. */
export const MAIN_HEALTH_GITHUB_REQUEST_TIMEOUT_MS = 30_000 as const;

function assertMainHealthGitHubCapability(
  capability: MainHealthGitHubCapability,
  repository: string,
  requiredEffect: 'read' | 'status-write'
): void {
  const binding = mainHealthGitHubCapabilityBindings.get(capability);
  if (binding === undefined
      || binding.repository !== repository
      || binding.token.length < 1
      || binding.issuer.transport !== 'github-rest-token'
      || (requiredEffect === 'status-write' && binding.effect !== 'status-write')
      || (requiredEffect === 'status-write'
        && binding.issuer.permission !== 'admin'
        && binding.issuer.permission !== 'maintain')) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub capability is absent, repository-bound incorrectly, or not write-authorized'
    );
  }
}

async function requestMainHealthGitHubJsonWithToken<T>(input: Readonly<{
  repository: string;
  token: string;
  fetchImpl: MainHealthGitHubFetch;
  session: MainHealthGitHubRequestSession;
  method: 'GET' | 'POST';
  endpoint: string;
  body?: unknown;
}>): Promise<T> {
  if (input.token.length < 1
      || (input.endpoint !== '/user'
        && input.endpoint !== '/graphql'
        && !input.endpoint.startsWith(`/repos/${input.repository}/`))) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub token request is not explicitly repository-bound'
    );
  }
  reserveMainHealthGitHubRequest(input.session);
  const remainingMs = remainingMainHealthGitHubSessionMs(input.session);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      if (!input.session.abortController.signal.aborted) {
        input.session.abortController.abort();
      }
      reject(new MainHealthGitHubProviderError('MainHealth GitHub operation deadline exceeded'));
    }, remainingMs);
  });
  const raceDeadline = async <T>(operation: PromiseLike<T>): Promise<T> =>
    await Promise.race([operation, deadline]);
  try {
    const response = await raceDeadline(Promise.resolve().then(() => input.fetchImpl(
      `${MAIN_HEALTH_GITHUB_API_ORIGIN}${input.endpoint}`,
      {
        method: input.method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${input.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'sec-main-health-v2',
          ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        signal: input.session.abortController.signal,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) })
      }
    )));
    let responseText: string;
    try {
      if (response.body === null || typeof response.body.getReader !== 'function') {
        throw new MainHealthGitHubProviderError(
          'MainHealth GitHub response does not expose a bounded streaming body',
          response.status
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const chunks: string[] = [];
      while (true) {
        const chunk = await raceDeadline(reader.read());
        if (chunk.done) break;
        try {
          recordMainHealthGitHubResponseBytes(input.session, chunk.value.byteLength);
        } catch (error) {
          void reader.cancel();
          if (error instanceof MainHealthGitHubProviderError) throw error;
          throw new MainHealthGitHubProviderError(
            'MainHealth GitHub operation response-byte budget exceeded',
            response.status
          );
        }
        chunks.push(decoder.decode(chunk.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      responseText = chunks.join('');
    } catch (error) {
      if (error instanceof MainHealthGitHubProviderError) throw error;
      throw new MainHealthGitHubProviderError(
        `MainHealth GitHub ${input.method} ${input.endpoint} response body unavailable: ${error instanceof Error ? error.message : String(error)}`,
        response.status
      );
    }
    if (!response.ok) {
      throw new MainHealthGitHubProviderError(
        `MainHealth GitHub ${input.method} ${input.endpoint} failed with HTTP ${response.status}: ${responseText.slice(-2048)}`,
        response.status
      );
    }
    try {
      return JSON.parse(responseText) as T;
    } catch (error) {
      throw new MainHealthGitHubProviderError(
        `MainHealth GitHub ${input.method} ${input.endpoint} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        response.status
      );
    }
  } catch (error) {
    if (error instanceof MainHealthGitHubProviderError) throw error;
    const detail = input.session.abortController.signal.aborted
      ? 'operation deadline exceeded'
      : error instanceof Error ? error.message : String(error);
    throw new MainHealthGitHubProviderError(
      `MainHealth GitHub ${input.method} transport unavailable: ${detail}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function requestMainHealthGitHubJson<T>(input: Readonly<{
  capability: MainHealthGitHubCapability;
  repository: string;
  method: 'GET' | 'POST';
  endpoint: string;
  body?: unknown;
}>): Promise<T> {
  assertMainHealthGitHubCapability(input.capability, input.repository, input.method === 'POST'
    ? 'status-write'
    : 'read');
  const binding = mainHealthGitHubCapabilityBinding(input.capability);
  const current = mainHealthGitHubRequestSession.getStore();
  if (current === undefined || current.capability !== input.capability) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub request requires the active exact operation session'
    );
  }
  return requestMainHealthGitHubJsonWithToken<T>({
    repository: input.repository,
    token: binding.token,
    fetchImpl: binding.fetchImpl,
    session: current,
    method: input.method,
    endpoint: input.endpoint,
    body: input.body
  });
}

function currentMainHealthGitHubReadCapability(repository: string): MainHealthGitHubCapability {
  const current = mainHealthGitHubRequestSession.getStore();
  if (current?.capability === undefined) {
    throw new MainHealthGitHubProviderError(
      'MainAuthority ruleset observation requires the active MainHealth GitHub read session'
    );
  }
  assertMainHealthGitHubSessionBoundary(current, repository, 'read', current.origin);
  return current.capability;
}

/**
 * Repository-bound MainAuthority ruleset facts from the active MainHealth
 * GitHub read session.  Callers receive semantic JSON only; credential,
 * endpoint, transport and request-budget authority remain in this owner.
 */
export async function observeMainAuthorityRulesetGitHubFacts(input: Readonly<{
  repository: string;
  defaultBranch: string;
}>): Promise<Readonly<{
  effectiveRules: readonly unknown[];
  detailedRulesets: readonly unknown[];
}>> {
  const capability = currentMainHealthGitHubReadCapability(input.repository);
  const effectiveRules: unknown[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 100; page += 1) {
    const records = await requestMainHealthGitHubJson<unknown>({
      capability,
      repository: input.repository,
      method: 'GET',
      endpoint: `/repos/${input.repository}/rules/branches/${encodeURIComponent(input.defaultBranch)}`
        + `?per_page=${pageSize}&page=${page}`
    });
    if (!Array.isArray(records)) {
      throw new MainHealthGitHubProviderError(
        'MainAuthority effective branch rules response is not an array'
      );
    }
    effectiveRules.push(...records);
    if (records.length < pageSize) break;
    if (page === 100) {
      throw new MainHealthGitHubProviderError(
        'MainAuthority effective branch rules exceed the bounded pagination capacity'
      );
    }
  }

  const rulesetIds = [...new Set(effectiveRules.map((rule, index) => {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new MainHealthGitHubProviderError(
        `MainAuthority effective branch rule ${index} is malformed`
      );
    }
    const id = (rule as Record<string, unknown>).ruleset_id;
    if (!Number.isSafeInteger(id) || (id as number) < 1) {
      throw new MainHealthGitHubProviderError(
        `MainAuthority effective branch rule ${index} has no exact ruleset id`
      );
    }
    return id as number;
  }))].sort((left, right) => left - right);
  const detailedRulesets: unknown[] = [];
  for (const rulesetId of rulesetIds) {
    detailedRulesets.push(await requestMainHealthGitHubJson<unknown>({
      capability,
      repository: input.repository,
      method: 'GET',
      endpoint: `/repos/${input.repository}/rulesets/${rulesetId}?includes_parents=true`
    }));
  }
  return Object.freeze({
    effectiveRules: Object.freeze(effectiveRules),
    detailedRulesets: Object.freeze(detailedRulesets)
  });
}

export type WorkSelectionGitHubIssue = Readonly<{
  number: number;
  nodeId: string;
  state: 'OPEN' | 'CLOSED';
  body: string;
}>;

export type WorkSelectionGitHubPullRequest = Readonly<{
  number: number;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  body: string;
}>;

function workSelectionGitHubRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MainHealthGitHubProviderError(`WorkSelection GitHub ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function workSelectionGitHubSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new MainHealthGitHubProviderError(`WorkSelection GitHub ${label} SHA is invalid`);
  }
  return value;
}

async function workSelectionGitHubGet<T>(repository: string, endpoint: string): Promise<T> {
  return await requestMainHealthGitHubJson<T>({
    capability: currentMainHealthGitHubCapability(repository, 'read'),
    repository,
    method: 'GET',
    endpoint
  });
}

type MainHealthGitHubNumberedInventoryEntry = Readonly<{
  number: number;
  title: string;
}>;

type MainHealthGitHubReviewThreadConnection = Readonly<{
  totalCount: number;
  nodes: readonly Readonly<{ isResolved: boolean }>[];
  pageInfo: Readonly<{ hasNextPage: false; endCursor: null }>;
}>;

export type MainHealthGitHubControlInventory = Readonly<{
  openPullRequests: readonly MainHealthGitHubNumberedInventoryEntry[];
  openIssues: readonly MainHealthGitHubNumberedInventoryEntry[];
  reviewThreads: readonly Readonly<{
    number: number;
    reviewThreads: MainHealthGitHubReviewThreadConnection;
  }>[];
}>;

const MAIN_HEALTH_GITHUB_OPEN_COUNTS_QUERY =
  'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN){totalCount}issues(states:OPEN){totalCount}}}';

const MAIN_HEALTH_GITHUB_REVIEW_THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){number reviewThreads(first:100,after:$endCursor){totalCount nodes{isResolved}pageInfo{hasNextPage endCursor}}}}}';

function mainHealthGitHubRepositoryParts(repository: string): Readonly<{
  owner: string;
  name: string;
}> {
  const parts = repository.split('/');
  if (parts.length !== 2
      || parts.some((part) => !/^[A-Za-z0-9_.-]+$/u.test(part))) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub repository must be an exact owner/name pair'
    );
  }
  return Object.freeze({ owner: parts[0]!, name: parts[1]! });
}

function mainHealthGitHubNonNegativeCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MainHealthGitHubProviderError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function mainHealthGitHubPositiveNumber(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new MainHealthGitHubProviderError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

async function requestMainHealthGitHubReadGraphQL<T>(input: Readonly<{
  repository: string;
  query: string;
  variables: Readonly<Record<string, string | number | null>>;
}>): Promise<T> {
  const capability = currentMainHealthGitHubReadCapability(input.repository);
  const binding = mainHealthGitHubCapabilityBinding(capability);
  const session = mainHealthGitHubRequestSession.getStore();
  if (session === undefined || session.capability !== capability) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub GraphQL read requires the active exact operation session'
    );
  }
  return await requestMainHealthGitHubJsonWithToken<T>({
    repository: input.repository,
    token: binding.token,
    fetchImpl: binding.fetchImpl,
    session,
    method: 'POST',
    endpoint: '/graphql',
    body: Object.freeze({ query: input.query, variables: input.variables })
  });
}

function mainHealthGitHubGraphQLRepository(
  value: unknown,
  label: string
): Record<string, unknown> {
  const root = workSelectionGitHubRecord(value, `${label} response`);
  if ('errors' in root
      && (!Array.isArray(root.errors) || root.errors.length !== 0)) {
    throw new MainHealthGitHubProviderError(`${label} response contains GraphQL errors`);
  }
  const data = workSelectionGitHubRecord(root.data, `${label} data`);
  return workSelectionGitHubRecord(data.repository, `${label} repository`);
}

async function observeMainHealthGitHubOpenCounts(repository: string): Promise<Readonly<{
  pullRequests: number;
  issues: number;
}>> {
  const parts = mainHealthGitHubRepositoryParts(repository);
  const repositoryValue = mainHealthGitHubGraphQLRepository(
    await requestMainHealthGitHubReadGraphQL<unknown>({
      repository,
      query: MAIN_HEALTH_GITHUB_OPEN_COUNTS_QUERY,
      variables: parts
    }),
    'MainHealth GitHub open inventory count'
  );
  const pullRequests = workSelectionGitHubRecord(
    repositoryValue.pullRequests,
    'open pull request count'
  );
  const issues = workSelectionGitHubRecord(repositoryValue.issues, 'open issue count');
  return Object.freeze({
    pullRequests: mainHealthGitHubNonNegativeCount(
      pullRequests.totalCount,
      'MainHealth GitHub open pull request totalCount'
    ),
    issues: mainHealthGitHubNonNegativeCount(
      issues.totalCount,
      'MainHealth GitHub open issue totalCount'
    )
  });
}

async function observeMainHealthGitHubOpenNumberedInventory(repository: string): Promise<Readonly<{
  pullRequests: readonly MainHealthGitHubNumberedInventoryEntry[];
  issues: readonly MainHealthGitHubNumberedInventoryEntry[];
}>> {
  const pullRequests: MainHealthGitHubNumberedInventoryEntry[] = [];
  const issues: MainHealthGitHubNumberedInventoryEntry[] = [];
  const observedNumbers = new Set<number>();
  for (let page = 1; page <= 1_000; page += 1) {
    const value = await workSelectionGitHubGet<unknown>(
      repository,
      `/repos/${repository}/issues?state=open&per_page=100&page=${page}`
    );
    if (!Array.isArray(value)) {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub open issue inventory response is not an array'
      );
    }
    for (const [index, entry] of value.entries()) {
      const record = workSelectionGitHubRecord(entry, `open inventory ${page}:${index}`);
      const number = mainHealthGitHubPositiveNumber(
        record.number,
        `MainHealth GitHub open inventory ${page}:${index} number`
      );
      if (observedNumbers.has(number) || typeof record.title !== 'string') {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub open inventory ${page}:${index} is duplicate or malformed`
        );
      }
      observedNumbers.add(number);
      const observation = Object.freeze({ number, title: record.title });
      if ('pull_request' in record) pullRequests.push(observation);
      else issues.push(observation);
    }
    if (value.length < 100) {
      const byNumber = (
        left: MainHealthGitHubNumberedInventoryEntry,
        right: MainHealthGitHubNumberedInventoryEntry
      ): number => left.number - right.number;
      return Object.freeze({
        pullRequests: Object.freeze(pullRequests.sort(byNumber)),
        issues: Object.freeze(issues.sort(byNumber))
      });
    }
  }
  throw new MainHealthGitHubProviderError(
    'MainHealth GitHub open inventory exceeded 100,000 records'
  );
}

async function observeMainHealthGitHubReviewThreads(
  repository: string,
  pullRequestNumbers: readonly number[]
): Promise<MainHealthGitHubControlInventory['reviewThreads']> {
  const parts = mainHealthGitHubRepositoryParts(repository);
  const result: Array<MainHealthGitHubControlInventory['reviewThreads'][number]> = [];
  for (const number of pullRequestNumbers) {
    mainHealthGitHubPositiveNumber(number, 'MainHealth GitHub review-thread pull request');
    let cursor: string | null = null;
    let expectedTotalCount: number | null = null;
    const nodes: Readonly<{ isResolved: boolean }>[] = [];
    for (let page = 1; page <= 1_000; page += 1) {
      const repositoryValue = mainHealthGitHubGraphQLRepository(
        await requestMainHealthGitHubReadGraphQL<unknown>({
          repository,
          query: MAIN_HEALTH_GITHUB_REVIEW_THREADS_QUERY,
          variables: Object.freeze({ ...parts, number, endCursor: cursor })
        }),
        `MainHealth GitHub pull request ${number} review threads page ${page}`
      );
      const pullRequest = workSelectionGitHubRecord(
        repositoryValue.pullRequest,
        `pull request ${number}`
      );
      if (pullRequest.number !== number) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub review-thread response resolved the wrong pull request ${number}`
        );
      }
      const connection = workSelectionGitHubRecord(
        pullRequest.reviewThreads,
        `pull request ${number} reviewThreads`
      );
      const totalCount = mainHealthGitHubNonNegativeCount(
        connection.totalCount,
        `pull request ${number} reviewThreads totalCount`
      );
      expectedTotalCount ??= totalCount;
      if (totalCount !== expectedTotalCount || !Array.isArray(connection.nodes)) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread census drifted or is malformed`
        );
      }
      for (const [index, entry] of connection.nodes.entries()) {
        const node = workSelectionGitHubRecord(
          entry,
          `pull request ${number} reviewThreads node ${index}`
        );
        if (typeof node.isResolved !== 'boolean') {
          throw new MainHealthGitHubProviderError(
            `MainHealth GitHub pull request ${number} review-thread node is malformed`
          );
        }
        nodes.push(Object.freeze({ isResolved: node.isResolved }));
      }
      const pageInfo = workSelectionGitHubRecord(
        connection.pageInfo,
        `pull request ${number} reviewThreads pageInfo`
      );
      if (typeof pageInfo.hasNextPage !== 'boolean') {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread pageInfo is malformed`
        );
      }
      if (!pageInfo.hasNextPage) {
        if (nodes.length !== expectedTotalCount) {
          throw new MainHealthGitHubProviderError(
            `MainHealth GitHub pull request ${number} review-thread terminal page is incomplete: `
            + `expected ${expectedTotalCount}, observed ${nodes.length}`
          );
        }
        result.push(Object.freeze({
          number,
          reviewThreads: Object.freeze({
            totalCount: expectedTotalCount,
            nodes: Object.freeze(nodes),
            pageInfo: Object.freeze({ hasNextPage: false as const, endCursor: null })
          })
        }));
        break;
      }
      if (typeof pageInfo.endCursor !== 'string'
          || pageInfo.endCursor.length === 0
          || pageInfo.endCursor === cursor) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread cursor is invalid`
        );
      }
      cursor = pageInfo.endCursor;
      if (page === 1_000) {
        throw new MainHealthGitHubProviderError(
          `MainHealth GitHub pull request ${number} review-thread pagination exceeded 100,000 records`
        );
      }
    }
  }
  return Object.freeze(result);
}

/**
 * Complete PR/Issue/review-thread inventory from the active repository-bound
 * MainHealth read session. Transport, credential, pagination, counts and the
 * final drift fence remain private to this semantic owner.
 */
export async function observeMainHealthGitHubControlInventory(input: Readonly<{
  repository: string;
}>): Promise<MainHealthGitHubControlInventory> {
  currentMainHealthGitHubReadCapability(input.repository);
  const before = await observeMainHealthGitHubOpenCounts(input.repository);
  const inventory = await observeMainHealthGitHubOpenNumberedInventory(input.repository);
  if (inventory.pullRequests.length !== before.pullRequests
      || inventory.issues.length !== before.issues) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub open inventory is incomplete or changed after its first count fence'
    );
  }
  const reviewThreads = await observeMainHealthGitHubReviewThreads(
    input.repository,
    inventory.pullRequests.map((entry) => entry.number)
  );
  const after = await observeMainHealthGitHubOpenCounts(input.repository);
  if (after.pullRequests !== before.pullRequests || after.issues !== before.issues) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub open inventory changed during its final count fence'
    );
  }
  return Object.freeze({
    openPullRequests: inventory.pullRequests,
    openIssues: inventory.issues,
    reviewThreads
  });
}

export async function observeWorkSelectionGitHubDefaultRef(input: Readonly<{
  repository: string;
  defaultBranch: string;
}>): Promise<string> {
  const value = workSelectionGitHubRecord(await workSelectionGitHubGet<unknown>(
    input.repository,
    `/repos/${input.repository}/git/ref/heads/`
      + input.defaultBranch.split('/').map(encodeURIComponent).join('/')
  ), 'default ref');
  const object = workSelectionGitHubRecord(value.object, 'default ref object');
  return workSelectionGitHubSha(object.sha, 'default ref object');
}

export async function observeWorkSelectionGitHubIssues(input: Readonly<{
  repository: string;
  issueNumbers: readonly number[];
}>): Promise<readonly WorkSelectionGitHubIssue[]> {
  const observations: WorkSelectionGitHubIssue[] = [];
  for (const issueNumber of input.issueNumbers) {
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
      throw new MainHealthGitHubProviderError('WorkSelection GitHub issue number is invalid');
    }
    const value = workSelectionGitHubRecord(await workSelectionGitHubGet<unknown>(
      input.repository,
      `/repos/${input.repository}/issues/${issueNumber}`
    ), `issue ${issueNumber}`);
    if (value.number !== issueNumber
        || typeof value.node_id !== 'string' || value.node_id.length === 0
        || (value.state !== 'open' && value.state !== 'closed')
        || typeof value.body !== 'string') {
      throw new MainHealthGitHubProviderError(`WorkSelection GitHub issue ${issueNumber} is malformed`);
    }
    observations.push(Object.freeze({
      number: issueNumber,
      nodeId: value.node_id,
      state: value.state === 'open' ? 'OPEN' : 'CLOSED',
      body: value.body
    }));
  }
  return Object.freeze(observations);
}

export async function observeWorkSelectionGitHubOpenPullRequests(input: Readonly<{
  repository: string;
  defaultBranch: string;
}>): Promise<readonly WorkSelectionGitHubPullRequest[]> {
  const value = await workSelectionGitHubGet<unknown>(
    input.repository,
    `/repos/${input.repository}/pulls?state=open&base=${encodeURIComponent(input.defaultBranch)}`
      + '&per_page=2&page=1'
  );
  if (!Array.isArray(value)) {
    throw new MainHealthGitHubProviderError('WorkSelection GitHub pull request census is invalid');
  }
  return Object.freeze(value.map((entry, index) => {
    const record = workSelectionGitHubRecord(entry, `pull request ${index}`);
    const head = workSelectionGitHubRecord(record.head, `pull request ${index} head`);
    const base = workSelectionGitHubRecord(record.base, `pull request ${index} base`);
    if (!Number.isSafeInteger(record.number) || (record.number as number) < 1
        || typeof head.ref !== 'string' || head.ref.length === 0
        || typeof base.ref !== 'string' || base.ref.length === 0
        || typeof record.body !== 'string') {
      throw new MainHealthGitHubProviderError(`WorkSelection GitHub pull request ${index} is malformed`);
    }
    return Object.freeze({
      number: record.number as number,
      headBranch: head.ref,
      headSha: workSelectionGitHubSha(head.sha, `pull request ${index} head`),
      baseBranch: base.ref,
      baseSha: workSelectionGitHubSha(base.sha, `pull request ${index} base`),
      body: record.body
    });
  }));
}

export async function observeWorkSelectionGitHubBranchRefs(input: Readonly<{
  repository: string;
}>): Promise<readonly Readonly<{ branch: string; sha: string }>[]> {
  const observations: Array<Readonly<{ branch: string; sha: string }>> = [];
  for (let page = 1; page <= 1_000; page += 1) {
    const value = await workSelectionGitHubGet<unknown>(
      input.repository,
      `/repos/${input.repository}/git/matching-refs/heads/?per_page=100&page=${page}`
    );
    if (!Array.isArray(value)) {
      throw new MainHealthGitHubProviderError('WorkSelection GitHub branch census is invalid');
    }
    for (const [index, entry] of value.entries()) {
      const record = workSelectionGitHubRecord(entry, `branch ${page}:${index}`);
      const ref = record.ref;
      if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')
          || ref.length <= 'refs/heads/'.length) {
        throw new MainHealthGitHubProviderError(`WorkSelection GitHub branch ${page}:${index} is malformed`);
      }
      const object = workSelectionGitHubRecord(record.object, `branch ${page}:${index} object`);
      observations.push(Object.freeze({
        branch: ref.slice('refs/heads/'.length),
        sha: workSelectionGitHubSha(object.sha, `branch ${page}:${index}`)
      }));
    }
    if (value.length < 100) return Object.freeze(observations);
  }
  throw new MainHealthGitHubProviderError('WorkSelection GitHub branch census exceeded 100,000 refs');
}

async function readMainHealthGitHubToken(
  repositoryRoot: string,
  session: MainHealthGitHubRequestSession
): Promise<string> {
  const remainingMs = remainingMainHealthGitHubSessionMs(session);
  reserveMainHealthGitHubRequest(session);
  let tokenBytes: Uint8Array | null = null;
  try {
    tokenBytes = await readGitHubToken({
      cwd: path.resolve(repositoryRoot),
      hostname: 'github.com',
      deadlineAtUnixMs: Math.min(session.deadlineAt, Date.now() + remainingMs)
    });
    remainingMainHealthGitHubSessionMs(session);
    recordMainHealthGitHubResponseBytes(session, tokenBytes.byteLength);
    return new TextDecoder('utf-8', { fatal: true }).decode(tokenBytes);
  } catch {
    throw new MainHealthGitHubCredentialUnavailableError(
      'credential-provider-unavailable'
    );
  } finally {
    tokenBytes?.fill(0);
  }
}

type MainHealthGitHubTokenReader = (
  repositoryRoot: string,
  session: MainHealthGitHubRequestSession
) => Promise<string>;

async function enrollMainHealthGitHubCapability(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: 'read' | 'status-write';
  origin: 'production' | 'test';
  fetchImpl: MainHealthGitHubFetch;
  readToken: MainHealthGitHubTokenReader;
}>): Promise<MainHealthGitHubCapability> {
  const session = mainHealthGitHubRequestSession.getStore();
  if (session === undefined || session.origin !== input.origin) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub capability enrollment requires the active matching session'
    );
  }
  assertMainHealthGitHubSessionBoundary(
    session,
    input.repository,
    input.effect,
    input.origin
  );
  if (session.capability !== undefined) return session.capability;
  const token = await input.readToken(input.repositoryRoot, session);
  const capability = issueMainHealthGitHubCapability({
    repository: input.repository,
    token,
    issuer: Object.freeze({
      transport: 'github-rest-token' as const,
      login: 'pending',
      nodeId: 'pending',
      permission: 'none' as const
    }),
    effect: input.effect,
    fetchImpl: input.fetchImpl,
    origin: input.origin
  });
  session.capability = capability;
  // The temporary principal is never exposed or returned. It exists only in
  // the same session that acquired the credential, so enrollment cannot reset
  // the operation deadline or request/response budgets.
  const principal = await withMainHealthGitHubRequestSession(capability, async () => {
    const viewer = await requestMainHealthGitHubJson<unknown>({
      capability,
      repository: input.repository,
      method: 'GET',
      endpoint: '/user'
    });
    if (viewer === null || typeof viewer !== 'object' || Array.isArray(viewer)) {
      throw new MainHealthGitHubProviderError('MainHealth GitHub token viewer response is invalid');
    }
    const viewerRecord = viewer as Record<string, unknown>;
    const login = viewerRecord.login;
    const nodeId = viewerRecord.node_id;
    if (typeof login !== 'string' || typeof nodeId !== 'string'
        || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login)
        || nodeId.length === 0) {
      throw new MainHealthGitHubProviderError('MainHealth GitHub token principal is invalid');
    }
    const permissionValue = await requestMainHealthGitHubJson<unknown>({
      capability,
      repository: input.repository,
      method: 'GET',
      endpoint: `/repos/${input.repository}/collaborators/${encodeURIComponent(login)}/permission`
    });
    const permission = permissionValue !== null
        && typeof permissionValue === 'object'
        && !Array.isArray(permissionValue)
      ? (permissionValue as Record<string, unknown>).permission
      : null;
    if (typeof permission !== 'string'
        || !['admin', 'maintain', 'write', 'triage', 'read', 'none'].includes(permission)) {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub token repository permission is invalid'
      );
    }
    if (input.origin === 'production'
        && permission !== 'admin' && permission !== 'maintain') {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub production credential requires maintain/admin permission'
      );
    }
    if (input.effect === 'status-write'
        && permission !== 'admin' && permission !== 'maintain') {
      throw new MainHealthGitHubProviderError(
        'MainHealth GitHub token principal lacks maintain/admin permission'
      );
    }
    return Object.freeze({
      transport: 'github-rest-token' as const,
      login,
      nodeId,
      permission: permission as MainHealthGitHubCapabilityIssuer['permission']
    });
  });
  remainingMainHealthGitHubSessionMs(session);
  // Replace the pending handle in the same ALS session. The final handle is
  // the only one visible to the caller and is still tied to the same budget.
  const finalCapability = issueMainHealthGitHubCapability({
    repository: input.repository,
    token,
    issuer: principal,
    effect: input.effect,
    fetchImpl: input.fetchImpl,
    origin: input.origin
  });
  session.capability = finalCapability;
  return finalCapability;
}

/**
 * The only production MainHealth GitHub capability issuer. The credential
 * source remains unavailable until the canonical physical provider issues it;
 * once issued, principal and repository permission must be read back through
 * the same fixed GitHub REST dispatcher used by later provider observations.
 */
async function resolveMainHealthGitHubCapability(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  effect: 'read' | 'status-write';
}>): Promise<MainHealthGitHubCapability> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.repository)) {
    throw new MainHealthGitHubProviderError('MainHealth GitHub repository is invalid');
  }
  return await enrollMainHealthGitHubCapability({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    effect: input.effect,
    origin: 'production',
    fetchImpl: dispatchGitHubApiRequest,
    readToken: readMainHealthGitHubToken
  });
}

async function readMainHealthGitHubTestToken(
  readToken: (input: Readonly<{
    signal: AbortSignal;
    timeoutMs: number;
  }>) => Promise<string>,
  session: MainHealthGitHubRequestSession
): Promise<string> {
  const timeoutMs = remainingMainHealthGitHubSessionMs(session);
  reserveMainHealthGitHubRequest(session);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      if (!session.abortController.signal.aborted) session.abortController.abort();
      reject(new MainHealthGitHubProviderError(
        'MainHealth GitHub test token acquisition deadline exceeded'
      ));
    }, timeoutMs);
  });
  try {
    const token = await Promise.race([
      Promise.resolve().then(() => readToken({
        signal: session.abortController.signal,
        timeoutMs
      })),
      deadline
    ]);
    remainingMainHealthGitHubSessionMs(session);
    if (typeof token !== 'string') {
      throw new MainHealthGitHubProviderError('MainHealth test token grammar is invalid');
    }
    recordMainHealthGitHubResponseBytes(
      session,
      Buffer.byteLength(token, 'utf8')
    );
    const normalizedToken = token.trim();
    if (Buffer.byteLength(token, 'utf8') > MAIN_HEALTH_GITHUB_CREDENTIAL_MAX_TOKEN_BYTES
        || !/^[^\s\u0000-\u001f\u007f-\u009f]{20,1024}$/u.test(normalizedToken)) {
      throw new MainHealthGitHubProviderError('MainHealth test token grammar is invalid');
    }
    return normalizedToken;
  } catch (error) {
    if (error instanceof MainHealthGitHubProviderError) throw error;
    throw new MainHealthGitHubProviderError(
      `MainHealth GitHub test token acquisition unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** @internal Test-only budget seam; it can never mint a production authority. */
export async function withMainHealthGitHubTestEnrollmentSessionV2<T>(input: Readonly<{
  repository: string;
  effect: 'read' | 'status-write';
  fetchImpl: MainHealthGitHubFetch;
  readToken: (input: Readonly<{
    signal: AbortSignal;
    timeoutMs: number;
  }>) => Promise<string>;
  operation: (capability: MainHealthGitHubCapability) => Promise<T>;
  now?: () => number;
  timeoutMs?: number;
}>): Promise<T> {
  const session = createMainHealthGitHubRequestSession({
    repository: input.repository,
    effect: input.effect,
    origin: 'test',
    now: input.now,
    timeoutMs: input.timeoutMs
  });
  try {
    return await mainHealthGitHubRequestSession.run(session, async () => {
      const capability = await enrollMainHealthGitHubCapability({
        repositoryRoot: '',
        repository: input.repository,
        effect: input.effect,
        origin: 'test',
        fetchImpl: input.fetchImpl,
        readToken: async (_repositoryRoot, activeSession) =>
          await readMainHealthGitHubTestToken(input.readToken, activeSession)
      });
      const result = await input.operation(capability);
      remainingMainHealthGitHubSessionMs(session);
      return result;
    });
  } finally {
    disposeMainHealthGitHubRequestSession(session);
  }
}

type MainHealthGitHubTestReadOperationOpen = <T>(
  operation: (capability: MainHealthGitHubCapability) => Promise<T>
) => Promise<T>;

async function withMainHealthGitHubTestSessionUsingBudget<T>(input: Readonly<{
  repository: string;
  fetchImpl: MainHealthGitHubFetch;
  readToken: MainHealthGitHubTokenReader;
  operation: (capability: MainHealthGitHubCapability) => Promise<T>;
  budget: MainHealthGitHubOperationBudget;
}>): Promise<T> {
  assertMainHealthGitHubOperationBudgetBoundary(input.budget, {
    repositoryRoot: '',
    repository: input.repository,
    effect: 'read',
    origin: 'test'
  });
  if (input.budget.sessionCount >= input.budget.maxSessions) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub parent operation session-count budget exceeded'
    );
  }
  const timeoutMs = Math.min(
    MAIN_HEALTH_GITHUB_REQUEST_TIMEOUT_MS,
    remainingMainHealthGitHubOperationBudgetMs(input.budget)
  );
  input.budget.sessionCount += 1;
  const session = createMainHealthGitHubRequestSession({
    repository: input.repository,
    effect: 'read',
    origin: 'test',
    operationBudget: input.budget,
    now: input.budget.now,
    timeoutMs
  });
  try {
    return await mainHealthGitHubRequestSession.run(session, async () => {
      const capability = await enrollMainHealthGitHubCapability({
        repositoryRoot: '',
        repository: input.repository,
        effect: 'read',
        origin: 'test',
        fetchImpl: input.fetchImpl,
        readToken: input.readToken
      });
      const result = await input.operation(capability);
      remainingMainHealthGitHubSessionMs(session);
      return result;
    });
  } finally {
    disposeMainHealthGitHubRequestSession(session);
  }
}

/**
 * @internal Test-only composition seam for the parent-budget contract. It
 * exposes only test-origin capabilities and cannot be used by production
 * observers or effect owners.
 */
export async function withMainHealthGitHubTestReadOperationBudgetV2<T>(input: Readonly<{
  repository: string;
  fetchImpl: MainHealthGitHubFetch;
  readToken: (input: Readonly<{
    signal: AbortSignal;
    timeoutMs: number;
  }>) => Promise<string>;
  operation: (open: MainHealthGitHubTestReadOperationOpen) => Promise<T>;
  now?: () => number;
  timeoutMs: number;
  maxSessions?: number;
}>): Promise<T> {
  return await withMainHealthGitHubOperationBudget({
    repositoryRoot: '',
    repository: input.repository,
    effect: 'read',
    origin: 'test',
    now: input.now,
    timeoutMs: input.timeoutMs,
    maxSessions: input.maxSessions ?? MAIN_HEALTH_GITHUB_MAX_READ_SESSIONS,
    operation: async () => {
      const budget = mainHealthGitHubOperationBudget.getStore();
      if (budget === undefined) {
        throw new MainHealthGitHubProviderError(
          'MainHealth test parent operation budget is not active'
        );
      }
      const open: MainHealthGitHubTestReadOperationOpen = async <R,>(
        operation: (capability: MainHealthGitHubCapability) => Promise<R>
      ) =>
        await withMainHealthGitHubTestSessionUsingBudget({
          repository: input.repository,
          fetchImpl: input.fetchImpl,
          readToken: async (_repositoryRoot, session) =>
            await readMainHealthGitHubTestToken(input.readToken, session),
          operation,
          budget
        });
      return await input.operation(open);
    }
  });
}

/** Reads the live default-branch ref through the already-issued MainHealth
 * GitHub capability. This is intentionally part of the same bound resolver so
 * GH_HOST or an ambient gh CLI host cannot alter the exact-main fence. */
async function observeMainHealthGitHubDefaultBranchShaBound(input: Readonly<{
  repository: string;
  defaultBranch: string;
  capability: MainHealthGitHubCapability;
}>): Promise<string> {
  if (input.defaultBranch !== 'main') {
    throw new MainHealthGitHubProviderError(
      'MainHealth default branch is not the canonical main branch'
    );
  }
  const value = await requestMainHealthGitHubJson<unknown>({
    capability: input.capability,
    repository: input.repository,
    method: 'GET',
    endpoint: `/repos/${input.repository}/git/ref/heads/${encodeURIComponent(input.defaultBranch)}`
  });
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || typeof (value as Record<string, unknown>).object !== 'object'
      || (value as Record<string, unknown>).object === null
      || Array.isArray((value as Record<string, unknown>).object)
      || typeof ((value as Record<string, unknown>).object as Record<string, unknown>).sha
        !== 'string'
      || !/^[0-9a-f]{40}$/u.test(
        ((value as Record<string, unknown>).object as Record<string, unknown>).sha as string
      )) {
    throw new MainHealthGitHubProviderError(
      'MainHealth GitHub default-branch ref response is invalid'
    );
  }
  return ((value as Record<string, unknown>).object as Record<string, unknown>).sha as string;
}

/** Reads the live default-branch ref through the production read session. */
export async function observeMainHealthGitHubDefaultBranchSha(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
}>): Promise<string> {
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => await observeMainHealthGitHubDefaultBranchShaBound({
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      capability: currentMainHealthGitHubCapability(input.repository, 'read')
    })
  });
}

function parseMainHealthGitHubStatusJson(value: unknown, label: string): unknown {
  if (value === undefined) throw new Error(`MainHealth supersession ${label} is not exact JSON`);
  return value;
}

function normalizeMainHealthGitHubStatus(
  value: unknown,
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization
): MainHealthSupersessionProviderAuthorization {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MainHealth supersession GitHub status is not an object');
  }
  const record = value as Record<string, unknown>;
  const creator = record.creator;
  const request = trustedRuntimeMainHealthSupersessionStatusRequest(authorization);
  if (creator === null || typeof creator !== 'object' || Array.isArray(creator)
      || !Number.isSafeInteger(record.id) || Number(record.id) <= 0
      || typeof record.node_id !== 'string' || record.node_id.length === 0
      || record.sha !== authorization.mainSha
      || record.state !== request.state
      || record.context !== request.context
      || record.description !== request.description
      || record.target_url !== request.targetUrl
      || typeof record.created_at !== 'string'
      || typeof record.updated_at !== 'string') {
    throw new Error('MainHealth supersession GitHub status differs from the exact authorization');
  }
  const creatorRecord = creator as Record<string, unknown>;
  if (creatorRecord.login !== authorization.issuer.login
      || creatorRecord.node_id !== authorization.issuer.nodeId) {
    throw new Error('MainHealth supersession GitHub status creator differs from the issuer');
  }
  return Object.freeze({
    transport: 'github-commit-status',
    statusId: Number(record.id),
    statusNodeId: record.node_id,
    state: 'success',
    context: request.context,
    description: request.description,
    targetUrl: request.targetUrl,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    creator: Object.freeze({
      login: authorization.issuer.login,
      nodeId: authorization.issuer.nodeId
    })
  });
}

async function readMainHealthSupersessionStatusContext(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  capability: MainHealthGitHubCapability;
}>): Promise<readonly MainHealthSupersessionProviderAuthorization[]> {
  const request = trustedRuntimeMainHealthSupersessionStatusRequest(input.authorization);
  const readPage = async (page: number): Promise<readonly unknown[]> => {
    const pageValue = parseMainHealthGitHubStatusJson(
      await requestMainHealthGitHubJson<unknown>({
        capability: input.capability,
        repository: input.authorization.repository,
        method: 'GET',
        endpoint: `/repos/${input.authorization.repository}/commits/${input.authorization.mainSha}`
          + `/statuses?per_page=100&page=${page}`
      }),
      'GitHub status inventory'
    );
    if (!Array.isArray(pageValue)) {
      throw new Error('MainHealth supersession GitHub status inventory is not an array');
    }
    for (const candidate of pageValue) {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('MainHealth supersession GitHub status inventory contains a non-object');
      }
      const context = (candidate as Record<string, unknown>).context;
      if (typeof context !== 'string') {
        throw new Error('MainHealth supersession GitHub status context is invalid');
      }
    }
    return Object.freeze([...pageValue]);
  };

  // The statuses endpoint has no total_count.  A single page walk is not a
  // census: a concurrent insert can move a matching status across a page
  // boundary while preserving page one.  Freeze the complete page set and
  // reread every page before any POST/terminal decision.  The terminal page
  // is the explicit boundary (length < 100); a changed boundary or any page
  // bytes/order is a provider observation failure, never permission to retry.
  const firstPages: (readonly unknown[])[] = [];
  let lastPage: number | null = null;
  for (let page = 1; page <= 10; page += 1) {
    const pageValue = await readPage(page);
    firstPages.push(pageValue);
    if (pageValue.length < 100) {
      lastPage = page;
      break;
    }
  }
  if (lastPage === null) {
    throw new Error('MainHealth supersession GitHub status inventory exceeded bounded pagination');
  }
  const secondPages: (readonly unknown[])[] = [];
  for (let page = 1; page <= lastPage; page += 1) {
    const pageValue = await readPage(page);
    const firstPage = firstPages[page - 1]!;
    if (pageValue.length !== firstPage.length
        || encodeVerificationActionData(pageValue)
          !== encodeVerificationActionData(firstPage)) {
      throw new MainHealthGitHubProviderError(
        'MainHealth supersession GitHub status inventory changed during complete stable readback'
      );
    }
    if (page < lastPage && pageValue.length < 100) {
      throw new MainHealthGitHubProviderError(
        'MainHealth supersession GitHub status pagination shortened during stable readback'
      );
    }
    if (page === lastPage && pageValue.length >= 100) {
      throw new MainHealthGitHubProviderError(
        'MainHealth supersession GitHub status pagination boundary extended during stable readback'
      );
    }
    secondPages.push(pageValue);
  }

  const matches: MainHealthSupersessionProviderAuthorization[] = [];
  for (const pageValue of secondPages) {
    for (const candidate of pageValue) {
      const context = (candidate as Record<string, unknown>).context as string;
      if (context.toLowerCase() === request.context.toLowerCase()) {
        matches.push(normalizeMainHealthGitHubStatus(candidate, input.authorization));
      }
    }
  }
  return Object.freeze(matches);
}

async function observeMainHealthSupersessionProviderAuthorization(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  capability: MainHealthGitHubCapability;
  expected?: MainHealthSupersessionProviderAuthorization;
}>): Promise<MainHealthSupersessionProviderAuthorization> {
  const statuses = await readMainHealthSupersessionStatusContext(input);
  if (statuses.length !== 1) {
    throw new Error('MainHealth supersession GitHub authorization is absent, duplicated, or conflicting');
  }
  const status = statuses[0]!;
  if (input.expected !== undefined
      && encodeVerificationActionData(status)
        !== encodeVerificationActionData(input.expected)) {
    throw new Error('MainHealth supersession GitHub authorization readback changed');
  }
  return status;
}

/**
 * Revalidate every local and external authority which controls the only
 * status POST.  This check intentionally runs immediately before the status
 * inventory/POST boundary and is repeated by the terminal fence.  In
 * particular, a check-run observation for the same commit is not evidence
 * that the mutable default branch still points at that commit.
 */
async function assertMainHealthStatusEffectFence(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  capability: MainHealthGitHubCapability;
  preimage: ReturnType<typeof observeTrustedLocalSupersessionPreimage>;
  runtimeAuthority: MainHealthRuntimeAuthority;
  defaultBranch: string;
}>): Promise<void> {
  if (input.defaultBranch !== input.authorization.hostedLedger.defaultBranch) {
    throw new MainHealthExternalMainDriftError(
      input.authorization.hostedLedger.defaultBranch,
      input.defaultBranch
    );
  }
  assertMainHealthSupersessionSourceExact(
    input.preimage,
    'immediately before status effect'
  );
  assertMainHealthSupersessionAuthorizationSource(
    input.preimage,
    input.authorization,
    'immediately before status effect'
  );
  await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
  await assertCurrentMainHealthSupersessionIssuer({
    authorization: input.authorization,
    capability: input.capability
  });
  const observedMainSha = await observeMainHealthGitHubDefaultBranchShaBound({
    repository: input.authorization.repository,
    defaultBranch: input.authorization.hostedLedger.defaultBranch,
    capability: input.capability
  });
  if (observedMainSha !== input.authorization.mainSha) {
    throw new MainHealthExternalMainDriftError(
      input.authorization.mainSha,
      observedMainSha
    );
  }
}

async function ensureMainHealthSupersessionProviderAuthorization(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  capability: MainHealthGitHubCapability;
  allowPublish: boolean;
  defaultBranch: string;
  preimage: ReturnType<typeof observeTrustedLocalSupersessionPreimage>;
  runtimeAuthority: MainHealthRuntimeAuthority;
  intentDigest: SecWorkDigest;
  permitState: Readonly<{
    available: MainHealthSupersessionPermitCandidate | null;
    consumed: MainHealthSupersessionPermitCandidate | null;
  }>;
}>): Promise<Readonly<{
  providerAuthorization: MainHealthSupersessionProviderAuthorization;
  created: boolean;
}>> {
  await assertMainHealthStatusEffectFence(input);
  const before = await readMainHealthSupersessionStatusContext(input);
  if (before.length === 1) {
    if (input.permitState.consumed === null) {
      throw new Error(
        'MainHealth supersession status exists without a consumed durable Effect permit'
      );
    }
    return Object.freeze({ providerAuthorization: before[0]!, created: false });
  }
  if (before.length !== 0) {
    throw new Error('MainHealth supersession GitHub authorization is duplicated or conflicting');
  }
  if (!input.allowPublish || input.permitState.consumed !== null
      || input.permitState.available === null) {
    throw new Error(
      input.permitState.consumed === null
        ? 'MainHealth supersession prepared intent status is absent and its permit is ambiguous'
        : 'MainHealth supersession prepared intent status is absent after its permit was consumed'
    );
  }
  const consumed = publishMainHealthSupersessionPermit({
    directory: input.preimage.directory,
    authorization: input.authorization,
    intentDigest: input.intentDigest,
    phase: 'consumed'
  });
  if (!consumed.created) {
    throw new Error(
      'MainHealth supersession durable Effect permit was already consumed; status is ambiguous'
    );
  }
  // The consumed transition is the final durable admission before the
  // external effect. Re-read every authority again so a drift discovered in
  // this last window prevents the POST; a subsequent invocation will observe
  // the consumed permit and refuse to retry blindly.
  await assertMainHealthStatusEffectFence(input);
  const request = trustedRuntimeMainHealthSupersessionStatusRequest(input.authorization);
  const publication = await requestMainHealthGitHubJson<unknown>({
    capability: input.capability,
    repository: input.authorization.repository,
    method: 'POST',
    endpoint: `/repos/${input.authorization.repository}/statuses/${input.authorization.mainSha}`,
    body: Object.freeze({
      state: request.state,
      context: request.context,
      description: request.description,
      target_url: request.targetUrl
    })
  });
  let published: MainHealthSupersessionProviderAuthorization;
  try {
    published = normalizeMainHealthGitHubStatus(publication, input.authorization);
  } catch (error) {
    // A successful response with an unusable body is not permission to retry.
    throw new Error(
      `MainHealth supersession GitHub publication response is unusable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // The response is never treated as terminal authority until the inventory
  // readback observes exactly one matching status.  A lost response therefore
  // cannot induce a second POST on this or a later invocation.
  const readback = await observeMainHealthSupersessionProviderAuthorization({
    authorization: input.authorization,
    capability: input.capability
  });
  if (encodeVerificationActionData(readback)
      !== encodeVerificationActionData(published)) {
    throw new Error('MainHealth supersession GitHub publication response differs from readback');
  }
  return Object.freeze({ providerAuthorization: readback, created: true });
}

/**
 * Completes a prepared status whose original hosted ledger is no longer the
 * live provider authority.  The status itself is still an exact, uniquely
 * readable effect, so publishing its immutable terminal preserves the crash
 * evidence and gives the next operation an authenticated predecessor.  This
 * path never re-POSTs and deliberately does not pretend the stale hosted
 * ledger is current; the normal observer marks this terminal inactive and
 * resolves the newly chained successor against the live provider.
 */
async function publishPreparedHistoricalTerminal(input: Readonly<{
  repositoryRoot: string;
  preimage: ReturnType<typeof observeTrustedLocalSupersessionPreimage>;
  prepared: MainHealthSupersessionPreparedCandidate;
  githubCapability: MainHealthGitHubCapability;
  runtimeAuthority: MainHealthRuntimeAuthority;
  operationLease?: PhysicalMutationLeaseHandle;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  receipt: TrustedRuntimeMainHealthSupersessionReceipt;
  recordPath: string;
}>> {
  const authorization = preparedAuthorization(input.prepared);
  const boundDirectory = mainHealthRuntimeAuthorityDirectory(
    input.runtimeAuthority,
    input.preimage.directory
  );
  const operationLease = input.operationLease ?? acquirePhysicalMutationLease(
    boundDirectory,
    authorization.operationLeaseName
  );
  if (operationLease === null) {
    throw new Error('MainHealth supersession historical terminal lease is already active');
  }
  const releaseLease = input.operationLease === undefined;
  try {
    assertMainHealthSupersessionSourceExact(input.preimage, 'before historical terminal');
    assertMainHealthSupersessionAuthorizationSource(
      input.preimage,
      authorization,
      'before historical terminal'
    );
    await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    const statuses = await readMainHealthSupersessionStatusContext({
      authorization,
      capability: input.githubCapability
    });
    if (statuses.length === 0) {
      throw new Error(
        'MainHealth prepared status disappeared; historical terminal is ambiguous and cannot retry'
      );
    }
    if (statuses.length !== 1) {
      throw new Error(
        'MainHealth prepared status is duplicated or conflicting; historical terminal is blocked'
      );
    }
    const evidence = readMainHealthSupersessionEvidence({
      repositoryRoot: input.repositoryRoot,
      repository: authorization.repository,
      environment: input.environment
    });
    const linked = evidence.terminals.filter(({ receipt }) =>
        receipt.mainSha === authorization.mainSha
        && receipt.mainTreeSha === authorization.mainTreeSha
        && receipt.preparedIntentDigest === input.prepared.intent.intentDigest);
    if (linked.length > 1) {
      throw new Error('MainHealth prepared status has duplicate historical terminals');
    }
    if (linked.length === 1
        && encodeVerificationActionData(linked[0]!.receipt.providerAuthorization)
          !== encodeVerificationActionData(statuses[0]!)) {
      throw new Error('MainHealth prepared historical terminal provider status changed');
    }
    const terminal = linked[0]?.receipt ?? createTrustedRuntimeMainHealthSupersessionReceipt({
      authorization,
      preparedIntentDigest: input.prepared.intent.intentDigest,
      providerAuthorization: statuses[0]!
    });
    const recordBytes = trustedRuntimeMainHealthSupersessionReceiptBytes(terminal);
    const supersessionDirectory = createNoFollowDirectoryChain(
      input.preimage.directory,
      ['supersessions']
    );
    const recordName = [
      'supersession', terminal.operationId.slice('sha256:'.length),
      terminal.recordDigest.slice('sha256:'.length)
    ].join('-') + '.json';
    if (linked.length === 0) {
      publishExclusiveDurableCanonicalFile({
        parent: supersessionDirectory,
        name: recordName,
        bytes: recordBytes,
        validate: (bytes) => {
          const parsed = parseTrustedRuntimeMainHealthSupersessionReceipt(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          );
          if (!Buffer.from(bytes).equals(trustedRuntimeMainHealthSupersessionReceiptBytes(parsed))) {
            throw new Error('MainHealth historical terminal bytes are not canonical');
          }
        }
      });
    }
    const readback = readNoFollowOrdinaryFile(supersessionDirectory, recordName);
    if (readback === null || !Buffer.from(readback).equals(recordBytes)) {
      throw new Error('MainHealth historical terminal differs after publication');
    }
    assertMainHealthSupersessionSourceExact(input.preimage, 'during historical terminal readback');
    await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    return Object.freeze({
      receipt: terminal,
      recordPath: path.join(supersessionDirectory.path, recordName)
    });
  } finally {
    if (releaseLease) operationLease.release();
  }
}

function preparedAuthorization(
  prepared: MainHealthSupersessionPreparedCandidate
): TrustedRuntimeMainHealthSupersessionAuthorization {
  return prepared.intent.authorization;
}

function assertMainHealthSupersessionSourceExact(
  preimage: ReturnType<typeof observeTrustedLocalSupersessionPreimage>,
  phase: string
): void {
  const current = inspectNoFollowOrdinaryFileEntry(
    preimage.directory,
    preimage.source.relativePath
  );
  if (current === null) throw new Error(`MainHealth supersession source disappeared ${phase}`);
  const expectedBytes = preimage.source.bytes;
  if (current.kind !== 'file' || current.bytes === null || expectedBytes === null
      || current.device !== preimage.source.device
      || current.inode !== preimage.source.inode
      || current.size !== preimage.source.size
      || !Buffer.from(current.bytes).equals(Buffer.from(expectedBytes))) {
    throw new Error(`MainHealth supersession source changed ${phase}`);
  }
}

type MainHealthSupersessionTerminalCandidate = Readonly<{
  receipt: TrustedRuntimeMainHealthSupersessionReceipt;
  recordPath: string;
}>;

type MainHealthSupersessionPreparedCandidate = Readonly<{
  intent: TrustedRuntimeMainHealthSupersessionIntent;
  recordPath: string;
}>;

type MainHealthSupersessionPermitCandidate = Readonly<{
  permit: TrustedRuntimeMainHealthSupersessionPermit;
  recordPath: string;
}>;

function readMainHealthSupersessionEvidence(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  environment?: NodeJS.ProcessEnv;
}>): Readonly<{
  root: ReturnType<typeof inspectExactNoFollowDirectoryPresence>;
  terminals: readonly MainHealthSupersessionTerminalCandidate[];
  prepared: readonly MainHealthSupersessionPreparedCandidate[];
  permits: readonly MainHealthSupersessionPermitCandidate[];
}> {
  const layout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    environment: input.environment
  });
  const root = inspectExactNoFollowDirectoryPresence(
    path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1'),
    'MainHealth supersession recovery root'
  );
  if (root.state === 'absent') {
    return Object.freeze({
      root,
      terminals: Object.freeze([]),
      prepared: Object.freeze([]),
      permits: Object.freeze([])
    });
  }
  const terminals: MainHealthSupersessionTerminalCandidate[] = [];
  const terminalPath = path.join(root.directory.target.path, 'supersessions');
  const terminalDirectory = inspectExactNoFollowDirectoryPresence(
    terminalPath,
    'MainHealth supersession recovery receipts'
  );
  if (terminalDirectory.state === 'present') {
    for (const entry of scanNoFollowDirectoryTree(terminalDirectory.directory.target)) {
      if (!/^supersession-[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(entry.relativePath)
          || entry.kind !== 'file' || entry.bytes === null) {
        throw new Error(`unknown supersession terminal entry: ${entry.relativePath}`);
      }
      const receipt = parseTrustedRuntimeMainHealthSupersessionReceipt(
        new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes)
      );
      if (!Buffer.from(entry.bytes).equals(trustedRuntimeMainHealthSupersessionReceiptBytes(receipt))) {
        throw new Error(`supersession terminal bytes are not canonical: ${entry.relativePath}`);
      }
      const expectedName = [
        'supersession', receipt.operationId.slice('sha256:'.length),
        receipt.recordDigest.slice('sha256:'.length)
      ].join('-') + '.json';
      if (entry.relativePath !== expectedName) {
        throw new Error(`supersession terminal name mismatch: ${entry.relativePath}`);
      }
      if (receipt.repository === input.repository) {
        terminals.push(Object.freeze({
          receipt,
          recordPath: path.join(terminalPath, entry.relativePath)
        }));
      }
    }
  }
  const prepared: MainHealthSupersessionPreparedCandidate[] = [];
  const preparedPath = path.join(root.directory.target.path, 'prepared');
  const preparedDirectory = inspectExactNoFollowDirectoryPresence(
    preparedPath,
    'MainHealth supersession prepared intents'
  );
  if (preparedDirectory.state === 'present') {
    for (const entry of scanNoFollowDirectoryTree(preparedDirectory.directory.target)) {
      if (!/^prepared-[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(entry.relativePath)
          || entry.kind !== 'file' || entry.bytes === null) {
        throw new Error(`unknown supersession prepared entry: ${entry.relativePath}`);
      }
      const intent = parseTrustedRuntimeMainHealthSupersessionIntent(
        new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes)
      );
      const expectedName = [
        'prepared', intent.authorization.operationId.slice('sha256:'.length),
        intent.intentDigest.slice('sha256:'.length)
      ].join('-') + '.json';
      if (entry.relativePath !== expectedName
          || !Buffer.from(entry.bytes).equals(
            Buffer.from(`${encodeVerificationActionData(intent)}\n`, 'utf8')
          )) {
        throw new Error(`supersession prepared name or bytes mismatch: ${entry.relativePath}`);
      }
      if (intent.authorization.repository === input.repository) {
        prepared.push(Object.freeze({
          intent,
          recordPath: path.join(preparedPath, entry.relativePath)
        }));
      }
    }
  }
  const permits: MainHealthSupersessionPermitCandidate[] = [];
  const permitPath = path.join(root.directory.target.path, 'permits');
  const permitDirectory = inspectExactNoFollowDirectoryPresence(
    permitPath,
    'MainHealth supersession Effect permits'
  );
  if (permitDirectory.state === 'present') {
    for (const entry of scanNoFollowDirectoryTree(permitDirectory.directory.target)) {
      if (!/^permit-[0-9a-f]{64}-[0-9a-f]{64}-(?:available|consumed)\.json$/u.test(
        entry.relativePath
      ) || entry.kind !== 'file' || entry.bytes === null) {
        throw new Error(`unknown supersession permit entry: ${entry.relativePath}`);
      }
      const permit = parseTrustedRuntimeMainHealthSupersessionPermit(
        new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes)
      );
      const expectedName = [
        'permit', permit.operationId.slice('sha256:'.length),
        permit.intentDigest.slice('sha256:'.length), permit.phase
      ].join('-') + '.json';
      if (entry.relativePath !== expectedName
          || !Buffer.from(entry.bytes).equals(
            trustedRuntimeMainHealthSupersessionPermitBytes(permit)
          )) {
        throw new Error(`supersession permit name or bytes mismatch: ${entry.relativePath}`);
      }
      if (permit.repository === input.repository) {
        permits.push(Object.freeze({
          permit,
          recordPath: path.join(permitPath, entry.relativePath)
        }));
      }
    }
  }
  return Object.freeze({ root, terminals, prepared, permits });
}

export type MainHealthSupersessionObservation =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{
      kind: 'active';
      supersession: Readonly<{
        status: 'resumed-superseded';
        receipt: TrustedRuntimeMainHealthSupersessionReceipt;
        recordPath: string;
      }>;
    }>
  | Readonly<{
      kind: 'prepared';
      intent: TrustedRuntimeMainHealthSupersessionIntent;
      recordPath: string;
      /** The prepared status is exact, but its recorded hosted ledger is no
       * longer the current provider authority and must be terminalized as
       * inactive before a successor can be prepared. */
      providerDrift: boolean;
    }>
  | Readonly<{
      kind: 'inactive';
      ref: SecWorkDigest;
      /** The inactive maximal terminal remains the authenticated predecessor. */
      recordDigest: SecWorkDigest;
    }>
  | Readonly<{ kind: 'blocked'; ref: SecWorkDigest }>;

function mainHealthSupersessionRef(reason: string, detail: unknown): SecWorkDigest {
  return digestRef(Object.freeze({
    schema: 'sec-main-health-supersession-observation-v2',
    reason,
    detail
  }));
}

function mainHealthSupersessionBlocked(
  reason: string,
  detail: unknown
): MainHealthSupersessionObservation {
  return Object.freeze({ kind: 'blocked', ref: mainHealthSupersessionRef(reason, detail) });
}

function mainHealthSupersessionInactive(
  reason: string,
  detail: unknown,
  recordDigest: SecWorkDigest
): MainHealthSupersessionObservation {
  return Object.freeze({
    kind: 'inactive',
    ref: mainHealthSupersessionRef(reason, detail),
    recordDigest
  });
}

type MainHealthSupersessionChainAdmission =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'leaf'; candidate: MainHealthSupersessionTerminalCandidate }>
  | Readonly<{ kind: 'blocked'; ref: SecWorkDigest }>;

/**
 * Select one authenticated maximal terminal from immutable history. A
 * predecessor is a chain edge, not a hint: missing parents, cycles and forks
 * are fail-closed because two competing effect histories cannot safely project
 * the same exact-main subject.
 */
function admitMainHealthSupersessionChain(
  terminals: readonly MainHealthSupersessionTerminalCandidate[]
): MainHealthSupersessionChainAdmission {
  if (terminals.length === 0) return Object.freeze({ kind: 'empty' });
  const byDigest = new Map<string, MainHealthSupersessionTerminalCandidate>();
  for (const candidate of terminals) {
    const key = candidate.receipt.recordDigest;
    if (byDigest.has(key)) {
      return Object.freeze({
        kind: 'blocked',
        ref: mainHealthSupersessionRef('duplicate-supersession-terminal-digest', key)
      });
    }
    byDigest.set(key, candidate);
  }
  const childByParent = new Map<string, MainHealthSupersessionTerminalCandidate>();
  for (const candidate of terminals) {
    const predecessor = candidate.receipt.predecessorRecordDigest;
    if (predecessor === null) continue;
    if (predecessor === candidate.receipt.recordDigest) {
      return Object.freeze({
        kind: 'blocked',
        ref: mainHealthSupersessionRef('supersession-chain-cycle', {
          recordDigest: candidate.receipt.recordDigest,
          predecessor
        })
      });
    }
    const parent = byDigest.get(predecessor);
    if (parent === undefined) {
      return Object.freeze({
        kind: 'blocked',
        ref: mainHealthSupersessionRef('supersession-chain-predecessor-missing', {
          recordDigest: candidate.receipt.recordDigest,
          predecessor
        })
      });
    }
    const existingChild = childByParent.get(predecessor);
    if (existingChild !== undefined
        && existingChild.receipt.recordDigest !== candidate.receipt.recordDigest) {
      return Object.freeze({
        kind: 'blocked',
        ref: mainHealthSupersessionRef('supersession-chain-fork', {
          predecessor,
          childDigests: [
            existingChild.receipt.recordDigest,
            candidate.receipt.recordDigest
          ].sort()
        })
      });
    }
    childByParent.set(predecessor, candidate);
  }
  for (const candidate of terminals) {
    const visited = new Set<string>();
    let current: MainHealthSupersessionTerminalCandidate | undefined = candidate;
    while (current !== undefined && current.receipt.predecessorRecordDigest !== null) {
      const key = current.receipt.recordDigest;
      if (visited.has(key)) {
        return Object.freeze({
          kind: 'blocked',
          ref: mainHealthSupersessionRef('supersession-chain-cycle', key)
        });
      }
      visited.add(key);
      current = byDigest.get(current.receipt.predecessorRecordDigest);
    }
  }
  const leaves = terminals.filter(({ receipt }) => !childByParent.has(receipt.recordDigest));
  if (leaves.length !== 1) {
    return Object.freeze({
      kind: 'blocked',
      ref: mainHealthSupersessionRef('supersession-chain-maximal-terminal-ambiguous', {
        leafDigests: leaves.map(({ receipt }) => receipt.recordDigest).sort()
      })
    });
  }
  return Object.freeze({ kind: 'leaf', candidate: leaves[0]! });
}

async function observeMainHealthPreparedSupersession(input: Readonly<{
  candidate: MainHealthSupersessionPreparedCandidate;
  hostedProvider: WorkSelectionMainHealthProviderObservation;
  capability?: MainHealthGitHubCapability;
  runtimeAuthority?: MainHealthRuntimeAuthority;
}>): Promise<MainHealthSupersessionObservation> {
  const preparedCandidate = input.candidate;
  if (input.runtimeAuthority !== undefined
      && preparedCandidate.intent.authorization.runtimeAuthorityBinding
        !== mainHealthRuntimeAuthorityBinding(input.runtimeAuthority).binding) {
    return mainHealthSupersessionBlocked('prepared-runtime-authority-mismatch', {
      intentDigest: preparedCandidate.intent.intentDigest,
      intentBinding: preparedCandidate.intent.authorization.runtimeAuthorityBinding,
      currentBinding: mainHealthRuntimeAuthorityBinding(input.runtimeAuthority).binding
    });
  }
  if (input.capability === undefined) {
    return mainHealthSupersessionBlocked(
      'prepared-provider-capability-unavailable', preparedCandidate.intent.intentDigest
    );
  }
  if (input.hostedProvider.kind !== 'available') {
    return mainHealthSupersessionBlocked(
      'prepared-hosted-provider-unavailable',
      input.hostedProvider.kind
    );
  }
  const providerDrift = hostedMainHealthAuthorityDigest(input.hostedProvider.ledger)
    !== preparedCandidate.intent.authorization.hostedAuthorityDigest;
  let statuses: readonly MainHealthSupersessionProviderAuthorization[];
  try {
    statuses = await readMainHealthSupersessionStatusContext({
      authorization: preparedCandidate.intent.authorization,
      capability: input.capability
    });
    if (statuses.length === 1) {
      await assertCurrentMainHealthSupersessionIssuer({
        authorization: preparedCandidate.intent.authorization,
        capability: input.capability
      });
    }
    if (input.runtimeAuthority !== undefined) {
      await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    }
  } catch (error) {
    if (error instanceof MainHealthGitHubProviderError
        && (error.statusCode === 401 || error.statusCode === 403
          || error.message.includes('identity') || error.message.includes('permission'))) {
      return mainHealthSupersessionBlocked('prepared-issuer-permission-drift', error.message);
    }
    return mainHealthSupersessionBlocked(
      'prepared-provider-observation-unavailable',
      error instanceof Error ? error.message : String(error)
    );
  }
  if (statuses.length === 0) {
    return mainHealthSupersessionBlocked(
      'prepared-intent-zero-status-ambiguous', preparedCandidate.intent.intentDigest
    );
  }
  if (statuses.length !== 1) {
    return mainHealthSupersessionBlocked('prepared-intent-status-duplicate', {
      intentDigest: preparedCandidate.intent.intentDigest,
      count: statuses.length
    });
  }
  return Object.freeze({
    kind: 'prepared',
    intent: preparedCandidate.intent,
    recordPath: preparedCandidate.recordPath,
    providerDrift
  });
}

async function observeMainHealthSupersession(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  hostedProvider: WorkSelectionMainHealthProviderObservation;
  capability?: MainHealthGitHubCapability;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<MainHealthSupersessionObservation> {
  try {
    const evidence = readMainHealthSupersessionEvidence(input);
    if (evidence.root.state === 'absent') return Object.freeze({ kind: 'absent' });
    const terminals = evidence.terminals.filter(({ receipt }) =>
      receipt.mainSha === input.mainSha && receipt.mainTreeSha === input.mainTreeSha);
    const allPrepared = evidence.prepared.filter(({ intent }) =>
      intent.authorization.mainSha === input.mainSha
        && intent.authorization.mainTreeSha === input.mainTreeSha);
    const terminalsByPreparedDigest = new Map<string, MainHealthSupersessionTerminalCandidate[]>();
    for (const terminal of terminals) {
      const linked = terminalsByPreparedDigest.get(terminal.receipt.preparedIntentDigest) ?? [];
      linked.push(terminal);
      terminalsByPreparedDigest.set(terminal.receipt.preparedIntentDigest, linked);
    }
    const consumedPreparedDigests = new Set<string>();
    for (const preparedCandidate of allPrepared) {
      const linked = terminalsByPreparedDigest.get(preparedCandidate.intent.intentDigest);
      if (linked === undefined) continue;
      if (linked.length !== 1) {
        return mainHealthSupersessionBlocked('prepared-intent-terminal-linkage-duplicate', {
          intentDigest: preparedCandidate.intent.intentDigest,
          terminalDigests: linked.map(({ receipt }) => receipt.recordDigest).sort()
        });
      }
      const terminal = linked[0]!.receipt;
      if (terminal.operationId !== preparedCandidate.intent.authorization.operationId
          || encodeVerificationActionData(
            mainHealthSupersessionAuthorizationStableValue(preparedCandidate.intent.authorization)
          ) !== encodeVerificationActionData(
            mainHealthSupersessionAuthorizationStableValue(terminal)
          )) {
        return mainHealthSupersessionBlocked('prepared-intent-terminal-linkage-mismatch', {
          intentDigest: preparedCandidate.intent.intentDigest,
          terminalDigest: terminal.recordDigest
        });
      }
      consumedPreparedDigests.add(preparedCandidate.intent.intentDigest);
    }
    const prepared = allPrepared.filter(({ intent }) =>
      !consumedPreparedDigests.has(intent.intentDigest));
    for (const terminal of terminals) {
      if (!allPrepared.some(({ intent }) => intent.intentDigest === terminal.receipt.preparedIntentDigest)) {
        return mainHealthSupersessionBlocked('terminal-prepared-intent-missing', {
          terminalDigest: terminal.receipt.recordDigest,
          preparedIntentDigest: terminal.receipt.preparedIntentDigest
        });
      }
    }
    // A terminal is consumable only when its immutable prepared intent has a
    // complete available->consumed permit chain.  Keep both records forever;
    // their presence is the crash/restart proof that this operation cannot
    // be POSTed again.
    for (const terminal of terminals) {
      const preparedIntent = allPrepared.find(({ intent }) =>
        intent.intentDigest === terminal.receipt.preparedIntentDigest);
      if (preparedIntent === undefined) continue;
      try {
        const permitState = matchingMainHealthSupersessionPermits(
          evidence,
          terminal.receipt,
          preparedIntent.intent.intentDigest
        );
        if (permitState.consumed === null) {
          return mainHealthSupersessionBlocked(
            'terminal-consumed-permit-missing',
            terminal.receipt.recordDigest
          );
        }
      } catch (error) {
        return mainHealthSupersessionBlocked(
          'terminal-permit-transition-invalid',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    if (prepared.length > 1) {
      return mainHealthSupersessionBlocked('duplicate-or-conflicting-supersession-evidence', {
        terminalDigests: terminals.map(({ receipt }) => receipt.recordDigest).sort(),
        preparedDigests: prepared.map(({ intent }) => intent.intentDigest).sort()
      });
    }
    for (const preparedCandidate of prepared) {
      try {
        const permitState = matchingMainHealthSupersessionPermits(
          evidence,
          preparedCandidate.intent.authorization,
          preparedCandidate.intent.intentDigest
        );
        if (permitState.available === null) {
          return mainHealthSupersessionBlocked(
            'prepared-available-permit-missing',
            preparedCandidate.intent.intentDigest
          );
        }
      } catch (error) {
        return mainHealthSupersessionBlocked(
          'prepared-permit-transition-invalid',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    const chain = admitMainHealthSupersessionChain(terminals);
    if (chain.kind === 'blocked') return chain;
    if (chain.kind === 'empty') {
      if (prepared.length === 0) return Object.freeze({ kind: 'absent' });
      const preparedCandidate = prepared[0]!;
      if (preparedCandidate.intent.authorization.predecessorRecordDigest !== null) {
        return mainHealthSupersessionBlocked('prepared-predecessor-missing', {
          intentDigest: preparedCandidate.intent.intentDigest,
          predecessorRecordDigest: preparedCandidate.intent.authorization.predecessorRecordDigest
        });
      }
      return observeMainHealthPreparedSupersession({
        candidate: preparedCandidate,
        hostedProvider: input.hostedProvider,
        capability: input.capability,
        runtimeAuthority: input.runtimeAuthority
      });
    }
    if (chain.kind === 'leaf') {
      const active = chain.candidate;
      const terminalInactive = async (
        reason: string,
        detail: unknown
      ): Promise<MainHealthSupersessionObservation> => {
        const inactive = mainHealthSupersessionInactive(
          reason,
          detail,
          active.receipt.recordDigest
        );
        if (prepared.length === 0) return inactive;
        const preparedCandidate = prepared[0]!;
        if (preparedCandidate.intent.authorization.predecessorRecordDigest
            !== active.receipt.recordDigest) {
          return mainHealthSupersessionBlocked('prepared-predecessor-does-not-match-maximal-terminal', {
            terminalDigest: active.receipt.recordDigest,
            preparedDigest: preparedCandidate.intent.intentDigest,
            preparedPredecessor: preparedCandidate.intent.authorization.predecessorRecordDigest
          });
        }
        return observeMainHealthPreparedSupersession({
          candidate: preparedCandidate,
          hostedProvider: input.hostedProvider,
          capability: input.capability,
          runtimeAuthority: input.runtimeAuthority
        });
      };
      const sourceName = `main-${input.mainSha}.json`;
      const source = inspectNoFollowOrdinaryFileEntry(evidence.root.directory.target, sourceName);
      const localBytes = Buffer.from(
        `${encodeVerificationActionData(active.receipt.localReceipt)}\n`,
        'utf8'
      );
      if (source === null || source.bytes === null || source.kind !== 'file'
          || active.receipt.sourceName !== sourceName
          || active.receipt.source.device !== source.device
          || active.receipt.source.inode !== source.inode
          || active.receipt.source.size !== source.size
          || !Buffer.from(source.bytes).equals(localBytes)) {
        return terminalInactive('superseded-local-source-identity-drift', {
          sourceName,
          candidateDigest: active.receipt.recordDigest
        });
      }
      if (input.runtimeAuthority !== undefined
          && active.receipt.runtimeAuthorityBinding
            !== mainHealthRuntimeAuthorityBinding(input.runtimeAuthority).binding) {
        return terminalInactive('superseded-runtime-authority-drift', {
          candidateBinding: active.receipt.runtimeAuthorityBinding,
          currentBinding: mainHealthRuntimeAuthorityBinding(input.runtimeAuthority).binding
        });
      }
      if (input.hostedProvider.kind !== 'available') {
        return mainHealthSupersessionBlocked(
          'superseding-hosted-provider-unavailable', input.hostedProvider.kind
        );
      }
      const recordedHostedAuthorityDigest = hostedMainHealthAuthorityDigest(
        active.receipt.hostedLedger
      );
      const currentHostedAuthorityDigest = hostedMainHealthAuthorityDigest(
        input.hostedProvider.ledger
      );
      if (recordedHostedAuthorityDigest !== active.receipt.hostedAuthorityDigest
          || currentHostedAuthorityDigest !== active.receipt.hostedAuthorityDigest) {
        return terminalInactive('superseding-hosted-provider-drift', {
          recordedHostedAuthorityDigest,
          currentHostedAuthorityDigest,
          receiptHostedAuthorityDigest: active.receipt.hostedAuthorityDigest
        });
      }
      if (input.capability === undefined) {
        return mainHealthSupersessionBlocked(
          'supersession-provider-capability-unavailable', active.receipt.recordDigest
        );
      }
      try {
        const statuses = await readMainHealthSupersessionStatusContext({
          authorization: active.receipt,
          capability: input.capability
        });
        if (statuses.length === 0) {
          return terminalInactive('supersession-provider-status-drift', {
            candidateDigest: active.receipt.recordDigest,
            status: 'absent'
          });
        }
        if (statuses.length !== 1) {
          return mainHealthSupersessionBlocked('supersession-provider-status-duplicate', {
            candidateDigest: active.receipt.recordDigest,
            count: statuses.length
          });
        }
        if (encodeVerificationActionData(statuses[0])
            !== encodeVerificationActionData(active.receipt.providerAuthorization)) {
          return terminalInactive('supersession-provider-status-drift', {
            candidateDigest: active.receipt.recordDigest
          });
        }
        await assertCurrentMainHealthSupersessionIssuer({
          authorization: active.receipt,
          capability: input.capability
        });
        if (input.runtimeAuthority !== undefined) {
          await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
        }
      } catch (error) {
        if (error instanceof MainHealthGitHubProviderError
            && (error.statusCode === 401 || error.statusCode === 403
              || error.message.includes('identity') || error.message.includes('permission'))) {
          return terminalInactive(
            'supersession-issuer-permission-drift',
            error.message
          );
        }
        return mainHealthSupersessionBlocked(
          'supersession-provider-observation-unavailable',
          error instanceof Error ? error.message : String(error)
        );
      }
      if (prepared.length !== 0) {
        return mainHealthSupersessionBlocked('prepared-with-active-terminal', {
          terminalDigest: active.receipt.recordDigest,
          preparedDigests: prepared.map(({ intent }) => intent.intentDigest).sort()
        });
      }
      return Object.freeze({
        kind: 'active',
        supersession: Object.freeze({ status: 'resumed-superseded', ...active })
      });
    }
    return Object.freeze({ kind: 'blocked', ref: mainHealthSupersessionRef(
      'supersession-chain-unreachable',
      terminals.map(({ receipt }) => receipt.recordDigest).sort()
    ) });
  } catch (error) {
    return mainHealthSupersessionBlocked(
      'supersession-physical-observation-unavailable',
      error instanceof PhysicalNoFollowError
        ? Object.freeze({ code: error.code, message: error.message })
        : error instanceof Error ? error.message : String(error)
    );
  }
}

async function observeMainHealthProvidersBase(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  capability: MainHealthGitHubCapability;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  observedAt: string;
  localProvider: WorkSelectionMainHealthProviderObservation;
  hostedProvider: WorkSelectionMainHealthProviderObservation;
  resolution: CanonicalMainHealthProviderResolution;
}>> {
  return await withMainHealthGitHubRequestSession(input.capability, async () => {
    const observedAt = new Date().toISOString();
    const hostedExpiresAt = new Date(
      Date.parse(observedAt) + TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS
    ).toISOString();
    const hosted = await observeHostedMainHealthChecks({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      capability: input.capability
    });
    const localProvider = observeTrustedLocalProvider({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: observedAt,
      environment: input.environment
    });
    const hostedProvider = observeHostedProvider({
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: observedAt,
      expiresAt: hostedExpiresAt,
      observation: hosted
    });
    const resolution = resolveWorkSelectionMainHealthProviders({
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: observedAt,
      local: localProvider,
      hosted: hostedProvider
    });
    return Object.freeze({ observedAt, localProvider, hostedProvider, resolution });
  });
}

async function assertMainHealthProviderConflict(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  capability: MainHealthGitHubCapability;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{ observedAt: string; hosted: MainHealthLedger }>> {
  const providerFence = await observeMainHealthProvidersBase({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    capability: input.capability,
    environment: input.environment
  });
  if (providerFence.resolution.repairObservation.kind !== 'provider-conflict'
      || providerFence.localProvider.kind !== 'available'
      || providerFence.hostedProvider.kind !== 'available'
      || providerFence.localProvider.ledger.healthRevision !== input.authorization.localHealthRevision
      || hostedMainHealthAuthorityDigest(providerFence.hostedProvider.ledger)
        !== input.authorization.hostedAuthorityDigest) {
    throw new Error('MainHealth provider conflict changed inside supersession lease');
  }
  return Object.freeze({
    observedAt: providerFence.observedAt,
    hosted: providerFence.hostedProvider.ledger
  });
}

function readPreparedIntentForDirectory(
  directory: ReturnType<typeof observeTrustedLocalSupersessionPreimage>['directory'],
  operationId: SecWorkDigest
): MainHealthSupersessionPreparedCandidate | null {
  const preparedPath = path.join(directory.path, 'prepared');
  const preparedDirectory = inspectExactNoFollowDirectoryPresence(
    preparedPath,
    'MainHealth supersession prepared intent recovery'
  );
  if (preparedDirectory.state === 'absent') return null;
  const candidates: MainHealthSupersessionPreparedCandidate[] = [];
  for (const entry of scanNoFollowDirectoryTree(preparedDirectory.directory.target)) {
    if (!/^prepared-[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(entry.relativePath)
        || entry.kind !== 'file' || entry.bytes === null) {
      throw new Error(`unknown supersession prepared entry: ${entry.relativePath}`);
    }
    const intent = parseTrustedRuntimeMainHealthSupersessionIntent(
      new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes)
    );
    const expectedName = [
      'prepared', intent.authorization.operationId.slice('sha256:'.length),
      intent.intentDigest.slice('sha256:'.length)
    ].join('-') + '.json';
    if (entry.relativePath !== expectedName
        || !Buffer.from(entry.bytes).equals(
          Buffer.from(`${encodeVerificationActionData(intent)}\n`, 'utf8')
        )) {
      throw new Error(`supersession prepared name or bytes mismatch: ${entry.relativePath}`);
    }
    if (intent.authorization.operationId === operationId) {
      candidates.push(Object.freeze({
        intent,
        recordPath: path.join(preparedPath, entry.relativePath)
      }));
    }
  }
  if (candidates.length > 1) {
    throw new Error('duplicate or conflicting MainHealth supersession prepared intents');
  }
  return candidates[0] ?? null;
}

function mainHealthSupersessionPermitName(
  permit: TrustedRuntimeMainHealthSupersessionPermit
): string {
  return [
    'permit', permit.operationId.slice('sha256:'.length),
    permit.intentDigest.slice('sha256:'.length), permit.phase
  ].join('-') + '.json';
}

function publishMainHealthSupersessionPermit(input: Readonly<{
  directory: ReturnType<typeof observeTrustedLocalSupersessionPreimage>['directory'];
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  intentDigest: SecWorkDigest;
  phase: 'available' | 'consumed';
}>): Readonly<{
  permit: TrustedRuntimeMainHealthSupersessionPermit;
  recordPath: string;
  created: boolean;
}> {
  const permit = createTrustedRuntimeMainHealthSupersessionPermit({
    authorization: input.authorization,
    intentDigest: input.intentDigest,
    phase: input.phase
  });
  const permitDirectory = createNoFollowDirectoryChain(
    input.directory,
    ['permits']
  );
  const name = mainHealthSupersessionPermitName(permit);
  const bytes = trustedRuntimeMainHealthSupersessionPermitBytes(permit);
  const publication = publishExclusiveDurableCanonicalFile({
    parent: permitDirectory,
    name,
    bytes,
    validate: (candidateBytes) => {
      const parsed = parseTrustedRuntimeMainHealthSupersessionPermit(
        new TextDecoder('utf-8', { fatal: true }).decode(candidateBytes)
      );
      if (!Buffer.from(candidateBytes).equals(
        trustedRuntimeMainHealthSupersessionPermitBytes(parsed)
      )) {
        throw new Error('MainHealth supersession permit bytes are not canonical');
      }
    }
  });
  const readback = readNoFollowOrdinaryFile(permitDirectory, name);
  if (readback === null || !Buffer.from(readback).equals(bytes)) {
    throw new Error('MainHealth supersession permit differs after publication');
  }
  return Object.freeze({
    permit,
    recordPath: publication.path,
    created: publication.created
  });
}

function matchingMainHealthSupersessionPermits(
  evidence: Readonly<{
    permits: readonly MainHealthSupersessionPermitCandidate[];
  }>,
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization,
  intentDigest: SecWorkDigest
): Readonly<{
  available: MainHealthSupersessionPermitCandidate | null;
  consumed: MainHealthSupersessionPermitCandidate | null;
}> {
  const candidates = evidence.permits.filter(({ permit }) =>
    permit.operationId === authorization.operationId
      || permit.intentDigest === intentDigest);
  const expectedAvailable = createTrustedRuntimeMainHealthSupersessionPermit({
    authorization,
    intentDigest,
    phase: 'available'
  });
  const expectedConsumed = createTrustedRuntimeMainHealthSupersessionPermit({
    authorization,
    intentDigest,
    phase: 'consumed'
  });
  let available: MainHealthSupersessionPermitCandidate | null = null;
  let consumed: MainHealthSupersessionPermitCandidate | null = null;
  for (const candidate of candidates) {
    const expected = candidate.permit.phase === 'available'
      ? expectedAvailable
      : expectedConsumed;
    if (candidate.permit.operationId !== authorization.operationId
        || candidate.permit.intentDigest !== intentDigest
        || encodeVerificationActionData(candidate.permit)
          !== encodeVerificationActionData(expected)) {
      throw new Error('MainHealth supersession permit transition or namespace is forged');
    }
    if (candidate.permit.phase === 'available') {
      if (available !== null) {
        throw new Error('MainHealth supersession available permit is duplicated');
      }
      available = candidate;
    } else {
      if (consumed !== null) {
        throw new Error('MainHealth supersession consumed permit is duplicated');
      }
      consumed = candidate;
    }
  }
  if (consumed !== null && available === null) {
    throw new Error('MainHealth supersession consumed permit has no available predecessor');
  }
  return Object.freeze({ available, consumed });
}

async function executeMainHealthSupersessionEffect(input: Readonly<{
  repositoryRoot: string;
  defaultBranch: string;
  preimage: ReturnType<typeof observeTrustedLocalSupersessionPreimage>;
  capability: MainHealthSupersessionEffectCapability;
  githubCapability: MainHealthGitHubCapability;
  runtimeAuthority: MainHealthRuntimeAuthority;
  operationLease?: PhysicalMutationLeaseHandle;
  preparedIntent?: MainHealthSupersessionPreparedCandidate;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  status: 'superseded' | 'resumed-superseded';
  receipt: TrustedRuntimeMainHealthSupersessionReceipt;
  recordPath: string;
}>> {
  const authorization = consumeMainHealthSupersessionEffectCapability(input.capability);
  if (authorization.runtimeAuthorityBinding
      !== mainHealthRuntimeAuthorityBinding(input.runtimeAuthority).binding) {
    throw new Error('MainHealth supersession Runtime authority binding changed before Effect');
  }
  const operationLease = input.operationLease ?? acquirePhysicalMutationLease(
    mainHealthRuntimeAuthorityDirectory(input.runtimeAuthority, input.preimage.directory),
    authorization.operationLeaseName
  );
  if (operationLease === null) {
    throw new Error('MainHealth supersession operation is already active or its owner liveness is unknown');
  }
  const releaseLease = input.operationLease === undefined;
  try {
    // Re-admit the maximal predecessor only after taking the subject lease.
    // This is the durable CAS fence that prevents two stale observers from
    // creating different prepared intents (and therefore two external POSTs)
    // for one exact receipt namespace.
    const leasedEvidence = readMainHealthSupersessionEvidence({
      repositoryRoot: input.repositoryRoot,
      repository: authorization.repository,
      environment: input.environment
    });
    const leasedTerminals = leasedEvidence.terminals.filter(({ receipt }) =>
      receipt.mainSha === authorization.mainSha
        && receipt.mainTreeSha === authorization.mainTreeSha);
    const leasedChain = admitMainHealthSupersessionChain(leasedTerminals);
    if (leasedChain.kind === 'blocked') {
      throw new Error('MainHealth supersession predecessor CAS is blocked by malformed or forked history');
    }
    if (leasedChain.kind === 'leaf'
        && leasedChain.candidate.receipt.operationId !== authorization.operationId
        && authorization.predecessorRecordDigest !== leasedChain.candidate.receipt.recordDigest) {
      throw new Error('MainHealth supersession maximal predecessor changed after lease acquisition');
    }
    if (leasedChain.kind === 'empty' && authorization.predecessorRecordDigest !== null) {
      throw new Error('MainHealth supersession predecessor disappeared after lease acquisition');
    }
    const consumedPreparedDigests = new Set(
      leasedTerminals.map(({ receipt }) => receipt.preparedIntentDigest)
    );
    const competingPrepared = leasedEvidence.prepared.filter(({ intent }) =>
      intent.authorization.mainSha === authorization.mainSha
        && intent.authorization.mainTreeSha === authorization.mainTreeSha
        && !consumedPreparedDigests.has(intent.intentDigest)
        && intent.intentDigest !== input.preparedIntent?.intent.intentDigest);
    if (competingPrepared.length !== 0) {
      throw new Error('MainHealth supersession prepared intent fork detected under subject lease');
    }
    await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    assertMainHealthSupersessionSourceExact(input.preimage, 'before intent');
    assertMainHealthSupersessionAuthorizationSource(
      input.preimage,
      authorization,
      'before intent'
    );
    await assertCurrentMainHealthSupersessionIssuer({
      authorization,
      capability: input.githubCapability
    });
    const fence = await assertMainHealthProviderConflict({
      repositoryRoot: input.repositoryRoot,
      repository: authorization.repository,
      defaultBranch: input.defaultBranch,
      mainSha: authorization.mainSha,
      mainTreeSha: authorization.mainTreeSha,
      authorization,
      capability: input.githubCapability,
      environment: input.environment
    });

    let prepared = input.preparedIntent ?? readPreparedIntentForDirectory(
      input.preimage.directory,
      authorization.operationId
    );
    if (prepared !== null) {
      if (prepared.intent.requestDigest
          !== trustedRuntimeMainHealthSupersessionRequestDigest(
            prepared.intent.authorization
          )) {
        throw new Error('MainHealth supersession prepared request digest is not exact');
      }
      assertMainHealthSupersessionAuthorizationStableMatch(
        prepared.intent.authorization,
        authorization,
        'during recovery'
      );
    }
    let permitState: Readonly<{
      available: MainHealthSupersessionPermitCandidate | null;
      consumed: MainHealthSupersessionPermitCandidate | null;
    }>;
    if (prepared === null) {
      const intent = createTrustedRuntimeMainHealthSupersessionIntent({
        authorization,
        preparedAt: fence.observedAt
      });
      const preparedDirectory = createNoFollowDirectoryChain(
        input.preimage.directory,
        ['prepared']
      );
      const intentName = [
        'prepared', intent.authorization.operationId.slice('sha256:'.length),
        intent.intentDigest.slice('sha256:'.length)
      ].join('-') + '.json';
      const intentBytes = Buffer.from(`${encodeVerificationActionData(intent)}\n`, 'utf8');
      const publication = publishExclusiveDurableCanonicalFile({
        parent: preparedDirectory,
        name: intentName,
        bytes: intentBytes,
        validate: (bytes) => {
          const parsed = parseTrustedRuntimeMainHealthSupersessionIntent(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          );
          if (!Buffer.from(bytes).equals(Buffer.from(`${encodeVerificationActionData(parsed)}\n`, 'utf8'))) {
            throw new Error('MainHealth supersession prepared intent bytes are not canonical');
          }
        }
      });
      const readback = readNoFollowOrdinaryFile(preparedDirectory, intentName);
      if (readback === null || !Buffer.from(readback).equals(intentBytes)) {
        throw new Error('MainHealth supersession prepared intent differs after publication');
      }
      if (!publication.created) {
        throw new Error(
          'MainHealth supersession prepared intent already existed without recovery evidence'
        );
      }
      prepared = Object.freeze({ intent, recordPath: publication.path });
      // The available permit is a separate immutable publication.  It is
      // created by the same subject lease and is the only predecessor from
      // which this invocation may durably consume a POST permit.
      const availablePublication = publishMainHealthSupersessionPermit({
        directory: input.preimage.directory,
        authorization: intent.authorization,
        intentDigest: intent.intentDigest,
        phase: 'available'
      });
      if (!availablePublication.created) {
        throw new Error(
          'MainHealth supersession prepared intent has a pre-existing Effect permit'
        );
      }
      permitState = Object.freeze({
        available: Object.freeze({
          permit: availablePublication.permit,
          recordPath: availablePublication.recordPath
        }),
        consumed: null
      });
    } else {
      permitState = matchingMainHealthSupersessionPermits(
        leasedEvidence,
        authorization,
        prepared.intent.intentDigest
      );
      if (permitState.available === null && permitState.consumed === null) {
        throw new Error(
          'MainHealth supersession prepared intent has no durable Effect permit'
        );
      }
    }

    assertMainHealthSupersessionSourceExact(input.preimage, 'before provider Effect');
    assertMainHealthSupersessionAuthorizationSource(
      input.preimage,
      authorization,
      'before provider Effect'
    );
    await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    await assertCurrentMainHealthSupersessionIssuer({
      authorization,
      capability: input.githubCapability
    });
    await assertMainHealthProviderConflict({
      repositoryRoot: input.repositoryRoot,
      repository: authorization.repository,
      defaultBranch: input.defaultBranch,
      mainSha: authorization.mainSha,
      mainTreeSha: authorization.mainTreeSha,
      authorization,
      capability: input.githubCapability,
      environment: input.environment
    });
    const providerResult = await ensureMainHealthSupersessionProviderAuthorization({
      authorization,
      capability: input.githubCapability,
      allowPublish: permitState.available !== null && permitState.consumed === null,
      defaultBranch: input.defaultBranch,
      preimage: input.preimage,
      runtimeAuthority: input.runtimeAuthority,
      intentDigest: prepared.intent.intentDigest,
      permitState
    });
    assertMainHealthSupersessionSourceExact(input.preimage, 'before terminal');
    assertMainHealthSupersessionAuthorizationSource(
      input.preimage,
      authorization,
      'before terminal'
    );
    await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    await assertCurrentMainHealthSupersessionIssuer({
      authorization,
      capability: input.githubCapability
    });
    await assertMainHealthProviderConflict({
      repositoryRoot: input.repositoryRoot,
      repository: authorization.repository,
      defaultBranch: input.defaultBranch,
      mainSha: authorization.mainSha,
      mainTreeSha: authorization.mainTreeSha,
      authorization,
      capability: input.githubCapability,
      environment: input.environment
    });
    const terminal = createTrustedRuntimeMainHealthSupersessionReceipt({
      authorization,
      preparedIntentDigest: prepared.intent.intentDigest,
      providerAuthorization: providerResult.providerAuthorization
    });
    const recordBytes = trustedRuntimeMainHealthSupersessionReceiptBytes(terminal);
    const supersessionDirectory = createNoFollowDirectoryChain(
      input.preimage.directory,
      ['supersessions']
    );
    const recordName = [
      'supersession', terminal.operationId.slice('sha256:'.length),
      terminal.recordDigest.slice('sha256:'.length)
    ].join('-') + '.json';
    const publication = publishExclusiveDurableCanonicalFile({
      parent: supersessionDirectory,
      name: recordName,
      bytes: recordBytes,
      validate: (bytes) => {
        const parsed = parseTrustedRuntimeMainHealthSupersessionReceipt(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        );
        if (!Buffer.from(bytes).equals(trustedRuntimeMainHealthSupersessionReceiptBytes(parsed))) {
          throw new Error('MainHealth supersession terminal bytes are not canonical');
        }
      }
    });
    const archived = readNoFollowOrdinaryFile(supersessionDirectory, recordName);
    if (archived === null || !Buffer.from(archived).equals(recordBytes)) {
      throw new Error('MainHealth supersession terminal differs after publication');
    }
    assertMainHealthSupersessionSourceExact(input.preimage, 'during terminal readback');
    assertMainHealthSupersessionAuthorizationSource(
      input.preimage,
      authorization,
      'during terminal readback'
    );
    await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    await assertCurrentMainHealthSupersessionIssuer({
      authorization: terminal,
      capability: input.githubCapability
    });
    await assertMainHealthProviderConflict({
      repositoryRoot: input.repositoryRoot,
      repository: authorization.repository,
      defaultBranch: input.defaultBranch,
      mainSha: authorization.mainSha,
      mainTreeSha: authorization.mainTreeSha,
      authorization,
      capability: input.githubCapability,
      environment: input.environment
    });
    const terminalStatus = await observeMainHealthSupersessionProviderAuthorization({
      authorization: terminal,
      capability: input.githubCapability,
      expected: terminal.providerAuthorization
    });
    if (encodeVerificationActionData(terminalStatus)
        !== encodeVerificationActionData(terminal.providerAuthorization)) {
      throw new Error('MainHealth supersession terminal provider readback changed');
    }
    return Object.freeze({
      status: publication.created ? 'superseded' : 'resumed-superseded',
      receipt: terminal,
      recordPath: publication.path
    });
  } finally {
    if (releaseLease) operationLease.release();
  }
}

function observeHostedProvider(input: Readonly<{
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  expiresAt: string;
  observation: HostedMainHealthObservation;
}>): WorkSelectionMainHealthProviderObservation {
  if (input.observation.kind === 'invalid') return input.observation;
  if (input.observation.kind === 'unavailable') return input.observation;
  const checks = input.observation.checks;
  const ledgers = createRegisteredHostedMainHealthInputs({
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    trustRevision: input.mainSha,
    observedAt: input.now,
    expiresAt: input.expiresAt,
    sourceRef: `github-check-runs:${input.repository}@${input.mainSha}`,
    checks
  }).map((ledgerInput) => createMainHealthLedger(ledgerInput));
  if (ledgers.length === 0) return Object.freeze({ kind: 'absent' });
  if (ledgers.some((ledger) => ledger.status === 'locked')
      || new Set(ledgers.map((ledger) => ledger.healthRevision)).size !== 1) {
    return Object.freeze({
      kind: 'invalid',
      ref: digestRef(Object.freeze({
        schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
        status: 'hosted-provider-invalid-or-conflicting',
        healthRevisions: ledgers.map((ledger) => ledger.healthRevision).sort()
      }))
    });
  }
  return Object.freeze({ kind: 'available', ledger: ledgers[0]! });
}

export type CanonicalMainHealthProviderResolution = Readonly<{
  projection: WorkSelectionMainHealthProjection;
  ledger: MainHealthLedger | null;
  repairObservation: MainHealthRepairObservation;
}>;

export function resolveWorkSelectionMainHealthProviders(input: Readonly<{
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  now: string;
  local: WorkSelectionMainHealthProviderObservation;
  hosted: WorkSelectionMainHealthProviderObservation;
}>): CanonicalMainHealthProviderResolution {
  if (input.local.kind === 'invalid' || input.hosted.kind === 'invalid') {
    const ref = digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
      status: 'provider-invalid',
      local: input.local.kind === 'invalid' ? input.local.ref : input.local.kind,
      hosted: input.hosted.kind === 'invalid' ? input.hosted.ref : input.hosted.kind
    }));
    return Object.freeze({
      projection: Object.freeze({
        state: 'unresolved',
        ref
      }),
      ledger: null,
      repairObservation: Object.freeze({ kind: 'provider-invalid', observationRef: ref })
    });
  }

  if (input.local.kind === 'unavailable' || input.hosted.kind === 'unavailable') {
    const ref = digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
      status: 'provider-unavailable',
      local: input.local.kind === 'unavailable' ? input.local.ref : input.local.kind,
      hosted: input.hosted.kind === 'unavailable' ? input.hosted.ref : input.hosted.kind,
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    }));
    return Object.freeze({
      projection: Object.freeze({ state: 'unresolved', ref }),
      ledger: null,
      repairObservation: Object.freeze({ kind: 'provider-unavailable', observationRef: ref })
    });
  }

  const localLedger = input.local.kind === 'available' ? input.local.ledger : null;
  const hostedLedger = input.hosted.kind === 'available' ? input.hosted.ledger : null;
  if (localLedger !== null && hostedLedger !== null
      && localLedger.healthRevision !== hostedLedger.healthRevision) {
    const ref = digestRef(Object.freeze({
      schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
      status: 'provider-conflict',
      localHealthRevision: localLedger.healthRevision,
      hostedHealthRevision: hostedLedger.healthRevision
    }));
    return Object.freeze({
      projection: Object.freeze({
        state: 'unresolved',
        ref
      }),
      ledger: null,
      repairObservation: Object.freeze({ kind: 'provider-conflict', observationRef: ref })
    });
  }

  const selected = localLedger ?? hostedLedger;
  if (selected !== null) {
    return Object.freeze({
      projection: projectLedger({
        ledger: selected,
        now: input.now,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        mainSha: input.mainSha,
        mainTreeSha: input.mainTreeSha
      }),
      ledger: selected,
      repairObservation: Object.freeze({ kind: 'available', ledger: selected })
    });
  }

  const ref = digestRef(Object.freeze({
    schema: WORK_SELECTION_MAIN_HEALTH_PROVIDER_SCHEMA,
    status: 'provider-missing',
    local: input.local.kind,
    hosted: input.hosted.kind,
    hostedRef: null,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha
  }));
  return Object.freeze({
    projection: Object.freeze({
      state: 'unresolved',
      ref
    }),
    ledger: null,
    repairObservation: Object.freeze({
      kind: 'provider-missing',
      observationRef: ref
    })
  });
}

function boundedMainHealthProviderText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`MainHealth hosted provider ${label} is invalid`);
  }
  return value;
}

function positiveMainHealthProviderId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`MainHealth hosted provider ${label} is invalid`);
  }
  return value as number;
}

const MAIN_HEALTH_MAX_MATCHING_WORKFLOW_RUNS = 128;

type MainHealthWorkflowProvenance = Readonly<{
  raw: Record<string, unknown>;
  workflowPath: string;
  eventName: string;
  workflowRunDisplayTitle: string;
}>;

async function observeHostedMainHealthChecks(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  capability: MainHealthGitHubCapability;
}>): Promise<HostedMainHealthObservation> {
  try {
    const checks: GitHubCheckObservation[] = [];
    const identities = new Set<number>();
    const matchingWorkflowRunIds = new Set<string>();
    const firstWorkflowByRunId = new Map<string, MainHealthWorkflowProvenance>();
    const secondWorkflowByRunId = new Map<string, MainHealthWorkflowProvenance>();
    const pageSnapshots: string[] = [];
    let matchingProviderCheckCount = 0;
    let expectedTotalCount: number | null = null;
    const readWorkflow = async (runId: string): Promise<MainHealthWorkflowProvenance> => {
      const workflowValue = await requestMainHealthGitHubJson<unknown>({
        capability: input.capability,
        repository: input.repository,
        method: 'GET',
        endpoint: `/repos/${input.repository}/actions/runs/${runId}`
      });
      if (workflowValue === null || typeof workflowValue !== 'object'
          || Array.isArray(workflowValue)) {
        throw new Error('MainHealth hosted workflow provenance is not an object');
      }
      const workflow = workflowValue as Record<string, unknown>;
      if (String(workflow.id) !== runId || workflow.head_sha !== input.mainSha) {
        throw new Error('MainHealth hosted workflow provenance differs from check head');
      }
      return Object.freeze({
        raw: workflow,
        workflowPath: boundedMainHealthProviderText(
          workflow.path,
          `workflowRun[${runId}].workflowPath`
        ),
        eventName: boundedMainHealthProviderText(
          workflow.event,
          `workflowRun[${runId}].eventName`
        ),
        workflowRunDisplayTitle: boundedMainHealthProviderText(
          workflow.display_title,
          `workflowRun[${runId}].workflowRunDisplayTitle`
        )
      });
    };
    for (let page = 1; page <= 10; page += 1) {
      const value = await requestMainHealthGitHubJson<unknown>({
        capability: input.capability,
        repository: input.repository,
        method: 'GET',
        endpoint: `/repos/${input.repository}/commits/${input.mainSha}`
          + `/check-runs?per_page=100&page=${page}`
      });
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('MainHealth hosted check response is not an object');
      }
      const record = value as Record<string, unknown>;
      if (!Number.isSafeInteger(record.total_count) || (record.total_count as number) < 0
          || !Array.isArray(record.check_runs) || record.check_runs.length > 100) {
        throw new Error('MainHealth hosted check response shape is invalid');
      }
      const totalCount = record.total_count as number;
      if (totalCount > 1_000) {
        throw new Error('MainHealth hosted check inventory exceeds bounded pagination');
      }
      if (expectedTotalCount === null) {
        expectedTotalCount = totalCount;
      } else if (expectedTotalCount !== totalCount) {
        throw new Error('MainHealth hosted check inventory total_count drifted between pages');
      }
      pageSnapshots.push(encodeVerificationActionData(Object.freeze({
        total_count: totalCount,
        check_runs: record.check_runs
      })));
      for (const [index, candidate] of record.check_runs.entries()) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
          throw new Error(`MainHealth hosted check ${index} is not an object`);
        }
        const check = candidate as Record<string, unknown>;
        const id = positiveMainHealthProviderId(check.id, `checkRuns[${index}].id`);
        if (identities.has(id)) throw new Error('MainHealth hosted check IDs are duplicated');
        identities.add(id);
        const name = boundedMainHealthProviderText(check.name, `checkRuns[${index}].name`);
        const status = boundedMainHealthProviderText(check.status, `checkRuns[${index}].status`);
        const conclusion = check.conclusion;
        if (!['queued', 'in_progress', 'completed'].includes(status)
            || (status === 'completed'
              ? typeof conclusion !== 'string'
              : conclusion !== null)) {
          throw new Error(`MainHealth hosted check ${index} lifecycle is invalid`);
        }
        const headSha = boundedMainHealthProviderText(
          check.head_sha,
          `checkRuns[${index}].head_sha`
        );
        if (headSha !== input.mainSha || !/^[0-9a-f]{40}$/u.test(headSha)) {
          throw new Error(`MainHealth hosted check ${index} head SHA differs`);
        }
        const detailsUrl = check.details_url;
        if (detailsUrl !== null && detailsUrl !== undefined
            && typeof detailsUrl !== 'string') {
          throw new Error(`MainHealth hosted check ${index} details URL is invalid`);
        }
        const appValue = check.app;
        if (appValue !== null && appValue !== undefined
            && (typeof appValue !== 'object' || Array.isArray(appValue))) {
          throw new Error(`MainHealth hosted check ${index} app is invalid`);
        }
        const app = appValue as Record<string, unknown> | null | undefined;
        const appId = app === null || app === undefined || app.id === undefined
          ? null
          : positiveMainHealthProviderId(app.id, `checkRuns[${index}].app.id`);
        const appNodeId = appId === null
          ? null
          : boundedMainHealthProviderText(app?.node_id, `checkRuns[${index}].app.node_id`);
        const appSlug = appId === null
          ? null
          : boundedMainHealthProviderText(app?.slug, `checkRuns[${index}].app.slug`);
        if (appId === null && (app?.node_id !== undefined || app?.slug !== undefined)) {
          throw new Error(`MainHealth hosted check ${index} app identity is partial`);
        }
        const normalizedDetailsUrl = detailsUrl === undefined ? null : detailsUrl as string | null;
        const workflowRunId = normalizedDetailsUrl === null
          ? null
          : /\/actions\/runs\/([1-9][0-9]*)/u.exec(normalizedDetailsUrl)?.[1] ?? null;
        const mayMatchRegisteredProvider = name === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.context
          && appId === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.app.id
          && appNodeId === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.app.nodeId
          && appSlug === GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY.app.slug;
        if (mayMatchRegisteredProvider) {
          matchingProviderCheckCount += 1;
          if (matchingProviderCheckCount > MAIN_HEALTH_MAX_MATCHING_WORKFLOW_RUNS) {
            throw new Error(
              'MainHealth hosted matching provider check count exceeds bounded workflow provenance'
            );
          }
          if (workflowRunId !== null) matchingWorkflowRunIds.add(workflowRunId);
        }
        checks.push(Object.freeze({
          id,
          name,
          status,
          conclusion: conclusion as string | null,
          headSha,
          detailsUrl: normalizedDetailsUrl,
          appId,
          appNodeId,
          appSlug,
          workflowPath: null,
          workflowRef: null,
          eventName: null,
          workflowRunId,
          workflowRunDisplayTitle: null
        }));
      }
      if (record.check_runs.length < 100) break;
      if (page === 10) throw new Error('MainHealth hosted check pagination exceeded bound');
    }
    if (expectedTotalCount === null || checks.length !== expectedTotalCount
        || pageSnapshots.length === 0) {
      throw new Error('MainHealth hosted check inventory is incomplete');
    }
    // First provenance pass is fenced by a complete second census. Every
    // page's canonical raw bytes, count, IDs and ordering must remain exact;
    // rereading only page one cannot detect a middle-page mutation.
    for (const runId of matchingWorkflowRunIds) {
      firstWorkflowByRunId.set(runId, await readWorkflow(runId));
    }
    for (let page = 1; page <= pageSnapshots.length; page += 1) {
      const value = await requestMainHealthGitHubJson<unknown>({
        capability: input.capability,
        repository: input.repository,
        method: 'GET',
        endpoint: `/repos/${input.repository}/commits/${input.mainSha}`
          + `/check-runs?per_page=100&page=${page}`
      });
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('MainHealth hosted check stable response is not an object');
      }
      const record = value as Record<string, unknown>;
      if (record.total_count !== expectedTotalCount
          || !Array.isArray(record.check_runs)
          || record.check_runs.length > 100
          || encodeVerificationActionData(Object.freeze({
            total_count: record.total_count,
            check_runs: record.check_runs
          })) !== pageSnapshots[page - 1]) {
        throw new Error('MainHealth hosted check inventory changed during complete stable readback');
      }
      if (page < pageSnapshots.length && record.check_runs.length < 100) {
        throw new Error('MainHealth hosted check pagination shortened during stable readback');
      }
      if (page === pageSnapshots.length && record.check_runs.length === 100
          && pageSnapshots.length < 10) {
        throw new Error('MainHealth hosted check pagination extended during stable readback');
      }
    }
    for (const runId of matchingWorkflowRunIds) {
      secondWorkflowByRunId.set(runId, await readWorkflow(runId));
      const first = firstWorkflowByRunId.get(runId)!;
      const second = secondWorkflowByRunId.get(runId)!;
      if (encodeVerificationActionData(first.raw)
          !== encodeVerificationActionData(second.raw)) {
        throw new Error('MainHealth hosted workflow provenance changed during stable readback');
      }
    }
    const stableChecks = checks.map((check) => {
      if (check.workflowRunId === null) return check;
      const workflow = secondWorkflowByRunId.get(check.workflowRunId);
      if (workflow === undefined) {
        throw new Error('MainHealth hosted workflow provenance was not observed');
      }
      return Object.freeze({
        ...check,
        workflowPath: workflow.workflowPath,
        workflowRef: `${workflow.workflowPath}@${input.mainSha}`,
        eventName: workflow.eventName,
        workflowRunDisplayTitle: workflow.workflowRunDisplayTitle
      });
    });
    return Object.freeze({ kind: 'observed', checks: Object.freeze(stableChecks) });
  } catch (error) {
    if (error instanceof MainHealthGitHubProviderError) {
      return Object.freeze({
        kind: 'unavailable',
        ref: invalidRef(
          'hosted-main-health-transport-unavailable',
          `${input.repository}\n${input.mainSha}\n${error.message}`
        )
      });
    }
    return Object.freeze({
      kind: 'invalid',
      ref: invalidRef(
        'hosted-main-health-provider-invalid',
        `${input.repository}\n${input.mainSha}\n${error instanceof Error ? error.message : String(error)}`
      )
    });
  }
}

type CanonicalMainHealthProvidersObservation = Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  observedAt: string;
  physicalLocalProvider: WorkSelectionMainHealthProviderObservation;
  localProvider: WorkSelectionMainHealthProviderObservation;
  hostedProvider: WorkSelectionMainHealthProviderObservation;
  supersession: MainHealthSupersessionObservation;
  resolution: CanonicalMainHealthProviderResolution;
}>;

async function observeCanonicalMainHealthProvidersBound(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  capability: MainHealthGitHubCapability;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<CanonicalMainHealthProvidersObservation> {
  return await withMainHealthGitHubRequestSession(input.capability, async () => {
    const base = await observeMainHealthProvidersBase(input);
    const supersession = await observeMainHealthSupersession({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      hostedProvider: base.hostedProvider,
      capability: input.capability,
      runtimeAuthority: input.runtimeAuthority,
      environment: input.environment
    });
    let finalLocalProvider = base.localProvider;
    let finalHostedProvider = base.hostedProvider;
    let finalSupersession = supersession;
    if (supersession.kind === 'active') {
      const finalBase = await observeMainHealthProvidersBase(input);
      finalLocalProvider = finalBase.localProvider;
      finalHostedProvider = finalBase.hostedProvider;
      if (finalHostedProvider.kind !== 'available') {
        finalSupersession = mainHealthSupersessionBlocked(
          'supersession-final-hosted-provider-unavailable',
          Object.freeze({
            recordDigest: supersession.supersession.receipt.recordDigest,
            finalHostedKind: finalHostedProvider.kind
          })
        );
      } else if (hostedMainHealthAuthorityDigest(finalHostedProvider.ledger)
          !== supersession.supersession.receipt.hostedAuthorityDigest) {
        finalSupersession = mainHealthSupersessionInactive(
          'supersession-final-hosted-provider-drift',
          supersession.supersession.receipt.recordDigest,
          supersession.supersession.receipt.recordDigest
        );
      } else if (finalLocalProvider.kind !== 'available'
          || base.localProvider.kind !== 'available'
          || finalLocalProvider.ledger.healthRevision
            !== base.localProvider.ledger.healthRevision) {
        // A terminal may only project local-absent after the final local
        // physical observation remains the exact conflict preimage.  A
        // replacement, disappearance or unavailable read invalidates the
        // terminal evidence but leaves the old record retained for chaining.
        finalSupersession = finalLocalProvider.kind === 'absent'
          ? mainHealthSupersessionInactive(
              'supersession-final-local-provider-absent',
              supersession.supersession.receipt.recordDigest,
              supersession.supersession.receipt.recordDigest
            )
          : finalLocalProvider.kind === 'available'
            && base.localProvider.kind === 'available'
          ? mainHealthSupersessionInactive(
              'supersession-final-local-provider-drift',
              Object.freeze({
                recordDigest: supersession.supersession.receipt.recordDigest,
                initialHealthRevision: base.localProvider.ledger.healthRevision,
                finalHealthRevision: finalLocalProvider.ledger.healthRevision
              }),
              supersession.supersession.receipt.recordDigest
            )
            : mainHealthSupersessionBlocked(
                'supersession-final-local-provider-unavailable',
                Object.freeze({
                  recordDigest: supersession.supersession.receipt.recordDigest,
                  finalLocalKind: finalLocalProvider.kind
                })
              );
      } else {
        try {
          const finalPreimage = observeTrustedLocalSupersessionPreimage(input);
          const finalReceiptBytes = Buffer.from(
            `${encodeVerificationActionData(finalPreimage.receipt)}\n`,
            'utf8'
          );
          if (finalPreimage.receipt.receiptDigest
                !== supersession.supersession.receipt.localReceipt.receiptDigest
              || finalPreimage.source.device !== supersession.supersession.receipt.source.device
              || finalPreimage.source.inode !== supersession.supersession.receipt.source.inode
              || finalPreimage.source.size !== supersession.supersession.receipt.source.size
              || finalPreimage.source.bytes === null
              || !Buffer.from(finalPreimage.source.bytes).equals(finalReceiptBytes)
              || rawSha256(finalPreimage.source.bytes)
                !== supersession.supersession.receipt.source.byteDigest) {
            finalSupersession = mainHealthSupersessionInactive(
              'supersession-final-local-physical-drift',
              supersession.supersession.receipt.recordDigest,
              supersession.supersession.receipt.recordDigest
            );
          }
        } catch (error) {
          finalSupersession = mainHealthSupersessionBlocked(
            'supersession-final-local-physical-observation-unavailable',
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      if (finalSupersession.kind === 'active') {
        // The hosted ledger must be re-observed after the exact local file
        // read.  This closes the last local-first/hosted-second TOCTOU window:
        // a provider update during local read cannot be projected using the
        // earlier hosted observation.
        const finalFence = await observeMainHealthProvidersBase(input);
        finalLocalProvider = finalFence.localProvider;
        finalHostedProvider = finalFence.hostedProvider;
        if (finalHostedProvider.kind !== 'available') {
          finalSupersession = mainHealthSupersessionBlocked(
            'supersession-final-hosted-provider-unavailable',
            Object.freeze({
              recordDigest: supersession.supersession.receipt.recordDigest,
              finalHostedKind: finalHostedProvider.kind
            })
          );
        } else if (hostedMainHealthAuthorityDigest(finalHostedProvider.ledger)
            !== supersession.supersession.receipt.hostedAuthorityDigest) {
          finalSupersession = mainHealthSupersessionInactive(
            'supersession-final-hosted-provider-drift',
            supersession.supersession.receipt.recordDigest,
            supersession.supersession.receipt.recordDigest
          );
        } else if (finalLocalProvider.kind !== 'available') {
          finalSupersession = finalLocalProvider.kind === 'absent'
            ? mainHealthSupersessionInactive(
                'supersession-final-local-provider-absent',
                supersession.supersession.receipt.recordDigest,
                supersession.supersession.receipt.recordDigest
              )
            : mainHealthSupersessionBlocked(
                'supersession-final-local-provider-unavailable',
                Object.freeze({
                  recordDigest: supersession.supersession.receipt.recordDigest,
                  finalLocalKind: finalLocalProvider.kind
                })
              );
        } else if (base.localProvider.kind !== 'available'
            || finalLocalProvider.ledger.healthRevision
              !== base.localProvider.ledger.healthRevision) {
          finalSupersession = mainHealthSupersessionInactive(
            'supersession-final-local-provider-drift',
            supersession.supersession.receipt.recordDigest,
            supersession.supersession.receipt.recordDigest
          );
        } else {
          try {
            const finalFencePreimage = observeTrustedLocalSupersessionPreimage(input);
            const finalFenceReceiptBytes = Buffer.from(
              `${encodeVerificationActionData(finalFencePreimage.receipt)}\n`,
              'utf8'
            );
            if (finalFencePreimage.receipt.receiptDigest
                  !== supersession.supersession.receipt.localReceipt.receiptDigest
                || finalFencePreimage.source.device
                  !== supersession.supersession.receipt.source.device
                || finalFencePreimage.source.inode
                  !== supersession.supersession.receipt.source.inode
                || finalFencePreimage.source.size
                  !== supersession.supersession.receipt.source.size
                || finalFencePreimage.source.bytes === null
                || !Buffer.from(finalFencePreimage.source.bytes).equals(finalFenceReceiptBytes)
                || rawSha256(finalFencePreimage.source.bytes)
                  !== supersession.supersession.receipt.source.byteDigest) {
              finalSupersession = mainHealthSupersessionInactive(
                'supersession-final-local-physical-drift',
                supersession.supersession.receipt.recordDigest,
                supersession.supersession.receipt.recordDigest
              );
            }
          } catch (error) {
            finalSupersession = mainHealthSupersessionBlocked(
              'supersession-final-local-physical-observation-unavailable',
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    }
    const effectiveLocalProvider: WorkSelectionMainHealthProviderObservation =
      finalSupersession.kind === 'active'
        ? finalLocalProvider.kind === 'available'
          ? Object.freeze({ kind: 'absent' })
          : Object.freeze({
              kind: 'invalid' as const,
              ref: mainHealthSupersessionRef(
                'supersession-final-local-provider-unavailable',
                finalLocalProvider.kind
              )
            })
        : finalSupersession.kind === 'blocked'
          ? Object.freeze({ kind: 'invalid', ref: finalSupersession.ref })
          : finalLocalProvider;
    const resolution = resolveWorkSelectionMainHealthProviders({
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      now: base.observedAt,
      local: effectiveLocalProvider,
      hosted: finalHostedProvider
    });
    return Object.freeze({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha,
      observedAt: base.observedAt,
      physicalLocalProvider: finalLocalProvider,
      localProvider: effectiveLocalProvider,
      hostedProvider: finalHostedProvider,
      supersession: finalSupersession,
      resolution
    });
  });
}

/**
 * Explicit MainHealth reconciliation Effect. Read-only status and work
 * selection never call this operation. The operation compiles an authenticated,
 * issuer-bound content-addressed supersession authorization, executes it behind
 * the receipt namespace lease, and proves hosted-only resolution by readback.
 */
async function reconcileCanonicalMainHealthProviderConflictBound(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  githubCapability: MainHealthGitHubCapability;
  runtimeAuthority: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  observedAt: string;
  authorizationDigest: SecWorkDigest;
  supersession: Readonly<{
    status: 'superseded' | 'resumed-superseded';
    receipt: TrustedRuntimeMainHealthSupersessionReceipt;
    recordPath: string;
  }>;
  resolution: CanonicalMainHealthProviderResolution;
}>> {
  assertMainHealthGitHubCapability(input.githubCapability, input.repository, 'status-write');
    await assertCurrentMainHealthRuntimeAuthority(input.runtimeAuthority);
    const providerInput = Object.freeze({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    capability: input.githubCapability,
    runtimeAuthority: input.runtimeAuthority,
    environment: input.environment
    });
    const admission = await observeCanonicalMainHealthProvidersBound(providerInput);
    if (admission.supersession.kind === 'active') {
    const recovered = admission.supersession.supersession;
    if (admission.physicalLocalProvider.kind !== 'available') {
      throw new Error('MainHealth supersession requires one exact active provider conflict');
    }
    const postRecovery = await observeCanonicalMainHealthProvidersBound(providerInput);
    if (postRecovery.hostedProvider.kind !== 'available'
        || admission.hostedProvider.kind !== 'available') {
      throw new Error('MainHealth supersession recovery changed during terminal readback');
    }
    if (postRecovery.localProvider.kind !== 'absent'
        || postRecovery.physicalLocalProvider.kind !== 'available'
        || postRecovery.supersession.kind !== 'active'
        || postRecovery.supersession.supersession.receipt.recordDigest
          !== recovered.receipt.recordDigest
        || hostedMainHealthAuthorityDigest(postRecovery.hostedProvider.ledger)
          !== hostedMainHealthAuthorityDigest(admission.hostedProvider.ledger)
        || postRecovery.resolution.repairObservation.kind !== 'available') {
      throw new Error('MainHealth supersession recovery changed during terminal readback');
    }
      return Object.freeze({
      observedAt: postRecovery.observedAt,
      authorizationDigest: recovered.receipt.effectAuthorizationDigest,
      supersession: recovered,
      resolution: postRecovery.resolution
    });
    }
    let preparedRecovery = admission.supersession.kind === 'prepared'
      ? admission.supersession
      : null;
    let predecessorRecordDigest = admission.supersession.kind === 'inactive'
      ? admission.supersession.recordDigest
      : preparedRecovery?.intent.authorization.predecessorRecordDigest ?? null;
    if (admission.supersession.kind === 'blocked'
      || admission.resolution.repairObservation.kind !== 'provider-conflict'
      || admission.localProvider.kind !== 'available'
      || admission.hostedProvider.kind !== 'available') {
    throw new Error('MainHealth supersession requires one exact active provider conflict');
  }

    const effectFence = await observeCanonicalMainHealthProvidersBound(providerInput);
    if (effectFence.supersession.kind === 'active'
      || effectFence.supersession.kind === 'blocked'
      || (effectFence.supersession.kind === 'inactive'
        && effectFence.supersession.recordDigest !== predecessorRecordDigest)
      || (preparedRecovery === null
        && effectFence.supersession.kind === 'prepared')
      || (preparedRecovery !== null
        && (effectFence.supersession.kind !== 'prepared'
          || effectFence.supersession.intent.intentDigest
            !== preparedRecovery.intent.intentDigest))
      || effectFence.resolution.repairObservation.kind !== 'provider-conflict'
      || effectFence.localProvider.kind !== 'available'
      || effectFence.hostedProvider.kind !== 'available'
      || effectFence.localProvider.ledger.healthRevision
        !== admission.localProvider.ledger.healthRevision
      || hostedMainHealthAuthorityDigest(effectFence.hostedProvider.ledger)
        !== hostedMainHealthAuthorityDigest(admission.hostedProvider.ledger)) {
    throw new Error('MainHealth provider conflict changed before supersession Effect authorization');
  }
    const effectHostedLedger = (effectFence.hostedProvider as Readonly<{
      kind: 'available';
      ledger: MainHealthLedger;
    }>).ledger;
    const preimage = observeTrustedLocalSupersessionPreimage(input);
    const boundDirectory = mainHealthRuntimeAuthorityDirectory(
      input.runtimeAuthority,
      preimage.directory
    );
    const issuer = mainHealthGitHubCapabilityBinding(input.githubCapability).issuer;
    if (issuer.permission !== 'admin' && issuer.permission !== 'maintain') {
      throw new Error('MainHealth supersession requires a live maintain/admin issuer');
    }
    const runtimeAuthorityBinding = mainHealthRuntimeAuthorityBinding(input.runtimeAuthority).binding;
    const issuerIdentity = Object.freeze({
      transport: 'github-rest-token' as const,
      login: issuer.login,
      nodeId: issuer.nodeId,
      permission: issuer.permission
    });
    const createCurrentAuthorization = (
      currentPredecessor: SecWorkDigest | null
    ): TrustedRuntimeMainHealthSupersessionAuthorization =>
      createTrustedRuntimeMainHealthSupersessionAuthorization({
        defaultBranch: input.defaultBranch,
        sourceName: preimage.source.relativePath,
        source: preimage.source,
        localReceipt: preimage.receipt,
        hostedLedger: effectHostedLedger,
        hostedAuthorityDigest: hostedMainHealthAuthorityDigest(effectHostedLedger),
        runtimeAuthorityBinding,
        predecessorRecordDigest: currentPredecessor,
        issuer: issuerIdentity
      });
    let currentAuthorization = createCurrentAuthorization(predecessorRecordDigest);
    const operationLease = acquirePhysicalMutationLease(
      boundDirectory,
      currentAuthorization.operationLeaseName
    );
    if (operationLease === null) {
      throw new Error('MainHealth supersession subject lease is already active or liveness is unknown');
    }
    try {
      if (preparedRecovery?.providerDrift === true) {
        // The status POST already happened, but the hosted ledger changed
        // before the terminal was durable.  Keep that exact status evidence as
        // an inactive historical terminal while holding the same subject lease
        // used for the chained successor.
        const historical = await publishPreparedHistoricalTerminal({
          repositoryRoot: input.repositoryRoot,
          preimage,
          prepared: preparedRecovery,
          githubCapability: input.githubCapability,
          runtimeAuthority: input.runtimeAuthority,
          operationLease,
          environment: input.environment
        });
        predecessorRecordDigest = historical.receipt.recordDigest;
        preparedRecovery = null;
        currentAuthorization = createCurrentAuthorization(predecessorRecordDigest);
      }
      const capability = preparedRecovery === null
        ? issueMainHealthSupersessionEffectCapability({
            preimage,
            hostedLedger: effectHostedLedger,
            runtimeAuthorityBinding,
            issuedAt: effectFence.observedAt,
            predecessorRecordDigest,
            issuer: issuerIdentity
          })
        : (() => {
            assertMainHealthSupersessionAuthorizationStableMatch(
              preparedRecovery.intent.authorization,
              currentAuthorization,
              'before prepared recovery'
            );
            return issueMainHealthSupersessionEffectCapabilityFromAuthorization({
              authorization: preparedRecovery.intent.authorization,
              hostedAuthorityDigest: hostedMainHealthAuthorityDigest(effectHostedLedger),
              issuedAt: effectFence.observedAt
            });
          })();
      const supersession = await executeMainHealthSupersessionEffect({
        repositoryRoot: input.repositoryRoot,
        defaultBranch: input.defaultBranch,
        preimage,
        capability,
        githubCapability: input.githubCapability,
        runtimeAuthority: input.runtimeAuthority,
        operationLease,
        preparedIntent: preparedRecovery === null ? undefined : preparedRecovery,
        environment: input.environment
      });
      const postEffect = await observeCanonicalMainHealthProvidersBound(providerInput);
      if (postEffect.localProvider.kind !== 'absent'
        || postEffect.physicalLocalProvider.kind !== 'available'
        || postEffect.hostedProvider.kind !== 'available'
        || postEffect.supersession.kind !== 'active'
        || postEffect.supersession.supersession.receipt.recordDigest
          !== supersession.receipt.recordDigest
        || postEffect.supersession.supersession.receipt.runtimeAuthorityBinding
          !== runtimeAuthorityBinding
        || postEffect.supersession.supersession.receipt.predecessorRecordDigest
          !== predecessorRecordDigest
        || hostedMainHealthAuthorityDigest(postEffect.hostedProvider.ledger)
          !== capability.hostedAuthorityDigest
      || postEffect.resolution.ledger?.ledgerDigest
        !== postEffect.hostedProvider.ledger.ledgerDigest
      || postEffect.resolution.repairObservation.kind !== 'available') {
        throw new Error('MainHealth supersession provider changed during exact post-Effect readback');
      }
      return Object.freeze({
        observedAt: postEffect.observedAt,
        authorizationDigest: supersession.receipt.effectAuthorizationDigest,
        supersession,
        resolution: postEffect.resolution
      });
    } finally {
      operationLease.release();
    }
}

/**
 * Caller-free MainHealth reconciliation entry. The provider owner resolves
 * and validates the status-write credential at this narrow Effect boundary;
 * callers cannot supply a transport, bearer token, or forged issuer.
 */
export async function reconcileCanonicalMainHealthProviderConflict(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeAuthority: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  observedAt: string;
  authorizationDigest: SecWorkDigest;
  supersession: Readonly<{
    status: 'superseded' | 'resumed-superseded';
    receipt: TrustedRuntimeMainHealthSupersessionReceipt;
    recordPath: string;
  }>;
  resolution: CanonicalMainHealthProviderResolution;
}>> {
  return await withMainHealthGitHubStatusWriteSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => await reconcileCanonicalMainHealthProviderConflictBound({
      ...input,
      githubCapability: currentMainHealthGitHubCapability(
        input.repository,
        'status-write'
      )
    })
  });
}

function compileMainHealthRepairDecisionFromCanonicalObservation(
  input: Readonly<{
    repository: string;
    defaultBranch: string;
    mainSha: string;
    mainTreeSha: string;
  }>,
  observation: CanonicalMainHealthProvidersObservation
): MainHealthRepairDecision {
  return compileMainHealthRepairDecision({
    observation: observation.resolution.repairObservation,
    now: observation.observedAt,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.mainSha
  });
}

declare const mainHealthPublicationAuthorityBrand: unique symbol;

export type MainHealthPublicationAuthority = Readonly<{
  readonly [mainHealthPublicationAuthorityBrand]: true;
}>;

type MainHealthPublicationAuthorityBinding = Readonly<{
  runtimeAuthorityBinding: SecWorkDigest | null;
  localPhysical: Readonly<{
    relativePath: string;
    device: string;
    inode: string;
    size: number;
    byteDigest: SecWorkDigest;
  }> | null;
  hostedAuthorityDigest: SecWorkDigest | null;
  hostedProviderEpoch: SecWorkDigest | null;
  hostedProvenanceDigest: SecWorkDigest | null;
}>;

const mainHealthPublicationAuthorityBindings =
  new WeakMap<object, MainHealthPublicationAuthorityBinding>();

function mainHealthPublicationAuthorityBinding(
  authority: MainHealthPublicationAuthority
): MainHealthPublicationAuthorityBinding {
  const binding = mainHealthPublicationAuthorityBindings.get(authority);
  if (binding === undefined) {
    throw new Error('MainHealth publication authority is forged or not issued in this process');
  }
  return binding;
}

export function assertMainHealthPublicationAuthorityStable(
  first: MainHealthPublicationAuthority,
  second: MainHealthPublicationAuthority
): void {
  if (encodeVerificationActionData(mainHealthPublicationAuthorityBinding(first))
      !== encodeVerificationActionData(mainHealthPublicationAuthorityBinding(second))) {
    throw new Error('MainHealth publication authority drifted between live snapshots');
  }
}

function createMainHealthPublicationAuthority(input: Readonly<{
  observation: CanonicalMainHealthProvidersObservation;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): MainHealthPublicationAuthority {
  const physicalLocal = input.observation.physicalLocalProvider.kind === 'available'
    ? (() => {
        const preimage = observeTrustedLocalSupersessionPreimage({
          repositoryRoot: input.observation.repositoryRoot,
          repository: input.observation.repository,
          mainSha: input.observation.mainSha,
          mainTreeSha: input.observation.mainTreeSha,
          environment: input.environment
        });
        if (preimage.source.bytes === null) {
          throw new Error('MainHealth local physical publication source is unavailable');
        }
        return Object.freeze({
          relativePath: preimage.source.relativePath,
          device: preimage.source.device,
          inode: preimage.source.inode,
          size: preimage.source.size,
          byteDigest: rawSha256(preimage.source.bytes)
        });
      })()
    : null;
  const hostedLedger = input.observation.hostedProvider.kind === 'available'
    ? input.observation.hostedProvider.ledger
    : null;
  const authority = Object.freeze({}) as MainHealthPublicationAuthority;
  mainHealthPublicationAuthorityBindings.set(authority, Object.freeze({
    runtimeAuthorityBinding: input.runtimeAuthority === undefined
      ? null
      : mainHealthRuntimeAuthorityBinding(input.runtimeAuthority).binding,
    localPhysical: physicalLocal,
    hostedAuthorityDigest: hostedLedger === null
      ? null
      : hostedMainHealthAuthorityDigest(hostedLedger),
    hostedProviderEpoch: hostedLedger === null ? null : hostedLedger.healthRevision,
    hostedProvenanceDigest: hostedLedger === null
      ? null
      : digestRef(Object.freeze({
          schema: 'sec-main-health-hosted-provenance-v2',
          producer: hostedLedger.producer
        }))
  }));
  return authority;
}

function mainHealthPublicationStableDigest(input: Readonly<{
  projection: WorkSelectionMainHealthProjection;
  ledger: MainHealthLedger | null;
  repairDecision: MainHealthRepairDecision;
  supersession: MainHealthSupersessionObservation;
  authority: MainHealthPublicationAuthority;
}>): SecWorkDigest {
  const ledger = input.ledger;
  return digestRef(Object.freeze({
    schema: 'sec-main-health-publication-stable-observation-v2',
    projection: input.projection,
    authority: mainHealthPublicationAuthorityBinding(input.authority),
    ledger: ledger === null ? null : Object.freeze({
      repository: ledger.repository,
      defaultBranch: ledger.defaultBranch,
      mainSha: ledger.mainSha,
      mainTreeSha: ledger.mainTreeSha,
      status: ledger.status,
      failureFingerprints: ledger.failureFingerprints,
      owner: ledger.owner,
      repairWorkPackage: ledger.repairWorkPackage,
      allowedLanes: ledger.allowedLanes,
      trustRevision: ledger.trustRevision,
      healthRevision: ledger.healthRevision,
      producer: ledger.producer
    }),
    repairDecision: Object.freeze({
      status: input.repairDecision.status,
      routingState: input.repairDecision.routingState,
      reasonCode: input.repairDecision.reasonCode,
      observationDigest: input.repairDecision.observationDigest,
      binding: input.repairDecision.binding
    }),
    supersession: input.supersession.kind === 'active'
      ? Object.freeze({
          kind: 'active' as const,
          semanticDigest: input.supersession.supersession.receipt.semanticDigest,
          runtimeAuthorityBinding:
            input.supersession.supersession.receipt.runtimeAuthorityBinding,
          hostedAuthorityDigest:
            input.supersession.supersession.receipt.hostedAuthorityDigest
        })
      : input.supersession.kind === 'inactive'
        ? Object.freeze({
            kind: 'inactive' as const,
            ref: input.supersession.ref,
            recordDigest: input.supersession.recordDigest
          })
        : input.supersession.kind === 'blocked'
          ? Object.freeze({ kind: 'blocked' as const, ref: input.supersession.ref })
          : Object.freeze({ kind: input.supersession.kind as 'absent' | 'prepared' })
  }));
}

const mainHealthTestingResultBrand = Symbol('sec-main-health-testing-result-v2');
type MainHealthTestingResult<T> = T & Readonly<{
  readonly [mainHealthTestingResultBrand]: true;
}>;

declare const workSelectionMainHealthSnapshotBrand: unique symbol;
export type WorkSelectionMainHealthSnapshot = Readonly<{
  readonly [workSelectionMainHealthSnapshotBrand]: true;
}>;

type WorkSelectionMainHealthSnapshotBinding = Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  projection: WorkSelectionMainHealthProjection;
  stableDigest: SecWorkDigest;
}>;

const workSelectionMainHealthSnapshotBindings =
  new WeakMap<object, WorkSelectionMainHealthSnapshotBinding>();

function issueWorkSelectionMainHealthSnapshot(
  input: WorkSelectionMainHealthSnapshotBinding
): WorkSelectionMainHealthSnapshot {
  const snapshot = Object.freeze({}) as WorkSelectionMainHealthSnapshot;
  workSelectionMainHealthSnapshotBindings.set(snapshot, Object.freeze({
    ...input,
    repositoryRoot: path.resolve(input.repositoryRoot)
  }));
  return snapshot;
}

export function resolveWorkSelectionMainHealthSnapshot(input: Readonly<{
  snapshot: WorkSelectionMainHealthSnapshot;
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>): Readonly<{
  projection: WorkSelectionMainHealthProjection;
  stableDigest: SecWorkDigest;
}> {
  const binding = workSelectionMainHealthSnapshotBindings.get(input.snapshot);
  if (binding === undefined
      || binding.repositoryRoot !== path.resolve(input.repositoryRoot)
      || binding.repository !== input.repository
      || binding.defaultBranch !== input.defaultBranch
      || binding.mainSha !== input.mainSha
      || binding.mainTreeSha !== input.mainTreeSha) {
    throw new MainHealthGitHubProviderError(
      'WorkSelection MainHealth snapshot is absent, forged, or bound to another exact main'
    );
  }
  return Object.freeze({
    projection: binding.projection,
    stableDigest: binding.stableDigest
  });
}

export async function observeCanonicalMainHealthForPublication(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  observedAt: string;
  projection: WorkSelectionMainHealthProjection;
  ledger: MainHealthLedger | null;
  repairDecision: MainHealthRepairDecision;
  supersession: MainHealthSupersessionObservation;
  authority: MainHealthPublicationAuthority;
  stableDigest: SecWorkDigest;
  workSelectionSnapshot: WorkSelectionMainHealthSnapshot;
}>> {
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => {
      const observation = await observeCanonicalMainHealthProvidersBound({
        ...input,
        capability: currentMainHealthGitHubCapability(input.repository, 'read')
      });
      const repairDecision = compileMainHealthRepairDecisionFromCanonicalObservation(
        input,
        observation
      );
      const authority = createMainHealthPublicationAuthority({
        observation,
        runtimeAuthority: input.runtimeAuthority,
        environment: input.environment
      });
      const result = Object.freeze({
        observedAt: observation.observedAt,
        projection: observation.resolution.projection,
        ledger: observation.resolution.ledger,
        repairDecision,
        supersession: observation.supersession,
        authority,
        stableDigest: '' as SecWorkDigest
      });
      const stable = Object.freeze({
        ...result,
        stableDigest: mainHealthPublicationStableDigest(result)
      });
      return Object.freeze({
        ...stable,
        workSelectionSnapshot: issueWorkSelectionMainHealthSnapshot({
          repositoryRoot: input.repositoryRoot,
          repository: input.repository,
          defaultBranch: input.defaultBranch,
          mainSha: input.mainSha,
          mainTreeSha: input.mainTreeSha,
          projection: stable.projection,
          stableDigest: stable.stableDigest
        })
      });
    }
  });
}

export async function observeCanonicalMainHealthForWorkSelection(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<WorkSelectionMainHealthProjection> {
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => {
      const observation = await observeCanonicalMainHealthProvidersBound({
        ...input,
        capability: currentMainHealthGitHubCapability(input.repository, 'read')
      });
      return observation.resolution.projection;
    }
  });
}

export async function observeCanonicalMainHealthForRepairV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<MainHealthRepairDecision> {
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => {
      const observation = await observeCanonicalMainHealthProvidersBound({
        ...input,
        capability: currentMainHealthGitHubCapability(input.repository, 'read')
      });
      return compileMainHealthRepairDecisionFromCanonicalObservation(input, observation);
    }
  });
}

/**
 * @internal Test-only bound observer. It intentionally returns a branded
 * result and accepts only the isolated test transport seam; production
 * WorkSelection/repair entrypoints above reject this origin.
 */
export async function observeCanonicalMainHealthForWorkSelectionTestingV2(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  capability: MainHealthGitHubCapability;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<MainHealthTestingResult<WorkSelectionMainHealthProjection>> {
  const observation = await observeCanonicalMainHealthProvidersBound(input);
  return Object.freeze({
    ...observation.resolution.projection,
    [mainHealthTestingResultBrand]: true as const
  });
}

/** @internal Test-only bound repair observer; never use as a production issuer. */
export async function observeCanonicalMainHealthForRepairTestingV2(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  capability: MainHealthGitHubCapability;
  runtimeAuthority?: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<MainHealthTestingResult<MainHealthRepairDecision>> {
  const observation = await observeCanonicalMainHealthProvidersBound(input);
  return Object.freeze({
    ...compileMainHealthRepairDecisionFromCanonicalObservation(input, observation),
    [mainHealthTestingResultBrand]: true as const
  });
}

/** @internal Test-only bound reconciliation observer; never a production API. */
export async function reconcileCanonicalMainHealthProviderConflictTestingV2(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
  githubCapability: MainHealthGitHubCapability;
  runtimeAuthority: MainHealthRuntimeAuthority;
  environment?: NodeJS.ProcessEnv;
}>): Promise<MainHealthTestingResult<Awaited<ReturnType<
  typeof reconcileCanonicalMainHealthProviderConflictBound
>>>> {
  if (mainHealthGitHubCapabilityBinding(input.githubCapability).origin !== 'test') {
    throw new MainHealthGitHubProviderError(
      'MainHealth testing reconciliation requires an isolated test capability'
    );
  }
  const result = await reconcileCanonicalMainHealthProviderConflictBound(input);
  return Object.freeze({
    ...result,
    [mainHealthTestingResultBrand]: true as const
  });
}
