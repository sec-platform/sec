#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  validateRepositoryDevelopmentSubstrateResolutionV1,
  type DevelopmentSubstrateDecisionV1
} from './implementation-substrate-resolution.ts';

const BASELINE_DIRECT_PACKAGES = new Set([
  '@playwright/test',
  '@types/bun',
  '@types/ejs',
  '@types/lodash-es',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  '@types/semver',
  'change-case',
  'commander',
  'diff',
  'ejs',
  'gitnexus',
  'globby',
  'lodash-es',
  'next',
  'ora',
  'p-limit',
  'picocolors',
  'pino',
  'prettier',
  'react',
  'react-dom',
  'semver',
  'ts-morph',
  'typescript',
  'yaml',
  'zod'
]);

const LEGACY_UPGRADE_REGEX_PATH = 'platform/upgrade/upgrade-workspace.ts';
const SYFT_SBOM_PROVIDER_PATH = 'platform/release/providers/syft-sbom-provider.ts';
const MANUAL_SIGNING_PATTERN = /\b(?:createSign|generateKeyPair|generateKeyPairSync|createPrivateKey|privateEncrypt|crypto\.sign)\s*\(/gu;
const MANUAL_SBOM_PATTERN = /(?:["']spdxVersion["']\s*:|\bspdxVersion\s*:|["']bomFormat["']\s*:|\bbomFormat\s*:)/gu;

export interface DevelopmentSubstrateBypassIssueV1 {
  readonly code:
    | 'unresolved-direct-dependency'
    | 'upgrade-regex-bypass-expanded'
    | 'manual-release-signing'
    | 'manual-sbom-generation';
  readonly path: string;
  readonly message: string;
}

function directDependencies(packageJsonSource: string): Set<string> {
  const parsed = JSON.parse(packageJsonSource) as Record<string, unknown>;
  const result = new Set<string>();
  for (const section of ['dependencies', 'devDependencies']) {
    const value = parsed[section];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    for (const packageName of Object.keys(value)) result.add(packageName);
  }
  return result;
}

function adoptedPackageIds(decisions: readonly DevelopmentSubstrateDecisionV1[]): Set<string> {
  return new Set(
    decisions
      .filter((entry) => entry.substrate.kind === 'package'
        && (entry.decision === 'adopted' || entry.decision === 'sec-owned')
        && entry.adoptionOwner === 'github:issue/193')
      .map((entry) => entry.substrate.id)
  );
}

function isCapabilityAdopted(
  decisions: readonly DevelopmentSubstrateDecisionV1[],
  capabilityId: string
): boolean {
  return decisions.some((entry) => entry.capabilityId === capabilityId && entry.decision === 'adopted');
}

function countMatches(source: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(source) !== null) count++;
  pattern.lastIndex = 0;
  return count;
}

export function inspectDevelopmentSubstrateBypassesV1(input: {
  readonly packageJsonSource: string;
  readonly decisions: readonly DevelopmentSubstrateDecisionV1[];
  readonly sources: ReadonlyMap<string, string>;
}): readonly DevelopmentSubstrateBypassIssueV1[] {
  const issues: DevelopmentSubstrateBypassIssueV1[] = [];
  const packageIds = adoptedPackageIds(input.decisions);
  for (const packageName of directDependencies(input.packageJsonSource)) {
    if (!BASELINE_DIRECT_PACKAGES.has(packageName) && !packageIds.has(packageName)) {
      issues.push({
        code: 'unresolved-direct-dependency',
        path: 'package.json',
        message: `direct dependency ${packageName} has no #193-owned adopted implementation substrate decision`
      });
    }
  }

  const syftSbomProviderAdopted = isCapabilityAdopted(input.decisions, 'sbom-generation');
  for (const [repositoryPath, source] of input.sources) {
    if (repositoryPath.startsWith('platform/upgrade/') && repositoryPath.endsWith('.ts')) {
      const count = countMatches(source, /\bnew\s+RegExp\s*\(/gu);
      if (count > 0 && (repositoryPath !== LEGACY_UPGRADE_REGEX_PATH || count > 1)) {
        issues.push({
          code: 'upgrade-regex-bypass-expanded',
          path: repositoryPath,
          message: 'manifest-controlled regex must not expand beyond the single frozen legacy bypass; adopt the resolved RE2 provider or retire regex capability'
        });
      }
    }

    if ((repositoryPath.startsWith('platform/release/') || repositoryPath.startsWith('scripts/'))
        && repositoryPath.endsWith('.ts')) {
      if (countMatches(source, MANUAL_SIGNING_PATTERN) > 0) {
        issues.push({
          code: 'manual-release-signing',
          path: repositoryPath,
          message: 'release signing/attestation must use an adopted provider; handwritten signing crypto is forbidden'
        });
      }
      const sbomFieldsPresent = countMatches(source, MANUAL_SBOM_PATTERN) > 0;
      const adoptedSyftAdapter = repositoryPath === SYFT_SBOM_PROVIDER_PATH && syftSbomProviderAdopted;
      if (sbomFieldsPresent && !adoptedSyftAdapter) {
        issues.push({
          code: 'manual-sbom-generation',
          path: repositoryPath,
          message: 'SBOM fields cannot be authored before the Syft substrate is formally adopted; after adoption only the exact Syft adapter may validate/provider-project them'
        });
      }
    }
  }

  return issues.sort((left, right) =>
    left.code.localeCompare(right.code)
    || left.path.localeCompare(right.path)
    || left.message.localeCompare(right.message));
}

async function walkTypeScriptFiles(root: string, repositoryRoot: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const repositoryPath = path.relative(repositoryRoot, absolute).replaceAll(path.sep, '/');
        sources.set(repositoryPath, await fs.readFile(absolute, 'utf8'));
      }
    }
  }
  await visit(root);
  return sources;
}

export async function assertRepositoryDevelopmentSubstrateBypassesV1(repositoryRoot: string): Promise<void> {
  const [resolution, packageJsonSource, upgradeSources, releaseSources, scriptSources] = await Promise.all([
    validateRepositoryDevelopmentSubstrateResolutionV1(repositoryRoot),
    fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    walkTypeScriptFiles(path.join(repositoryRoot, 'platform/upgrade'), repositoryRoot),
    walkTypeScriptFiles(path.join(repositoryRoot, 'platform/release'), repositoryRoot),
    walkTypeScriptFiles(path.join(repositoryRoot, 'scripts'), repositoryRoot)
  ]);
  const sources = new Map([...upgradeSources, ...releaseSources, ...scriptSources]);
  const issues = inspectDevelopmentSubstrateBypassesV1({
    packageJsonSource,
    decisions: resolution.decisions,
    sources
  });
  if (issues.length > 0) {
    throw new Error(
      `Implementation substrate bypass guard failed:\n${issues.map((issue) =>
        `- ${issue.code} ${issue.path}: ${issue.message}`).join('\n')}`
    );
  }
}

if (import.meta.main) {
  const repositoryRoot = path.resolve(import.meta.dir, '../..');
  await assertRepositoryDevelopmentSubstrateBypassesV1(repositoryRoot);
  console.log('implementation-substrate-bypass-guard: clean');
}
