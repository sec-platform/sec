import registrySource from './generated-state-registry.json' with { type: 'json' };

import { canonicalEquals, rawSha256 } from './canonical-primitives.ts';

export const GENERATED_STATE_REGISTRY_SCHEMA_V1 = 'sec-generated-state-registry-v1' as const;
export const GENERATED_STATE_REGISTRATION_SCHEMA_V1 = 'sec-generated-state-registration-v1' as const;
export const GENERATED_STATE_INVENTORY_SCHEMA_V1 = 'sec-generated-state-inventory-v1' as const;
export const GENERATED_STATE_SETTLEMENT_SCHEMA_V1 = 'sec-generated-state-settlement-v1' as const;
export const GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA_V1 = "sec-generated-state-worktree-retirement-v1" as const;

export type GeneratedStateClassV1 =
  | 'rebuildable-derived-cache'
  | 'active-ephemeral-workspace'
  | 'bounded-diagnostic'
  | 'identity-bound-control-state'
  | 'recovery-authority'
  | 'quarantine-pending-cleanup'
  | 'external-provider-cache'
  | 'unknown-unclassified';

export type GeneratedStateObservedClassV1 = GeneratedStateClassV1 | 'orphaned-owned-workspace';
export type GeneratedStateCleanupProfileV1 = 'automatic' | 'safe' | 'all-rebuildable';
export type GeneratedStateRegistrationPolicyV1 = 'required-at-birth' | 'domain-owned';
export type GeneratedStateRetirementPolicyV1 = 'domain-receipt-required';
export type GeneratedStateRootKindV1 = 'directory' | 'directory-or-link' | 'file';
export type GeneratedStateScopeV1 = 'workspace' | 'operation';
export type GeneratedStateActiveOwnerSignalV1 = 'birth-registration' | 'domain-owner-receipt';
export type GeneratedStateContentsPolicyV1 = 'owner-bounded-tree' | 'ordinary-file' | 'opaque-protected-tree';
export type GeneratedStateCapacityPolicyRefV1 = 'issue-316' | 'owner-defined-protected';
export type GeneratedStateSettlementEffectV1 = 'generated-state-quarantine-delete-readback' | 'domain-owner-only';
export type GeneratedStateReconstructionV1 =
  | 'producer-recompute'
  | 'fixture-rebuild'
  | 'rerun-diagnostic'
  | 'owner-recovery-only';

export type GeneratedStateSelectorV1 =
  | Readonly<{ kind: 'exact'; path: string }>
  | Readonly<{ kind: 'direct-child-prefix'; parent: string; prefix: string }>;

export interface GeneratedStateRuleV1 {
  readonly id: string;
  readonly selector: GeneratedStateSelectorV1;
  readonly stateClass: Exclude<GeneratedStateClassV1, 'quarantine-pending-cleanup' | 'unknown-unclassified'>;
  readonly owner: string;
  readonly producer: string;
  readonly rootKind: GeneratedStateRootKindV1;
  readonly scope: GeneratedStateScopeV1;
  readonly activeOwnerSignal: GeneratedStateActiveOwnerSignalV1;
  readonly contentsPolicy: GeneratedStateContentsPolicyV1;
  readonly capacityPolicyRef: GeneratedStateCapacityPolicyRefV1;
  readonly settlementEffect: GeneratedStateSettlementEffectV1;
  readonly registration: GeneratedStateRegistrationPolicyV1;
  readonly reconstruction: GeneratedStateReconstructionV1;
  readonly cleanupProfiles: readonly GeneratedStateCleanupProfileV1[];
  readonly retirement: GeneratedStateRetirementPolicyV1;
}

export interface GeneratedStateRegistryV1 {
  readonly schema: typeof GENERATED_STATE_REGISTRY_SCHEMA_V1;
  readonly rules: readonly GeneratedStateRuleV1[];
  readonly registryDigest: `sha256:${string}`;
}

