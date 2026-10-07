import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { decodeGitIndexGeneration } from '../../../providers/git-read/runtime/scratch-index-generation.ts';
import {
  createAuthorityGitScratchIndexTreeSession,
  type GitScratchIndexTreeSession
} from '../../../providers/git-read/runtime/session.ts';
import {
  parseWorktreeStatusPorcelainZ,
  type WorktreeStatusPorcelainRecord
} from '../../../runtime-state/physical/contract/git-worktree-observation.ts';
import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  ActivePointerPath,
  CurrentStatePath,
  decodeUtf8,
  type FreezeJournal,
  fromBase64,
  parseNulList,
  RollingPlanPath,
  shaValue
} from './document-control-journal-codec.ts';
import {
  assertFreezeReadOwnerCurrent,
  type CommandOptions,
  type CommandResult,
  controlIndexEntries,
  createReadOnlyResolverGit,
  currentDocumentControlFreezeReadCustody,
  currentDocumentControlGitReadSession,
  documentControlCliFailure,
  type GitIndexPaths,
  isDocumentControlHostCliTestSession,
  readControlBlobEntries,
  readControlTreeBlobs,
  readGitBlob,
  type ReadOnlyResolverGit,
  requireCommand,
  requireCommandOutput,
  requireControlBlob,
  requireGitBlob,
  run
} from './document-control-observation.ts';
import { parseActivePointer } from './document-control-plane-contract.ts';
import {
  canonicalDirectoryBoundary,
  createSafeRegularFileExclusive,
  type FreezeDurabilityOptions,
  inspectSafePath,
  observeOptionalSafeRegularFile,
  pathComparisonValue,
  publishEntryNoReplaceCas,
  readOptionalSafeRegularFile,
  readSafeRegularFile
} from './document-control-publication.ts';

/**
 * Native Git index custody: retain repository PRE, compute through a private
 * writable scratch index, and preserve exact readback/fence inputs for the owner.
 * Git owns tree construction. Manual tree builders, subtree caches and symbolic
 * delta continuations are rejected alternatives, not fallback implementations.
 * Object materialization and index publication stay separate admitted steps;
 * a private-index result never proves repository CAS or terminal settlement.
 */

export interface ControlIndexSnapshot {
  readonly treeSha: string;
  readonly index: AnchoredIndexSnapshot;
  readonly stateBytes: Buffer;
  readonly pointerBytes: Buffer;
  readonly rollingPlanBytes: Buffer;
  readonly stateSource: string;
  readonly pointerSource: string;
  readonly rollingPlanSource: string;
  readonly candidateManifestBlob: Buffer | undefined;
  readonly targetManifestBlob: Buffer | undefined;
  readonly roadmapBlob: Buffer | undefined;
  readonly indexPaths: readonly string[];
  readonly stagedPaths: readonly string[];
  readonly worktreeStatus: string;
  readonly machineStatus: readonly WorktreeStatusPorcelainRecord[] | null;
}

interface AnchoredIndexSnapshot {
  readonly bytes: Buffer;
  readonly identity: string;
}

export async function readAnchoredIndexSnapshot(input: Readonly<{
  boundaryRoot: string;
  filePath: string;
  label: string;
}>): Promise<AnchoredIndexSnapshot> {
  const observation = await observeOptionalSafeRegularFile(input);
  if (observation === null) throw Object.assign(new Error(`${input.label} is absent.`), { code: 'ENOENT' });
  const identity = observation.identity;
  return Object.freeze({
    bytes: observation.bytes,
    identity: typeof identity === 'string'
      ? identity
      : `${identity.device}:${identity.inode}`
  });
}

interface ExternalScratchIndex {
  readonly treeSha: string;
  readonly index: AnchoredIndexSnapshot;
  run(args: readonly string[], options?: CommandOptions): Promise<CommandResult>;
  readBlob(spec: string): Promise<Buffer | undefined>;
}

