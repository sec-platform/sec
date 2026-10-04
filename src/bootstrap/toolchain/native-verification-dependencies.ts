import { fstatSync, lstatSync, realpathSync } from 'node:fs';

import { linuxImmutableRepositoryInputPrerequisites } from '../../adapters/runtime-state/physical/runtime/linux-immutable-repository-input.ts';
import { directoryTreeEntryPosixOwnership } from '../../adapters/runtime-state/physical/runtime/physical-directory-tree.ts';
import { linuxRetainedFilesystemObservation } from '../../adapters/runtime-state/physical/runtime/physical-no-follow-native.ts';
import {
  assertPhysicalGenerationRetirementReceipt,
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry,
  type RetainedNoFollowOrdinaryFile
} from '../../adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  observeCompilerDependencyExecutionGenerationAuthority,
  projectCompilerDepsReadyState,
  type CompilerDepsReadyState
} from '../../adapters/toolchain/dependencies/runtime.ts';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  runtimeDependencyOperationRemainingMs
} from '../../adapters/toolchain/dependencies/runtime/operation-controls.ts';
import {
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
  runtimeDependencySourceGeneration,
  runtimeDependencyTreeIdentity
} from '../../adapters/toolchain/dependencies/runtime/source-generation.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import { canonicalJson, compareCodeUnits, sha256 } from '../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../contracts/exact-json.ts';
import { CodedFailure } from '../../contracts/failure.ts';
import { withOwnedByteStreamReader } from '../../execution/stream-reader.ts';
import { createDependencyOperation } from './dependency-operation.ts';

const TRUSTED_ROOT = '/sec-runtime/trusted';
const WORKSPACE_ROOT = '/sec-runtime/workspace';
const CONTENT_ROOT = '/sec-runtime/dependency-content';
const INPUT_ROOT = '/authenticated-input';
const MANIFEST_NAME = 'dependency-content-manifest.json';
const MAXIMUM_PACKET_BYTES = 4_096;
const MAXIMUM_MANIFEST_BYTES = 32 * 1024 * 1024;
const KINDS = Object.freeze([
  'source-program', 'verification-action', 'main-health', 'hosted-sut', 'dependency-canary'
] as const);
type Kind = (typeof KINDS)[number];
type Digest = `sha256:${string}`;
type Request = Readonly<{
  schema: 'sec-native-verification-dependency-setup-v1';
  phase: 'prepare' | 'observe';
  kind: Kind;
  deadlineAtUnixMs: number;
  transportDigest: Digest;
}>;
type ContentEntry = Readonly<{ path: string; mode: number }> & (
  | Readonly<{ type: 'directory' }>
  | Readonly<{ type: 'file'; size: number; digest: Digest }>
  | Readonly<{ type: 'symlink'; target: string }>
);

function fail(message: string): never {
  throw new CodedFailure('RUNTIME-DEPS-004', `Native dependency setup: ${message}`);
}

/** This wire request chooses only a fixed operation. It grants no compiler,
 * transport, process, filesystem or privileged execution authority. */
export function parseNativeVerificationDependencyRequest(bytes: Uint8Array): Request {
  const value = parseExactJsonBytes(bytes, 'Native dependency setup request', {
    maximumInputBytes: MAXIMUM_PACKET_BYTES, maximumDepth: 2
  }, { rootObjectKeys: ['schema', 'phase', 'kind', 'deadlineAtUnixMs', 'transportDigest'] }) as Partial<Request>;
  if (value.schema !== 'sec-native-verification-dependency-setup-v1'
      || (value.phase !== 'prepare' && value.phase !== 'observe')
      || !KINDS.some(kind => kind === value.kind)
      || !Number.isSafeInteger(value.deadlineAtUnixMs) || value.deadlineAtUnixMs! <= 0
      || typeof value.transportDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(value.transportDigest)) fail('request fields are invalid');
  return Object.freeze(value as Request);
}

function assertSetupProcess(phase: Request['phase']): void {
  if (process.platform !== 'linux' || process.arch !== 'x64'
      || process.getuid?.() !== 65_532 || process.geteuid?.() !== 65_532
      || process.getgid?.() !== 65_532 || process.getegid?.() !== 65_532
      || !linuxImmutableRepositoryInputPrerequisites()
      || realpathSync(process.execPath) !== '/usr/local/bin/bun'
      || compilerRoot !== TRUSTED_ROOT || process.cwd() !== TRUSTED_ROOT
      || (phase === 'prepare'
        ? process.env.NODE_PATH !== `${CONTENT_ROOT}/node_modules`
        : process.env.NODE_PATH !== undefined)
      || process.env.SEC_STATE_HOME !== '/sec-runtime/output/state'
      || process.env.SEC_CACHE_HOME !== '/sec-runtime/output/cache') {
    fail('fixed nonprivileged execution identity is unavailable');
  }
}

