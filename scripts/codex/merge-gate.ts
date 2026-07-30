import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CodexDevelopmentRegisteredEvidenceCompositionPolicyV1,
  CodexDevelopmentRequiredEvidenceCompositionPolicyV1,
  CodexDevelopmentSm3P0EvidencePolicyIdV1,
  CodexDevelopmentSm3P0LegacyTestedHeadV1,
  CodexDevelopmentSm3P0WorkPackageIdV1
} from '../../platform/shared/ci-evidence-composition-policy-registry.ts';
import {
  CodexDevelopmentAssertVerificationEvidenceV2,
  CodexDevelopmentAssertVerificationEvidenceV3,
  CodexDevelopmentVerificationDigest,
  type CodexDevelopmentVerificationEvidenceV2,
  type CodexDevelopmentVerificationEvidenceV3
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentBuildEvidenceCompositionPlanV1,
  type CodexDevelopmentExactGitBlobBytesV1,
  type CodexDevelopmentExactGitBlobV1
} from '../../platform/shared/ci-evidence-reuse-contract.ts';
import {
  CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
  type CodexDevelopmentCiExecutionEnvironmentBindingV1
} from '../../platform/shared/ci-execution-environment.ts';
import {
  decodeGitPathOutput,
  gitChangedFileDiffArgs,
  parseGitChangedRecordsOutput,
  type CodexDevelopmentGitChangedRecordV1
} from '../../platform/shared/ci-git-changed-files.ts';
import {
  CI_VERIFICATION_ARTIFACT_NAMESPACE,
  CI_VERIFICATION_CONTRACT_REVISION,
  CodexDevelopmentBuildVerificationInputV2,
  CodexDevelopmentBuildVerificationPlanV1,
  CodexDevelopmentCanonicalChangedFilesV1
} from '../../platform/shared/ci-verification-plan.ts';
import { CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION } from '../../platform/shared/ci-verification-revision.ts';
import { isTestFile } from '../../platform/shared/test-budget-contract.ts';
import { CodexDevelopmentBuildVerificationScopeInventoryV1 } from '../../platform/shared/verification-scope-inventory.ts';
import {
  CodexDevelopmentAssertWorkPackageChangedRecords,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest,
  CodexDevelopmentWorkPackageSchemaV1,
  CodexDevelopmentWorkPackageSchemaV2,
  type CodexDevelopmentWorkPackageChangedRecordV1,
  type CodexDevelopmentWorkPackageManifest
} from './work-package-contract.ts';

export const CodexDevelopmentScopeAttestationSchemaV1 = 'codex-development-scope-attestation-v1' as const;
export const CodexDevelopmentScopeAttestationRequestSchemaV1 = 'codex-development-scope-attestation-request-v1' as const;
export const CodexDevelopmentMergeGateInputSchemaV1 = 'codex-development-merge-gate-input-v1' as const;
export const CodexDevelopmentScopeAttestationFileV1 = 'codex-development-scope-attestation-v1.json' as const;
export const CodexDevelopmentVerificationEvidenceFileV2 = 'ci-verification-evidence.json' as const;
export const CodexDevelopmentArtifactSafetyWindowMs = 24 * 60 * 60 * 1_000;

export const CodexDevelopmentTrustRootPathsV1 = [
  '.github/workflows/',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.npmrc',
  '.shared-deps/',
  'bun.lock',
  'bunfig.toml',
  'docs/scripts/docs-doctor-ledgers.ts',
  'docs/scripts/docs-doctor-shared.ts',
  'docs/scripts/docs-doctor.ts',
  'node_modules/',
  'package.json',
  'platform/dev-runner.ts',
  'platform/dev-runner/',
  'platform/shared/active-documentation-contract.ts',
  'platform/shared/affected-test-inventory.ts',
  'platform/shared/bun-runtime-version.ts',
  'platform/shared/ci-artifact-contract.ts',
  'platform/shared/ci-artifact-types.ts',
  'platform/shared/ci-contract.ts',
  'platform/shared/ci-evidence-composition-policy-registry.ts',
  'platform/shared/ci-evidence-contract.ts',
  'platform/shared/ci-evidence-reuse-contract.ts',
  'platform/shared/ci-execution-environment.ts',
  'platform/shared/ci-git-changed-files.ts',
  'platform/shared/ci-pr-risk-selection.ts',
  'platform/shared/ci-verification-plan.ts',
  'platform/shared/ci-verification-revision.ts',
  'platform/shared/collections.ts',
  'platform/shared/constants.ts',
  'platform/shared/contract-freeze-contract.ts',
  'platform/shared/documentation-authority-contract.ts',
  'platform/shared/errors.ts',
  'platform/shared/fs.ts',
  'platform/shared/heavy-verification-gate-lease.ts',
  'platform/shared/paths.ts',
  'platform/shared/platform-command.ts',
  'platform/shared/process.ts',
  'platform/shared/project-runtime.ts',
  'platform/shared/repository-path-contract.ts',
  'platform/shared/runtime-dependency-spec.ts',
  'platform/shared/runtime-layout.ts',
  'platform/shared/test-budget-contract.ts',
  'platform/shared/test-impact-contract.ts',
  'platform/shared/test-ownership-contract.ts',
  'platform/shared/test-impact-rules/',
  'platform/shared/verification-scope-inventory.ts',
  'platform/shared/workspace-path-contract.ts',
  'scripts/ci-pr-risk.ts',
  'scripts/ci-verification.ts',
  'scripts/ci-workspace-fast.ts',
  'scripts/codex/',
  'scripts/install-git-hooks.ts',
  'tests/setup/runtime-deps.setup.ts',
  'tests/testkit/',
  'tsconfig.json'
] as const;
export const CodexDevelopmentTrustRootPathPrefixesV1 = ['.env'] as const;

