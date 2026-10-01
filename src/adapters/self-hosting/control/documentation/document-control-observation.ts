import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { sha256 } from '../../../../contracts/canonical.ts';
import {
  type CodexDevelopmentExactGitTreeEntry,
  CodexDevelopmentReadExactGitBlobBytesBatchFromSession,
  parseExactGitBlobInfoBatch,
  parseExactGitBlobsBatch,
  parseExactGitTreeEntries
} from '../../../providers/git-read/exact-blob.ts';
import { type GitIndexGeneration } from '../../../providers/git-read/runtime/scratch-index-generation.ts';
import {
  assertProductionGitReadSession,
  type GitReadHostProviderResolutionReason,
  type GitReadSession,
  type GitReadSessionFailure,
  type GitScratchIndexTreeFailureReason,
  isolatedGitReadEnvironment
} from '../../../providers/git-read/runtime/session.ts';
import { type GitHubApiCapability } from '../../../providers/github-api/operation-session.ts';
import { type ByteCommandResult, runCommandBytes } from '../../../runtime-state/physical/runtime/process.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import {
  assertMainHealthPublicationAuthorityStable,
  observeCanonicalMainHealthForDocumentControlTestingV2,
  observeCanonicalMainHealthForPublication,
  observeMainHealthGitHubControlInventory,
  observeMainHealthGitHubDefaultBranchSha,
  withMainHealthGitHubReadSession
} from '../main-health/work-selection-main-health.ts';
import {
  observeSecWorkSelectionLive,
  observeSecWorkSelectionWithProviderV1,
  type SecWorkSelectionProvider
} from '../work-selection/runtime.ts';
import { parseNulList, shaValue } from './document-control-journal-codec.ts';
import { CodexDevelopmentParseRollingMachineProjection } from './document-control-plane-contract.ts';
import {
  buildGitHubOpenInventoryCountsArgs,
  buildGitHubOpenIssuesArgs,
  buildGitHubOpenPullRequestReviewThreadsArgs,
  buildGitHubOpenPullRequestsArgs,
  buildGitHubPullRequestReviewThreadsArgs,
  type GitHubReviewThreadConnection,
  parseExactGitHubNumberedInventory,
  parseGitHubOpenInventoryCounts,
  parseGitHubOpenPullRequestReviewThreadPages,
  parseGitHubPullRequestReviewThreadPages,
  parseGitHubRepositoryIdentityFromRemoteUrl,
  replaceIncompleteGitHubReviewThreads
} from './document-control-plane-github-observation.ts';
import { pathComparisonValue } from './document-control-publication.ts';

/**
 * Bounded Git/GitHub observation and owner-issued session composition. The test
 * issuer and raw AsyncLocalStorage scopes remain private. Production bindings accept
 * only the canonical Git provider's issued session; observation cannot authorize
 * object/index effects or reset budgets inside a writer lifetime.
 */

/**
 * One production read composition for the required Work Package admission.
 * Repair routing is observed first; ordinary WorkSelection is queried only
 * when that exact observation admits the ordinary lane. Nested provider calls
 * reuse the same MainHealth session and therefore one total request budget.
 */
export async function observeDocumentControlWorkRouting(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  exactMainSha: string;
  exactMainTreeSha: string;
}>): Promise<Readonly<{
  repairDecision: Awaited<ReturnType<typeof observeCanonicalMainHealthForPublication>>['repairDecision'];
  selection: Awaited<ReturnType<typeof observeSecWorkSelectionLive>> | null;
}>> {
  const testActor = documentControlRoutingTestScope.getStore();
  if (testActor !== undefined) {
    if (documentControlHostCliTestScope.getStore() !== documentControlHostCliTestIssuer
        || !documentControlRoutingTestActors.has(testActor)) {
      throw new Error('Document-control test routing actor is absent, forged, or outside its host test scope.');
    }
    const capability = testActor.githubCapability(input.repositoryRoot);
    return await testActor.withGitHubCapability(capability, async () => {
      const jointInput = Object.freeze({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        mainSha: input.exactMainSha,
        mainTreeSha: input.exactMainTreeSha,
        capability,
        environment: testActor.mainHealthEnvironment(input.repositoryRoot)
      });
      const first = await observeCanonicalMainHealthForDocumentControlTestingV2(jointInput);
      const second = await observeCanonicalMainHealthForDocumentControlTestingV2(jointInput);
      if (first.stableDigest !== second.stableDigest) {
        throw new Error('document-control test MainHealth snapshot drifted between T1 and T2');
      }
      const selection = second.repairDecision.routingState === 'ordinary-only'
        ? await observeSecWorkSelectionWithProviderV1({
            cwd: input.repositoryRoot,
            exactMain: input.exactMainSha,
            exactMainTree: input.exactMainTreeSha
          }, testActor.workSelectionProvider, async () => second.projection)
        : null;
      return Object.freeze({ repairDecision: second.repairDecision, selection });
    });
  }
  return await withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async () => {
      const snapshotInput = Object.freeze({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        mainSha: input.exactMainSha,
        mainTreeSha: input.exactMainTreeSha
      });
      const first = await observeCanonicalMainHealthForPublication(snapshotInput);
      // T2 remains inside the outer MainHealth session, so credential,
      // request-count, response-byte and total-deadline budgets cannot reset.
      const second = await observeCanonicalMainHealthForPublication(snapshotInput);
      assertMainHealthPublicationAuthorityStable(first.authority, second.authority);
      if (first.stableDigest !== second.stableDigest) {
        throw new Error('document-control MainHealth snapshot drifted between T1 and T2');
      }
      const repairDecision = second.repairDecision;
      const selection = repairDecision.routingState === 'ordinary-only'
          ? await observeSecWorkSelectionLive({
            cwd: input.repositoryRoot,
            exactMain: input.exactMainSha,
            exactMainTree: input.exactMainTreeSha,
            mainHealthSnapshot: second.workSelectionSnapshot
          })
        : null;
      return Object.freeze({ repairDecision, selection });
    }
  });
}

