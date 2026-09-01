import path from 'node:path';

import { ANONYMOUS_PACKAGE_REGISTRY_PROFILE } from '../../../external-capabilities/package-registry/contract/anonymous-registry.ts';
import { queryAnonymousPackageRegistryLatestVersions } from '../../../external-capabilities/package-registry/runtime/anonymous-registry.ts';
import { readOptionalRetainedOrdinaryFile } from '../../../runtime-state/physical/runtime/retained-file-read.ts';
import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { parseExactJsonBytes } from '../../../system-architecture/foundation/runtime/exact-json.ts';
import { compilerRoot } from '../../../workspace/runtime/paths.ts';
import type { DependencyCapabilityPackageManifest } from '../contract/dependency-capability-contract.ts';
import type {
  DependencyFreshnessDecision,
  DependencyFreshnessLockObservation,
  DependencyRegistryObservation
} from '../contract/dependency-freshness.ts';
import {
  assertCompilerDependencyExecutionRetirementReceipt,
  observeCompilerDependencyExecutionGenerationAuthority,
  retainCompilerDependencyExecutionGeneration
} from '../runtime.ts';
import {
  assessDependencyFreshness,
  projectDependencyFreshnessManifest
} from '../runtime/dependency-freshness.ts';

type DependencyFreshnessRootManifest = DependencyCapabilityPackageManifest & Readonly<{
  readonly packageManager: string;
}>;

export interface DependencyFreshnessQueryOptions {
  readonly deadlineAtUnixMs?: number;
  readonly signal?: AbortSignal;
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Dependency freshness ${label} is not an object`);
  }
  const entries = Object.entries(value);
  if (entries.some(([name, reference]) => name.length === 0 || typeof reference !== 'string')) {
    throw new Error(`Dependency freshness ${label} contains a non-string dependency reference`);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function parseDependencyFreshnessRootManifest(bytes: Uint8Array): DependencyFreshnessRootManifest {
  const value = parseExactJsonBytes(bytes, 'Dependency freshness root package manifest', {
    maximumInputBytes: 1_048_576,
    maximumDepth: 16
  });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Dependency freshness root package manifest is not an object');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.packageManager !== 'string') {
    throw new Error('Dependency freshness root package manifest has no exact packageManager');
  }
  const trustedDependencies = candidate.trustedDependencies;
  if (trustedDependencies !== undefined && (!Array.isArray(trustedDependencies)
      || trustedDependencies.some((entry) => typeof entry !== 'string'))) {
    throw new Error('Dependency freshness trustedDependencies is not a string array');
  }
  return Object.freeze({
    dependencies: stringRecord(candidate.dependencies, 'dependencies'),
    devDependencies: stringRecord(candidate.devDependencies, 'devDependencies'),
    packageManager: candidate.packageManager,
    ...(trustedDependencies === undefined
      ? {}
      : { trustedDependencies: Object.freeze([...trustedDependencies]) as readonly string[] })
  });
}

export interface DependencyFreshnessOwnerFacts {
  readonly bunRuntimeVersion: string;
  readonly lock: DependencyFreshnessLockObservation | null;
  readonly registry: readonly DependencyRegistryObservation[];
  readonly rootManifest: DependencyFreshnessRootManifest;
}

export function compileDependencyFreshnessFromOwnerFacts(
  facts: DependencyFreshnessOwnerFacts
): DependencyFreshnessDecision {
  const manifest = projectDependencyFreshnessManifest(
    facts.rootManifest,
    sha256({ dependencyManifest: facts.rootManifest }) as `sha256:${string}`
  );
  const lock = facts.lock ?? Object.freeze({
    entries: Object.freeze([]),
    lockDigest: sha256({ materialization: 'absent' }) as `sha256:${string}`
  });
  return assessDependencyFreshness({
    bunRuntimeVersion: facts.bunRuntimeVersion,
    lock,
    manifest,
    registry: facts.registry
  });
}

export async function getDependencyFreshness(
  options: DependencyFreshnessQueryOptions = {}
): Promise<DependencyFreshnessDecision> {
  const rootManifestBytes = readOptionalRetainedOrdinaryFile(
    path.join(compilerRoot, 'package.json'),
    'Dependency freshness root package manifest'
  );
  if (rootManifestBytes === null) throw new Error('Dependency freshness root package manifest is missing');
  const rootManifest = parseDependencyFreshnessRootManifest(rootManifestBytes);
  const operationDeadlineAtUnixMs = Math.min(
    options.deadlineAtUnixMs ?? Number.MAX_SAFE_INTEGER,
    Date.now() + ANONYMOUS_PACKAGE_REGISTRY_PROFILE.timeoutMs
  );
  const authority = await observeCompilerDependencyExecutionGenerationAuthority({
    deadlineAtUnixMs: operationDeadlineAtUnixMs,
    signal: options.signal
  });
  if (authority === null) {
    return compileDependencyFreshnessFromOwnerFacts({
      bunRuntimeVersion: Bun.version,
      lock: null,
      registry: Object.freeze([]),
      rootManifest
    });
  }
  const retained = await retainCompilerDependencyExecutionGeneration(authority, {
    deadlineAtUnixMs: operationDeadlineAtUnixMs,
    signal: options.signal
  });
  let decision: DependencyFreshnessDecision | undefined;
  let operationFailure: unknown;
  try {
    const packageNames = [...new Set(
      retained.directRootResolution.entries.map((entry) => entry.packageName)
    )];
    const registry = packageNames.length === 0
      ? []
      : await queryAnonymousPackageRegistryLatestVersions(packageNames, {
        deadlineAtUnixMs: operationDeadlineAtUnixMs,
        signal: options.signal
      });
    retained.physicalGeneration.assertCurrent();
    await retained.physicalGeneration.assertAuthorityCurrent();
    const finalRootManifestBytes = readOptionalRetainedOrdinaryFile(
      path.join(compilerRoot, 'package.json'),
      'Dependency freshness root package manifest readback'
    );
    if (finalRootManifestBytes === null) {
      throw new Error('Dependency freshness root package manifest disappeared during observation');
    }
    const finalRootManifest = parseDependencyFreshnessRootManifest(finalRootManifestBytes);
    if (sha256({ dependencyManifest: finalRootManifest }) !==
        sha256({ dependencyManifest: rootManifest })) {
      throw new Error('Dependency freshness root package manifest changed during observation');
    }
    decision = compileDependencyFreshnessFromOwnerFacts({
      bunRuntimeVersion: Bun.version,
      lock: retained.directRootResolution,
      registry,
      rootManifest
    });
  } catch (error) {
    operationFailure = error;
  }
  let retirementFailure: unknown;
  try {
    const receipt = await retained.retire();
    assertCompilerDependencyExecutionRetirementReceipt(receipt);
  } catch (error) {
    retirementFailure = error;
  }
  if (operationFailure !== undefined && retirementFailure !== undefined) {
    throw new AggregateError(
      [operationFailure, retirementFailure],
      'Dependency freshness observation and retained generation retirement both failed'
    );
  }
  if (operationFailure !== undefined) throw operationFailure;
  if (retirementFailure !== undefined) throw retirementFailure;
  return decision!;
}

export function formatDependencyFreshnessDecision(
  decision: DependencyFreshnessDecision
): string {
  const lines = [
    'Dependency freshness',
    `Status: ${decision.status}`,
    ...decision.packages.map((entry) => (
      `${entry.declaredName}: ${entry.status} (${entry.reason})`
    ))
  ];
  return `${lines.join('\n')}\n`;
}
