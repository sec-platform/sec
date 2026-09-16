import { expect, test } from 'bun:test';

import type { BlockManifest, PlanFile } from '../../src/compiler/contract.ts';
import { SUPPORTED_STACK } from '../../src/compiler/contract.ts';
import { validatePlan } from '../../src/compiler/parse/load-plan.ts';
import { normalizeAndValidateSemanticManifestFields } from '../../src/compiler/parse/validate-semantic-manifest.ts';
import { isCanonicalAcceptanceId } from '../../src/semantic/acceptance/contract/identity.ts';

function basePlan(acceptanceIds: readonly string[]): PlanFile {
  return {
    app: {
      id: 'app',
      name: 'App',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: { sources: [] },
    blocks: [],
    acceptance: acceptanceIds.map((id) => ({ id }))
  };
}

function baseManifest(): BlockManifest {
  return {
    id: 'entity/customer-basic',
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: [SUPPORTED_STACK],
    requires: [],
    provides: [],
    conflicts: [],
    installs: [{ kind: 'template', from: 'source.ts', to: 'source.ts' }],
    pins: { inputs: [], outputs: [] },
    acceptance: [],
    contracts: [],
    generators: []
  };
}

test('Acceptance identity is one bounded lowercase logical token', () => {
  for (const value of [
    'user_can_login',
    'ticket-status-can-transition',
    'a',
    'acceptance2'
  ]) {
    expect(isCanonicalAcceptanceId(value)).toBe(true);
  }
  for (const value of [
    '',
    'User_can_login',
    '_user_can_login',
    'user_can_login_',
    'user.can.login',
    'user/can/login',
    '用户可登录',
    'a'.repeat(129)
  ]) {
    expect(isCanonicalAcceptanceId(value)).toBe(false);
  }
});

test('Plan acceptance projection rejects non-canonical and duplicate proof subjects', () => {
  expect(() => validatePlan(basePlan(['user_can_login']))).not.toThrow();
  expect(() => validatePlan(basePlan(['User_can_login'])))
    .toThrow('canonical lowercase logical identity');
  expect(() => validatePlan(basePlan(['user_can_login', 'user_can_login'])))
    .toThrow('Duplicate Acceptance id');
});

test('Manifest acceptance definitions bind canonical dependency and coverage identities', () => {
  const manifest = baseManifest();
  manifest.acceptance = [{
    id: 'user_can_create_customer',
    dependsOn: ['user_can_login'],
    covers: {
      blocks: ['entity/customer-basic']
    }
  }];
  expect(() => normalizeAndValidateSemanticManifestFields(manifest)).not.toThrow();

  const invalidDependency = baseManifest();
  invalidDependency.acceptance = [{ id: 'user_can_create_customer', dependsOn: ['User_can_login'] }];
  expect(() => normalizeAndValidateSemanticManifestFields(invalidDependency))
    .toThrow('non-canonical dependency identity');

  const duplicate = baseManifest();
  duplicate.acceptance = [
    { id: 'user_can_create_customer' },
    { id: 'user_can_create_customer' }
  ];
  expect(() => normalizeAndValidateSemanticManifestFields(duplicate))
    .toThrow('repeats Acceptance id');
});