type CodexDevelopmentRepositoryPermission = 'read' | 'triage' | 'write' | 'maintain' | 'admin';

export type CodexDevelopmentScopeAttestationRequestV1 = {
  schema: typeof CodexDevelopmentScopeAttestationRequestSchemaV1;
  repository: string;
  repositoryId: number;
  pullRequest: number;
  defaultBranch: string;
  currentBase: string;
  exactHead: string;
  baseRepoId: number;
  headRepoId: number;
  manifestPath: string;
  expectedManifestDigest: string;
  expectedManifestBlobSha: string;
  expectedManifestByteLength: number;
  eventName: 'repository_dispatch';
  eventType: 'sec-scope-attest-v1';
  workflowId: number;
  workflowPath: '.github/workflows/sec-merge-gate.yml';
  workflowHeadSha: string;
  runId: number;
  runAttempt: number;
  actor: string;
  triggeringActor: string;
  actorPermission: CodexDevelopmentRepositoryPermission;
  triggeringActorPermission: CodexDevelopmentRepositoryPermission;
};

export type CodexDevelopmentScopeAttestationV1 = {
  schema: typeof CodexDevelopmentScopeAttestationSchemaV1;
  repository: string;
  repositoryId: number;
  pullRequest: number;
  defaultBranch: string;
  currentBase: string;
  exactHead: string;
  manifestPath: string;
  manifestDigest: string;
  manifestBlobSha: string;
  manifestByteLength: number;
  requiredProfile: 'quick' | 'full';
  ciRevision:
    | typeof CI_VERIFICATION_CONTRACT_REVISION
    | typeof CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION;
  workflowId: number;
  workflowPath: '.github/workflows/sec-merge-gate.yml';
  runId: number;
  runAttempt: number;
  actor: string;
  triggeringActor: string;
};

type CodexDevelopmentWorkflowRunV1 = {
  workflowId: number;
  workflowPath: string;
  runId: number;
  runAttempt: number;
  event: string;
  headSha: string;
  headBranch: string;
  conclusion: string;
  actor: string;
  triggeringActor: string;
  actorPermission: CodexDevelopmentRepositoryPermission;
  triggeringActorPermission: CodexDevelopmentRepositoryPermission;
};

type CodexDevelopmentArtifactMetadataV1 = {
  id: number;
  name: string;
  digest: string | null;
  expired: boolean;
  expiresAt: string;
  sizeInBytes: number;
  run: CodexDevelopmentWorkflowRunV1;
};

export type CodexDevelopmentMergeGateInputV1 = {
  schema: typeof CodexDevelopmentMergeGateInputSchemaV1;
  repository: string;
  repositoryId: number;
  pullRequest: number;
  body: string;
  draft: boolean;
  defaultBranch: string;
  baseRepoId: number;
  headRepoId: number;
  currentBase: string;
  exactHead: string;
  headTree: string;
  headParents: string[];
  aheadBy: number;
  behindBy: number;
  headOpenPullRequestCount: number;
  manifestPath: string;
  manifestBlobSha: string;
  manifestByteLength: number;
  changedRecords: CodexDevelopmentWorkPackageChangedRecordV1[];
  checkedAt: string;
  attestationWorkflowId: number;
  verificationWorkflowId: number;
  attestationArtifact: CodexDevelopmentArtifactMetadataV1;
  verificationArtifact: CodexDevelopmentArtifactMetadataV1;
};

export type CodexDevelopmentMergeGateResultV1 = {
  status: 'passed';
  context: 'sec/merge-gate';
  pullRequest: number;
  exactHead: string;
  currentBase: string;
  manifestPath: string;
  manifestDigest: string;
  requiredProfile: 'quick' | 'full';
  evidenceDigest: string;
};

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ATTESTATION_REQUEST_KEYS = [
  'schema', 'repository', 'repositoryId', 'pullRequest', 'defaultBranch', 'currentBase', 'exactHead', 'baseRepoId',
  'headRepoId', 'manifestPath', 'expectedManifestDigest', 'expectedManifestBlobSha', 'expectedManifestByteLength',
  'eventName', 'eventType', 'workflowId', 'workflowPath',
  'workflowHeadSha', 'runId', 'runAttempt', 'actor', 'triggeringActor', 'actorPermission', 'triggeringActorPermission'
];
const ATTESTATION_KEYS = [
  'schema', 'repository', 'repositoryId', 'pullRequest', 'defaultBranch', 'currentBase', 'exactHead', 'manifestPath',
  'manifestDigest', 'manifestBlobSha', 'manifestByteLength', 'requiredProfile', 'ciRevision', 'workflowId', 'workflowPath', 'runId',
  'runAttempt', 'actor', 'triggeringActor'
];
const RUN_KEYS = [
  'workflowId', 'workflowPath', 'runId', 'runAttempt', 'event', 'headSha', 'headBranch', 'conclusion', 'actor',
  'triggeringActor', 'actorPermission', 'triggeringActorPermission'
];
const ARTIFACT_KEYS = ['id', 'name', 'digest', 'expired', 'expiresAt', 'sizeInBytes', 'run'];
const GATE_INPUT_KEYS = [
  'schema', 'repository', 'repositoryId', 'pullRequest', 'body', 'draft', 'defaultBranch', 'baseRepoId', 'headRepoId',
  'currentBase', 'exactHead', 'headTree', 'headParents', 'aheadBy', 'behindBy', 'headOpenPullRequestCount',
  'manifestPath', 'manifestBlobSha', 'manifestByteLength', 'changedRecords', 'checkedAt',
  'attestationWorkflowId', 'verificationWorkflowId',
  'attestationArtifact', 'verificationArtifact'
];

