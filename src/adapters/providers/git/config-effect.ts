import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import type { SecOperationDigest } from '../../../execution/operation/semantic.ts';
import { settleResources, settleResourcesAsync } from '../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  retainNoFollowFileTransaction,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowFileObservation
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { retainedNoFollowOrdinaryFilePosixMetadataForInternal } from '../../runtime-state/physical/runtime/physical-retained-file.ts';
import {
  assertGitPhysicalProviderCurrentInternal,
  assertGitPhysicalResourceAdmissionInternal,
  runGitPhysicalCommandInternal,
  type GitPhysicalProviderCapability
} from './physical-provider.ts';

const MAX_GIT_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_GIT_CONFIG_READBACK_BYTES = 64 * 1024;
const GIT_CONFIG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/u;

export type GitConfigTargetCapability = Readonly<{
  readonly path: string;
  readonly initialDigest: `sha256:${string}`;
  readonly initialSize: number;
  readonly targetIdentityDigest: SecOperationDigest;
}>;

export type GitConfigEffectReceipt = Readonly<{
  readonly providerIdentityDigest: SecOperationDigest;
  readonly targetIdentityDigest: SecOperationDigest;
  readonly key: string;
  readonly valueDigest: `sha256:${string}`;
  readonly beforeDigest: `sha256:${string}`;
  readonly afterDigest: `sha256:${string}`;
  readonly writeOrdinal: number;
  readonly readbackOrdinal: number;
  readonly receiptDigest: SecOperationDigest;
}>;

type GitConfigTargetState = {
  readonly retained: ReturnType<typeof retainNoFollowOrdinaryFile>;
  readonly initialPhysical: Readonly<{ device: string; inode: string }>;
  readonly identityKey: string;
  readonly claim: object;
  readonly initialBytes: Buffer;
  readonly initialPermissionMode: number | null;
  phase: 'idle' | 'active' | 'consumed';
};

const GIT_CONFIG_TARGET_STATES = new WeakMap<object, GitConfigTargetState>();
const ACTIVE_GIT_CONFIG_TARGET_PATHS = new Map<string, object>();
const ACTIVE_GIT_CONFIG_TARGET_IDENTITIES = new Map<string, object>();
const ISSUED_GIT_CONFIG_EFFECT_RECEIPTS = new WeakSet<object>();

function releaseClaim(registry: Map<string, object>, key: string, claim: object): void {
  if (registry.get(key) === claim) registry.delete(key);
}

type GitConfigEffectTestActor = Readonly<{ beforePublication(): void | Promise<void> }>;
const TEST_ACTORS = new WeakSet<object>();

/** Owner-issued synchronization seam; never a substitute for the real Git/native effect. */
export function createGitConfigEffectTestActorForTests(
  actor: GitConfigEffectTestActor
): GitConfigEffectTestActor {
  const issued = Object.freeze({ ...actor });
  TEST_ACTORS.add(issued);
  return issued;
}

async function exactOrdinaryFile(pathname: string): Promise<Readonly<{
  bytes: Buffer;
  physical: Readonly<{ device: string; inode: string }>;
}>> {
  const before = await fs.lstat(pathname, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Git config target is not one ordinary file.');
  }
  if (before.size > BigInt(MAX_GIT_CONFIG_BYTES)) {
    throw new Error('Git config target exceeds the canonical byte ceiling.');
  }
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(pathname),
    'Git config exact target parent'
  );
  const entry = inspectNoFollowOrdinaryFileEntry(parent.target, path.basename(pathname));
  if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
    throw new Error('Git config target is not one ordinary file.');
  }
  if (entry.size > MAX_GIT_CONFIG_BYTES) {
    throw new Error('Git config target exceeds the canonical byte ceiling.');
  }
  return Object.freeze({
    bytes: Buffer.from(entry.bytes),
    physical: Object.freeze({ device: entry.device, inode: entry.inode })
  });
}