export type CommandResult = {
  code: number;
  stdout: string;
  stdoutBytes?: Uint8Array;
  stderr: string;
};

export type CommandOptions = {
  readonly input?: string | Uint8Array;
  readonly environment?: Readonly<Record<string, string>>;
};

/**
 * Git observations consume the canonical production GitRead session. Git
 * object/index writes and GitHub calls remain separate semantic capabilities;
 * neither can inherit authority from the read session or raw transport.
 */
export type CodexDevelopmentDocumentControlCliOperation =
  | 'git-read'
  | 'git-object-index-effect'
  | 'github-api-read'
  | 'github-effect';

export type CodexDevelopmentDocumentControlCliAdmissionStatus =
  | 'unsupported'
  | 'unknown'
  | 'unavailable';

export type CodexDevelopmentDocumentControlCliAdmissionReason =
  | GitReadHostProviderResolutionReason
  | GitReadSessionFailure['reason']
  | GitScratchIndexTreeFailureReason
  | 'semantic-closure-unproven'
  | 'working-directory-binding-drift';

export class CodexDevelopmentDocumentControlCliAdmissionError extends Error {
  readonly code = 'DOCUMENT-CONTROL-CLI-ADMISSION-001' as const;
  readonly command: 'git' | 'gh';
  readonly operation: CodexDevelopmentDocumentControlCliOperation;
  readonly status: CodexDevelopmentDocumentControlCliAdmissionStatus;
  readonly reason: CodexDevelopmentDocumentControlCliAdmissionReason;
  readonly detailDigest: `sha256:${string}`;

  constructor(input: Readonly<{
    command: 'git' | 'gh';
    operation: CodexDevelopmentDocumentControlCliOperation;
    status: CodexDevelopmentDocumentControlCliAdmissionStatus;
    reason: CodexDevelopmentDocumentControlCliAdmissionReason;
    detailDigest: `sha256:${string}`;
  }>) {
    super(`Document-control ${input.command} ${input.operation} admission is ${input.status}.`);
    this.name = 'CodexDevelopmentDocumentControlCliAdmissionError';
    this.command = input.command;
    this.operation = input.operation;
    this.status = input.status;
    this.reason = input.reason;
    this.detailDigest = input.detailDigest;
  }
}

const documentControlHostCliTestScope = new AsyncLocalStorage<symbol>();

const documentControlHostCliTestIssuer = Symbol('sec-document-control-host-cli-test-issuer-v1');

const documentControlGitReadScope = new AsyncLocalStorage<GitReadSession>();

const GIT_FREEZE_CONTROL_BATCH_RECORD_LIMIT = 4;

// Each writer/terminal Git owner gets a separate lifetime. Immutable
// bytes never stand in for a mutable ref/index fence or a new object-store cut.
const freezeReadScope = new AsyncLocalStorage<{
  blobs: Map<string, Buffer>;
  index?: Readonly<{ repositoryRoot: string; paths: GitIndexPaths; routing: string }>;
}>();

export interface DocumentControlRoutingTestActor {
  readonly githubCapability: (repositoryRoot: string) => GitHubApiCapability;
  readonly withGitHubCapability: <T>(
    capability: GitHubApiCapability,
    operation: () => Promise<T>
  ) => Promise<T>;
  readonly workSelectionProvider: SecWorkSelectionProvider;
  readonly mainHealthEnvironment: (repositoryRoot: string) => NodeJS.ProcessEnv;
}