async function withRepositoryIndexTreeThroughExternalScratch<T>(
  input: Readonly<{ repositoryRoot: string; resolverGit?: ReadOnlyResolverGit }>,
  observe: (snapshot: ExternalScratchIndex) => Promise<T> | T
): Promise<T> {
  const indexPaths = await resolveIndexPaths(input.repositoryRoot);
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-document-control-index-'));
  let observed: T;
  try {
    const canonicalScratchRoot = await realpath(scratchRoot);
    const canonicalRepositoryRoot = await realpath(input.repositoryRoot);
    const canonicalGitDirectory = await realpath(indexPaths.gitDirectory);
    if (pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalRepositoryRoot)}${path.sep}`)
        || pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalGitDirectory)}${path.sep}`)) {
      throw new Error('External scratch index root must not be contained by the repository or Git directory.');
    }
    const before = await readAnchoredIndexSnapshot({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: indexPaths.indexPath,
      label: 'Repository index nonmutating source'
    });
    let indexOperationFailure: Readonly<{ error: unknown }> | undefined;
    try {
      const scratchIndex = path.join(canonicalScratchRoot, 'index');
      const scratchObjects = path.join(canonicalScratchRoot, 'objects');
      await mkdir(scratchObjects);
      const repositoryObjectsCandidate = requireCommand(
        await run('git', ['rev-parse', '--git-path', 'objects'], input.repositoryRoot),
        'Repository object directory path'
      );
      const repositoryObjects = await realpath(path.isAbsolute(repositoryObjectsCandidate)
        ? repositoryObjectsCandidate
        : path.resolve(input.repositoryRoot, repositoryObjectsCandidate));
      await createSafeRegularFileExclusive({
        boundaryRoot: canonicalScratchRoot,
        filePath: scratchIndex,
        bytes: before.bytes,
        label: 'External scratch Git index',
        durability: {}
      });
      const environment = {
        GIT_INDEX_FILE: scratchIndex,
        GIT_OBJECT_DIRECTORY: scratchObjects,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects,
        GIT_OPTIONAL_LOCKS: '0'
      };
      const testTransport = isDocumentControlHostCliTestSession();
      let productionScratch: GitScratchIndexTreeSession | null = null;
      if (!testTransport) {
        const gitReadSession = currentDocumentControlGitReadSession();
        if (gitReadSession === undefined) {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
          );
        }
        const resolution = await createAuthorityGitScratchIndexTreeSession({
          gitReadSession,
          scratchRoot: canonicalScratchRoot
        });
        if (resolution.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', resolution.reason
          );
        }
        productionScratch = resolution.session;
      }
      const scratchEnvironment = (options: CommandOptions = {}): CommandOptions => Object.freeze({
        ...options,
        environment: Object.freeze({ ...options.environment, ...environment })
      });
      const runScratch = async (
        args: readonly string[],
        options: CommandOptions = {}
      ): Promise<CommandResult> => {
        if (productionScratch === null) {
          const scratchOptions = scratchEnvironment(options);
          return input.resolverGit === undefined
            ? run('git', [...args], input.repositoryRoot, scratchOptions)
            : input.resolverGit.run(args, input.repositoryRoot, scratchOptions);
        }
        if (options.input !== undefined || (options.environment !== undefined
            && Object.keys(options.environment).length > 0)) {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
          );
        }
        if (args.length === 1 && args[0] === 'write-tree') {
          const result = await productionScratch.writeTree();
          if (result.status !== 'ready') {
            throw documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', result.reason
            );
          }
          return Object.freeze({ code: 0, stdout: `${result.value}\n`, stderr: '' });
        }
        const result = await productionScratch.observe(args);
        if (result.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', result.reason
          );
        }
        return Object.freeze({
          code: result.value.code,
          stdout: Buffer.from(result.value.stdout).toString('utf8'),
          ...(args[0] === 'status' && args.includes('-z') ? { stdoutBytes: Buffer.from(result.value.stdout) } : {}),
          stderr: Buffer.from(result.value.stderr).toString('utf8')
        });
      };
      let primaryFailure: Readonly<{ error: unknown }> | undefined;
      try {
        const treeSha = shaValue(requireCommand(
          await runScratch(['write-tree']),
          'Repository index tree through external scratch'
        ), 'Repository index tree through external scratch');
        observed = await observe(Object.freeze({
          treeSha,
          index: before,
          run: runScratch,
          async readBlob(spec: string) {
            const result = await runScratch(['show', spec]);
            return result.code === 0 ? Buffer.from(result.stdout) : undefined;
          }
        }));
      } catch (error) {
        primaryFailure = Object.freeze({ error });
        throw error;
      } finally {
        let closeFailure: Readonly<{ error: unknown }> | undefined;
        try {
          const reason = await productionScratch?.close();
          if (reason !== null && reason !== undefined) {
            closeFailure = Object.freeze({
              error: documentControlCliFailure(
                'git', 'git-object-index-effect', 'unavailable', reason
              )
            });
          }
        } catch (error) {
          closeFailure = Object.freeze({ error });
        }
        if (primaryFailure !== undefined && closeFailure !== undefined) {
          throw new AggregateError(
            [primaryFailure.error, closeFailure.error],
            'Document-control scratch observation and session close both failed.'
          );
        }
        if (closeFailure !== undefined) throw closeFailure.error;
      }
    } catch (error) {
      indexOperationFailure = Object.freeze({ error });
      throw error;
    } finally {
      let readbackFailure: Readonly<{ error: unknown }> | undefined;
      try {
        const after = await readAnchoredIndexSnapshot({
          boundaryRoot: indexPaths.gitDirectory,
          filePath: indexPaths.indexPath,
          label: 'Repository index nonmutating readback'
        });
        if (!after.bytes.equals(before.bytes) || after.identity !== before.identity) {
          throw new Error('External scratch Git index tree observation mutated the repository index.');
        }
      } catch (error) {
        readbackFailure = Object.freeze({ error });
      }
      if (indexOperationFailure !== undefined && readbackFailure !== undefined) {
        throw new AggregateError(
          [indexOperationFailure.error, readbackFailure.error],
          'Document-control scratch operation and repository-index readback both failed.'
        );
      }
      if (readbackFailure !== undefined) throw readbackFailure.error;
    }
  } catch (error) {
    const operationFailure = Object.freeze({ error });
    let cleanupFailure: Readonly<{ error: unknown }> | undefined;
    try {
      await rm(scratchRoot, { recursive: true, force: true });
      const removed = await lstat(scratchRoot).then(
        () => false,
        (removeError: unknown) => (removeError as NodeJS.ErrnoException).code === 'ENOENT'
      );
      if (!removed) throw new Error('External scratch Git index root remained after cleanup.');
    } catch (removeError) {
      cleanupFailure = Object.freeze({ error: removeError });
    }
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [operationFailure.error, cleanupFailure.error],
        'Document-control scratch operation and root cleanup both failed.'
      );
    }
    throw operationFailure.error;
  }
  await rm(scratchRoot, { recursive: true, force: true });
  const removed = await lstat(scratchRoot).then(
    () => false,
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
  if (!removed) throw new Error('External scratch Git index root remained after cleanup.');
  return observed;
}

