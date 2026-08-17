#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

const REGISTRY_PATH = 'tooling/sec-dev/governance/implementation-substrate-resolution.yaml';
const DECISIONS = new Set([
  'adopted',
  'selected-candidate',
  'conditional',
  'deferred',
  'sec-owned',
  'unsupported'
]);
const LAYERS = new Set(['mechanical', 'sec-semantic']);
const SUBSTRATE_KINDS = new Set([
  'builtin',
  'package',
  'command',
  'script-tool',
  'candidate',
  'host-api',
  'toolchain',
  'sec-owner',
  'target-provider',
  'external-cli',
  'github-capability',
  'standard',
  'external-service'
]);
const MANIFEST_SECTIONS = new Set(['dependencies', 'devDependencies']);
const PERFORMANCE_GATED_IDS = new Set([
  'faster-noncryptographic-digest',
  'process-wrapper-execa',
  'persistent-content-addressed-byte-store'
]);
const SUPPLY_CHAIN_IDS = new Set([
  'artifact-build-provenance',
  'portable-artifact-signing-fallback',
  'npm-publication-authentication',
  'npm-provenance-from-private-source-repository',
  'sbom-generation',
  'canonical-sbom-format'
]);

export interface DevelopmentSubstrateResolutionV1 {
  readonly schema: 'sec-development-substrate-resolution-v1';
  readonly status: 'candidate' | 'adopted';
  readonly decisions: readonly DevelopmentSubstrateDecisionV1[];
}

export interface DevelopmentSubstrateDecisionV1 {
  readonly capabilityId: string;
  readonly requirementRefs: readonly string[];
  readonly layer: 'mechanical' | 'sec-semantic';
  readonly decision:
    | 'adopted'
    | 'selected-candidate'
    | 'conditional'
    | 'deferred'
    | 'sec-owned'
    | 'unsupported';
  readonly substrate: {
    readonly kind: string;
    readonly id: string;
    readonly manifestSection: string | null;
    readonly declaredSpec: string | number | null;
  };
  readonly manualFallback: 'forbidden' | 'semantic-only';
  readonly adoptionOwner: string | null;
  readonly triggerRef: string | null;
  readonly authorityRetainedBy: string;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys must be exactly: ${wanted.join(', ')}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function machineRef(value: unknown, label: string): string {
  const ref = text(value, label);
  if (!/^(?:github:(?:issue|pr)\/[1-9][0-9]*|github-capability:[a-z0-9][a-z0-9-]*|release-consumer:[a-z0-9][a-z0-9-]*)$/u.test(ref)) {
    throw new Error(`${label} is not a supported machine reference.`);
  }
  return ref;
}

function packageSpec(
  packageJson: Record<string, unknown>,
  section: string,
  packageName: string
): unknown {
  return asRecord(packageJson[section], `package.json.${section}`)[packageName];
}

function validatePackageBinding(
  value: DevelopmentSubstrateDecisionV1,
  packageJson: Record<string, unknown>
): void {
  if (value.substrate.kind !== 'package') {
    if (value.substrate.manifestSection !== null || value.substrate.declaredSpec !== null) {
      throw new Error(`${value.capabilityId} non-package substrate cannot claim package manifest fields.`);
    }
    return;
  }

  if (value.adoptionOwner !== 'github:issue/193') {
    throw new Error(`${value.capabilityId} package substrate must bind the #193 package/lock adoption owner.`);
  }
  const section = value.substrate.manifestSection;
  if (typeof section !== 'string' || !MANIFEST_SECTIONS.has(section)) {
    throw new Error(`${value.capabilityId} package substrate needs a supported manifestSection.`);
  }
  const declaredSpec = String(value.substrate.declaredSpec ?? '');
  if (declaredSpec.length === 0) {
    throw new Error(`${value.capabilityId} package substrate needs declaredSpec.`);
  }
  const actual = packageSpec(packageJson, section, value.substrate.id);
  if (actual !== declaredSpec) {
    throw new Error(
      `${value.capabilityId} package binding ${section}.${value.substrate.id} `
      + `must match package.json (${String(actual)} !== ${declaredSpec}).`
    );
  }
}

function parseDecision(
  raw: unknown,
  index: number,
  packageJson: Record<string, unknown>
): DevelopmentSubstrateDecisionV1 {
  const value = asRecord(raw, `decision[${index}]`);
  exactKeys(value, [
    'capabilityId',
    'requirementRefs',
    'layer',
    'decision',
    'substrate',
    'manualFallback',
    'adoptionOwner',
    'triggerRef',
    'authorityRetainedBy'
  ], `decision[${index}]`);

  const capabilityId = text(value.capabilityId, `decision[${index}].capabilityId`);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(capabilityId)) {
    throw new Error(`${capabilityId} capabilityId must be canonical kebab-case.`);
  }
  if (!Array.isArray(value.requirementRefs) || value.requirementRefs.length === 0) {
    throw new Error(`${capabilityId} must bind at least one requirementRef.`);
  }
  const requirementRefs = value.requirementRefs.map((entry, refIndex) =>
    machineRef(entry, `${capabilityId}.requirementRefs[${refIndex}]`));
  if (new Set(requirementRefs).size !== requirementRefs.length) {
    throw new Error(`${capabilityId} requirementRefs must be unique.`);
  }