const documentControlRoutingTestActors = new WeakSet<object>();

const documentControlRoutingTestScope = new AsyncLocalStorage<DocumentControlRoutingTestActor>();

/** @internal Issues one isolated routing composition for document lifecycle tests. */
export function createDocumentControlRoutingTestActorForTests(
  actor: DocumentControlRoutingTestActor
): DocumentControlRoutingTestActor {
  const issued = Object.freeze({ ...actor });
  documentControlRoutingTestActors.add(issued);
  return issued;
}

/**
 * @internal Test-only host transport scope for the crash/CAS fixture suite.
 * Production callers must never import this seam; the provider-boundary
 * contract scans the production tree and rejects such a consumer. The
 * AsyncLocalStorage binding prevents a test fixture from changing the
 * process-global production route or leaking into an unrelated async task.
 */
export function withDocumentControlHostCliTestSessionV1<T>(
  operation: () => T,
  routingActor?: DocumentControlRoutingTestActor
): T {
  if (routingActor !== undefined && !documentControlRoutingTestActors.has(routingActor)) {
    throw new Error('Document-control routing test actor is forged.');
  }
  return documentControlHostCliTestScope.run(documentControlHostCliTestIssuer, () => (
    routingActor === undefined ? operation() : documentControlRoutingTestScope.run(routingActor, operation)
  ));
}

function documentControlCliFailureDigest(input: Readonly<{
  command: 'git' | 'gh';
  operation: CodexDevelopmentDocumentControlCliOperation;
  status: CodexDevelopmentDocumentControlCliAdmissionStatus;
  reason: CodexDevelopmentDocumentControlCliAdmissionReason;
  sourceDetailDigest?: `sha256:${string}`;
}>): `sha256:${string}` {
  return sha256({
    schema: 'sec-document-control-cli-admission-failure-v1',
    ...input
  }) as `sha256:${string}`;
}

function commandOperation(
  command: 'git' | 'gh',
  args: readonly string[]
): CodexDevelopmentDocumentControlCliOperation {
  if (command === 'gh') {
    // The current document-control GitHub calls are all reads.  Keep the
    // effect category explicit for future callers so a new mutation cannot
    // inherit a read-session contract accidentally.
    return args.some((arg, index) => (
      arg === '--method=POST'
      || (arg === '--method' && args[index + 1] === 'POST')
    ))
      ? 'github-effect'
      : 'github-api-read';
  }
  const verb = args[0] ?? '';
  const objectOrIndexEffect = verb === 'write-tree'
    || (verb === 'hash-object' && args.includes('-w'))
    || verb === 'update-index'
    || verb === 'read-tree'
    || verb === 'index-pack';
  return objectOrIndexEffect ? 'git-object-index-effect' : 'git-read';
}

export function documentControlCliFailure(
  command: 'git' | 'gh',
  operation: CodexDevelopmentDocumentControlCliOperation,
  status: CodexDevelopmentDocumentControlCliAdmissionStatus,
  reason: CodexDevelopmentDocumentControlCliAdmissionReason,
  sourceDetailDigest?: `sha256:${string}`
): CodexDevelopmentDocumentControlCliAdmissionError {
  return new CodexDevelopmentDocumentControlCliAdmissionError({
    command,
    operation,
    status,
    reason,
    detailDigest: documentControlCliFailureDigest({
      command,
      operation,
      status,
      reason,
      ...(sourceDetailDigest === undefined ? {} : { sourceDetailDigest })
    })
  });
}

export const ExternalCommandTimeoutMs = 30_000;

// The writing phase keeps admission, scratch-object publication and durable
// terminal-journal readback in one bounded Git session. Only after successful
// writer settlement does the operation owner admit separate terminal retirement;
// no session is reopened to refresh the writing phase's allowance.
export const DOCUMENT_CONTROL_FREEZE_GIT_READ_BUDGET = Object.freeze({
  ...GIT_READ_OPERATION_BUDGET,
  maxProcesses: 128
});

// Status reads the complete index tree twice around its external observations.
// Native private-index computation is independent of directory depth.
// Keep both current object/index fences in one session.
export const DOCUMENT_CONTROL_STATUS_GIT_READ_BUDGET = Object.freeze({
  ...GIT_READ_OPERATION_BUDGET,
  maxProcesses: 128
});

const ExternalCommandMaxBufferBytes = 8 * 1024 * 1024;

