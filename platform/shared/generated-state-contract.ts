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
export type GeneratedStateRootKindV1 = 'directory' | 'file' | 'link';
export type GeneratedStateScopeV1 = 'workspace' | 'operation';
export type GeneratedStateActiveOwnerSignalV1 = 'birth-registration' | 'domain-owner-receipt';
export type GeneratedStateContentsPolicyV1 =
  | 'owner-bounded-tree'
  | 'ordinary-file'
  | 'opaque-protected-tree'
  | 'owner-bound-locator';
export type GeneratedStateCapacityPolicyRefV1 = 'issue-316' | 'owner-defined-protected';
export type GeneratedStateSettlementEffectV1 = 'generated-state-quarantine-delete-readback' | 'domain-owner-only';
export type GeneratedStateWorktreeRetirementDispositionV1 =
  | Readonly<{ mode: 'preserve' }>
  | Readonly<{ mode: 'domain-retire'; providerId: string }>;
export interface GeneratedStatePhysicalFormV1 {
  readonly kind: GeneratedStateRootKindV1;
  readonly contentsPolicy: GeneratedStateContentsPolicyV1;
  readonly settlementEffect: GeneratedStateSettlementEffectV1;
  readonly worktreeRetirement: GeneratedStateWorktreeRetirementDispositionV1;
}
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
  readonly physicalForms: readonly GeneratedStatePhysicalFormV1[];
  readonly scope: GeneratedStateScopeV1;
  readonly activeOwnerSignal: GeneratedStateActiveOwnerSignalV1;
  readonly capacityPolicyRef: GeneratedStateCapacityPolicyRefV1;
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
  /** True when the resource birth/terminal owner, rather than legacy cleanup, owns settlement. */
  readonly resourceManaged?: boolean;
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

export interface GeneratedStateWorktreePreservedEntryV1 {
  readonly relativePath: string;
  readonly destinationName: string;
  readonly source: GeneratedStatePhysicalIdentityV1;
  readonly retained: GeneratedStatePhysicalIdentityV1;
  readonly inventoryDigest: `sha256:${string}`;
  readonly ruleIds: readonly string[];
  readonly action: 'preserved';
}

export interface GeneratedStateWorktreeDomainRetiredEntryV1 {
  readonly relativePath: string;
  readonly source: GeneratedStatePhysicalIdentityV1;
  readonly inventoryDigest: `sha256:${string}`;
  readonly ruleIds: readonly string[];
  readonly action: 'domain-retired';
  readonly providerId: string;
  readonly providerPlanDigest: `sha256:${string}`;
  readonly providerReceiptBytes: string;
  readonly providerReceiptDigest: `sha256:${string}`;
}

export type GeneratedStateWorktreeRetirementEntryV1 =
  | GeneratedStateWorktreePreservedEntryV1
  | GeneratedStateWorktreeDomainRetiredEntryV1;

