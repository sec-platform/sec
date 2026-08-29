import registrySource from './registry.json' with { type: 'json' };

import { canonicalEquals, rawSha256 } from '../../system-architecture/foundation/runtime/canonical.ts';

export const GENERATED_STATE_REGISTRY_SCHEMA = 'sec-generated-state-registry-v1' as const;
export const GENERATED_STATE_REGISTRATION_SCHEMA = 'sec-generated-state-registration-v1' as const;
export const GENERATED_STATE_INVENTORY_SCHEMA = 'sec-generated-state-inventory-v1' as const;
export const GENERATED_STATE_SETTLEMENT_SCHEMA = 'sec-generated-state-settlement-v1' as const;
export const GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA = "sec-generated-state-worktree-retirement-v1" as const;

export type GeneratedStateClass =
  | 'rebuildable-derived-cache'
  | 'active-ephemeral-workspace'
  | 'bounded-diagnostic'
  | 'identity-bound-control-state'
  | 'recovery-authority'
  | 'quarantine-pending-cleanup'
  | 'external-provider-cache'
  | 'unknown-unclassified';

export type GeneratedStateObservedClass = GeneratedStateClass | 'orphaned-owned-workspace';
export type GeneratedStateCleanupProfile = 'automatic' | 'safe' | 'all-rebuildable';
export type GeneratedStateRegistrationPolicy = 'required-at-birth' | 'domain-owned';
export type GeneratedStateRetirementPolicy = 'domain-receipt-required';
export type GeneratedStateRootKind = 'directory' | 'file' | 'link';
export type GeneratedStateScope = 'workspace' | 'operation';
export type GeneratedStateActiveOwnerSignal = 'birth-registration' | 'domain-owner-receipt';
export type GeneratedStateContentsPolicy =
  | 'owner-bounded-tree'
  | 'ordinary-file'
  | 'opaque-protected-tree'
  | 'owner-bound-locator';
export type GeneratedStateCapacityPolicyRef = 'issue-316' | 'owner-defined-protected';
export type GeneratedStateSettlementEffect = 'generated-state-quarantine-delete-readback' | 'domain-owner-only';
export type GeneratedStateWorktreeRetirementDisposition =
  | Readonly<{ mode: 'preserve' }>
  | Readonly<{ mode: 'domain-retire'; providerId: string }>;
export interface GeneratedStatePhysicalForm {
  readonly kind: GeneratedStateRootKind;
  readonly contentsPolicy: GeneratedStateContentsPolicy;
  readonly settlementEffect: GeneratedStateSettlementEffect;
  readonly worktreeRetirement: GeneratedStateWorktreeRetirementDisposition;
}
export type GeneratedStateReconstruction =
  | 'producer-recompute'
  | 'fixture-rebuild'
  | 'rerun-diagnostic'
  | 'owner-recovery-only';

export type GeneratedStateSelector =
  | Readonly<{ kind: 'exact'; path: string }>
  | Readonly<{ kind: 'direct-child-prefix'; parent: string; prefix: string }>;

export interface GeneratedStateRule {
  readonly id: string;
  readonly selector: GeneratedStateSelector;
  readonly stateClass: Exclude<GeneratedStateClass, 'quarantine-pending-cleanup' | 'unknown-unclassified'>;
  readonly owner: string;
  readonly producer: string;
  readonly physicalForms: readonly GeneratedStatePhysicalForm[];
  readonly scope: GeneratedStateScope;
  readonly activeOwnerSignal: GeneratedStateActiveOwnerSignal;
  readonly capacityPolicyRef: GeneratedStateCapacityPolicyRef;
  readonly registration: GeneratedStateRegistrationPolicy;
  readonly reconstruction: GeneratedStateReconstruction;
  readonly cleanupProfiles: readonly GeneratedStateCleanupProfile[];
  readonly retirement: GeneratedStateRetirementPolicy;
}

export interface GeneratedStateRegistry {
  readonly schema: typeof GENERATED_STATE_REGISTRY_SCHEMA;
  readonly rules: readonly GeneratedStateRule[];
  readonly registryDigest: `sha256:${string}`;
}

export interface GeneratedStatePhysicalIdentity {
  readonly device: string;
  readonly inode: string;
  readonly objectId: string;
}