function assertManifestFile(file: RetainedNoFollowOrdinaryFile): void {
  file.assertCurrent();
  if (file.stdioSourceDescriptor === null) fail('manifest has no retained Linux descriptor');
  const metadata = fstatSync(file.stdioSourceDescriptor, { bigint: true });
  if (!metadata.isFile() || metadata.uid !== 0n || metadata.gid !== 0n
      || (metadata.mode & 0o7777n) !== 0o444n || metadata.nlink !== 1n
      || metadata.size < 1n || metadata.size > BigInt(MAXIMUM_MANIFEST_BYTES)
      || String(metadata.dev) !== file.physical.device || String(metadata.ino) !== file.physical.inode) {
    fail('transport manifest is not one bounded root-owned immutable ordinary file');
  }
}

/** Provenance comes from the fixed trusted helper's retained input mapping,
 * never from a caller-supplied digest or an arbitrary manifest pathname. */
function retainTransportManifest(): RetainedNoFollowOrdinaryFile {
  const parent = inspectNoFollowDirectoryChain(INPUT_ROOT, 'Native dependency authenticated input');
  for (const directory of [inspectNoFollowDirectoryChain('/').target, ...parent.ancestors, parent.target]) {
    const metadata = lstatSync(directory.path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0n
        || metadata.gid !== 0n || (metadata.mode & 0o022n) !== 0n
        || String(metadata.dev) !== directory.device || String(metadata.ino) !== directory.inode) {
      fail('authenticated input ancestry is not root-owned and writer-excluded');
    }
  }
  const file = retainNoFollowOrdinaryFile(parent, MANIFEST_NAME, undefined,
    'Native dependency authenticated content manifest');
  try { assertManifestFile(file); return file; }
  catch (error) { file.dispose(); throw error; }
}

function contentEntries(inventory: readonly NoFollowDirectoryTreeInventoryEntry[]): readonly ContentEntry[] {
  return Object.freeze(inventory.map(entry => {
    if (entry.kind === 'link') {
      // The original inventory intentionally omits POSIX permission projection
      // for symlinks. Observe the exact leaf instead of rejecting normal .bin
      // links or inventing their mode from the transport manifest.
      const metadata = lstatSync(`${CONTENT_ROOT}/${entry.relativePath}`, { bigint: true });
      if (!metadata.isSymbolicLink() || String(metadata.dev) !== entry.device
          || String(metadata.ino) !== entry.inode || entry.linkTarget === null) {
        return fail('transport symlink identity changed during mode readback');
      }
      return Object.freeze({ path: entry.relativePath, mode: Number(metadata.mode & 0o7777n),
        type: 'symlink' as const, target: entry.linkTarget });
    }
    if (entry.permissionMode === null || entry.permissionMode === undefined) {
      return fail('transport inventory has no native mode observation');
    }
    const base = { path: entry.relativePath, mode: entry.permissionMode };
    if (entry.kind === 'directory') return Object.freeze({ ...base, type: 'directory' as const });
    if (entry.kind === 'file') {
      if (entry.byteDigest === undefined) return fail('transport inventory has no raw byte digest');
      return Object.freeze({ ...base, type: 'file' as const, size: entry.size, digest: entry.byteDigest });
    }
    return fail('transport inventory has an unsupported entry');
  }).sort((left, right) => compareCodeUnits(left.path, right.path)));
}

/** The original Linux physical issuer performs real fchmod operations even
 * when modes already match. Its source must therefore still be a private,
 * setup-principal-owned writable tmpfs, not a root-owned or RO transport mount.
 * This observes its prerequisites; it never changes permissions or supplies a
 * replacement proof. The native helper seals the same superblock only after
 * publication and fresh observation have both settled. */
