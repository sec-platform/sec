import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan, issueSemanticOperationAttemptContext, type OperationDigest } from '../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import { linuxRuntimeToolCopyScript } from '../../../providers/linux-verification/runtime-tools.ts';
import { createExclusiveNoFollowDirectory, inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, type PhysicalDirectoryIdentity } from './physical-no-follow.ts';
import { openProcessResourceSession } from './process-resource-session.ts';
import { issueRetainedCommandBoundary } from './process.ts';

export interface MainHealthHostRuntimeManifest {
  readonly schema: 'sec-main-health-host-runtime-manifest-v1';
  readonly platform: 'linux/amd64';
  readonly files: readonly (
    | Readonly<{ path: string; type: 'directory'; mode: number }>
    | Readonly<{ path: string; type: 'file'; mode: number; size: number; digest: `sha256:${string}` }>
    | Readonly<{ path: string; type: 'symlink'; mode: 0o777; target: string }>
  )[];
}
const brand: unique symbol = Symbol('main-health-host-runtime');
export interface MainHealthHostRuntime {
  readonly [brand]: true;
  readonly runtime: Readonly<{ root: PhysicalDirectoryIdentity; manifest: MainHealthHostRuntimeManifest; manifestDigest: `sha256:${string}` }>;
  readonly source: Readonly<{ root: string; headSha: string; treeSha: string }>;
}
const issued = new WeakMap<object, { assertCurrent(): void; retire(): void }>();
/** Preserve the original owner and locator when preparation cannot prove release. */
export class MainHealthHostRuntimePreparationError extends Error {
  readonly code = 'MAIN-HEALTH-HOST-RUNTIME-RECOVERY-REQUIRED';
  constructor(cause: unknown, readonly recoveryRoot: PhysicalDirectoryIdentity | undefined,
    readonly retainedOwner: Readonly<{ session: ReturnType<typeof openProcessResourceSession>;
      retainedInputs: readonly { dispose(): void }[]; runtime: MainHealthHostRuntime | undefined }>) {
    super(`MainHealth host runtime preparation remains unresolved at ${recoveryRoot?.path ?? 'source preflight before runtime allocation'}.`, { cause });
    this.name = 'MainHealthHostRuntimePreparationError';
    Object.freeze(retainedOwner);
  }
}
const REQUIREMENT = 'verification.main-health.host-runtime';
const CEILINGS = Object.freeze([
  { resource: 'duration-ms' as const, maximum: 1_800_000 },
  { resource: 'input-bytes' as const, maximum: 1_048_576 },
  { resource: 'output-bytes' as const, maximum: 1_048_576 },
  { resource: 'processes' as const, maximum: 16 }
]);
const SCRIPT = ['set -euo pipefail', 'root="$1"', 'bun_host="$2"',
  'mkdir -p "$root/tmp" "$root/tool/bin"', ...linuxRuntimeToolCopyScript('independent-files'),
  'copy_runtime "/usr/bin/unshare" "/usr/bin/unshare"',
  'copy_runtime "$bun_host" "/usr/local/bin/bun"',
  'rmdir "$root/tmp"', 'chmod -R go-w -- "$root"'].join('\n');
const CONTRACT = sha256({ requirement: REQUIREMENT, script: SCRIPT, transport: 'actual-host-bytes-not-native-accepted-content' });
const ENVIRONMENT = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' });

export function assertMainHealthHostRuntime(value: MainHealthHostRuntime): void {
  const owner = issued.get(value);
  if (owner === undefined) throw new Error('MainHealth host runtime is not owner-issued.');
  owner.assertCurrent();
}
export function retireMainHealthHostRuntime(value: MainHealthHostRuntime): void {
  const owner = issued.get(value);
  if (owner === undefined) throw new Error('MainHealth host runtime is not owner-issued.');
  owner.retire();
}