export async function run(
  command: string,
  args: string[],
  cwd: string,
  options: CommandOptions = {}
): Promise<CommandResult> {
  if (command !== 'git' && command !== 'gh') {
    throw new Error(`Document-control command is outside the Git/GitHub boundary: ${command}`);
  }
  const operation = commandOperation(command, args);
  const testTransport = documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer;
  if (command === 'gh' && !testTransport) {
    throw documentControlCliFailure(command, operation, 'unknown', 'semantic-closure-unproven');
  }
  const result = command === 'git'
    ? await runDocumentControlGitReadBytes(args, cwd, options)
    : await runDocumentControlTestCliBytes(command, args, cwd, options);
  return Object.freeze({
    code: result.code,
    stdout: Buffer.from(result.stdout).toString('utf8'),
    ...(args[0] === 'status' && args.includes('-z') ? { stdoutBytes: Buffer.from(result.stdout) } : {}),
    stderr: Buffer.from(result.stderr).toString('utf8')
  });
}

async function runDocumentControlTestCliBytes(
  command: 'git' | 'gh',
  args: readonly string[],
  cwd: string,
  options: CommandOptions
): Promise<ByteCommandResult> {
  const inputBytes = options.input === undefined
    ? undefined
    : typeof options.input === 'string'
      ? Buffer.from(options.input, 'utf8')
      : Buffer.from(options.input);
  const result = await runCommandBytes(command, [...args], {
    cwd,
    ...(inputBytes === undefined ? {} : {
      input: inputBytes,
      maxStdinBytes: inputBytes.byteLength
    }),
    timeoutMs: ExternalCommandTimeoutMs,
    maxStdoutBytes: ExternalCommandMaxBufferBytes,
    maxStderrBytes: ExternalCommandMaxBufferBytes,
    envMode: 'replace',
    env: command === 'git'
      ? isolatedGitReadEnvironment(options.environment ?? {}, process.env)
      : {
          ...process.env,
          ...options.environment,
          GH_PROMPT_DISABLED: '1',
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0'
        }
  });
  return result;
}

async function runDocumentControlGitReadBytes(
  args: readonly string[],
  cwd: string,
  options: CommandOptions = {}
): Promise<ByteCommandResult> {
  if (documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer) {
    return runDocumentControlTestCliBytes('git', args, cwd, options);
  }

  const operation = commandOperation('git', args);
  if (operation !== 'git-read') {
    throw documentControlCliFailure('git', operation, 'unknown', 'semantic-closure-unproven');
  }
  const session = documentControlGitReadScope.getStore();
  if (session === undefined) {
    throw documentControlCliFailure('git', operation, 'unknown', 'semantic-closure-unproven');
  }
  if (pathComparisonValue(path.resolve(cwd)) !== pathComparisonValue(path.resolve(session.cwd))) {
    throw documentControlCliFailure('git', operation, 'unavailable', 'working-directory-binding-drift');
  }
  if ((options.environment !== undefined && Object.keys(options.environment).length > 0)
      || options.input !== undefined) {
    // Per-command repository/index/object overrides are a different semantic
    // capability. They must not be smuggled into the read session or reset its
    // immutable environment and aggregate budget.
    throw documentControlCliFailure('git', operation, 'unknown', 'semantic-closure-unproven');
  }
  const outcome = await session.run(args);
  if (outcome.kind !== 'completed') {
    throw documentControlCliFailure(
      'git',
      operation,
      'unavailable',
      outcome.reason,
      outcome.detailDigest
    );
  }
  return outcome.result;
}

export function requireCommand(result: CommandResult, label: string): string {
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  return result.stdout.trim();
}

export function requireCommandOutput(result: CommandResult, label: string): string {
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  return result.stdout;
}

export function assertFreezeReadOwnerCurrent(): void {
  const session = documentControlGitReadScope.getStore();
  if (session === undefined || session.failure !== null || !session.verifyExecutable()
      || session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Retained freeze observation has no current Git owner.');
  }
}

export async function readGitBlob(
  cwd: string,
  spec: string,
  environment: Readonly<Record<string, string>> = {}
): Promise<Buffer | undefined> {
  const retained = Object.keys(environment).length === 0 && /^(?:[0-9a-f]{40}|[0-9a-f]{64})(?::|$)/u.test(spec)
    ? freezeReadScope.getStore()?.blobs : undefined;
  const key = `${cwd}\0${spec}`;
  const prior = retained?.get(key);
  if (prior !== undefined) {
    assertFreezeReadOwnerCurrent();
    return Buffer.from(prior);
  }
  const result = await runDocumentControlGitReadBytes(
    ['show', spec],
    cwd,
    Object.keys(environment).length === 0 ? {} : { environment }
  );
  if (result.code !== 0) return undefined;
  const bytes = Buffer.from(result.stdout);
  retained?.set(key, Buffer.from(bytes));
  return bytes;
}

/** Bounded control batches reuse the existing strict native protocol reader.
 * The caller supplies path membership from a captured index or exact ls-tree;
 * caller-provided journal bytes never supply the native result. */