/**
 * Durable #271 handoff for an enclosing #186 worktree retirement.
 *
 * The generated-state owner never infers deletion authority here. It proves
 * every ignored root is registry-covered, preserves ordinary roots outside
 * the worktree, and composes exact receipts from explicitly named domain
 * providers for locator-like physical forms.
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
const ROOT_KINDS = new Set<GeneratedStateRootKindV1>(['directory', 'file', 'link']);
const SCOPES = new Set<GeneratedStateScopeV1>(['workspace', 'operation']);
const ACTIVE_OWNER_SIGNALS = new Set<GeneratedStateActiveOwnerSignalV1>([
  'birth-registration', 'domain-owner-receipt'
]);
const CONTENTS_POLICIES = new Set<GeneratedStateContentsPolicyV1>([
  'owner-bounded-tree', 'ordinary-file', 'opaque-protected-tree', 'owner-bound-locator'
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
      'reconstruction', 'cleanupProfiles', 'retirement', 'physicalForms', 'scope',
      'activeOwnerSignal', 'capacityPolicyRef'
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
    const scope = rule.scope as GeneratedStateScopeV1;
    const activeOwnerSignal = rule.activeOwnerSignal as GeneratedStateActiveOwnerSignalV1;
    const capacityPolicyRef = rule.capacityPolicyRef as GeneratedStateCapacityPolicyRefV1;
    if (!SCOPES.has(scope) || !ACTIVE_OWNER_SIGNALS.has(activeOwnerSignal)
        || !CAPACITY_POLICY_REFS.has(capacityPolicyRef)) {
      fail(`rules[${index}] lifecycle policy is invalid.`);
    }
    if (!Array.isArray(rule.physicalForms) || rule.physicalForms.length === 0) {
      fail(`rules[${index}].physicalForms must be a non-empty array.`);
    }
    const physicalForms = rule.physicalForms.map((candidateForm, formIndex): GeneratedStatePhysicalFormV1 => {
      const form = plainRecord(candidateForm, `rules[${index}].physicalForms[${formIndex}]`);
      exactKeys(form, ['kind', 'contentsPolicy', 'settlementEffect', 'worktreeRetirement'], `rules[${index}].physicalForms[${formIndex}]`);
      const kind = form.kind as GeneratedStateRootKindV1;
      const contentsPolicy = form.contentsPolicy as GeneratedStateContentsPolicyV1;
      const settlementEffect = form.settlementEffect as GeneratedStateSettlementEffectV1;
      if (!ROOT_KINDS.has(kind) || !CONTENTS_POLICIES.has(contentsPolicy) || !SETTLEMENT_EFFECTS.has(settlementEffect)) {
        fail(`rules[${index}].physicalForms[${formIndex}] lifecycle policy is invalid.`);
      }
      if ((kind === 'file') !== (contentsPolicy === 'ordinary-file') ||
          (kind === 'link') !== (contentsPolicy === 'owner-bound-locator')) {
        fail(`rules[${index}].physicalForms[${formIndex}] kind and contentsPolicy disagree.`);
      }
      const retirement = plainRecord(form.worktreeRetirement, `rules[${index}].physicalForms[${formIndex}].worktreeRetirement`);
      const mode = retirement.mode;
      if (mode === 'preserve') {
        exactKeys(retirement, ['mode'], `rules[${index}].physicalForms[${formIndex}].worktreeRetirement`);
        if (kind === 'link') fail(`rules[${index}].physicalForms[${formIndex}] cannot generically preserve a locator.`);
        return Object.freeze({ kind, contentsPolicy, settlementEffect, worktreeRetirement: Object.freeze({ mode }) });
      }
      if (mode === 'domain-retire') {
        exactKeys(retirement, ['mode', 'providerId'], `rules[${index}].physicalForms[${formIndex}].worktreeRetirement`);
        const providerId = stringValue(retirement.providerId, `rules[${index}].physicalForms[${formIndex}].providerId`);
        if (!SAFE_ID.test(providerId) || settlementEffect !== 'domain-owner-only') {
          fail(`rules[${index}].physicalForms[${formIndex}] domain retirement is invalid.`);
        }
        return Object.freeze({
          kind,
          contentsPolicy,
          settlementEffect,
          worktreeRetirement: Object.freeze({ mode, providerId })
        });
      }
      return fail(`rules[${index}].physicalForms[${formIndex}].worktreeRetirement is invalid.`);
    });
    if (new Set(physicalForms.map(({ kind }) => kind)).size !== physicalForms.length) {
      fail(`rules[${index}].physicalForms contains duplicate kinds.`);
    }
    if ((cleanupProfiles.length === 0) !== physicalForms.every(({ settlementEffect }) => settlementEffect === 'domain-owner-only')) {
      fail(`rules[${index}] cleanup profiles and physical settlement effects disagree.`);
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
      physicalForms: Object.freeze(physicalForms),
      scope,
      activeOwnerSignal,
      capacityPolicyRef,
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
    && entry.resourceManaged !== true
    && entry.registrationState === 'retired'
    && entry.cleanupProfiles.includes(profile);
}

export function generatedStateDigestV1(value: unknown): `sha256:${string}` {
  return rawSha256(JSON.stringify(value));
}

export function generatedStateDomainProviderMaterialDigestV1(
  providerId: string,
  kind: 'plan' | 'receipt',
  bytes: string
): `sha256:${string}` {
  return generatedStateDigestV1(Object.freeze({
    schema: `sec-generated-state-domain-${kind}-bytes-v1`,
    providerId,
    bytes
  }));
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
      if (!/^sha256:[0-9a-f]{64}$/u.test(entry.inventoryDigest)) {
        fail(`worktree retirement inventory digest is invalid for ${relativePath}.`);
      }
      const ruleIds = Object.freeze(
        [...new Set(entry.ruleIds.map((value) => stringValue(value, `worktree retirement rule for ${relativePath}`)))].sort()
      );
      if (ruleIds.length === 0 || ruleIds.some((ruleId) => !GENERATED_STATE_REGISTRY_V1.rules.some(({ id }) => id === ruleId))) {
        fail(`worktree retirement rule coverage is invalid for ${relativePath}.`);
      }
      if (entry.action === 'domain-retired') {
        const providerId = stringValue(entry.providerId, `worktree retirement provider for ${relativePath}`);
        if (!SAFE_ID.test(providerId) || !/^sha256:[0-9a-f]{64}$/u.test(entry.providerPlanDigest) ||
            !/^sha256:[0-9a-f]{64}$/u.test(entry.providerReceiptDigest) || typeof entry.providerReceiptBytes !== 'string') {
          fail(`worktree retirement provider receipt is invalid for ${relativePath}.`);
        }
        if (entry.providerReceiptDigest !== generatedStateDomainProviderMaterialDigestV1(
          providerId,
          'receipt',
          entry.providerReceiptBytes
        )) {
          fail(`worktree retirement provider receipt digest is invalid for ${relativePath}.`);
        }
        return Object.freeze({
          relativePath,
          source: physicalIdentityV1(entry.source, `worktree retirement source ${relativePath}`),
          inventoryDigest: entry.inventoryDigest,
          ruleIds,
          action: 'domain-retired' as const,
          providerId,
          providerPlanDigest: entry.providerPlanDigest,
          providerReceiptBytes: entry.providerReceiptBytes,
          providerReceiptDigest: entry.providerReceiptDigest
        });
      }
      if (!/^g-[0-9a-f]{64}$/u.test(entry.destinationName) || entry.action !== 'preserved') {
        fail(`worktree retirement destination is invalid for ${relativePath}.`);
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
    new Set(entries.filter((entry) => entry.action === 'preserved').map(({ destinationName }) => destinationName)).size !==
      entries.filter((entry) => entry.action === 'preserved').length
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
  const preservedEntries = entries.filter((entry) => entry.action === 'preserved');
  if ((preservedEntries.length === 0) !== (retentionRoot === null)) {
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

/**
 * Resource birth/retirement is deliberately a small extension of the
 * generated-state registry.  It is not a second cleanup manager: the
 * registry still decides which paths are supported and the lifecycle owner
 * only composes the owner identity, physical preimage and terminal receipt.
 *
 * The fields below intentionally contain no wall-clock or path/age based
 * reclamation input.  A resource can be reclaimed only after its owner has
 * satisfied the terminal obligation, its lease has been released, all
 * consumers are gone, and the physical preimage is still the one recorded at
 * birth.
 */