export interface GeneratedStatePhysicalIdentityV1 {
  readonly device: string;
  readonly inode: string;
  readonly objectId: string;
}

export interface GeneratedStateRegistrationV1 {
  readonly schema: typeof GENERATED_STATE_REGISTRATION_SCHEMA_V1;
  readonly registrationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentityV1;
  readonly ruleId: string;
  readonly relativePath: string;
  readonly root: GeneratedStatePhysicalIdentityV1;
  readonly owner: string;
  readonly producer: string;
  readonly operationId: string;
  readonly phase: 'active' | 'retired';
  readonly retirementRef: `sha256:${string}` | null;
  readonly generatedAt: string;
  readonly registrationDigest: `sha256:${string}`;
}

export interface GeneratedStateInventoryEntryV1 {
  readonly relativePath: string;
  readonly kind: 'directory' | 'file' | 'link' | 'missing';
  readonly ruleId: string | null;
  readonly owner: string | null;
  readonly stateClass: GeneratedStateObservedClassV1;
  readonly registrationState: 'not-required' | 'active' | 'retired' | 'missing' | 'invalid';
  readonly cleanupProfiles: readonly GeneratedStateCleanupProfileV1[];
  readonly settlement: 'ready' | 'protected' | 'blocked';
  readonly blockers: readonly string[];
  readonly physicalIdentity: GeneratedStatePhysicalIdentityV1 | null;
  readonly registrationDigest: `sha256:${string}` | null;
}

export interface GeneratedStateInventoryV1 {
  readonly schema: typeof GENERATED_STATE_INVENTORY_SCHEMA_V1;
  readonly registryDigest: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentityV1;
  readonly workspaceRegistration: 'registered' | 'absent' | 'unresolved';
  readonly entries: readonly GeneratedStateInventoryEntryV1[];
  readonly blockers: readonly string[];
  readonly inventoryDigest: `sha256:${string}`;
}

export interface GeneratedStateSettlementV1 {
  readonly schema: typeof GENERATED_STATE_SETTLEMENT_SCHEMA_V1;
  readonly repositoryRoot: string;
  readonly registryDigest: `sha256:${string}`;
  readonly beforeInventoryDigest: `sha256:${string}`;
  readonly afterInventoryDigest: `sha256:${string}`;
  readonly profile: GeneratedStateCleanupProfileV1 | 'inspect-only';
  readonly selected: readonly string[];
  readonly protected: readonly string[];
  readonly attempts: readonly Readonly<{
    relativePath: string;
    action: 'quarantined' | 'deleted' | 'protected' | 'residue';
    detailRef: `sha256:${string}`;
  }>[];
  readonly terminal: 'completed' | 'partial-residue' | 'blocked' | 'no-op';
  readonly blockers: readonly string[];
  readonly generatedAt: string;
  readonly settlementDigest: `sha256:${string}`;
}

export interface GeneratedStateWorktreeRetirementEntryV1 {
  readonly relativePath: string;
  readonly destinationName: string;
  readonly source: GeneratedStatePhysicalIdentityV1;
  readonly retained: GeneratedStatePhysicalIdentityV1;
  readonly inventoryDigest: `sha256:${string}`;
  readonly ruleIds: readonly string[];
  readonly action: 'preserved';
}

/**
 * Durable #271 handoff for an enclosing #186 worktree retirement.
 *
 * The generated-state owner never authorizes deletion here.  It proves every
 * ignored root is registry-covered, moves the exact objects outside the
 * retiring worktree on the same volume, and retains their identities for
 * Effect-start revalidation by the worktree owner.
 */