function assertPreparationContent(inventory: readonly NoFollowDirectoryTreeInventoryEntry[]): void {
  const root = inspectNoFollowDirectoryChain(CONTENT_ROOT, 'Native dependency private setup content');
  const retained = retainNoFollowDirectoryForChildProcess(root, 15, 'Native dependency private setup content');
  try {
    if (retained.stdioSourceDescriptor === null) fail('content has no retained Linux directory');
    const metadata = fstatSync(retained.stdioSourceDescriptor, { bigint: true });
    const filesystem = linuxRetainedFilesystemObservation(retained.stdioSourceDescriptor);
    if (metadata.uid !== 65_532n || metadata.gid !== 65_532n
        || filesystem.type !== 0x01021994n || (filesystem.flags & 1n) !== 0n) {
      fail('original content publisher requires setup-owned writable private tmpfs');
    }
    for (const entry of inventory) {
      if (entry.kind === 'link') continue;
      const ownership = directoryTreeEntryPosixOwnership(entry);
      if (ownership === undefined || ownership.ownerUserId !== 65_532n || ownership.ownerGroupId !== 65_532n) {
        fail('original content publisher does not own every chmod target');
      }
    }
    retained.assertCurrent();
  } finally { retained.dispose(); }
}

function assertTransportContents(input: Readonly<{
  file: RetainedNoFollowOrdinaryFile;
  inventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  request: Request;
}>): void {
  assertManifestFile(input.file);
  const manifest = parseExactJsonBytes(input.file.readBytes(), 'Native dependency transport manifest', {
    maximumInputBytes: MAXIMUM_MANIFEST_BYTES, maximumDepth: 4
  }, { rootObjectKeys: ['schema', 'bundleDigest', 'nodeModulesArchiveDigest', 'entries', 'contentDigest', 'transportDigest'] }) as Record<string, unknown>;
  const entries = contentEntries(input.inventory);
  const validDigest = (value: unknown): value is Digest => typeof value === 'string'
    && /^sha256:[0-9a-f]{64}$/u.test(value);
  if (manifest.schema !== 'sec-native-dependency-content-transport-v1'
      || !validDigest(manifest.bundleDigest) || !validDigest(manifest.nodeModulesArchiveDigest)
      || !validDigest(manifest.contentDigest) || !validDigest(manifest.transportDigest)
      || manifest.contentDigest !== sha256(entries)
      || JSON.stringify(canonicalJson(manifest.entries)) !== JSON.stringify(canonicalJson(entries))
      || manifest.transportDigest !== sha256({ bundleDigest: manifest.bundleDigest,
        nodeModulesArchiveDigest: manifest.nodeModulesArchiveDigest, contentDigest: manifest.contentDigest })
      || manifest.transportDigest !== input.request.transportDigest) {
    fail('authenticated transport content differs from its observed input mapping');
  }
  assertManifestFile(input.file);
}

function projection(ready: CompilerDepsReadyState) {
  return Object.freeze({ generationDigest: ready.executionGenerationAuthority.generationDigest,
    manifestHash: ready.manifestHash, transitionDigest: ready.transitionDigest,
    requiresFreshProcess: ready.requiresFreshProcess });
}