export const GENERATED_STATE_RESOURCE_REGISTRATION_SCHEMA_V1 =
  'sec-generated-state-resource-registration-v1' as const;
export const GENERATED_STATE_RESOURCE_RECEIPT_SCHEMA_V1 =
  'sec-generated-state-resource-receipt-v1' as const;

export type GeneratedStateResourcePhaseV1 = 'active' | 'operational-terminal';
export type GeneratedStateResourceLeaseStateV1 = 'held' | 'released';
export type GeneratedStateResourceRetentionPolicyV1 = 'consumer-zero' | 'owner-retained';
export type GeneratedStateReclaimabilityV1 = 'eligible' | 'blocked' | 'unknown';

export interface GeneratedStateResourceLeaseV1 {
  readonly leaseId: `sha256:${string}`;
  readonly owner: string;
  readonly operationId: string;
  readonly state: GeneratedStateResourceLeaseStateV1;
}

export interface GeneratedStateResourceConsumerV1 {
  readonly consumerId: string;
  /** Issued by the resource owner and required to release this exact binding. */
  readonly credential: `sha256:${string}`;
}

export interface GeneratedStateResourceRetentionV1 {
  readonly policy: GeneratedStateResourceRetentionPolicyV1;
  readonly consumers: readonly GeneratedStateResourceConsumerV1[];
}