export async function captureRepositoryIndexTreeThroughExternalScratch(input: Readonly<{
  repositoryRoot: string;
  resolverGit?: ReadOnlyResolverGit;
}>): Promise<Readonly<{ treeSha: string; index: AnchoredIndexSnapshot }>> {
  return withRepositoryIndexTreeThroughExternalScratch(input, ({ treeSha, index }) => (
    Object.freeze({ treeSha, index })
  ));
}

export async function captureControlIndexSnapshot(
  repositoryRoot: string,
  options: Readonly<{
    resolverGit?: ReadOnlyResolverGit;
    targetManifestPath?: string;
    observeMachineStatus?: boolean;
    stagedBaseSha?: string;
    requiredStageZeroPaths?: readonly string[];
  }> = {}
): Promise<ControlIndexSnapshot> {
  return withRepositoryIndexTreeThroughExternalScratch(
    {
      repositoryRoot,
      ...(options.resolverGit === undefined ? {} : { resolverGit: options.resolverGit })
    },
    async ({ treeSha, index, run: runScratch, readBlob }) => {
      const generation = currentDocumentControlFreezeReadCustody() === undefined ? undefined
        : decodeGitIndexGeneration(index.bytes, treeSha.length === 40 ? 'sha1' : 'sha256');
      const readBlobs = async (paths: readonly string[]) => {
        if (generation === undefined) {
          const blobs = new Map<string, Buffer>();
          for (const repositoryPath of paths) {
            const bytes = await readBlob(`:${repositoryPath}`);
            if (bytes !== undefined) blobs.set(repositoryPath, bytes);
          }
          return blobs;
        }
        const entries = controlIndexEntries(generation, paths);
        return options.resolverGit === undefined ? readControlBlobEntries(repositoryRoot, entries)
          : options.resolverGit.readBlobs(repositoryRoot, entries);
      };
      const controls = await readBlobs([
        CurrentStatePath, ActivePointerPath, RollingPlanPath, 'config/repository/work-selection.md'
      ]);
      const stateBytes = requireControlBlob(controls, CurrentStatePath, 'Current-state spec');
      const pointerBytes = requireControlBlob(controls, ActivePointerPath, 'Active pointer');
      const rollingPlanBytes = requireControlBlob(controls, RollingPlanPath, 'Rolling plan');
      const stateSource = decodeUtf8(stateBytes, 'Current-state spec');
      const pointerSource = decodeUtf8(pointerBytes, 'Active pointer');
      const rollingPlanSource = decodeUtf8(rollingPlanBytes, 'Rolling plan');
      const pointer = parseActivePointer(pointerSource);
      const manifests = await readBlobs([
        pointer.manifest, ...(options.targetManifestPath === undefined ? [] : [options.targetManifestPath])
      ]);
      const candidateManifestBlob = manifests.get(pointer.manifest);
      const targetManifestBlob = options.targetManifestPath === undefined ? undefined : manifests.get(options.targetManifestPath);
      const roadmapBlob = controls.get('config/repository/work-selection.md');
      const indexPaths = Object.freeze(parseNulList(requireCommandOutput(
        await runScratch(['ls-files', '--cached', '-z']),
        'External index snapshot path inventory'
      )));
      let stagedPaths: readonly string[] = Object.freeze([]);
      if (options.stagedBaseSha !== undefined) {
        const unmerged = parseNulList(requireCommandOutput(
          await runScratch(['ls-files', '--unmerged', '-z']),
          'Unmerged external index snapshot inventory'
        ));
        if (unmerged.length > 0) throw new Error('Document control freeze rejects an unmerged Git index.');
        stagedPaths = Object.freeze(parseNulList(requireCommandOutput(
          await runScratch([
            'diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames',
            '--name-only', '-z', options.stagedBaseSha, '--'
          ]),
          'Staged external index snapshot inventory'
        )));
      }
      if (options.requiredStageZeroPaths !== undefined) {
        const source = requireCommandOutput(await runScratch(
          ['ls-files', '--stage', '-z', '--', ...options.requiredStageZeroPaths]
        ), 'Document control external index target inventory');
        for (const entry of parseNulList(source)) {
          const match = /^(\d{6}) ([0-9a-f]{40}) ([0-3])\t(.+)$/u.exec(entry);
          if (!match) throw new Error('Document control target index entry is malformed.');
          if (match[1] !== '100644' || match[3] !== '0') {
            throw new Error(`Document control target must be a stage-zero regular blob: ${match[4]}.`);
          }
        }
      }
      const worktreeStatus = requireCommand(
        await runScratch(['status', '--short', '--branch']),
        'Worktree status through external index snapshot'
      );
      let machineStatus: readonly WorktreeStatusPorcelainRecord[] | null = null;
      if (options.observeMachineStatus === true) {
        const result = await runScratch([
          'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
        ]);
        requireCommandOutput(result, 'Machine worktree status through external index snapshot');
        if (result.stdoutBytes === undefined) {
          throw new Error('Machine worktree status lost its original byte observation.');
        }
        machineStatus = Object.freeze(parseWorktreeStatusPorcelainZ(
          result.stdoutBytes, { allowDirectoryEntries: false }
        ));
      }
      return Object.freeze({
        treeSha: shaValue(treeSha, 'Git index tree snapshot'),
        index,
        stateBytes,
        pointerBytes,
        rollingPlanBytes,
        stateSource,
        pointerSource,
        rollingPlanSource,
        candidateManifestBlob,
        targetManifestBlob,
        roadmapBlob,
        indexPaths,
        stagedPaths,
        worktreeStatus,
        machineStatus
      });
    }
  );
}

