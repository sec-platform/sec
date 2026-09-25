import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources, settleResourcesAsync as settlePhysicalResourcesAsync, type ResourceSettlementFailure as PhysicalResourceSettlementFailure } from '../../../execution/resource-settlement.ts';
import {
  parseGitLineReply,
  parseGitObjectIdReply
} from '../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowDirectory,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import { withAuthorityGitReadSession } from '../git-read/authority.ts';
import type { GitReadSession, GitReadSessionCommand } from '../git-read/runtime/session.ts';
import {
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
const BUNDLE_INSPECTION_OPERATION = 'external-capabilities.git-bundle.inspect';
const BUNDLE_INSPECTION_REQUIREMENT = 'git-bundle.inspect-host-process';
const BUNDLE_INSPECTION_CONTRACT = sha256({
  operation: BUNDLE_INSPECTION_OPERATION,
  source: 'caller-supplied-bundle-bytes-v1',
  effect: 'temporary-retained-bundle-inspection-v1',
  output: 'verified-bundle-heads-v1'
}) as OperationDigest;
const BUNDLE_INSPECTION_PROCESS_PROVIDER = sha256({
  provider: 'runtime-state.physical.process-resource-session',
  consumer: BUNDLE_INSPECTION_OPERATION
}) as OperationDigest;
const BUNDLE_INSPECTION_FILE_NAME = 'observed.bundle';
const BUNDLE_INSPECTION_MAXIMUM_FILE_BYTES = 16 * 1024 * 1024;
const BUNDLE_INSPECTION_OUTPUT_BYTES = 512 * 1024;
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
const BUNDLE_INSPECTION_MAXIMUM_PROCESSES = GIT_READ_BUDGET.maxProcesses + 2;
const BUNDLE_INSPECTION_MAXIMUM_OUTPUT_BYTES = GIT_READ_BUDGET.maxStdoutBytes
  + GIT_READ_BUDGET.maxStderrBytes
  + 2 * (BUNDLE_INSPECTION_OUTPUT_BYTES + CANDIDATE_BUNDLE_COMMAND_OUTPUT_BYTES);

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

export type GitBundleInspection = Readonly<{
  readonly bundleDigest: `sha256:${string}`;
  readonly heads: readonly Readonly<{
    readonly objectId: string;
    readonly reference: string;
  }>[];
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
}>): BoundSemanticOperation {
  const plan = compileSemanticOperationPlan({
    operation: CANDIDATE_BUNDLE_OPERATION,
    intentDigest: sha256({
      sourceRoot: input.sourceRoot,
      temporaryRoot: input.temporaryRoot,
      baseSha: input.baseSha,
      headSha: input.headSha,
      bareName: CANDIDATE_BUNDLE_BARE_NAME,
      bundleName: CANDIDATE_BUNDLE_FILE_NAME
    }) as OperationDigest,
    decisionDigest: CANDIDATE_BUNDLE_CONTRACT,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: CANDIDATE_BUNDLE_CONTRACT
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: CANDIDATE_BUNDLE_DURATION_MS },
      { resource: 'input-bytes', maximum: CANDIDATE_BUNDLE_MAXIMUM_INPUT_BYTES },
      { resource: 'output-bytes', maximum: CANDIDATE_BUNDLE_MAXIMUM_OUTPUT_BYTES },
      { resource: 'processes', maximum: CANDIDATE_BUNDLE_MAXIMUM_PROCESSES }
    ],
    requirements: [{
      id: CANDIDATE_BUNDLE_REQUIREMENT,
      contractDigest: CANDIDATE_BUNDLE_CONTRACT,
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
    contractDigest: CANDIDATE_BUNDLE_CONTRACT,
    providerIdentityDigest: CANDIDATE_BUNDLE_PROCESS_PROVIDER
  })]);
}