export interface GeneratedStateWorktreeRetirementV1 {
  readonly schema: typeof GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA_V1;
  readonly operationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspacePath: string;
  readonly workspace: GeneratedStatePhysicalIdentityV1;
  readonly worktree: {
    readonly branch: string;
    readonly headSha: string;
    readonly treeSha: string;
  };
  readonly registryDigest: `sha256:${string}`;
  readonly statusDigest: `sha256:${string}`;
  readonly inventoryDigest: `sha256:${string}`;
  readonly retentionRoot: ({ readonly path: string } & GeneratedStatePhysicalIdentityV1) | null;
  readonly entries: readonly GeneratedStateWorktreeRetirementEntryV1[];
  readonly blockers: readonly string[];
  readonly terminal: 'completed' | 'residue';
  readonly receiptDigest: `sha256:${string}`;
}

const STATE_CLASSES = new Set<GeneratedStateClassV1>([
  'rebuildable-derived-cache',
  'active-ephemeral-workspace',
  'bounded-diagnostic',
  'identity-bound-control-state',
  'recovery-authority',
  'quarantine-pending-cleanup',
  'external-provider-cache',
  'unknown-unclassified'
]);
const CLEANUP_PROFILES = new Set<GeneratedStateCleanupProfileV1>([
  'automatic', 'safe', 'all-rebuildable'
]);
const RECONSTRUCTION = new Set<GeneratedStateReconstructionV1>([
  'producer-recompute', 'fixture-rebuild', 'rerun-diagnostic', 'owner-recovery-only'
]);
const ROOT_KINDS = new Set<GeneratedStateRootKindV1>(['directory', 'directory-or-link', 'file']);
const SCOPES = new Set<GeneratedStateScopeV1>(['workspace', 'operation']);
const ACTIVE_OWNER_SIGNALS = new Set<GeneratedStateActiveOwnerSignalV1>([
  'birth-registration', 'domain-owner-receipt'
]);
const CONTENTS_POLICIES = new Set<GeneratedStateContentsPolicyV1>([
  'owner-bounded-tree', 'ordinary-file', 'opaque-protected-tree'
]);
const CAPACITY_POLICY_REFS = new Set<GeneratedStateCapacityPolicyRefV1>([
  'issue-316', 'owner-defined-protected'
]);
const SETTLEMENT_EFFECTS = new Set<GeneratedStateSettlementEffectV1>([
  'generated-state-quarantine-delete-readback', 'domain-owner-only'
]);
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/u;

function fail(message: string): never {
  throw new Error(`Generated-state contract: ${message}`);
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} keys are not canonical.`);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value
      || value.normalize('NFC') !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a canonical non-empty string.`);
  }
  return value;
}

export function normalizeGeneratedStateRelativePathV1(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (normalized.length === 0 || normalized.startsWith('/') || normalized.includes('//')
      || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      || /[\u0000-\u001f\u007f]/u.test(normalized)) fail('relative path is not canonical.');
  return normalized;
}

function parseSelector(value: unknown, label: string): GeneratedStateSelectorV1 {
  const record = plainRecord(value, label);
  if (record.kind === 'exact') {
    exactKeys(record, ['kind', 'path'], label);
    return Object.freeze({ kind: 'exact', path: normalizeGeneratedStateRelativePathV1(
      stringValue(record.path, `${label}.path`)
    ) });
  }
  if (record.kind === 'direct-child-prefix') {
    exactKeys(record, ['kind', 'parent', 'prefix'], label);
    const prefix = stringValue(record.prefix, `${label}.prefix`);
    if (prefix.includes('/') || prefix === '.' || prefix === '..') fail(`${label}.prefix is not one name prefix.`);
    return Object.freeze({
      kind: 'direct-child-prefix',
      parent: normalizeGeneratedStateRelativePathV1(stringValue(record.parent, `${label}.parent`)),
      prefix
    });
  }
  return fail(`${label}.kind is unsupported.`);
}

