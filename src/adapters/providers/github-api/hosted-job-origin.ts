import { randomUUID } from 'node:crypto';
import { readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../contracts/exact-json.ts';
import { isNativeAborted, linkNativeAbortSignals, throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { settleResources, settleResourcesAsync } from '../../../execution/resource-settlement.ts';
import { withOwnedByteStreamReader } from '../../../execution/stream-reader.ts';
import {
  assertSameNoFollowDirectoryIdentity, inspectNoFollowDirectoryChain,
  retainCurrentProcessExecutable, type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { withAuthorityGitReadSession } from '../git-read/authority.ts';
import { SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST } from '../linux-verification/contract.ts';
import {
  assertCiVerificationPerJobHostedWorkflowShape,
  getCiVerificationPerJobHostedJobPolicy
} from './contract/hosted-job-policy.ts';
import {
  GITHUB_ACTIONS_OIDC_JWKS, verifyGitHubHostedJobSignedClaims,
  type GitHubHostedJobSignedClaims
} from './internal/hosted-job-origin-jwt.ts';
import { decodeAuthenticatedGitHubJobBinding, type AuthenticatedGitHubJobBinding } from './internal/hosted-job-origin-response.ts';
import {
  executeGitHubApiOperation, inspectGitHubApiCapability,
  withGitHubApiVerificationSession, type GitHubApiCapability
} from './operation-session.ts';

declare const authenticatedJobOriginBrand: unique symbol;
/**
 * Authenticated software job origin under the reviewed GitHub/VM-admin/launcher
 * TCB. This is not hardware attestation or proof against credential forwarding.
 * Candidate execution must remain inside the owner's isolated container path.
 */
export type AuthenticatedGitHubJobOrigin = Readonly<{ readonly [authenticatedJobOriginBrand]: true }>;
export type AuthenticatedGitHubJobOriginObservation = AuthenticatedGitHubJobBinding & Readonly<{
  deadlineAtUnixMs: number;
  credentialExpiresAtUnixMs: number;
  trustedDriverRoot: string;
  driverBunExecutableDigest: typeof SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST;
  workflowSourceDigest: `sha256:${string}`;
  launcherSourceDigest: `sha256:${string}`;
}>;

export class AuthenticatedGitHubJobOriginUnavailableError extends Error {
  readonly code = 'authenticated-github-job-origin-unavailable' as const;
  constructor(readonly reason: 'context' | 'transport' | 'binding' | 'source' | 'expired' | 'closed') {
    super(`Authenticated GitHub job origin unavailable (${reason}).`);
  }
}

interface OriginRecord {
  readonly repositoryRoot: string;
  readonly root: PhysicalDirectoryIdentity;
  readonly mountNamespace: string;
  readonly executable: RetainedNoFollowOrdinaryFile;
  readonly identityDigest: `sha256:${string}`;
  readonly binding: AuthenticatedGitHubJobBinding;
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  readonly workflowSourceDigest: `sha256:${string}`;
  readonly launcherSourceDigest: `sha256:${string}`;
  readonly credentialExpiresAtUnixMs: number;
  readonly deadlineTimer: ReturnType<typeof setTimeout>;
  closed: boolean;
}
const issuedOrigins = new WeakMap<object, OriginRecord>();
// Same-job reopen cannot reset the deadline. It is always derived from the
// provider's original started_at plus the closed job policy, never Date.now().
const admittedJobDeadlines = new Map<string, number>();
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function unavailable(reason: AuthenticatedGitHubJobOriginUnavailableError['reason']): never {
  throw new AuthenticatedGitHubJobOriginUnavailableError(reason);
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) unavailable('binding');
  return value as Record<string, unknown>;
}
function selectedContext(): Readonly<{ repository: string; jobId: string; requestUrl: URL; requestToken: string }> {
  // Selectors are not authority. The official signature and authenticated API
  // binding below independently verify every identity used for issuance.
  // Native fetch must not silently use a caller-selected proxy, CA or TLS
  // override. An explicitly configured corporate transport needs its own
  // qualified owner; it is not a fallback for this narrow managed-job lane.
  if (process.platform !== 'linux' || process.arch !== 'x64') unavailable('context');
  const forbidden = new Set(['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'node_extra_ca_certs', 'node_tls_reject_unauthorized', 'node_use_env_proxy',
    'ssl_cert_file', 'ssl_cert_dir', 'node_options', 'bun_options']);
  if (Object.keys(process.env).some(key => forbidden.has(key.toLowerCase()) && process.env[key] !== undefined)) unavailable('context');
  const repository = process.env.GITHUB_REPOSITORY;
  const jobId = process.env.GITHUB_JOB;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const requestUrlValue = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
      || typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(jobId)
      || typeof requestToken !== 'string' || requestToken.length < 20 || requestToken.length > 16_384
      || !/^[\x21-\x7e]+$/u.test(requestToken) || typeof requestUrlValue !== 'string'
      || requestUrlValue.length > 8192) unavailable('context');
  let requestUrl: URL;
  try { requestUrl = new URL(requestUrlValue); } catch { unavailable('context'); }
  if (requestUrl.protocol !== 'https:' || requestUrl.username !== '' || requestUrl.password !== ''
      || requestUrl.port !== '' || requestUrl.hash !== ''
      || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.actions\.githubusercontent\.com$/u.test(requestUrl.hostname)
      || !/\/_apis\/distributedtask\/hubs\/Actions\/plans\/[^/]+\/jobs\/[^/]+\/idtoken$/u.test(requestUrl.pathname)) unavailable('context');
  return Object.freeze({ repository, jobId, requestUrl, requestToken });
}

async function jsonRequest(url: URL, deadline: number, signal: AbortSignal, token?: string): Promise<unknown> {
  // Fetch reads ambient transport selectors per request, including the second
  // public JWKS request. Recheck rather than rely on a previous empty snapshot.
  selectedContext();
  const controller = new AbortController();
  const linked = linkNativeAbortSignals(signal, controller.signal);
  const remaining = Math.min(30_000, deadline - Date.now());
  if (remaining <= 0) unavailable('expired');
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    throwIfNativeAborted(linked);
    const response = await globalThis.fetch(url, { method: 'GET', redirect: 'error', signal: linked,
      headers: { Accept: 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) } });
    if (response.body === null) unavailable('transport');
    return await withOwnedByteStreamReader(response.body, async read => {
      if (response.status !== 200) unavailable('transport');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        throwIfNativeAborted(linked);
        const chunk = await read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 128 * 1024) unavailable('transport');
        chunks.push(new Uint8Array(chunk.value));
      }
      return parseExactJsonBytes(Buffer.concat(chunks, size), 'GitHub origin response',
        { maximumInputBytes: 128 * 1024, maximumDepth: 8 });
    }, linked);
  } catch {
    // Secret-bearing URLs, response bodies and native causes never escape.
    unavailable(isNativeAborted(signal) ? 'closed' : Date.now() >= deadline ? 'expired' : 'transport');
  } finally { clearTimeout(timer); }
}

