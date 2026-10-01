import path from 'node:path';

import { canonicalJson } from '../../../../contracts/canonical.ts';
import type { PhysicalMutationLeaseOwner } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import type { PhysicalDirectoryChain, PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

import { errorMessage, GitHookTransitionConflict } from './transition-conflict.ts';

/**
 * Immutable installation/recovery values only. Decoding proves the durable
 * format and expected transition order, never current physical ownership.
 * install.ts alone reads/publishes these records and owns every live lease,
 * config effect, generation publication and recovery/retirement decision.
 */
export const MANAGED_HOOKS_PATH = '.githooks';

export const MANAGED_PRE_COMMIT = MANAGED_HOOKS_PATH + '/pre-commit';

export const MANAGED_HOOKS = [
  MANAGED_PRE_COMMIT,
  MANAGED_HOOKS_PATH + '/pre-push',
  MANAGED_HOOKS_PATH + '/post-checkout',
  MANAGED_HOOKS_PATH + '/post-merge',
  MANAGED_HOOKS_PATH + '/post-rewrite'
] as const;

export const MANAGED_GENERATION_NAMES = MANAGED_HOOKS.map((hook) => path.basename(hook));

export const CONFIG_TRANSITION_DIRECTORY_PREFIX = 'config-transition-';

export const CONFIG_TRANSITION_PREPARED_FILE = 'prepared';

export const CONFIG_TRANSITION_INTENT_FILE = 'intent';

export const CONFIG_TRANSITION_COMPLETE_FILE = 'complete';

const CONFIG_TRANSITION_STEP_PREFIX = 'step-';

const CONFIG_TRANSITION_RETIRE_INTENT_PREFIX = 'retire-';

const CONFIG_TRANSITION_RETIRED_PREFIX = 'retired-';

export const MANAGED_GENERATION_NAME = /^generation-[0-9a-f]{64}(?:-[0-9a-f-]{36})?$/u;

export interface HookMarkerRecord {
  readonly digest: string;
  readonly fingerprint: string;
  readonly generationName: string;
}

export interface HookConfigState {
  readonly worktreeConfig: string | null;
  readonly commonHooksPath: string | null;
  readonly worktreeHooksPath: string | null;
}

export interface PhysicalFileObservation {
  readonly state: 'absent' | 'present';
  readonly device: string | null;
  readonly inode: string | null;
  readonly size: number | null;
  readonly byteDigest: string | null;
}

export interface ConfigPhysicalBoundary {
  readonly repoRoot: PhysicalDirectoryChain;
  readonly commonGitDir: PhysicalDirectoryChain;
  readonly worktreeGitDir: PhysicalDirectoryChain;
  readonly commonConfigParent: PhysicalDirectoryChain;
  readonly worktreeConfigParent: PhysicalDirectoryChain;
  readonly commonConfig: PhysicalFileObservation;
  readonly worktreeConfig: PhysicalFileObservation;
}

export interface ConfigFileLockRecord {
  readonly schema: 'sec-managed-hook-config-lock-v1';
  readonly operationDigest: string;
  readonly stepIndex: number;
  readonly scope: 'local' | 'worktree';
  readonly configPath: string;
  readonly configParentKey: string;
  readonly configName: string;
  readonly stageName: string;
  readonly preimage: PhysicalFileObservation;
  readonly owner: PhysicalMutationLeaseOwner;
}

export interface ConfigTransitionStep {
  readonly index: number;
  readonly scope: 'local' | 'worktree';
  readonly key: keyof HookConfigState;
  readonly configKey: string;
  readonly value: string;
  readonly before: HookConfigState;
  readonly after: HookConfigState;
}

export interface GenerationPhysicalFile {
  readonly name: string;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly byteDigest: string;
}

export interface GenerationPhysicalEvidence {
  readonly path: string;
  readonly chain: PhysicalDirectoryChain;
  readonly files: readonly GenerationPhysicalFile[];
}

export interface ConfigTransitionIntent {
  readonly schema: 'sec-managed-hook-config-transition-v1';
  readonly operationDigest: string;
  readonly commonRoot: string;
  readonly commonRootKey: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: GenerationPhysicalEvidence;
  readonly bootstrapGeneration: GenerationPhysicalEvidence;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
  readonly steps: readonly ConfigTransitionStep[];
}

/**
 * Durable admission record written before a generation directory is created.
 * It intentionally carries no generation chain or file identity: those
 * physical facts do not exist yet.  The planned path/digest/source bytes are
 * nevertheless immutable, so a restart may adopt only the exact publication
 * it authorized and may never infer ownership from a generation name.
 */
export interface ConfigTransitionGenerationPlan {
  readonly path: string;
  readonly digest: string;
  readonly fingerprint: string;
  readonly files: readonly Readonly<{
    readonly name: string;
    readonly size: number;
    readonly byteDigest: string;
  }>[];
}

export interface ConfigTransitionPreparedIntent {
  readonly schema: 'sec-managed-hook-config-prepared-v1';
  readonly operationDigest: string;
  readonly commonRoot: string;
  readonly commonRootKey: string;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: ConfigTransitionGenerationPlan;
  readonly bootstrapGeneration: ConfigTransitionGenerationPlan;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}

export interface PriorGenerationEvidence {
  readonly digest: string;
  readonly evidence: GenerationPhysicalEvidence;
}

export interface ConfigTransitionRetireIntent {
  readonly schema: 'sec-managed-hook-config-retire-intent-v1';
  readonly operationDigest: string;
  readonly index: number;
  readonly digest: string;
  readonly path: string;
}

export interface ConfigTransitionRetiredReceipt {
  readonly schema: 'sec-managed-hook-config-retired-v1';
  readonly operationDigest: string;
  readonly index: number;
  readonly digest: string;
  readonly path: string;
}

export interface ConfigTransitionReceipt {
  readonly schema: 'sec-managed-hook-config-step-v1';
  readonly operationDigest: string;
  readonly index: number;
  readonly after: HookConfigState;
  readonly boundary: ConfigPhysicalBoundary;
}

export interface ConfigTransitionCompleteReceipt {
  readonly schema: 'sec-managed-hook-config-complete-v1';
  readonly operationDigest: string;
  readonly target: HookConfigState;
  readonly boundary: ConfigPhysicalBoundary;
}

export function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

export function pathWithin(parent: string, child: string): boolean {
  const parentPath = canonicalPath(parent);
  const childPath = canonicalPath(child);
  if (parentPath === childPath) return true;
  const separator = path.sep;
  return childPath.startsWith(parentPath.endsWith(separator) ? parentPath : parentPath + separator);
}

function physicalIdentityKey(identity: PhysicalDirectoryIdentity): string {
  return [
    canonicalPath(identity.path),
    canonicalPath(identity.finalPath),
    identity.device,
    identity.inode,
    identity.objectId
  ].join('\0');
}

export function physicalChainKey(chain: PhysicalDirectoryChain): string {
  return chain.ancestors.map(physicalIdentityKey).join('\0');
}

export function sameIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return physicalIdentityKey(left) === physicalIdentityKey(right);
}

