import path from 'node:path';
import {
  GENERATED_STATE_REGISTRY, createGeneratedStateInventory, generatedStateCleanupAllowed,
  generatedStateLegacyRetirementRuleForPath,
  generatedStateRuleForPath,
  normalizeGeneratedStateRelativePath,
  type GeneratedStateCleanupProfile,
  type GeneratedStateInventory, type GeneratedStateInventoryEntry,
  type GeneratedStatePhysicalForm,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateRegistration,
  type GeneratedStateRule
} from '../../execution/generated-state/contract.ts';
import type { GeneratedStateGitObservationBackend, GeneratedStatePhysicalObservationBackend } from '../../execution/generated-state/physical-port.ts';
import type { GeneratedStateRegistrationObservationBackend } from '../../execution/generated-state/registration-port.ts';

export interface GeneratedStateInventoryDependencies {
  readonly physical: GeneratedStatePhysicalObservationBackend;
  readonly git: GeneratedStateGitObservationBackend;
  readonly registrations: GeneratedStateRegistrationObservationBackend;
  readonly environment?: NodeJS.ProcessEnv;
  readonly clock?: () => Date;
}
function sameIdentity(left: GeneratedStatePhysicalIdentity, right: GeneratedStatePhysicalIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}
function physicalFormForObservedKind(rule: GeneratedStateRule, kind: 'missing' | 'directory' | 'file' | 'link'): GeneratedStatePhysicalForm | null {
  return kind === 'missing' ? null : rule.physicalForms.find(form => form.kind === kind) ?? null;
}
async function workspaceRegistrationState(workspaceRoot: string, dependencies: GeneratedStateInventoryDependencies): Promise<GeneratedStateInventory['workspaceRegistration']> {
  try {
    const result = await dependencies.git.observeWorktrees();
    if (result.state !== 'observed') return 'unresolved';
    const key = path.resolve(workspaceRoot).toLocaleLowerCase('en-US');
    return result.worktrees.some(record => path.resolve(record.path).toLocaleLowerCase('en-US') === key) ? 'registered' : 'absent';
  } catch { return 'unresolved'; }
}

function knownPathOrAncestor(relativePath: string): boolean {
  return GENERATED_STATE_REGISTRY.rules.some(({ selector }) => {
    const target = selector.kind === 'exact' ? selector.path : selector.parent;
    return relativePath === target || target.startsWith(`${relativePath}/`);
  });
}