function manifestVerificationBinding(manifest: CodexDevelopmentWorkPackageManifest): {
  requiredProfile: 'quick' | 'full';
  ciRevision:
    | typeof CI_VERIFICATION_CONTRACT_REVISION
    | typeof CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION;
} {
  if (manifest.schema === CodexDevelopmentWorkPackageSchemaV1) {
    if (manifest.ciRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
      throw new Error('Work Package manifest CI revision is not current for V1.');
    }
    return { requiredProfile: manifest.requiredProfile, ciRevision: manifest.ciRevision };
  }
  if (
    manifest.schema !== CodexDevelopmentWorkPackageSchemaV2
    || manifest.id !== CodexDevelopmentSm3P0WorkPackageIdV1
    || manifest.evidenceComposition.policyId !== CodexDevelopmentSm3P0EvidencePolicyIdV1
  ) {
    throw new Error('Work Package V2 manifest does not select a base-registered composition policy.');
  }
  return { requiredProfile: 'quick', ciRevision: CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION };
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function assertString(value: unknown, label: string, maximum = 4_096): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.includes('\0')
    || value.normalize('NFC') !== value
  ) {
    throw new Error(`${label} must be bounded NFC text without NUL characters.`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer.`);
}

function assertSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) throw new Error(`${label} must be a lowercase Git SHA.`);
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw new Error(`${label} must be a sha256 digest.`);
}

function assertPermission(value: unknown, label: string): asserts value is CodexDevelopmentRepositoryPermission {
  if (!['read', 'triage', 'write', 'maintain', 'admin'].includes(String(value))) throw new Error(`${label} is invalid.`);
}

function trustedPermission(permission: CodexDevelopmentRepositoryPermission): boolean {
  return permission === 'maintain' || permission === 'admin';
}

function strictJson<T>(source: string, label: string): T {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (JSON.stringify(value) !== source) throw new Error(`${label} must use canonical compact JSON bytes.`);
  return value as T;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be strict UTF-8.`);
  }
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