export async function readControlBlobEntries(
  repositoryRoot: string,
  entries: readonly CodexDevelopmentExactGitTreeEntry[],
  observeCommand?: (args: readonly string[]) => void
): Promise<ReadonlyMap<string, Buffer>> {
  if (entries.length > GIT_FREEZE_CONTROL_BATCH_RECORD_LIMIT) throw new Error('Control blob batch exceeds its closed path inventory.');
  if (entries.some(entry => entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755'))) {
    throw new Error('Control tree entry is not an ordinary blob.');
  }
  if (entries.length === 0) return new Map();
  const testTransport = documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer;
  const session = testTransport ? undefined : documentControlGitReadScope.getStore();
  if (!testTransport) {
    if (session === undefined) throw new Error('Control blob batch requires its live Git owner.');
    assertProductionGitReadSession(session);
    if (path.resolve(session.cwd) !== path.resolve(repositoryRoot)) throw new Error('Control blob batch changed repository owner.');
    const roots = entries.length === 1 ? 1 : 1 + entries.length;
    const stdinWorkers = entries.length === 1 ? 0 : 1 + Math.floor(entries.length / 2);
    const stdinBytes = entries.length === 1 ? 0 : 2 * entries.reduce((total, entry) => total + entry.blobSha.length + 1, 0);
    if ((session.stdinBytes ?? 0) + stdinBytes > session.budget.maxStdinBytes) {
      throw new Error('Control blob batch exceeds its remaining aggregate stdin admission.');
    }
    if (session.processCount + roots > session.budget.maxProcesses
        || (session.observeNativeResourceCapacity()?.remaining ?? 0) < roots + (process.platform === 'win32' ? stdinWorkers : 0)) {
      throw new Error('Control blob batch exceeds its remaining root/native process admission.');
    }
  }
  const outputLimit = session?.budget.maxCommandStdoutBytes ?? ExternalCommandMaxBufferBytes;
  const execute = async (args: readonly string[], input?: Buffer): Promise<Buffer> => {
    observeCommand?.(args);
    if (session === undefined) {
      const result = await runDocumentControlGitReadBytes(args, repositoryRoot, input === undefined ? {} : { input });
      if (result.code !== 0) throw new Error('Control blob observation did not complete.');
      return Buffer.from(result.stdout);
    }
    const outcome = await session.run(args, input === undefined ? {} : { input });
    if (outcome.kind !== 'completed' || outcome.result.code !== 0) throw new Error('Control blob observation did not complete.');
    return Buffer.from(outcome.result.stdout);
  };
  const chargeRecords = (count: number) => {
    if (session?.consumeRecords(count) != null) throw new Error('Control blob record budget is exhausted.');
  };
  const readRaw = async (entry: CodexDevelopmentExactGitTreeEntry, expectedBytes?: number): Promise<Buffer> => {
    // Raw blob output preserves the old per-blob ceiling, including a blob
    // which exactly fills it and cannot accommodate batch protocol framing.
    const bytes = await execute(['cat-file', 'blob', entry.blobSha]);
    if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) throw new Error('Control blob size changed from its exact native metadata.');
    chargeRecords(1);
    return bytes;
  };
  if (entries.length === 1) return new Map([[entries[0]!.repositoryPath, await readRaw(entries[0]!)]]);
  const request = (selected: readonly CodexDevelopmentExactGitTreeEntry[]) =>
    Buffer.from(`${selected.map(entry => entry.blobSha).join('\n')}\n`, 'ascii');
  const info = parseExactGitBlobInfoBatch(entries, await execute(['cat-file', '--batch-check'], request(entries)));
  chargeRecords(info.length);
  // Compute every partition before reading any payload. A failed/truncated
  // batch is never retried; all commands share the original owner budgets.
  const chunks: Array<{ entries: CodexDevelopmentExactGitTreeEntry[]; framedBytes: number }> = [];
  const sizes = new Map(info.map(entry => [entry.repositoryPath, entry.byteLength]));
  for (const entry of entries) {
    const size = sizes.get(entry.repositoryPath)!;
    if (size > outputLimit) throw new Error('Control blob exceeds the existing per-blob output ceiling.');
    const framedBytes = size + entry.blobSha.length + 8 + String(size).length;
    const last = chunks.at(-1);
    if (last !== undefined && last.framedBytes <= outputLimit && last.framedBytes + framedBytes <= outputLimit) {
      last.entries.push(entry); last.framedBytes += framedBytes;
    } else chunks.push({ entries: [entry], framedBytes });
  }
  const payloadBytes = chunks.reduce((total, chunk) => total + (chunk.entries.length === 1
    ? sizes.get(chunk.entries[0]!.repositoryPath)! : chunk.framedBytes), 0);
  if (session !== undefined && payloadBytes > session.budget.maxStdoutBytes - (session.stdoutBytes ?? 0)) {
    throw new Error('Control blob payloads exceed the original aggregate output admission.');
  }
  const result = new Map<string, Buffer>();
  for (const chunk of chunks) {
    if (chunk.entries.length === 1) {
      const entry = chunk.entries[0]!;
      result.set(entry.repositoryPath, await readRaw(entry, sizes.get(entry.repositoryPath)));
      continue;
    }
    if (session !== undefined) observeCommand?.(['cat-file', '--batch']);
    const blobs = session === undefined
      ? parseExactGitBlobsBatch(chunk.entries, await execute(['cat-file', '--batch'], request(chunk.entries)), outputLimit)
      : await CodexDevelopmentReadExactGitBlobBytesBatchFromSession(session, { entries: chunk.entries, maxTotalBytes: outputLimit });
    for (const blob of blobs) {
      if (blob.byteLength !== sizes.get(blob.repositoryPath)) throw new Error('Control blob batch size changed from its exact native metadata.');
      result.set(blob.repositoryPath, Buffer.from(blob.bytes));
    }
  }
  return result;
}

