import { canonicalEquals, canonicalJson, deepFreeze, isPlainObject, sha256 } from '../../../../../contracts/canonical.ts';
import { isDigest } from '../../../../../contracts/digest.ts';
import { parseExactJson } from '../../../../../contracts/exact-json.ts';
import { isObjectId } from '../../../../../contracts/git-object-id.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../../contracts/repository-path.ts';
import type { VerificationSessionHostedRequest } from '../../../../../execution/verification/hosted.ts';


/** Local preparation is a persisted plan input, never a hosted dispatch request. */
export const CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA =
  'sec-verification-session-local-preparation-v1' as const;

export interface VerificationSessionLocalPreparationRequest {
  readonly schema: typeof CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA;
  readonly executionPlacement: 'local';
  readonly authorityStage: 'preparation-only';
  readonly request: Readonly<VerificationSessionHostedRequest<typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA>>;
}

/** V2 fixes source and qualification inputs without constructing a Session or Action. */
export const CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA =
  'sec-verification-session-local-preparation-v2' as const;

export interface VerificationSessionLocalPreparationRequestV2Body {
  readonly repository: string;
  readonly prNumber: number;
  readonly expectedBaseSha: string;
  readonly expectedBaseTreeSha: string;
  readonly expectedHeadSha: string;
  readonly expectedHeadTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly profile: 'quick' | 'full';
  readonly authorizedPaths: readonly string[];
  readonly sourceFactsDigest: `sha256:${string}`;
  readonly verificationPlanDigest: `sha256:${string}`;
  readonly actorNodeId: string;
  readonly sourceProgramBindingDigest: `sha256:${string}`;
  readonly qualificationRequirements: Readonly<{
    trustedRevision: string;
    producerIdentity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts';
    producerRuntimeIdentity: 'src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
    nativeProfileDigest: `sha256:${string}`;
    /** Null means unresolved input. Even a digest is not physical qualification. */
    nativeContentManifestDigest: `sha256:${string}` | null;
    mainHealthMethodDigest: `sha256:${string}`;
    mainHealthPolicyDigest: `sha256:${string}`;
    verificationContractRevision: string;
    reviewPolicyDigest: `sha256:${string}`;
    evidenceRequirementDigest: `sha256:${string}`;
    integrationPolicyDigest: `sha256:${string}`;
  }>;
  readonly purpose: 'verification-only';
}

export interface VerificationSessionLocalPreparationRequestV2 {
  readonly schema: typeof CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA;
  readonly executionPlacement: 'local';
  readonly authorityStage: 'preparation-only';
  readonly request: VerificationSessionLocalPreparationRequestV2Body & Readonly<{
    requestDigest: `sha256:${string}`;
    requestOperationId: `sha256:${string}`;
  }>;
}

export type VerificationSessionLocalPreparation =
  | VerificationSessionLocalPreparationRequest
  | VerificationSessionLocalPreparationRequestV2;

const LOCAL_PREPARATION_V2_ENVELOPE_KEYS = ['schema', 'executionPlacement', 'authorityStage', 'request'];
const LOCAL_PREPARATION_V2_BODY_KEYS = [
  'repository', 'prNumber', 'expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha',
  'expectedHeadTreeSha', 'manifestPath', 'manifestDigest', 'profile', 'authorizedPaths',
  'sourceFactsDigest', 'verificationPlanDigest', 'actorNodeId', 'sourceProgramBindingDigest',
  'qualificationRequirements', 'purpose'
];
const LOCAL_PREPARATION_V2_QUALIFICATION_KEYS = [
  'trustedRevision', 'producerIdentity', 'producerRuntimeIdentity', 'nativeProfileDigest',
  'nativeContentManifestDigest', 'mainHealthMethodDigest', 'mainHealthPolicyDigest',
  'verificationContractRevision', 'reviewPolicyDigest', 'evidenceRequirementDigest', 'integrationPolicyDigest'
];
// This bounded input codec never reads source, credentials, runtime state or providers.
const LOCAL_PREPARATION_V2_MAXIMUM_INPUT_BYTES = 1024 * 1024;