async function observeIndexRouting(repositoryRoot: string, gitDirectory?: string): Promise<string> {
  const locator = path.join(repositoryRoot, '.git');
  const metadata = await lstat(locator);
  let relation: unknown;
  if (metadata.isDirectory()) relation = inspectNoFollowDirectoryChain(locator, 'Freeze Git directory locator');
  else {
    const file = await observeOptionalSafeRegularFile({ boundaryRoot: repositoryRoot, filePath: locator, label: 'Freeze Git file locator' });
    if (file === null) throw new Error('Freeze Git file locator disappeared during observation.');
    relation = { identity: file.identity, bytesDigest: rawSha256(file.bytes) };
  }
  return sha256({ relation, directory: gitDirectory === undefined ? null
    : inspectNoFollowDirectoryChain(gitDirectory, 'Freeze Git directory binding') });
}

export async function resolveIndexPaths(
  repositoryRoot: string,
  allowMissingIndex = false
): Promise<GitIndexPaths> {
  const custody = currentDocumentControlFreezeReadCustody();
  let retained = custody?.index;
  const reusedRouting = retained !== undefined;
  if (retained !== undefined && path.resolve(retained.repositoryRoot) !== path.resolve(repositoryRoot)) throw new Error('Freeze index routing changed repository.');
  let gitDirectory: string, resolved: string;
  if (retained !== undefined) {
    if (await observeIndexRouting(repositoryRoot, retained.paths.gitDirectory) !== retained.routing) {
      throw new Error('Freeze Git index routing changed within its owner lifetime.');
    }
    ({ gitDirectory, indexPath: resolved } = retained.paths);
  } else {
    const before = custody === undefined ? undefined : await observeIndexRouting(repositoryRoot);
    const gitDirectoryCandidate = requireCommand(
      await run('git', ['rev-parse', '--absolute-git-dir'], repositoryRoot), 'Git directory path'
    );
    gitDirectory = await canonicalDirectoryBoundary(gitDirectoryCandidate, 'Git directory');
    const candidate = requireCommand(
      await run('git', ['rev-parse', '--git-path', 'index'], repositoryRoot), 'Git index path'
    );
    resolved = path.isAbsolute(candidate) ? candidate : path.resolve(repositoryRoot, candidate);
    if (custody !== undefined) {
      const session = currentDocumentControlGitReadSession();
      if (session === undefined || path.resolve(session.cwd) !== path.resolve(repositoryRoot)) {
        throw new Error('Freeze index routing differs from its current repository owner.');
      }
      assertFreezeReadOwnerCurrent();
      const routing = await observeIndexRouting(repositoryRoot, gitDirectory);
      if (await observeIndexRouting(repositoryRoot) !== before) throw new Error('Freeze Git locator changed during resolution.');
      retained = Object.freeze({ repositoryRoot, paths: Object.freeze({ gitDirectory, indexPath: resolved, lockPath: `${resolved}.lock` }), routing });
    }
  }
  const indexPath = await inspectSafePath({
    boundaryRoot: gitDirectory,
    candidatePath: resolved,
    label: 'Git index',
    finalKind: 'file',
    allowMissing: allowMissingIndex
  });
  const resolvedIndexPath = indexPath ?? resolved;
  const lockPath = `${resolvedIndexPath}.lock`;
  await inspectSafePath({
    boundaryRoot: gitDirectory,
    candidatePath: lockPath,
    label: 'Git index lock',
    finalKind: 'file',
    allowMissing: true
  });
  const paths = Object.freeze({ gitDirectory, indexPath: resolvedIndexPath, lockPath });
  if (reusedRouting) assertFreezeReadOwnerCurrent();
  if (custody !== undefined) custody.index = retained;
  return paths;
}

export async function assertIndexSemanticIdentity(input: {
  repositoryRoot: string;
  indexPaths: GitIndexPaths;
  expectedTreeSha: string;
  label: string;
}): Promise<void> {
  const lockBytes = await readOptionalSafeRegularFile({
    boundaryRoot: input.indexPaths.gitDirectory,
    filePath: input.indexPaths.lockPath,
    label: `${input.label} lock`
  });
  if (lockBytes !== null) throw new Error(`${input.label} found an active Git index lock; preserving it.`);
  const { treeSha } = await captureRepositoryIndexTreeThroughExternalScratch({
    repositoryRoot: input.repositoryRoot,
    resolverGit: createReadOnlyResolverGit()
  });
  if (treeSha !== input.expectedTreeSha) {
    throw new Error(`${input.label} tree changed; preserving the current Git index.`);
  }
}