export async function issueGitConfigTargetCapability(input: Readonly<{
  path: string;
}>): Promise<GitConfigTargetCapability> {
  const targetPath = path.resolve(input.path);
  if (!path.isAbsolute(input.path) || targetPath !== input.path) {
    throw new Error('Git config target path must be canonical and absolute.');
  }
  if (ACTIVE_GIT_CONFIG_TARGET_PATHS.has(targetPath)) {
    throw new Error('Git config target already has one live owner-issued capability.');
  }
  const claim = Object.freeze({});
  ACTIVE_GIT_CONFIG_TARGET_PATHS.set(targetPath, claim);
  let retained: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  let identityKey: string | null = null;
  try {
    const observed = await exactOrdinaryFile(targetPath);
    const observedIdentityKey = `${observed.physical.device}:${observed.physical.inode}`;
    if (ACTIVE_GIT_CONFIG_TARGET_IDENTITIES.has(observedIdentityKey)) {
      throw new Error('Git config target physical identity already has one live capability.');
    }
    ACTIVE_GIT_CONFIG_TARGET_IDENTITIES.set(observedIdentityKey, claim);
    identityKey = observedIdentityKey;
    retained = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(targetPath), 'Git config target parent'),
      path.basename(targetPath),
      observed.physical,
      'Git config target'
    );
    const digest = retained.digest();
    const initialDigest = rawSha256(observed.bytes);
    if (digest.byteDigest !== initialDigest || digest.size !== observed.bytes.byteLength) {
      throw new Error('Retained Git config target differs from its exact observed bytes.');
    }
    const metadata = retainedNoFollowOrdinaryFilePosixMetadataForInternal(retained);
    if (metadata === undefined) throw new Error('Retained Git config target permission metadata is unavailable.');
    const withoutIdentity = Object.freeze({
      path: targetPath,
      initialDigest,
      initialSize: observed.bytes.byteLength,
      initialPhysical: observed.physical,
      initialPermissionMode: metadata.mode
    });
    const capability = Object.freeze({
      path: targetPath,
      initialDigest,
      initialSize: observed.bytes.byteLength,
      targetIdentityDigest: sha256({
        domain: 'external-capabilities.git.config-target',
        target: withoutIdentity
      }) as SecOperationDigest
    });
    GIT_CONFIG_TARGET_STATES.set(capability, {
      retained,
      initialPhysical: observed.physical,
      identityKey: observedIdentityKey,
      claim,
      initialBytes: Buffer.from(observed.bytes),
      initialPermissionMode: metadata.mode,
      phase: 'idle'
    });
    return capability;
  } catch (error) {
    settleResources({
      primary: { label: 'git-config-target-admission', error },
      cleanup: [
        { label: 'git-config-retained-target', settle: () => retained?.dispose() },
        { label: 'git-config-target-claim', settle: () => {
          releaseClaim(ACTIVE_GIT_CONFIG_TARGET_PATHS, targetPath, claim);
          if (identityKey !== null) releaseClaim(ACTIVE_GIT_CONFIG_TARGET_IDENTITIES, identityKey, claim);
        } }
      ]
    });
    throw error;
  }
}

function assertGitConfigKeyValue(key: string, value: string): void {
  if (!GIT_CONFIG_KEY_PATTERN.test(key) || key.length > 512) {
    throw new Error('Git config key is not canonical.');
  }
  if (value.length > 64 * 1024 || value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error('Git config value is not one bounded line.');
  }
}