function readSingleCanonicalJsonArtifact(directory: string, expectedFile: string): unknown {
  const absoluteDirectory = path.resolve(directory);
  const directoryStat = lstatSync(absoluteDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Artifact extraction root must be a real directory.');
  const entries = readdirSync(absoluteDirectory, { withFileTypes: true });
  if (entries.length !== 1) throw new Error(`Artifact directory must contain exactly one entry; found ${entries.length}.`);
  const entry = entries[0]!;
  if (entry.name !== expectedFile || !entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Artifact must contain one regular ${expectedFile} file.`);
  }
  const filePath = path.join(absoluteDirectory, entry.name);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 1_048_576) {
    throw new Error('Artifact JSON file type or size is invalid.');
  }
  return strictJson(decodeUtf8(readFileSync(filePath), `artifact ${expectedFile}`), `artifact ${expectedFile}`);
}

function readManifestBytes(filePath: string): Uint8Array {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 1_048_576) {
    throw new Error('Work Package manifest must be one bounded regular file.');
  }
  return readFileSync(filePath);
}

function validateAttestationRequest(value: unknown): CodexDevelopmentScopeAttestationRequestV1 {
  assertObject(value, 'scope attestation request');
  assertExactKeys(value, ATTESTATION_REQUEST_KEYS, 'scope attestation request');
  if (value.schema !== CodexDevelopmentScopeAttestationRequestSchemaV1) throw new Error('Scope attestation request schema mismatch.');
  assertString(value.repository, 'scope attestation request repository');
  assertPositiveInteger(value.repositoryId, 'scope attestation request repositoryId');
  assertPositiveInteger(value.pullRequest, 'scope attestation request pullRequest');
  assertString(value.defaultBranch, 'scope attestation request defaultBranch');
  assertSha(value.currentBase, 'scope attestation request currentBase');
  assertSha(value.exactHead, 'scope attestation request exactHead');
  assertPositiveInteger(value.baseRepoId, 'scope attestation request baseRepoId');
  assertPositiveInteger(value.headRepoId, 'scope attestation request headRepoId');
  assertString(value.manifestPath, 'scope attestation request manifestPath');
  assertDigest(value.expectedManifestDigest, 'scope attestation request expectedManifestDigest');
  assertSha(value.expectedManifestBlobSha, 'scope attestation request expectedManifestBlobSha');
  assertPositiveInteger(value.expectedManifestByteLength, 'scope attestation request expectedManifestByteLength');
  if (value.eventName !== 'repository_dispatch' || value.eventType !== 'sec-scope-attest-v1') {
    throw new Error('Scope attestation must originate from sec-scope-attest-v1 repository_dispatch.');
  }
  assertPositiveInteger(value.workflowId, 'scope attestation request workflowId');
  if (value.workflowPath !== '.github/workflows/sec-merge-gate.yml') throw new Error('Scope attestation workflow path mismatch.');
  assertSha(value.workflowHeadSha, 'scope attestation request workflowHeadSha');
  assertPositiveInteger(value.runId, 'scope attestation request runId');
  assertPositiveInteger(value.runAttempt, 'scope attestation request runAttempt');
  assertString(value.actor, 'scope attestation request actor');
  assertString(value.triggeringActor, 'scope attestation request triggeringActor');
  assertPermission(value.actorPermission, 'scope attestation request actorPermission');
  assertPermission(value.triggeringActorPermission, 'scope attestation request triggeringActorPermission');
  return value as CodexDevelopmentScopeAttestationRequestV1;
}

export function CodexDevelopmentBuildScopeAttestationV1(
  rawRequest: unknown,
  manifestBytes: Uint8Array
): CodexDevelopmentScopeAttestationV1 {
  const request = validateAttestationRequest(rawRequest);
  if (request.baseRepoId !== request.repositoryId || request.headRepoId !== request.repositoryId) {
    throw new Error('Scope attestation only supports same-repository pull requests.');
  }
  if (request.workflowHeadSha !== request.currentBase) throw new Error('Scope attestation workflow did not run from current base code.');
  if (!trustedPermission(request.actorPermission) || !trustedPermission(request.triggeringActorPermission)) {
    throw new Error('Scope attestation requires maintain or admin actor and triggering actor permissions.');
  }
  const manifestSource = decodeUtf8(manifestBytes, 'Work Package manifest');
  const manifest = CodexDevelopmentParseWorkPackageManifest(manifestSource, request.manifestPath);
  const verificationBinding = manifestVerificationBinding(manifest);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes);
  const manifestBlobSha = gitBlobSha(manifestBytes);
  if (
    manifest.base !== request.currentBase
    || manifestDigest !== request.expectedManifestDigest
    || manifestBlobSha !== request.expectedManifestBlobSha
    || manifestBytes.byteLength !== request.expectedManifestByteLength
  ) {
    throw new Error('Scope attestation manifest/base expectation mismatch.');
  }
  return {
    schema: CodexDevelopmentScopeAttestationSchemaV1,
    repository: request.repository,
    repositoryId: request.repositoryId,
    pullRequest: request.pullRequest,
    defaultBranch: request.defaultBranch,
    currentBase: request.currentBase,
    exactHead: request.exactHead,
    manifestPath: request.manifestPath,
    manifestDigest,
    manifestBlobSha,
    manifestByteLength: manifestBytes.byteLength,
    requiredProfile: verificationBinding.requiredProfile,
    ciRevision: verificationBinding.ciRevision,
    workflowId: request.workflowId,
    workflowPath: request.workflowPath,
    runId: request.runId,
    runAttempt: request.runAttempt,
    actor: request.actor,
    triggeringActor: request.triggeringActor
  };
}

function validateRun(value: unknown, label: string): CodexDevelopmentWorkflowRunV1 {
  assertObject(value, label);
  assertExactKeys(value, RUN_KEYS, label);
  for (const key of ['workflowId', 'runId', 'runAttempt'] as const) assertPositiveInteger(value[key], `${label}.${key}`);
  for (const key of ['workflowPath', 'event', 'headBranch', 'conclusion', 'actor', 'triggeringActor'] as const) {
    assertString(value[key], `${label}.${key}`);
  }
  assertSha(value.headSha, `${label}.headSha`);
  assertPermission(value.actorPermission, `${label}.actorPermission`);
  assertPermission(value.triggeringActorPermission, `${label}.triggeringActorPermission`);
  return value as CodexDevelopmentWorkflowRunV1;
}

function validateArtifact(value: unknown, label: string, checkedAt: Date): CodexDevelopmentArtifactMetadataV1 {
  assertObject(value, label);
  assertExactKeys(value, ARTIFACT_KEYS, label);
  assertPositiveInteger(value.id, `${label}.id`);
  assertString(value.name, `${label}.name`);
  assertDigest(value.digest, `${label}.digest`);
  if (value.expired !== false) throw new Error(`${label} is expired.`);
  assertString(value.expiresAt, `${label}.expiresAt`);
  const expiresAt = new Date(value.expiresAt);
  if (
    !Number.isFinite(expiresAt.getTime())
    || expiresAt.toISOString() !== value.expiresAt
    || expiresAt.getTime() - checkedAt.getTime() < CodexDevelopmentArtifactSafetyWindowMs
  ) {
    throw new Error(`${label} is inside the 24-hour safety window.`);
  }
  assertPositiveInteger(value.sizeInBytes, `${label}.sizeInBytes`);
  if ((value.sizeInBytes as number) > 5_242_880) throw new Error(`${label}.sizeInBytes exceeds the V1 limit.`);
  const run = validateRun(value.run, `${label}.run`);
  return { ...value, run } as CodexDevelopmentArtifactMetadataV1;
}

function trustRootMatch(changedPath: string): string | null {
  return CodexDevelopmentTrustRootPathsV1.find((trustedPath) => (
    trustedPath.endsWith('/') ? changedPath.startsWith(trustedPath) : changedPath === trustedPath
  )) ?? CodexDevelopmentTrustRootPathPrefixesV1.find((prefix) => changedPath.startsWith(prefix)) ?? null;
}

function changedRecordPaths(record: CodexDevelopmentWorkPackageChangedRecordV1): string[] {
  return record.previousPath === undefined ? [record.path] : [record.previousPath, record.path];
}

function canonicalChangedRecords(
  records: readonly CodexDevelopmentGitChangedRecordV1[]
): CodexDevelopmentGitChangedRecordV1[] {
  return records.map((record) => ({
    status: record.status,
    path: record.path,
    ...(record.previousPath === undefined ? {} : { previousPath: record.previousPath })
  })).sort((left, right) => {
    const leftKey = `${left.previousPath ?? ''}\0${left.path}\0${left.status}`;
    const rightKey = `${right.previousPath ?? ''}\0${right.path}\0${right.status}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function validateAttestation(value: unknown): CodexDevelopmentScopeAttestationV1 {
  assertObject(value, 'scope attestation');
  assertExactKeys(value, ATTESTATION_KEYS, 'scope attestation');
  if (value.schema !== CodexDevelopmentScopeAttestationSchemaV1) throw new Error('Scope attestation schema mismatch.');
  for (const key of ['repository', 'defaultBranch', 'manifestPath', 'workflowPath', 'actor', 'triggeringActor'] as const) {
    assertString(value[key], `scope attestation ${key}`);
  }
  for (const key of ['repositoryId', 'pullRequest', 'manifestByteLength', 'workflowId', 'runId', 'runAttempt'] as const) {
    assertPositiveInteger(value[key], `scope attestation ${key}`);
  }
  assertSha(value.currentBase, 'scope attestation currentBase');
  assertSha(value.exactHead, 'scope attestation exactHead');
  assertDigest(value.manifestDigest, 'scope attestation manifestDigest');
  assertSha(value.manifestBlobSha, 'scope attestation manifestBlobSha');
  if (value.requiredProfile !== 'quick' && value.requiredProfile !== 'full') throw new Error('Scope attestation requiredProfile is invalid.');
  if (
    value.ciRevision !== CI_VERIFICATION_CONTRACT_REVISION
    && value.ciRevision !== CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION
  ) throw new Error('Scope attestation CI revision mismatch.');
  return value as CodexDevelopmentScopeAttestationV1;
}

function validateGateInput(value: unknown): CodexDevelopmentMergeGateInputV1 {
  assertObject(value, 'merge gate input');
  assertExactKeys(value, GATE_INPUT_KEYS, 'merge gate input');
  if (value.schema !== CodexDevelopmentMergeGateInputSchemaV1) throw new Error('Merge gate input schema mismatch.');
  for (const key of ['repository', 'body', 'defaultBranch', 'manifestPath', 'checkedAt'] as const) {
    assertString(value[key], `merge gate input ${key}`, key === 'body' ? 65_536 : 4_096);
  }
  for (const key of [
    'repositoryId', 'pullRequest', 'baseRepoId', 'headRepoId', 'headOpenPullRequestCount',
    'attestationWorkflowId', 'verificationWorkflowId'
  ] as const) assertPositiveInteger(value[key], `merge gate input ${key}`);
  for (const key of ['currentBase', 'exactHead', 'headTree'] as const) assertSha(value[key], `merge gate input ${key}`);
  assertSha(value.manifestBlobSha, 'merge gate input manifestBlobSha');
  assertPositiveInteger(value.manifestByteLength, 'merge gate input manifestByteLength');
  if (value.draft !== false && value.draft !== true) throw new Error('Merge gate input draft must be boolean.');
  if (!Number.isSafeInteger(value.aheadBy) || !Number.isSafeInteger(value.behindBy)) throw new Error('Merge gate comparison counts are invalid.');
  if (!Array.isArray(value.headParents) || value.headParents.length > 2) throw new Error('Merge gate headParents is invalid.');
  value.headParents.forEach((entry) => assertSha(entry, 'merge gate head parent'));
  if (!Array.isArray(value.changedRecords) || value.changedRecords.length === 0 || value.changedRecords.length > 3_000) {
    throw new Error('Merge gate changedRecords must be non-empty and bounded.');
  }
  const checkedAt = new Date(value.checkedAt as string);
  if (!Number.isFinite(checkedAt.getTime()) || checkedAt.toISOString() !== value.checkedAt) {
    throw new Error('Merge gate checkedAt must be canonical ISO time.');
  }
  const attestationArtifact = validateArtifact(value.attestationArtifact, 'attestation artifact', checkedAt);
  const verificationArtifact = validateArtifact(value.verificationArtifact, 'verification artifact', checkedAt);
  return { ...value, attestationArtifact, verificationArtifact } as CodexDevelopmentMergeGateInputV1;
}

export function CodexDevelopmentEvaluateMergeGateV1(options: {
  rawInput: unknown;
  manifestBytes: Uint8Array;
  rawAttestation: unknown;
  rawEvidence: unknown;
  runtime?: string;
  changedRecords?: (
    baseHead: string,
    currentHead: string
  ) => CodexDevelopmentGitChangedRecordV1[] | null;
  gitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
  readGitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobBytesV1 | null;
  gitFiles?: (ref: string, prefix: string) => string[] | null;
  gitTree?: (ref: string) => string | null;
}): CodexDevelopmentMergeGateResultV1 {
  const input = validateGateInput(options.rawInput);
  if (input.draft) throw new Error('Draft pull requests cannot pass sec/merge-gate.');
  if (input.baseRepoId !== input.repositoryId || input.headRepoId !== input.repositoryId) {
    throw new Error('sec/merge-gate only supports same-repository pull requests.');
  }
  if (input.headOpenPullRequestCount !== 1) {
    throw new Error('Exact head SHA must belong to exactly one open pull request.');
  }
  if (
    input.aheadBy !== 1
    || input.behindBy !== 0
    || input.headParents.length !== 1
    || input.headParents[0] !== input.currentBase
  ) {
    throw new Error('Frozen verification requires one exact head commit whose only parent is current base.');
  }
  if (CodexDevelopmentParseWorkPackageLocator(input.body) !== input.manifestPath) {
    throw new Error('PR body Work Package locator does not match merge gate input.');
  }
  const manifestSource = decodeUtf8(options.manifestBytes, 'Work Package manifest');
  const manifest = CodexDevelopmentParseWorkPackageManifest(manifestSource, input.manifestPath);
  const verificationBinding = manifestVerificationBinding(manifest);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(options.manifestBytes);
  const manifestBlobSha = gitBlobSha(options.manifestBytes);
  if (
    input.manifestBlobSha !== manifestBlobSha
    || input.manifestByteLength !== options.manifestBytes.byteLength
  ) throw new Error('Work Package manifest blob identity or byte length mismatch.');
  if (manifest.base !== input.currentBase) throw new Error('Work Package manifest base is not current base.');
  const independentlyResolvedRecords = options.changedRecords?.(input.currentBase, input.exactHead) ?? null;
  if (options.changedRecords && independentlyResolvedRecords === null) {
    throw new Error('Merge gate cannot independently resolve the exact candidate changed records.');
  }
  const effectiveChangedRecords = independentlyResolvedRecords ?? input.changedRecords;
  if (
    independentlyResolvedRecords
    && JSON.stringify(canonicalChangedRecords(independentlyResolvedRecords))
      !== JSON.stringify(canonicalChangedRecords(input.changedRecords))
  ) throw new Error('Merge gate API and exact Git changed records disagree.');
  const requiredPolicyId = options.gitBlob
    ? CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
      records: effectiveChangedRecords,
      baseHead: input.currentBase,
      currentHead: input.exactHead,
      gitBlob: options.gitBlob
    })
    : null;
  if (requiredPolicyId !== null && (
    manifest.schema !== CodexDevelopmentWorkPackageSchemaV2
    || manifest.id !== CodexDevelopmentSm3P0WorkPackageIdV1
    || manifest.evidenceComposition.policyId !== requiredPolicyId
  )) throw new Error(`Protected SM3 P0 inputs require Work Package V2 policy ${requiredPolicyId}.`);
  for (const record of effectiveChangedRecords) {
    for (const changedPath of changedRecordPaths(record)) {
      const trustRoot = trustRootMatch(changedPath);
      if (trustRoot) throw new Error(`manual-bootstrap-required: changed verifier trust root ${trustRoot}.`);
    }
  }
  CodexDevelopmentAssertWorkPackageChangedRecords(manifest, effectiveChangedRecords);

  const attestationRun = input.attestationArtifact.run;
  if (
    attestationRun.workflowId !== input.attestationWorkflowId
    || attestationRun.workflowPath !== '.github/workflows/sec-merge-gate.yml'
    || attestationRun.event !== 'repository_dispatch'
    || attestationRun.headSha !== input.currentBase
    || attestationRun.headBranch !== input.defaultBranch
    || attestationRun.conclusion !== 'success'
    || !trustedPermission(attestationRun.actorPermission)
    || !trustedPermission(attestationRun.triggeringActorPermission)
  ) {
    throw new Error('Scope attestation workflow run is not trusted current-base evidence.');
  }
  const expectedAttestationName = [
    'sec-scope-attestation-v1',
    `pr-${input.pullRequest}`,
    `base-${input.currentBase}`,
    `head-${input.exactHead}`,
    `manifest-${manifestDigest.slice('sha256:'.length)}`,
    `run-${attestationRun.runId}`,
    `attempt-${attestationRun.runAttempt}`
  ].join('-');
  if (input.attestationArtifact.name !== expectedAttestationName) throw new Error('Scope attestation artifact name/key mismatch.');
  const attestation = validateAttestation(options.rawAttestation);
  const expectedAttestation: CodexDevelopmentScopeAttestationV1 = {
    schema: CodexDevelopmentScopeAttestationSchemaV1,
    repository: input.repository,
    repositoryId: input.repositoryId,
    pullRequest: input.pullRequest,
    defaultBranch: input.defaultBranch,
    currentBase: input.currentBase,
    exactHead: input.exactHead,
    manifestPath: input.manifestPath,
    manifestDigest,
    manifestBlobSha,
    manifestByteLength: options.manifestBytes.byteLength,
    requiredProfile: verificationBinding.requiredProfile,
    ciRevision: verificationBinding.ciRevision,
    workflowId: attestationRun.workflowId,
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    runId: attestationRun.runId,
    runAttempt: attestationRun.runAttempt,
    actor: attestationRun.actor,
    triggeringActor: attestationRun.triggeringActor
  };
  if (JSON.stringify(attestation) !== JSON.stringify(expectedAttestation)) {
    throw new Error('Scope attestation payload does not match live PR/base/head/manifest/run data.');
  }

  const verificationRun = input.verificationArtifact.run;
  if (
    verificationRun.workflowId !== input.verificationWorkflowId
    || verificationRun.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
    || verificationRun.event !== 'repository_dispatch'
    || verificationRun.headSha !== input.currentBase
    || verificationRun.headBranch !== input.defaultBranch
    || verificationRun.conclusion !== 'success'
    || !trustedPermission(verificationRun.actorPermission)
    || !trustedPermission(verificationRun.triggeringActorPermission)
  ) {
    throw new Error('Verification workflow run is not exact-head trusted evidence.');
  }
  const expectedVerificationName = [
    CI_VERIFICATION_ARTIFACT_NAMESPACE,
    verificationBinding.requiredProfile,
    `pr-${input.pullRequest}`,
    `base-${input.currentBase}`,
    `head-${input.exactHead}`,
    `run-${verificationRun.runId}`,
    `attempt-${verificationRun.runAttempt}`
  ].join('-');
  if (input.verificationArtifact.name !== expectedVerificationName) throw new Error('Verification artifact name/key mismatch.');
  const expectedChangedFiles = CodexDevelopmentCanonicalChangedFilesV1(
    effectiveChangedRecords.flatMap(changedRecordPaths)
  );
  let evidence: CodexDevelopmentVerificationEvidenceV2 | CodexDevelopmentVerificationEvidenceV3;
  if (manifest.schema === CodexDevelopmentWorkPackageSchemaV1) {
    CodexDevelopmentAssertVerificationEvidenceV2(options.rawEvidence, {
      kind: 'verification',
      profile: manifest.requiredProfile,
      headSha: input.exactHead,
      treeSha: input.headTree,
      prBaseSha: input.currentBase,
      affectedBaseSha: input.currentBase,
      manifestPath: input.manifestPath,
      manifestDigest
    }, new Date(input.checkedAt));
    evidence = options.rawEvidence;
    if (evidence.status !== 'passed') throw new Error('Verification evidence did not pass.');
    const expectedPlan = CodexDevelopmentBuildVerificationPlanV1(manifest.requiredProfile, expectedChangedFiles);
    if (!expectedPlan.selectionResolved || expectedPlan.gates.length === 0) {
      throw new Error('Base-side canonical verification plan is unresolved or empty.');
    }
    if (JSON.stringify(evidence.changedFiles) !== JSON.stringify(expectedPlan.changedFiles)) {
      throw new Error('Verification evidence changedFiles do not match the complete live changed-path set.');
    }
    const expectedGates = expectedPlan.gates.map((step) => ({ id: step.id, argv: ['bun', ...step.args] }));
    const actualGates = evidence.gates.map((gate) => ({ id: gate.id, argv: gate.argv }));
    if (JSON.stringify(actualGates) !== JSON.stringify(expectedGates)) {
      throw new Error('Verification evidence gate count, order, IDs, or argv do not match the canonical plan.');
    }
    const expectedInputDigest = CodexDevelopmentVerificationDigest(CodexDevelopmentBuildVerificationInputV2({
      profile: manifest.requiredProfile,
      headSha: input.exactHead,
      treeSha: input.headTree,
      prBaseSha: input.currentBase,
      affectedBaseSha: input.currentBase,
      manifestPath: input.manifestPath,
      manifestDigest,
      changedFiles: expectedPlan.changedFiles,
      selectionResolved: expectedPlan.selectionResolved,
      gates: expectedPlan.gates
    }));
    if (evidence.inputDigest !== expectedInputDigest) {
      throw new Error('Verification evidence inputDigest does not match the base-side canonical plan.');
    }
  } else {
    if (!options.gitBlob || !options.readGitBlob || !options.gitFiles || !options.gitTree || !options.changedRecords) {
      throw new Error('Composition contract requires independent exact candidate Git resolvers.');
    }
    CodexDevelopmentAssertVerificationEvidenceV3(options.rawEvidence, {
      profile: 'quick',
      policyId: manifest.evidenceComposition.policyId,
      workPackageId: manifest.id,
      headSha: input.exactHead,
      treeSha: input.headTree,
      prBaseSha: input.currentBase,
      affectedBaseSha: input.currentBase,
      manifestPath: input.manifestPath,
      manifestDigest
    }, new Date(input.checkedAt));
    const preliminaryEvidence = options.rawEvidence;
    if (preliminaryEvidence.status !== 'passed') throw new Error('Verification V3 evidence did not pass.');
    const testFiles = options.gitFiles(input.exactHead, 'tests');
    if (!testFiles) throw new Error('Merge gate cannot enumerate exact-head test files.');
    const testImpactSourceProvider = {
      testFiles: testFiles.filter(isTestFile),
      readTestSource: (testFile: string): string | null => {
        const entry = options.readGitBlob!(input.exactHead, testFile);
        if (!entry) throw new Error(`Merge gate cannot read exact-head test source: ${testFile}.`);
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
        } catch (error) {
          throw new Error(`Merge gate exact-head test source is not UTF-8: ${testFile}.`, { cause: error });
        }
      }
    };
    const runtime = options.runtime ?? `bun@${Bun.version}`;
    const inventory = CodexDevelopmentBuildVerificationScopeInventoryV1({
      profile: 'quick',
      changedFiles: expectedChangedFiles,
      runtime,
      currentHead: input.exactHead,
      baseHead: input.currentBase,
      changedRecords: effectiveChangedRecords,
      gitBlob: options.gitBlob,
      testImpactSourceProvider
    });
    const gateEnvironmentBindings: Record<string, CodexDevelopmentCiExecutionEnvironmentBindingV1> =
      Object.fromEntries(preliminaryEvidence.gates.map((gate) => {
        if (gate.envAllowlistRevision !== CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1) {
          throw new Error(`Verification V3 gate ${gate.id} environment allowlist revision mismatch.`);
        }
        return [gate.id, {
          allowlistRevision: CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
          digest: gate.envDigest
        }];
      }));
    const expectedPlan = CodexDevelopmentBuildEvidenceCompositionPlanV1({
      policyId: manifest.evidenceComposition.policyId,
      workPackageId: manifest.id,
      ciRevision: CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION,
      profile: 'quick',
      inventory,
      runtime,
      currentHead: input.exactHead,
      currentTree: input.headTree,
      gitBlob: options.gitBlob,
      gitTree: options.gitTree,
      readEvidence: options.readGitBlob,
      gateEnvironmentBindings,
      resolvePolicy: (policyId) => CodexDevelopmentRegisteredEvidenceCompositionPolicyV1({
        policyId,
        workPackageId: manifest.id,
        inventory,
        runtime,
        currentHead: input.exactHead,
        gitBlob: options.gitBlob!
      })
    });
    CodexDevelopmentAssertVerificationEvidenceV3(preliminaryEvidence, {
      profile: 'quick',
      policyId: manifest.evidenceComposition.policyId,
      workPackageId: manifest.id,
      headSha: input.exactHead,
      treeSha: input.headTree,
      prBaseSha: input.currentBase,
      affectedBaseSha: input.currentBase,
      manifestPath: input.manifestPath,
      manifestDigest,
      plan: expectedPlan
    }, new Date(input.checkedAt));
    evidence = preliminaryEvidence;
  }
  return {
    status: 'passed',
    context: 'sec/merge-gate',
    pullRequest: input.pullRequest,
    exactHead: input.exactHead,
    currentBase: input.currentBase,
    manifestPath: input.manifestPath,
    manifestDigest,
    requiredProfile: verificationBinding.requiredProfile,
    evidenceDigest: evidence.evidenceDigest
  };
}

