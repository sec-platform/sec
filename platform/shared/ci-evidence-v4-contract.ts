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
  gateId: string | null;
  evidenceRef: string | null;
  reasonCode: string;
}

export interface CodexDevelopmentVerificationGateEvidenceV4 {
  id: string;
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
  'executed', 'reused', 'delta', 'not-run', 'not-applicable', 'unsupported', 'invalidated'
]);
const EVIDENCE_KEYS = [
  'schema', 'contractRevision', 'kind', 'profile', 'source', 'identity',
  'startedAt', 'finishedAt', 'durationMs', 'changedFiles', 'selectionResolved',
  'cleanState', 'failure', 'gates', 'claims', 'aggregate', 'scopeLedger',
  'invalidation', 'evidenceDigest'
] as const;

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function text(
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
  ) throw new Error(`${label} must be bounded valid text.`);
}

function nullableText(
  value: unknown,
  label: string,
  maximum = MAX_ID,
  allowEmpty = false
): asserts value is string | null {
  if (value !== null) text(value, label, maximum, allowEmpty);
}

function canonicalOrder(values: readonly string[], label: string): void {
  const sorted = [...values].sort((left, right) => left.localeCompare(right, 'en'));
  if (sorted.some((entry, index) => entry !== values[index])) {
    throw new Error(`${label} must be in canonical lexical order.`);
  }
}

function strings(
  value: unknown,
  label: string,
  options: { canonical?: boolean; nonEmpty?: boolean } = {}
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || (options.nonEmpty && value.length === 0)) {
    throw new Error(`${label} must be a bounded${options.nonEmpty ? ' non-empty' : ''} array.`);
  }
  value.forEach((entry, index) => text(entry, `${label}[${index}]`));
  if (new Set(value).size !== value.length) throw new Error(`${label} must be unique.`);
  if (options.canonical) canonicalOrder(value, label);
}

function sha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase commit SHA.`);
  }
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest.`);
  }
}