  const layer = text(value.layer, `${capabilityId}.layer`);
  if (!LAYERS.has(layer)) throw new Error(`${capabilityId} layer ${layer} is unsupported.`);
  const decision = text(value.decision, `${capabilityId}.decision`);
  if (!DECISIONS.has(decision)) throw new Error(`${capabilityId} decision ${decision} is unsupported.`);

  const substrateValue = asRecord(value.substrate, `${capabilityId}.substrate`);
  exactKeys(substrateValue, ['kind', 'id', 'manifestSection', 'declaredSpec'], `${capabilityId}.substrate`);
  const kind = text(substrateValue.kind, `${capabilityId}.substrate.kind`);
  if (!SUBSTRATE_KINDS.has(kind)) throw new Error(`${capabilityId} substrate kind ${kind} is unsupported.`);
  const substrateId = text(substrateValue.id, `${capabilityId}.substrate.id`);
  const manifestSection = nullableText(substrateValue.manifestSection, `${capabilityId}.substrate.manifestSection`);
  const declaredSpec = substrateValue.declaredSpec;
  if (declaredSpec !== null && typeof declaredSpec !== 'string' && typeof declaredSpec !== 'number') {
    throw new Error(`${capabilityId}.substrate.declaredSpec must be string, number or null.`);
  }

  const manualFallback = text(value.manualFallback, `${capabilityId}.manualFallback`);
  if (manualFallback !== 'forbidden' && manualFallback !== 'semantic-only') {
    throw new Error(`${capabilityId} manualFallback ${manualFallback} is unsupported.`);
  }
  const adoptionOwner = nullableText(value.adoptionOwner, `${capabilityId}.adoptionOwner`);
  if (adoptionOwner !== null) machineRef(adoptionOwner, `${capabilityId}.adoptionOwner`);
  const triggerRef = nullableText(value.triggerRef, `${capabilityId}.triggerRef`);
  if (triggerRef !== null) machineRef(triggerRef, `${capabilityId}.triggerRef`);

  const typed = {
    capabilityId,
    requirementRefs,
    layer: layer as DevelopmentSubstrateDecisionV1['layer'],
    decision: decision as DevelopmentSubstrateDecisionV1['decision'],
    substrate: { kind, id: substrateId, manifestSection, declaredSpec },
    manualFallback: manualFallback as DevelopmentSubstrateDecisionV1['manualFallback'],
    adoptionOwner,
    triggerRef,
    authorityRetainedBy: text(value.authorityRetainedBy, `${capabilityId}.authorityRetainedBy`)
  } satisfies DevelopmentSubstrateDecisionV1;

  if (typed.decision === 'sec-owned') {
    if (typed.layer !== 'sec-semantic' || typed.manualFallback !== 'semantic-only') {
      throw new Error(`${capabilityId} sec-owned decision must be sec-semantic with semantic-only implementation.`);
    }
    if (typed.substrate.kind === 'candidate') {
      throw new Error(`${capabilityId} cannot hide an unadopted mechanical candidate behind sec-owned.`);
    }
  } else if (typed.manualFallback !== 'forbidden') {
    throw new Error(`${capabilityId} non-sec-owned capability must forbid manual fallback.`);
  }

  if (typed.decision === 'adopted' && typed.substrate.kind === 'candidate') {
    throw new Error(`${capabilityId} candidate substrate cannot be projected as adopted.`);
  }
  if ((typed.decision === 'selected-candidate' || typed.decision === 'deferred')
      && typed.substrate.kind === 'candidate'
      && typed.adoptionOwner === null) {
    throw new Error(`${capabilityId} candidate substrate must bind an adoption owner.`);
  }
  if (typed.decision === 'conditional' && typed.triggerRef === null) {
    throw new Error(`${capabilityId} conditional substrate must bind its availability trigger.`);
  }
  if (PERFORMANCE_GATED_IDS.has(capabilityId) && typed.triggerRef !== 'github:issue/316') {
    throw new Error(`${capabilityId} must remain gated by Performance Truth #316.`);
  }
  if (SUPPLY_CHAIN_IDS.has(capabilityId) && typed.manualFallback !== 'forbidden') {
    throw new Error(`${capabilityId} supply-chain capability cannot use hand-written crypto/evidence fallback.`);
  }

