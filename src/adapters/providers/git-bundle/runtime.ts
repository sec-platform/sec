import { lstatSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { linkNativeAbortSignals, throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { isResourceCompositeSettlementError, settleResources as settlePhysicalResources, settleResourcesAsync as settlePhysicalResourcesAsync, type ResourceSettlementFailure as PhysicalResourceSettlementFailure } from '../../../execution/resource-settlement.ts';
import {
  parseGitLineReply,
  parseGitObjectIdReply
} from '../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowDirectory,
  createExclusiveNoFollowRandomDirectory,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  readNoFollowOrdinaryFile,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  bindProcessResourceCommandIssuer,
  openProcessResourceSession,
  releasePreparedProcessResourceCommands,
  runBoundProcessResourceCommand,
  type BoundProcessResourceCommand,
  type ProcessResourceCommandBinding,
  type ProcessResourceCommandIssuer,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import { withAuthorityGitReadSession } from '../git-read/authority.ts';
import { captureGitReadArguments, GIT_READ_LOCAL_HELPER_SUPPRESSION, gitReadCommandIsObservation } from '../git-read/runtime/read-command.ts';
import {
  assertGitReadSessionReceipt,
  createAuthorityGitIsolatedWorktreeObservation,
  createAuthorityGitReadSession,
  isGitIsolatedWorktreeCleanupUnknown,
  type GitIsolatedWorktreeObservation,
  type GitReadSession,
  type GitReadSessionCommand
} from '../git-read/runtime/session.ts';
import {
  assertGitPhysicalProviderCurrentInternal,
  assertGitPhysicalProviderReceipt,
  assertGitPhysicalResourceAdmissionInternal,
  closeGitPhysicalProvider,
  openGitPhysicalProvider,
  runGitPhysicalCommandInternal,
  type GitPhysicalProviderCapability,
  type GitPhysicalProviderReceipt
} from '../git/physical-provider.ts';

const CANDIDATE_BUNDLE_OPERATION = 'external-capabilities.git-bundle.create';
const CANDIDATE_BUNDLE_REQUIREMENT = 'git-bundle.host-process';
const CANDIDATE_BUNDLE_CONTRACT = sha256({
  operation: CANDIDATE_BUNDLE_OPERATION,
  source: 'git-read-exact-repository-identity-v1',
  effect: 'fixed-local-fetch-and-bundle-v1',
  output: 'retained-ordinary-file-v1'
}) as OperationDigest;
const CANDIDATE_BUNDLE_PROCESS_PROVIDER = sha256({
  provider: 'runtime-state.physical.process-resource-session',
  consumer: CANDIDATE_BUNDLE_OPERATION
}) as OperationDigest;
const CANDIDATE_BUNDLE_DURATION_MS = 120_000;
const CANDIDATE_BUNDLE_MAXIMUM_PROCESSES = 32;
const CANDIDATE_BUNDLE_MAXIMUM_INPUT_BYTES = 64 * 1024;
const CANDIDATE_BUNDLE_MAXIMUM_OUTPUT_BYTES = 16 * 1024 * 1024;
const CANDIDATE_BUNDLE_MAXIMUM_FILE_BYTES = 8 * 1024 * 1024;
const CANDIDATE_BUNDLE_COMMAND_OUTPUT_BYTES = 256 * 1024;
const CANDIDATE_BUNDLE_EXECUTABLE_BYTES = 64 * 1024 * 1024;
const CANDIDATE_BUNDLE_BARE_NAME = 'bundle-source.git';
const CANDIDATE_BUNDLE_FILE_NAME = 'candidate.bundle';
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const GIT_READ_BUDGET = Object.freeze({
  deadlineMs: CANDIDATE_BUNDLE_DURATION_MS,
  maxProcesses: 3,
  maxTotalArgumentBytes: 16 * 1024,
  maxStdinBytes: 1,
  maxStdoutBytes: 128 * 1024,
  maxStderrBytes: 128 * 1024,
  maxRecords: 8,
  maxRootObservedBytes: 128 * 1024 * 1024,
  maxReopenRefreshes: 4,
  maxSettlementAttempts: 4,
  maxCommandStdoutBytes: 64 * 1024,
  maxCommandStderrBytes: 64 * 1024,
  maxExecutableBytes: CANDIDATE_BUNDLE_EXECUTABLE_BYTES
});

export type GitCandidateBundle = Readonly<{
  readonly bundlePath: string;
  readonly bundleSize: number;
  readonly bundleDigest: `sha256:${string}`;
  readonly baseSha: string;
  readonly headSha: string;
  readonly objectFormat: 'sha1' | 'sha256';
  readonly materializationIdentityDigest: OperationDigest;
}>;

export type GitCandidateBundleReceipt = Readonly<{
  readonly schema: 'sec-git-candidate-bundle-receipt-v1';
  readonly materializationIdentityDigest: OperationDigest;
  readonly bundlePath: string;
  readonly bundleSize: number;
  readonly bundleDigest: `sha256:${string}`;
  readonly baseSha: string;
  readonly headSha: string;
  readonly terminal: 'released';
  readonly receiptDigest: OperationDigest;
}>;

type GitCandidateBundleState = {
  readonly retainedBundle: RetainedNoFollowOrdinaryFile;
  receipt: GitCandidateBundleReceipt | null;
  terminalFailure: unknown;
  hasTerminalFailure: boolean;
};

const GIT_CANDIDATE_BUNDLE_STATES = new WeakMap<object, GitCandidateBundleState>();
const ISSUED_GIT_CANDIDATE_BUNDLE_RECEIPTS = new WeakSet<object>();

function compileCandidateBundleOperation(input: Readonly<{
  sourceRoot: string;
  temporaryRoot: string;
  baseSha: string;
  headSha: string;
  deadlineAtUnixMs: number;
  checkoutPurpose?: CandidateCheckoutPurpose;
}>): BoundSemanticOperation {
  const operationName = input.checkoutPurpose === undefined ? CANDIDATE_BUNDLE_OPERATION : 'external-capabilities.git-bundle.checkout';
  const contract = input.checkoutPurpose === undefined ? CANDIDATE_BUNDLE_CONTRACT : sha256({
    source: CANDIDATE_BUNDLE_CONTRACT, checkout: 'independent-git-config-ref-source-lifetime',
    retirement: 'original-generation-after-all-borrowers-settle'
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: operationName,
    intentDigest: sha256({
      sourceRoot: input.sourceRoot,
      temporaryRoot: input.temporaryRoot,
      baseSha: input.baseSha,
      headSha: input.headSha,
      bareName: CANDIDATE_BUNDLE_BARE_NAME,
      bundleName: CANDIDATE_BUNDLE_FILE_NAME,
      ...(input.checkoutPurpose === undefined ? {} : { purpose: input.checkoutPurpose })
    }) as OperationDigest,
    decisionDigest: contract,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contract
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: CANDIDATE_BUNDLE_DURATION_MS },
      { resource: 'input-bytes', maximum: CANDIDATE_BUNDLE_MAXIMUM_INPUT_BYTES },
      { resource: 'output-bytes', maximum: input.checkoutPurpose === undefined ? CANDIDATE_BUNDLE_MAXIMUM_OUTPUT_BYTES : 256 * 1024 * 1024 },
      { resource: 'processes', maximum: input.checkoutPurpose === undefined ? CANDIDATE_BUNDLE_MAXIMUM_PROCESSES : 2048 }
    ],
    requirements: [{
      id: CANDIDATE_BUNDLE_REQUIREMENT,
      contractDigest: contract,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'filesystem.identity-drift',
        'filesystem.output-occupied',
        'filesystem.read-failed',
        'filesystem.write-failed',
        'process.cancelled',
        'process.deadline-exhausted',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: CANDIDATE_BUNDLE_REQUIREMENT,
    contractDigest: contract,
    providerIdentityDigest: CANDIDATE_BUNDLE_PROCESS_PROVIDER
  })]);
}