export function parseGeneratedStateRegistryV1(value: unknown): GeneratedStateRegistryV1 {
  const root = plainRecord(value, 'registry');
  exactKeys(root, ['schema', 'rules'], 'registry');
  if (root.schema !== GENERATED_STATE_REGISTRY_SCHEMA_V1 || !Array.isArray(root.rules)) {
    fail('registry schema or rules are invalid.');
  }
  const ids = new Set<string>();
  const selectors = new Set<string>();
  const rules = root.rules.map((candidate, index): GeneratedStateRuleV1 => {
    const rule = plainRecord(candidate, `rules[${index}]`);
    exactKeys(rule, [
      'id', 'selector', 'stateClass', 'owner', 'producer', 'registration',
      'reconstruction', 'cleanupProfiles', 'retirement', 'rootKind', 'scope',
      'activeOwnerSignal', 'contentsPolicy', 'capacityPolicyRef', 'settlementEffect'
    ], `rules[${index}]`);
    const id = stringValue(rule.id, `rules[${index}].id`);
    if (!SAFE_ID.test(id) || ids.has(id)) fail(`rules[${index}].id is invalid or duplicate.`);
    ids.add(id);
    const selector = parseSelector(rule.selector, `rules[${index}].selector`);
    const selectorKey = JSON.stringify(selector);
    if (selectors.has(selectorKey)) fail(`rules[${index}].selector is duplicate.`);
    selectors.add(selectorKey);
    const stateClass = stringValue(rule.stateClass, `rules[${index}].stateClass`) as GeneratedStateClassV1;
    if (!STATE_CLASSES.has(stateClass) || stateClass === 'unknown-unclassified'
        || stateClass === 'quarantine-pending-cleanup') fail(`rules[${index}].stateClass is not registrable.`);
    const registration = rule.registration;
    if (registration !== 'required-at-birth' && registration !== 'domain-owned') {
      fail(`rules[${index}].registration is invalid.`);
    }
    const reconstruction = rule.reconstruction as GeneratedStateReconstructionV1;
    if (!RECONSTRUCTION.has(reconstruction)) fail(`rules[${index}].reconstruction is invalid.`);
    if (!Array.isArray(rule.cleanupProfiles)) fail(`rules[${index}].cleanupProfiles must be an array.`);
    const cleanupProfiles = rule.cleanupProfiles.map((profile, profileIndex) => {
      if (!CLEANUP_PROFILES.has(profile as GeneratedStateCleanupProfileV1)) {
        fail(`rules[${index}].cleanupProfiles[${profileIndex}] is invalid.`);
      }
      return profile as GeneratedStateCleanupProfileV1;
    });
    if (new Set(cleanupProfiles).size !== cleanupProfiles.length) {
      fail(`rules[${index}].cleanupProfiles contains duplicates.`);
    }
    if (rule.retirement !== 'domain-receipt-required') fail(`rules[${index}].retirement is invalid.`);
    const rootKind = rule.rootKind as GeneratedStateRootKindV1;
    const scope = rule.scope as GeneratedStateScopeV1;
    const activeOwnerSignal = rule.activeOwnerSignal as GeneratedStateActiveOwnerSignalV1;
    const contentsPolicy = rule.contentsPolicy as GeneratedStateContentsPolicyV1;
    const capacityPolicyRef = rule.capacityPolicyRef as GeneratedStateCapacityPolicyRefV1;
    const settlementEffect = rule.settlementEffect as GeneratedStateSettlementEffectV1;
    if (!ROOT_KINDS.has(rootKind) || !SCOPES.has(scope)
        || !ACTIVE_OWNER_SIGNALS.has(activeOwnerSignal) || !CONTENTS_POLICIES.has(contentsPolicy)
        || !CAPACITY_POLICY_REFS.has(capacityPolicyRef) || !SETTLEMENT_EFFECTS.has(settlementEffect)) {
      fail(`rules[${index}] lifecycle policy is invalid.`);
    }
    if ((rootKind === 'file') !== (contentsPolicy === 'ordinary-file')) {
      fail(`rules[${index}] rootKind and contentsPolicy disagree.`);
    }
    if ((cleanupProfiles.length === 0) !== (settlementEffect === 'domain-owner-only')) {
      fail(`rules[${index}] cleanup profiles and settlementEffect disagree.`);
    }
    if ((registration === 'required-at-birth') !== (activeOwnerSignal === 'birth-registration')) {
      fail(`rules[${index}] registration and activeOwnerSignal disagree.`);
    }
    return Object.freeze({
      id,
      selector,
      stateClass: stateClass as GeneratedStateRuleV1['stateClass'],
      owner: stringValue(rule.owner, `rules[${index}].owner`),
      producer: stringValue(rule.producer, `rules[${index}].producer`),
      rootKind,
      scope,
      activeOwnerSignal,
      contentsPolicy,
      capacityPolicyRef,
      settlementEffect,
      registration,
      reconstruction,
      cleanupProfiles: Object.freeze(cleanupProfiles),
      retirement: 'domain-receipt-required'
    });
  });
  const material = Object.freeze({ schema: GENERATED_STATE_REGISTRY_SCHEMA_V1, rules: Object.freeze(rules) });
  return Object.freeze({ ...material, registryDigest: rawSha256(JSON.stringify(material)) });
}

