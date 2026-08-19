import { expect, test } from 'bun:test';

import { CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1 } from '../../platform/shared/ci-verification-revision.ts';
import {
  MainAuthorityRulesetGhTransportV1,
  observeMainAuthorityRulesetV1,
  type MainAuthorityRulesetGitHubTransportV1
} from '../../scripts/codex/main-authority-ruleset-github.ts';

const AUTHORITY_RULESET_ID = 42;
const PRINCIPAL_RULESET_ID = 43;

function statusParameters() {
  return {
    required_status_checks: [{
      context: 'sec/integration-authorization',
      integration_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.id
    }],
    strict_required_status_checks_policy: true
  };
}

function authorityDetail(input: Partial<{ bypassActors: unknown; omitBypass: boolean }> = {}) {
  const result: Record<string, unknown> = {
    id: AUTHORITY_RULESET_ID,
    name: 'SEC main authority',
    target: 'branch',
    source_type: 'Repository',
    source: 'sec-platform/sec',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      { type: 'pull_request' },
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_status_checks', parameters: statusParameters() }
    ]
  };
  if (!(input.omitBypass ?? false)) result.bypass_actors = input.bypassActors ?? [];
  return result;
}

function principalDetail() {
  return {
    id: PRINCIPAL_RULESET_ID,
    name: 'SEC integration principal',
    target: 'branch',
    source_type: 'Repository',
    source: 'sec-platform/sec',
    enforcement: 'active',
    bypass_actors: [{
      actor_id: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.id,
      actor_type: 'Integration',
      bypass_mode: 'pull_request'
    }],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [{ type: 'update', parameters: { update_allows_fetch_and_merge: false } }]
  };
}

function defaultEffective() {
  return [
    { type: 'pull_request', ruleset_id: AUTHORITY_RULESET_ID },
    { type: 'deletion', ruleset_id: AUTHORITY_RULESET_ID },
    { type: 'non_fast_forward', ruleset_id: AUTHORITY_RULESET_ID },
    { type: 'required_status_checks', ruleset_id: AUTHORITY_RULESET_ID, parameters: statusParameters() },
    { type: 'update', ruleset_id: PRINCIPAL_RULESET_ID, parameters: { update_allows_fetch_and_merge: false } }
  ];
}

function transport(input: Partial<{
  effective: unknown;
  authority: unknown;
  principal: unknown;
}> = {}): MainAuthorityRulesetGitHubTransportV1 {
  return {
    effectiveBranchRules(repository, branch) {
      expect(repository).toBe('sec-platform/sec');
      expect(branch).toBe('main');
      return input.effective ?? defaultEffective();
    },
    detailedRuleset(repository, rulesetId) {
      expect(repository).toBe('sec-platform/sec');
      if (rulesetId === AUTHORITY_RULESET_ID) return input.authority ?? authorityDetail();
      if (rulesetId === PRINCIPAL_RULESET_ID) return input.principal ?? principalDetail();
      throw new Error(`unexpected ruleset ${rulesetId}`);
    }
  };
}

test('GitHub observer resolves every effective ruleset id and emits layered semantic receipt', () => {
  const value = observeMainAuthorityRulesetV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    transport: transport()
  });
  expect(value.status).toBe('enforced');
  expect(value.authorityRulesetIds).toEqual([AUTHORITY_RULESET_ID]);
  expect(value.principalRulesetIds).toEqual([PRINCIPAL_RULESET_ID]);
});

test('GitHub transport paginates and flattens every effective branch-rule page', () => {
  const calls: string[][] = [];
  const github = new MainAuthorityRulesetGhTransportV1((args) => {
    calls.push([...args]);
    return [
      [{ type: 'pull_request', ruleset_id: AUTHORITY_RULESET_ID }],
      [{ type: 'update', ruleset_id: PRINCIPAL_RULESET_ID }]
    ];
  });
  expect(github.effectiveBranchRules('sec-platform/sec', 'main')).toEqual([
    { type: 'pull_request', ruleset_id: AUTHORITY_RULESET_ID },
    { type: 'update', ruleset_id: PRINCIPAL_RULESET_ID }
  ]);
  expect(calls).toEqual([[
    'api', '--method', 'GET',
    '/repos/sec-platform/sec/rules/branches/main?per_page=100',
    '--paginate', '--slurp'
  ]]);
});

test('GitHub transport rejects a presentation-shaped response instead of treating one page as complete', () => {
  const github = new MainAuthorityRulesetGhTransportV1(() => defaultEffective());
  expect(() => github.effectiveBranchRules('sec-platform/sec', 'main'))
    .toThrow('pagination is not a complete page array');
});

test('GitHub observer fails closed before detail lookup when main has no effective rules', () => {
  let detailReads = 0;
  const empty: MainAuthorityRulesetGitHubTransportV1 = {
    effectiveBranchRules: () => [],
    detailedRuleset: () => {
      detailReads += 1;
      return {};
    }
  };
  expect(() => observeMainAuthorityRulesetV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    transport: empty
  })).toThrow('main has no effective ruleset-backed rules');
  expect(detailReads).toBe(0);
});

test('GitHub observer rejects malformed effective rule identity', () => {
  expect(() => observeMainAuthorityRulesetV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    transport: transport({ effective: [{ type: 'pull_request' }] })
  })).toThrow('has no exact ruleset id');
});

test('GitHub observer never treats missing authority bypass visibility as safe', () => {
  expect(() => observeMainAuthorityRulesetV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    transport: transport({ authority: authorityDetail({ omitBypass: true }) })
  })).toThrow('no observable bypass_actors');
});

test('GitHub observer never treats a broad authority bypass as safe', () => {
  expect(() => observeMainAuthorityRulesetV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    transport: transport({ authority: authorityDetail({
      bypassActors: [{ actor_id: 1, actor_type: 'RepositoryRole', bypass_mode: 'always' }]
    }) })
  })).toThrow('exactly one no-bypass authority ruleset');
});