export function sameChain(left: PhysicalDirectoryChain, right: PhysicalDirectoryChain): boolean {
  return physicalChainKey(left) === physicalChainKey(right);
}

export function sameLeaseOwner(
  left: PhysicalMutationLeaseOwner,
  right: PhysicalMutationLeaseOwner
): boolean {
  return left.schema === right.schema
    && left.host === right.host
    && left.pid === right.pid
    && left.processNonce === right.processNonce
    && left.token === right.token
    && left.createdAtMs === right.createdAtMs
    && left.expiresAtMs === right.expiresAtMs;
}

export function samePhysicalFileObservation(
  left: PhysicalFileObservation,
  right: PhysicalFileObservation
): boolean {
  return left.state === right.state
    && left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.byteDigest === right.byteDigest;
}

export function generationNameMatchesDigest(generationPath: string, digest: string): boolean {
  const name = path.basename(generationPath);
  return MANAGED_GENERATION_NAME.test(name)
    && (name === 'generation-' + digest || name.startsWith('generation-' + digest + '-'));
}

export function markerBytes(record: HookMarkerRecord): Buffer {
  return Buffer.from(record.digest + '\n' + record.fingerprint + '\n' + record.generationName + '\n', 'utf8');
}

export function parseMarkerBytes(bytes: Uint8Array): HookMarkerRecord | null {
  const lines = Buffer.from(bytes).toString('utf8').split('\n');
  const digest = lines[0]?.trim();
  const fingerprint = lines[1]?.trim();
  const generationName = lines[2]?.trim();
  if (
    lines.length !== 4
    || lines[3] !== ''
    || digest === undefined
    || !/^[0-9a-f]{64}$/u.test(digest)
    || fingerprint === undefined
    || !/^[0-9a-f]{64}$/u.test(fingerprint)
    || generationName === undefined
    || !MANAGED_GENERATION_NAME.test(generationName)
  ) return null;
  return Object.freeze({ digest, fingerprint, generationName });
}

export function generationPlanFromEvidence(
  evidence: GenerationPhysicalEvidence,
  digest: string,
  fingerprint: string
): ConfigTransitionGenerationPlan {
  if (!generationNameMatchesDigest(evidence.path, digest) || !/^[0-9a-f]{64}$/u.test(fingerprint)) {
    throw new GitHookTransitionConflict('Managed generation evidence cannot reconstruct its prepared plan');
  }
  return Object.freeze({
    path: evidence.path,
    digest,
    fingerprint,
    files: Object.freeze(evidence.files.map((file) => Object.freeze({
      name: file.name,
      size: file.size,
      byteDigest: file.byteDigest
    })))
  });
}

export function sameHookConfigState(left: HookConfigState, right: HookConfigState): boolean {
  return left.worktreeConfig === right.worktreeConfig
    && left.commonHooksPath === right.commonHooksPath
    && left.worktreeHooksPath === right.worktreeHooksPath;
}

export function sameHookMarker(left: HookMarkerRecord, right: HookMarkerRecord): boolean {
  return left.digest === right.digest
    && left.fingerprint === right.fingerprint
    && left.generationName === right.generationName;
}

function ownKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new GitHookTransitionConflict(label + ' has a non-canonical shape');
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHookTransitionConflict(label + ' is not an object');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new GitHookTransitionConflict(label + ' is not a string');
  return value;
}

export function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalJson(value)) + '\n', 'utf8');
}

function stateRecord(state: HookConfigState): HookConfigState {
  return Object.freeze({
    worktreeConfig: state.worktreeConfig,
    commonHooksPath: state.commonHooksPath,
    worktreeHooksPath: state.worktreeHooksPath
  });
}

function parseHookConfigState(value: unknown, label: string): HookConfigState {
  const record = recordValue(value, label);
  ownKeys(record, ['worktreeConfig', 'commonHooksPath', 'worktreeHooksPath'], label);
  for (const key of ['worktreeConfig', 'commonHooksPath', 'worktreeHooksPath'] as const) {
    if (record[key] !== null && typeof record[key] !== 'string') {
      throw new GitHookTransitionConflict(label + '.' + key + ' is not nullable string');
    }
  }
  return stateRecord({
    worktreeConfig: record.worktreeConfig as string | null,
    commonHooksPath: record.commonHooksPath as string | null,
    worktreeHooksPath: record.worktreeHooksPath as string | null
  });
}