export interface GeneratedStateResourceTerminalObligationV1 {
  readonly state: 'open' | 'satisfied';
  readonly settlementRef: `sha256:${string}` | null;
  readonly outcomeDigest: `sha256:${string}` | null;
}

export interface GeneratedStateResourceRegistrationV1 {
  readonly schema: typeof GENERATED_STATE_RESOURCE_REGISTRATION_SCHEMA_V1;
  readonly resourceId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentityV1;
  readonly ruleId: string;
  readonly relativePath: string;
  readonly root: GeneratedStatePhysicalIdentityV1 | null;
  readonly rootKind: GeneratedStateRootKindV1 | null;
  readonly linkTarget: string | null;
  readonly owner: string;
  readonly producer: string;
  readonly operationId: string;
  readonly lease: GeneratedStateResourceLeaseV1;
  readonly retention: GeneratedStateResourceRetentionV1;
  readonly terminalObligation: GeneratedStateResourceTerminalObligationV1;
  readonly phase: GeneratedStateResourcePhaseV1;
  /** Monotonic current-record version used by every lifecycle transition CAS. */
  readonly transitionEpoch: number;
  readonly registrationDigest: `sha256:${string}`;
}

export interface GeneratedStateResourceReceiptV1 {
  readonly schema: typeof GENERATED_STATE_RESOURCE_RECEIPT_SCHEMA_V1;
  readonly resourceId: `sha256:${string}`;
  readonly registrationDigest: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentityV1;
  readonly relativePath: string;
  readonly phase: GeneratedStateResourcePhaseV1;
  readonly operationalTerminal: boolean;
  readonly physicalClean: boolean;
  readonly gcPending: boolean;
  readonly reclaimability: GeneratedStateReclaimabilityV1;
  readonly consumerCount: number;
  readonly observedRoot: GeneratedStatePhysicalIdentityV1 | null;
  readonly blockers: readonly string[];
  readonly receiptDigest: `sha256:${string}`;
}

function resourceLeaseMaterialV1(input: Readonly<{
  resourceId: `sha256:${string}`;
  owner: string;
  operationId: string;
}>): GeneratedStateResourceLeaseV1 {
  return Object.freeze({
    leaseId: generatedStateDigestV1(Object.freeze({
      schema: 'sec-generated-state-resource-lease-v1',
      resourceId: input.resourceId,
      owner: input.owner,
      operationId: input.operationId
    })),
    owner: input.owner,
    operationId: input.operationId,
    state: 'held' as const
  });
}