export async function readControlTreeBlobs(
  repositoryRoot: string, treeSha: string, paths: readonly string[]
): Promise<ReadonlyMap<string, Buffer>> {
  if (freezeReadScope.getStore() === undefined) {
    const blobs = new Map<string, Buffer>();
    for (const repositoryPath of paths) {
      const bytes = await readGitBlob(repositoryRoot, `${treeSha}:${repositoryPath}`);
      if (bytes !== undefined) blobs.set(repositoryPath, bytes);
    }
    return blobs;
  }
  shaValue(treeSha, 'Control blob tree');
  const selected = [...new Set(paths)];
  if (selected.length > GIT_FREEZE_CONTROL_BATCH_RECORD_LIMIT) throw new Error('Control tree batch exceeds its closed path inventory.');
  const result = await runDocumentControlGitReadBytes([
    'ls-tree', '-z', '--full-tree', treeSha, '--', ...selected
  ], repositoryRoot);
  if (result.code !== 0) throw new Error('Control tree membership observation did not complete.');
  const entries = parseExactGitTreeEntries(Buffer.from(result.stdout));
  if (entries.some(entry => !selected.includes(entry.repositoryPath))) throw new Error('Control tree batch returned a foreign path.');
  const session = documentControlGitReadScope.getStore();
  if (session?.consumeRecords(entries.length) != null) throw new Error('Control tree membership record budget is exhausted.');
  const blobs = await readControlBlobEntries(repositoryRoot, entries);
  const retained = freezeReadScope.getStore()?.blobs;
  for (const [repositoryPath, bytes] of blobs) retained?.set(`${repositoryRoot}\0${treeSha}:${repositoryPath}`, Buffer.from(bytes));
  return blobs;
}

export function controlIndexEntries(generation: GitIndexGeneration, paths: readonly string[]): readonly CodexDevelopmentExactGitTreeEntry[] {
  const selected = new Map([...new Set(paths)].map(repositoryPath => [Buffer.from(repositoryPath).toString('hex'), repositoryPath]));
  if (selected.size > GIT_FREEZE_CONTROL_BATCH_RECORD_LIMIT) throw new Error('Control index batch exceeds its closed path inventory.');
  return generation.entries.flatMap(entry => {
    const repositoryPath = selected.get(entry.pathHex);
    if (repositoryPath === undefined) return [];
    if (entry.mode !== 0o100644 && entry.mode !== 0o100755) throw new Error('Control index entry is not a stage-zero regular blob.');
    return [{ repositoryPath, blobSha: entry.objectId, mode: entry.mode.toString(8), type: 'blob' }];
  });
}

export function requireControlBlob(blobs: ReadonlyMap<string, Buffer>, repositoryPath: string, label: string): Buffer {
  const bytes = blobs.get(repositoryPath);
  if (bytes === undefined) throw new Error(`${label} is absent from the immutable Git snapshot.`);
  return bytes;
}

export interface ReadOnlyResolverGit {
  run(args: readonly string[], cwd: string, options?: CommandOptions): Promise<CommandResult>;
  readBlob(cwd: string, spec: string, options?: CommandOptions): Promise<Buffer | undefined>;
  readBlobs(cwd: string, entries: readonly CodexDevelopmentExactGitTreeEntry[]): Promise<ReadonlyMap<string, Buffer>>;
}

export type ReadOnlyResolverGitObserver = (event: Readonly<{
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
}>) => void;