function parseHookMarkerRecord(value: unknown, label: string): HookMarkerRecord {
  const record = recordValue(value, label);
  ownKeys(record, ['digest', 'fingerprint', 'generationName'], label);
  const digest = stringValue(record.digest, label + '.digest');
  const fingerprint = stringValue(record.fingerprint, label + '.fingerprint');
  const generationName = stringValue(record.generationName, label + '.generationName');
  if (
    !/^[0-9a-f]{64}$/u.test(digest)
    || !/^[0-9a-f]{64}$/u.test(fingerprint)
    || !MANAGED_GENERATION_NAME.test(generationName)
  ) {
    throw new GitHookTransitionConflict(label + ' contains an invalid marker identity');
  }
  return Object.freeze({ digest, fingerprint, generationName });
}

function parseGenerationPhysicalEvidence(
  value: unknown,
  label: string
): GenerationPhysicalEvidence {
  const record = recordValue(value, label);
  ownKeys(record, ['path', 'chain', 'files'], label);
  const pathName = stringValue(record.path, label + '.path');
  if (!path.isAbsolute(pathName)) {
    throw new GitHookTransitionConflict(label + '.path is not absolute');
  }
  const chain = parsePhysicalChain(record.chain, label + '.chain');
  if (!Array.isArray(record.files) || record.files.length !== MANAGED_GENERATION_NAMES.length) {
    throw new GitHookTransitionConflict(label + '.files has an invalid count');
  }
  const files = record.files.map((value, index) => {
    const fileLabel = label + '.files[' + index + ']';
    const file = recordValue(value, fileLabel);
    ownKeys(file, ['name', 'device', 'inode', 'size', 'byteDigest'], fileLabel);
    const name = stringValue(file.name, fileLabel + '.name');
    if (name !== MANAGED_GENERATION_NAMES[index]) {
      throw new GitHookTransitionConflict(fileLabel + '.name is not in canonical generation order');
    }
    const device = stringValue(file.device, fileLabel + '.device');
    const inode = stringValue(file.inode, fileLabel + '.inode');
    const size = file.size;
    const byteDigest = stringValue(file.byteDigest, fileLabel + '.byteDigest');
    if (
      device.length === 0
      || inode.length === 0
      || !Number.isSafeInteger(size)
      || (size as number) < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(byteDigest)
    ) {
      throw new GitHookTransitionConflict(fileLabel + ' has invalid physical file evidence');
    }
    return Object.freeze({ name, device, inode, size: size as number, byteDigest });
  });
  if (canonicalPath(chain.target.path) !== canonicalPath(pathName)) {
    throw new GitHookTransitionConflict(label + '.chain does not target .path');
  }
  return Object.freeze({ path: pathName, chain, files: Object.freeze(files) });
}

function parseGenerationPlan(
  value: unknown,
  label: string
): ConfigTransitionGenerationPlan {
  const record = recordValue(value, label);
  ownKeys(record, ['path', 'digest', 'fingerprint', 'files'], label);
  const pathName = stringValue(record.path, label + '.path');
  const digest = stringValue(record.digest, label + '.digest');
  const fingerprint = stringValue(record.fingerprint, label + '.fingerprint');
  if (
    !path.isAbsolute(pathName)
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !generationNameMatchesDigest(pathName, digest)
    || !/^[0-9a-f]{64}$/u.test(fingerprint)
  ) {
    throw new GitHookTransitionConflict(label + ' is not an exact digest-bound generation plan');
  }
  if (!Array.isArray(record.files) || record.files.length !== MANAGED_GENERATION_NAMES.length) {
    throw new GitHookTransitionConflict(label + '.files has an invalid count');
  }
  const files = record.files.map((value, index) => {
    const fileLabel = label + '.files[' + index + ']';
    const file = recordValue(value, fileLabel);
    ownKeys(file, ['name', 'size', 'byteDigest'], fileLabel);
    const name = stringValue(file.name, fileLabel + '.name');
    const size = file.size;
    const byteDigest = stringValue(file.byteDigest, fileLabel + '.byteDigest');
    if (
      name !== MANAGED_GENERATION_NAMES[index]
      || !Number.isSafeInteger(size)
      || (size as number) < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(byteDigest)
    ) {
      throw new GitHookTransitionConflict(fileLabel + ' contains invalid planned file identity');
    }
    return Object.freeze({ name, size: size as number, byteDigest });
  });
  return Object.freeze({ path: pathName, digest, fingerprint, files: Object.freeze(files) });
}

function parsePriorGenerationEvidenceList(
  value: unknown,
  commonRoot: string,
  label: string
): readonly PriorGenerationEvidence[] {
  if (!Array.isArray(value)) {
    throw new GitHookTransitionConflict(label + ' is not an array');
  }
  return Object.freeze(value.map((entryValue, index) => {
    const priorLabel = label + '[' + index + ']';
    const prior = recordValue(entryValue, priorLabel);
    ownKeys(prior, ['digest', 'evidence'], priorLabel);
    const digest = stringValue(prior.digest, priorLabel + '.digest');
    if (!/^[0-9a-f]{64}$/u.test(digest)) {
      throw new GitHookTransitionConflict(priorLabel + '.digest is invalid');
    }
    const evidence = parseGenerationPhysicalEvidence(prior.evidence, priorLabel + '.evidence');
    if (!generationNameMatchesDigest(evidence.path, digest) || !pathWithin(commonRoot, evidence.path)) {
      throw new GitHookTransitionConflict(priorLabel + ' path does not match its digest');
    }
    return Object.freeze({ digest, evidence });
  }));
}