function assertLocalPreparationExactKeys(
  value: unknown, expected: readonly string[], label: string
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value) || Reflect.ownKeys(value).length !== expected.length
      || expected.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
      })) {
    throw new Error(`Local preparation V2 ${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function isLocalPreparationBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
    && value.trim() === value && value.normalize('NFC') === value
    && !/[\u0000-\u001f\u007f\p{Surrogate}]/u.test(value);
}

function assertLocalPreparationV2Body(
  value: unknown, includeDigests: boolean
): asserts value is VerificationSessionLocalPreparationRequestV2Body {
  assertLocalPreparationExactKeys(value, includeDigests
    ? [...LOCAL_PREPARATION_V2_BODY_KEYS, 'requestDigest', 'requestOperationId']
    : LOCAL_PREPARATION_V2_BODY_KEYS, 'request');
  if (!isLocalPreparationBoundedText(value.repository, 201)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value.repository)) {
    throw new Error('Local preparation V2 repository must be canonical owner/repository.');
  }
  if (!Number.isSafeInteger(value.prNumber) || (value.prNumber as number) <= 0) {
    throw new Error('Local preparation V2 prNumber must be a positive safe integer.');
  }
  for (const field of ['expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha', 'expectedHeadTreeSha']) {
    if (!isObjectId(value[field], 'sha1')) throw new Error(`Local preparation V2 ${field} must be exact 40-hex.`);
  }
  if (!CodexDevelopmentIsCanonicalRepositoryPath(value.manifestPath)) {
    throw new Error('Local preparation V2 manifestPath must be canonical repository-relative.');
  }
  if (value.profile !== 'quick' && value.profile !== 'full') {
    throw new Error('Local preparation V2 profile must be quick or full.');
  }
  if (!Array.isArray(value.authorizedPaths)) {
    throw new Error('Local preparation V2 authorizedPaths must be a sorted unique array of canonical paths.');
  }
  for (let index = 0; index < value.authorizedPaths.length; index += 1) {
    const entry: unknown = value.authorizedPaths[index];
    if (!CodexDevelopmentIsCanonicalRepositoryPath(entry)
        || (index > 0 && value.authorizedPaths[index - 1] >= entry)) {
      throw new Error('Local preparation V2 authorizedPaths must be sorted unique canonical repository-relative paths.');
    }
  }
  if (!isLocalPreparationBoundedText(value.actorNodeId, 256) || /\s/u.test(value.actorNodeId)) {
    throw new Error('Local preparation V2 actorNodeId must be bounded canonical identity text.');
  }
  for (const field of ['manifestDigest', 'sourceFactsDigest', 'verificationPlanDigest', 'sourceProgramBindingDigest',
    ...(includeDigests ? ['requestDigest', 'requestOperationId'] : [])]) {
    if (!isDigest(value[field], 'sha256')) throw new Error(`Local preparation V2 ${field} must be a SHA-256 digest.`);
  }
  const requirements = value.qualificationRequirements;
  assertLocalPreparationExactKeys(requirements, LOCAL_PREPARATION_V2_QUALIFICATION_KEYS, 'qualificationRequirements');
  if (requirements.trustedRevision !== value.expectedBaseSha) {
    throw new Error('Local preparation V2 trustedRevision must equal the exact expected base.');
  }
  if (requirements.producerIdentity !== 'src/adapters/self-hosting/control/main-health/main-health-observation.ts'
      || requirements.producerRuntimeIdentity !== 'src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts') {
    throw new Error('Local preparation V2 qualification producer identity is invalid.');
  }
  for (const field of ['nativeProfileDigest', 'mainHealthMethodDigest', 'mainHealthPolicyDigest',
    'reviewPolicyDigest', 'evidenceRequirementDigest', 'integrationPolicyDigest']) {
    if (!isDigest(requirements[field], 'sha256')) {
      throw new Error(`Local preparation V2 qualificationRequirements.${field} must be a SHA-256 digest.`);
    }
  }
  if (requirements.nativeContentManifestDigest !== null && !isDigest(requirements.nativeContentManifestDigest, 'sha256')) {
    throw new Error('Local preparation V2 nativeContentManifestDigest must be a SHA-256 digest or unresolved null.');
  }
  if (!isLocalPreparationBoundedText(requirements.verificationContractRevision, 256)) {
    throw new Error('Local preparation V2 verificationContractRevision must be bounded canonical text.');
  }
  if (value.purpose !== 'verification-only') {
    throw new Error('Local preparation V2 purpose must be verification-only.');
  }
}

/** Data creation only: pinned requirements do not establish live qualification. */
export function createVerificationSessionLocalPreparationRequestV2(
  input: VerificationSessionLocalPreparationRequestV2Body
): VerificationSessionLocalPreparationRequestV2 {
  assertLocalPreparationV2Body(input, false);
  const body = canonicalJson(input) as VerificationSessionLocalPreparationRequestV2Body;
  const content = { schema: CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA,
    executionPlacement: 'local' as const, authorityStage: 'preparation-only' as const, request: body };
  const requestDigest = sha256(content);
  const requestOperationId = sha256({ schema: 'sec-local-qualification-operation-v1',
    requestDigest, purpose: 'verification-only' });
  return parseVerificationSessionLocalPreparationRequestV2(JSON.stringify({ ...content,
    request: { ...body, requestDigest, requestOperationId } }));
}

/** One bounded text boundary for both local envelope versions. Legacy V1
 * field semantics remain unchanged; no unbounded preliminary JSON.parse may
 * run before V2 selection. This returns data, never qualification. */
export function parseLocalPreparationRequestJson(source: string): unknown {
  if (typeof source !== 'string' || source.length > LOCAL_PREPARATION_V2_MAXIMUM_INPUT_BYTES
      || Buffer.byteLength(source, 'utf8') > LOCAL_PREPARATION_V2_MAXIMUM_INPUT_BYTES) {
    throw new Error('Local preparation request exceeds the bounded UTF-8 input size.');
  }
  return parseExactJson(source, 'Local preparation request', undefined, 4);
}

/** Exact bounded JSON decoding, never evidence admission or a Session constructor. */
export function parseVerificationSessionLocalPreparationRequestV2(
  source: string
): VerificationSessionLocalPreparationRequestV2 {
  const value = parseLocalPreparationRequestJson(source);
  assertLocalPreparationExactKeys(value, LOCAL_PREPARATION_V2_ENVELOPE_KEYS, 'envelope');
  if (value.schema !== CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA
      || value.executionPlacement !== 'local' || value.authorityStage !== 'preparation-only') {
    throw new Error('Local preparation V2 request requires the exact local preparation-only envelope.');
  }
  assertLocalPreparationV2Body(value.request, true);
  const request = value.request as VerificationSessionLocalPreparationRequestV2['request'];
  const { requestDigest, requestOperationId, ...body } = request;
  if (requestDigest !== sha256({ schema: value.schema, executionPlacement: value.executionPlacement,
    authorityStage: value.authorityStage, request: body })) {
    throw new Error('Local preparation V2 requestDigest mismatch.');
  }
  if (requestOperationId !== sha256({ schema: 'sec-local-qualification-operation-v1',
    requestDigest, purpose: 'verification-only' })) {
    throw new Error('Local preparation V2 requestOperationId mismatch.');
  }
  return deepFreeze(value as unknown as VerificationSessionLocalPreparationRequestV2);
}

/** Both inputs are independently decoded. Equality preserves pins, not authority. */
export function assertVerificationSessionLocalPreparationV2Current(
  saved: VerificationSessionLocalPreparationRequestV2,
  current: VerificationSessionLocalPreparationRequestV2
): void {
  const parsed = parseVerificationSessionLocalPreparationRequestV2(JSON.stringify(canonicalJson(saved)));
  const prepared = parseVerificationSessionLocalPreparationRequestV2(JSON.stringify(canonicalJson(current)));
  if (!canonicalEquals(parsed, prepared)) {
    throw new Error('Local preparation V2 request differs from current exact source or qualification requirements. Prepare again.');
  }
}

export const CI_VERIFICATION_SESSION_REQUEST_SCHEMA = 'sec-verification-session-hosted-request-v1' as const;

export const VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA =
  'sec-verification-session-hosted-envelope-v1' as const;

export function parseVerificationSessionHostedRequest(
  source: string
): VerificationSessionHostedRequest<typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA> {
  const value = JSON.parse(source) as Record<string, unknown>;
  if (value?.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA
      || value?.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA) {
    throw new Error('Local preparation-only request cannot be consumed by a hosted operation.');
  }
  // The exact legacy schema is hosted-only. It is accepted only at an explicitly
  // selected hosted entry; absence of placement never selects that entry.
  const expected = [
    'schema', 'prNumber', 'expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha',
    'expectedHeadTreeSha', 'manifestPath', 'manifestDigest', 'profile',
    'expectedScopeProposalDigest', 'expectedActionPlanDigest', 'expectedSessionRevision',
    'reviewPolicyDigest', 'requestOperationId'
  ].sort();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hosted request must be an object.');
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Hosted request must contain exactly: ${expected.join(', ')}.`);
  }
  if (value.schema !== CI_VERIFICATION_SESSION_REQUEST_SCHEMA) {
    throw new Error('Hosted request schema mismatch.');
  }
  const shaFields = ['expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha', 'expectedHeadTreeSha'];
  const digestFields = [
    'manifestDigest', 'expectedScopeProposalDigest', 'expectedActionPlanDigest',
    'expectedSessionRevision', 'reviewPolicyDigest', 'requestOperationId'
  ];
  for (const field of shaFields) if (typeof value[field] !== 'string' || !/^[0-9a-f]{40}$/u.test(value[field] as string)) {
    throw new Error(`Hosted request ${field} is invalid.`);
  }
  for (const field of digestFields) if (typeof value[field] !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value[field] as string)) {
    throw new Error(`Hosted request ${field} is invalid.`);
  }
  if (!Number.isSafeInteger(value.prNumber) || (value.prNumber as number) <= 0 ||
      typeof value.manifestPath !== 'string' || typeof value.profile !== 'string') {
    throw new Error('Hosted request scalar identity is invalid.');
  }
  return Object.freeze(value as unknown as VerificationSessionHostedRequest<typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA>);
}