function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function completed(command: GitReadSessionCommand, label: string): Uint8Array {
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new Error(`Git candidate bundle ${label} observation is unresolved.`);
  }
  return command.result.stdout;
}

function requireAbsentTargets(temporaryRoot: PhysicalDirectoryChain): void {
  if (inspectNoFollowDirectoryLeaf(
    temporaryRoot.target,
    CANDIDATE_BUNDLE_BARE_NAME,
    'Git candidate bundle bare target'
  ) !== null) {
    throw new Error('Git candidate bundle bare target must be absent.');
  }
  if (inspectNoFollowOrdinaryFileEntry(
    temporaryRoot.target,
    CANDIDATE_BUNDLE_FILE_NAME
  ) !== null) {
    throw new Error('Git candidate bundle file target must be absent.');
  }
}

function retainUniqueDirectories(
  chains: readonly PhysicalDirectoryChain[]
): ReadonlyMap<string, RetainedNoFollowChildProcessDirectory> {
  const retained = new Map<string, RetainedNoFollowChildProcessDirectory>();
  try {
    for (const chain of chains) {
      if (retained.has(chain.target.path)) continue;
      retained.set(chain.target.path, retainNoFollowDirectoryForChildProcess(
        chain,
        5 + retained.size,
        'Git candidate bundle source directory'
      ));
    }
    return retained;
  } catch (error) {
    settlePhysicalResources({
      primary: { label: 'git-candidate-bundle-source-retention', error },
      cleanup: [...retained.values()].map((capability, index) => ({
        label: `git-candidate-bundle-source-retention[${index}]`,
        settle: () => capability.dispose()
      }))
    });
    throw error;
  }
}

async function runRequiredGitCommand(
  provider: GitPhysicalProviderCapability,
  args: readonly string[],
  label: string,
  auxiliaryInputs: Parameters<typeof runGitPhysicalCommandInternal>[3] = [],
  maxStdoutBytes = CANDIDATE_BUNDLE_COMMAND_OUTPUT_BYTES
): Promise<Uint8Array> {
  const run = await runGitPhysicalCommandInternal(provider, args, {
    env: provider.environment,
    envMode: 'replace',
    maxStdoutBytes,
    maxStderrBytes: CANDIDATE_BUNDLE_COMMAND_OUTPUT_BYTES
  }, auxiliaryInputs);
  if (run.result.code !== 0) {
    throw new Error(`Git candidate bundle ${label} failed: ${run.result.stderr.slice(-4_096) || '<empty>'}`);
  }
  return run.result.stdout;
}