export function parseConfigTransitionPreparedIntent(
  bytes: Uint8Array,
  label: string
): ConfigTransitionPreparedIntent {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, [
    'schema',
    'operationDigest',
    'commonRoot',
    'commonRootKey',
    'repoRoot',
    'commonGitDir',
    'worktreeGitDir',
    'worktreeConfigPath',
    'preimage',
    'target',
    'initialBoundary',
    'markerRoot',
    'bootstrapMarkerRoot',
    'marker',
    'bootstrapMarker',
    'generation',
    'bootstrapGeneration',
    'priorGenerations'
  ], label);
  if (record.schema !== 'sec-managed-hook-config-prepared-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  if (!/^[0-9a-f]{64}$/u.test(operationDigest)) {
    throw new GitHookTransitionConflict(label + '.operationDigest is invalid');
  }
  const commonRoot = stringValue(record.commonRoot, label + '.commonRoot');
  const repoRoot = stringValue(record.repoRoot, label + '.repoRoot');
  const commonGitDir = stringValue(record.commonGitDir, label + '.commonGitDir');
  const worktreeGitDir = stringValue(record.worktreeGitDir, label + '.worktreeGitDir');
  const worktreeConfigPath = stringValue(record.worktreeConfigPath, label + '.worktreeConfigPath');
  if ([commonRoot, repoRoot, commonGitDir, worktreeGitDir, worktreeConfigPath].some((value) => !path.isAbsolute(value))) {
    throw new GitHookTransitionConflict(label + ' contains a non-absolute path');
  }
  const candidate = Object.freeze({
    schema: 'sec-managed-hook-config-prepared-v1' as const,
    operationDigest,
    commonRoot,
    commonRootKey: stringValue(record.commonRootKey, label + '.commonRootKey'),
    repoRoot,
    commonGitDir,
    worktreeGitDir,
    worktreeConfigPath,
    preimage: parseHookConfigState(record.preimage, label + '.preimage'),
    target: parseHookConfigState(record.target, label + '.target'),
    initialBoundary: parseConfigPhysicalBoundary(record.initialBoundary, label + '.initialBoundary'),
    markerRoot: parsePhysicalChain(record.markerRoot, label + '.markerRoot'),
    bootstrapMarkerRoot: parsePhysicalChain(record.bootstrapMarkerRoot, label + '.bootstrapMarkerRoot'),
    marker: parseHookMarkerRecord(record.marker, label + '.marker'),
    bootstrapMarker: parseHookMarkerRecord(record.bootstrapMarker, label + '.bootstrapMarker'),
    generation: parseGenerationPlan(record.generation, label + '.generation'),
    bootstrapGeneration: parseGenerationPlan(record.bootstrapGeneration, label + '.bootstrapGeneration'),
    priorGenerations: parsePriorGenerationEvidenceList(
      record.priorGenerations,
      commonRoot,
      label + '.priorGenerations'
    )
  });
  if (!Buffer.from(bytes).equals(jsonBytes(candidate))) {
    throw new GitHookTransitionConflict(label + ' is not canonically encoded');
  }
  return candidate;
}

function parsePhysicalIdentity(value: unknown, label: string): PhysicalDirectoryIdentity {
  const record = recordValue(value, label);
  ownKeys(record, ['path', 'finalPath', 'device', 'inode', 'objectId'], label);
  const pathName = stringValue(record.path, label + '.path');
  const finalPath = stringValue(record.finalPath, label + '.finalPath');
  if (!path.isAbsolute(pathName) || !path.isAbsolute(finalPath)) {
    throw new GitHookTransitionConflict(label + ' contains a non-absolute path');
  }
  return Object.freeze({
    path: pathName,
    finalPath,
    device: stringValue(record.device, label + '.device'),
    inode: stringValue(record.inode, label + '.inode'),
    objectId: stringValue(record.objectId, label + '.objectId')
  });
}

function parsePhysicalChain(value: unknown, label: string): PhysicalDirectoryChain {
  const record = recordValue(value, label);
  ownKeys(record, ['target', 'ancestors'], label);
  if (!Array.isArray(record.ancestors) || record.ancestors.length === 0) {
    throw new GitHookTransitionConflict(label + '.ancestors is empty or not an array');
  }
  const target = parsePhysicalIdentity(record.target, label + '.target');
  const ancestors = Object.freeze(record.ancestors.map((entry, index) => (
    parsePhysicalIdentity(entry, label + '.ancestors[' + index + ']')
  )));
  if (!sameIdentity(target, ancestors.at(-1)!)) {
    throw new GitHookTransitionConflict(label + ' target is not its final ancestor');
  }
  return Object.freeze({ target, ancestors });
}

function parsePhysicalFileObservation(value: unknown, label: string): PhysicalFileObservation {
  const record = recordValue(value, label);
  ownKeys(record, ['state', 'device', 'inode', 'size', 'byteDigest'], label);
  const state = record.state;
  if (state !== 'absent' && state !== 'present') {
    throw new GitHookTransitionConflict(label + '.state is invalid');
  }
  if (state === 'absent') {
    if (record.device !== null || record.inode !== null || record.size !== null || record.byteDigest !== null) {
      throw new GitHookTransitionConflict(label + ' absent observation carries present identity');
    }
    return Object.freeze({ state, device: null, inode: null, size: null, byteDigest: null });
  }
  if (typeof record.device !== 'string' || typeof record.inode !== 'string'
      || !Number.isSafeInteger(record.size) || (record.size as number) < 0
      || typeof record.byteDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(record.byteDigest)) {
    throw new GitHookTransitionConflict(label + ' present observation is invalid');
  }
  return Object.freeze({
    state,
    device: record.device,
    inode: record.inode,
    size: record.size as number,
    byteDigest: record.byteDigest
  });
}

function parseConfigPhysicalBoundary(value: unknown, label: string): ConfigPhysicalBoundary {
  const record = recordValue(value, label);
  ownKeys(record, [
    'repoRoot',
    'commonGitDir',
    'worktreeGitDir',
    'commonConfigParent',
    'worktreeConfigParent',
    'commonConfig',
    'worktreeConfig'
  ], label);
  return Object.freeze({
    repoRoot: parsePhysicalChain(record.repoRoot, label + '.repoRoot'),
    commonGitDir: parsePhysicalChain(record.commonGitDir, label + '.commonGitDir'),
    worktreeGitDir: parsePhysicalChain(record.worktreeGitDir, label + '.worktreeGitDir'),
    commonConfigParent: parsePhysicalChain(record.commonConfigParent, label + '.commonConfigParent'),
    worktreeConfigParent: parsePhysicalChain(record.worktreeConfigParent, label + '.worktreeConfigParent'),
    commonConfig: parsePhysicalFileObservation(record.commonConfig, label + '.commonConfig'),
    worktreeConfig: parsePhysicalFileObservation(record.worktreeConfig, label + '.worktreeConfig')
  });
}