export const GENERATED_STATE_REGISTRY_V1 = parseGeneratedStateRegistryV1(registrySource);

export function generatedStateRuleForPathV1(
  relativePath: string,
  registry: GeneratedStateRegistryV1 = GENERATED_STATE_REGISTRY_V1
): GeneratedStateRuleV1 | null {
  const normalized = normalizeGeneratedStateRelativePathV1(relativePath);
  const matches = registry.rules.filter(({ selector }) => {
    if (selector.kind === 'exact') return normalized === selector.path;
    const parent = normalized.slice(0, normalized.lastIndexOf('/'));
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    return parent === selector.parent && name.startsWith(selector.prefix);
  });
  if (matches.length > 1) fail(`path ${normalized} matches multiple rules.`);
  return matches[0] ?? null;
}

export function generatedStateCleanupAllowedV1(input: Readonly<{
  entry: GeneratedStateInventoryEntryV1;
  profile: GeneratedStateCleanupProfileV1;
}>): boolean {
  const { entry, profile } = input;
  return entry.settlement === 'ready'
    && entry.registrationState === 'retired'
    && entry.cleanupProfiles.includes(profile);
}

export function generatedStateDigestV1(value: unknown): `sha256:${string}` {
  return rawSha256(JSON.stringify(value));
}

function physicalIdentityV1(value: unknown, label: string): GeneratedStatePhysicalIdentityV1 {
  const record = plainRecord(value, label);
  exactKeys(record, ['device', 'inode', 'objectId'], label);
  return Object.freeze({
    device: stringValue(record.device, `${label}.device`),
    inode: stringValue(record.inode, `${label}.inode`),
    objectId: stringValue(record.objectId, `${label}.objectId`)
  });
}

function digestValue(value: unknown, label: string): `sha256:${string}` {
  const digest = stringValue(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) fail(`${label} must be one SHA-256 digest.`);
  return digest as `sha256:${string}`;
}

function registrationMaterialV1(input: Omit<
  GeneratedStateRegistrationV1,
  'schema' | 'registrationId' | 'registrationDigest'
>): Omit<GeneratedStateRegistrationV1, 'registrationDigest'> {
  const registrationId = generatedStateDigestV1(Object.freeze({
    schema: GENERATED_STATE_REGISTRATION_SCHEMA_V1,
    repositoryRoot: input.repositoryRoot,
    workspace: input.workspace,
    ruleId: input.ruleId,
    relativePath: input.relativePath,
    root: input.root,
    owner: input.owner,
    producer: input.producer,
    operationId: input.operationId
  }));
  return Object.freeze({ schema: GENERATED_STATE_REGISTRATION_SCHEMA_V1, registrationId, ...input });
}

