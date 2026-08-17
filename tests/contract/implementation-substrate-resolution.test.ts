import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  parseDevelopmentSubstrateResolutionV1,
  validateRepositoryDevelopmentSubstrateResolutionV1
} from '../../docs/scripts/implementation-substrate-resolution.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const REGISTRY_PATH = path.join(
  REPOSITORY_ROOT,
  'docs/governance/implementation-substrate-resolution.yaml'
);
const PACKAGE_JSON_PATH = path.join(REPOSITORY_ROOT, 'package.json');

type Fixture = {
  decisions: Array<Record<string, unknown>>;
};

async function sources(): Promise<{ registry: string; packageJson: string }> {
  const [registry, packageJson] = await Promise.all([
    readFile(REGISTRY_PATH, 'utf8'),
    readFile(PACKAGE_JSON_PATH, 'utf8')
  ]);
  return { registry, packageJson };
}

function fixture(source: string): Fixture {
  return structuredClone(parseYaml(source)) as Fixture;
}

function decisionById(value: Fixture, capabilityId: string): Record<string, unknown> {
  const decision = value.decisions.find((entry) => entry.capabilityId === capabilityId);
  if (!decision) throw new Error(`fixture decision ${capabilityId} is missing`);
  return decision;
}

function substrate(decision: Record<string, unknown>): Record<string, unknown> {
  return decision.substrate as Record<string, unknown>;
}

test('repository implementation substrate registry is machine-valid', async () => {
  const result = await validateRepositoryDevelopmentSubstrateResolutionV1(REPOSITORY_ROOT);
  expect(result.schema).toBe('sec-development-substrate-resolution-v1');
  expect(result.status).toBe('candidate');
  expect(result.decisions.length).toBeGreaterThan(40);
});

test('duplicate capability ids are rejected', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  value.decisions.push(structuredClone(value.decisions[0]!));
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/capabilityId values must be unique/u);
});

test('unadopted candidate cannot gain a manual fallback', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  decisionById(value, 'structured-json-patch').manualFallback = 'semantic-only';
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/non-sec-owned capability must forbid manual fallback/u);
});

test('candidate substrate cannot be projected as adopted', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  decisionById(value, 'property-based-generation').decision = 'adopted';
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/candidate substrate cannot be projected as adopted/u);
});

test('adopted package binding must match package.json exactly', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  substrate(decisionById(value, 'yaml-parsing')).declaredSpec = '999.0.0';
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/must match package\.json/u);
});

test('adopted package cannot name a dependency absent from package.json', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  substrate(decisionById(value, 'yaml-parsing')).id = 'sec-homegrown-yaml-parser';
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/must match package\.json/u);
});

test('sec-owned semantics cannot hide an unadopted mechanical candidate', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  const decision = decisionById(value, 'workspace-writer-lease');
  substrate(decision).kind = 'candidate';
  substrate(decision).id = 'homegrown-lock-wrapper';
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/cannot hide an unadopted mechanical candidate/u);
});

test('performance-driven substrate cannot bypass Performance Truth', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  decisionById(value, 'persistent-content-addressed-byte-store').triggerRef = 'github:issue/179';
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/must remain gated by Performance Truth #316/u);
});

test('conditional provider must preserve an explicit capability trigger', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  decisionById(value, 'artifact-build-provenance').triggerRef = null;
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/conditional substrate must bind its availability trigger/u);
});

test('supply-chain capability cannot acquire a hand-written fallback', async () => {
  const { registry, packageJson } = await sources();
  const value = fixture(registry);
  decisionById(value, 'portable-artifact-signing-fallback').manualFallback = 'semantic-only';
  expect(() => parseDevelopmentSubstrateResolutionV1(stringifyYaml(value), packageJson))
    .toThrow(/non-sec-owned capability must forbid manual fallback/u);
});
