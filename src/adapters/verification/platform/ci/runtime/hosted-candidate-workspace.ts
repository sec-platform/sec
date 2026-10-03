/** Private Git data for trusted hosted handlers. This owner grants no candidate execution capability. */
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../../../contracts/canonical.ts';
import { linkNativeAbortSignals, throwIfNativeAborted } from '../../../../../contracts/native-abort.ts';
import { issueSecOperationRequirementBindingContext } from '../../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext, type SecOperationDigest
} from '../../../../../execution/operation/semantic.ts';
import { settleResourcesAsync, type ResourceSettlementFailure } from '../../../../../execution/resource-settlement.ts';
import {
  assertGitCandidateBundleReceipt, closeGitCandidateBundle, createGitCandidateBundle,
  type GitCandidateBundle
} from '../../../../providers/git-bundle/runtime.ts';
import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import {
  assertGitPhysicalProviderReceipt, closeGitPhysicalProvider, openGitPhysicalProvider,
  runGitPhysicalCommandInternal, type GitPhysicalProviderCapability
} from '../../../../providers/git/physical-provider.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent, getAuthenticatedGitHubJobOriginSignal,
  type AuthenticatedGitHubJobOrigin, type AuthenticatedGitHubJobOriginObservation
} from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  assertSameNoFollowDirectoryIdentity, createExclusiveNoFollowDirectory,
  createExclusiveNoFollowRandomDirectory, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryLeaf,
  retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryIdentity, type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt, openProcessResourceSession
} from '../../../../runtime-state/physical/runtime/process-resource-session.ts';

export type HostedCandidateWorkspacePurpose = 'activation-static' | 'action-materialization'
  | 'bootstrap-checker' | 'bootstrap-materialization';
export type HostedCandidateWorkspaceSubject = Readonly<{
  baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string;
}>;
export type HostedCandidateWorkspace = Readonly<{
  baseRoot: string;
  candidateRoot: string;
  identity: Readonly<HostedCandidateWorkspaceSubject & {
    originIdentityDigest: `sha256:${string}`;
    generationIdentityDigest: `sha256:${string}`;
    deadlineAtUnixMs: number;
  }>;
  /** Checks retained roots, exact Git identities and tracked source; no execution admission. */
  assertCurrent(): Promise<void>;
}>;

export class HostedCandidateWorkspaceUnavailableError extends Error {
  readonly code = 'hosted-candidate-workspace-unavailable' as const;
  constructor(readonly reason: 'input' | 'origin' | 'phase' | 'deadline' | 'objects'
    | 'git' | 'identity' | 'closed') {
    super(`Hosted candidate workspace unavailable (${reason}).`);
    this.name = 'HostedCandidateWorkspaceUnavailableError';
  }
}
/** Diagnostic recovery data only. A locator or serialized copy grants no adoption/deletion authority. */
export class HostedCandidateWorkspaceCleanupUnknownError extends Error {
  readonly code = 'hosted-candidate-workspace-cleanup-unknown' as const;
  constructor(readonly recovery: Readonly<{
    generation: PhysicalDirectoryIdentity; parent: PhysicalDirectoryIdentity;
    subject: HostedCandidateWorkspaceSubject; purpose: HostedCandidateWorkspacePurpose;
    originIdentityDigest: `sha256:${string}`; deadlineAtUnixMs: number;
  }>, readonly failure: unknown) {
    super('Hosted candidate workspace cleanup is unresolved; preserve its exact owned generation.', { cause: failure });
    this.name = 'HostedCandidateWorkspaceCleanupUnknownError';
  }
}
function unavailable(reason: HostedCandidateWorkspaceUnavailableError['reason']): never {
  throw new HostedCandidateWorkspaceUnavailableError(reason);
}

/** Pure data validation. Its result never authenticates a job or authorizes an effect. */
export function captureHostedCandidateWorkspaceSubject(input: HostedCandidateWorkspaceSubject): HostedCandidateWorkspaceSubject {
  if (input === null || typeof input !== 'object') unavailable('input');
  const { baseSha, baseTreeSha, headSha, headTreeSha } = input;
  if (![baseSha, baseTreeSha, headSha, headTreeSha].every(value =>
    typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value))) unavailable('input');
  return Object.freeze({ baseSha, baseTreeSha, headSha, headTreeSha });
}

