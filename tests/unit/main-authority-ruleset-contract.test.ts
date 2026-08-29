import { expect, test } from 'bun:test';

import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../src/verification/action/contract/provider.ts';
import {
  INTEGRATION_AUTHORIZATION_STATUS_CONTEXT,
  createMainAuthorityRulesetReceipt
} from '../../src/control/main-health/authority-ruleset.ts';

const AUTHORITY_RULESET_ID = 42;
const PRINCIPAL_RULESET_ID = 43;

function requiredStatusParameters(input: Partial<{
  context: string;
  integrationId: number;
  strict: boolean;
}> = {}) {
  return {
    required_status_checks: [{
      context: input.context ?? INTEGRATION_AUTHORIZATION_STATUS_CONTEXT,
      integration_id: input.integrationId ?? CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id
    }],
    strict_required_status_checks_policy: input.strict ?? true
  };
}

function updateParameters(input: Partial<{ allowsFetchAndMerge: boolean }> = {}) {
  return { update_allows_fetch_and_merge: input.allowsFetchAndMerge ?? false };
}

function effectiveAuthorityRules(input: Partial<{
  id: number;
  includePullRequest: boolean;
  includeDeletion: boolean;
  includeNonFastForward: boolean;
  statusParameters: ReturnType<typeof requiredStatusParameters>;
}> = {}) {
  const id = input.id ?? AUTHORITY_RULESET_ID;
  const rules: unknown[] = [];
  if (input.includePullRequest ?? true) rules.push({ type: 'pull_request', ruleset_id: id });
  if (input.includeDeletion ?? true) rules.push({ type: 'deletion', ruleset_id: id });
  if (input.includeNonFastForward ?? true) rules.push({ type: 'non_fast_forward', ruleset_id: id });
  rules.push({
    type: 'required_status_checks',
    ruleset_id: id,
    parameters: input.statusParameters ?? requiredStatusParameters()
  });
  return rules;
}

function effectivePrincipalRule(input: Partial<{
  id: number;
  parameters: ReturnType<typeof updateParameters>;
}> = {}) {
  return {
    type: 'update',
    ruleset_id: input.id ?? PRINCIPAL_RULESET_ID,
    parameters: input.parameters ?? updateParameters()
  };
}

function detailedAuthorityRuleset(input: Partial<{
  id: number;
  enforcement: string;
  include: readonly string[];
  exclude: readonly string[];
  bypassActors: readonly unknown[];
  omitBypassActors: boolean;
  includePullRequest: boolean;
  includeDeletion: boolean;
  includeNonFastForward: boolean;
  includeUpdate: boolean;
  statusParameters: ReturnType<typeof requiredStatusParameters>;
}> = {}) {
  const rules: unknown[] = [];
  if (input.includePullRequest ?? true) rules.push({ type: 'pull_request' });
  if (input.includeDeletion ?? true) rules.push({ type: 'deletion' });
  if (input.includeNonFastForward ?? true) rules.push({ type: 'non_fast_forward' });
  if (input.includeUpdate ?? false) rules.push({ type: 'update', parameters: updateParameters() });
  rules.push({
    type: 'required_status_checks',
    parameters: input.statusParameters ?? requiredStatusParameters()
  });
  const result: Record<string, unknown> = {
    id: input.id ?? AUTHORITY_RULESET_ID,
    name: 'SEC main authority',
    target: 'branch',
    source_type: 'Repository',
    source: 'sec-platform/sec',
    enforcement: input.enforcement ?? 'active',
    conditions: {
      ref_name: {
        include: input.include ?? ['~DEFAULT_BRANCH'],
        exclude: input.exclude ?? []
      }
    },
    rules
  };
  if (!(input.omitBypassActors ?? false)) result.bypass_actors = input.bypassActors ?? [];
  return result;
}

function detailedPrincipalRuleset(input: Partial<{
  id: number;
  enforcement: string;
  include: readonly string[];
  exclude: readonly string[];
  bypassActors: readonly unknown[];
  omitBypassActors: boolean;
  parameters: ReturnType<typeof updateParameters>;
  extraRule: unknown;
}> = {}) {
  const result: Record<string, unknown> = {
    id: input.id ?? PRINCIPAL_RULESET_ID,
    name: 'SEC integration principal',
    target: 'branch',
    source_type: 'Repository',
    source: 'sec-platform/sec',
    enforcement: input.enforcement ?? 'active',
    conditions: {
      ref_name: {
        include: input.include ?? ['~DEFAULT_BRANCH'],
        exclude: input.exclude ?? []
      }
    },
    rules: [
      { type: 'update', parameters: input.parameters ?? updateParameters() },
      ...(input.extraRule === undefined ? [] : [input.extraRule])
    ]
  };
  if (!(input.omitBypassActors ?? false)) {
    result.bypass_actors = input.bypassActors ?? [{
      actor_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id,
      actor_type: 'Integration',
      bypass_mode: 'pull_request'
    }];
  }
  return result;
}

function defaultEffectiveRules() {
  return [...effectiveAuthorityRules(), effectivePrincipalRule()];
}

function defaultDetailedRulesets() {
  return [detailedAuthorityRuleset(), detailedPrincipalRuleset()];
}

function receipt(input: Partial<{
  effectiveRules: unknown;
  detailedRulesets: unknown;
}> = {}) {
  return createMainAuthorityRulesetReceipt({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    effectiveRules: input.effectiveRules ?? defaultEffectiveRules(),
    detailedRulesets: input.detailedRulesets ?? defaultDetailedRulesets()
  });
}