async function signedClaims(deadline: number, signal: AbortSignal): Promise<GitHubHostedJobSignedClaims> {
  const context = selectedContext();
  const audience = `sec:hosted-job-origin:v1:${randomUUID()}`;
  context.requestUrl.searchParams.set('audience', audience);
  const requestedAtUnixMs = Date.now();
  const tokenResponse = object(await jsonRequest(context.requestUrl, deadline, signal, context.requestToken));
  if (typeof tokenResponse.value !== 'string') unavailable('transport');
  const jwks = await jsonRequest(new URL(GITHUB_ACTIONS_OIDC_JWKS), deadline, signal);
  try {
    return verifyGitHubHostedJobSignedClaims({ token: tokenResponse.value, jwks, audience,
      requestedAtUnixMs, observedAtUnixMs: Date.now() });
  } catch { unavailable('binding'); }
}

async function jobs(capability: GitHubApiCapability, claims: GitHubHostedJobSignedClaims): Promise<readonly unknown[]> {
  const pages: unknown[] = [];
  for (let page = 1; page <= 2; page += 1) {
    const result = await executeGitHubApiOperation(capability,
      { kind: 'verification-workflow-jobs', runId: claims.runId, runAttempt: claims.runAttempt, page });
    pages.push(result);
    const total = object(result).total_count;
    if (!Number.isSafeInteger(total) || Number(total) < 1 || Number(total) > 200) unavailable('binding');
    if (Number(total) <= page * 100) return Object.freeze(pages);
  }
  unavailable('binding');
}

async function blob(capability: GitHubApiCapability, sha: string, file: string): Promise<string> {
  const value = object(await executeGitHubApiOperation(capability, { kind: 'verification-blob', ref: sha, path: file }));
  if (value.type !== 'file' || value.path !== file || value.encoding !== 'base64'
      || typeof value.content !== 'string' || value.content.length > 512 * 1024) unavailable('source');
  const encoded = value.content.replace(/\n/gu, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || value.size !== bytes.length || bytes.length > 256 * 1024) unavailable('source');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { unavailable('source'); }
}