export function generatedStateResourceConsumerCredentialV1(input: Readonly<{
  resourceId: `sha256:${string}`;
  owner: string;
  leaseId: `sha256:${string}`;
  consumerId: string;
}>): `sha256:${string}` {
  const consumerId = stringValue(input.consumerId, 'resource consumerId');
  return generatedStateDigestV1(Object.freeze({
    schema: 'sec-generated-state-resource-consumer-credential-v1',
    resourceId: input.resourceId,
    owner: stringValue(input.owner, 'resource consumer owner'),
    leaseId: input.leaseId,
    consumerId
  }));
}

function resourceRegistrationMaterialV1(input: Omit<GeneratedStateResourceRegistrationV1, 'schema' | 'registrationDigest'>) {
  return Object.freeze({ schema: GENERATED_STATE_RESOURCE_REGISTRATION_SCHEMA_V1, ...input });
}

export function createGeneratedStateResourceRegistrationV1(input: Readonly<{
  resourceId: `sha256:${string}`;
  repositoryRoot: string;
  workspace: GeneratedStatePhysicalIdentityV1;
  rule: GeneratedStateRuleV1;
  relativePath: string;
  root: GeneratedStatePhysicalIdentityV1 | null;
  rootKind: GeneratedStateRootKindV1 | null;
  linkTarget?: string | null;
  operationId: string;
}>): GeneratedStateResourceRegistrationV1 {
  const relativePath = normalizeGeneratedStateRelativePathV1(input.relativePath);
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.resourceId)) fail('resourceId must be one SHA-256 digest.');
  if (generatedStateRuleForPathV1(relativePath)?.id !== input.rule.id) {
    fail('resource registration path does not resolve to its rule.');
  }
  if (input.rootKind !== null && !ROOT_KINDS.has(input.rootKind)) fail('resource root kind is invalid.');
  if ((input.root === null) !== (input.rootKind === null)) fail('resource root and root kind disagree.');
  const owner = stringValue(input.rule.owner, 'resource.owner');
  const operationId = stringValue(input.operationId, 'resource.operationId');
  const retentionPolicy: GeneratedStateResourceRetentionPolicyV1 = input.rule.cleanupProfiles.length > 0
    ? 'consumer-zero'
    : 'owner-retained';
  const material = resourceRegistrationMaterialV1({
    resourceId: input.resourceId,
    repositoryRoot: stringValue(input.repositoryRoot, 'resource.repositoryRoot'),
    workspace: physicalIdentityV1(input.workspace, 'resource.workspace'),
    ruleId: input.rule.id,
    relativePath,
    root: input.root === null ? null : physicalIdentityV1(input.root, 'resource.root'),
    rootKind: input.rootKind,
    linkTarget: input.linkTarget ?? null,
    owner,
    producer: stringValue(input.rule.producer, 'resource.producer'),
    operationId,
    lease: resourceLeaseMaterialV1({ resourceId: input.resourceId, owner, operationId }),
    retention: Object.freeze({ policy: retentionPolicy, consumers: Object.freeze([]) }),
    terminalObligation: Object.freeze({ state: 'open', settlementRef: null, outcomeDigest: null }),
    phase: 'active',
    transitionEpoch: 0
  });
  return Object.freeze({ ...material, registrationDigest: generatedStateDigestV1(material) });
}

