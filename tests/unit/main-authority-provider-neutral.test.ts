import { expect, test } from 'bun:test';

import {
  SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1,
  createMainAuthorityRulesetReceiptV1
} from '../../platform/shared/main-authority-ruleset-contract.ts';
import {
  observeMainAuthorityRulesetV1,
  type MainAuthorityRulesetGitHubTransportV1
} from '../../scripts/codex/main-authority-ruleset-github.ts';

const AUTHORITY_RULESET_ID = 142;
const PRINCIPAL_RULESET_ID = 143;
const EXTERNAL_INTEGRATOR_ID = 900001;
const WRONG_INTEGRATOR_ID = 900002;

function statusParameters(integrationId = EXTERNAL_INTEGRATOR_ID) {
  return {
    required_status_checks: [{
      context: SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1,
      integration_id: integrationId
    }],
    strict_required_status_checks_policy: true
  };
}

function effectiveRules(integrationId = EXTERNAL_INTEGRATOR_ID) {
  return [
    { type: 'pull_request', ruleset_id: AUTHORITY_RULESET_ID },
    { type: 'deletion', ruleset_id: AUTHORITY_RULESET_ID },
    { type: 'non_fast_forward', ruleset_id: AUTHORITY_RULESET_ID },
    {
      type: 'required_status_checks',
      ruleset_id: AUTHORITY_RULESET_ID,
      parameters: statusParameters(integrationId)
    },
    {
      type: 'update',
      ruleset_id: PRINCIPAL_RULESET_ID,
      parameters: { update_allows_fetch_and_merge: false }
    }
  ];
}

function authorityRuleset(integrationId = EXTERNAL_INTEGRATOR_ID) {
  return {
    id: AUTHORITY_RULESET_ID,
    name: 'SEC main authority',
    target: 'branch',
    source_type: 'Repository',
    source: 'sec-platform/sec',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      { type: 'pull_request' },
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_status_checks', parameters: statusParameters(integrationId) }
    ]
  };
}

function principalRuleset(integrationId = EXTERNAL_INTEGRATOR_ID) {
  return {
    id: PRINCIPAL_RULESET_ID,
    name: 'SEC integration principal',
    target: 'branch',
    source_type: 'Repository',
    source: 'sec-platform/sec',
    enforcement: 'active',
    bypass_actors: [{
      actor_id: integrationId,
      actor_type: 'Integration',
      bypass_mode: 'pull_request'
    }],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [{ type: 'update', parameters: { update_allows_fetch_and_merge: false } }]
  };
}

function createReceipt(input: Partial<{
  expectedIntegrationId: number;
  statusIntegrationId: number;
  principalIntegrationId: number;
}> = {}) {
  return createMainAuthorityRulesetReceiptV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    expectedIntegrationId: input.expectedIntegrationId ?? EXTERNAL_INTEGRATOR_ID,
    effectiveRules: effectiveRules(input.statusIntegrationId ?? EXTERNAL_INTEGRATOR_ID),
    detailedRulesets: [
      authorityRuleset(input.statusIntegrationId ?? EXTERNAL_INTEGRATOR_ID),
      principalRuleset(input.principalIntegrationId ?? EXTERNAL_INTEGRATOR_ID)
    ]
  });
}

function transport(): MainAuthorityRulesetGitHubTransportV1 {
  return {
    effectiveBranchRules(repository, branch) {
      expect(repository).toBe('sec-platform/sec');
      expect(branch).toBe('main');
      return effectiveRules();
    },
    detailedRuleset(repository, rulesetId) {
      expect(repository).toBe('sec-platform/sec');
      if (rulesetId === AUTHORITY_RULESET_ID) return authorityRuleset();
      if (rulesetId === PRINCIPAL_RULESET_ID) return principalRuleset();
      throw new Error(`unexpected ruleset ${rulesetId}`);
    }
  };
}

test('main authority accepts an explicitly selected non-Actions Integration principal', () => {
  const receipt = createReceipt();
  expect(receipt.status).toBe('enforced');
  expect(receipt.terminalStatusIntegrationId).toBe(EXTERNAL_INTEGRATOR_ID);
  expect(receipt.authorityRulesetIds).toEqual([AUTHORITY_RULESET_ID]);
  expect(receipt.principalRulesetIds).toEqual([PRINCIPAL_RULESET_ID]);
});

test('terminal status and update bypass must both bind the exact selected Integration principal', () => {
  expect(() => createReceipt({ statusIntegrationId: WRONG_INTEGRATOR_ID }))
    .toThrow('exactly one no-bypass authority ruleset');
  expect(() => createReceipt({ principalIntegrationId: WRONG_INTEGRATOR_ID }))
    .toThrow('exactly one pull-request-only integration principal ruleset');
});

test('GitHub ruleset observer passes the explicit provider principal through to the semantic receipt', () => {
  const receipt = observeMainAuthorityRulesetV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    expectedIntegrationId: EXTERNAL_INTEGRATOR_ID,
    transport: transport()
  });
  expect(receipt.terminalStatusIntegrationId).toBe(EXTERNAL_INTEGRATOR_ID);
});

test('provider-neutral observer rejects an invalid Integration principal before accepting enforcement', () => {
  expect(() => observeMainAuthorityRulesetV1({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    expectedIntegrationId: 0,
    transport: transport()
  })).toThrow('integration id must be a positive safe integer');
});
