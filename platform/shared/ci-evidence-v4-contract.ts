import {
  CodexDevelopmentVerificationDigest,
  type VerificationEvidenceSource
} from './ci-evidence-contract.ts';
import {
  CodexDevelopmentAssertCiExecutionEnvironmentBindingV1,
  type CodexDevelopmentCiExecutionEnvironmentBindingV1
} from './ci-execution-environment.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from './ci-verification-revision.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentAssertVerificationGateResultV1,
  type VerificationAggregateResultV1,
  type VerificationClaimDefinitionV1,
  type VerificationGateResultV1
} from './verification-result-contract.ts';

export const CODEX_DEVELOPMENT_VERIFICATION_EVIDENCE_SCHEMA_V4 =
  'codex-development-verification-evidence-v4' as const;

export type CodexDevelopmentVerificationEvidenceKindV4 = 'verification' | 'risk';
export type CodexDevelopmentVerificationProfileV4 = 'quick' | 'risk' | 'full';
export type CodexDevelopmentVerificationScopeSourceV4 =
  | 'executed'
  | 'reused'
  | 'delta'
  | 'not-run'
  | 'not-applicable'
  | 'unsupported'
  | 'invalidated';

export interface CodexDevelopmentVerificationEvidenceIdentityV4 {
  headSha: string;
  treeSha: string;
  prBaseSha: string;
  affectedBaseSha: string;
  manifestPath: string | null;
  manifestDigest: string | null;
  inputDigest: string;
}

export interface CodexDevelopmentVerificationEvidenceScopeV4 {
  scopeId: string;
  source: CodexDevelopmentVerificationScopeSourceV4;
  observationId: string | null;
  evidenceRef: string | null;
  reasonCode: string;
}

export interface CodexDevelopmentVerificationGateEvidenceV4 {
  observationId: string;
  argv: string[];
  rawOutput: string | null;
  environmentBinding: CodexDevelopmentCiExecutionEnvironmentBindingV1 | null;
  result: VerificationGateResultV1;
}

export interface CodexDevelopmentVerificationEvidenceV4 {
  schema: typeof CODEX_DEVELOPMENT_VERIFICATION_EVIDENCE_SCHEMA_V4;
  contractRevision: typeof CI_VERIFICATION_CONTRACT_REVISION;
  kind: CodexDevelopmentVerificationEvidenceKindV4;
  profile: CodexDevelopmentVerificationProfileV4;
  source: VerificationEvidenceSource;
  identity: CodexDevelopmentVerificationEvidenceIdentityV4;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  changedFiles: string[] | null;
  selectionResolved: boolean;
  cleanState: { before: boolean | null; after: boolean | null };
  failure: { stage: string; tail: string } | null;
  gates: CodexDevelopmentVerificationGateEvidenceV4[];
  claims: VerificationClaimDefinitionV1[];
  aggregate: VerificationAggregateResultV1;
  scopeLedger: CodexDevelopmentVerificationEvidenceScopeV4[];
  invalidation: { expiresAt: string; rules: string[] };
  evidenceDigest: string;
}

export type CodexDevelopmentVerificationEvidenceV4Draft = Omit<
  CodexDevelopmentVerificationEvidenceV4,
  'evidenceDigest'
>;

const MAX_ID = 4096;
const MAX_TEXT = 65536;
const MAX_OUTPUT = 1048576;
const MAX_ITEMS = 10000;
const SCOPE_SOURCES = new Set<CodexDevelopmentVerificationScopeSourceV4>([
  'executed',
  'reused',
  'delta',
  'not-run',
  'not-applicable',
  'unsupported',
  'invalidated'
]);
const EVIDENCE_KEYS = [
  'schema',
  'contractRevision',
  'kind',
  'profile',
  'source',
  'identity',
  'startedAt',
  'finishedAt',
  'durationMs',
  'changedFiles',
  'selectionResolved',
  'cleanState',
  'failure',
  'gates',
  'claims',
  'aggregate',
  'scopeLedger',
  'invalidation',
  'evidenceDigest'
] as const;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function assertText(
  value: unknown,
  label: string,
  maximum = MAX_ID,
  allowEmpty = false
): asserts value is string {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maximum
    || value.includes('\0')
  ) {
    throw new Error(`${label} must be bounded valid text.`);
  }
}

function assertNullableText(
  value: unknown,
  label: string,
  maximum = MAX_ID,
  allowEmpty = false
): asserts value is string | null {
  if (value !== null) assertText(value, label, maximum, allowEmpty);
}