async function execute(request: Request): Promise<unknown> {
  assertSetupProcess(request.phase);
  const controls = runtimeDependencyOperationControls({ deadlineAtUnixMs: request.deadlineAtUnixMs });
  const context = runtimeDependencyOperationContext(controls);
  const remaining = () => runtimeDependencyOperationRemainingMs(controls, 'Native dependency setup');
  const workspaceRequired = request.kind !== 'source-program' && request.kind !== 'dependency-canary';
  const manifest = retainTransportManifest();
  try {
    remaining();
    const content = inspectNoFollowDirectoryChain(CONTENT_ROOT, 'Native dependency content root').target;
    const inventory = () => scanNoFollowDirectoryTreeInventory(content, {
      deadlineAtMs: context.deadlineAtMonotonicMs,
      maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
      maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      includePermissionMode: true, includeByteDigest: true, signal: context.signal
    });
    const observed = inventory();
    assertTransportContents({ file: manifest, inventory: observed, request });
    let trusted: CompilerDepsReadyState;
    let workspace: CompilerDepsReadyState | null = null;
    let contentRetirement: 'released' | 'not-retained' = 'not-retained';
    if (request.phase === 'prepare') {
      const source = await runtimeDependencySourceGeneration({ binding: {
        schema: 'sec-native-dependency-content-transport-v1', transportDigest: request.transportDigest
      }, ownerRoot: CONTENT_ROOT, sourcePath: CONTENT_ROOT, options: controls });
      const currentInventory = inventory();
      const currentTree = runtimeDependencyTreeIdentity(currentInventory);
      if (currentTree.treeDigest !== source.treeDigest || currentTree.treeEntryCount !== source.treeEntryCount) {
        fail('transport content changed before original physical publication');
      }
      assertTransportContents({ file: manifest, inventory: currentInventory, request });
      assertPreparationContent(currentInventory);
      const retained = await materializeRetainedNoFollowProvenDirectoryGeneration({
        root: content, inventory: currentInventory, proofText: null,
        binding: { generationDigest: source.epoch, treeDigest: source.treeDigest, treeEntryCount: source.treeEntryCount },
        deadlineAtUnixMs: context.deadlineAtUnixMs, signal: context.signal
      });
      let primary: unknown;
      let failed = false;
      let prepared: CompilerDepsReadyState | undefined;
      try {
        const operation = createDependencyOperation({ workspaceRoot: TRUSTED_ROOT });
        prepared = await operation.ensureCompilerDepsReadyFromRetainedContent(retained.generation,
          { deadlineAtUnixMs: context.deadlineAtUnixMs, installMode: 'offline-copy-only' });
        if (workspaceRequired) {
          workspace = await createDependencyOperation({ workspaceRoot: WORKSPACE_ROOT })
            .ensureCompilerDepsReadyFromGeneration(prepared.executionGenerationAuthority,
              { deadlineAtUnixMs: context.deadlineAtUnixMs, installMode: 'offline-copy-only' });
        }
        await retained.generation.assertAuthorityCurrent();
        assertTransportContents({ file: manifest, inventory: inventory(), request });
      } catch (error) { primary = error; failed = true; }
      try {
        assertPhysicalGenerationRetirementReceipt(await retained.generation.retire());
        contentRetirement = 'released';
      } catch (error) {
        if (failed) throw new AggregateError([primary, error], 'Native dependency setup and content retirement failed');
        throw error;
      }
      if (failed) throw primary;
      trusted = prepared!;
    } else {
      const observe = async (root: string): Promise<CompilerDepsReadyState> => {
        const authority = await observeCompilerDependencyExecutionGenerationAuthority(
          { deadlineAtUnixMs: context.deadlineAtUnixMs }, root);
        if (authority === null) fail('original compiler owner has no current published generation');
        const ready = projectCompilerDepsReadyState(authority);
        if (ready.requiresFreshProcess) fail('fresh observation still requires another process transition');
        return ready;
      };
      trusted = await observe(TRUSTED_ROOT);
      if (workspaceRequired) {
        workspace = await observe(WORKSPACE_ROOT);
        if (workspace.executionGenerationAuthority.generationDigest !== trusted.executionGenerationAuthority.generationDigest) {
          fail('workspace does not consume the original trusted compiler generation');
        }
      }
      assertTransportContents({ file: manifest, inventory: inventory(), request });
    }
    remaining();
    assertSameNoFollowDirectoryIdentity(content, 'Native dependency content terminal root');
    return Object.freeze({ schema: 'sec-native-verification-dependency-result-v1', authority: 'projection-only',
      phase: request.phase, kind: request.kind, deadlineAtUnixMs: request.deadlineAtUnixMs,
      transportDigest: request.transportDigest, status: request.phase === 'prepare' ? 'prepared' : 'observed',
      contentRetirement, trusted: projection(trusted), workspace: workspace === null ? null : projection(workspace) });
  } finally { manifest.dispose(); }
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2) fail('the fixed entry accepts no command-line arguments');
    // The original native-unit manager bounds this input read by the same
    // aggregate deadline. No new timeout or independent execution budget starts.
    const requestBytes = await withOwnedByteStreamReader(Bun.stdin.stream(), async (read) => {
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      while (true) {
        const next = await read();
        if (next.done) break;
        byteLength += next.value.byteLength;
        if (byteLength > MAXIMUM_PACKET_BYTES) fail('request exceeds its byte budget');
        chunks.push(next.value);
      }
      return Buffer.concat(chunks, byteLength);
    });
    const request = parseNativeVerificationDependencyRequest(requestBytes);
    const result = `${JSON.stringify(canonicalJson(await execute(request)))}\n`;
    if (Buffer.byteLength(result) > MAXIMUM_PACKET_BYTES) fail('result exceeds its byte budget');
    process.stdout.write(result);
  } catch (error) {
    process.stderr.write(`${error instanceof CodedFailure ? error.code : 'RUNTIME-DEPS-004'}: ${
      (error instanceof Error ? error.message : 'Native dependency setup failed').slice(0, 2_048)}\n`);
    process.exitCode = 1;
  }
}