  validatePackageBinding(typed, packageJson);
  return typed;
}

export function parseDevelopmentSubstrateResolutionV1(
  registrySource: string,
  packageJsonSource: string
): DevelopmentSubstrateResolutionV1 {
  const parsed = asRecord(parseYaml(registrySource), 'Implementation substrate registry');
  exactKeys(parsed, ['schema', 'status', 'binding', 'policy', 'decisions'], 'Implementation substrate registry');
  if (parsed.schema !== 'sec-development-substrate-resolution-v1') {
    throw new Error('Implementation substrate registry schema must be sec-development-substrate-resolution-v1.');
  }
  if (parsed.status !== 'candidate' && parsed.status !== 'adopted') {
    throw new Error('Implementation substrate registry status must be candidate or adopted.');
  }

  const binding = asRecord(parsed.binding, 'Implementation substrate registry.binding');
  exactKeys(binding, [
    'repository',
    'baseMain',
    'decisionOwner',
    'dependencyAdoptionOwner',
    'productImplementationResolutionOwner',
    'maturityOwner',
    'performanceTruthOwner',
    'externalProviderCatalog'
  ], 'Implementation substrate registry.binding');
  if (binding.repository !== 'sec-platform/sec'
      || typeof binding.baseMain !== 'string'
      || !/^[0-9a-f]{40}$/u.test(binding.baseMain)
      || binding.decisionOwner !== 'github:issue/483'
      || binding.dependencyAdoptionOwner !== 'github:issue/193'
      || binding.productImplementationResolutionOwner !== 'github:issue/307'
      || binding.maturityOwner !== 'github:issue/314'
      || binding.performanceTruthOwner !== 'github:issue/316'
      || binding.externalProviderCatalog !== 'docs/governance/external-capability-ledger.yaml') {
    throw new Error('Implementation substrate registry binding is invalid.');
  }

  const policy = asRecord(parsed.policy, 'Implementation substrate registry.policy');
  exactKeys(policy, [
    'defaultManualFallback',
    'candidateIsNotAdopted',
    'unavailableProviderCannotFallbackToManual',
    'externalEvidenceCannotBecomeSemanticAuthority',
    'newDependencyRequiresPackageWriter',
    'performanceDrivenAdoptionRequiresEvidence',
    'cryptoAndAttestationManualImplementationForbidden'
  ], 'Implementation substrate registry.policy');
  if (policy.defaultManualFallback !== 'forbidden'
      || policy.candidateIsNotAdopted !== true
      || policy.unavailableProviderCannotFallbackToManual !== true
      || policy.externalEvidenceCannotBecomeSemanticAuthority !== true
      || policy.newDependencyRequiresPackageWriter !== true
      || policy.performanceDrivenAdoptionRequiresEvidence !== true
      || policy.cryptoAndAttestationManualImplementationForbidden !== true) {
    throw new Error('Implementation substrate registry policy must remain wheel-first and fail-closed.');
  }

  if (!Array.isArray(parsed.decisions) || parsed.decisions.length === 0) {
    throw new Error('Implementation substrate registry decisions must be non-empty.');
  }
  const packageJson = asRecord(JSON.parse(packageJsonSource), 'package.json');
  const decisions = parsed.decisions.map((entry, index) => parseDecision(entry, index, packageJson));
  const ids = decisions.map((entry) => entry.capabilityId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Implementation substrate registry capabilityId values must be unique.');
  }

  return {
    schema: 'sec-development-substrate-resolution-v1',
    status: parsed.status,
    decisions
  };
}

export async function validateRepositoryDevelopmentSubstrateResolutionV1(
  repositoryRoot: string
): Promise<DevelopmentSubstrateResolutionV1> {
  const [registrySource, packageJsonSource] = await Promise.all([
    fs.readFile(path.join(repositoryRoot, REGISTRY_PATH), 'utf8'),
    fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
  ]);
  return parseDevelopmentSubstrateResolutionV1(registrySource, packageJsonSource);
}

if (import.meta.main) {
  const repositoryRoot = path.resolve(import.meta.dir, '../..');
  const result = await validateRepositoryDevelopmentSubstrateResolutionV1(repositoryRoot);
  console.log(`implementation-substrate-resolution: ${result.decisions.length} decision(s) valid`);
}