function candidatePaths(physical: GeneratedStatePhysicalObservationBackend): readonly string[] {
  const candidates = new Set<string>();
  for (const rule of GENERATED_STATE_REGISTRY.rules) {
    if (rule.selector.kind === 'exact') {
      candidates.add(rule.selector.path);
      continue;
    }
    try {
      for (const name of physical.listDirectoryChildren(rule.selector.parent)) {
        if (name.startsWith(rule.selector.prefix)) {
          candidates.add(`${rule.selector.parent}/${name}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  for (const parent of new Set([
    '.tmp',
    ...GENERATED_STATE_REGISTRY.rules.flatMap(({ selector }) =>
      selector.kind === 'direct-child-prefix' ? [selector.parent] : [])
  ])) {
    try {
      for (const name of physical.listDirectoryChildren(parent)) {
        const relativePath = `${parent}/${name}`;
        if (!knownPathOrAncestor(relativePath)) candidates.add(relativePath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return Object.freeze([...candidates].sort());
}

export async function inspectGeneratedState(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePaths?: readonly string[];
}>, options: GeneratedStateInventoryDependencies): Promise<GeneratedStateInventory> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const workspace = options.physical.observeWorkspace();
  const store = options.registrations.openObservation({ workspaceRoot, environment: options.environment });
  let registrationCensus: ReturnType<typeof options.registrations.readRegistrationCensus> | null = null;
  let registrationCensusFailure: unknown;
  let registrationCensusFailed = false;
  if (store !== null) {
    try { registrationCensus = options.registrations.readRegistrationCensus(store); }
    catch (error) { registrationCensusFailed = true; registrationCensusFailure = error; }
  }
  const loadRegistration = (resource: typeof store, relativePath: string) => resource === null ? null
    : (() => { if (registrationCensusFailed) throw registrationCensusFailure;
      return registrationCensus?.observations.get(relativePath)?.registration ?? null; })();
  const entries: GeneratedStateInventoryEntry[] = [];
  const relativePaths = input.relativePaths === undefined
    ? candidatePaths(options.physical)
    : Object.freeze([...new Set(input.relativePaths.map(normalizeGeneratedStateRelativePath))].sort());
  for (const relativePath of relativePaths) {
    const observed = options.physical.observeRoot(relativePath);
    const activeRule = generatedStateRuleForPath(relativePath);
    const legacyRule = activeRule === null
      ? generatedStateLegacyRetirementRuleForPath(relativePath)
      : null;
    let legacyRegistration: GeneratedStateRegistration | null = null;
    let legacyRegistrationInvalid = false;
    if (activeRule === null && legacyRule !== null && store !== null) {
      try {
        legacyRegistration = loadRegistration(store, relativePath);
      } catch {
        legacyRegistrationInvalid = true;
      }
    }
    const rule = activeRule ?? (
      legacyRule !== null && legacyRegistration !== null
        && legacyRegistration.ruleId === legacyRule.id
        && legacyRegistration.owner === legacyRule.owner
        && legacyRegistration.producer === legacyRule.producer
        ? legacyRule
        : null
    );
    if (rule === null) {
      entries.push(Object.freeze({
        relativePath,
        kind: observed.kind,
        ruleId: null,
        owner: null,
        stateClass: 'unknown-unclassified',
        registrationState: 'missing',
        cleanupProfiles: Object.freeze([]),
        settlement: 'blocked',
        blockers: Object.freeze([legacyRegistrationInvalid
          ? 'legacy-registration-invalid'
          : 'unknown-generated-state']),
        physicalIdentity: observed.identity,
        registrationDigest: null
      }));
      continue;
    }
    let registration: GeneratedStateRegistration | null = null;
    let registrationState: GeneratedStateInventoryEntry['registrationState'] = 'not-required';
    const blockers: string[] = [];
    if (rule.registration === 'required-at-birth') {
      try {
        registration = loadRegistration(store, relativePath);
        registrationState = registration?.phase ?? 'missing';
      } catch {
        registrationState = 'invalid';
        blockers.push('registration-invalid');
      }
      if (registration === null && registrationState !== 'invalid' && observed.kind !== 'missing') {
        blockers.push('registration-missing');
      }
      if (registration?.phase === 'active' && observed.identity === null) {
        blockers.push('active-registered-root-absent');
      }
      if (registration !== null && observed.identity !== null && !sameIdentity(registration.root, observed.identity)) {
        blockers.push('registered-root-identity-changed');
      }
      if (registration?.phase === 'active') blockers.push('owner-active');
    }
    const physicalForm = physicalFormForObservedKind(rule, observed.kind);
    if (observed.kind !== 'missing' && physicalForm === null) {
      blockers.push('root-kind-differs-from-policy');
    }
    if (physicalForm?.settlementEffect === 'domain-owner-only' && observed.kind !== 'missing') {
      blockers.push('domain-owner-settlement-required');
    }
    const ready = observed.identity !== null && blockers.length === 0 && registration?.phase === 'retired';
    entries.push(Object.freeze({
      relativePath,
      kind: observed.kind,
      ruleId: rule.id,
      owner: rule.owner,
      stateClass: rule.stateClass,
      registrationState,
      cleanupProfiles: rule.cleanupProfiles,
      settlement: ready ? 'ready' : 'protected',
      blockers: Object.freeze(blockers.sort()),
      physicalIdentity: observed.identity,
      registrationDigest: registration?.registrationDigest ?? null
    }));
  }
  const blockers = entries.flatMap((entry) => entry.blockers
    .filter((blocker) => blocker !== 'owner-active')
    .map((blocker) => `${entry.relativePath}:${blocker}`));
  if (store !== null) await options.registrations.assertObservationCurrent(store);
  return createGeneratedStateInventory({
    repositoryRoot,
    workspace: { device: workspace.device, inode: workspace.inode, objectId: workspace.objectId },
    workspaceRegistration: input.relativePaths === undefined
      ? await workspaceRegistrationState(workspaceRoot, options)
      : 'unresolved',
    entries: Object.freeze(entries),
    blockers: Object.freeze(blockers)
  });
}

export function planGeneratedStateCleanup(input: Readonly<{
  inventory: GeneratedStateInventory;
  profile: GeneratedStateCleanupProfile;
}>): Readonly<{ selected: readonly string[]; protected: readonly string[] }> {
  const selected: string[] = [];
  const protectedPaths: string[] = [];
  for (const entry of input.inventory.entries) {
    if (entry.kind === 'missing') continue;
    if (generatedStateCleanupAllowed({ entry, profile: input.profile })) selected.push(entry.relativePath);
    else protectedPaths.push(entry.relativePath);
  }
  return Object.freeze({
    selected: Object.freeze(selected.sort()),
    protected: Object.freeze(protectedPaths.sort())
  });
}