export async function replaceAllGitConfigValue(input: Readonly<{
  provider: GitPhysicalProviderCapability;
  target: GitConfigTargetCapability;
  key: string;
  value: string;
  testOnlyActor?: GitConfigEffectTestActor;
}>): Promise<GitConfigEffectReceipt> {
  assertGitConfigKeyValue(input.key, input.value);
  if (input.testOnlyActor !== undefined && !TEST_ACTORS.has(input.testOnlyActor)) {
    throw new Error('Git config effect test actor was not issued by its owner.');
  }
  const targetState = GIT_CONFIG_TARGET_STATES.get(input.target);
  if (targetState === undefined || targetState.phase !== 'idle') {
    throw new Error('Git config effect requires one unused owner-issued target capability.');
  }
  // Claim before any await: reentry and close cannot borrow this attempt's cleanup.
  targetState.phase = 'active';
  const name = path.basename(input.target.path);
  const lockName = `${name}.lock`;
  const stageName = `.${name}.${randomUUID()}.git-config-stage`;
  const stageLockName = `${stageName}.lock`;
  const lockBytes = Buffer.from(`GitConfigEffect ${randomUUID()}\n`, 'utf8');
  let transaction: ReturnType<typeof retainNoFollowFileTransaction> | null = null;
  let lock: RetainedNoFollowFileObservation | null = null;
  let stageLock: RetainedNoFollowFileObservation | null = null;
  let stage: RetainedNoFollowFileObservation | null = null;
  let stageCreated = false;
  let primary: { error: unknown } | undefined;
  try {
    targetState.retained.assertCurrent();
    assertGitPhysicalResourceAdmissionInternal(input.provider, {
      processes: 2, inputBytes: 0, outputBytes: 4 * MAX_GIT_CONFIG_READBACK_BYTES
    });
    transaction = retainNoFollowFileTransaction(path.dirname(input.target.path), 'Git config effect');
    const parent = targetState.retained.parent;
    if (transaction.rootIdentity.device !== parent.device || transaction.rootIdentity.inode !== parent.inode) {
      throw new Error('Git config target parent changed before effect admission.');
    }
    // This is Git's actual lock name. It serializes cooperative writers of this
    // exact target path, not writers using a different hard-link alias.
    lock = await transaction.createExclusive(lockName, lockBytes, 'Git config target lock');
    targetState.retained.assertCurrent();
    targetState.retained.dispose();
    const before = transaction.observe(name, 'Git config locked preimage');
    if (before === null || before.identity.device !== targetState.initialPhysical.device
        || before.identity.inode !== targetState.initialPhysical.inode
        || before.permissionMode !== targetState.initialPermissionMode
        || !Buffer.from(before.bytes).equals(targetState.initialBytes)) {
      throw new Error('Git config target changed before effect admission.');
    }
    const initialStage = publishExclusiveDurableCanonicalFile({
      parent: transaction.rootIdentity, name: stageName, bytes: targetState.initialBytes,
      validate: (bytes) => {
        if (!Buffer.from(bytes).equals(targetState.initialBytes)) throw new Error('Git config stage preimage differs.');
      }
    });
    if (!initialStage.created) throw new Error('Git config private stage is already occupied.');
    stageCreated = true;
    const stagePath = path.join(transaction.rootPath, stageName);
    const write = await runGitPhysicalCommandInternal(
      input.provider,
      ['config', '--file', stagePath, '--replace-all', input.key, input.value],
      {
        env: input.provider.environment,
        envMode: 'replace',
        maxStdoutBytes: MAX_GIT_CONFIG_READBACK_BYTES,
        maxStderrBytes: MAX_GIT_CONFIG_READBACK_BYTES
      }
    );
    if (write.result.code !== 0) {
      throw new Error(`Git config replace-all failed: ${write.result.stderr.trim() || '<empty>'}`);
    }
    // Seal the generated name against cooperative Git writers while validating
    // and publishing its exact bytes; Git's read command needs no write lock.
    stageLock = await transaction.createExclusive(stageLockName, lockBytes, 'Git config stage lock');
    const readback = await runGitPhysicalCommandInternal(
      input.provider,
      ['config', '--file', stagePath, '--get-all', input.key],
      {
        env: input.provider.environment,
        envMode: 'replace',
        maxStdoutBytes: MAX_GIT_CONFIG_READBACK_BYTES,
        maxStderrBytes: MAX_GIT_CONFIG_READBACK_BYTES
      }
    );
    if (readback.result.code !== 0) {
      throw new Error(`Git config readback failed: ${readback.result.stderr.trim() || '<empty>'}`);
    }
    const expectedReadback = Buffer.from(`${input.value}\n`, 'utf8');
    if (!Buffer.from(readback.result.stdout).equals(expectedReadback)) {
      throw new Error('Git config effect readback does not equal the requested exact value.');
    }
    // Windows Git readers do not share delete access with a transaction's
    // writable cleanup handle. Acquire that handle only after Git has exited.
    stage = transaction.observe(stageName, 'Git config generated stage');
    if (stage === null || stage.bytes.byteLength > MAX_GIT_CONFIG_BYTES) {
      throw new Error('Git config generated stage is absent or exceeds the byte ceiling.');
    }
    await transaction.flushExact(stageName, stage, 'Git config validated stage');
    await input.testOnlyActor?.beforePublication();
    transaction.assertCurrent();
    assertGitPhysicalProviderCurrentInternal(input.provider);
    const published = replaceDurableCanonicalFile({
      parent: transaction.rootIdentity, name, bytes: stage.bytes,
      expectedExisting: before.identity, expectedExistingBytes: targetState.initialBytes,
      expectedExistingPermissionMode: targetState.initialPermissionMode,
      rejectExistingHardLinks: true,
      validate: (bytes) => {
        if (!Buffer.from(bytes).equals(Buffer.from(stage!.bytes))) {
          throw new Error('Git config publication differs from the Git-validated stage.');
        }
      }
    });
    const withoutDigest = Object.freeze({
      providerIdentityDigest: input.provider.identity.identityDigest,
      targetIdentityDigest: input.target.targetIdentityDigest,
      key: input.key,
      valueDigest: rawSha256(input.value),
      beforeDigest: input.target.initialDigest,
      afterDigest: published.digest as `sha256:${string}`,
      writeOrdinal: write.ordinal,
      readbackOrdinal: readback.ordinal
    });
    const receipt = Object.freeze({
      ...withoutDigest,
      receiptDigest: sha256({
        domain: 'external-capabilities.git.config-effect-receipt',
        receipt: withoutDigest
      }) as SecOperationDigest
    });
    ISSUED_GIT_CONFIG_EFFECT_RECEIPTS.add(receipt);
    return receipt;
  } catch (error) {
    primary = { error };
    throw error;
  } finally {
    try {
      await settleResourcesAsync({
        ...(primary === undefined ? {} : { primary: { label: 'git-config-effect', error: primary.error } }),
        cleanup: [
          { label: 'git-config-retained-target', settle: () => targetState.retained.dispose() },
          { label: 'git-config-stage-lock', settle: async () => {
            if (transaction !== null && stageLock !== null) await transaction.removeExact(stageLockName, stageLock, 'Git config stage lock cleanup');
          } },
          { label: 'git-config-stage', settle: async () => {
            if (transaction !== null && stageCreated) {
              stage ??= transaction.observe(stageName, 'Git config failed stage');
              if (stage !== null) await transaction.removeExact(stageName, stage, 'Git config stage cleanup');
            }
          } },
          { label: 'git-config-target-lock', settle: async () => {
            if (transaction !== null && lock !== null) await transaction.removeExact(lockName, lock, 'Git config target lock cleanup');
          } },
          { label: 'git-config-transaction', settle: () => transaction?.dispose() }
        ]
      });
    } finally {
      targetState.phase = 'consumed';
      releaseClaim(ACTIVE_GIT_CONFIG_TARGET_PATHS, input.target.path, targetState.claim);
      releaseClaim(ACTIVE_GIT_CONFIG_TARGET_IDENTITIES, targetState.identityKey, targetState.claim);
    }
  }
}

export function assertGitConfigEffectReceipt(receipt: GitConfigEffectReceipt): void {
  if (receipt === null || typeof receipt !== 'object'
      || !ISSUED_GIT_CONFIG_EFFECT_RECEIPTS.has(receipt)) {
    throw new Error('Git config settlement requires one owner-issued terminal receipt.');
  }
}

export function closeGitConfigTargetCapability(
  capability: GitConfigTargetCapability
): void {
  const state = GIT_CONFIG_TARGET_STATES.get(capability);
  if (state === undefined) {
    throw new Error('Git config target close requires one owner-issued capability.');
  }
  if (state.phase === 'consumed') return;
  if (state.phase === 'active') throw new Error('Git config target cannot close during its active effect.');
  state.phase = 'consumed';
  try { state.retained.dispose(); } finally {
    releaseClaim(ACTIVE_GIT_CONFIG_TARGET_PATHS, capability.path, state.claim);
    releaseClaim(ACTIVE_GIT_CONFIG_TARGET_IDENTITIES, state.identityKey, state.claim);
  }
}