async function materializeCandidateBundle(input: Readonly<{
  sourceRoot: string;
  temporaryRoot: string;
  baseSha: string;
  headSha: string;
  operation: BoundSemanticOperation;
  processSession: ReturnType<typeof openProcessResourceSession>;
  temporaryRootIdentity: PhysicalDirectoryChain;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  retainedBundle: RetainedNoFollowOrdinaryFile;
  objectFormat: 'sha1' | 'sha256';
  sourceIdentityDigest: OperationDigest;
  publicationDigest: string;
  providerReceipt: GitPhysicalProviderReceipt;
}>> {
  let pendingRetainedBundle: RetainedNoFollowOrdinaryFile | null = null;
  try {
    return await withAuthorityGitReadSession({
      cwd: input.sourceRoot,
      operation: input.operation,
      processSession: input.processSession,
      budget: GIT_READ_BUDGET,
      deadlineAtUnixMs: input.operation.plan.attempt.deadlineAtUnixMs,
      signal: input.signal,
      source: process.env
    }, async (session: GitReadSession) => {
    const identityLines = parseGitLineReply(completed(await session.run([
      'rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir',
      '--git-common-dir', '--show-object-format'
    ]), 'repository identity'), 4);
    if (identityLines === null) {
      throw new Error('Git candidate bundle repository identity is not exact Git line data.');
    }
    const [observedRoot, observedGitDirectory, observedCommonDirectory, objectFormat] = identityLines;
    if (observedRoot === undefined || observedGitDirectory === undefined
        || observedCommonDirectory === undefined
        || (objectFormat !== 'sha1' && objectFormat !== 'sha256')
        || ![observedRoot, observedGitDirectory, observedCommonDirectory].every(path.isAbsolute)) {
      throw new Error('Git candidate bundle repository identity is invalid.');
    }
    const sourceRoot = path.resolve(observedRoot);
    const gitDirectory = path.resolve(observedGitDirectory);
    const commonDirectory = path.resolve(observedCommonDirectory);
    if (sourceRoot !== input.sourceRoot
        || pathIsInside(sourceRoot, input.temporaryRoot)
        || pathIsInside(input.temporaryRoot, sourceRoot)
        || pathIsInside(gitDirectory, input.temporaryRoot)
        || pathIsInside(input.temporaryRoot, gitDirectory)
        || pathIsInside(commonDirectory, input.temporaryRoot)
        || pathIsInside(input.temporaryRoot, commonDirectory)) {
      throw new Error('Git candidate bundle source and temporary roots are not independent.');
    }
    const expectedLength = objectFormat === 'sha1' ? 40 : 64;
    if (input.baseSha.length !== expectedLength || input.headSha.length !== expectedLength) {
      throw new Error('Git candidate bundle revisions do not match the repository object format.');
    }
    for (const [label, revision] of [['base', input.baseSha], ['head', input.headSha]] as const) {
      const observed = parseGitObjectIdReply(completed(await session.run([
        'rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`
      ]), `${label} revision`), objectFormat);
      if (observed !== revision) {
        throw new Error(`Git candidate bundle ${label} revision is not the exact requested commit.`);
      }
    }
    const sourceChain = inspectNoFollowDirectoryChain(sourceRoot, 'Git candidate bundle source root');
    const gitDirectoryChain = inspectNoFollowDirectoryChain(
      gitDirectory,
      'Git candidate bundle git directory'
    );
    const commonDirectoryChain = inspectNoFollowDirectoryChain(
      commonDirectory,
      'Git candidate bundle common directory'
    );
    const retainedSources = retainUniqueDirectories([
      sourceChain,
      gitDirectoryChain,
      commonDirectoryChain
    ]);
    let bareCapability: RetainedNoFollowChildProcessDirectory | null = null;
    let retainedBundle: RetainedNoFollowOrdinaryFile | null = null;
    let publicationDigest: string | null = null;
    let provider: GitPhysicalProviderCapability | null = null;
    let providerReceipt: GitPhysicalProviderReceipt | null = null;
    let primary: PhysicalResourceSettlementFailure | undefined;
    try {
      requireAbsentTargets(input.temporaryRootIdentity);
      const executablePath = session.gitExecutableIdentity?.realPath;
      if (executablePath === undefined) {
        throw new Error('Git candidate bundle lacks one retained Git executable identity.');
      }
      const providerResolution = openGitPhysicalProvider({
        cwd: input.temporaryRoot,
        executablePath,
        operation: input.operation,
        processSession: input.processSession,
        environmentSource: process.env,
        maximumExecutableBytes: CANDIDATE_BUNDLE_EXECUTABLE_BYTES
      });
      if (providerResolution.status !== 'ready') {
        throw new Error(`Git candidate bundle physical provider is unavailable: ${providerResolution.reason}`);
      }
      provider = providerResolution.capability;
      assertGitPhysicalResourceAdmissionInternal(provider, {
        processes: 4,
        inputBytes: 0,
        outputBytes: CANDIDATE_BUNDLE_MAXIMUM_FILE_BYTES
          + 7 * CANDIDATE_BUNDLE_COMMAND_OUTPUT_BYTES
      });
      const sourceAuxiliary = [...retainedSources.values()].map((capability) => Object.freeze({
        capability,
        kind: 'directory' as const
      }));
      const createdBare = createExclusiveNoFollowDirectory(
        input.temporaryRootIdentity.target,
        CANDIDATE_BUNDLE_BARE_NAME
      );
      const bareChain = inspectNoFollowDirectoryChain(
        path.join(input.temporaryRoot, CANDIDATE_BUNDLE_BARE_NAME),
        'Git candidate bundle bare repository'
      );
      if (bareChain.target.device !== createdBare.device
          || bareChain.target.inode !== createdBare.inode) {
        throw new Error('Git candidate bundle bare repository changed after exclusive creation.');
      }
      bareCapability = retainNoFollowDirectoryForChildProcess(
        bareChain,
        8,
        'Git candidate bundle bare repository'
      );
      await runRequiredGitCommand(
        provider,
        ['init', '--bare', '--', bareCapability.childPath],
        'bare initialization',
        Object.freeze([
          ...sourceAuxiliary,
          Object.freeze({ capability: bareCapability, kind: 'directory' as const })
        ])
      );
      const directoryAuxiliary = Object.freeze([
        ...sourceAuxiliary,
        Object.freeze({ capability: bareCapability, kind: 'directory' as const })
      ]);
      await runRequiredGitCommand(provider, [
        '-c', 'protocol.file.allow=always',
        '-C', bareCapability.childPath,
        'fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules',
        retainedSources.get(commonDirectory)!.childPath,
        `${input.baseSha}:refs/sec/base`, `${input.headSha}:refs/sec/head`
      ], 'exact local fetch', directoryAuxiliary);
      const bundleBytes = await runRequiredGitCommand(provider, [
        '-C', bareCapability.childPath,
        'bundle', 'create', '-',
        'refs/sec/base', 'refs/sec/head'
      ], 'bundle creation', directoryAuxiliary, CANDIDATE_BUNDLE_MAXIMUM_FILE_BYTES);
      const publication = publishExclusiveDurableCanonicalFile({
        parent: input.temporaryRootIdentity.target,
        name: CANDIDATE_BUNDLE_FILE_NAME,
        bytes: bundleBytes,
        validate: (bytes) => {
          if (bytes.byteLength === 0
              || bytes.byteLength > CANDIDATE_BUNDLE_MAXIMUM_FILE_BYTES) {
            throw new Error('Git candidate bundle output exceeds its fixed byte domain.');
          }
        }
      });
      publicationDigest = publication.digest;
      const bundleParent = assertSameNoFollowDirectoryIdentity(
        input.temporaryRootIdentity.target,
        'Git candidate bundle output parent'
      );
      retainedBundle = retainNoFollowOrdinaryFile(
        bundleParent,
        CANDIDATE_BUNDLE_FILE_NAME,
        undefined,
        'Git candidate bundle output',
        9
      );
      await runRequiredGitCommand(provider, [
        '-C', bareCapability.childPath,
        'bundle', 'verify', retainedBundle.childPath
      ], 'bundle verification', Object.freeze([
        ...directoryAuxiliary,
        Object.freeze({ capability: retainedBundle, kind: 'ordinary-file' as const })
      ]));
      retainedBundle.assertCurrent();
      assertSameNoFollowDirectoryIdentity(sourceChain.target, 'Git candidate bundle source root');
      assertSameNoFollowDirectoryIdentity(gitDirectoryChain.target, 'Git candidate bundle git directory');
      assertSameNoFollowDirectoryIdentity(commonDirectoryChain.target, 'Git candidate bundle common directory');
    } catch (error) {
      primary = { label: 'git-candidate-bundle-materialization', error };
    }
    try {
      await settlePhysicalResourcesAsync({
        primary,
        cleanup: [
          ...(provider === null ? [] : [{
            label: 'git-candidate-bundle-physical-provider',
            settle: () => {
              providerReceipt = closeGitPhysicalProvider(provider!);
              assertGitPhysicalProviderReceipt(providerReceipt, provider!);
            }
          }]),
          ...(primary === undefined || retainedBundle === null ? [] : [{
            label: 'git-candidate-bundle-output-after-failure',
            settle: () => retainedBundle!.dispose()
          }]),
          ...(bareCapability === null ? [] : [{
            label: 'git-candidate-bundle-bare-repository',
            settle: () => bareCapability!.dispose()
          }]),
          ...[...retainedSources.values()].map((capability, index) => ({
            label: `git-candidate-bundle-source[${index}]`,
            settle: () => capability.dispose()
          }))
        ]
      });
    } catch (error) {
      if (primary === undefined && retainedBundle !== null) {
        settlePhysicalResources({
          primary: { label: 'git-candidate-bundle-materialization-settlement', error },
          cleanup: [{
            label: 'git-candidate-bundle-output-after-settlement-failure',
            settle: () => retainedBundle!.dispose()
          }]
        });
      }
      throw error;
    }
    if (retainedBundle === null || publicationDigest === null || providerReceipt === null) {
      throw new Error('Git candidate bundle materialization completed without retained output.');
    }
      pendingRetainedBundle = retainedBundle;
      return Object.freeze({
        retainedBundle,
        objectFormat,
        sourceIdentityDigest: sha256({
          sourceRoot: sourceChain.target,
          gitDirectory: gitDirectoryChain.target,
          commonDirectory: commonDirectoryChain.target
        }) as OperationDigest,
        publicationDigest,
        providerReceipt
      });
    });
  } catch (error) {
    if (pendingRetainedBundle !== null) {
      settlePhysicalResources({
        primary: { label: 'git-candidate-bundle-read-session-settlement', error },
        cleanup: [{
          label: 'git-candidate-bundle-output-after-read-session-settlement-failure',
          settle: () => pendingRetainedBundle!.dispose()
        }]
      });
    }
    throw error;
  }
}

export async function createGitCandidateBundle(input: Readonly<{
  readonly sourceRoot: string;
  readonly temporaryRoot: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly deadlineAtUnixMs?: number;
  readonly signal?: AbortSignal;
}>): Promise<GitCandidateBundle> {
  // Fix the child bound before preparation. The local cap may shorten the
  // inherited deadline, but no provider/readback phase may renew that pool.
  const startedAtUnixMs = Date.now();
  const inheritedDeadline = input.deadlineAtUnixMs;
  if (inheritedDeadline !== undefined && (!Number.isSafeInteger(inheritedDeadline)
      || inheritedDeadline <= startedAtUnixMs)) {
    throw new Error('Git candidate bundle inherited deadline is exhausted or invalid.');
  }
  const deadlineAtUnixMs = Math.min(inheritedDeadline ?? Number.MAX_SAFE_INTEGER,
    startedAtUnixMs + CANDIDATE_BUNDLE_DURATION_MS);
  const signal = linkNativeAbortSignals(input.signal);
  const assertWithinBound = (): void => {
    throwIfNativeAborted(signal);
    if (Date.now() >= deadlineAtUnixMs) throw new Error('Git candidate bundle deadline is exhausted.');
  };
  assertWithinBound();
  const sourceRoot = path.resolve(input.sourceRoot);
  const temporaryRoot = path.resolve(input.temporaryRoot);
  if (!path.isAbsolute(input.sourceRoot) || sourceRoot !== input.sourceRoot
      || !path.isAbsolute(input.temporaryRoot) || temporaryRoot !== input.temporaryRoot
      || !OBJECT_ID.test(input.baseSha) || !OBJECT_ID.test(input.headSha)) {
    throw new Error('Git candidate bundle input is not canonical.');
  }
  inspectNoFollowDirectoryChain(sourceRoot, 'Git candidate bundle source root');
  const temporaryRootIdentity = inspectNoFollowDirectoryChain(
    temporaryRoot,
    'Git candidate bundle temporary root'
  );
  if (pathIsInside(sourceRoot, temporaryRoot) || pathIsInside(temporaryRoot, sourceRoot)) {
    throw new Error('Git candidate bundle temporary root must be independent of its source.');
  }
  requireAbsentTargets(temporaryRootIdentity);
  const operation = compileCandidateBundleOperation({
    sourceRoot,
    temporaryRoot,
    baseSha: input.baseSha,
    headSha: input.headSha,
    deadlineAtUnixMs
  });
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: CANDIDATE_BUNDLE_REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    }),
    signal
  });
  let materialized: Awaited<ReturnType<typeof materializeCandidateBundle>> | null = null;
  let processReceipt: ProcessResourceSessionReceipt | null = null;
  const currentProcessReceipt = (): ProcessResourceSessionReceipt | null => processReceipt;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    materialized = await materializeCandidateBundle({
      sourceRoot,
      temporaryRoot,
      baseSha: input.baseSha,
      headSha: input.headSha,
      operation,
      processSession,
      temporaryRootIdentity,
      signal
    });
  } catch (error) {
    primary = { label: 'git-candidate-bundle-operation', error };
  }
  try {
    await settlePhysicalResourcesAsync({
      primary,
      cleanup: [{
        label: 'git-candidate-bundle-process-session',
        settle: () => {
          processReceipt = processSession.close();
          assertProcessResourceSessionReceipt(processReceipt, {
            operationIdentityDigest: operation.plan.identity.identityDigest,
            boundAttemptDigest: operation.boundAttemptDigest,
            requirementId: CANDIDATE_BUNDLE_REQUIREMENT
          });
        }
      }, ...(primary === undefined || materialized === null ? [] : [{
        label: 'git-candidate-bundle-retained-output-after-failure',
        settle: () => materialized!.retainedBundle.dispose()
      }])]
    });
  } catch (error) {
    if (primary === undefined && materialized !== null) {
      settlePhysicalResources({
        primary: { label: 'git-candidate-bundle-process-settlement', error },
        cleanup: [{
          label: 'git-candidate-bundle-output-after-process-settlement-failure',
          settle: () => materialized!.retainedBundle.dispose()
        }]
      });
    }
    throw error;
  }
  const settledProcessReceipt = currentProcessReceipt();
  if (materialized === null || settledProcessReceipt === null) {
    throw new Error('Git candidate bundle operation completed without exact settlement.');
  }
  try {
    assertWithinBound();
    materialized.retainedBundle.assertCurrent();
    const digest = materialized.retainedBundle.digest();
    const withoutIdentity = Object.freeze({
      bundlePath: materialized.retainedBundle.path,
      bundleSize: digest.size,
      bundleDigest: digest.byteDigest,
      baseSha: input.baseSha,
      headSha: input.headSha,
      objectFormat: materialized.objectFormat,
      sourceIdentityDigest: materialized.sourceIdentityDigest,
      providerReceiptDigest: materialized.providerReceipt.receiptDigest,
      publicationDigest: materialized.publicationDigest,
      processReceiptDigest: settledProcessReceipt.receiptDigest,
      operationIdentityDigest: operation.plan.identity.identityDigest
    });
    const bundle = Object.freeze({
      bundlePath: withoutIdentity.bundlePath,
      bundleSize: withoutIdentity.bundleSize,
      bundleDigest: withoutIdentity.bundleDigest,
      baseSha: withoutIdentity.baseSha,
      headSha: withoutIdentity.headSha,
      objectFormat: withoutIdentity.objectFormat,
      materializationIdentityDigest: sha256({
        domain: 'external-capabilities.git-bundle.materialization',
        materialization: withoutIdentity
      }) as OperationDigest
    });
    assertWithinBound();
    GIT_CANDIDATE_BUNDLE_STATES.set(bundle, {
      retainedBundle: materialized.retainedBundle,
      receipt: null,
      terminalFailure: undefined,
      hasTerminalFailure: false
    });
    return bundle;
  } catch (error) {
    settlePhysicalResources({
      primary: { label: 'git-candidate-bundle-capability-publication', error },
      cleanup: [{
        label: 'git-candidate-bundle-output-before-capability-publication',
        settle: () => materialized!.retainedBundle.dispose()
      }]
    });
    throw error;
  }
}