export function configBoundaryKey(boundary: ConfigPhysicalBoundary): string {
  return JSON.stringify(boundary);
}

function configStepDefinitions(): readonly Readonly<{
  readonly scope: 'local' | 'worktree';
  readonly key: keyof HookConfigState;
  readonly configKey: string;
}>[] {
  return Object.freeze([
    { scope: 'local', key: 'worktreeConfig', configKey: 'extensions.worktreeConfig' },
    { scope: 'local', key: 'commonHooksPath', configKey: 'core.hooksPath' },
    { scope: 'worktree', key: 'worktreeHooksPath', configKey: 'core.hooksPath' }
  ] as const);
}

function makeConfigTransitionSteps(
  preimage: HookConfigState,
  target: HookConfigState
): readonly ConfigTransitionStep[] {
  let before = stateRecord(preimage);
  const steps: ConfigTransitionStep[] = [];
  for (const [index, definition] of configStepDefinitions().entries()) {
    const value = target[definition.key];
    if (typeof value !== 'string') {
      throw new GitHookTransitionConflict('Git hook config target is missing ' + definition.configKey);
    }
    const after = stateRecord({ ...before, [definition.key]: value });
    steps.push(Object.freeze({
      index,
      scope: definition.scope,
      key: definition.key,
      configKey: definition.configKey,
      value,
      before,
      after
    }));
    before = after;
  }
  return Object.freeze(steps);
}

export function makeConfigTransitionIntent(input: {
  readonly operationDigest: string;
  readonly commonRoot: PhysicalDirectoryChain;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: GenerationPhysicalEvidence;
  readonly bootstrapGeneration: GenerationPhysicalEvidence;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}): ConfigTransitionIntent {
  return Object.freeze({
    schema: 'sec-managed-hook-config-transition-v1',
    operationDigest: input.operationDigest,
    commonRoot: input.commonRoot.target.path,
    commonRootKey: physicalChainKey(input.commonRoot),
    repoRoot: input.repoRoot,
    commonGitDir: input.commonGitDir,
    worktreeGitDir: input.worktreeGitDir,
    worktreeConfigPath: input.worktreeConfigPath,
    preimage: stateRecord(input.preimage),
    target: stateRecord(input.target),
    initialBoundary: input.initialBoundary,
    markerRoot: input.markerRoot,
    bootstrapMarkerRoot: input.bootstrapMarkerRoot,
    marker: input.marker,
    bootstrapMarker: input.bootstrapMarker,
    generation: input.generation,
    bootstrapGeneration: input.bootstrapGeneration,
    priorGenerations: Object.freeze(input.priorGenerations.map((prior) => Object.freeze({
      digest: prior.digest,
      evidence: prior.evidence
    }))),
    steps: makeConfigTransitionSteps(input.preimage, input.target)
  });
}

export function makeConfigTransitionPreparedIntent(input: {
  readonly operationDigest: string;
  readonly commonRoot: PhysicalDirectoryChain;
  readonly repoRoot: string;
  readonly commonGitDir: string;
  readonly worktreeGitDir: string;
  readonly worktreeConfigPath: string;
  readonly preimage: HookConfigState;
  readonly target: HookConfigState;
  readonly initialBoundary: ConfigPhysicalBoundary;
  readonly markerRoot: PhysicalDirectoryChain;
  readonly bootstrapMarkerRoot: PhysicalDirectoryChain;
  readonly marker: HookMarkerRecord;
  readonly bootstrapMarker: HookMarkerRecord;
  readonly generation: ConfigTransitionGenerationPlan;
  readonly bootstrapGeneration: ConfigTransitionGenerationPlan;
  readonly priorGenerations: readonly PriorGenerationEvidence[];
}): ConfigTransitionPreparedIntent {
  return Object.freeze({
    schema: 'sec-managed-hook-config-prepared-v1',
    operationDigest: input.operationDigest,
    commonRoot: input.commonRoot.target.path,
    commonRootKey: physicalChainKey(input.commonRoot),
    repoRoot: input.repoRoot,
    commonGitDir: input.commonGitDir,
    worktreeGitDir: input.worktreeGitDir,
    worktreeConfigPath: input.worktreeConfigPath,
    preimage: stateRecord(input.preimage),
    target: stateRecord(input.target),
    initialBoundary: input.initialBoundary,
    markerRoot: input.markerRoot,
    bootstrapMarkerRoot: input.bootstrapMarkerRoot,
    marker: input.marker,
    bootstrapMarker: input.bootstrapMarker,
    generation: input.generation,
    bootstrapGeneration: input.bootstrapGeneration,
    priorGenerations: Object.freeze(input.priorGenerations.map((prior) => Object.freeze({
      digest: prior.digest,
      evidence: prior.evidence
    })))
  });
}

export function transitionDirectoryName(operationDigest: string): string {
  if (!/^[0-9a-f]{64}$/u.test(operationDigest)) {
    throw new GitHookTransitionConflict('Config transition operation digest is invalid');
  }
  return CONFIG_TRANSITION_DIRECTORY_PREFIX + operationDigest;
}

function parseCanonicalJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new GitHookTransitionConflict(label + ' is not valid UTF-8 JSON: ' + errorMessage(error));
  }
  const record = recordValue(parsed, label);
  if (!Buffer.from(bytes).equals(jsonBytes(record))) {
    throw new GitHookTransitionConflict(label + ' is not canonical durable JSON');
  }
  return record;
}