async function assertExactLoadedCheckout(repositoryRoot: string, binding: AuthenticatedGitHubJobBinding): Promise<void> {
  // Source launcher only. A caller-selected copy cannot stand in for the code
  // loaded into this process. Retention relies on the explicitly reviewed TCB,
  // not on inotify pretending to exclude an arbitrary privileged host writer.
  if (path.resolve(repositoryRoot) !== SOURCE_ROOT) unavailable('source');
  await withAuthorityGitReadSession({ cwd: repositoryRoot, source: process.env, budget: {
    deadlineMs: Math.min(30_000, binding.originalDeadlineAtUnixMs - Date.now()), maxProcesses: 3,
    maxTotalArgumentBytes: 4096, maxStdinBytes: 1, maxStdoutBytes: 128 * 1024,
    maxStderrBytes: 16 * 1024, maxRecords: 4096, maxRootObservedBytes: 128 * 1024 * 1024,
    maxReopenRefreshes: 2, maxSettlementAttempts: 3, maxCommandStdoutBytes: 64 * 1024,
    maxCommandStderrBytes: 8 * 1024, maxExecutableBytes: 64 * 1024 * 1024
  } }, async git => {
    for (const [argv, expected] of [
      [['rev-parse', 'HEAD'], `${binding.trustedSourceSha}\n`],
      [['rev-parse', 'HEAD^{tree}'], `${binding.trustedSourceTreeSha}\n`],
      [['status', '--porcelain=v1', '--untracked-files=no'], '']
    ] as const) {
      const result = await git.run(argv);
      if (result.kind !== 'completed' || result.result.code !== 0
          || !Buffer.from(result.result.stdout).equals(Buffer.from(expected))) unavailable('source');
    }
  });
}

/** Official request + signature + canonical live API/source binding is the only issuer. */
export async function openAuthenticatedGitHubJobOrigin(input: Readonly<{
  repositoryRoot: string;
  signal?: AbortSignal;
}>): Promise<AuthenticatedGitHubJobOrigin> {
  // Snapshot caller selectors once before the first await. A later mutation of
  // its object cannot replace the checkout or cancellation lineage we retain.
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const parentSignal = input.signal;
  const context = selectedContext();
  const controller = new AbortController();
  const signal = linkNativeAbortSignals(parentSignal, controller.signal);
  const openingDeadline = Date.now() + 60_000;
  const claims = await signedClaims(openingDeadline, signal);
  if (claims.repository !== context.repository) unavailable('binding');
  const selected = await withGitHubApiVerificationSession({ repositoryRoot,
    repository: claims.repository, effect: 'verification-read', deadlineAtUnixMs: openingDeadline, signal,
    operation: async capability => {
      const observed = inspectGitHubApiCapability(capability);
      if (observed.origin !== 'production' || observed.repository !== claims.repository
          || observed.principal.transport !== 'github-actions-token'
          || observed.principal.workflowSha !== claims.workflowSha || observed.principal.workflowRef !== claims.workflowRef) unavailable('binding');
      const repository = await executeGitHubApiOperation(capability, { kind: 'repository' });
      const defaultBranch = await executeGitHubApiOperation(capability, { kind: 'branch', branch: 'main' });
      const run = await executeGitHubApiOperation(capability, { kind: 'workflow-run', runId: claims.runId });
      const binding = decodeAuthenticatedGitHubJobBinding({ claims, jobId: context.jobId,
        repository, defaultBranch, run, jobs: await jobs(capability, claims), observedAtUnixMs: Date.now() });
      const workflowSource = await blob(capability, binding.workflowSha, binding.workflowPath);
      const policy = assertCiVerificationPerJobHostedWorkflowShape(workflowSource, binding.policyJobId);
      if (policy !== getCiVerificationPerJobHostedJobPolicy(binding.workflowPath, binding.policyJobId)
          || policy.runtime.kind !== 'per-job-runtime') unavailable('source');
      const launcherSource = await blob(capability, binding.workflowSha, policy.runtime.launcherPath);
      return { binding, defaultBranch, workflowSourceDigest: rawSha256(workflowSource), launcherSourceDigest: rawSha256(launcherSource) };
    } });
  await assertExactLoadedCheckout(repositoryRoot, selected.binding);
  throwIfNativeAborted(signal);
  if (Date.now() >= claims.expiresAtUnixMs || Date.now() >= selected.binding.originalDeadlineAtUnixMs) unavailable('expired');
  const deadlineKey = `${selected.binding.repositoryId}:${selected.binding.checkRunId}`;
  const oldDeadline = admittedJobDeadlines.get(deadlineKey);
  if (oldDeadline !== undefined && oldDeadline !== selected.binding.originalDeadlineAtUnixMs) unavailable('binding');
  admittedJobDeadlines.set(deadlineKey, selected.binding.originalDeadlineAtUnixMs);
  const root = inspectNoFollowDirectoryChain(repositoryRoot).target;
  const origin = Object.freeze({}) as AuthenticatedGitHubJobOrigin;
  const mountNamespace = readlinkSync('/proc/self/ns/mnt');
  if (!/^mnt:\[[1-9][0-9]*\]$/u.test(mountNamespace)) unavailable('source');
  const executable = retainCurrentProcessExecutable(3, 'Authenticated hosted bootstrap Bun');
  try {
    if (executable.digest().byteDigest !== SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST) unavailable('source');
    const identityDigest = sha256({ schema: 'sec-authenticated-hosted-driver-scope-v1',
      binding: selected.binding.identityDigest, driverBunExecutableDigest: SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
      sourceRoot: { device: root.device, inode: root.inode }, mountNamespace, processId: process.pid });
    // Hashing/retaining the real executable can consume the remaining token
    // lifetime. This is the final new-issuance fence, after every slow read.
    throwIfNativeAborted(signal);
    if (Date.now() >= claims.expiresAtUnixMs || Date.now() >= selected.binding.originalDeadlineAtUnixMs) unavailable('expired');
    issuedOrigins.set(origin, { repositoryRoot, root, mountNamespace, executable, identityDigest, binding: selected.binding,
      signal, controller, credentialExpiresAtUnixMs: claims.expiresAtUnixMs,
      deadlineTimer: setTimeout(() => controller.abort(), selected.binding.originalDeadlineAtUnixMs - Date.now()),
      workflowSourceDigest: selected.workflowSourceDigest, launcherSourceDigest: selected.launcherSourceDigest,
      closed: false });
  } catch (error) {
    settleResources({ primary: { label: 'hosted-bootstrap-bun-admission', error },
      cleanup: [{ label: 'hosted-bootstrap-bun', settle: () => executable.dispose() }] });
    throw error;
  }
  try { assertAuthenticatedGitHubJobOriginCurrent(origin); } catch (error) {
    await settleResourcesAsync({ primary: { label: 'hosted-origin-admission', error },
      cleanup: [{ label: 'hosted-origin', settle: () => closeAuthenticatedGitHubJobOrigin(origin) }] });
    throw error;
  }
  return origin;
}