export interface GeneratedStateRegistration {
  readonly schema: typeof GENERATED_STATE_REGISTRATION_SCHEMA;
  readonly registrationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentity;
  readonly ruleId: string;
  readonly relativePath: string;
  readonly root: GeneratedStatePhysicalIdentity;
  readonly owner: string;
  readonly producer: string;
  readonly operationId: string;
  readonly phase: 'active' | 'retired';
  readonly retirementRef: `sha256:${string}` | null;
  readonly generatedAt: string;
  readonly registrationDigest: `sha256:${string}`;
}

export interface GeneratedStateInventoryEntry {
  readonly relativePath: string;
  readonly kind: 'directory' | 'file' | 'link' | 'missing';
  readonly ruleId: string | null;
  readonly owner: string | null;
  readonly stateClass: GeneratedStateObservedClass;
  readonly registrationState: 'not-required' | 'active' | 'retired' | 'missing' | 'invalid';
  readonly cleanupProfiles: readonly GeneratedStateCleanupProfile[];
  readonly settlement: 'ready' | 'protected' | 'blocked';
  readonly blockers: readonly string[];
  readonly physicalIdentity: GeneratedStatePhysicalIdentity | null;
  readonly registrationDigest: `sha256:${string}` | null;
}

export interface GeneratedStateInventory {
  readonly schema: typeof GENERATED_STATE_INVENTORY_SCHEMA;
  readonly registryDigest: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentity;
  readonly workspaceRegistration: 'registered' | 'absent' | 'unresolved';
  readonly entries: readonly GeneratedStateInventoryEntry[];
  readonly blockers: readonly string[];
  readonly inventoryDigest: `sha256:${string}`;
}