export function configFileLockName(configName: string): string {
  return configName + '.lock';
}

export function configStageName(operationDigest: string, stepIndex: number): string {
  if (!/^[0-9a-f]{64}$/u.test(operationDigest) || !Number.isSafeInteger(stepIndex) || stepIndex < 0) {
    throw new GitHookTransitionConflict('Git config stage identity is invalid');
  }
  return '.sec-managed-hook-config-' + operationDigest + '-' + stepIndex + '.tmp';
}

function parsePhysicalMutationLeaseOwner(
  value: unknown,
  label: string
): PhysicalMutationLeaseOwner {
  const record = recordValue(value, label);
  ownKeys(record, [
    'schema',
    'host',
    'pid',
    'processNonce',
    'token',
    'createdAtMs',
    'expiresAtMs'
  ], label);
  if (
    record.schema !== 'sec-physical-mutation-lease-v1'
    || typeof record.host !== 'string'
    || record.host.length === 0
    || !Number.isSafeInteger(record.pid)
    || (record.pid as number) <= 0
    || typeof record.processNonce !== 'string'
    || !/^[0-9a-f-]{36}$/u.test(record.processNonce)
    || typeof record.token !== 'string'
    || !/^[0-9a-f-]{36}$/u.test(record.token)
    || !Number.isSafeInteger(record.createdAtMs)
    || (record.createdAtMs as number) < 0
    || !Number.isSafeInteger(record.expiresAtMs)
    || (record.expiresAtMs as number) < (record.createdAtMs as number)
  ) {
    throw new GitHookTransitionConflict(label + ' is not a canonical physical lease owner');
  }
  return Object.freeze({
    schema: 'sec-physical-mutation-lease-v1',
    host: record.host,
    pid: record.pid as number,
    processNonce: record.processNonce,
    token: record.token,
    createdAtMs: record.createdAtMs as number,
    expiresAtMs: record.expiresAtMs as number
  });
}

export function parseConfigFileLock(
  bytes: Uint8Array,
  label: string
): ConfigFileLockRecord {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, [
    'schema',
    'operationDigest',
    'stepIndex',
    'scope',
    'configPath',
    'configParentKey',
    'configName',
    'stageName',
    'preimage',
    'owner'
  ], label);
  if (
    record.schema !== 'sec-managed-hook-config-lock-v1'
    || typeof record.operationDigest !== 'string'
    || !/^[0-9a-f]{64}$/u.test(record.operationDigest)
    || !Number.isSafeInteger(record.stepIndex)
    || (record.stepIndex as number) < 0
    || (record.scope !== 'local' && record.scope !== 'worktree')
    || typeof record.configPath !== 'string'
    || !path.isAbsolute(record.configPath)
    || typeof record.configParentKey !== 'string'
    || record.configParentKey.length === 0
    || typeof record.configName !== 'string'
    || typeof record.stageName !== 'string'
    || record.stageName !== configStageName(record.operationDigest, record.stepIndex as number)
  ) {
    throw new GitHookTransitionConflict(label + ' has an invalid canonical lock identity');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-lock-v1',
    operationDigest: record.operationDigest,
    stepIndex: record.stepIndex as number,
    scope: record.scope,
    configPath: record.configPath,
    configParentKey: record.configParentKey,
    configName: record.configName,
    stageName: record.stageName,
    preimage: parsePhysicalFileObservation(record.preimage, label + '.preimage'),
    owner: parsePhysicalMutationLeaseOwner(record.owner, label + '.owner')
  });
}

function parseConfigTransitionStep(value: unknown, label: string): ConfigTransitionStep {
  const record = recordValue(value, label);
  ownKeys(record, ['index', 'scope', 'key', 'configKey', 'value', 'before', 'after'], label);
  if (!Number.isSafeInteger(record.index) || (record.index as number) < 0) {
    throw new GitHookTransitionConflict(label + '.index is invalid');
  }
  if (record.scope !== 'local' && record.scope !== 'worktree') {
    throw new GitHookTransitionConflict(label + '.scope is invalid');
  }
  if (!['worktreeConfig', 'commonHooksPath', 'worktreeHooksPath'].includes(String(record.key))) {
    throw new GitHookTransitionConflict(label + '.key is invalid');
  }
  const key = record.key as keyof HookConfigState;
  const definition = configStepDefinitions()[(record.index as number)];
  if (
    definition === undefined
    || definition.scope !== record.scope
    || definition.key !== key
    || definition.configKey !== record.configKey
  ) {
    throw new GitHookTransitionConflict(label + ' does not match the canonical config step order');
  }
  return Object.freeze({
    index: record.index as number,
    scope: record.scope,
    key,
    configKey: stringValue(record.configKey, label + '.configKey'),
    value: stringValue(record.value, label + '.value'),
    before: parseHookConfigState(record.before, label + '.before'),
    after: parseHookConfigState(record.after, label + '.after')
  });
}

