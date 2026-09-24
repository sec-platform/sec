import fs from 'node:fs/promises';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import type { OperationDigest } from '../../../execution/operation/semantic.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
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
  readonly targetIdentityDigest: OperationDigest;
}>;

export type GitConfigEffectReceipt = Readonly<{
  readonly providerIdentityDigest: OperationDigest;
  readonly targetIdentityDigest: OperationDigest;
  readonly key: string;
  readonly valueDigest: `sha256:${string}`;
  readonly beforeDigest: `sha256:${string}`;
  readonly afterDigest: `sha256:${string}`;
  readonly writeOrdinal: number;
  readonly readbackOrdinal: number;
  readonly receiptDigest: OperationDigest;
}>;

type GitConfigTargetState = {
  readonly retained: ReturnType<typeof retainNoFollowOrdinaryFile>;
  readonly initialPhysical: Readonly<{ device: string; inode: string }>;
  readonly identityKey: string;
  consumed: boolean;
};

const GIT_CONFIG_TARGET_STATES = new WeakMap<object, GitConfigTargetState>();
const ACTIVE_GIT_CONFIG_TARGET_PATHS = new Set<string>();
const ACTIVE_GIT_CONFIG_TARGET_IDENTITIES = new Set<string>();
const ISSUED_GIT_CONFIG_EFFECT_RECEIPTS = new WeakSet<object>();

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
  ACTIVE_GIT_CONFIG_TARGET_PATHS.add(targetPath);
  let retained: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  let identityKey: string | null = null;
  try {
    const observed = await exactOrdinaryFile(targetPath);
    const observedIdentityKey = `${observed.physical.device}:${observed.physical.inode}`;
    identityKey = observedIdentityKey;
    if (ACTIVE_GIT_CONFIG_TARGET_IDENTITIES.has(observedIdentityKey)) {
      throw new Error('Git config target physical identity already has one live capability.');
    }
    ACTIVE_GIT_CONFIG_TARGET_IDENTITIES.add(observedIdentityKey);
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
    const withoutIdentity = Object.freeze({
      path: targetPath,
      initialDigest,
      initialSize: observed.bytes.byteLength,
      initialPhysical: observed.physical
    });
    const capability = Object.freeze({
      path: targetPath,
      initialDigest,
      initialSize: observed.bytes.byteLength,
      targetIdentityDigest: sha256({
        domain: 'external-capabilities.git.config-target',
        target: withoutIdentity
      }) as OperationDigest
    });
    GIT_CONFIG_TARGET_STATES.set(capability, {
      retained,
      initialPhysical: observed.physical,
      identityKey: observedIdentityKey,
      consumed: false
    });
    return capability;
  } catch (error) {
    try { retained?.dispose(); } catch { /* retain the primary admission failure */ }
    ACTIVE_GIT_CONFIG_TARGET_PATHS.delete(targetPath);
    if (identityKey !== null) ACTIVE_GIT_CONFIG_TARGET_IDENTITIES.delete(identityKey);
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
}>): Promise<GitConfigEffectReceipt> {
  assertGitConfigKeyValue(input.key, input.value);
  const targetState = GIT_CONFIG_TARGET_STATES.get(input.target);
  if (targetState === undefined || targetState.consumed) {
    throw new Error('Git config effect requires one unused owner-issued target capability.');
  }
  targetState.retained.assertCurrent();
  const before = await exactOrdinaryFile(input.target.path);
  if (before.physical.device !== targetState.initialPhysical.device
      || before.physical.inode !== targetState.initialPhysical.inode
      || rawSha256(before.bytes) !== input.target.initialDigest) {
    throw new Error('Git config target changed before effect admission.');
  }
  assertGitPhysicalResourceAdmissionInternal(input.provider, {
    processes: 2,
    inputBytes: 0,
    outputBytes: 4 * MAX_GIT_CONFIG_READBACK_BYTES
  });
  targetState.consumed = true;
  targetState.retained.dispose();
  try {
    const write = await runGitPhysicalCommandInternal(
      input.provider,
      ['config', '--file', input.target.path, '--replace-all', input.key, input.value],
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
    const afterWrite = await exactOrdinaryFile(input.target.path);
    const readback = await runGitPhysicalCommandInternal(
      input.provider,
      ['config', '--file', input.target.path, '--get-all', input.key],
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
    const afterReadback = await exactOrdinaryFile(input.target.path);
    const afterWriteDigest = rawSha256(afterWrite.bytes);
    const afterReadbackDigest = rawSha256(afterReadback.bytes);
    if (afterWriteDigest !== afterReadbackDigest
        || afterWrite.physical.device !== afterReadback.physical.device
        || afterWrite.physical.inode !== afterReadback.physical.inode) {
      throw new Error('Git config target changed after effect readback.');
    }
    const withoutDigest = Object.freeze({
      providerIdentityDigest: input.provider.identity.identityDigest,
      targetIdentityDigest: input.target.targetIdentityDigest,
      key: input.key,
      valueDigest: rawSha256(input.value),
      beforeDigest: input.target.initialDigest,
      afterDigest: afterReadbackDigest,
      writeOrdinal: write.ordinal,
      readbackOrdinal: readback.ordinal
    });
    const receipt = Object.freeze({
      ...withoutDigest,
      receiptDigest: sha256({
        domain: 'external-capabilities.git.config-effect-receipt',
        receipt: withoutDigest
      }) as OperationDigest
    });
    ISSUED_GIT_CONFIG_EFFECT_RECEIPTS.add(receipt);
    return receipt;
  } finally {
    ACTIVE_GIT_CONFIG_TARGET_PATHS.delete(input.target.path);
    ACTIVE_GIT_CONFIG_TARGET_IDENTITIES.delete(targetState.identityKey);
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
  if (state.consumed) return;
  state.retained.dispose();
  state.consumed = true;
  ACTIVE_GIT_CONFIG_TARGET_PATHS.delete(capability.path);
  ACTIVE_GIT_CONFIG_TARGET_IDENTITIES.delete(state.identityKey);
}