/** Borrow the original live input; a structural clone or terminal receipt cannot revive it. */
export function assertGitCandidateBundleCurrent(bundle: GitCandidateBundle): RetainedNoFollowOrdinaryFile {
  const state = GIT_CANDIDATE_BUNDLE_STATES.get(bundle);
  if (state === undefined || state.receipt !== null || state.hasTerminalFailure) {
    throw new Error('Git candidate bundle requires one current owner-issued retained capability.');
  }
  state.retainedBundle.assertCurrent();
  const digest = state.retainedBundle.digest();
  if (state.retainedBundle.path !== bundle.bundlePath
      || digest.size !== bundle.bundleSize || digest.byteDigest !== bundle.bundleDigest) {
    throw new Error('Git candidate bundle changed while borrowed.');
  }
  return state.retainedBundle;
}

export function closeGitCandidateBundle(bundle: GitCandidateBundle): GitCandidateBundleReceipt {
  const state = GIT_CANDIDATE_BUNDLE_STATES.get(bundle);
  if (state === undefined) {
    throw new Error('Git candidate bundle close requires one owner-issued retained capability.');
  }
  if (state.receipt !== null) return state.receipt;
  if (state.hasTerminalFailure) throw state.terminalFailure;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    state.retainedBundle.assertCurrent();
    const digest = state.retainedBundle.digest();
    if (state.retainedBundle.path !== bundle.bundlePath
        || digest.size !== bundle.bundleSize
        || digest.byteDigest !== bundle.bundleDigest) {
      throw new Error('Git candidate bundle changed before terminal release.');
    }
  } catch (error) {
    primary = { label: 'git-candidate-bundle-terminal-readback', error };
  }
  try {
    settlePhysicalResources({
      primary,
      cleanup: [{
        label: 'git-candidate-bundle-retained-output',
        settle: () => state.retainedBundle.dispose()
      }]
    });
  } catch (error) {
    state.terminalFailure = error;
    state.hasTerminalFailure = true;
    throw error;
  }
  const withoutDigest = Object.freeze({
    schema: 'sec-git-candidate-bundle-receipt-v1' as const,
    materializationIdentityDigest: bundle.materializationIdentityDigest,
    bundlePath: bundle.bundlePath,
    bundleSize: bundle.bundleSize,
    bundleDigest: bundle.bundleDigest,
    baseSha: bundle.baseSha,
    headSha: bundle.headSha,
    terminal: 'released' as const
  });
  state.receipt = Object.freeze({
    ...withoutDigest,
    receiptDigest: sha256({
      domain: 'external-capabilities.git-bundle.receipt',
      receipt: withoutDigest
    }) as OperationDigest
  });
  ISSUED_GIT_CANDIDATE_BUNDLE_RECEIPTS.add(state.receipt);
  return state.receipt;
}

export function assertGitCandidateBundleReceipt(
  receipt: GitCandidateBundleReceipt,
  bundle: GitCandidateBundle
): void {
  const state = GIT_CANDIDATE_BUNDLE_STATES.get(bundle);
  if (state === undefined
      || state.receipt !== receipt
      || !ISSUED_GIT_CANDIDATE_BUNDLE_RECEIPTS.has(receipt)
      || receipt.materializationIdentityDigest !== bundle.materializationIdentityDigest
      || receipt.bundlePath !== bundle.bundlePath
      || receipt.bundleDigest !== bundle.bundleDigest
      || receipt.bundleSize !== bundle.bundleSize
      || receipt.baseSha !== bundle.baseSha
      || receipt.headSha !== bundle.headSha) {
    throw new Error('Git candidate bundle receipt is not one exact owner-issued terminal settlement.');
  }
}