export function parseConfigTransitionIntent(bytes: Uint8Array, label: string): ConfigTransitionIntent {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, [
    'schema',
    'operationDigest',
    'commonRoot',
    'commonRootKey',
    'repoRoot',
    'commonGitDir',
    'worktreeGitDir',
    'worktreeConfigPath',
    'preimage',
    'target',
    'initialBoundary',
    'markerRoot',
    'bootstrapMarkerRoot',
    'marker',
    'bootstrapMarker',
    'generation',
    'bootstrapGeneration',
    'priorGenerations',
    'steps'
  ], label);
  if (record.schema !== 'sec-managed-hook-config-transition-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  if (!/^[0-9a-f]{64}$/u.test(operationDigest)) {
    throw new GitHookTransitionConflict(label + '.operationDigest is invalid');
  }
  const commonRoot = stringValue(record.commonRoot, label + '.commonRoot');
  const repoRoot = stringValue(record.repoRoot, label + '.repoRoot');
  const commonGitDir = stringValue(record.commonGitDir, label + '.commonGitDir');
  const worktreeGitDir = stringValue(record.worktreeGitDir, label + '.worktreeGitDir');
  const worktreeConfigPath = stringValue(record.worktreeConfigPath, label + '.worktreeConfigPath');
  if ([commonRoot, repoRoot, commonGitDir, worktreeGitDir, worktreeConfigPath].some((value) => !path.isAbsolute(value))) {
    throw new GitHookTransitionConflict(label + ' contains a non-absolute path');
  }
  const preimage = parseHookConfigState(record.preimage, label + '.preimage');
  const target = parseHookConfigState(record.target, label + '.target');
  const initialBoundary = parseConfigPhysicalBoundary(record.initialBoundary, label + '.initialBoundary');
  const markerRoot = parsePhysicalChain(record.markerRoot, label + '.markerRoot');
  const bootstrapMarkerRoot = parsePhysicalChain(record.bootstrapMarkerRoot, label + '.bootstrapMarkerRoot');
  const marker = parseHookMarkerRecord(record.marker, label + '.marker');
  const bootstrapMarker = parseHookMarkerRecord(record.bootstrapMarker, label + '.bootstrapMarker');
  const generation = parseGenerationPhysicalEvidence(record.generation, label + '.generation');
  const bootstrapGeneration = parseGenerationPhysicalEvidence(
    record.bootstrapGeneration,
    label + '.bootstrapGeneration'
  );
  const priorGenerations = parsePriorGenerationEvidenceList(
    record.priorGenerations,
    commonRoot,
    label + '.priorGenerations'
  );
  if (!Array.isArray(record.steps) || record.steps.length !== configStepDefinitions().length) {
    throw new GitHookTransitionConflict(label + '.steps has an invalid count');
  }
  const steps = Object.freeze(record.steps.map((step, index) => (
    parseConfigTransitionStep(step, label + '.steps[' + index + ']')
  )));
  const expectedSteps = makeConfigTransitionSteps(preimage, target);
  if (JSON.stringify(steps) !== JSON.stringify(expectedSteps)) {
    throw new GitHookTransitionConflict(label + '.steps do not match its preimage and target');
  }
  const candidate = Object.freeze({
    schema: 'sec-managed-hook-config-transition-v1' as const,
    operationDigest,
    commonRoot,
    commonRootKey: stringValue(record.commonRootKey, label + '.commonRootKey'),
    repoRoot,
    commonGitDir,
    worktreeGitDir,
    worktreeConfigPath,
    preimage,
    target,
    initialBoundary,
    markerRoot,
    bootstrapMarkerRoot,
    marker,
    bootstrapMarker,
    generation,
    bootstrapGeneration,
    priorGenerations,
    steps
  });
  if (!Buffer.from(bytes).equals(jsonBytes(candidate))) {
    throw new GitHookTransitionConflict(label + ' is not canonically encoded');
  }
  return candidate;
}

export function parseConfigTransitionReceipt(bytes: Uint8Array, label: string): ConfigTransitionReceipt {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'index', 'after', 'boundary'], label);
  if (record.schema !== 'sec-managed-hook-config-step-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  if (!Number.isSafeInteger(record.index) || (record.index as number) < 0) {
    throw new GitHookTransitionConflict(label + '.index is invalid');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-step-v1',
    operationDigest: stringValue(record.operationDigest, label + '.operationDigest'),
    index: record.index as number,
    after: parseHookConfigState(record.after, label + '.after'),
    boundary: parseConfigPhysicalBoundary(record.boundary, label + '.boundary')
  });
}

export function parseConfigTransitionComplete(
  bytes: Uint8Array,
  label: string
): ConfigTransitionCompleteReceipt {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'target', 'boundary'], label);
  if (record.schema !== 'sec-managed-hook-config-complete-v1') {
    throw new GitHookTransitionConflict(label + ' schema is not recognized');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-complete-v1',
    operationDigest: stringValue(record.operationDigest, label + '.operationDigest'),
    target: parseHookConfigState(record.target, label + '.target'),
    boundary: parseConfigPhysicalBoundary(record.boundary, label + '.boundary')
  });
}

export function parseConfigTransitionRetireIntent(
  bytes: Uint8Array,
  label: string
): ConfigTransitionRetireIntent {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'index', 'digest', 'path'], label);
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  const digest = stringValue(record.digest, label + '.digest');
  const pathName = stringValue(record.path, label + '.path');
  if (
    record.schema !== 'sec-managed-hook-config-retire-intent-v1'
    || !/^[0-9a-f]{64}$/u.test(operationDigest)
    || !Number.isSafeInteger(record.index)
    || (record.index as number) < 0
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !path.isAbsolute(pathName)
  ) {
    throw new GitHookTransitionConflict(label + ' has an invalid retirement identity');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-retire-intent-v1',
    operationDigest,
    index: record.index as number,
    digest,
    path: pathName
  });
}

export function parseConfigTransitionRetiredReceipt(
  bytes: Uint8Array,
  label: string
): ConfigTransitionRetiredReceipt {
  const record = parseCanonicalJson(bytes, label);
  ownKeys(record, ['schema', 'operationDigest', 'index', 'digest', 'path'], label);
  const operationDigest = stringValue(record.operationDigest, label + '.operationDigest');
  const digest = stringValue(record.digest, label + '.digest');
  const pathName = stringValue(record.path, label + '.path');
  if (
    record.schema !== 'sec-managed-hook-config-retired-v1'
    || !/^[0-9a-f]{64}$/u.test(operationDigest)
    || !Number.isSafeInteger(record.index)
    || (record.index as number) < 0
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !path.isAbsolute(pathName)
  ) {
    throw new GitHookTransitionConflict(label + ' has an invalid retired identity');
  }
  return Object.freeze({
    schema: 'sec-managed-hook-config-retired-v1',
    operationDigest,
    index: record.index as number,
    digest,
    path: pathName
  });
}