export function parseGeneratedStateResourceRegistrationV1(value: unknown): GeneratedStateResourceRegistrationV1 {
  const record = plainRecord(value, 'resource registration');
  exactKeys(record, [
    'schema', 'resourceId', 'repositoryRoot', 'workspace', 'ruleId', 'relativePath', 'root',
    'rootKind', 'linkTarget', 'owner', 'producer', 'operationId', 'lease', 'retention',
    'terminalObligation', 'phase', 'transitionEpoch', 'registrationDigest'
  ], 'resource registration');
  if (record.schema !== GENERATED_STATE_RESOURCE_REGISTRATION_SCHEMA_V1) {
    fail('resource registration schema is invalid.');
  }
  const resourceId = digestValue(record.resourceId, 'resource.registration.resourceId');
  const ruleId = stringValue(record.ruleId, 'resource.registration.ruleId');
  const rule = GENERATED_STATE_REGISTRY_V1.rules.find(({ id }) => id === ruleId);
  if (rule === undefined) fail('resource registration rule is absent from the current registry.');
  const relativePath = normalizeGeneratedStateRelativePathV1(
    stringValue(record.relativePath, 'resource.registration.relativePath')
  );
  const rootKind = record.rootKind === null ? null : record.rootKind as GeneratedStateRootKindV1;
  if (rootKind !== null && !ROOT_KINDS.has(rootKind)) fail('resource registration rootKind is invalid.');
  const root = record.root === null ? null : physicalIdentityV1(record.root, 'resource.registration.root');
  if ((root === null) !== (rootKind === null)) fail('resource registration root and rootKind disagree.');
  const leaseRecord = plainRecord(record.lease, 'resource registration lease');
  exactKeys(leaseRecord, ['leaseId', 'owner', 'operationId', 'state'], 'resource registration lease');
  const leaseState = leaseRecord.state;
  if (leaseState !== 'held' && leaseState !== 'released') fail('resource registration lease state is invalid.');
  const lease = Object.freeze({
    leaseId: digestValue(leaseRecord.leaseId, 'resource registration leaseId'),
    owner: stringValue(leaseRecord.owner, 'resource registration lease.owner'),
    operationId: stringValue(leaseRecord.operationId, 'resource registration lease.operationId'),
    state: leaseState
  });
  const expectedLease = resourceLeaseMaterialV1({
    resourceId,
    owner: stringValue(record.owner, 'resource.registration.owner'),
    operationId: stringValue(record.operationId, 'resource.registration.operationId')
  });
  if (lease.leaseId !== expectedLease.leaseId || lease.owner !== expectedLease.owner ||
      lease.operationId !== expectedLease.operationId) {
    fail('resource registration lease is not bound to its owner identity.');
  }
  const transitionEpoch = record.transitionEpoch;
  if (!Number.isSafeInteger(transitionEpoch) || (transitionEpoch as number) < 0) {
    fail('resource registration transitionEpoch is invalid.');
  }
  const retentionRecord = plainRecord(record.retention, 'resource registration retention');
  exactKeys(retentionRecord, ['policy', 'consumers'], 'resource registration retention');
  if (retentionRecord.policy !== 'consumer-zero' && retentionRecord.policy !== 'owner-retained') {
    fail('resource registration retention policy is invalid.');
  }
  if (!Array.isArray(retentionRecord.consumers)) fail('resource registration retention consumers are invalid.');
  const consumers = retentionRecord.consumers.map((value, index) => {
    const consumer = plainRecord(value, `resource registration consumer ${index}`);
    exactKeys(consumer, ['consumerId', 'credential'], `resource registration consumer ${index}`);
    const consumerId = stringValue(consumer.consumerId, `resource registration consumer ${index}.consumerId`);
    const credential = digestValue(consumer.credential, `resource registration consumer ${index}.credential`);
    const expectedCredential = generatedStateResourceConsumerCredentialV1({
      resourceId,
      owner: stringValue(record.owner, 'resource.registration.owner'),
      leaseId: lease.leaseId,
      consumerId
    });
    if (credential !== expectedCredential) {
      fail(`resource registration consumer ${index} credential is not owner-issued.`);
    }
    return Object.freeze({ consumerId, credential });
  });
  if (new Set(consumers.map(({ consumerId }) => consumerId)).size !== consumers.length ||
      [...consumers].sort((left, right) => left.consumerId.localeCompare(right.consumerId))
        .map(({ consumerId }) => consumerId).join('\0') !== consumers.map(({ consumerId }) => consumerId).join('\0')) {
    fail('resource registration consumers are not canonical.');
  }
  const terminalRecord = plainRecord(record.terminalObligation, 'resource registration terminal obligation');
  exactKeys(terminalRecord, ['state', 'settlementRef', 'outcomeDigest'], 'resource registration terminal obligation');
  if (terminalRecord.state !== 'open' && terminalRecord.state !== 'satisfied') {
    fail('resource registration terminal obligation state is invalid.');
  }
  const settlementRef = terminalRecord.settlementRef === null
    ? null
    : digestValue(terminalRecord.settlementRef, 'resource registration settlementRef');
  const outcomeDigest = terminalRecord.outcomeDigest === null
    ? null
    : digestValue(terminalRecord.outcomeDigest, 'resource registration outcomeDigest');
  const phase = record.phase;
  if (phase !== 'active' && phase !== 'operational-terminal') fail('resource registration phase is invalid.');
  if ((phase === 'active') !== (terminalRecord.state === 'open') ||
      (phase === 'active') !== (leaseState === 'held') ||
      (phase === 'operational-terminal') !== (settlementRef !== null) ||
      (phase === 'operational-terminal') !== (outcomeDigest !== null)) {
    fail('resource registration phase, lease and terminal obligation disagree.');
  }
  const material = resourceRegistrationMaterialV1({
    resourceId,
    repositoryRoot: stringValue(record.repositoryRoot, 'resource.registration.repositoryRoot'),
    workspace: physicalIdentityV1(record.workspace, 'resource.registration.workspace'),
    ruleId,
    relativePath,
    root,
    rootKind,
    linkTarget: record.linkTarget === null ? null : stringValue(record.linkTarget, 'resource.registration.linkTarget'),
    owner: stringValue(record.owner, 'resource.registration.owner'),
    producer: stringValue(record.producer, 'resource.registration.producer'),
    operationId: stringValue(record.operationId, 'resource.registration.operationId'),
    lease,
    retention: Object.freeze({ policy: retentionRecord.policy, consumers: Object.freeze(consumers) }),
    terminalObligation: Object.freeze({ state: terminalRecord.state, settlementRef, outcomeDigest }),
    phase,
    transitionEpoch: transitionEpoch as number
  });
  if (material.owner !== rule.owner || material.producer !== rule.producer ||
      generatedStateRuleForPathV1(material.relativePath)?.id !== rule.id ||
      material.retention.policy !== (rule.cleanupProfiles.length > 0 ? 'consumer-zero' : 'owner-retained')) {
    fail('resource registration owner, producer, path or retention differs from the current rule.');
  }
  const expected = Object.freeze({ ...material, registrationDigest: generatedStateDigestV1(material) });
  if (expected.registrationDigest !== record.registrationDigest) {
    fail('resource registration digest is invalid.');
  }
  return expected;
}