function assertCanonicalOrder(values: readonly string[], label: string): void {
  const sorted = [...values].sort((left, right) => left.localeCompare(right, 'en'));
  if (sorted.some((value, index) => value !== values[index])) {
    throw new Error(`${label} must be in canonical lexical order.`);
  }
}

function assertStringArray(
  value: unknown,
  label: string,
  options: { canonical?: boolean; nonEmpty?: boolean } = {}
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || (options.nonEmpty && value.length === 0)) {
    throw new Error(`${label} must be a bounded${options.nonEmpty ? ' non-empty' : ''} array.`);
  }
  value.forEach((entry, index) => assertText(entry, `${label}[${index}]`));
  if (new Set(value).size !== value.length) throw new Error(`${label} must be unique.`);
  if (options.canonical) assertCanonicalOrder(value, label);
}

function assertSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase commit SHA.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest.`);
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  assertText(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
}

function assertIdentity(
  value: unknown,
  label: string
): asserts value is CodexDevelopmentVerificationEvidenceIdentityV4 {
  assertObject(value, label);
  assertExactKeys(value, [
    'headSha',
    'treeSha',
    'prBaseSha',
    'affectedBaseSha',
    'manifestPath',
    'manifestDigest',
    'inputDigest'
  ], label);
  assertSha(value.headSha, `${label}.headSha`);
  assertSha(value.treeSha, `${label}.treeSha`);
  assertSha(value.prBaseSha, `${label}.prBaseSha`);
  assertSha(value.affectedBaseSha, `${label}.affectedBaseSha`);
  assertNullableText(value.manifestPath, `${label}.manifestPath`);
  if (value.manifestDigest !== null) assertDigest(value.manifestDigest, `${label}.manifestDigest`);
  if ((value.manifestPath === null) !== (value.manifestDigest === null)) {
    throw new Error(`${label} manifest path and digest must both be present or both null.`);
  }
  assertDigest(value.inputDigest, `${label}.inputDigest`);
}

function assertClaim(
  value: unknown,
  index: number
): asserts value is VerificationClaimDefinitionV1 {
  const label = `claims[${index}]`;
  assertObject(value, label);
  assertExactKeys(value, ['claimId', 'requiredGateIds', 'owningEnvironments'], label);
  assertText(value.claimId, `${label}.claimId`);
  assertStringArray(value.requiredGateIds, `${label}.requiredGateIds`, {
    canonical: true,
    nonEmpty: true
  });
  assertStringArray(value.owningEnvironments, `${label}.owningEnvironments`, {
    canonical: true,
    nonEmpty: true
  });
}

function assertGate(
  value: unknown,
  index: number
): asserts value is CodexDevelopmentVerificationGateEvidenceV4 {
  const label = `gates[${index}]`;
  assertObject(value, label);
  assertExactKeys(value, [
    'observationId',
    'argv',
    'rawOutput',
    'environmentBinding',
    'result'
  ], label);
  assertText(value.observationId, `${label}.observationId`);
  assertStringArray(value.argv, `${label}.argv`);
  assertNullableText(value.rawOutput, `${label}.rawOutput`, MAX_OUTPUT, true);
  if (value.environmentBinding !== null) {
    assertObject(value.environmentBinding, `${label}.environmentBinding`);
    CodexDevelopmentAssertCiExecutionEnvironmentBindingV1(
      value.environmentBinding as CodexDevelopmentCiExecutionEnvironmentBindingV1
    );
  }
  CodexDevelopmentAssertVerificationGateResultV1(value.result);
  const result = value.result as VerificationGateResultV1;

  if (result.disposition === 'executed') {
    if (value.environmentBinding === null || value.rawOutput === null) {
      throw new Error(`${label} executed result requires environment binding and raw output.`);
    }
    if (JSON.stringify(value.argv) !== JSON.stringify(result.execution?.argv ?? [])) {
      throw new Error(`${label}.argv must match canonical execution argv.`);
    }
  } else if (result.disposition === 'reused') {
    if (value.rawOutput !== null || value.environmentBinding !== null || value.argv.length > 0) {
      throw new Error(`${label} reused result must not fabricate fresh execution transport.`);
    }
  } else if (value.rawOutput !== null || value.environmentBinding !== null || value.argv.length > 0) {
    throw new Error(`${label} not-executed result must not carry execution transport.`);
  }
}

function assertScope(
  value: unknown,
  index: number
): asserts value is CodexDevelopmentVerificationEvidenceScopeV4 {
  const label = `scopeLedger[${index}]`;
  assertObject(value, label);
  assertExactKeys(value, [
    'scopeId',
    'source',
    'observationId',
    'evidenceRef',
    'reasonCode'
  ], label);
  assertText(value.scopeId, `${label}.scopeId`);
  if (!SCOPE_SOURCES.has(value.source as CodexDevelopmentVerificationScopeSourceV4)) {
    throw new Error(`${label}.source is invalid.`);
  }
  assertNullableText(value.observationId, `${label}.observationId`);
  assertNullableText(value.evidenceRef, `${label}.evidenceRef`);
  assertText(value.reasonCode, `${label}.reasonCode`);

  if (value.source === 'delta') {
    if (value.observationId !== null || value.evidenceRef !== null) {
      throw new Error(`${label} delta scope cannot claim an observation or Evidence ref.`);
    }
    return;
  }
  if (value.observationId === null) {
    throw new Error(`${label} ${String(value.source)} requires observationId.`);
  }
  if (value.source === 'reused' && value.evidenceRef === null) {
    throw new Error(`${label} reused scope requires evidenceRef.`);
  }
  if (value.source !== 'reused' && value.evidenceRef !== null) {
    throw new Error(`${label} only reused scope may carry evidenceRef.`);
  }
}

function assertGateClaimClosure(
  claims: readonly VerificationClaimDefinitionV1[],
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[]
): void {
  const claimIds = new Set(claims.map((claim) => claim.claimId));
  const logicalGateIds = new Set(gates.map((gate) => gate.result.gateId));

  for (const definition of claims) {
    for (const requiredGateId of definition.requiredGateIds) {
      if (!logicalGateIds.has(requiredGateId)) {
        throw new Error(
          `Verification Evidence V4 claim ${definition.claimId} references unknown gate ${requiredGateId}.`
        );
      }
      const matchingObservations = gates.filter((gate) => gate.result.gateId === requiredGateId);
      if (matchingObservations.some((gate) => !gate.result.requiredForClaims.includes(definition.claimId))) {
        throw new Error(
          `Verification Evidence V4 gate ${requiredGateId} omits required claim ${definition.claimId}.`
        );
      }
    }
  }

  for (const gate of gates) {
    for (const supportedClaimId of gate.result.supportedClaims) {
      if (!claimIds.has(supportedClaimId)) {
        throw new Error(
          `Verification Evidence V4 observation ${gate.observationId} supports unknown claim ${supportedClaimId}.`
        );
      }
    }
    for (const requiredClaimId of gate.result.requiredForClaims) {
      if (!claimIds.has(requiredClaimId) && gate.result.applicability !== 'not-applicable') {
        throw new Error(
          `Verification Evidence V4 observation ${gate.observationId} binds unknown claim ${requiredClaimId}.`
        );
      }
    }
  }
}

function assertScopeObservationClosure(
  scopes: readonly CodexDevelopmentVerificationEvidenceScopeV4[],
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[]
): void {
  const byObservation = new Map(gates.map((gate) => [gate.observationId, gate] as const));
  const counts = new Map<string, number>();

  for (const scope of scopes) {
    if (scope.observationId === null) continue;
    const gate = byObservation.get(scope.observationId);
    if (!gate) {
      throw new Error(
        `Verification Evidence V4 scope ${scope.scopeId} references unknown observation.`
      );
    }
    counts.set(scope.observationId, (counts.get(scope.observationId) ?? 0) + 1);
    const result = gate.result;
    const matches =
      (scope.source === 'executed' && result.disposition === 'executed')
      || (scope.source === 'reused' && result.disposition === 'reused')
      || (
        scope.source === 'not-run'
        && result.status === 'not-run'
        && result.applicability !== 'not-applicable'
      )
      || (
        scope.source === 'not-applicable'
        && result.status === 'not-run'
        && result.applicability === 'not-applicable'
      )
      || (scope.source === 'unsupported' && result.status === 'unsupported')
      || (scope.source === 'invalidated' && result.status === 'invalidated');
    if (!matches || scope.reasonCode !== result.reasonCode) {
      throw new Error(
        `Verification Evidence V4 scope ${scope.scopeId} contradicts observation ${scope.observationId}.`
      );
    }
    if (
      scope.source === 'reused'
      && !result.evidenceRefs.includes(scope.evidenceRef as string)
    ) {
      throw new Error(
        `Verification Evidence V4 reused scope ${scope.scopeId} lacks observation Evidence binding.`
      );
    }
  }

  for (const gate of gates) {
    if ((counts.get(gate.observationId) ?? 0) !== 1) {
      throw new Error(
        `Verification Evidence V4 observation ${gate.observationId} requires exactly one scope entry.`
      );
    }
  }
}

function canonicalAggregate(
  claims: readonly VerificationClaimDefinitionV1[],
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[]
): VerificationAggregateResultV1 {
  return CodexDevelopmentAggregateVerificationClaimsV1({
    claims,
    gateResults: gates.map((gate) => gate.result)
  });
}

export function CodexDevelopmentFinalizeVerificationEvidenceV4(
  draft: CodexDevelopmentVerificationEvidenceV4Draft
): CodexDevelopmentVerificationEvidenceV4 {
  const evidence: CodexDevelopmentVerificationEvidenceV4 = {
    ...draft,
    evidenceDigest: CodexDevelopmentVerificationDigest(draft)
  };
  CodexDevelopmentAssertVerificationEvidenceV4(evidence, {}, new Date(evidence.startedAt));
  return evidence;
}

export function CodexDevelopmentAssertVerificationEvidenceV4(
  value: unknown,
  expected: Partial<{
    kind: CodexDevelopmentVerificationEvidenceKindV4;
    profile: CodexDevelopmentVerificationProfileV4;
    headSha: string;
    treeSha: string;
    prBaseSha: string;
    affectedBaseSha: string;
    manifestPath: string | null;
    manifestDigest: string | null;
    contractRevision: typeof CI_VERIFICATION_CONTRACT_REVISION;
  }> = {},
  now = new Date()
): asserts value is CodexDevelopmentVerificationEvidenceV4 {
  assertObject(value, 'verification evidence v4');
  assertExactKeys(value, EVIDENCE_KEYS, 'verification evidence v4');
  if (value.schema !== CODEX_DEVELOPMENT_VERIFICATION_EVIDENCE_SCHEMA_V4) {
    throw new Error('Verification evidence V4 schema mismatch.');
  }
  if (value.contractRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
    throw new Error('Verification evidence V4 CI revision mismatch.');
  }
  if (!['verification', 'risk'].includes(String(value.kind))) {
    throw new Error('Verification evidence V4 kind is invalid.');
  }
  if (!['quick', 'risk', 'full'].includes(String(value.profile))) {
    throw new Error('Verification evidence V4 profile is invalid.');
  }
  if (!['local', 'composition'].includes(String(value.source))) {
    throw new Error('Verification evidence V4 source is invalid.');
  }
  assertIdentity(value.identity, 'verification evidence v4.identity');
  assertIsoDate(value.startedAt, 'verification evidence v4.startedAt');
  assertIsoDate(value.finishedAt, 'verification evidence v4.finishedAt');
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0) {
    throw new Error('Verification evidence V4 durationMs is invalid.');
  }
  const measuredDuration = Date.parse(value.finishedAt as string) - Date.parse(value.startedAt as string);
  if (measuredDuration < 0 || measuredDuration !== value.durationMs) {
    throw new Error('Verification evidence V4 duration does not match timestamps.');
  }
  if (value.changedFiles !== null) {
    assertStringArray(value.changedFiles, 'verification evidence v4.changedFiles', {
      canonical: true
    });
  }
  if (typeof value.selectionResolved !== 'boolean') {
    throw new Error('Verification evidence V4 selectionResolved must be boolean.');
  }

  assertObject(value.cleanState, 'verification evidence v4.cleanState');
  assertExactKeys(value.cleanState, ['before', 'after'], 'verification evidence v4.cleanState');
  if (
    ![true, false, null].includes(value.cleanState.before as boolean | null)
    || ![true, false, null].includes(value.cleanState.after as boolean | null)
  ) {
    throw new Error('Verification evidence V4 cleanState is invalid.');
  }
  if (value.failure !== null) {
    assertObject(value.failure, 'verification evidence v4.failure');
    assertExactKeys(value.failure, ['stage', 'tail'], 'verification evidence v4.failure');
    assertText(value.failure.stage, 'verification evidence v4.failure.stage');
    assertText(value.failure.tail, 'verification evidence v4.failure.tail', MAX_TEXT, true);
  }

  if (!Array.isArray(value.gates) || value.gates.length > MAX_ITEMS) {
    throw new Error('Verification evidence V4 gates must be a bounded array.');
  }
  value.gates.forEach(assertGate);
  const gates = value.gates as CodexDevelopmentVerificationGateEvidenceV4[];
  const observationIds = gates.map((gate) => gate.observationId);
  if (new Set(observationIds).size !== observationIds.length) {
    throw new Error('Verification evidence V4 observation IDs must be unique.');
  }
  assertCanonicalOrder(observationIds, 'Verification evidence V4 observation IDs');

  if (!Array.isArray(value.claims) || value.claims.length > MAX_ITEMS) {
    throw new Error('Verification evidence V4 claims must be a bounded array.');
  }
  value.claims.forEach(assertClaim);
  const claims = value.claims as VerificationClaimDefinitionV1[];
  const claimIds = claims.map((claim) => claim.claimId);
  if (new Set(claimIds).size !== claimIds.length) {
    throw new Error('Verification evidence V4 claim IDs must be unique.');
  }
  assertCanonicalOrder(claimIds, 'Verification evidence V4 claim IDs');
  assertGateClaimClosure(claims, gates);

  if (!Array.isArray(value.scopeLedger) || value.scopeLedger.length > MAX_ITEMS) {
    throw new Error('Verification evidence V4 scopeLedger must be a bounded array.');
  }
  value.scopeLedger.forEach(assertScope);
  const scopes = value.scopeLedger as CodexDevelopmentVerificationEvidenceScopeV4[];
  const scopeIds = scopes.map((scope) => scope.scopeId);
  if (new Set(scopeIds).size !== scopeIds.length) {
    throw new Error('Verification evidence V4 scope IDs must be unique.');
  }
  assertCanonicalOrder(scopeIds, 'Verification evidence V4 scope IDs');
  assertScopeObservationClosure(scopes, gates);

  assertObject(value.aggregate, 'verification evidence v4.aggregate');
  const recomputed = canonicalAggregate(claims, gates);
  if (JSON.stringify(value.aggregate) !== JSON.stringify(recomputed)) {
    throw new Error(
      'Verification evidence V4 aggregate does not match canonical observation/claim closure.'
    );
  }
  const aggregate = value.aggregate as VerificationAggregateResultV1;
  if (aggregate.overallStatus === 'passed') {
    if (
      gates.length === 0
      || claims.length === 0
      || scopes.length === 0
      || value.failure !== null
      || value.selectionResolved !== true
      || value.cleanState.before !== true
      || value.cleanState.after !== true
      || aggregate.claimResults.some((claim) => (
        claim.status !== 'passed' || claim.coverageComplete !== true
      ))
      || scopes.some((scope) => (
        ['delta', 'not-run', 'unsupported', 'invalidated'].includes(scope.source)
      ))
    ) {
      throw new Error('Passed Verification Evidence V4 has incomplete or inconsistent proof.');
    }
  } else if (aggregate.overallStatus === 'failed' && value.failure === null) {
    throw new Error('Failed Verification Evidence V4 requires failure details.');
  }

  assertObject(value.invalidation, 'verification evidence v4.invalidation');
  assertExactKeys(value.invalidation, ['expiresAt', 'rules'], 'verification evidence v4.invalidation');
  assertIsoDate(value.invalidation.expiresAt, 'verification evidence v4.invalidation.expiresAt');
  assertStringArray(value.invalidation.rules, 'verification evidence v4.invalidation.rules', {
    canonical: true
  });
  if (Date.parse(value.invalidation.expiresAt as string) <= now.getTime()) {
    throw new Error('Verification evidence V4 has expired.');
  }
  assertDigest(value.evidenceDigest, 'verification evidence v4.evidenceDigest');

  const identity = value.identity as CodexDevelopmentVerificationEvidenceIdentityV4;
  const actual: Record<string, unknown> = {
    kind: value.kind,
    profile: value.profile,
    contractRevision: value.contractRevision,
    headSha: identity.headSha,
    treeSha: identity.treeSha,
    prBaseSha: identity.prBaseSha,
    affectedBaseSha: identity.affectedBaseSha,
    manifestPath: identity.manifestPath,
    manifestDigest: identity.manifestDigest
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      throw new Error(`Verification evidence V4 ${key} mismatch.`);
    }
  }

  const { evidenceDigest, ...withoutDigest } = value;
  if (evidenceDigest !== CodexDevelopmentVerificationDigest(withoutDigest)) {
    throw new Error('Verification evidence V4 digest mismatch.');
  }
}