export async function publishIndexCas(input: {
  gitDirectory: string;
  indexPath: string;
  lockPath: string;
  pre: Buffer;
  next: Buffer;
  operationId: string;
  faultAfterLockWrite?: () => void;
  faultAfterPreQuarantine?: () => void;
  faultAfterNextInstall?: () => void;
  durability: FreezeDurabilityOptions;
}): Promise<void> {
  await publishEntryNoReplaceCas({
    boundaryRoot: input.gitDirectory,
    artifactRoot: input.gitDirectory,
    targetPath: input.indexPath,
    targetKey: 'git-index',
    nextPath: input.lockPath,
    pre: input.pre,
    next: input.next,
    label: 'Git index',
    operationId: input.operationId,
    faultAfterNextPrepared: input.faultAfterLockWrite,
    faultAfterPreQuarantine: input.faultAfterPreQuarantine,
    faultAfterNextInstall: input.faultAfterNextInstall,
    durability: input.durability
  });
}

export async function buildNextIndex(input: {
  repositoryRoot: string;
  gitDirectory: string;
  indexPath: string;
  targets: readonly Readonly<{ path: string; pre: Buffer | undefined; bytes: Buffer }>[];
  absentPaths: readonly string[];
}): Promise<Readonly<{ bytes: Buffer; treeSha: string }>> {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-document-control-freeze-index-'));
  let productionScratch: GitScratchIndexTreeSession | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  let built: Readonly<{ bytes: Buffer; treeSha: string }>;
  try {
    try {
      const canonicalScratchRoot = await realpath(scratchRoot);
      const canonicalRepositoryRoot = await realpath(input.repositoryRoot);
      const canonicalGitDirectory = await realpath(input.gitDirectory);
      if (pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalRepositoryRoot)}${path.sep}`)
          || pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalGitDirectory)}${path.sep}`)) {
        throw new Error('External freeze scratch index root must not be contained by the repository or Git directory.');
      }
      const sourceIndex = await readSafeRegularFile({
        boundaryRoot: input.gitDirectory,
        filePath: input.indexPath,
        label: 'Git index source'
      });
      const scratchIndex = path.join(canonicalScratchRoot, 'index');
      const scratchObjects = path.join(canonicalScratchRoot, 'objects');
      await mkdir(scratchObjects);
      const repositoryObjectsCandidate = requireCommand(
        await run('git', ['rev-parse', '--git-path', 'objects'], input.repositoryRoot),
        'Repository object directory path'
      );
      const repositoryObjects = await realpath(path.isAbsolute(repositoryObjectsCandidate)
        ? repositoryObjectsCandidate
        : path.resolve(input.repositoryRoot, repositoryObjectsCandidate));
      await createSafeRegularFileExclusive({
        boundaryRoot: canonicalScratchRoot,
        filePath: scratchIndex,
        bytes: sourceIndex,
        label: 'External freeze scratch Git index',
        durability: {}
      });
      const environment = {
        GIT_INDEX_FILE: scratchIndex,
        GIT_OBJECT_DIRECTORY: scratchObjects,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects,
        GIT_OPTIONAL_LOCKS: '0'
      };
      const changedTargets = input.targets.filter(
        (target) => target.pre === undefined || !target.pre.equals(target.bytes)
      );
      const productionSession = currentDocumentControlGitReadSession();
      const testTransport = isDocumentControlHostCliTestSession();
      if (!testTransport) {
        if (productionSession === undefined) {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
          );
        }
        const resolution = await createAuthorityGitScratchIndexTreeSession({
          gitReadSession: productionSession,
          scratchRoot: canonicalScratchRoot
        });
        if (resolution.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', resolution.reason
          );
        }
        productionScratch = resolution.session;
        const tree = await productionScratch.applyIndexDelta({
          additions: changedTargets.map((target) => Object.freeze({
            path: target.path,
            bytes: target.bytes
          })),
          removals: Object.freeze([...input.absentPaths])
        });
        if (tree.status !== 'ready') {
          const failure = documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', tree.reason,
            tree.detail === undefined ? undefined : rawSha256(tree.detail)
          );
          if (tree.detail !== undefined) failure.cause = new Error(tree.detail);
          throw failure;
        }
        const treeSha = shaValue(tree.value, 'Candidate tree');
        for (const target of input.targets) {
          const observed = await productionScratch.observe(['show', `${treeSha}:${target.path}`]);
          if (observed.status !== 'ready') {
            throw documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', observed.reason
            );
          }
          if (observed.value.code !== 0) {
            throw new Error(`Candidate ${target.path} is absent from the scratch tree.`);
          }
          const treeBytes = Buffer.from(observed.value.stdout);
          if (!treeBytes.equals(target.bytes)) {
            throw new Error(`Candidate tree bytes drifted for ${target.path}.`);
          }
        }
        for (const absentPath of input.absentPaths) {
          const observed = await productionScratch.observe(['show', `${treeSha}:${absentPath}`]);
          if (observed.status !== 'ready') {
            throw documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', observed.reason
            );
          }
          if (observed.value.code === 0) {
            throw new Error(`Candidate tree retained the retired path ${absentPath}.`);
          }
        }
        const index = productionScratch.indexBytes();
        if (index.status !== 'ready') {
          throw documentControlCliFailure(
            'git', 'git-object-index-effect', 'unavailable', index.reason
          );
        }
        built = Object.freeze({ bytes: Buffer.from(index.value), treeSha });
      } else {
        const indexUpdates: string[] = [];
        for (const target of changedTargets) {
          const blobSha = requireCommand(
            await run('git', ['hash-object', '-w', '--stdin'], input.repositoryRoot, {
              environment,
              input: target.bytes
            }),
            `Scratch Git blob materialization for ${target.path}`
          );
          indexUpdates.push(`100644 ${blobSha}\t${target.path}\0`);
        }
        if (indexUpdates.length > 0) {
          requireCommand(await run(
            'git',
            ['update-index', '-z', '--index-info'],
            input.repositoryRoot,
            { environment, input: Buffer.from(indexUpdates.join(''), 'utf8') }
          ), 'Batched temporary Git index update');
        }
        if (input.absentPaths.length > 0) {
          requireCommand(await run(
            'git',
            ['update-index', '--remove', '-z', '--stdin'],
            input.repositoryRoot,
            { environment, input: Buffer.from(`${input.absentPaths.join('\0')}\0`, 'utf8') }
          ), 'Batched temporary Git index removal');
        }
        const treeSha = shaValue(
          requireCommand(
            await run('git', ['write-tree'], input.repositoryRoot, { environment }),
            'Candidate tree write'
          ),
          'Candidate tree'
        );
        for (const target of input.targets) {
          const treeBytes = await readGitBlob(input.repositoryRoot, `${treeSha}:${target.path}`, environment);
          if (treeBytes === undefined) throw new Error(`Candidate ${target.path} is absent from the scratch tree.`);
          if (!treeBytes.equals(target.bytes)) throw new Error(`Candidate tree bytes drifted for ${target.path}.`);
        }
        for (const absentPath of input.absentPaths) {
          if (await readGitBlob(input.repositoryRoot, `${treeSha}:${absentPath}`, environment) !== undefined) {
            throw new Error(`Candidate tree retained the retired path ${absentPath}.`);
          }
        }
        const bytes = await readSafeRegularFile({
          boundaryRoot: canonicalScratchRoot,
          filePath: scratchIndex,
          label: 'External freeze scratch Git index readback'
        });
        built = Object.freeze({ bytes, treeSha });
      }
    } catch (error) {
      primaryFailure = Object.freeze({ error });
      throw error;
    } finally {
      let closeFailure: Readonly<{ error: unknown }> | undefined;
      try {
        const reason = await productionScratch?.close();
        if (reason !== null && reason !== undefined) {
          closeFailure = Object.freeze({
            error: documentControlCliFailure(
              'git', 'git-object-index-effect', 'unavailable', reason
            )
          });
        }
      } catch (error) {
        closeFailure = Object.freeze({ error });
      }
      if (primaryFailure !== undefined && closeFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure.error, closeFailure.error],
          'Freeze scratch index construction and session close both failed.'
        );
      }
      if (closeFailure !== undefined) throw closeFailure.error;
    }
  } catch (error) {
    const operationFailure = Object.freeze({ error });
    let cleanupFailure: Readonly<{ error: unknown }> | undefined;
    try {
      await rm(scratchRoot, { recursive: true, force: true });
      const removed = await lstat(scratchRoot).then(
        () => false,
        (removeError: unknown) => (removeError as NodeJS.ErrnoException).code === 'ENOENT'
      );
      if (!removed) throw new Error('External freeze scratch Git index root remained after cleanup.');
    } catch (removeError) {
      cleanupFailure = Object.freeze({ error: removeError });
    }
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [operationFailure.error, cleanupFailure.error],
        'Freeze scratch index construction and root cleanup both failed.'
      );
    }
    throw operationFailure.error;
  }
  await rm(scratchRoot, { recursive: true, force: true });
  const removed = await lstat(scratchRoot).then(
    () => false,
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
  if (!removed) throw new Error('External freeze scratch Git index root remained after cleanup.');
  return built;
}