export function createGeneratedStateResourceReceiptV1(input: Omit<
  GeneratedStateResourceReceiptV1,
  'schema' | 'receiptDigest'
>): GeneratedStateResourceReceiptV1 {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.resourceId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.registrationDigest)) {
    fail('resource receipt identity is invalid.');
  }
  if (!Number.isSafeInteger(input.consumerCount) || input.consumerCount < 0) {
    fail('resource receipt consumerCount is invalid.');
  }
  if (input.physicalClean && (!input.operationalTerminal || input.gcPending)) {
    fail('resource receipt physicalClean is not compatible with terminal/gcPending.');
  }
  if (input.physicalClean && input.reclaimability === 'unknown') {
    fail('resource receipt physicalClean cannot have unknown reclaimability.');
  }
  if (input.gcPending && (!input.operationalTerminal || input.physicalClean || input.reclaimability !== 'eligible')) {
    fail('resource receipt gcPending requires one eligible terminal residue.');
  }
  if (!input.operationalTerminal && (input.physicalClean || input.gcPending || input.reclaimability === 'eligible')) {
    fail('resource receipt active state cannot be clean, pending or eligible.');
  }
  const material = Object.freeze({
    schema: GENERATED_STATE_RESOURCE_RECEIPT_SCHEMA_V1,
    resourceId: input.resourceId,
    registrationDigest: input.registrationDigest,
    repositoryRoot: stringValue(input.repositoryRoot, 'resource receipt.repositoryRoot'),
    workspace: physicalIdentityV1(input.workspace, 'resource receipt.workspace'),
    relativePath: normalizeGeneratedStateRelativePathV1(input.relativePath),
    phase: input.phase,
    operationalTerminal: input.operationalTerminal,
    physicalClean: input.physicalClean,
    gcPending: input.gcPending,
    reclaimability: input.reclaimability,
    consumerCount: input.consumerCount,
    observedRoot: input.observedRoot === null ? null : physicalIdentityV1(input.observedRoot, 'resource receipt.observedRoot'),
    blockers: Object.freeze([...new Set(input.blockers.map((value) => stringValue(value, 'resource receipt blocker')))].sort())
  });
  if (material.phase !== 'active' && material.phase !== 'operational-terminal') {
    fail('resource receipt phase is invalid.');
  }
  if (material.reclaimability !== 'eligible' && material.reclaimability !== 'blocked' &&
      material.reclaimability !== 'unknown') {
    fail('resource receipt reclaimability is invalid.');
  }
  if ((material.phase === 'active') !== (!material.operationalTerminal)) {
    fail('resource receipt phase and operationalTerminal disagree.');
  }
  return Object.freeze({ ...material, receiptDigest: generatedStateDigestV1(material) });
}