/** A private Git data borrower, never an execution or publication authority. */
export type GitCandidateCheckout = Readonly<{
  candidateRoot: string;
  purpose: CandidateCheckoutPurpose;
  baseSha: string;
  headSha: string;
  headTreeSha: string;
}>;
const GIT_CANDIDATE_CHECKOUTS = new WeakMap<GitCandidateCheckout, Readonly<{
  current(): void;
  recordCleanupUnknown(): void;
  read(root: string, args: readonly string[]): Promise<Readonly<{ code: number; stdout: Uint8Array; stderr: string }>>;
  materializeTransport(): Promise<void>;
  recipeIssuer?: ProcessResourceCommandIssuer;
  recipeBinding?: ProcessResourceCommandBinding;
  runRecipe(command: BoundProcessResourceCommand): Promise<Readonly<{ code: number; stdout: Uint8Array; stderr: string }>>;
}>>();
const CHECKOUT_MAXIMUM_ENTRIES = 200_000;
const CHECKOUT_MAXIMUM_BYTES = 128 * 1024 * 1024;
type CandidateCheckoutPurpose = 'activation-static' | 'action-materialization';

/** Diagnostic custody only. A copied recovery record cannot adopt or retire a generation. */
export class GitCandidateCheckoutCleanupUnknownError extends Error {
  readonly code = 'git-candidate-checkout-cleanup-unknown' as const;
  constructor(readonly recovery: Readonly<{
    generation: PhysicalDirectoryIdentity; parent: PhysicalDirectoryIdentity;
    baseSha: string; headSha: string; purpose: CandidateCheckoutPurpose; deadlineAtUnixMs: number;
  }>, readonly failure: unknown) {
    super('Private candidate checkout retirement is unresolved; preserve its exact generation.', { cause: failure });
    this.name = 'GitCandidateCheckoutCleanupUnknownError';
  }
}

/** Tree expansion is bounded before checkout; gitlinks and reserved inputs never enter the generation. */
export function assertGitCandidateCheckoutTreeInventory(source: string): void {
  if (source === '') return;
  if (!source.endsWith('\0')) throw new Error('Private candidate tree inventory is truncated.');
  const entries = source.slice(0, -1).split('\0');
  if (entries.length > CHECKOUT_MAXIMUM_ENTRIES) throw new Error('Private candidate tree entry bound exceeded.');
  const names = new Set<string>(), directories = new Set<string>();
  let bytes = 0;
  for (const entry of entries) {
    const parsed = /^(100644|100755|120000) blob ((?:[0-9a-f]{40}|[0-9a-f]{64})) +([0-9]+)\t([^\0]+)$/u.exec(entry);
    if (parsed === null) throw new Error('Private candidate tree contains an unsupported entry.');
    const name = parsed[4]!, parts = name.split('/');
    if (Buffer.byteLength(name, 'utf8') > 4096 || names.has(name) || directories.has(name)
        || parts.some(part => part === '' || part === '.' || part === '..' || part === '.git')
        || parts[0] === '.sec-trusted-input' || parts[0] === 'node_modules') {
      throw new Error('Private candidate tree has a noncanonical or reserved path.');
    }
    names.add(name);
    let prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix === '' ? part : `${prefix}/${part}`;
      if (names.has(prefix)) throw new Error('Private candidate tree has a file/directory collision.');
      directories.add(prefix);
    }
    bytes += Number(parsed[3]);
    if (names.size + directories.size > CHECKOUT_MAXIMUM_ENTRIES
        || !Number.isSafeInteger(bytes) || bytes > CHECKOUT_MAXIMUM_BYTES) {
      throw new Error('Private candidate tree expansion bound exceeded.');
    }
  }
}

/** Only the original still-open checkout can validate its retained input lifetime. */
export function assertGitCandidateCheckoutCurrent(checkout: GitCandidateCheckout): void {
  const current = GIT_CANDIDATE_CHECKOUTS.get(checkout);
  if (current === undefined) throw new Error('Private candidate checkout requires its live original scope.');
  current.current();
}


/** Cleanup failure can only revoke this original borrower's retirement. It
 * cannot issue a positive receipt or affect another checkout generation. The
 * membership check remains usable during cancellation-driven closeout. */
export function recordGitCandidateCheckoutCleanupUnknown(checkout: GitCandidateCheckout, failure: unknown): void {
  const owner = GIT_CANDIDATE_CHECKOUTS.get(checkout);
  if (owner === undefined || checkout.purpose !== 'action-materialization'
      || !isResourceCompositeSettlementError(failure)) {
    throw new Error('Checkout cleanup revocation requires its original borrower and settlement-owner failure.');
  }
  owner.recordCleanupUnknown();
}

/** The original read grammar cannot select a network command, helper or another repository. */
export function readGitCandidateCheckout(checkout: GitCandidateCheckout, root: string, args: readonly string[]) {
  assertGitCandidateCheckoutCurrent(checkout);
  return GIT_CANDIDATE_CHECKOUTS.get(checkout)!.read(root, args);
}

/** One closed write recipe: the two original refs and already-issued immutable bundle. */
export function materializeGitCandidateCheckoutTransport(checkout: GitCandidateCheckout): Promise<void> {
  assertGitCandidateCheckoutCurrent(checkout);
  if (checkout.purpose !== 'action-materialization') throw new Error('Static checkout cannot materialize archive transport.');
  return GIT_CANDIDATE_CHECKOUTS.get(checkout)!.materializeTransport();
}

/** The real trusted composition selects the materializer's private issuer before
 * candidate data is read. Only that issuer's issue closure can use this binding. */
export function gitCandidateCheckoutRecipeBinding(checkout: GitCandidateCheckout,
  issuer: ProcessResourceCommandIssuer): ProcessResourceCommandBinding {
  assertGitCandidateCheckoutCurrent(checkout);
  const state = GIT_CANDIDATE_CHECKOUTS.get(checkout)!;
  if (checkout.purpose !== 'action-materialization' || state.recipeIssuer !== issuer || state.recipeBinding === undefined) {
    throw new Error('Private candidate recipe issuer differs from the original materializer composition.');
  }
  return state.recipeBinding;
}

export function runGitCandidateCheckoutRecipe(checkout: GitCandidateCheckout, command: BoundProcessResourceCommand) {
  assertGitCandidateCheckoutCurrent(checkout);
  if (checkout.purpose !== 'action-materialization') throw new Error('Static checkout has no archive recipe execution.');
  return GIT_CANDIDATE_CHECKOUTS.get(checkout)!.runRecipe(command);
}

/**
 * Reuse the native bundle owner, then materialize one independent Git checkout.
 * The trusted callback must join its borrowers before returning. This scope
 * issues no origin, Action, candidate execution, or external publication right.
 */
