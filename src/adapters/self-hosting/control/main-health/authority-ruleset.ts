
import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../verification/platform/action/contract/provider.ts';
import { INTEGRATION_AUTHORIZATION_STATUS_CONTEXT } from './github-status-namespace.ts';

export { INTEGRATION_AUTHORIZATION_STATUS_CONTEXT } from './github-status-namespace.ts';
const MAIN_AUTHORITY_RULESET_RECEIPT_SCHEMA =
  'sec-main-authority-ruleset-receipt-v1' as const;

type MainAuthorityRulesetDigest = `sha256:${string}`;

export interface MainAuthorityRulesetReceipt {
  readonly schema: typeof MAIN_AUTHORITY_RULESET_RECEIPT_SCHEMA;
  readonly status: 'enforced';
  readonly repository: string;
  readonly defaultBranch: string;
  readonly terminalStatusContext: typeof INTEGRATION_AUTHORIZATION_STATUS_CONTEXT;
  readonly terminalStatusIntegrationId: number;
  readonly authorityRulesetIds: readonly number[];
  readonly principalRulesetIds: readonly number[];
  readonly rulesetDigest: MainAuthorityRulesetDigest;
}

function fail(message: string): never {
  throw new Error(`MainAuthorityRuleset ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} must be bounded text.`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(`${label} must be a positive integer.`);
  return value as number;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function digest(value: unknown): MainAuthorityRulesetDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

function canonicalRepository(value: unknown): string {
  const repository = text(value, 'repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    fail('repository must be owner/name.');
  }
  return repository;
}

function canonicalBranch(value: unknown): string {
  const branch = text(value, 'defaultBranch');
  if (branch.includes('/') || branch.includes('\\') || branch === '.' || branch === '..') {
    fail('defaultBranch must be one canonical branch atom.');
  }
  return branch;
}

type EffectiveRule = Readonly<{
  type: string;
  rulesetId: number;
  parameters: Record<string, unknown> | null;
}>;

function parseEffectiveRules(value: unknown): readonly EffectiveRule[] {
  const seen = new Set<string>();
  return Object.freeze(array(value, 'effectiveRules').map((entry, index) => {
    const source = record(entry, `effectiveRules[${index}]`);
    const type = text(source.type, `effectiveRules[${index}].type`);
    const rulesetId = integer(source.ruleset_id, `effectiveRules[${index}].ruleset_id`);
    const key = `${rulesetId}:${type}`;
    if (seen.has(key)) fail(`effectiveRules contains duplicate ${key}.`);
    seen.add(key);
    const parameters = source.parameters === undefined || source.parameters === null
      ? null
      : record(source.parameters, `effectiveRules[${index}].parameters`);
    return Object.freeze({ type, rulesetId, parameters });
  }));
}

function refConditionTargetsDefaultBranch(value: unknown, defaultBranch: string): boolean {
  const conditions = record(value, 'ruleset.conditions');
  const refName = record(conditions.ref_name, 'ruleset.conditions.ref_name');
  const include = array(refName.include, 'ruleset.conditions.ref_name.include');
  const exclude = array(refName.exclude, 'ruleset.conditions.ref_name.exclude');
  if (exclude.length !== 0) fail('authority/principal ruleset must not exclude refs.');
  const expectedRef = `refs/heads/${defaultBranch}`;
  return include.some((entry) => entry === '~DEFAULT_BRANCH' || entry === expectedRef);
}

function requiredStatusRuleIsCanonical(
  parameters: Record<string, unknown> | null,
  expectedIntegrationId: number
): boolean {
  if (parameters === null || parameters.strict_required_status_checks_policy !== true) return false;
  const checks = array(parameters.required_status_checks, 'required_status_checks.parameters.required_status_checks');
  let exactMatches = 0;
  for (const [index, entry] of checks.entries()) {
    const check = record(entry, `required_status_checks[${index}]`);
    if (check.context === INTEGRATION_AUTHORIZATION_STATUS_CONTEXT) {
      if (check.integration_id !== expectedIntegrationId) return false;
      exactMatches += 1;
    }
  }
  return exactMatches === 1;
}

function updateRuleIsCanonical(parameters: Record<string, unknown> | null): boolean {
  return parameters !== null && parameters.update_allows_fetch_and_merge === false;
}

function parseRules(ruleset: Record<string, unknown>, id: number): Map<string, Record<string, unknown>> {
  const rules = array(ruleset.rules, `ruleset ${id}.rules`);
  const byType = new Map<string, Record<string, unknown>>();
  for (const [ruleIndex, rawRule] of rules.entries()) {
    const rule = record(rawRule, `ruleset ${id}.rules[${ruleIndex}]`);
    const type = text(rule.type, `ruleset ${id}.rules[${ruleIndex}].type`);
    if (byType.has(type)) fail(`ruleset ${id} contains duplicate rule type ${type}.`);
    byType.set(type, rule);
  }
  return byType;
}

function canonicalRuleParameters(
  rule: Record<string, unknown>,
  label: string
): Record<string, unknown> | null {
  return rule.parameters === undefined || rule.parameters === null
    ? null
    : record(rule.parameters, label);
}

export function createMainAuthorityRulesetReceipt(input: Readonly<{
  repository: string;
  defaultBranch: string;
  effectiveRules: unknown;
  detailedRulesets: unknown;
  /**
   * Exact GitHub Integration allowed to publish the terminal authorization and
   * consume the PR-only update bypass. GitHub Actions remains the compatibility
   * default, but provider-neutral trusted runtimes must pass their own App id.
   */
  expectedIntegrationId?: number;
}>): MainAuthorityRulesetReceipt {
  const repository = canonicalRepository(input.repository);
  const defaultBranch = canonicalBranch(input.defaultBranch);
  const effectiveRules = parseEffectiveRules(input.effectiveRules);
  const detailedRulesets = array(input.detailedRulesets, 'detailedRulesets');
  if (detailedRulesets.length === 0) fail('no detailed rulesets were observed.');

  const expectedIntegrationId = input.expectedIntegrationId === undefined
    ? CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id
    : integer(input.expectedIntegrationId, 'expectedIntegrationId');
  const effectiveByRuleset = new Map<number, Map<string, EffectiveRule>>();
  for (const rule of effectiveRules) {
    const byType = effectiveByRuleset.get(rule.rulesetId) ?? new Map<string, EffectiveRule>();
    byType.set(rule.type, rule);
    effectiveByRuleset.set(rule.rulesetId, byType);
  }

  const authorityRulesetIds: number[] = [];
  const principalRulesetIds: number[] = [];
  const canonicalAuthorityDetails: unknown[] = [];
  const canonicalPrincipalDetails: unknown[] = [];
  const seenIds = new Set<number>();
  for (const [index, entry] of detailedRulesets.entries()) {
    const ruleset = record(entry, `detailedRulesets[${index}]`);
    const id = integer(ruleset.id, `detailedRulesets[${index}].id`);
    if (seenIds.has(id)) fail(`detailedRulesets contains duplicate id ${id}.`);
    seenIds.add(id);
    if (ruleset.target !== 'branch' || ruleset.enforcement !== 'active') continue;
    if (!refConditionTargetsDefaultBranch(ruleset.conditions, defaultBranch)) continue;

    const byType = parseRules(ruleset, id);
    const effective = effectiveByRuleset.get(id);
    if (effective === undefined) continue;

    const authorityTypes = ['pull_request', 'deletion', 'non_fast_forward', 'required_status_checks'] as const;
    const hasAuthorityShape = authorityTypes.every((type) => byType.has(type))
      && authorityTypes.every((type) => effective.has(type));
    if (hasAuthorityShape) {
      if (byType.has('update') || effective.has('update')) {
        fail(`authority ruleset ${id} must not own update-principal restriction.`);
      }
      const statusRule = byType.get('required_status_checks')!;
      const statusParameters = canonicalRuleParameters(
        statusRule,
        `ruleset ${id}.required_status_checks.parameters`
      );
      const effectiveStatus = effective.get('required_status_checks')!;
      if (requiredStatusRuleIsCanonical(statusParameters, expectedIntegrationId)
        && requiredStatusRuleIsCanonical(effectiveStatus.parameters, expectedIntegrationId)) {
        if (!Object.prototype.hasOwnProperty.call(ruleset, 'bypass_actors')) {
          fail(`authority candidate ruleset ${id} has no observable bypass_actors; enforcement cannot be proven.`);
        }
        const bypassActors = array(ruleset.bypass_actors, `ruleset ${id}.bypass_actors`);
        if (bypassActors.length === 0) {
          authorityRulesetIds.push(id);
          canonicalAuthorityDetails.push(Object.freeze({
            id,
            sourceType: ruleset.source_type ?? null,
            source: ruleset.source ?? null,
            target: ruleset.target,
            enforcement: ruleset.enforcement,
            conditions: ruleset.conditions,
            bypassActors,
            rules: array(ruleset.rules, `ruleset ${id}.rules`)
          }));
        }
      }
    }

    const principalRule = byType.get('update');
    const effectivePrincipalRule = effective.get('update');
    const principalOnly = byType.size === 1 && principalRule !== undefined
      && effective.size === 1 && effectivePrincipalRule !== undefined;
    if (principalOnly
      && updateRuleIsCanonical(canonicalRuleParameters(principalRule, `ruleset ${id}.update.parameters`))
      && updateRuleIsCanonical(effectivePrincipalRule.parameters)) {
      if (!Object.prototype.hasOwnProperty.call(ruleset, 'bypass_actors')) {
        fail(`principal candidate ruleset ${id} has no observable bypass_actors; enforcement cannot be proven.`);
      }
      const bypassActors = array(ruleset.bypass_actors, `ruleset ${id}.bypass_actors`);
      if (bypassActors.length !== 1) continue;
      const actor = record(bypassActors[0], `ruleset ${id}.bypass_actors[0]`);
      if (actor.actor_type !== 'Integration'
        || actor.actor_id !== expectedIntegrationId
        || actor.bypass_mode !== 'pull_request') continue;
      principalRulesetIds.push(id);
      canonicalPrincipalDetails.push(Object.freeze({
        id,
        sourceType: ruleset.source_type ?? null,
        source: ruleset.source ?? null,
        target: ruleset.target,
        enforcement: ruleset.enforcement,
        conditions: ruleset.conditions,
        bypassActors,
        rules: array(ruleset.rules, `ruleset ${id}.rules`)
      }));
    }
  }

  if (authorityRulesetIds.length !== 1) {
    fail(`exactly one no-bypass authority ruleset must govern ${defaultBranch}; observed ${authorityRulesetIds.length}.`);
  }
  if (principalRulesetIds.length !== 1) {
    fail(`exactly one pull-request-only integration principal ruleset must govern ${defaultBranch}; observed ${principalRulesetIds.length}.`);
  }
  if (authorityRulesetIds[0] === principalRulesetIds[0]) {
    fail('authority and principal rulesets must be distinct layered rulesets.');
  }

  authorityRulesetIds.sort((left, right) => left - right);
  principalRulesetIds.sort((left, right) => left - right);
  const semantic = Object.freeze({
    schema: MAIN_AUTHORITY_RULESET_RECEIPT_SCHEMA,
    repository,
    defaultBranch,
    terminalStatusContext: INTEGRATION_AUTHORIZATION_STATUS_CONTEXT,
    terminalStatusIntegrationId: expectedIntegrationId,
    authorityRulesetIds: Object.freeze([...authorityRulesetIds]),
    principalRulesetIds: Object.freeze([...principalRulesetIds]),
    authorityDetails: Object.freeze(canonicalAuthorityDetails),
    principalDetails: Object.freeze(canonicalPrincipalDetails)
  });
  return Object.freeze({
    schema: MAIN_AUTHORITY_RULESET_RECEIPT_SCHEMA,
    status: 'enforced',
    repository,
    defaultBranch,
    terminalStatusContext: INTEGRATION_AUTHORIZATION_STATUS_CONTEXT,
    terminalStatusIntegrationId: expectedIntegrationId,
    authorityRulesetIds: semantic.authorityRulesetIds,
    principalRulesetIds: semantic.principalRulesetIds,
    rulesetDigest: digest(semantic)
  });
}