export function transitionIntentMatches(
  actual: ConfigTransitionIntent,
  expected: ConfigTransitionIntent
): boolean {
  return actual.schema === expected.schema
    && actual.operationDigest === expected.operationDigest
    && canonicalPath(actual.commonRoot) === canonicalPath(expected.commonRoot)
    && actual.commonRootKey === expected.commonRootKey
    && canonicalPath(actual.repoRoot) === canonicalPath(expected.repoRoot)
    && canonicalPath(actual.commonGitDir) === canonicalPath(expected.commonGitDir)
    && canonicalPath(actual.worktreeGitDir) === canonicalPath(expected.worktreeGitDir)
    && canonicalPath(actual.worktreeConfigPath) === canonicalPath(expected.worktreeConfigPath)
    && sameHookConfigState(actual.preimage, expected.preimage)
    && sameHookConfigState(actual.target, expected.target)
    && configBoundaryKey(actual.initialBoundary) === configBoundaryKey(expected.initialBoundary)
    && sameChain(actual.markerRoot, expected.markerRoot)
    && sameChain(actual.bootstrapMarkerRoot, expected.bootstrapMarkerRoot)
    && JSON.stringify(actual.marker) === JSON.stringify(expected.marker)
    && JSON.stringify(actual.bootstrapMarker) === JSON.stringify(expected.bootstrapMarker)
    && JSON.stringify(actual.generation) === JSON.stringify(expected.generation)
    && JSON.stringify(actual.bootstrapGeneration) === JSON.stringify(expected.bootstrapGeneration)
    && JSON.stringify(actual.priorGenerations) === JSON.stringify(expected.priorGenerations);
}

export function preparedIntentMatches(
  actual: ConfigTransitionPreparedIntent,
  expected: ConfigTransitionPreparedIntent
): boolean {
  return JSON.stringify(canonicalJson(actual)) === JSON.stringify(canonicalJson(expected));
}

/**
 * A config effect may legitimately advance the physical config boundary
 * before its immutable step receipt is published.  During that recovery
 * window the durable preimage remains authoritative; only the publication
 * identity may be compared with a fresh invocation.  Never replace the
 * durable preimage with the post-effect observation.
 */
export function preparedPublicationIdentityMatches(
  actual: ConfigTransitionPreparedIntent,
  expected: ConfigTransitionPreparedIntent
): boolean {
  return actual.schema === expected.schema
    && actual.operationDigest === expected.operationDigest
    && canonicalPath(actual.commonRoot) === canonicalPath(expected.commonRoot)
    && actual.commonRootKey === expected.commonRootKey
    && canonicalPath(actual.repoRoot) === canonicalPath(expected.repoRoot)
    && canonicalPath(actual.commonGitDir) === canonicalPath(expected.commonGitDir)
    && canonicalPath(actual.worktreeGitDir) === canonicalPath(expected.worktreeGitDir)
    && canonicalPath(actual.worktreeConfigPath) === canonicalPath(expected.worktreeConfigPath)
    && sameHookConfigState(actual.target, expected.target)
    && sameChain(actual.markerRoot, expected.markerRoot)
    && sameChain(actual.bootstrapMarkerRoot, expected.bootstrapMarkerRoot)
    && JSON.stringify(actual.marker) === JSON.stringify(expected.marker)
    && JSON.stringify(actual.bootstrapMarker) === JSON.stringify(expected.bootstrapMarker)
    && JSON.stringify(actual.generation) === JSON.stringify(expected.generation)
    && JSON.stringify(actual.bootstrapGeneration) === JSON.stringify(expected.bootstrapGeneration)
    && JSON.stringify(actual.priorGenerations) === JSON.stringify(expected.priorGenerations);
}

export function transitionPublicationIdentityMatches(
  actual: ConfigTransitionIntent,
  expected: ConfigTransitionIntent
): boolean {
  return actual.schema === expected.schema
    && actual.operationDigest === expected.operationDigest
    && canonicalPath(actual.commonRoot) === canonicalPath(expected.commonRoot)
    && actual.commonRootKey === expected.commonRootKey
    && canonicalPath(actual.repoRoot) === canonicalPath(expected.repoRoot)
    && canonicalPath(actual.commonGitDir) === canonicalPath(expected.commonGitDir)
    && canonicalPath(actual.worktreeGitDir) === canonicalPath(expected.worktreeGitDir)
    && canonicalPath(actual.worktreeConfigPath) === canonicalPath(expected.worktreeConfigPath)
    && sameHookConfigState(actual.target, expected.target)
    && sameChain(actual.markerRoot, expected.markerRoot)
    && sameChain(actual.bootstrapMarkerRoot, expected.bootstrapMarkerRoot)
    && JSON.stringify(actual.marker) === JSON.stringify(expected.marker)
    && JSON.stringify(actual.bootstrapMarker) === JSON.stringify(expected.bootstrapMarker)
    && JSON.stringify(actual.generation) === JSON.stringify(expected.generation)
    && JSON.stringify(actual.bootstrapGeneration) === JSON.stringify(expected.bootstrapGeneration)
    && JSON.stringify(actual.priorGenerations) === JSON.stringify(expected.priorGenerations);
}

export function transitionStepFileName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= configStepDefinitions().length) {
    throw new GitHookTransitionConflict('Config transition step index is invalid');
  }
  return CONFIG_TRANSITION_STEP_PREFIX + index;
}

export function transitionRetireIntentFileName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new GitHookTransitionConflict('Config transition retirement index is invalid');
  }
  return CONFIG_TRANSITION_RETIRE_INTENT_PREFIX + index;
}

export function transitionRetiredFileName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new GitHookTransitionConflict('Config transition retired index is invalid');
  }
  return CONFIG_TRANSITION_RETIRED_PREFIX + index;
}