export function createReadOnlyResolverGit(
  observer?: ReadOnlyResolverGitObserver
): ReadOnlyResolverGit {
  const observeEnvironment = (
    args: readonly string[],
    environment: Readonly<Record<string, string>> | undefined
  ): Readonly<Record<string, string>> => {
    const observed = documentControlGitReadScope.getStore()?.env
      ?? Object.freeze(isolatedGitReadEnvironment(environment ?? {}, process.env));
    observer?.(Object.freeze({ args: Object.freeze([...args]), environment: observed }));
    return observed;
  };
  return Object.freeze({
    run(args: readonly string[], cwd: string, options: CommandOptions = {}) {
      const environment = observeEnvironment(args, options.environment);
      return run('git', [...args], cwd, {
        ...options,
        ...(documentControlGitReadScope.getStore() === undefined
          ? { environment }
          : {})
      });
    },
    readBlobs(cwd: string, entries: readonly CodexDevelopmentExactGitTreeEntry[]) {
      return readControlBlobEntries(cwd, entries, args => { observeEnvironment(args, undefined); });
    },
    async readBlob(cwd: string, spec: string, options: CommandOptions = {}) {
      const args = ['show', spec] as const;
      const environment = observeEnvironment(args, options.environment);
      const result = await runDocumentControlGitReadBytes(
        args,
        cwd,
        documentControlGitReadScope.getStore() === undefined
          ? { ...options, environment }
          : options
      );
      return result.code === 0 ? Buffer.from(result.stdout) : undefined;
    }
  });
}

export async function requireGitBlob(cwd: string, spec: string, label: string): Promise<Buffer> {
  const blob = await readGitBlob(cwd, spec);
  if (blob === undefined) throw new Error(`${label} is absent from the immutable Git tree.`);
  return blob;
}

export async function observeCommittedCandidateProjectionSourceTreeDelta(input: Readonly<{
  repositoryRoot: string;
  currentTree: string;
  rollingPlanSource: string;
}>): Promise<readonly string[] | null> {
  const projection = CodexDevelopmentParseRollingMachineProjection(input.rollingPlanSource);
  if (projection?.schema !== 'sec-work-rolling-transition-projection-v1'
      || projection.authority.kind !== 'committed-candidate-replan') {
    return null;
  }
  const observation = await run('git', [
    'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z',
    projection.authority.sourceTree, input.currentTree, '--'
  ], input.repositoryRoot);
  return observation.code === 0 ? Object.freeze(parseNulList(observation.stdout)) : null;
}

export interface GitIndexPaths {
  readonly gitDirectory: string;
  readonly indexPath: string;
  readonly lockPath: string;
}

export function unresolvedGitHubObservation(reason: string): Readonly<{
  status: 'unresolved';
  reason: string;
}> {
  return Object.freeze({ status: 'unresolved', reason });
}

function githubCommandFailure(label: string, result: CommandResult): string | null {
  if (result.code === 0) return null;
  return `${label} failed: ${result.stderr.trim() || `exit ${result.code}`}`;
}

export async function observeLiveDefaultSha(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  remote: string;
  defaultBranch: string;
  resolverGit: ReadOnlyResolverGit;
  observedRemote?: (url: string) => void;
}>): Promise<string | undefined> {
  const remoteUrl = await input.resolverGit.run(
    ['remote', 'get-url', input.remote],
    input.repositoryRoot
  );
  if (remoteUrl.code !== 0) return undefined;
  input.observedRemote?.(remoteUrl.stdout.trim());
  const githubRepository = parseGitHubRepositoryIdentityFromRemoteUrl(remoteUrl.stdout);
  if (githubRepository !== null) {
    if (githubRepository.toLowerCase() !== input.repository.toLowerCase()) return undefined;
    try {
      return await observeMainHealthGitHubDefaultBranchSha({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        defaultBranch: input.defaultBranch
      });
    } catch {
      return undefined;
    }
  }
  return optionalLiveDefaultSha(await input.resolverGit.run(
    ['ls-remote', '--exit-code', input.remote, `refs/heads/${input.defaultBranch}`],
    input.repositoryRoot
  ), 'Live default ref');
}