function mergeGateGitResolvers(candidateGitDir: string, legacyGitDir: string): {
  changedRecords: (baseHead: string, currentHead: string) => CodexDevelopmentGitChangedRecordV1[] | null;
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
  readGitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobBytesV1 | null;
  gitFiles: (ref: string, prefix: string) => string[] | null;
  gitTree: (ref: string) => string | null;
} {
  const candidate = path.resolve(candidateGitDir);
  const legacy = path.resolve(legacyGitDir);
  const gitDirectory = (ref: string): string => (
    ref === CodexDevelopmentSm3P0LegacyTestedHeadV1 ? legacy : candidate
  );
  const run = (
    gitDir: string,
    args: string[],
    encoding: 'utf8' | 'buffer',
    maxBuffer = 16 * 1024 * 1024
  ) => spawnSync('git', ['--git-dir', gitDir, ...args], { encoding, maxBuffer });
  const gitBlob = (ref: string, file: string): CodexDevelopmentExactGitBlobV1 | null => {
    const result = run(gitDirectory(ref), ['ls-tree', '-z', '--full-tree', ref, '--', file], 'buffer', 1_048_576);
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
    let output: string;
    try {
      output = decodeGitPathOutput(result.stdout, 'tree-path');
    } catch {
      return null;
    }
    if (!output.endsWith('\0')) return null;
    const entries = output.split('\0').filter(Boolean);
    if (entries.length !== 1) return null;
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entries[0]!);
    if (!match || match[3] !== file) return null;
    return { mode: match[1] as '100644' | '100755', type: 'blob', blobSha: match[2]! };
  };
  return {
    changedRecords: (baseHead, currentHead) => {
      const result = run(candidate, gitChangedFileDiffArgs(baseHead, currentHead), 'buffer');
      if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
      try {
        return parseGitChangedRecordsOutput(result.stdout);
      } catch {
        return null;
      }
    },
    gitBlob,
    readGitBlob: (ref, file) => {
      const entry = gitBlob(ref, file);
      if (!entry) return null;
      const result = run(gitDirectory(ref), ['cat-file', 'blob', `${ref}:${file}`], 'buffer');
      if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
      return { ...entry, bytes: new Uint8Array(result.stdout) };
    },
    gitFiles: (ref, prefix) => {
      const result = run(
        gitDirectory(ref),
        ['ls-tree', '-r', '-z', '--name-only', '--full-tree', ref, '--', prefix],
        'buffer'
      );
      if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
      let output: string;
      try {
        output = decodeGitPathOutput(result.stdout, 'tree-path');
      } catch {
        return null;
      }
      if (output.length > 0 && !output.endsWith('\0')) return null;
      return output.split('\0').filter(Boolean);
    },
    gitTree: (ref) => {
      const result = run(gitDirectory(ref), ['rev-parse', `${ref}^{tree}`], 'utf8', 1_048_576);
      if (result.status !== 0 || typeof result.stdout !== 'string') return null;
      const value = result.stdout.trim();
      return SHA_PATTERN.test(value) ? value : null;
    }
  };
}