export function assertAuthenticatedGitHubJobOriginCurrent(origin: AuthenticatedGitHubJobOrigin): AuthenticatedGitHubJobOriginObservation {
  const record = issuedOrigins.get(origin);
  if (record === undefined) unavailable('binding');
  if (record.closed || isNativeAborted(record.signal)) unavailable('closed');
  const deadlineAtUnixMs = record.binding.originalDeadlineAtUnixMs;
  if (Date.now() >= deadlineAtUnixMs) unavailable('expired');
  try {
    assertSameNoFollowDirectoryIdentity(record.root, 'authenticated hosted source root');
    if (readlinkSync('/proc/self/ns/mnt') !== record.mountNamespace) unavailable('source');
    record.executable.assertCurrent();
  } catch {
    record.closed = true;
    clearTimeout(record.deadlineTimer);
    record.controller.abort();
    unavailable('source');
  }
  return Object.freeze({ ...record.binding, identityDigest: record.identityDigest,
    deadlineAtUnixMs, credentialExpiresAtUnixMs: record.credentialExpiresAtUnixMs,
    trustedDriverRoot: record.repositoryRoot, driverBunExecutableDigest: SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
    workflowSourceDigest: record.workflowSourceDigest, launcherSourceDigest: record.launcherSourceDigest });
}

/**
 * Issuance-time JWT validity establishes this process-local authenticated
 * scope. Its continuity then relies on the reviewed trusted launcher and
 * retained source, with the original provider job deadline and cancellation.
 * Bearer expiry cannot re-open, extend or recreate the scope. No serialized
 * receipt, fresh nonce or secondary process restores this private record.
 */
export function getAuthenticatedGitHubJobOriginSignal(origin: AuthenticatedGitHubJobOrigin): AbortSignal {
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  return issuedOrigins.get(origin)!.signal;
}

export async function closeAuthenticatedGitHubJobOrigin(origin: AuthenticatedGitHubJobOrigin): Promise<void> {
  const record = issuedOrigins.get(origin);
  if (record === undefined) unavailable('binding');
  record.closed = true;
  clearTimeout(record.deadlineTimer);
  record.controller.abort();
  record.executable.dispose();
}