test('main authority requires distinct authority and pull-request-only principal layers', () => {
  const value = receipt();
  expect(value.status).toBe('enforced');
  expect(value.authorityRulesetIds).toEqual([AUTHORITY_RULESET_ID]);
  expect(value.principalRulesetIds).toEqual([PRINCIPAL_RULESET_ID]);
  expect(value.terminalStatusContext).toBe('sec/integration-authorization');
  expect(value.terminalStatusIntegrationId).toBe(CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id);
  expect(value.rulesetDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('empty or non-active authority observations fail closed', () => {
  expect(() => receipt({ detailedRulesets: [] })).toThrow('no detailed rulesets');
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset({ enforcement: 'evaluate' }),
    detailedPrincipalRuleset()
  ] })).toThrow('exactly one no-bypass authority ruleset');
});

test('both layers must target the default branch without exclusions', () => {
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset({ include: ['refs/heads/dev'] }),
    detailedPrincipalRuleset()
  ] })).toThrow('exactly one no-bypass authority ruleset');
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset(),
    detailedPrincipalRuleset({ exclude: ['refs/heads/main'] })
  ] })).toThrow('must not exclude refs');
});

test('authority bypass visibility is mandatory and authority bypass is forbidden', () => {
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset({ omitBypassActors: true }),
    detailedPrincipalRuleset()
  ] })).toThrow('no observable bypass_actors');
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset({
      bypassActors: [{ actor_id: 1, actor_type: 'RepositoryRole', bypass_mode: 'always' }]
    }),
    detailedPrincipalRuleset()
  ] })).toThrow('exactly one no-bypass authority ruleset');
});

test('PR deletion force-push and terminal status rules are all required in authority layer', () => {
  for (const patch of [
    { includePullRequest: false },
    { includeDeletion: false },
    { includeNonFastForward: false }
  ]) {
    expect(() => receipt({ detailedRulesets: [
      detailedAuthorityRuleset(patch),
      detailedPrincipalRuleset()
    ] })).toThrow('exactly one no-bypass authority ruleset');
  }
  expect(() => receipt({
    effectiveRules: [
      ...effectiveAuthorityRules({ includeDeletion: false }),
      effectivePrincipalRule()
    ]
  })).toThrow('exactly one no-bypass authority ruleset');
});

test('terminal check is exact strict and pinned to the expected GitHub Actions App', () => {
  for (const parameters of [
    requiredStatusParameters({ context: 'sec/action/not-authority' }),
    requiredStatusParameters({ integrationId: 1 }),
    requiredStatusParameters({ strict: false })
  ]) {
    expect(() => receipt({
      effectiveRules: [
        ...effectiveAuthorityRules({ statusParameters: parameters }),
        effectivePrincipalRule()
      ],
      detailedRulesets: [
        detailedAuthorityRuleset({ statusParameters: parameters }),
        detailedPrincipalRuleset()
      ]
    })).toThrow('exactly one no-bypass authority ruleset');
  }
});

test('authority layer may not also own the update-principal restriction', () => {
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset({ includeUpdate: true }),
    detailedPrincipalRuleset()
  ] })).toThrow('must not own update-principal restriction');
});

test('principal layer requires exactly one GitHub Actions Integration pull-request bypass', () => {
  const wrongActors: readonly unknown[][] = [
    [],
    [{ actor_id: 1, actor_type: 'Integration', bypass_mode: 'pull_request' }],
    [{
      actor_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id,
      actor_type: 'Integration',
      bypass_mode: 'always'
    }],
    [{
      actor_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id,
      actor_type: 'RepositoryRole',
      bypass_mode: 'pull_request'
    }]
  ];
  for (const bypassActors of wrongActors) {
    expect(() => receipt({ detailedRulesets: [
      detailedAuthorityRuleset(),
      detailedPrincipalRuleset({ bypassActors })
    ] })).toThrow('exactly one pull-request-only integration principal ruleset');
  }
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset(),
    detailedPrincipalRuleset({ omitBypassActors: true })
  ] })).toThrow('no observable bypass_actors');
});

test('principal update rule is exact and does not allow fetch-and-merge escape semantics', () => {
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset(),
    detailedPrincipalRuleset({ parameters: updateParameters({ allowsFetchAndMerge: true }) })
  ] })).toThrow('exactly one pull-request-only integration principal ruleset');
  expect(() => receipt({ detailedRulesets: [
    detailedAuthorityRuleset(),
    detailedPrincipalRuleset({ extraRule: { type: 'deletion' } })
  ] })).toThrow('exactly one pull-request-only integration principal ruleset');
});

test('ambiguous duplicate authority or principal layers fail closed', () => {
  const secondAuthorityId = 44;
  expect(() => receipt({
    effectiveRules: [
      ...defaultEffectiveRules(),
      ...effectiveAuthorityRules({ id: secondAuthorityId })
    ],
    detailedRulesets: [
      ...defaultDetailedRulesets(),
      detailedAuthorityRuleset({ id: secondAuthorityId })
    ]
  })).toThrow('observed 2');

  const secondPrincipalId = 45;
  expect(() => receipt({
    effectiveRules: [
      ...defaultEffectiveRules(),
      effectivePrincipalRule({ id: secondPrincipalId })
    ],
    detailedRulesets: [
      ...defaultDetailedRulesets(),
      detailedPrincipalRuleset({ id: secondPrincipalId })
    ]
  })).toThrow('observed 2');
});