export async function materializeFreezeCandidateObjects(input: Readonly<{
  repositoryRoot: string;
  gitDirectory: string;
  journal: FreezeJournal;
}>): Promise<void> {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-document-control-materialize-index-'));
  let productionScratch: GitScratchIndexTreeSession | null = null;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const canonicalScratchRoot = await realpath(scratchRoot);
    const canonicalRepositoryRoot = await realpath(input.repositoryRoot);
    const canonicalGitDirectory = await realpath(input.gitDirectory);
    if (pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalRepositoryRoot)}${path.sep}`)
        || pathComparisonValue(canonicalScratchRoot).startsWith(`${pathComparisonValue(canonicalGitDirectory)}${path.sep}`)) {
      throw new Error('Freeze object materialization scratch root must remain outside the repository and Git directory.');
    }
    const scratchIndex = path.join(canonicalScratchRoot, 'index');
    await createSafeRegularFileExclusive({
      boundaryRoot: canonicalScratchRoot,
      filePath: scratchIndex,
      bytes: fromBase64(input.journal.index.next, 'Freeze journal index NEXT object materialization'),
      label: 'Freeze object materialization scratch Git index',
      durability: {}
    });
    await mkdir(path.join(canonicalScratchRoot, 'objects'));
    const environment = {
      GIT_INDEX_FILE: scratchIndex,
      GIT_OPTIONAL_LOCKS: '0'
    };
    const nextFiles = [
      [input.journal.manifestPath, input.journal.files.manifest.next],
      [ActivePointerPath, input.journal.files.pointer.next],
      [RollingPlanPath, input.journal.files.rollingPlan.next]
    ] as const;
    const testTransport = isDocumentControlHostCliTestSession();
    const productionSession = currentDocumentControlGitReadSession();
    if (!testTransport) {
      if (productionSession === undefined) {
        throw documentControlCliFailure(
          'git', 'git-object-index-effect', 'unknown', 'semantic-closure-unproven'
        );
      }
      const resolution = await createAuthorityGitScratchIndexTreeSession({
        gitReadSession: productionSession,
        scratchRoot: canonicalScratchRoot
      });
      if (resolution.status !== 'ready') {
        throw documentControlCliFailure(
          'git', 'git-object-index-effect', 'unavailable', resolution.reason
        );
      }
      productionScratch = resolution.session;
      const materialized = await productionScratch.materializeIndexDelta({
        additions: nextFiles.map(([repositoryPath, encodedBytes]) => Object.freeze({
          path: repositoryPath,
          bytes: fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object materialization`)
        })),
        removals: Object.freeze([])
      });
      if (materialized.status !== 'ready') {
        throw documentControlCliFailure(
          'git', 'git-object-index-effect', 'unavailable', materialized.reason
        );
      }
      const materializedTreeSha = shaValue(materialized.value, 'Freeze materialized candidate tree');
      if (materializedTreeSha !== input.journal.candidateTreeSha) {
        throw new Error('Materialized freeze candidate tree does not equal the journal candidate tree.');
      }
      const materializedBlobs = await readControlTreeBlobs(input.repositoryRoot, materializedTreeSha,
        nextFiles.map(([repositoryPath]) => repositoryPath));
      for (const [repositoryPath, encodedBytes] of nextFiles) {
        const expected = fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object readback`);
        const actual = materializedBlobs.get(repositoryPath);
        if (actual === undefined || !actual.equals(expected)) {
          throw new Error(`Materialized freeze candidate ${repositoryPath} does not equal the journal NEXT image.`);
        }
      }
      const retiredManifestPath = await freezeRetiredManifestPath(input.repositoryRoot, input.journal);
      if (retiredManifestPath !== null
          && await readGitBlob(input.repositoryRoot, `${materializedTreeSha}:${retiredManifestPath}`) !== undefined) {
        throw new Error('Materialized freeze candidate retained the prior pointer manifest.');
      }
      return;
    }
    const indexUpdates: string[] = [];
    for (const [repositoryPath, encodedBytes] of nextFiles) {
      const blobSha = requireCommand(await run('git', ['hash-object', '-w', '--stdin'], input.repositoryRoot, {
        input: fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object materialization`)
      }), `Freeze ${repositoryPath} object materialization`);
      indexUpdates.push(`100644 ${blobSha}\t${repositoryPath}\0`);
    }
    requireCommand(await run(
      'git',
      ['update-index', '-z', '--index-info'],
      input.repositoryRoot,
      { environment, input: Buffer.from(indexUpdates.join(''), 'utf8') }
    ), 'Freeze object materialization scratch index refresh');
    const materializedTreeSha = shaValue(requireCommand(
      await run('git', ['write-tree'], input.repositoryRoot, { environment }),
      'Freeze candidate tree object materialization'
    ), 'Freeze materialized candidate tree');
    if (materializedTreeSha !== input.journal.candidateTreeSha) {
      throw new Error('Materialized freeze candidate tree does not equal the journal candidate tree.');
    }
    const materializedBlobs = await readControlTreeBlobs(input.repositoryRoot, materializedTreeSha,
      nextFiles.map(([repositoryPath]) => repositoryPath));
    for (const [repositoryPath, encodedBytes] of nextFiles) {
      const expected = fromBase64(encodedBytes, `Freeze ${repositoryPath} NEXT object readback`);
      const actual = materializedBlobs.get(repositoryPath);
      if (actual === undefined || !actual.equals(expected)) {
        throw new Error(`Materialized freeze candidate ${repositoryPath} does not equal the journal NEXT image.`);
      }
    }
    const retiredManifestPath = await freezeRetiredManifestPath(input.repositoryRoot, input.journal);
    if (retiredManifestPath !== null
        && await readGitBlob(input.repositoryRoot, `${materializedTreeSha}:${retiredManifestPath}`) !== undefined) {
      throw new Error('Materialized freeze candidate retained the prior pointer manifest.');
    }
  } catch (error) {
    primaryFailure = Object.freeze({ error });
    throw error;
  } finally {
    const settlementFailures: unknown[] = [];
    try {
      const reason = await productionScratch?.close();
      if (reason !== null && reason !== undefined) {
        settlementFailures.push(documentControlCliFailure(
          'git', 'git-object-index-effect', 'unavailable', reason
        ));
      }
    } catch (error) {
      settlementFailures.push(error);
    }
    try {
      await rm(scratchRoot, { recursive: true, force: true });
      const removed = await lstat(scratchRoot).then(
        () => false,
        (removeError: unknown) => (removeError as NodeJS.ErrnoException).code === 'ENOENT'
      );
      if (!removed) throw new Error('Freeze object materialization scratch root remained after cleanup.');
    } catch (error) {
      settlementFailures.push(error);
    }
    if (primaryFailure !== undefined) settlementFailures.unshift(primaryFailure.error);
    if (settlementFailures.length === 1) throw settlementFailures[0];
    if (settlementFailures.length > 1) {
      throw new AggregateError(
        settlementFailures,
        'Freeze object materialization and scratch closeout had multiple failures.'
      );
    }
  }
}