/** Pure binding predicate shared by the real owner and negative contract tests. */
export function assertHostedCandidateWorkspacePurpose(
  purpose: HostedCandidateWorkspacePurpose,
  observed: Pick<AuthenticatedGitHubJobOriginObservation, 'workflowPath' | 'policyJobId' | 'phase'>
): void {
  const compiler = observed.workflowPath === '.github/workflows/compiler-pr-validation.yml';
  const bootstrap = observed.workflowPath === '.github/workflows/trusted-bootstrap.yml';
  const matches = purpose === 'activation-static'
    ? compiler && observed.policyJobId === 'agent-operation-activation' && observed.phase === 'produce-hosted'
    : purpose === 'action-materialization'
      ? compiler && observed.policyJobId === 'claim-verification-action' && observed.phase === 'prepare-start-marker'
      : purpose === 'bootstrap-checker'
        ? bootstrap && ((observed.policyJobId === 'checker-pre' && observed.phase === 'checker-pre')
          || (observed.policyJobId === 'checker-post' && observed.phase === 'checker-post'))
        : purpose === 'bootstrap-materialization'
          && bootstrap && observed.policyJobId === 'candidate-sut' && observed.phase === 'execute-trusted-bootstrap-sut';
  if (!matches) unavailable('phase');
}

/** Pure parser for the only materializer-owned additions; this issues no resource authority. */
export function assertHostedCandidateWorkspaceMutationObservation(input: Readonly<{
  purpose: HostedCandidateWorkspacePurpose; checkout: 'base' | 'candidate';
  subject: HostedCandidateWorkspaceSubject; status: string; refs: string;
}>): void {
  const mutableInputs = input.checkout === 'candidate' && (input.purpose === 'action-materialization'
    || input.purpose === 'bootstrap-materialization');
  const dependencyInstall = input.checkout === 'base' && input.purpose === 'bootstrap-materialization';
  if ((input.status !== '' && !input.status.endsWith('\0')) || (input.refs !== '' && !input.refs.endsWith('\n'))) unavailable('identity');
  for (const entry of input.status.split('\0').filter(Boolean)) {
    const status = entry.slice(0, 3), name = entry.slice(3);
    if ((status !== '?? ' && status !== '!! ') || !(
      (mutableInputs && (name === '.sec-trusted-input/candidate.bundle' || name === '.sec-trusted-input/dependency-closure.json'))
      || (dependencyInstall && (name === 'node_modules/' || name.startsWith('node_modules/'))))) unavailable('identity');
  }
  const refs = input.refs.split('\n').filter(Boolean);
  if (new Set(refs).size !== refs.length || refs.some(ref => !mutableInputs
    || (ref !== `refs/sec/base ${input.subject.baseSha}` && ref !== `refs/sec/head ${input.subject.headSha}`))) unavailable('identity');
}

/** Exact native tree data only; unsupported gitlinks are unavailable, never expanded or executed. */
export function assertHostedCandidateWorkspaceTreeInventory(source: string): void {
  if (source === '') return;
  if (!source.endsWith('\0')) unavailable('objects');
  const entries = source.slice(0, -1).split('\0');
  if (entries.length > MAX_ENTRIES) unavailable('objects');
  const names = new Set<string>(), directories = new Set<string>();
  let bytes = 0;
  for (const entry of entries) {
    const match = /^(100644|100755|120000) blob ([0-9a-f]{40}) +([0-9]+)\t([^\0]+)$/u.exec(entry);
    if (match === null) unavailable('objects');
    const name = match[4]!;
    if (Buffer.byteLength(name, 'utf8') > 4096) unavailable('objects');
    const parts = name.split('/');
    if (names.has(name) || directories.has(name) || parts.some(part => part === '' || part === '.' || part === '..' || part === '.git')) unavailable('objects');
    names.add(name);
    let prefix = '';
    for (let depth = 0; depth < parts.length - 1; depth += 1) {
      prefix = prefix === '' ? parts[depth]! : `${prefix}/${parts[depth]!}`;
      if (names.has(prefix)) unavailable('objects');
      directories.add(prefix);
      if (names.size + directories.size > MAX_ENTRIES) unavailable('objects');
    }
    if (names.size + directories.size > MAX_ENTRIES) unavailable('objects');
    bytes += Number(match[3]);
    if (!Number.isSafeInteger(bytes) || bytes > 128 * 1024 * 1024) unavailable('objects');
  }
}