export interface GeneratedStateSettlement {
  readonly schema: typeof GENERATED_STATE_SETTLEMENT_SCHEMA;
  readonly repositoryRoot: string;
  readonly registryDigest: `sha256:${string}`;
  readonly beforeInventoryDigest: `sha256:${string}`;
  readonly afterInventoryDigest: `sha256:${string}`;
  readonly profile: GeneratedStateCleanupProfile | 'inspect-only';
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

export interface GeneratedStateWorktreePreservedEntry {
  readonly relativePath: string;
  readonly destinationName: string;
  readonly source: GeneratedStatePhysicalIdentity;
  readonly retained: GeneratedStatePhysicalIdentity;
  readonly inventoryDigest: `sha256:${string}`;
  readonly ruleIds: readonly string[];
  readonly action: 'preserved';
}

export interface GeneratedStateWorktreeDomainRetiredEntry {
  readonly relativePath: string;
  readonly source: GeneratedStatePhysicalIdentity;
  readonly inventoryDigest: `sha256:${string}`;
  readonly ruleIds: readonly string[];
  readonly action: 'domain-retired';
  readonly providerId: string;
  readonly providerPlanDigest: `sha256:${string}`;
  readonly providerReceiptBytes: string;
  readonly providerReceiptDigest: `sha256:${string}`;
}

export type GeneratedStateWorktreeRetirementEntry =
  | GeneratedStateWorktreePreservedEntry
  | GeneratedStateWorktreeDomainRetiredEntry;

/**
 * Durable #271 handoff for an enclosing #186 worktree retirement.
 *
 * The generated-state owner never infers deletion authority here. It proves
 * every ignored root is registry-covered, preserves ordinary roots outside
 * the worktree, and composes exact receipts from explicitly named domain
 * providers for locator-like physical forms.
 */
export interface GeneratedStateWorktreeRetirement {
  readonly schema: typeof GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA;
  readonly operationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspacePath: string;
  readonly workspace: GeneratedStatePhysicalIdentity;
  readonly worktree: {
    readonly branch: string;
    readonly headSha: string;
    readonly treeSha: string;
  };
  readonly registryDigest: `sha256:${string}`;
  readonly statusDigest: `sha256:${string}`;
  readonly inventoryDigest: `sha256:${string}`;
  readonly retentionRoot: ({ readonly path: string } & GeneratedStatePhysicalIdentity) | null;
  readonly entries: readonly GeneratedStateWorktreeRetirementEntry[];
  readonly blockers: readonly string[];
  readonly terminal: 'completed' | 'residue';
  readonly receiptDigest: `sha256:${string}`;
}

const STATE_CLASSES = new Set<GeneratedStateClass>([
  'rebuildable-derived-cache',
  'active-ephemeral-workspace',
  'bounded-diagnostic',
  'identity-bound-control-state',
  'recovery-authority',
  'quarantine-pending-cleanup',
  'external-provider-cache',
  'unknown-unclassified'
]);
const CLEANUP_PROFILES = new Set<GeneratedStateCleanupProfile>([
  'automatic', 'safe', 'all-rebuildable'
]);
const RECONSTRUCTION = new Set<GeneratedStateReconstruction>([
  'producer-recompute', 'fixture-rebuild', 'rerun-diagnostic', 'owner-recovery-only'
]);
const ROOT_KINDS = new Set<GeneratedStateRootKind>(['directory', 'file', 'link']);
const SCOPES = new Set<GeneratedStateScope>(['workspace', 'operation']);
const ACTIVE_OWNER_SIGNALS = new Set<GeneratedStateActiveOwnerSignal>([
  'birth-registration', 'domain-owner-receipt'
]);
const CONTENTS_POLICIES = new Set<GeneratedStateContentsPolicy>([
  'owner-bounded-tree', 'ordinary-file', 'opaque-protected-tree', 'owner-bound-locator'
]);
const CAPACITY_POLICY_REFS = new Set<GeneratedStateCapacityPolicyRef>([
  'issue-316', 'owner-defined-protected'
]);
const SETTLEMENT_EFFECTS = new Set<GeneratedStateSettlementEffect>([
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

export function normalizeGeneratedStateRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (normalized.length === 0 || normalized.startsWith('/') || normalized.includes('//')
      || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      || /[\u0000-\u001f\u007f]/u.test(normalized)) fail('relative path is not canonical.');
  return normalized;
}

function parseSelector(value: unknown, label: string): GeneratedStateSelector {
  const record = plainRecord(value, label);
  if (record.kind === 'exact') {
    exactKeys(record, ['kind', 'path'], label);
    return Object.freeze({ kind: 'exact', path: normalizeGeneratedStateRelativePath(
      stringValue(record.path, `${label}.path`)
    ) });
  }
  if (record.kind === 'direct-child-prefix') {
    exactKeys(record, ['kind', 'parent', 'prefix'], label);
    const prefix = stringValue(record.prefix, `${label}.prefix`);
    if (prefix.includes('/') || prefix === '.' || prefix === '..') fail(`${label}.prefix is not one name prefix.`);
    return Object.freeze({
      kind: 'direct-child-prefix',
      parent: normalizeGeneratedStateRelativePath(stringValue(record.parent, `${label}.parent`)),
      prefix
    });
  }
  return fail(`${label}.kind is unsupported.`);
}

export function parseGeneratedStateRegistry(value: unknown): GeneratedStateRegistry {
  const root = plainRecord(value, 'registry');
  exactKeys(root, ['schema', 'rules'], 'registry');
  if (root.schema !== GENERATED_STATE_REGISTRY_SCHEMA || !Array.isArray(root.rules)) {
    fail('registry schema or rules are invalid.');
  }
  const ids = new Set<string>();
  const selectors = new Set<string>();
  const rules = root.rules.map((candidate, index): GeneratedStateRule => {
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
    const stateClass = stringValue(rule.stateClass, `rules[${index}].stateClass`) as GeneratedStateClass;
    if (!STATE_CLASSES.has(stateClass) || stateClass === 'unknown-unclassified'
        || stateClass === 'quarantine-pending-cleanup') fail(`rules[${index}].stateClass is not registrable.`);
    const registration = rule.registration;
    if (registration !== 'required-at-birth' && registration !== 'domain-owned') {
      fail(`rules[${index}].registration is invalid.`);
    }
    const reconstruction = rule.reconstruction as GeneratedStateReconstruction;
    if (!RECONSTRUCTION.has(reconstruction)) fail(`rules[${index}].reconstruction is invalid.`);
    if (!Array.isArray(rule.cleanupProfiles)) fail(`rules[${index}].cleanupProfiles must be an array.`);
    const cleanupProfiles = rule.cleanupProfiles.map((profile, profileIndex) => {
      if (!CLEANUP_PROFILES.has(profile as GeneratedStateCleanupProfile)) {
        fail(`rules[${index}].cleanupProfiles[${profileIndex}] is invalid.`);
      }
      return profile as GeneratedStateCleanupProfile;
    });
    if (new Set(cleanupProfiles).size !== cleanupProfiles.length) {
      fail(`rules[${index}].cleanupProfiles contains duplicates.`);
    }
    if (rule.retirement !== 'domain-receipt-required') fail(`rules[${index}].retirement is invalid.`);
    const scope = rule.scope as GeneratedStateScope;
    const activeOwnerSignal = rule.activeOwnerSignal as GeneratedStateActiveOwnerSignal;
    const capacityPolicyRef = rule.capacityPolicyRef as GeneratedStateCapacityPolicyRef;
    if (!SCOPES.has(scope) || !ACTIVE_OWNER_SIGNALS.has(activeOwnerSignal)
        || !CAPACITY_POLICY_REFS.has(capacityPolicyRef)) {
      fail(`rules[${index}] lifecycle policy is invalid.`);
    }
    if (!Array.isArray(rule.physicalForms) || rule.physicalForms.length === 0) {
      fail(`rules[${index}].physicalForms must be a non-empty array.`);
    }
    const physicalForms = rule.physicalForms.map((candidateForm, formIndex): GeneratedStatePhysicalForm => {
      const form = plainRecord(candidateForm, `rules[${index}].physicalForms[${formIndex}]`);
      exactKeys(form, ['kind', 'contentsPolicy', 'settlementEffect', 'worktreeRetirement'], `rules[${index}].physicalForms[${formIndex}]`);
      const kind = form.kind as GeneratedStateRootKind;
      const contentsPolicy = form.contentsPolicy as GeneratedStateContentsPolicy;
      const settlementEffect = form.settlementEffect as GeneratedStateSettlementEffect;
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
      stateClass: stateClass as GeneratedStateRule['stateClass'],
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
  const material = Object.freeze({ schema: GENERATED_STATE_REGISTRY_SCHEMA, rules: Object.freeze(rules) });
  return Object.freeze({ ...material, registryDigest: rawSha256(JSON.stringify(material)) });
}

export const GENERATED_STATE_REGISTRY = parseGeneratedStateRegistry(registrySource);

export function generatedStateRuleForPath(
  relativePath: string,
  registry: GeneratedStateRegistry = GENERATED_STATE_REGISTRY
): GeneratedStateRule | null {
  const normalized = normalizeGeneratedStateRelativePath(relativePath);
  const matches = registry.rules.filter(({ selector }) => {
    if (selector.kind === 'exact') return normalized === selector.path;
    const parent = normalized.slice(0, normalized.lastIndexOf('/'));
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    return parent === selector.parent && name.startsWith(selector.prefix);
  });
  if (matches.length > 1) fail(`path ${normalized} matches multiple rules.`);
  return matches[0] ?? null;
}

export function generatedStateCleanupAllowed(input: Readonly<{
  entry: GeneratedStateInventoryEntry;
  profile: GeneratedStateCleanupProfile;
}>): boolean {
  const { entry, profile } = input;
  return entry.settlement === 'ready'
    && entry.registrationState === 'retired'
    && entry.cleanupProfiles.includes(profile);
}

export function generatedStateDigest(value: unknown): `sha256:${string}` {
  return rawSha256(JSON.stringify(value));
}

export function generatedStateDomainProviderMaterialDigest(
  providerId: string,
  kind: 'plan' | 'receipt',
  bytes: string
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: `sec-generated-state-domain-${kind}-bytes-v1`,
    providerId,
    bytes
  }));
}

function parsePhysicalIdentity(value: unknown, label: string): GeneratedStatePhysicalIdentity {
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

function registrationMaterial(input: Omit<
  GeneratedStateRegistration,
  'schema' | 'registrationId' | 'registrationDigest'
>): Omit<GeneratedStateRegistration, 'registrationDigest'> {
  const registrationId = generatedStateDigest(Object.freeze({
    schema: GENERATED_STATE_REGISTRATION_SCHEMA,
    repositoryRoot: input.repositoryRoot,
    workspace: input.workspace,
    ruleId: input.ruleId,
    relativePath: input.relativePath,
    root: input.root,
    owner: input.owner,
    producer: input.producer,
    operationId: input.operationId
  }));
  return Object.freeze({ schema: GENERATED_STATE_REGISTRATION_SCHEMA, registrationId, ...input });
}

export function createGeneratedStateRegistration(input: Readonly<{
  repositoryRoot: string;
  workspace: GeneratedStatePhysicalIdentity;
  rule: GeneratedStateRule;
  relativePath: string;
  root: GeneratedStatePhysicalIdentity;
  operationId: string;
}>, options: Readonly<{ clock?: () => Date }> = {}): GeneratedStateRegistration {
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  if (generatedStateRuleForPath(relativePath)?.id !== input.rule.id) {
    fail('registration path does not resolve to its rule.');
  }
  const material = registrationMaterial({
    repositoryRoot: stringValue(input.repositoryRoot, 'registration.repositoryRoot'),
    workspace: parsePhysicalIdentity(input.workspace, 'registration.workspace'),
    ruleId: input.rule.id,
    relativePath,
    root: parsePhysicalIdentity(input.root, 'registration.root'),
    owner: input.rule.owner,
    producer: input.rule.producer,
    operationId: stringValue(input.operationId, 'registration.operationId'),
    phase: 'active',
    retirementRef: null,
    generatedAt: (options.clock ?? (() => new Date()))().toISOString()
  });
  return Object.freeze({ ...material, registrationDigest: generatedStateDigest(material) });
}

export function retireGeneratedStateRegistration(
  registration: GeneratedStateRegistration,
  retirementRef: `sha256:${string}`,
  options: Readonly<{ clock?: () => Date }> = {}
): GeneratedStateRegistration {
  const current = parseGeneratedStateRegistration(registration);
  const material = registrationMaterial({
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
  return Object.freeze({ ...material, registrationDigest: generatedStateDigest(material) });
}

export function parseGeneratedStateRegistration(value: unknown): GeneratedStateRegistration {
  const record = plainRecord(value, 'registration');
  exactKeys(record, [
    'schema', 'registrationId', 'repositoryRoot', 'workspace', 'ruleId', 'relativePath',
    'root', 'owner', 'producer', 'operationId', 'phase', 'retirementRef', 'generatedAt',
    'registrationDigest'
  ], 'registration');
  if (record.schema !== GENERATED_STATE_REGISTRATION_SCHEMA) fail('registration schema is invalid.');
  const ruleId = stringValue(record.ruleId, 'registration.ruleId');
  const rule = GENERATED_STATE_REGISTRY.rules.find(({ id }) => id === ruleId);
  if (rule === undefined) fail('registration rule is absent from the current registry.');
  const phase = record.phase;
  if (phase !== 'active' && phase !== 'retired') fail('registration phase is invalid.');
  const retirementRef = record.retirementRef === null
    ? null
    : digestValue(record.retirementRef, 'registration.retirementRef');
  if ((phase === 'active') !== (retirementRef === null)) fail('registration phase and retirementRef disagree.');
  const material = registrationMaterial({
    repositoryRoot: stringValue(record.repositoryRoot, 'registration.repositoryRoot'),
    workspace: parsePhysicalIdentity(record.workspace, 'registration.workspace'),
    ruleId,
    relativePath: normalizeGeneratedStateRelativePath(
      stringValue(record.relativePath, 'registration.relativePath')
    ),
    root: parsePhysicalIdentity(record.root, 'registration.root'),
    owner: stringValue(record.owner, 'registration.owner'),
    producer: stringValue(record.producer, 'registration.producer'),
    operationId: stringValue(record.operationId, 'registration.operationId'),
    phase,
    retirementRef,
    generatedAt: stringValue(record.generatedAt, 'registration.generatedAt')
  });
  if (!Number.isFinite(Date.parse(material.generatedAt))) fail('registration.generatedAt is invalid.');
  if (material.owner !== rule.owner || material.producer !== rule.producer
      || generatedStateRuleForPath(material.relativePath)?.id !== rule.id) {
    fail('registration owner, producer or path differs from the current rule.');
  }
  const expected = Object.freeze({ ...material, registrationDigest: generatedStateDigest(material) });
  if (record.registrationId !== expected.registrationId
      || record.registrationDigest !== expected.registrationDigest) {
    fail('registration identity or digest is invalid.');
  }
  return expected;
}

export function createGeneratedStateInventory(input: Omit<
  GeneratedStateInventory,
  'schema' | 'registryDigest' | 'inventoryDigest'
>): GeneratedStateInventory {
  const entries = Object.freeze([...input.entries].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath)
  )));
  const blockers = Object.freeze([...new Set(input.blockers)].sort());
  const material = Object.freeze({
    schema: GENERATED_STATE_INVENTORY_SCHEMA,
    registryDigest: GENERATED_STATE_REGISTRY.registryDigest,
    repositoryRoot: input.repositoryRoot,
    workspace: input.workspace,
    workspaceRegistration: input.workspaceRegistration,
    entries,
    blockers
  });
  return Object.freeze({ ...material, inventoryDigest: generatedStateDigest(material) });
}

export function createGeneratedStateSettlement(input: Omit<
  GeneratedStateSettlement,
  'schema' | 'registryDigest' | 'generatedAt' | 'settlementDigest'
>, options: Readonly<{ clock?: () => Date }> = {}): GeneratedStateSettlement {
  const material = Object.freeze({
    schema: GENERATED_STATE_SETTLEMENT_SCHEMA,
    repositoryRoot: input.repositoryRoot,
    registryDigest: GENERATED_STATE_REGISTRY.registryDigest,
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
  return Object.freeze({ ...material, settlementDigest: generatedStateDigest(material) });
}

export function createGeneratedStateWorktreeRetirement(
  input: Omit<GeneratedStateWorktreeRetirement, 'schema' | 'registryDigest' | 'terminal' | 'receiptDigest'>
): GeneratedStateWorktreeRetirement {
  if (!/^[0-9a-f]{40}$/u.test(input.worktree.headSha) || !/^[0-9a-f]{40}$/u.test(input.worktree.treeSha)) {
    fail('worktree retirement Git identity is invalid.');
  }
  const branch = stringValue(input.worktree.branch, 'worktree retirement branch');
  if (/[/\\]$/u.test(branch) || branch.includes('..') || branch.includes('@{') || /[\u0000-\u0020~^:?*\[\\\u007f]/u.test(branch)) {
    fail('worktree retirement branch is invalid.');
  }
  const entries = [...input.entries]
    .map((entry) => {
      const relativePath = normalizeGeneratedStateRelativePath(entry.relativePath);
      if (!/^sha256:[0-9a-f]{64}$/u.test(entry.inventoryDigest)) {
        fail(`worktree retirement inventory digest is invalid for ${relativePath}.`);
      }
      const ruleIds = Object.freeze(
        [...new Set(entry.ruleIds.map((value) => stringValue(value, `worktree retirement rule for ${relativePath}`)))].sort()
      );
      if (ruleIds.length === 0 || ruleIds.some((ruleId) => !GENERATED_STATE_REGISTRY.rules.some(({ id }) => id === ruleId))) {
        fail(`worktree retirement rule coverage is invalid for ${relativePath}.`);
      }
      if (entry.action === 'domain-retired') {
        const providerId = stringValue(entry.providerId, `worktree retirement provider for ${relativePath}`);
        if (!SAFE_ID.test(providerId) || !/^sha256:[0-9a-f]{64}$/u.test(entry.providerPlanDigest) ||
            !/^sha256:[0-9a-f]{64}$/u.test(entry.providerReceiptDigest) || typeof entry.providerReceiptBytes !== 'string') {
          fail(`worktree retirement provider receipt is invalid for ${relativePath}.`);
        }
        if (entry.providerReceiptDigest !== generatedStateDomainProviderMaterialDigest(
          providerId,
          'receipt',
          entry.providerReceiptBytes
        )) {
          fail(`worktree retirement provider receipt digest is invalid for ${relativePath}.`);
        }
        return Object.freeze({
          relativePath,
          source: parsePhysicalIdentity(entry.source, `worktree retirement source ${relativePath}`),
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
        source: parsePhysicalIdentity(entry.source, `worktree retirement source ${relativePath}`),
        retained: parsePhysicalIdentity(entry.retained, `worktree retirement retained ${relativePath}`),
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
          ...parsePhysicalIdentity(
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
    schema: GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA,
    operationId: digestValue(input.operationId, 'worktree retirement operationId'),
    repositoryRoot: stringValue(input.repositoryRoot, 'worktree retirement repositoryRoot'),
    workspacePath: stringValue(input.workspacePath, 'worktree retirement workspacePath'),
    workspace: parsePhysicalIdentity(input.workspace, 'worktree retirement workspace'),
    worktree: Object.freeze({ branch, headSha: input.worktree.headSha, treeSha: input.worktree.treeSha }),
    registryDigest: GENERATED_STATE_REGISTRY.registryDigest,
    statusDigest: digestValue(input.statusDigest, 'worktree retirement statusDigest'),
    inventoryDigest: digestValue(input.inventoryDigest, 'worktree retirement inventoryDigest'),
    retentionRoot,
    entries: Object.freeze(entries),
    blockers,
    terminal: blockers.length === 0 ? ('completed' as const) : ('residue' as const)
  });
  return Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
}

export function assertGeneratedStateWorktreeRetirement(value: GeneratedStateWorktreeRetirement): GeneratedStateWorktreeRetirement {
  if (value.schema !== GENERATED_STATE_WORKTREE_RETIREMENT_SCHEMA) {
    fail('worktree retirement schema is invalid.');
  }
  const { schema: ignoredSchema, registryDigest, terminal, receiptDigest, ...input } = value;
  const rebuilt = createGeneratedStateWorktreeRetirement(input);
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
