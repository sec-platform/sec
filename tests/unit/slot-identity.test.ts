import { expect, test } from 'bun:test';

import { validatePlan } from '../../platform/compiler/parse/load-plan.ts';
import { normalizeAndValidateSemanticManifestFields } from '../../platform/compiler/parse/validate-semantic-manifest.ts';
import { SUPPORTED_STACK } from '../../platform/shared/constants.ts';
import type { BlockManifest, PlanFile } from '../../platform/shared/plan-manifest-types.ts';
import { isCanonicalSlotId } from '../../platform/shared/slot-identity.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

function basePlan(slotId: string): PlanFile {
  return {
    app: {
      id: 'app',
      name: 'App',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: { sources: [] },
    blocks: [{ id: 'entity/customer-basic', version: '0.1.0' }],
    slots: [{
      id: slotId,
      block: 'entity/customer-basic',
      kind: 'adapter',
      target: 'custom/customer_normalizer.ts',
      sourcePath: 'source/code/slots/customer_normalizer.ts',
      symbol: 'normalizeCustomerInput',
      description: 'normalize'
    }],
    acceptance: []
  };
}

function baseManifest(slotIds: readonly string[]): BlockManifest {
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
    slots: slotIds.map((id) => ({
      id,
      kind: 'adapter',
      target: 'custom/customer_normalizer.ts',
      symbol: 'normalizeCustomerInput',
      writableZones: ['custom/']
    })),
    acceptance: [],
    routes: [],
    contracts: [],
    generators: []
  };
}

test('canonical Slot ids are bounded lowercase logical components suitable for default source projection', () => {
  for (const value of [
    'a',
    'customer_normalizer',
    'ticket-comment-delegate',
    'slot2'
  ]) {
    expect(isCanonicalSlotId(value)).toBe(true);
  }

  for (const value of [
    '',
    '_customer',
    'customer_',
    '-customer',
    'customer-',
    'Customer_normalizer',
    'customer.normalizer',
    'customer/normalizer',
    'customer\\normalizer',
    '客户',
    'con',
    'nul',
    'com1',
    'lpt9',
    'a'.repeat(129)
  ]) {
    expect(isCanonicalSlotId(value)).toBe(false);
  }
});

test('Plan rejects a non-canonical Slot id before it can enter Lock identity', () => {
  for (const slotId of ['Customer', 'con', 'slot/name', 'slot.name']) {
    expect(() => validatePlan(basePlan(slotId)))
      .toThrow('canonical lowercase logical identity');
  }
  expect(() => validatePlan(basePlan('customer_normalizer'))).not.toThrow();
});

test('Manifest Slot ids share the canonical identity and uniqueness contract', () => {
  const canonical = baseManifest(['customer_normalizer', 'ticket_comment_delegate']);
  expect(() => normalizeAndValidateSemanticManifestFields(canonical)).not.toThrow();

  expect(() => normalizeAndValidateSemanticManifestFields(baseManifest(['Customer'])))
    .toThrow('non-canonical Slot id');
  expect(() => normalizeAndValidateSemanticManifestFields(baseManifest(['con'])))
    .toThrow('non-canonical Slot id');
  expect(() => normalizeAndValidateSemanticManifestFields(baseManifest(['customer_normalizer', 'customer_normalizer'])))
    .toThrow('repeats Slot id');
});
