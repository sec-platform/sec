import { expect, test } from 'bun:test';

import type { PlanFile } from '../../src/compiler/contract.ts';
import { SUPPORTED_STACK } from '../../src/compiler/contract.ts';
import { loadManifestById, resolveRegistrySources } from '../../src/compiler/parse/load-manifest.ts';
import { normalizePlan, validatePlan } from '../../src/compiler/parse/load-plan.ts';
import { isCanonicalBlockId, isCanonicalRegistryVersion } from '../../src/semantics/identity/block.ts';

test('canonical block identity is cross-platform path-safe and injective', () => {
  for (const value of [
    'ticket/basic',
    'auth/basic-session',
    'agent/executor',
    'namespace/deep_block-v2'
  ]) {
    expect(isCanonicalBlockId(value)).toBe(true);
  }

  for (const value of [
    '',
    'single',
    '../escape',
    '..\\escape/block',
    'ticket/../escape',
    'Ticket/basic',
    'ticket/Basic',
    'ticket/basic.v2',
    'ticket//basic',
    'con/basic',
    'namespace/con'
  ]) {
    expect(isCanonicalBlockId(value)).toBe(false);
  }
});

test('canonical registry version is one exact lowercase SemVer path segment', () => {
  for (const value of ['0.1.0', '1.2.3', '1.2.3-rc.1', '1.2.3+build.7', '1.2.3-alpha.0+build.01']) {
    expect(isCanonicalRegistryVersion(value)).toBe(true);
  }
  for (const value of [
    '',
    '../1.0.0',
    '1.0',
    '01.0.0',
    '1.0.0/next',
    '1.0.0-RC1',
    '1.0.0-01',
    '1.0.0-alpha..1',
    '1.0.0+'
  ]) {
    expect(isCanonicalRegistryVersion(value)).toBe(false);
  }
});

test('manifest loader rejects unsafe locator bytes before registry filesystem resolution', async () => {
  expect(() => loadManifestById('..\\escape/block', { workspaceRoot: '/path/that/need/not/exist' }))
    .toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-015' }));
  expect(() => loadManifestById('ticket/basic', {
    workspaceRoot: '/path/that/need/not/exist',
    version: '../1.0.0'
  })).toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-015' }));
});

test('direct registry source callers cannot bypass Plan enum and path validation', () => {
  expect(() => resolveRegistrySources('/tmp/workspace', [{
    id: 'bad',
    kind: 'private',
    location: 'compiler',
    path: 'src/compiler/registry/private'
  }])).toThrow();

  expect(() => resolveRegistrySources('/tmp/workspace', [{
    id: 'bad',
    kind: 'private',
    location: 'workspace',
    path: '../escape'
  }])).toThrow();
});

test('Plan raw-shape normalization fails closed before array/property operations', () => {
  expect(() => normalizePlan({
    registry: { sources: { id: 'not-an-array' } }
  } as unknown as PlanFile)).toThrow();
  expect(() => normalizePlan({
    registry: { sources: [null] }
  } as unknown as PlanFile)).toThrow();
  expect(() => normalizePlan({
    blocks: { id: 'ticket/basic' }
  } as unknown as PlanFile)).toThrow();
});

test('Plan runtime validation rejects values TypeScript unions cannot protect after YAML parsing', () => {
  const base = {
    app: {
      id: 'app',
      name: 'App',
      stack: SUPPORTED_STACK,
      packageManager: 'npm',
      mode: 'single-tenant'
    },
    registry: { sources: [] },
    blocks: [{ id: 'ticket/basic', version: '1.0.0' }],
    acceptance: []
  } satisfies PlanFile;

  expect(() => validatePlan({
    ...base,
    app: { ...base.app, packageManager: 'unknown' }
  } as unknown as PlanFile)).toThrow();
  expect(() => validatePlan({
    ...base,
    blocks: [{ id: '..\\escape/block' }]
  } as unknown as PlanFile)).toThrow();
  expect(() => validatePlan({
    ...base,
    blocks: [{ id: 'ticket/basic', version: '../1.0.0' }]
  } as unknown as PlanFile)).toThrow();
});