const REQUIREMENT = 'hosted-candidate-workspace.git-data';
const CONTRACT = sha256({ operation: REQUIREMENT, source: 'authenticated-hosted-origin-exact-existing-git',
  effect: 'private-independent-git-common-directories', candidateExecution: 'none' }) as SecOperationDigest;
const MAX_PROCESSES = 96;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_COMMAND_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 200_000;

/**
 * The callback joins every borrower before returning. Only fixed trusted code may
 * read the candidates or create its reserved refs/input transport. No candidate
 * install, hooks, scripts or dynamic imports run here, and no handles escape.
 */
export async function withHostedCandidateWorkspace<T>(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  subject: HostedCandidateWorkspaceSubject;
  purpose: HostedCandidateWorkspacePurpose;
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>, callback: (workspace: HostedCandidateWorkspace) => Promise<T>): Promise<T> {
  const { origin, purpose, deadlineAtUnixMs: requestedDeadline, signal: parentSignal } = input;
  const subject = captureHostedCandidateWorkspaceSubject(input.subject);
  if (typeof callback !== 'function') unavailable('input');
  const use = callback;
  let observed: AuthenticatedGitHubJobOriginObservation;
  try { observed = assertAuthenticatedGitHubJobOriginCurrent(origin); } catch { unavailable('origin'); }
  assertHostedCandidateWorkspacePurpose(purpose, observed);
  if (subject.baseSha !== observed.trustedSourceSha || subject.baseTreeSha !== observed.trustedSourceTreeSha) unavailable('identity');
  if (requestedDeadline !== undefined && (!Number.isSafeInteger(requestedDeadline) || requestedDeadline <= Date.now())) unavailable('deadline');
  const deadlineAtUnixMs = Math.min(requestedDeadline ?? observed.deadlineAtUnixMs, observed.deadlineAtUnixMs);
  const deadlineAtMonotonicMs = performance.now() + deadlineAtUnixMs - Date.now();
  const signal = linkNativeAbortSignals(parentSignal, getAuthenticatedGitHubJobOriginSignal(origin));
  let closed = false;
  const assertOrigin = (): void => {
    if (closed) unavailable('closed');
    throwIfNativeAborted(signal);
    if (Date.now() >= deadlineAtUnixMs) unavailable('deadline');
    const current = assertAuthenticatedGitHubJobOriginCurrent(origin);
    if (current.identityDigest !== observed.identityDigest || current.trustedDriverRoot !== observed.trustedDriverRoot
      || current.deadlineAtUnixMs !== observed.deadlineAtUnixMs) unavailable('origin');
    assertHostedCandidateWorkspacePurpose(purpose, current);
  };
  assertOrigin();

  // The original read owner must admit the exact existing commits/trees before
  // any temporary generation is born. No remote or lazy-fetch fallback exists.
  const executablePath = await withAuthorityGitReadSession({ cwd: observed.trustedDriverRoot,
    deadlineAtUnixMs, signal, source: process.env, budget: {
      deadlineMs: deadlineAtUnixMs - Date.now(), maxProcesses: 4, maxTotalArgumentBytes: 8192,
      maxStdinBytes: 1, maxStdoutBytes: 4096, maxStderrBytes: 4096, maxRecords: 16,
      maxRootObservedBytes: 128 * 1024 * 1024, maxReopenRefreshes: 2, maxSettlementAttempts: 4,
      maxCommandStdoutBytes: 1024, maxCommandStderrBytes: 1024, maxExecutableBytes: 64 * 1024 * 1024
    } }, async git => {
    for (const [revision, kind, expected] of [
      [subject.baseSha, 'commit', subject.baseSha], [subject.baseSha, 'tree', subject.baseTreeSha],
      [subject.headSha, 'commit', subject.headSha], [subject.headSha, 'tree', subject.headTreeSha]
    ] as const) {
      assertOrigin();
      const result = await git.run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{${kind}}`]);
      if (result.kind !== 'completed' || result.result.code !== 0
          || Buffer.from(result.result.stdout).toString('utf8') !== `${expected}\n`) unavailable('objects');
    }
    if (git.gitExecutableIdentity == null) unavailable('git');
    return git.gitExecutableIdentity.realPath;
  });
  assertOrigin();
  const plan = compileSecSemanticOperationPlan({ operation: REQUIREMENT,
    intentDigest: sha256({ subject, purpose, origin: observed.identityDigest }) as SecOperationDigest,
    decisionDigest: CONTRACT, deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: observed.identityDigest as SecOperationDigest }),
    aggregateBudgets: [{ resource: 'duration-ms', maximum: deadlineAtUnixMs - Date.now() },
      { resource: 'processes', maximum: MAX_PROCESSES }, { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: MAX_OUTPUT_BYTES }],
    requirements: [{ id: REQUIREMENT, contractDigest: CONTRACT, effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: ['provider.unavailable', 'provider.unverified', 'provider.drift', 'process.cancelled',
        'process.deadline-exhausted', 'process.output-budget-exhausted', 'process.settlement-unproven'] }] });
  const operation = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({ requirementId: REQUIREMENT,
    contractDigest: CONTRACT, providerIdentityDigest: CONTRACT })]);
  const processes = openProcessResourceSession({ operation, signal,
    requirementBindingContext: issueSecOperationRequirementBindingContext({ operation, requirementId: REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  let provider: GitPhysicalProviderCapability | undefined;
  let generation: PhysicalDirectoryIdentity | undefined;
  let parent: PhysicalDirectoryIdentity | undefined;
  let bundle: GitCandidateBundle | undefined;
  let bundleFile: RetainedNoFollowOrdinaryFile | undefined;
  const directories: RetainedNoFollowChildProcessDirectory[] = [];
  const checkouts: Array<{ root: string; revision: string; tree: string; config: RetainedNoFollowOrdinaryFile; configDigest: string; sourceDigest: string; gitDigest: string }> = [];
  const configFiles: RetainedNoFollowOrdinaryFile[] = [];
  let bundleAttemptStarted = false;
  let bundleSettled = false;
  const cleanBase = purpose === 'bootstrap-checker' || purpose === 'bootstrap-materialization';
  let primary: ResourceSettlementFailure | undefined;
  let result!: T;
  let processesSettled = false;
  let generationRetired = false;
  const run = async (args: readonly string[], reason: 'objects' | 'git' = 'git'): Promise<string> => {
    assertOrigin();
    const command = await runGitPhysicalCommandInternal(provider!, ['-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null', ...args], {
      env: provider!.environment, envMode: 'replace', maxStdoutBytes: MAX_COMMAND_BYTES,
      maxStderrBytes: 64 * 1024
    }, [...directories.map(capability => ({ capability, kind: 'directory' as const })),
      ...(bundleFile === undefined ? [] : [{ capability: bundleFile, kind: 'ordinary-file' as const }])]);
    assertOrigin();
    if (command.result.code !== 0) unavailable(reason);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(command.result.stdout); } catch { unavailable(reason); }
  };
  const sourceDigest = (root: PhysicalDirectoryIdentity): string => sha256(scanNoFollowDirectoryTreeInventory(root, {
    deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: MAX_ENTRIES, maximumBytes: 128 * 1024 * 1024,
    excludeRelativePaths: ['.git', '.sec-trusted-input', 'node_modules'], signal
  }));
  const gitDigest = (root: PhysicalDirectoryIdentity): string => sha256(scanNoFollowDirectoryTreeInventory(root, {
    deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: MAX_ENTRIES, maximumBytes: 128 * 1024 * 1024,
    excludeRelativePaths: ['refs/sec'], signal
  }).map(entry => entry.kind === 'directory' ? { ...entry, size: 0 } : entry));
  const assertReservedDirectory = (parentRoot: PhysicalDirectoryIdentity, name: string,
    allowed: boolean, leafNames: readonly string[]): void => {
    const directory = inspectNoFollowDirectoryLeaf(parentRoot, name, 'Hosted reserved input directory');
    if (directory === null) return;
    if (!allowed) unavailable('identity');
    const entries = scanNoFollowDirectoryTreeMetadata(directory, {
      deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: 2, signal
    });
    if (entries.some(entry => entry.kind !== 'file' || !leafNames.includes(entry.relativePath))) unavailable('identity');
  };
  try {
    const resolution = openGitPhysicalProvider({ cwd: observed.trustedDriverRoot, executablePath,
      operation, processSession: processes, maximumExecutableBytes: 64 * 1024 * 1024,
      // Native Git receives no job credentials and has no candidate-supplied helpers.
      environmentSource: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' } });
    if (resolution.status !== 'ready') unavailable('git');
    provider = resolution.capability;
    // Check the entire bundle closure before any directory creation. In a
    // partial clone, missing objects remain unavailable rather than fetched.
    const closure = await run(['rev-list', '--objects', '--missing=print', subject.baseSha, subject.headSha], 'objects');
    if (closure.split('\n').some(line => line.startsWith('?'))) unavailable('objects');
    for (const revision of [subject.baseSha, subject.headSha]) {
      if (await run(['ls-tree', '--name-only', revision, '--', '.sec-trusted-input', 'node_modules']) !== '') unavailable('objects');
      assertHostedCandidateWorkspaceTreeInventory(await run(['ls-tree', '-r', '-l', '-z', '--full-tree', revision], 'objects'));
    }
    assertOrigin();
    parent = inspectNoFollowDirectoryChain(tmpdir(), 'Hosted candidate temporary parent').target;
    generation = createExclusiveNoFollowRandomDirectory(parent, 'sec-hosted-candidate-');
    bundleAttemptStarted = true;
    bundle = await createGitCandidateBundle({ sourceRoot: observed.trustedDriverRoot, temporaryRoot: generation.path,
      baseSha: subject.baseSha, headSha: subject.headSha, deadlineAtUnixMs, signal });
    assertOrigin();
    bundleFile = retainNoFollowOrdinaryFile(assertSameNoFollowDirectoryIdentity(generation),
      'candidate.bundle', undefined, 'Hosted candidate bundle input', 8);
    const bundleBytes = bundleFile.digest();
    if (bundleBytes.byteDigest !== bundle.bundleDigest || bundleBytes.size !== bundle.bundleSize) unavailable('identity');
    const targets = [...(cleanBase ? [{ name: 'base', revision: subject.baseSha, tree: subject.baseTreeSha }] : []),
      { name: 'candidate', revision: subject.headSha, tree: subject.headTreeSha }];
    for (const { name, revision, tree } of targets) {
      assertOrigin();
      const directory = createExclusiveNoFollowDirectory(generation, name);
      const retained = retainNoFollowDirectoryForChildProcess(assertSameNoFollowDirectoryIdentity(directory),
        5 + directories.length, `Hosted ${name} data root`);
      directories.push(retained);
      const cwd = retained.childPath;
      await run(['init', '--quiet', '--template=', '--object-format=sha1', '--', cwd]);
      await run(['-C', cwd, '-c', 'protocol.file.allow=always', '-c', 'core.hooksPath=/dev/null',
        'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', bundleFile.childPath,
        'refs/sec/base:refs/heads/input-base', 'refs/sec/head:refs/heads/input-head']);
      await run(['-C', cwd, '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', revision]);
      await run(['-C', cwd, 'update-ref', '-d', 'refs/heads/input-base', subject.baseSha]);
      await run(['-C', cwd, 'update-ref', '-d', 'refs/heads/input-head', subject.headSha]);
      const config = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.join(directory.path, '.git')),
        'config', undefined, 'Hosted private Git configuration', 10 + checkouts.length);
      configFiles.push(config);
      checkouts.push({ root: directory.path, revision, tree, config, configDigest: config.digest().byteDigest,
        sourceDigest: sourceDigest(directory),
        gitDigest: gitDigest(inspectNoFollowDirectoryChain(path.join(directory.path, '.git')).target) });
    }
    const baseRoot = cleanBase ? path.join(generation.path, 'base') : observed.trustedDriverRoot;
    const candidateRoot = path.join(generation.path, 'candidate');
    const gitDirectories = checkouts.map(({ root }) =>
      inspectNoFollowDirectoryChain(path.join(root, '.git'), 'Hosted independent common directory').target);
    const assertCurrent = async (): Promise<void> => {
      assertOrigin();
      assertSameNoFollowDirectoryIdentity(generation!, 'Hosted candidate owner generation');
      for (let index = 0; index < directories.length; index += 1) {
        const directory = directories[index]!;
        directory.assertCurrent();
        assertSameNoFollowDirectoryIdentity(gitDirectories[index]!, 'Hosted independent common directory');
        const expected = checkouts[index]!;
        const { root, revision: sha, tree, config, configDigest } = expected;
        if (sourceDigest(inspectNoFollowDirectoryChain(root).target) !== expected.sourceDigest
          || gitDigest(gitDirectories[index]!) !== expected.gitDigest) unavailable('identity');
        const mutableInputs = root === candidateRoot && (purpose === 'action-materialization' || purpose === 'bootstrap-materialization');
        assertReservedDirectory(inspectNoFollowDirectoryChain(root).target, '.sec-trusted-input', mutableInputs,
          ['candidate.bundle', 'dependency-closure.json']);
        assertReservedDirectory(inspectNoFollowDirectoryChain(path.join(root, '.git', 'refs')).target, 'sec', mutableInputs,
          ['base', 'head']);
        config.assertCurrent();
        if (config.digest().byteDigest !== configDigest) unavailable('identity');
        const identity = await run(['-C', directory.childPath, 'rev-parse', '--path-format=absolute',
          '--show-toplevel', '--absolute-git-dir', '--git-common-dir', 'HEAD', 'HEAD^{tree}']);
        if (identity !== `${root}\n${root}/.git\n${root}/.git\n${sha}\n${tree}\n`) unavailable('identity');
        const dirty = await run(['-C', directory.childPath, 'status', '--porcelain=v1', '-z',
          '--untracked-files=all', '--ignored=matching']);
        const refs = await run(['-C', directory.childPath, 'for-each-ref', '--format=%(refname) %(objectname)']);
        assertHostedCandidateWorkspaceMutationObservation({ purpose, checkout: root === candidateRoot ? 'candidate' : 'base',
          subject, status: dirty, refs });
        config.assertCurrent();
      }
      assertOrigin();
    };
    await assertCurrent();
    const workspace = Object.freeze({ baseRoot, candidateRoot, assertCurrent,
      identity: Object.freeze({ ...subject, originIdentityDigest: observed.identityDigest,
        generationIdentityDigest: sha256({ generation, gitDirectories, bundle: bundle.materializationIdentityDigest }),
        deadlineAtUnixMs }) });
    result = await use(workspace);
    await assertCurrent();
  } catch (error) { primary = { label: 'hosted-candidate-workspace', error }; }
  // No late caller can borrow the private scope while its handles are closing.
  closed = true;
  try {
    await settleResourcesAsync({ primary, cleanup: [
    { label: 'hosted-candidate-git-provider', settle: () => {
      if (provider !== undefined) assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(provider), provider);
    } },
    { label: 'hosted-candidate-processes', settle: () => {
      const receipt = processes.close();
      assertProcessResourceSessionReceipt(receipt, { operationIdentityDigest: operation.plan.identity.identityDigest,
        boundAttemptDigest: operation.boundAttemptDigest, requirementId: REQUIREMENT });
      processesSettled = true;
    } },
    { label: 'hosted-candidate-bundle-input', settle: () => bundleFile?.dispose() },
    ...configFiles.map((config, index) => ({ label: `hosted-candidate-config[${index}]`, settle: () => config.dispose() })),
    ...directories.map((directory, index) => ({ label: `hosted-candidate-directory[${index}]`, settle: () => directory.dispose() })),
    { label: 'hosted-candidate-bundle', settle: () => {
      if (bundle !== undefined) {
        assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle);
        bundleSettled = true;
      }
    } },
    { label: 'hosted-candidate-owned-generation', settle: () => {
      if (generation === undefined) return;
      if (!processesSettled || (bundleAttemptStarted && !bundleSettled)) unavailable('git');
      // Never renew the parent's deadline, delete by a fresh pathname, or sweep
      // another generation. Expired or drifted generations remain unresolved.
      const root = assertSameNoFollowDirectoryIdentity(generation, 'Hosted candidate retirement generation').target;
      const inventory = scanNoFollowDirectoryTreeMetadata(root, {
        deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: MAX_ENTRIES * 4
      });
      retireNoFollowDirectoryTree({ parent: parent!, root, inventory, deadlineAtMonotonicMs });
      generationRetired = true;
    } }
    ] });
  } catch (failure) {
    if (generation !== undefined && !generationRetired) {
      throw new HostedCandidateWorkspaceCleanupUnknownError(Object.freeze({
        generation: Object.freeze({ ...generation }), parent: Object.freeze({ ...parent! }), subject, purpose,
        originIdentityDigest: observed.identityDigest, deadlineAtUnixMs
      }), failure);
    }
    throw failure;
  }
  return result;
}
