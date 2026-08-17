import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  assertRepositoryDevelopmentSubstrateBypassesV1,
  inspectDevelopmentSubstrateBypassesV1
} from '../../docs/scripts/implementation-substrate-bypass-guard.ts';
import { parseDevelopmentSubstrateResolutionV1 } from '../../docs/scripts/implementation-substrate-resolution.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

async function fixture() {
  const [registrySource, packageJsonSource] = await Promise.all([
    readFile(
      path.join(REPOSITORY_ROOT, 'tooling/sec-dev/governance/implementation-substrate-resolution.yaml'),
      'utf8'
    ),
    readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8')
  ]);
  const resolution = parseDevelopmentSubstrateResolutionV1(registrySource, packageJsonSource);
  return { packageJsonSource, decisions: resolution.decisions };
}

test('repository does not expand frozen implementation substrate bypasses', async () => {
  await expect(assertRepositoryDevelopmentSubstrateBypassesV1(REPOSITORY_ROOT)).resolves.toBeUndefined();
});

test('new direct dependency without adopted substrate decision is rejected', async () => {
  const value = await fixture();
  const packageJson = JSON.parse(value.packageJsonSource) as Record<string, Record<string, string>>;
  packageJson.dependencies!['new-homegrown-helper'] = '1.0.0';
  const issues = inspectDevelopmentSubstrateBypassesV1({
    packageJsonSource: JSON.stringify(packageJson),
    decisions: value.decisions,
    sources: new Map()
  });
  expect(issues.some((issue) => issue.code === 'unresolved-direct-dependency')).toBe(true);
});

test('new direct dependency cannot self-authorize without #193 ownership', async () => {
  const value = await fixture();
  const packageJson = JSON.parse(value.packageJsonSource) as Record<string, Record<string, string>>;
  packageJson.dependencies!['new-wheel'] = '1.0.0';
  const decisions = [
    ...value.decisions,
    {
      capabilityId: 'new-wheel-capability',
      requirementRefs: ['github:issue/483'],
      layer: 'mechanical' as const,
      decision: 'adopted' as const,
      substrate: {
        kind: 'package',
        id: 'new-wheel',
        manifestSection: 'dependencies',
        declaredSpec: '1.0.0'
      },
      manualFallback: 'forbidden' as const,
      adoptionOwner: null,
      triggerRef: null,
      authorityRetainedBy: 'fixture'
    }
  ];
  const issues = inspectDevelopmentSubstrateBypassesV1({
    packageJsonSource: JSON.stringify(packageJson),
    decisions,
    sources: new Map()
  });
  expect(issues.some((issue) => issue.code === 'unresolved-direct-dependency')).toBe(true);
});

test('a second upgrade RegExp implementation is rejected', async () => {
  const value = await fixture();
  const issues = inspectDevelopmentSubstrateBypassesV1({
    ...value,
    sources: new Map([
      ['platform/upgrade/new-regex-migration.ts', 'export const pattern = new RegExp(input);']
    ])
  });
  expect(issues).toContainEqual(expect.objectContaining({ code: 'upgrade-regex-bypass-expanded' }));
});

test('the single current legacy upgrade RegExp is frozen but not multiplied', async () => {
  const value = await fixture();
  const allowed = inspectDevelopmentSubstrateBypassesV1({
    ...value,
    sources: new Map([
      ['platform/upgrade/upgrade-workspace.ts', 'const pattern = new RegExp(input);']
    ])
  });
  expect(allowed.some((issue) => issue.code === 'upgrade-regex-bypass-expanded')).toBe(false);

  const expanded = inspectDevelopmentSubstrateBypassesV1({
    ...value,
    sources: new Map([
      [
        'platform/upgrade/upgrade-workspace.ts',
        'const first = new RegExp(a); const second = new RegExp(b);'
      ]
    ])
  });
  expect(expanded.some((issue) => issue.code === 'upgrade-regex-bypass-expanded')).toBe(true);
});

test('handwritten release signing crypto is rejected', async () => {
  const value = await fixture();
  const issues = inspectDevelopmentSubstrateBypassesV1({
    ...value,
    sources: new Map([
      ['platform/release/manual-signing.ts', "import { createSign } from 'node:crypto'; createSign('SHA256');"]
    ])
  });
  expect(issues).toContainEqual(expect.objectContaining({ code: 'manual-release-signing' }));
});

test('handwritten SBOM generation is rejected outside the selected provider adapter', async () => {
  const value = await fixture();
  const issues = inspectDevelopmentSubstrateBypassesV1({
    ...value,
    sources: new Map([
      ['platform/release/manual-sbom.ts', "export const sbom = { spdxVersion: 'SPDX-2.3' };"]
    ])
  });
  expect(issues).toContainEqual(expect.objectContaining({ code: 'manual-sbom-generation' }));
});

test('Syft adapter is still blocked while SBOM substrate is only a candidate', async () => {
  const value = await fixture();
  const issues = inspectDevelopmentSubstrateBypassesV1({
    ...value,
    sources: new Map([
      [
        'platform/release/providers/syft-sbom-provider.ts',
        "export function assertSbom(value: { spdxVersion: string }) { return value.spdxVersion; }"
      ]
    ])
  });
  expect(issues).toContainEqual(expect.objectContaining({ code: 'manual-sbom-generation' }));
});

test('exact Syft adapter may validate SBOM fields only after formal adoption', async () => {
  const value = await fixture();
  const decisions = value.decisions.map((entry) =>
    entry.capabilityId === 'sbom-generation' ? { ...entry, decision: 'adopted' as const } : entry);
  const issues = inspectDevelopmentSubstrateBypassesV1({
    packageJsonSource: value.packageJsonSource,
    decisions,
    sources: new Map([
      [
        'platform/release/providers/syft-sbom-provider.ts',
        "export function assertSbom(value: { spdxVersion: string }) { return value.spdxVersion; }"
      ]
    ])
  });
  expect(issues.some((issue) => issue.code === 'manual-sbom-generation')).toBe(false);
});