export function createGeneratedStateRegistrationV1(input: Readonly<{
  repositoryRoot: string;
  workspace: GeneratedStatePhysicalIdentityV1;
  rule: GeneratedStateRuleV1;
  relativePath: string;
  root: GeneratedStatePhysicalIdentityV1;
  operationId: string;
}>, options: Readonly<{ clock?: () => Date }> = {}): GeneratedStateRegistrationV1 {
  const relativePath = normalizeGeneratedStateRelativePathV1(input.relativePath);
  if (generatedStateRuleForPathV1(relativePath)?.id !== input.rule.id) {
    fail('registration path does not resolve to its rule.');
  }
  const material = registrationMaterialV1({
    repositoryRoot: stringValue(input.repositoryRoot, 'registration.repositoryRoot'),
    workspace: physicalIdentityV1(input.workspace, 'registration.workspace'),
    ruleId: input.rule.id,
    relativePath,
    root: physicalIdentityV1(input.root, 'registration.root'),
    owner: input.rule.owner,
    producer: input.rule.producer,
    operationId: stringValue(input.operationId, 'registration.operationId'),
    phase: 'active',
    retirementRef: null,
    generatedAt: (options.clock ?? (() => new Date()))().toISOString()
  });
  return Object.freeze({ ...material, registrationDigest: generatedStateDigestV1(material) });
}

export function retireGeneratedStateRegistrationV1(
  registration: GeneratedStateRegistrationV1,
  retirementRef: `sha256:${string}`,
  options: Readonly<{ clock?: () => Date }> = {}
): GeneratedStateRegistrationV1 {
  const current = parseGeneratedStateRegistrationV1(registration);
  const material = registrationMaterialV1({
    repositoryRoot: current.repositoryRoot,
    workspace: current.workspace,
    ruleId: current.ruleId,
    relativePath: current.relativePath,
    root: current.root,
    owner: current.owner,
    producer: current.producer,
    operationId: current.operationId,
    phase: 'retired',
    retirementRef: digestValue(retirementRef, 'retirementRef'),
    generatedAt: (options.clock ?? (() => new Date()))().toISOString()
  });
  return Object.freeze({ ...material, registrationDigest: generatedStateDigestV1(material) });
}

export function parseGeneratedStateRegistrationV1(value: unknown): GeneratedStateRegistrationV1 {
  const record = plainRecord(value, 'registration');
  exactKeys(record, [
    'schema', 'registrationId', 'repositoryRoot', 'workspace', 'ruleId', 'relativePath',
    'root', 'owner', 'producer', 'operationId', 'phase', 'retirementRef', 'generatedAt',
    'registrationDigest'
  ], 'registration');
  if (record.schema !== GENERATED_STATE_REGISTRATION_SCHEMA_V1) fail('registration schema is invalid.');
  const ruleId = stringValue(record.ruleId, 'registration.ruleId');
  const rule = GENERATED_STATE_REGISTRY_V1.rules.find(({ id }) => id === ruleId);
  if (rule === undefined) fail('registration rule is absent from the current registry.');
  const phase = record.phase;
  if (phase !== 'active' && phase !== 'retired') fail('registration phase is invalid.');
  const retirementRef = record.retirementRef === null
    ? null
    : digestValue(record.retirementRef, 'registration.retirementRef');
  if ((phase === 'active') !== (retirementRef === null)) fail('registration phase and retirementRef disagree.');
  const material = registrationMaterialV1({
    repositoryRoot: stringValue(record.repositoryRoot, 'registration.repositoryRoot'),
    workspace: physicalIdentityV1(record.workspace, 'registration.workspace'),
    ruleId,
    relativePath: normalizeGeneratedStateRelativePathV1(
      stringValue(record.relativePath, 'registration.relativePath')
    ),
    root: physicalIdentityV1(record.root, 'registration.root'),
    owner: stringValue(record.owner, 'registration.owner'),
    producer: stringValue(record.producer, 'registration.producer'),
    operationId: stringValue(record.operationId, 'registration.operationId'),
    phase,
    retirementRef,
    generatedAt: stringValue(record.generatedAt, 'registration.generatedAt')
  });
  if (!Number.isFinite(Date.parse(material.generatedAt))) fail('registration.generatedAt is invalid.');
  if (material.owner !== rule.owner || material.producer !== rule.producer
      || generatedStateRuleForPathV1(material.relativePath)?.id !== rule.id) {
    fail('registration owner, producer or path differs from the current rule.');
  }
  const expected = Object.freeze({ ...material, registrationDigest: generatedStateDigestV1(material) });
  if (record.registrationId !== expected.registrationId
      || record.registrationDigest !== expected.registrationDigest) {
    fail('registration identity or digest is invalid.');
  }
  return expected;
}