function compileBundleInspectionOperation(input: Readonly<{
  repositoryRoot: string;
  bundleDigest: `sha256:${string}`;
  bundleBytes: number;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  const plan = compileSemanticOperationPlan({
    operation: BUNDLE_INSPECTION_OPERATION,
    intentDigest: sha256({
      repositoryRoot: input.repositoryRoot,
      bundleDigest: input.bundleDigest,
      bundleBytes: input.bundleBytes
    }) as OperationDigest,
    decisionDigest: BUNDLE_INSPECTION_CONTRACT,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: BUNDLE_INSPECTION_CONTRACT
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: CANDIDATE_BUNDLE_DURATION_MS },
      { resource: 'input-bytes', maximum: input.bundleBytes },
      { resource: 'output-bytes', maximum: BUNDLE_INSPECTION_MAXIMUM_OUTPUT_BYTES },
      { resource: 'processes', maximum: BUNDLE_INSPECTION_MAXIMUM_PROCESSES }
    ],
    requirements: [{
      id: BUNDLE_INSPECTION_REQUIREMENT,
      contractDigest: BUNDLE_INSPECTION_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'filesystem.identity-drift',
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
    requirementId: BUNDLE_INSPECTION_REQUIREMENT,
    contractDigest: BUNDLE_INSPECTION_CONTRACT,
    providerIdentityDigest: BUNDLE_INSPECTION_PROCESS_PROVIDER
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

export async function inspectGitBundleBytes(input: Readonly<{
  readonly repositoryRoot: string;
  readonly bytes: Uint8Array;
}>): Promise<GitBundleInspection> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  if (!path.isAbsolute(input.repositoryRoot) || repositoryRoot !== input.repositoryRoot
      || input.bytes.byteLength === 0
      || input.bytes.byteLength > BUNDLE_INSPECTION_MAXIMUM_FILE_BYTES) {
    throw new Error('Git bundle inspection input is not canonical.');
  }
  inspectNoFollowDirectoryChain(repositoryRoot, 'Git bundle inspection repository root');
  const bundleDigest = rawSha256(input.bytes);
  const deadlineAtUnixMs = Date.now() + CANDIDATE_BUNDLE_DURATION_MS;
  const operation = compileBundleInspectionOperation({
    repositoryRoot,
    bundleDigest,
    bundleBytes: input.bytes.byteLength,
    deadlineAtUnixMs
  });
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: BUNDLE_INSPECTION_REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    })
  });
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-git-bundle-inspect-'));
  let retainedBundle: RetainedNoFollowOrdinaryFile | null = null;
  let provider: GitPhysicalProviderCapability | null = null;
  let providerReceipt: GitPhysicalProviderReceipt | null = null;
  let inspection: GitBundleInspection | null = null;
  let primaryError: unknown;
  try {
    const temporaryRootIdentity = inspectNoFollowDirectoryChain(
      temporaryRoot,
      'Git bundle inspection temporary root'
    );
    const bundlePath = path.join(temporaryRoot, BUNDLE_INSPECTION_FILE_NAME);
    writeFileSync(bundlePath, input.bytes, { flag: 'wx' });
    retainedBundle = retainNoFollowOrdinaryFile(
      temporaryRootIdentity,
      BUNDLE_INSPECTION_FILE_NAME,
      undefined,
      'Git bundle inspection input',
      7
    );
    await withAuthorityGitReadSession({
      cwd: repositoryRoot,
      operation,
      processSession,
      budget: GIT_READ_BUDGET,
      deadlineAtUnixMs,
      source: process.env
    }, async (session: GitReadSession) => {
      const executablePath = session.gitExecutableIdentity?.realPath;
      if (executablePath === undefined) {
        throw new Error('Git bundle inspection lacks one retained Git executable identity.');
      }
      const resolution = openGitPhysicalProvider({
        cwd: repositoryRoot,
        executablePath,
        operation,
        processSession,
        environmentSource: process.env,
        maximumExecutableBytes: CANDIDATE_BUNDLE_EXECUTABLE_BYTES
      });
      if (resolution.status !== 'ready') {
        throw new Error(`Git bundle inspection physical provider is unavailable: ${resolution.reason}`);
      }
      provider = resolution.capability;
      assertGitPhysicalResourceAdmissionInternal(provider, {
        processes: 2,
        inputBytes: 0,
        outputBytes: 2 * (BUNDLE_INSPECTION_OUTPUT_BYTES + CANDIDATE_BUNDLE_COMMAND_OUTPUT_BYTES)
      });
      const auxiliary = Object.freeze([Object.freeze({
        capability: retainedBundle!,
        kind: 'ordinary-file' as const
      })]);
      await runRequiredGitCommand(
        provider,
        ['bundle', 'verify', retainedBundle!.childPath],
        'inspection verification',
        auxiliary,
        BUNDLE_INSPECTION_OUTPUT_BYTES
      );
      const headsBytes = await runRequiredGitCommand(
        provider,
        ['bundle', 'list-heads', retainedBundle!.childPath],
        'inspection head enumeration',
        auxiliary,
        BUNDLE_INSPECTION_OUTPUT_BYTES
      );
      const source = new TextDecoder('utf-8', { fatal: true }).decode(headsBytes);
      const heads = source.split(/\r?\n/u).filter(Boolean).map((line) => {
        const separator = line.indexOf(' ');
        const objectId = separator < 0 ? '' : line.slice(0, separator);
        const reference = separator < 0 ? '' : line.slice(separator + 1);
        if (!OBJECT_ID.test(objectId) || reference.length === 0 || /[\0\r\n]/u.test(reference)) {
          throw new Error('Git bundle inspection head enumeration is malformed.');
        }
        return Object.freeze({ objectId, reference });
      });
      if (heads.length === 0) {
        throw new Error('Git bundle inspection contains no advertised heads.');
      }
      inspection = Object.freeze({ bundleDigest, heads: Object.freeze(heads) });
    });
  } catch (error) {
    primaryError = error;
  }
  try {
    await settlePhysicalResourcesAsync({
      primary: primaryError === undefined ? undefined : {
        label: 'git-bundle-inspection', error: primaryError
      },
      cleanup: [
        ...(provider === null ? [] : [{
          label: 'git-bundle-inspection-physical-provider',
          settle: () => {
            providerReceipt = closeGitPhysicalProvider(provider!);
            assertGitPhysicalProviderReceipt(providerReceipt, provider!);
          }
        }]),
        ...(retainedBundle === null ? [] : [{
          label: 'git-bundle-inspection-input',
          settle: () => retainedBundle!.dispose()
        }]),
        {
          label: 'git-bundle-inspection-process-session',
          settle: () => {
            const receipt = processSession.close();
            assertProcessResourceSessionReceipt(receipt, {
              operationIdentityDigest: operation.plan.identity.identityDigest,
              boundAttemptDigest: operation.boundAttemptDigest,
              requirementId: BUNDLE_INSPECTION_REQUIREMENT
            });
          }
        }
      ]
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  if (inspection === null || providerReceipt === null) {
    throw primaryError ?? new Error('Git bundle inspection completed without exact settlement.');
  }
  return inspection;
}

export async function createGitCandidateBundle(input: Readonly<{
  readonly sourceRoot: string;
  readonly temporaryRoot: string;
  readonly baseSha: string;
  readonly headSha: string;
}>): Promise<GitCandidateBundle> {
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
  const deadlineAtUnixMs = Date.now() + CANDIDATE_BUNDLE_DURATION_MS;
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
    })
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
      temporaryRootIdentity
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