export async function observeGitHubControlFacts(
  repositoryRoot: string,
  repository: string
): Promise<Readonly<Record<string, unknown>>> {
  if (documentControlHostCliTestScope.getStore() !== documentControlHostCliTestIssuer) {
    try {
      const inventory = await withMainHealthGitHubReadSession({
        repositoryRoot,
        repository,
        operation: async () => await observeMainHealthGitHubControlInventory({ repository })
      });
      return Object.freeze({ status: 'resolved', ...inventory });
    } catch (error) {
      return unresolvedGitHubObservation(error instanceof Error ? error.message : String(error));
    }
  }
  const countBeforeResult = await run(
    'gh',
    buildGitHubOpenInventoryCountsArgs(repository),
    repositoryRoot
  );
  const countBeforeFailure = githubCommandFailure('GitHub open inventory count', countBeforeResult);
  if (countBeforeFailure !== null) return unresolvedGitHubObservation(countBeforeFailure);

  try {
    const counts = parseGitHubOpenInventoryCounts(countBeforeResult.stdout);
    const [pullRequestsResult, issuesResult, reviewThreadsResult] = await Promise.all([
      run(
        'gh',
        buildGitHubOpenPullRequestsArgs(repository, counts.pullRequests),
        repositoryRoot
      ),
      run(
        'gh',
        buildGitHubOpenIssuesArgs(repository, counts.issues),
        repositoryRoot
      ),
      run(
        'gh',
        buildGitHubOpenPullRequestReviewThreadsArgs(repository),
        repositoryRoot
      )
    ]);
    const commandFailure = [
      githubCommandFailure('GitHub open pull request inventory', pullRequestsResult),
      githubCommandFailure('GitHub open issue inventory', issuesResult),
      githubCommandFailure('GitHub review-thread inventory', reviewThreadsResult)
    ].filter((reason): reason is string => reason !== null).join(' | ');
    if (commandFailure.length > 0) return unresolvedGitHubObservation(commandFailure);

    const openPullRequests = parseExactGitHubNumberedInventory(
      pullRequestsResult.stdout,
      'open pull request inventory',
      counts.pullRequests
    );
    const openIssues = parseExactGitHubNumberedInventory(
      issuesResult.stdout,
      'open issue inventory',
      counts.issues
    );
    const pullRequestNumbers = openPullRequests.map((pullRequest) => pullRequest.number as number);
    const reviewThreadInventory = parseGitHubOpenPullRequestReviewThreadPages(
      reviewThreadsResult.stdout,
      pullRequestNumbers
    );
    const replacements = new Map<number, GitHubReviewThreadConnection>();
    for (const pullRequestNumber of reviewThreadInventory.incompletePullRequestNumbers) {
      const result = await run(
        'gh',
        buildGitHubPullRequestReviewThreadsArgs(repository, pullRequestNumber),
        repositoryRoot
      );
      const failure = githubCommandFailure(
        `GitHub pull request ${pullRequestNumber} review-thread pagination`,
        result
      );
      if (failure !== null) return unresolvedGitHubObservation(failure);
      replacements.set(
        pullRequestNumber,
        parseGitHubPullRequestReviewThreadPages(result.stdout, pullRequestNumber)
      );
    }
    const reviewThreads = replaceIncompleteGitHubReviewThreads(
      reviewThreadInventory,
      replacements
    );

    const countAfterResult = await run(
      'gh',
      buildGitHubOpenInventoryCountsArgs(repository),
      repositoryRoot
    );
    const countAfterFailure = githubCommandFailure(
      'GitHub open inventory count readback',
      countAfterResult
    );
    if (countAfterFailure !== null) return unresolvedGitHubObservation(countAfterFailure);
    const countReadback = parseGitHubOpenInventoryCounts(countAfterResult.stdout);
    if (
      countReadback.pullRequests !== counts.pullRequests
      || countReadback.issues !== counts.issues
    ) {
      return unresolvedGitHubObservation(
        'GitHub open inventory count changed during the observation fence.'
      );
    }

    return Object.freeze({
      status: 'resolved',
      openPullRequests,
      openIssues,
      reviewThreads
    });
  } catch (error) {
    return unresolvedGitHubObservation(error instanceof Error ? error.message : String(error));
  }
}

export function optionalCommandSha(result: CommandResult, label: string): string | undefined {
  return result.code === 0 ? shaValue(result.stdout.trim(), label) : undefined;
}

function optionalLiveDefaultSha(result: CommandResult, label: string): string | undefined {
  if (result.code !== 0) return undefined;
  return shaValue(result.stdout.trim().split(/\s+/u)[0], label);
}

/** Internal observations expose current custody, never the test issuer or mutable scope binder. */
export function isDocumentControlHostCliTestSession(): boolean {
  return documentControlHostCliTestScope.getStore() === documentControlHostCliTestIssuer;
}

export function currentDocumentControlGitReadSession(): GitReadSession | undefined {
  return documentControlGitReadScope.getStore();
}

export function currentDocumentControlFreezeReadCustody() {
  return freezeReadScope.getStore();
}

/** Bind only a canonical provider-issued session; this creates no authority. */
export function withDocumentControlGitReadSession<T>(session: GitReadSession, operation: () => T): T {
  assertProductionGitReadSession(session);
  return documentControlGitReadScope.run(session, operation);
}

/** Writer and terminal owners each receive fresh immutable-read custody. */
export function withDocumentControlFreezeReadSession<T>(session: GitReadSession, operation: () => T): T {
  return withDocumentControlGitReadSession(session, () => freezeReadScope.run({ blobs: new Map() }, operation));
}