function iso(value: unknown, label: string): asserts value is string {
  text(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
}

function identity(
  value: unknown,
  label: string
): asserts value is CodexDevelopmentVerificationEvidenceIdentityV4 {
  object(value, label);
  exact(value, [
    'headSha', 'treeSha', 'prBaseSha', 'affectedBaseSha', 'manifestPath',
    'manifestDigest', 'inputDigest'
  ], label);
  sha(value.headSha, `${label}.headSha`);
  sha(value.treeSha, `${label}.treeSha`);
  sha(value.prBaseSha, `${label}.prBaseSha`);
  sha(value.affectedBaseSha, `${label}.affectedBaseSha`);
  nullableText(value.manifestPath, `${label}.manifestPath`);
  if (value.manifestDigest !== null) digest(value.manifestDigest, `${label}.manifestDigest`);
  if ((value.manifestPath === null) !== (value.manifestDigest === null)) {
    throw new Error(`${label} manifest path and digest must both be present or both null.`);
  }
  digest(value.inputDigest, `${label}.inputDigest`);
}

function claim(value: unknown, index: number): asserts value is VerificationClaimDefinitionV1 {
  const label = `claims[${index}]`;
  object(value, label);
  exact(value, ['claimId', 'requiredGateIds', 'owningEnvironments'], label);
  text(value.claimId, `${label}.claimId`);
  strings(value.requiredGateIds, `${label}.requiredGateIds`, { canonical: true, nonEmpty: true });
  strings(value.owningEnvironments, `${label}.owningEnvironments`, { canonical: true, nonEmpty: true });
}

function gate(
  value: unknown,
  index: number
): asserts value is CodexDevelopmentVerificationGateEvidenceV4 {
  const label = `gates[${index}]`;
  object(value, label);
  exact(value, ['id', 'argv', 'rawOutput', 'environmentBinding', 'result'], label);
  text(value.id, `${label}.id`);
  strings(value.argv, `${label}.argv`);
  nullableText(value.rawOutput, `${label}.rawOutput`, MAX_OUTPUT, true);
  if (value.environmentBinding !== null) {
    object(value.environmentBinding, `${label}.environmentBinding`);
    CodexDevelopmentAssertCiExecutionEnvironmentBindingV1(
      value.environmentBinding as CodexDevelopmentCiExecutionEnvironmentBindingV1
    );
  }
  CodexDevelopmentAssertVerificationGateResultV1(value.result);
  const result = value.result as VerificationGateResultV1;
  if (result.gateId !== value.id) throw new Error(`${label} ID does not match result.gateId.`);

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

function scope(
  value: unknown,
  index: number
): asserts value is CodexDevelopmentVerificationEvidenceScopeV4 {
  const label = `scopeLedger[${index}]`;
  object(value, label);
  exact(value, ['scopeId', 'source', 'gateId', 'evidenceRef', 'reasonCode'], label);
  text(value.scopeId, `${label}.scopeId`);
  if (!SCOPE_SOURCES.has(value.source as CodexDevelopmentVerificationScopeSourceV4)) {
    throw new Error(`${label}.source is invalid.`);
  }
  nullableText(value.gateId, `${label}.gateId`);
  nullableText(value.evidenceRef, `${label}.evidenceRef`);
  text(value.reasonCode, `${label}.reasonCode`);

  if (value.source === 'delta') {
    if (value.gateId !== null || value.evidenceRef !== null) {
      throw new Error(`${label} delta scope cannot claim a gate result or Evidence ref.`);
    }
    return;
  }
  if (value.gateId === null) throw new Error(`${label} ${String(value.source)} requires gateId.`);
  if (value.source === 'reused' && value.evidenceRef === null) {
    throw new Error(`${label} reused scope requires evidenceRef.`);
  }
  if (value.source !== 'reused' && value.evidenceRef !== null) {
    throw new Error(`${label} only reused scope may carry evidenceRef.`);
  }
}

function gateClaimClosure(
  claims: readonly VerificationClaimDefinitionV1[],
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[]
): void {
  const claimIds = new Set(claims.map((entry) => entry.claimId));
  const byGate = new Map(gates.map((entry) => [entry.id, entry] as const));
  for (const definition of claims) {
    for (const gateId of definition.requiredGateIds) {
      const evidence = byGate.get(gateId);
      if (!evidence) {
        throw new Error(`Verification Evidence V4 claim ${definition.claimId} references unknown gate ${gateId}.`);
      }
      if (!evidence.result.requiredForClaims.includes(definition.claimId)) {
        throw new Error(`Verification Evidence V4 gate ${gateId} omits required claim ${definition.claimId}.`);
      }
    }
  }
  for (const evidence of gates) {
    for (const supportedId of evidence.result.supportedClaims) {
      if (!claimIds.has(supportedId)) {
        throw new Error(`Verification Evidence V4 gate ${evidence.id} supports unknown claim ${supportedId}.`);
      }
    }
    for (const requiredId of evidence.result.requiredForClaims) {
      if (!claimIds.has(requiredId) && evidence.result.applicability !== 'not-applicable') {
        throw new Error(`Verification Evidence V4 gate ${evidence.id} binds unknown claim ${requiredId}.`);
      }
    }
  }
}

function scopeGateClosure(
  scopes: readonly CodexDevelopmentVerificationEvidenceScopeV4[],
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[]
): void {
  const byGate = new Map(gates.map((entry) => [entry.id, entry] as const));
  const counts = new Map<string, number>();
  for (const entry of scopes) {
    if (entry.gateId === null) continue;
    const evidence = byGate.get(entry.gateId);
    if (!evidence) throw new Error(`Verification Evidence V4 scope ${entry.scopeId} references unknown gate.`);
    counts.set(entry.gateId, (counts.get(entry.gateId) ?? 0) + 1);
    const result = evidence.result;
    const matches =
      (entry.source === 'executed' && result.disposition === 'executed')
      || (entry.source === 'reused' && result.disposition === 'reused')
      || (entry.source === 'not-run' && result.status === 'not-run' && result.applicability !== 'not-applicable')
      || (entry.source === 'not-applicable' && result.status === 'not-run' && result.applicability === 'not-applicable')
      || (entry.source === 'unsupported' && result.status === 'unsupported')
      || (entry.source === 'invalidated' && result.status === 'invalidated');
    if (!matches || entry.reasonCode !== result.reasonCode) {
      throw new Error(`Verification Evidence V4 scope ${entry.scopeId} contradicts gate ${evidence.id}.`);
    }
    if (entry.source === 'reused' && !result.evidenceRefs.includes(entry.evidenceRef as string)) {
      throw new Error(`Verification Evidence V4 reused scope ${entry.scopeId} lacks gate Evidence binding.`);
    }
  }
  for (const evidence of gates) {
    if ((counts.get(evidence.id) ?? 0) !== 1) {
      throw new Error(`Verification Evidence V4 gate ${evidence.id} requires exactly one scope entry.`);
    }
  }
}

function aggregate(
  claims: readonly VerificationClaimDefinitionV1[],
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[]
): VerificationAggregateResultV1 {
  return CodexDevelopmentAggregateVerificationClaimsV1({
    claims,
    gateResults: gates.map((entry) => entry.result)
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
  object(value, 'verification evidence v4');
  exact(value, EVIDENCE_KEYS, 'verification evidence v4');
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
  identity(value.identity, 'verification evidence v4.identity');
  iso(value.startedAt, 'verification evidence v4.startedAt');
  iso(value.finishedAt, 'verification evidence v4.finishedAt');
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0) {
    throw new Error('Verification evidence V4 durationMs is invalid.');
  }
  const measuredDuration = Date.parse(value.finishedAt as string) - Date.parse(value.startedAt as string);
  if (measuredDuration < 0 || measuredDuration !== value.durationMs) {
    throw new Error('Verification evidence V4 duration does not match timestamps.');
  }
  if (value.changedFiles !== null) {
    strings(value.changedFiles, 'verification evidence v4.changedFiles', { canonical: true });
  }
  if (typeof value.selectionResolved !== 'boolean') {
    throw new Error('Verification evidence V4 selectionResolved must be boolean.');
  }
  object(value.cleanState, 'verification evidence v4.cleanState');
  exact(value.cleanState, ['before', 'after'], 'verification evidence v4.cleanState');
  if (
    ![true, false, null].includes(value.cleanState.before as boolean | null)
    || ![true, false, null].includes(value.cleanState.after as boolean | null)
  ) throw new Error('Verification evidence V4 cleanState is invalid.');
  if (value.failure !== null) {
    object(value.failure, 'verification evidence v4.failure');
    exact(value.failure, ['stage', 'tail'], 'verification evidence v4.failure');
    text(value.failure.stage, 'verification evidence v4.failure.stage');
    text(value.failure.tail, 'verification evidence v4.failure.tail', MAX_TEXT, true);
  }

  if (!Array.isArray(value.gates) || value.gates.length > MAX_ITEMS) {
    throw new Error('Verification evidence V4 gates must be a bounded array.');
  }
  value.gates.forEach(gate);
  const gates = value.gates as CodexDevelopmentVerificationGateEvidenceV4[];
  const gateIds = gates.map((entry) => entry.id);
  if (new Set(gateIds).size !== gateIds.length) {
    throw new Error('Verification evidence V4 gate IDs must be unique.');
  }
  canonicalOrder(gateIds, 'Verification evidence V4 gate IDs');

  if (!Array.isArray(value.claims) || value.claims.length > MAX_ITEMS) {
    throw new Error('Verification evidence V4 claims must be a bounded array.');
  }
  value.claims.forEach(claim);
  const claims = value.claims as VerificationClaimDefinitionV1[];
  const claimIds = claims.map((entry) => entry.claimId);
  if (new Set(claimIds).size !== claimIds.length) {
    throw new Error('Verification evidence V4 claim IDs must be unique.');
  }
  canonicalOrder(claimIds, 'Verification evidence V4 claim IDs');
  gateClaimClosure(claims, gates);

  if (!Array.isArray(value.scopeLedger) || value.scopeLedger.length > MAX_ITEMS) {
    throw new Error('Verification evidence V4 scopeLedger must be a bounded array.');
  }
  value.scopeLedger.forEach(scope);
  const scopes = value.scopeLedger as CodexDevelopmentVerificationEvidenceScopeV4[];
  const scopeIds = scopes.map((entry) => entry.scopeId);
  if (new Set(scopeIds).size !== scopeIds.length) {
    throw new Error('Verification evidence V4 scope IDs must be unique.');
  }
  canonicalOrder(scopeIds, 'Verification evidence V4 scope IDs');
  scopeGateClosure(scopes, gates);

  object(value.aggregate, 'verification evidence v4.aggregate');
  const recomputed = aggregate(claims, gates);
  if (JSON.stringify(value.aggregate) !== JSON.stringify(recomputed)) {
    throw new Error('Verification evidence V4 aggregate does not match canonical gate/claim closure.');
  }
  const result = value.aggregate as VerificationAggregateResultV1;
  if (result.overallStatus === 'passed') {
    if (
      gates.length === 0
      || claims.length === 0
      || scopes.length === 0
      || value.failure !== null
      || value.selectionResolved !== true
      || value.cleanState.before !== true
      || value.cleanState.after !== true
      || result.claimResults.some((entry) => entry.status !== 'passed' || !entry.coverageComplete)
      || scopes.some((entry) => ['delta', 'not-run', 'unsupported', 'invalidated'].includes(entry.source))
    ) throw new Error('Passed Verification Evidence V4 has incomplete or inconsistent proof.');
  } else if (result.overallStatus === 'failed' && value.failure === null) {
    throw new Error('Failed Verification Evidence V4 requires failure details.');
  }

  object(value.invalidation, 'verification evidence v4.invalidation');
  exact(value.invalidation, ['expiresAt', 'rules'], 'verification evidence v4.invalidation');
  iso(value.invalidation.expiresAt, 'verification evidence v4.invalidation.expiresAt');
  strings(value.invalidation.rules, 'verification evidence v4.invalidation.rules', { canonical: true });
  if (Date.parse(value.invalidation.expiresAt as string) <= now.getTime()) {
    throw new Error('Verification evidence V4 has expired.');
  }
  digest(value.evidenceDigest, 'verification evidence v4.evidenceDigest');

  const id = value.identity as CodexDevelopmentVerificationEvidenceIdentityV4;
  const actual: Record<string, unknown> = {
    kind: value.kind,
    profile: value.profile,
    contractRevision: value.contractRevision,
    headSha: id.headSha,
    treeSha: id.treeSha,
    prBaseSha: id.prBaseSha,
    affectedBaseSha: id.affectedBaseSha,
    manifestPath: id.manifestPath,
    manifestDigest: id.manifestDigest
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