/** Snapshot existing tools only. No install, native qualification or accepted-content claim. */
export async function prepareMainHealthHostRuntime(input: Readonly<{
  sourceRoot: string; expectedHeadSha: string; deadlineAtUnixMs: number; signal?: AbortSignal;
}>): Promise<MainHealthHostRuntime> {
  if (process.platform !== 'linux' || process.arch !== 'x64' || !/^[0-9a-f]{40}$/u.test(input.expectedHeadSha)
      || !Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now()
      || input.deadlineAtUnixMs > Date.now() + CEILINGS[0]!.maximum) throw new Error('MainHealth host runtime platform, source or deadline is invalid.');
  const source = inspectNoFollowDirectoryChain(input.sourceRoot);
  if (path.resolve(input.sourceRoot) !== input.sourceRoot) throw new Error('MainHealth source root is not canonical.');
  const allocated: Array<{ dispose(): void }> = [];
  const allocate = <T extends { dispose(): void }>(value: T): T => { allocated.push(value); return value; };
  let bash: ReturnType<typeof retainNoFollowOrdinaryFile>;
  let git: ReturnType<typeof retainNoFollowOrdinaryFile>;
  let bun: ReturnType<typeof retainNoFollowOrdinaryFile>;
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess>;
  let session: ReturnType<typeof openProcessResourceSession>;
  try {
  bash = allocate(retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain('/usr/bin'), 'bash', undefined, 'MainHealth Bash', 3, 'executable'));
  git = allocate(retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain('/usr/bin'), 'git', undefined, 'MainHealth Git', 3, 'executable'));
  const bunPath = realpathSync.native(process.execPath);
  bun = allocate(retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(bunPath)), path.basename(bunPath), undefined, 'MainHealth Bun', 5));
  cwd = allocate(retainNoFollowDirectoryForChildProcess(source, 4));
  const requirement = { id: REQUIREMENT, contractDigest: CONTRACT as OperationDigest, effectKinds: ['process', 'filesystem'] as const,
    failureKinds: ['main-health.host-runtime-preparation', 'main-health.host-runtime-retirement'] };
  const operation = bindSemanticOperation(compileSemanticOperationPlan({ operation: REQUIREMENT,
    intentDigest: sha256({ source: source.target, headSha: input.expectedHeadSha, bun: bun.digest(), script: CONTRACT }) as OperationDigest,
    decisionDigest: CONTRACT as OperationDigest, deadlineAtUnixMs: input.deadlineAtUnixMs, aggregateBudgets: CEILINGS,
    requirements: [requirement], attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: CONTRACT as OperationDigest })
  }), [compileCapabilityBinding({ requirementId: REQUIREMENT, contractDigest: CONTRACT as OperationDigest,
    providerIdentityDigest: sha256({ bash: bash.physical, git: git.physical, bun: bun.physical, cwd: source.target }) as OperationDigest })]);
  session = openProcessResourceSession({ operation, signal: input.signal,
    requirementBindingContext: issueOperationRequirementBindingContext({ operation, requirementId: REQUIREMENT, resourceCeilings: CEILINGS }) });
  } catch (error) {
    settleResources({ primary: { label: 'MainHealth tool retention', error }, cleanup: allocated.reverse().map(value => ({ label: 'MainHealth partial retained input', settle: () => value.dispose() })) });
    throw error;
  }
  let root: PhysicalDirectoryIdentity | undefined;
  let processSettled = false;
  let inputsRetired = 0;
  let retirementAttempted = false;
  let result: MainHealthHostRuntime | undefined;
  let primary: { label: string; error: unknown } | undefined;
  const inventory = () => scanNoFollowDirectoryTreeInventory(root!, { deadlineAtMs: performance.now() + Math.max(0, input.deadlineAtUnixMs - Date.now()),
    maximumBytes: 4_294_967_296, maximumEntries: 100_000, includePermissionMode: true, includeByteDigest: true, signal: input.signal });
  const retire = () => { if (root !== undefined) { retirementAttempted = true; retireNoFollowDirectoryTree({ root, parent: inspectNoFollowDirectoryChain('/tmp').target,
    inventory: inventory(), restoreOwnerPermissions: true, deadlineAtMonotonicMs: performance.now() + Math.max(1, input.deadlineAtUnixMs - Date.now()) }); root = undefined; } };
  try {
    const gitBoundary = issueRetainedCommandBoundary({ executable: git, workingDirectory: cwd });
    const read = async (args: readonly string[]): Promise<string> => {
      const value = await session.run(gitBoundary, ['--no-replace-objects', ...args], { envMode: 'replace', env: ENVIRONMENT, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
      if (value.result.code !== 0) throw new Error('MainHealth source preflight failed.');
      return Buffer.from(value.result.stdout).toString('utf8').trim();
    };
    const head = await read(['rev-parse', '--verify', 'HEAD^{commit}']);
    const tree = await read(['rev-parse', '--verify', 'HEAD^{tree}']);
    if (head !== input.expectedHeadSha || await read(['status', '--porcelain=v1', '--untracked-files=all']) !== '') throw new Error('MainHealth source differs from exact clean main.');
    root = createExclusiveNoFollowDirectory(inspectNoFollowDirectoryChain('/tmp').target, 'sec-main-health-runtime-' + randomUUID().replaceAll('-', ''));
    const boundary = issueRetainedCommandBoundary({ executable: bash, workingDirectory: cwd, auxiliaryInputs: [{ kind: 'ordinary-file', capability: bun }] });
    const copied = await session.run(boundary, ['-ceu', SCRIPT, 'sec-main-health-host-runtime', root.path, bun.childPath], {
      envMode: 'replace', env: ENVIRONMENT, maxStdoutBytes: 65536, maxStderrBytes: 65536,
      beforeSpawn: async () => { bun.assertCurrent(); cwd.assertCurrent(); } });
    if (copied.result.code !== 0) throw new Error('MainHealth existing tool snapshot failed: ' + Buffer.from(copied.result.stderr).toString('utf8').slice(-4096));
    const observed = inventory();
    bun.assertCurrent();
    const bunDigest = bun.digest().byteDigest;
    const files = observed.map(entry => {
      if (entry.kind === 'link' && entry.linkTarget !== null) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.relativePath), entry.linkTarget));
        if (entry.linkTarget.startsWith('/') || resolved === '..' || resolved.startsWith('../')) throw new Error('MainHealth runtime link escapes its private snapshot.');
        return Object.freeze({ path: entry.relativePath, type: 'symlink' as const, mode: 0o777 as const, target: entry.linkTarget });
      }
      if (entry.kind !== 'directory' && entry.kind !== 'file') throw new Error('MainHealth runtime contains an unsupported entry.');
      const mode = entry.permissionMode;
      if (mode === undefined || mode === null) throw new Error('MainHealth runtime permission observation is unavailable.');
      if (entry.kind === 'directory') return Object.freeze({ path: entry.relativePath, type: 'directory' as const, mode });
      if (entry.byteDigest !== undefined) return Object.freeze({ path: entry.relativePath, type: 'file' as const, mode, size: entry.size, digest: entry.byteDigest });
      throw new Error('MainHealth runtime contains an unsupported entry.');
    });
    const manifest: MainHealthHostRuntimeManifest = Object.freeze({ schema: 'sec-main-health-host-runtime-manifest-v1', platform: 'linux/amd64', files: Object.freeze(files) });
    if (!['usr/local/bin/bun', 'tool/bin/bun'].every(name => files.some(entry => entry.path === name && entry.type === 'file' && entry.digest === bunDigest))
        || await read(['rev-parse', '--verify', 'HEAD^{commit}']) !== head || await read(['rev-parse', '--verify', 'HEAD^{tree}']) !== tree
        || await read(['status', '--porcelain=v1', '--untracked-files=all']) !== '') throw new Error('MainHealth source or Bun snapshot changed.');
    const generation = sha256(observed);
    result = Object.freeze({ [brand]: true as const, runtime: Object.freeze({ root, manifest, manifestDigest: sha256(manifest) }), source: Object.freeze({ root: input.sourceRoot, headSha: head, treeSha: tree }) });
    issued.set(result, { assertCurrent() { if (root === undefined || sha256(inventory()) !== generation) throw new Error('MainHealth host runtime changed or retired.'); }, retire });
  } catch (error) { primary = { label: 'MainHealth host runtime', error }; }
  try {
    settleResources({ primary, cleanup: [{ label: 'MainHealth tool session', settle: () => { session.close(); processSettled = true; } },
      ...allocated.reverse().map(value => ({ label: 'MainHealth retained tool input', settle: () => {
        if (!processSettled) throw new Error('MainHealth unsettled process still retains its original tool input.');
        value.dispose();
        inputsRetired += 1;
      } })),
      ...(primary === undefined ? [] : [{ label: 'MainHealth failed runtime snapshot', settle: () => {
        if (!processSettled) throw new Error('MainHealth runtime input remains borrowed by an unsettled process owner.');
        retire();
      } }])] });
  } catch (error) {
    // Delivery failed after a successful snapshot. Release it only after the
    // original process owner proved terminal; never retry a failed retirement.
    if (processSettled && root !== undefined && !retirementAttempted) {
      try { settleResources({ primary: { label: 'MainHealth preparation delivery', error },
        cleanup: [{ label: 'MainHealth undelivered runtime snapshot', settle: retire }] }); }
      catch (combined) { error = combined; }
    }
    if (root !== undefined || !processSettled || inputsRetired !== allocated.length) throw new MainHealthHostRuntimePreparationError(error, root,
      { session, retainedInputs: Object.freeze([...allocated]), runtime: result });
    throw error;
  }
  return result!;
}