export async function withGitCandidateCheckout<T>(input: Readonly<{
  sourceRoot: string; trustedRoot?: string; baseSha: string; headSha: string;
  purpose: CandidateCheckoutPurpose; deadlineAtUnixMs: number; signal?: AbortSignal;
  archiveRecipeIssuer?: ProcessResourceCommandIssuer;
}>, callback: (checkout: GitCandidateCheckout) => Promise<T>): Promise<T> {
  const { sourceRoot, baseSha, headSha, purpose, deadlineAtUnixMs: parentDeadline, signal: parentSignal } = input;
  if (!path.isAbsolute(sourceRoot) || path.resolve(sourceRoot) !== sourceRoot
      || !OBJECT_ID.test(baseSha) || !OBJECT_ID.test(headSha) || baseSha.length !== headSha.length
      || (purpose !== 'activation-static' && purpose !== 'action-materialization')
      || !Number.isSafeInteger(parentDeadline) || parentDeadline <= Date.now()
      || typeof callback !== 'function') throw new Error('Private candidate checkout input or inherited deadline is invalid.');
  const use = callback;
  const trustedRoot = input.trustedRoot ?? sourceRoot;
  const recipeIssuer = input.archiveRecipeIssuer;
  if (!path.isAbsolute(trustedRoot) || path.resolve(trustedRoot) !== trustedRoot
      || (purpose !== 'action-materialization' && recipeIssuer !== undefined)) {
    throw new Error('Private checkout trusted root or archive composition is invalid.');
  }
  const deadlineAtUnixMs = Math.min(parentDeadline, Date.now() + CANDIDATE_BUNDLE_DURATION_MS);
  const deadlineAtMonotonicMs = performance.now() + deadlineAtUnixMs - Date.now();
  const signal = linkNativeAbortSignals(parentSignal);
  const withinBound = (): void => {
    throwIfNativeAborted(signal);
    if (Date.now() >= deadlineAtUnixMs || performance.now() >= deadlineAtMonotonicMs) {
      throw new Error('Private candidate checkout inherited deadline is exhausted.');
    }
  };
  withinBound();
  const trustedIdentity = inspectNoFollowDirectoryChain(trustedRoot, 'Private checkout trusted source').target;
  const sourceEnvironment = Object.freeze({ PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' });
  const preflight = await withAuthorityGitReadSession({ cwd: sourceRoot, deadlineAtUnixMs, signal,
    source: sourceEnvironment, budget: {
      ...GIT_READ_BUDGET, maxProcesses: 4, maxRecords: CHECKOUT_MAXIMUM_ENTRIES + 8,
      maxStdoutBytes: 16 * 1024 * 1024, maxCommandStdoutBytes: 16 * 1024 * 1024
    } }, async git => {
    for (const revision of [baseSha, headSha]) {
      withinBound();
      const observed = completed(await git.run(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]), 'checkout commit');
      withinBound();
      if (Buffer.from(observed).toString('utf8') !== `${revision}\n`) throw new Error('Private candidate checkout commit differs.');
    }
    const tree = Buffer.from(completed(await git.run(['rev-parse', '--verify', '--end-of-options', `${headSha}^{tree}`]), 'checkout tree')).toString('utf8');
    withinBound();
    if (!new RegExp(`^[0-9a-f]{${headSha.length}}\\n$`, 'u').test(tree)) throw new Error('Private candidate checkout tree is not exact.');
    const inventory = completed(await git.run(['ls-tree', '-r', '-l', '-z', '--full-tree', headSha]), 'checkout inventory');
    withinBound();
    assertGitCandidateCheckoutTreeInventory(new TextDecoder('utf-8', { fatal: true }).decode(inventory));
    if (git.gitExecutableIdentity == null) throw new Error('Private candidate checkout lacks retained Git.');
    return Object.freeze({ tree: tree.trim(), executablePath: git.gitExecutableIdentity!.realPath });
  });
  withinBound();
  const parent = inspectNoFollowDirectoryChain(tmpdir(), 'Private candidate checkout parent').target;
  let generation: PhysicalDirectoryIdentity | undefined;
  let bundle: GitCandidateBundle | undefined;
  let directory: RetainedNoFollowChildProcessDirectory | undefined;
  let gitDirectory: RetainedNoFollowChildProcessDirectory | undefined;
  let config: RetainedNoFollowOrdinaryFile | undefined;
  let provider: GitPhysicalProviderCapability | undefined;
  const readProviders = new Map<string, GitPhysicalProviderCapability>();
  let readProvidersSettled = false;
  let trustedReadSession: GitReadSession | undefined;
  let trustedObservation: GitIsolatedWorktreeObservation | undefined;
  let trustedObservationSettled = true;
  let trustedReadSessionSettled = true;
  let borrowerCleanupUnknown = false;
  let checkout: GitCandidateCheckout | undefined;
  let recipeBinding: ProcessResourceCommandBinding | undefined;
  let checkRetained: (() => void) | undefined;
  let bundleAttempted = false, bundleSettled = false, providerSettled = false, processesSettled = false;
  let directorySettled = false, gitDirectorySettled = false, configSettled = false, retired = false;
  let primary: PhysicalResourceSettlementFailure | undefined;
  let result!: T;
  // This is the original bundle provider's fixed process operation; the child
  // creation and checkout share the same unrenewable inherited time bound.
  const operation = compileCandidateBundleOperation({ sourceRoot, temporaryRoot: parent.path,
    baseSha, headSha, deadlineAtUnixMs, checkoutPurpose: purpose });
  const processes = openProcessResourceSession({ operation, signal,
    requirementBindingContext: issueOperationRequirementBindingContext({ operation,
      requirementId: CANDIDATE_BUNDLE_REQUIREMENT, resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  const currentRoots = (): void => {
    withinBound();
    if (generation !== undefined) assertSameNoFollowDirectoryIdentity(generation);
    assertSameNoFollowDirectoryIdentity(trustedIdentity);
    if (provider !== undefined) assertGitPhysicalProviderCurrentInternal(provider);
    for (const retained of readProviders.values()) assertGitPhysicalProviderCurrentInternal(retained);
    directory?.assertCurrent(); gitDirectory?.assertCurrent(); config?.assertCurrent();
    if (bundle !== undefined) assertGitCandidateBundleCurrent(bundle);
  };
  const run = async (args: readonly string[]): Promise<string> => {
    currentRoots();
    const result = await runGitPhysicalCommandInternal(provider!, [
      '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false',
      '-c', `core.attributesFile=${devNull}`, '-c', 'core.autocrlf=false',
      '-c', 'core.logAllRefUpdates=false', ...args
    ], { env: provider!.environment, envMode: 'replace', maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024 }, [
      ...(directory === undefined ? [] : [{ capability: directory, kind: 'directory' as const }]),
      { capability: assertGitCandidateBundleCurrent(bundle!), kind: 'ordinary-file' as const }
    ]);
    currentRoots();
    if (result.result.code !== 0) throw new Error('Private candidate Git materialization failed.');
    return new TextDecoder('utf-8', { fatal: true }).decode(result.result.stdout);
  };
  try {
    generation = createExclusiveNoFollowRandomDirectory(parent, 'sec-private-candidate-');
    bundleAttempted = true;
    bundle = await createGitCandidateBundle({ sourceRoot, temporaryRoot: generation.path,
      baseSha, headSha, deadlineAtUnixMs, signal });
    currentRoots();
    const resolution = openGitPhysicalProvider({ cwd: generation.path, executablePath: preflight.executablePath,
      operation, processSession: processes, maximumExecutableBytes: CANDIDATE_BUNDLE_EXECUTABLE_BYTES,
      environmentSource: sourceEnvironment });
    if (resolution.status !== 'ready') throw new Error('Private candidate Git provider is unavailable.');
    provider = resolution.capability;
    const root = createExclusiveNoFollowDirectory(generation, 'candidate');
    directory = retainNoFollowDirectoryForChildProcess(assertSameNoFollowDirectoryIdentity(root), 5, 'Private candidate checkout');
    await run(['init', '--quiet', '--template=', `--object-format=${bundle.objectFormat}`, '--', directory.childPath]);
    await run(['-C', directory.childPath, '-c', 'protocol.file.allow=always', 'fetch', '--quiet',
      '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', assertGitCandidateBundleCurrent(bundle).childPath,
      'refs/sec/base:refs/heads/input-base', 'refs/sec/head:refs/heads/input-head']);
    await run(['-C', directory.childPath, 'checkout', '--quiet', '--detach', headSha]);
    await run(['-C', directory.childPath, 'update-ref', '-d', 'refs/heads/input-base', baseSha]);
    await run(['-C', directory.childPath, 'update-ref', '-d', 'refs/heads/input-head', headSha]);
    const identity = await run(['-C', directory.childPath, 'rev-parse', '--path-format=absolute',
      '--show-toplevel', '--absolute-git-dir', '--git-common-dir', 'HEAD', 'HEAD^{tree}']);
    if (identity !== `${root.path}\n${root.path}/.git\n${root.path}/.git\n${headSha}\n${preflight.tree}\n`
        || await run(['-C', directory.childPath, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']) !== ''
        || await run(['-C', directory.childPath, 'for-each-ref', '--format=%(refname) %(objectname)']) !== '') {
      throw new Error('Private candidate checkout is not one clean independent Git identity.');
    }
    const gitChain = inspectNoFollowDirectoryChain(path.join(root.path, '.git'), 'Private candidate Git directory');
    gitDirectory = retainNoFollowDirectoryForChildProcess(gitChain, 6, 'Private candidate Git directory');
    config = retainNoFollowOrdinaryFile(gitChain, 'config', undefined, 'Private candidate Git config', 7);
    const configDigest = config.digest().byteDigest;
    const rootModes = (): string => sha256([generation!, root, gitChain.target].map(target => {
      assertSameNoFollowDirectoryIdentity(target);
      const observed = lstatSync(target.path, { bigint: true });
      if (!observed.isDirectory() || String(observed.dev) !== target.device || String(observed.ino) !== target.inode) {
        throw new Error('Private candidate permission observation lost its retained root.');
      }
      assertSameNoFollowDirectoryIdentity(target);
      return { objectId: target.objectId, mode: process.platform === 'win32' ? null : Number(observed.mode & 0o7777n) };
    }));
    const rootModeDigest = rootModes();
    const snapshot = (target: PhysicalDirectoryIdentity, exclusions: readonly string[]): string => sha256(
      scanNoFollowDirectoryTreeInventory(target, { deadlineAtMs: deadlineAtMonotonicMs,
        maximumEntries: CHECKOUT_MAXIMUM_ENTRIES, maximumBytes: CHECKOUT_MAXIMUM_BYTES,
        includePermissionMode: true, excludeRelativePaths: exclusions, signal }).map(entry => entry.kind === 'directory' ? { ...entry, size: 0 } : entry));
    const sourceDigest = snapshot(root, ['.git', '.sec-trusted-input']);
    const gitDigest = snapshot(gitChain.target, ['refs/sec']);
    // These are the existing hosted archive materializer's exact transport
    // members and refs, never a caller-supplied ignore list or arbitrary writes.
    const reserved = (target: PhysicalDirectoryIdentity, name: string, members: readonly string[], refs = false): void => {
      const present = inspectNoFollowDirectoryLeaf(target, name, 'Private candidate reserved transport');
      if (present === null) return;
      if (purpose !== 'action-materialization') throw new Error('Static candidate acquired materializer residue.');
      const entries = scanNoFollowDirectoryTreeMetadata(present, { deadlineAtMs: deadlineAtMonotonicMs,
        maximumEntries: members.length, maximumBytes: CHECKOUT_MAXIMUM_BYTES, signal });
      for (const entry of entries) {
        if (entry.kind !== 'file' || !members.includes(entry.relativePath)) throw new Error('Private candidate reserved transport has foreign entries.');
        if (refs) {
          const bytes = readNoFollowOrdinaryFile(present, entry.relativePath, { maximumBytes: 128 });
          const expected = entry.relativePath === 'base' ? baseSha : headSha;
          if (bytes === null || Buffer.from(bytes).toString('utf8') !== `${expected}\n`) throw new Error('Private candidate reserved ref drifted.');
        }
      }
    };
    checkRetained = (): void => {
      currentRoots();
      if (rootModes() !== rootModeDigest || config!.digest().byteDigest !== configDigest || snapshot(root, ['.git', '.sec-trusted-input']) !== sourceDigest
          || snapshot(gitChain.target, ['refs/sec']) !== gitDigest) throw new Error('Private candidate retained source or Git metadata drifted.');
      reserved(root, '.sec-trusted-input', ['candidate.bundle', 'dependency-closure.json']);
      reserved(inspectNoFollowDirectoryChain(path.join(root.path, '.git', 'refs')).target, 'sec', ['base', 'head'], true);
      currentRoots();
    };
    // Admit both observation roots before handing control to the borrower. Each
    // provider retains the original selected executable and environment, shares
    // the checkout process ledger, and remains owned by this enclosing lifetime.
    for (const cwd of new Set([root.path, trustedRoot])) {
      currentRoots();
      const resolution = openGitPhysicalProvider({ cwd, executablePath: provider.identity.executablePath,
        operation, processSession: processes, environment: provider.environment, environmentSource: {},
        maximumExecutableBytes: CANDIDATE_BUNDLE_EXECUTABLE_BYTES });
      if (resolution.status !== 'ready') throw new Error('Private candidate retained read provider is unavailable.');
      const retained = resolution.capability;
      readProviders.set(cwd, retained);
      currentRoots();
      if (retained.identity.executablePath !== provider.identity.executablePath
          || retained.identity.executablePhysical.device !== provider.identity.executablePhysical.device
          || retained.identity.executablePhysical.inode !== provider.identity.executablePhysical.inode
          || retained.identity.executableSize !== provider.identity.executableSize
          || retained.identity.executableDigest !== provider.identity.executableDigest
          || retained.identity.environmentDigest !== provider.identity.environmentDigest) {
        throw new Error('Private candidate read provider differs from its original acquisition.');
      }
    }
    // Admit the real trusted root once before the borrower runs. Its content
    // observations retain the actual HEAD/index/worktree but use only private
    // metadata/config, so repository filter definitions cannot reach Git's
    // conversion execution path. The original operation owns every child.
    const trustedProvider = readProviders.get(trustedRoot)!;
    trustedReadSessionSettled = false;
    const trustedReadResolution = createAuthorityGitReadSession({ cwd: trustedRoot, operation,
      processSession: processes, physicalProvider: trustedProvider,
      environment: trustedProvider.environment, source: {}, deadlineAtUnixMs, signal,
      budget: { ...GIT_READ_BUDGET, maxProcesses: 128, maxRecords: CHECKOUT_MAXIMUM_ENTRIES,
        maxTotalArgumentBytes: 16 * 1024 * 1024, maxStdoutBytes: CHECKOUT_MAXIMUM_BYTES,
        maxCommandStdoutBytes: CHECKOUT_MAXIMUM_BYTES }
    });
    if (trustedReadResolution.status !== 'ready') throw new Error('Trusted root retained read session is unavailable.');
    trustedReadSession = trustedReadResolution.session;
    const trustedHead = Buffer.from(completed(await trustedReadSession.run([
      'rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'
    ]), 'trusted root HEAD')).toString('utf8');
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})\n$/u.test(trustedHead)) {
      throw new Error('Private checkout trusted root does not have one exact HEAD.');
    }
    trustedObservationSettled = false;
    try {
      trustedObservation = await createAuthorityGitIsolatedWorktreeObservation({
        gitReadSession: trustedReadSession, parent: generation, expectedHead: trustedHead.trim()
      });
    } catch (error) {
      // A rejected supported-domain admission may have fully settled itself;
      // unknown cleanup keeps the enclosing generation in recovery custody.
      trustedObservationSettled = !isGitIsolatedWorktreeCleanupUnknown(error);
      throw error;
    }
    checkout = Object.freeze({ candidateRoot: root.path, purpose, baseSha, headSha, headTreeSha: preflight.tree });
    const scope = checkout;
    recipeBinding = recipeIssuer === undefined ? undefined : bindProcessResourceCommandIssuer(processes, recipeIssuer);
    GIT_CANDIDATE_CHECKOUTS.set(scope, Object.freeze({ current: checkRetained,
      recordCleanupUnknown: () => { borrowerCleanupUnknown = true; },
      ...(recipeBinding === undefined ? {} : { recipeIssuer, recipeBinding }),
      read: async (requestedRoot, inputArgs) => {
        assertGitCandidateCheckoutCurrent(scope);
        const captured = captureGitReadArguments(inputArgs, 128 * 1024);
        if ((requestedRoot !== root.path && requestedRoot !== trustedRoot) || captured.status !== 'ready'
            || !gitReadCommandIsObservation(captured.args, { fixedRoot: true,
              commands: ['rev-parse', 'cat-file', 'merge-base', 'status', 'diff', 'ls-tree', 'symbolic-ref', 'show'] })) {
          throw new Error('Private checkout read is outside its fixed roots and observation grammar.');
        }
        if (requestedRoot === trustedRoot && gitReadCommandIsObservation(captured.args, {
          fixedRoot: true, commands: ['status', 'diff', 'show']
        })) {
          const result = await trustedObservation!.read(captured.args);
          assertGitCandidateCheckoutCurrent(scope);
          return result;
        }
        const retained = readProviders.get(requestedRoot)!;
        const result = await withAuthorityGitReadSession({ cwd: requestedRoot, operation, processSession: processes,
          physicalProvider: retained, environment: retained.environment, source: {}, deadlineAtUnixMs, signal,
          budget: { ...GIT_READ_BUDGET, maxProcesses: 1, maxRecords: CHECKOUT_MAXIMUM_ENTRIES,
            maxStdoutBytes: CHECKOUT_MAXIMUM_BYTES, maxCommandStdoutBytes: CHECKOUT_MAXIMUM_BYTES }
        }, async read => {
          const observation = await read.run([...GIT_READ_LOCAL_HELPER_SUPPRESSION, ...captured.args]);
          assertGitCandidateCheckoutCurrent(scope);
          if (observation.kind !== 'completed') throw new Error('Private candidate read did not settle.');
          return observation.result;
        });
        assertGitCandidateCheckoutCurrent(scope);
        return result;
      },
      materializeTransport: async () => {
        assertGitCandidateCheckoutCurrent(scope);
        if (purpose !== 'action-materialization') throw new Error('Private candidate transport purpose is invalid.');
        const parent = inspectNoFollowDirectoryChain(path.join(root.path, '.sec-trusted-input')).target;
        const bytes = assertGitCandidateBundleCurrent(bundle!).readBytes();
        publishExclusiveDurableCanonicalFile({ parent, name: 'candidate.bundle', bytes,
          validate: observed => { if (!Buffer.from(observed).equals(bytes)) throw new Error('Private bundle projection drifted.'); } });
        await run(['-C', directory!.childPath, 'update-ref', 'refs/sec/base', baseSha]);
        assertGitCandidateCheckoutCurrent(scope);
        await run(['-C', directory!.childPath, 'update-ref', 'refs/sec/head', headSha]);
        assertGitCandidateCheckoutCurrent(scope);
      },
      runRecipe: async command => {
        assertGitCandidateCheckoutCurrent(scope);
        if (recipeBinding === undefined) throw new Error('Private candidate has no original archive recipe binding.');
        const result = await runBoundProcessResourceCommand(processes, recipeBinding, command);
        assertGitCandidateCheckoutCurrent(scope);
        return result.result;
      }
    }));
    assertGitCandidateCheckoutCurrent(checkout);
    result = await use(checkout);
  } catch (error) { primary = { label: 'git-candidate-checkout', error }; }
  if (checkout !== undefined) GIT_CANDIDATE_CHECKOUTS.delete(checkout);
  try {
    await settlePhysicalResourcesAsync({ primary, cleanup: [
      { label: 'git-candidate-checkout-final-readback', settle: () => checkRetained?.() },
      { label: 'git-candidate-checkout-unstarted-recipes', settle: () => {
        if (recipeBinding !== undefined) releasePreparedProcessResourceCommands(processes, recipeBinding);
      } },
      { label: 'git-candidate-checkout-trusted-observation', settle: async () => {
        if (trustedObservation !== undefined) {
          try { await trustedObservation.close(); trustedObservationSettled = true; }
          catch (error) {
            trustedObservationSettled = !isGitIsolatedWorktreeCleanupUnknown(error);
            throw error;
          }
        }
      } },
      { label: 'git-candidate-checkout-trusted-read-session', settle: async () => {
        if (trustedReadSession !== undefined) {
          if (typeof trustedReadSession.close !== 'function') throw new Error('Trusted root read session lacks its close owner.');
          assertGitReadSessionReceipt(await trustedReadSession.close(), {
            operationIdentityDigest: operation.plan.identity.identityDigest,
            boundAttemptDigest: operation.boundAttemptDigest, requirementId: CANDIDATE_BUNDLE_REQUIREMENT
          });
        }
        trustedReadSessionSettled = true;
      } },
      { label: 'git-candidate-checkout-read-providers', settle: () => {
        settlePhysicalResources({ cleanup: [...readProviders.values()].map(retained => ({
          label: `git-candidate-checkout-read-provider:${retained.cwd}`,
          settle: () => assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(retained), retained)
        })) });
        readProvidersSettled = true;
      } },
      { label: 'git-candidate-checkout-provider', settle: () => {
        if (provider !== undefined) assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(provider), provider);
        providerSettled = true;
      } },
      { label: 'git-candidate-checkout-processes', settle: () => {
        assertProcessResourceSessionReceipt(processes.close(), { operationIdentityDigest: operation.plan.identity.identityDigest,
          boundAttemptDigest: operation.boundAttemptDigest, requirementId: CANDIDATE_BUNDLE_REQUIREMENT });
        processesSettled = true;
      } },
      { label: 'git-candidate-checkout-config', settle: () => { config?.dispose(); configSettled = true; } },
      { label: 'git-candidate-checkout-git-directory', settle: () => { gitDirectory?.dispose(); gitDirectorySettled = true; } },
      { label: 'git-candidate-checkout-directory', settle: () => { directory?.dispose(); directorySettled = true; } },
      { label: 'git-candidate-checkout-bundle', settle: () => {
        if (bundle !== undefined) { assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle); bundleSettled = true; }
      } },
      { label: 'git-candidate-checkout-generation', settle: () => {
        if (generation === undefined) return;
        if (borrowerCleanupUnknown || !trustedObservationSettled || !trustedReadSessionSettled || !readProvidersSettled
            || !providerSettled || !processesSettled || !directorySettled || !gitDirectorySettled || !configSettled
            || (bundleAttempted && !bundleSettled)) throw new Error('Private candidate borrowers have unsettled resources.');
        const root = assertSameNoFollowDirectoryIdentity(generation).target;
        const inventory = scanNoFollowDirectoryTreeMetadata(root, { deadlineAtMs: deadlineAtMonotonicMs,
          maximumEntries: CHECKOUT_MAXIMUM_ENTRIES * 3 });
        retireNoFollowDirectoryTree({ parent, root, inventory, deadlineAtMonotonicMs });
        retired = true;
      } }
    ] });
  } catch (failure) {
    if (generation !== undefined && !retired) throw new GitCandidateCheckoutCleanupUnknownError(Object.freeze({
      generation, parent, baseSha, headSha, purpose, deadlineAtUnixMs
    }), failure);
    throw failure;
  }
  return result;
}