export function createGeneratedStateInventoryV1(input: Omit<
  GeneratedStateInventoryV1,
  'schema' | 'registryDigest' | 'inventoryDigest'
>): GeneratedStateInventoryV1 {
  const entries = Object.freeze([...input.entries].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath)
  )));
  const blockers = Object.freeze([...new Set(input.blockers)].sort());
  const material = Object.freeze({
    schema: GENERATED_STATE_INVENTORY_SCHEMA_V1,
    registryDigest: GENERATED_STATE_REGISTRY_V1.registryDigest,
    repositoryRoot: input.repositoryRoot,
    workspace: input.workspace,
    workspaceRegistration: input.workspaceRegistration,
    entries,
    blockers
  });
  return Object.freeze({ ...material, inventoryDigest: generatedStateDigestV1(material) });
}

export function createGeneratedStateSettlementV1(input: Omit<
  GeneratedStateSettlementV1,
  'schema' | 'registryDigest' | 'generatedAt' | 'settlementDigest'
>, options: Readonly<{ clock?: () => Date }> = {}): GeneratedStateSettlementV1 {
  const material = Object.freeze({
    schema: GENERATED_STATE_SETTLEMENT_SCHEMA_V1,
    repositoryRoot: input.repositoryRoot,
    registryDigest: GENERATED_STATE_REGISTRY_V1.registryDigest,
    beforeInventoryDigest: input.beforeInventoryDigest,
    afterInventoryDigest: input.afterInventoryDigest,
    profile: input.profile,
    selected: Object.freeze([...input.selected].sort()),
    protected: Object.freeze([...input.protected].sort()),
    attempts: Object.freeze([...input.attempts]),
    terminal: input.terminal,
    blockers: Object.freeze([...new Set(input.blockers)].sort()),
    generatedAt: (options.clock ?? (() => new Date()))().toISOString()
  });
  return Object.freeze({ ...material, settlementDigest: generatedStateDigestV1(material) });
}