export async function assertInitialFreezeObservationFence(input: {
  repositoryRoot: string;
  defaultRef: string;
  headSha: string;
  localDefaultSha: string;
  indexPaths: GitIndexPaths;
  indexSnapshot: AnchoredIndexSnapshot;
  expectedIndexTreeSha: string;
  allowSemanticIndexDrift: boolean;
  worktreeFiles: readonly Readonly<{
    filePath: string;
    expectedBytes: Buffer;
    label: string;
  }>[];
  absentWorktreePaths?: readonly string[];
}): Promise<void> {
  const headReadback = shaValue(
    requireCommand(
      await run('git', ['rev-parse', 'HEAD'], input.repositoryRoot),
      'Pre-journal candidate HEAD readback'
    ),
    'Pre-journal candidate HEAD readback'
  );
  const localDefaultReadback = shaValue(
    requireCommand(
      await run('git', ['rev-parse', '--verify', input.defaultRef], input.repositoryRoot),
      'Pre-journal local default readback'
    ),
    'Pre-journal local default readback'
  );
  const indexReadback = await readAnchoredIndexSnapshot({
    boundaryRoot: input.indexPaths.gitDirectory,
    filePath: input.indexPaths.indexPath,
    label: 'Pre-journal Git index readback'
  });
  let indexStable = indexReadback.identity === input.indexSnapshot.identity
    && indexReadback.bytes.equals(input.indexSnapshot.bytes);
  let semanticIndexTreeReadback: string | null = null;
  if (!indexStable && input.allowSemanticIndexDrift) {
    const semanticReadback = await captureRepositoryIndexTreeThroughExternalScratch({
      repositoryRoot: input.repositoryRoot,
      resolverGit: createReadOnlyResolverGit()
    });
    semanticIndexTreeReadback = semanticReadback.treeSha;
    indexStable = semanticReadback.treeSha === input.expectedIndexTreeSha;
  }
  const worktreeStable = (await Promise.all(input.worktreeFiles.map(async (file) => (
    (await readSafeRegularFile({
      boundaryRoot: input.repositoryRoot,
      filePath: file.filePath,
      label: `Pre-journal ${file.label} readback`
    })).equals(file.expectedBytes)
  )))).every(Boolean);
  const absentWorktreeStable = (await Promise.all((input.absentWorktreePaths ?? []).map(
    async (repositoryPath) => (await inspectSafePath({
      boundaryRoot: input.repositoryRoot,
      candidatePath: path.join(input.repositoryRoot, ...repositoryPath.split('/')),
      label: `Pre-journal retired manifest ${repositoryPath}`,
      finalKind: 'file',
      allowMissing: true
    })) === null
  ))).every(Boolean);
  const changedInputs = [
    headReadback === input.headSha ? null : 'head',
    localDefaultReadback === input.localDefaultSha ? null : 'local-default',
    indexStable
      ? null
      : semanticIndexTreeReadback === null
        ? 'index'
        : `index-tree:${input.expectedIndexTreeSha}->${semanticIndexTreeReadback}`,
    worktreeStable ? null : 'worktree',
    absentWorktreeStable ? null : 'retired-manifest'
  ].filter((entry): entry is string => entry !== null);
  if (changedInputs.length > 0) {
    throw new Error(
      `Document control freeze inputs changed before initial journal publication: ${changedInputs.join(',')}.`
    );
  }
}