export function assertGeneratedStateResourceRegistrationV1(
  value: GeneratedStateResourceRegistrationV1
): GeneratedStateResourceRegistrationV1 {
  return parseGeneratedStateResourceRegistrationV1(value);
}

export function assertGeneratedStateResourceReceiptV1(
  value: GeneratedStateResourceReceiptV1
): GeneratedStateResourceReceiptV1 {
  const record = createGeneratedStateResourceReceiptV1(value);
  if (!canonicalEquals(value, record) || record.receiptDigest !== value.receiptDigest) {
    fail('resource receipt is not canonical.');
  }
  return record;
}

/**
 * Pure reclaimability projection.  Callers must supply an observation made
 * by the physical no-follow owner; this function never infers safety from a
 * path name, timestamp, or an absent registration.
 */
export function generatedStateResourceReclaimabilityV1(input: Readonly<{
  registration: GeneratedStateResourceRegistrationV1 | null;
  observedRoot: GeneratedStatePhysicalIdentityV1 | null;
  observedKind: GeneratedStateRootKindV1 | 'missing' | null;
}>): GeneratedStateReclaimabilityV1 {
  const registration = input.registration;
  if (registration === null) return 'unknown';
  if (registration.phase !== 'operational-terminal' || registration.lease.state !== 'released') {
    return 'blocked';
  }
  if (registration.retention.policy === 'consumer-zero' && registration.retention.consumers.length > 0) {
    return 'blocked';
  }
  // `missing` is the only complete absent readback.  A null kind is the
  // physical observer's unresolved/no-follow result and must never be
  // promoted to absence merely because the identity is also null.
  if (input.observedKind === 'missing') {
    return input.observedRoot === null ? 'eligible' : 'unknown';
  }
  if (input.observedKind === null || input.observedRoot === null || registration.root === null) {
    return 'unknown';
  }
  const expectedForm = GENERATED_STATE_REGISTRY_V1.rules
    .find(({ id }) => id === registration.ruleId)?.physicalForms
    .find(({ kind }) => kind === input.observedKind);
  if (expectedForm === undefined || !samePhysicalIdentityV1(registration.root, input.observedRoot)) {
    return 'unknown';
  }
  return 'eligible';
}

function samePhysicalIdentityV1(
  left: GeneratedStatePhysicalIdentityV1,
  right: GeneratedStatePhysicalIdentityV1
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}