export function createGeneratedStateWorktreeRetirementV1(
  input: Omit<GeneratedStateWorktreeRetirementV1, 'schema' | 'registryDigest' | 'terminal' | 'receiptDigest'>
): GeneratedStateWorktreeRetirementV1 {
  if (!/^[0-9a-f]{40}$/u.test(input.worktree.headSha) || !/^[0-9a-f]{40}$/u.test(input.worktree.treeSha)) {
    fail('worktree retirement Git identity is invalid.');
  }
  const branch = stringValue(input.worktree.branch, 'worktree retirement branch');
  if (/[/\\]$/u.test(branch) || branch.includes('..') || branch.includes('@{') || /[\u0000-\u0020~^:?*\[\\\u007f]/u.test(branch)) {
    fail('worktree retirement branch is invalid.');
  }
  const entries = [...input.entries]
    .map((entry) => {
      const relativePath = normalizeGeneratedStateRelativePathV1(entry.relativePath);
      if (!/^g-[0-9a-f]{64}$/u.test(entry.destinationName) || entry.action !== 'preserved') {
        fail(`worktree retirement destination is invalid for ${relativePath}.`);
      }
      if (!/^sha256:[0-9a-f]{64}$/u.test(entry.inventoryDigest)) {
        fail(`worktree retirement inventory digest is invalid for ${relativePath}.`);
      }
      const ruleIds = Object.freeze(
        [...new Set(entry.ruleIds.map((value) => stringValue(value, `worktree retirement rule for ${relativePath}`)))].sort()
      );
      if (ruleIds.length === 0 || ruleIds.some((ruleId) => !GENERATED_STATE_REGISTRY_V1.rules.some(({ id }) => id === ruleId))) {
        fail(`worktree retirement rule coverage is invalid for ${relativePath}.`);
      }
      return Object.freeze({
        relativePath,
        destinationName: entry.destinationName,
        source: physicalIdentityV1(entry.source, `worktree retirement source ${relativePath}`),
        retained: physicalIdentityV1(entry.retained, `worktree retirement retained ${relativePath}`),
        inventoryDigest: entry.inventoryDigest,
        ruleIds,
        action: 'preserved' as const
      });
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (
    new Set(entries.map(({ relativePath }) => relativePath)).size !== entries.length ||
    new Set(entries.map(({ destinationName }) => destinationName)).size !== entries.length
  ) {
    fail('worktree retirement entries are not unique.');
  }
  const retentionRoot =
    input.retentionRoot === null
      ? null
      : Object.freeze({
          path: stringValue(input.retentionRoot.path, 'worktree retirement retentionRoot.path'),
          ...physicalIdentityV1(
            {
              device: input.retentionRoot.device,
              inode: input.retentionRoot.inode,
              objectId: input.retentionRoot.objectId
            },
            'worktree retirement retentionRoot'
          )
        });
  if ((entries.length === 0) !== (retentionRoot === null)) {
    fail('worktree retirement retention root and entries disagree.');
  }
  const blockers = Object.freeze([...new Set(input.blockers.map((value) => stringValue(value, 'worktree retirement blocker')))].sort());
  const material = Object.freeze({
    schema: GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA_V1,
    operationId: digestValue(input.operationId, 'worktree retirement operationId'),
    repositoryRoot: stringValue(input.repositoryRoot, 'worktree retirement repositoryRoot'),
    workspacePath: stringValue(input.workspacePath, 'worktree retirement workspacePath'),
    workspace: physicalIdentityV1(input.workspace, 'worktree retirement workspace'),
    worktree: Object.freeze({ branch, headSha: input.worktree.headSha, treeSha: input.worktree.treeSha }),
    registryDigest: GENERATED_STATE_REGISTRY_V1.registryDigest,
    statusDigest: digestValue(input.statusDigest, 'worktree retirement statusDigest'),
    inventoryDigest: digestValue(input.inventoryDigest, 'worktree retirement inventoryDigest'),
    retentionRoot,
    entries: Object.freeze(entries),
    blockers,
    terminal: blockers.length === 0 ? ('completed' as const) : ('residue' as const)
  });
  return Object.freeze({ ...material, receiptDigest: generatedStateDigestV1(material) });
}

export function assertGeneratedStateWorktreeRetirementV1(value: GeneratedStateWorktreeRetirementV1): GeneratedStateWorktreeRetirementV1 {
  if (value.schema !== GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA_V1) {
    fail('worktree retirement schema is invalid.');
  }
  const { schema: ignoredSchema, registryDigest, terminal, receiptDigest, ...input } = value;
  const rebuilt = createGeneratedStateWorktreeRetirementV1(input);
  if (
    registryDigest !== rebuilt.registryDigest ||
    terminal !== rebuilt.terminal ||
    receiptDigest !== rebuilt.receiptDigest ||
    !canonicalEquals(value, rebuilt)
  ) {
    fail('worktree retirement receipt is not canonical.');
  }
  return value;
}