export async function freezeRetiredManifestPath(
  repositoryRoot: string,
  journal: FreezeJournal
): Promise<string | null> {
  const basePointer = parseActivePointer(decodeUtf8(await requireGitBlob(
    repositoryRoot,
    `${journal.baseSha}:${ActivePointerPath}`,
    'Freeze base active pointer'
  ), 'Freeze base active pointer'));
  const nextPointer = parseActivePointer(decodeUtf8(fromBase64(
    journal.files.pointer.next,
    'Freeze pointer NEXT retirement binding'
  ), 'Freeze pointer NEXT retirement binding'));
  return basePointer.manifest === nextPointer.manifest ? null : basePointer.manifest;
}

export async function assertFreezeRetiredManifestAbsent(input: Readonly<{
  repositoryRoot: string;
  repositoryPath: string;
  treeSha: string;
  label: string;
}>): Promise<void> {
  if (await readGitBlob(input.repositoryRoot, `${input.treeSha}:${input.repositoryPath}`) !== undefined) {
    throw new Error(`${input.label} remains in the candidate tree.`);
  }
  const remaining = await inspectSafePath({
    boundaryRoot: input.repositoryRoot,
    candidatePath: path.join(input.repositoryRoot, ...input.repositoryPath.split('/')),
    label: input.label,
    finalKind: 'file',
    allowMissing: true
  });
  if (remaining !== null) throw new Error(`${input.label} remains in the worktree.`);
}