function argument(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function writeCanonicalJsonAtomic(filePath: string, value: unknown): void {
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, absolutePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  try {
    if (command === 'attest') {
      const inputPath = argument(argv, '--input');
      const manifestPath = argument(argv, '--manifest');
      const outputPath = argument(argv, '--output');
      const request = strictJson(readFileSync(inputPath, 'utf8'), 'scope attestation request');
      const attestation = CodexDevelopmentBuildScopeAttestationV1(request, readManifestBytes(manifestPath));
      writeCanonicalJsonAtomic(outputPath, attestation);
      console.log(JSON.stringify(attestation));
      return 0;
    }
    if (command === 'gate') {
      const inputPath = argument(argv, '--input');
      const manifestPath = argument(argv, '--manifest');
      const attestationDirectory = argument(argv, '--attestation-dir');
      const verificationDirectory = argument(argv, '--verification-dir');
      const candidateGitDirectory = argument(argv, '--candidate-git-dir');
      const legacyGitDirectory = argument(argv, '--legacy-git-dir');
      const gitResolvers = mergeGateGitResolvers(candidateGitDirectory, legacyGitDirectory);
      const rawInput = strictJson(readFileSync(inputPath, 'utf8'), 'merge gate input');
      const rawAttestation = readSingleCanonicalJsonArtifact(
        attestationDirectory,
        CodexDevelopmentScopeAttestationFileV1
      );
      const rawEvidence = readSingleCanonicalJsonArtifact(
        verificationDirectory,
        CodexDevelopmentVerificationEvidenceFileV2
      );
      const result = CodexDevelopmentEvaluateMergeGateV1({
        rawInput,
        manifestBytes: readManifestBytes(manifestPath),
        rawAttestation,
        rawEvidence,
        ...gitResolvers
      });
      console.log(JSON.stringify(result));
      return 0;
    }
    throw new Error('Usage: merge-gate.ts attest|gate with explicit data-file arguments.');
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
