import { createHash } from 'node:crypto';

export const DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA =
  'sec-default-branch-revision-health-physical-evidence-v2' as const;
export const DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT_SCHEMA =
  'sec-default-branch-revision-health-receipt-v2' as const;

export type DefaultBranchVerificationHealth =
  | 'verification-failed'
  | 'verification-partial'
  | 'verification-passed';

export type DefaultBranchTrustEligibility =
  | 'repair-only'
  | 'trust-transition-required';

export type DefaultBranchRequiredCheckApplicability =
  | 'required'
  | 'not-applicable';

export type DefaultBranchCheckOutcome =
  | 'passed'
  | 'failed'
  | 'not-run'
  | 'environment-blocked'
  | 'unsupported';

export type DefaultBranchFailureClass =
  | 'deterministic'
  | 'environment'
  | 'unsupported'
  | 'unresolved'
  | null;

export interface DefaultBranchRevisionIdentityV2 {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly revision: string;
  readonly tree: string;
}

export interface DefaultBranchRevisionHealthProducerV2 {
  readonly identity: string;
  readonly revision: string;
  readonly runtime: string;
  readonly os: string;
  readonly arch: string;
  readonly toolchain: string;
}

export interface DefaultBranchRevisionHealthWorkspaceV2 {
  readonly revision: string;
  readonly tree: string;
  readonly clean: boolean;
}

export interface DefaultBranchRevisionHealthPolicyCheckV2 {
  readonly id: string;
  readonly applicability: DefaultBranchRequiredCheckApplicability;
}

export interface DefaultBranchRevisionHealthPolicyV2 {
  readonly profile: string;
  readonly revision: string;
  readonly digest: string;
  readonly checks: readonly DefaultBranchRevisionHealthPolicyCheckV2[];
}

export interface DefaultBranchRevisionHealthCommandEvidenceV2 {
  readonly checkId: string;
  readonly argv: readonly string[];
  readonly outcome: DefaultBranchCheckOutcome;
  readonly failureClass: DefaultBranchFailureClass;
  readonly exitCode: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly outputDigest: string | null;
}

export interface DefaultBranchRevisionHealthPhysicalEvidenceV2 {
  readonly schema: typeof DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA;
  readonly subject: DefaultBranchRevisionIdentityV2;
  readonly policy: DefaultBranchRevisionHealthPolicyV2;
  readonly producer: DefaultBranchRevisionHealthProducerV2;
  readonly workspace: Readonly<{
    before: DefaultBranchRevisionHealthWorkspaceV2;
    after: DefaultBranchRevisionHealthWorkspaceV2;
  }>;
  readonly commands: readonly DefaultBranchRevisionHealthCommandEvidenceV2[];
}

export interface DefaultBranchRevisionHealthProjectedCheckV2 {
  readonly id: string;
  readonly applicability: DefaultBranchRequiredCheckApplicability;
  readonly outcome: DefaultBranchCheckOutcome;
  readonly failureClass: DefaultBranchFailureClass;
  readonly command: DefaultBranchRevisionHealthCommandEvidenceV2 | null;
}

export interface DefaultBranchRevisionHealthReceiptV2 {
  readonly schema: typeof DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT_SCHEMA;
  readonly subject: DefaultBranchRevisionIdentityV2;
  readonly policy: DefaultBranchRevisionHealthPolicyV2;
  readonly producer: DefaultBranchRevisionHealthProducerV2;
  readonly recorder: DefaultBranchRevisionHealthProducerV2;
  readonly workspace: DefaultBranchRevisionHealthPhysicalEvidenceV2['workspace'];
  readonly checks: readonly DefaultBranchRevisionHealthProjectedCheckV2[];
  readonly verificationHealth: DefaultBranchVerificationHealth;
  readonly trustEligibility: DefaultBranchTrustEligibility;
  readonly verifiedAt: string | null;
  readonly recordedAt: string;
  readonly artifact: Readonly<{
    ref: string;
    digest: string;
    byteLength: number;
  }>;
}

export interface DefaultBranchRevisionHealthProjectionOptionsV2 {
  readonly artifactRef: string;
  readonly expectedSubjectRevision: string;
  readonly recorder?: DefaultBranchRevisionHealthProducerV2;
  readonly now?: () => Date;
}

const GIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
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
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${label} must be one non-empty trimmed string.`);
  }
}

function assertSafeId(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (!SAFE_ID.test(value)) throw new Error(`${label} is not a canonical identifier.`);
}

function assertGitSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !GIT_SHA.test(value)) {
    throw new Error(`${label} must be one lowercase 40-character Git SHA.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be one sha256 digest.`);
  }
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be one canonical UTC timestamp.`);
  }
}

function assertProducer(
  value: unknown,
  label: string
): asserts value is DefaultBranchRevisionHealthProducerV2 {
  assertRecord(value, label);
  assertExactKeys(
    value,
    ['identity', 'revision', 'runtime', 'os', 'arch', 'toolchain'],
    label
  );
  assertSafeId(value.identity, `${label}.identity`);
  assertSafeId(value.revision, `${label}.revision`);
  assertString(value.runtime, `${label}.runtime`);
  assertString(value.os, `${label}.os`);
  assertString(value.arch, `${label}.arch`);
  assertString(value.toolchain, `${label}.toolchain`);
}

function assertWorkspace(
  value: unknown,
  label: string,
  subject: DefaultBranchRevisionIdentityV2
): asserts value is DefaultBranchRevisionHealthWorkspaceV2 {
  assertRecord(value, label);
  assertExactKeys(value, ['revision', 'tree', 'clean'], label);
  assertGitSha(value.revision, `${label}.revision`);
  assertGitSha(value.tree, `${label}.tree`);
  if (typeof value.clean !== 'boolean') throw new Error(`${label}.clean must be boolean.`);
  if (value.revision !== subject.revision || value.tree !== subject.tree) {
    throw new Error(`${label} does not bind the exact subject revision and tree.`);
  }
}

function assertCommand(
  value: unknown,
  label: string
): asserts value is DefaultBranchRevisionHealthCommandEvidenceV2 {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      'checkId',
      'argv',
      'outcome',
      'failureClass',
      'exitCode',
      'startedAt',
      'finishedAt',
      'outputDigest'
    ],
    label
  );
  assertSafeId(value.checkId, `${label}.checkId`);
  if (!Array.isArray(value.argv) || value.argv.length === 0) {
    throw new Error(`${label}.argv must be one non-empty argv array.`);
  }
  value.argv.forEach((argument, index) => assertString(argument, `${label}.argv[${index}]`));
  if (
    !['passed', 'failed', 'not-run', 'environment-blocked', 'unsupported']
      .includes(String(value.outcome))
  ) {
    throw new Error(`${label}.outcome is invalid.`);
  }
  if (
    value.failureClass !== null
    && !['deterministic', 'environment', 'unsupported', 'unresolved'].includes(String(value.failureClass))
  ) {
    throw new Error(`${label}.failureClass is invalid.`);
  }

  const executed = value.exitCode !== null;
  if (executed) {
    if (!Number.isInteger(value.exitCode) || (value.exitCode as number) < 0) {
      throw new Error(`${label}.exitCode is invalid.`);
    }
    assertIsoTimestamp(value.startedAt, `${label}.startedAt`);
    assertIsoTimestamp(value.finishedAt, `${label}.finishedAt`);
    assertDigest(value.outputDigest, `${label}.outputDigest`);
    if (Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
      throw new Error(`${label} finished before it started.`);
    }
  } else if (
    value.startedAt !== null
    || value.finishedAt !== null
    || value.outputDigest !== null
  ) {
    throw new Error(`${label} non-executed command must not contain execution metadata.`);
  }

  if (value.outcome === 'passed') {
    if (!executed || value.exitCode !== 0 || value.failureClass !== null) {
      throw new Error(`${label} passed outcome is inconsistent.`);
    }
  } else if (value.outcome === 'failed') {
    if (!executed || value.exitCode === 0 || value.failureClass === null) {
      throw new Error(`${label} failed outcome is inconsistent.`);
    }
  } else {
    if (value.outcome === 'environment-blocked' && value.failureClass !== 'environment') {
      throw new Error(`${label} environment-blocked outcome requires environment failureClass.`);
    }
    if (value.outcome === 'unsupported' && value.failureClass !== 'unsupported') {
      throw new Error(`${label} unsupported outcome requires unsupported failureClass.`);
    }
    if (value.outcome === 'not-run' && value.failureClass !== null) {
      throw new Error(`${label} not-run outcome must not invent a failure class.`);
    }
  }
}

function parsePhysicalEvidence(
  artifactBytes: Uint8Array
): DefaultBranchRevisionHealthPhysicalEvidenceV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifactBytes));
  } catch (error) {
    throw new Error('Revision-health physical Evidence must be canonical UTF-8 JSON.', {
      cause: error
    });
  }
  assertRecord(parsed, 'revision-health physical Evidence');
  assertExactKeys(
    parsed,
    ['schema', 'subject', 'policy', 'producer', 'workspace', 'commands'],
    'revision-health physical Evidence'
  );
  if (parsed.schema !== DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA) {
    throw new Error('Revision-health physical Evidence schema mismatch.');
  }

  assertRecord(parsed.subject, 'revision-health subject');
  assertExactKeys(
    parsed.subject,
    ['repository', 'defaultBranch', 'revision', 'tree'],
    'revision-health subject'
  );
  assertString(parsed.subject.repository, 'revision-health subject.repository');
  assertString(parsed.subject.defaultBranch, 'revision-health subject.defaultBranch');
  assertGitSha(parsed.subject.revision, 'revision-health subject.revision');
  assertGitSha(parsed.subject.tree, 'revision-health subject.tree');
  const subject = parsed.subject as unknown as DefaultBranchRevisionIdentityV2;

  assertRecord(parsed.policy, 'revision-health policy');
  assertExactKeys(
    parsed.policy,
    ['profile', 'revision', 'digest', 'checks'],
    'revision-health policy'
  );
  assertSafeId(parsed.policy.profile, 'revision-health policy.profile');
  assertSafeId(parsed.policy.revision, 'revision-health policy.revision');
  assertDigest(parsed.policy.digest, 'revision-health policy.digest');
  if (!Array.isArray(parsed.policy.checks) || parsed.policy.checks.length === 0) {
    throw new Error('Revision-health policy must contain at least one check.');
  }
  const policyChecks = parsed.policy.checks.map((check, index) => {
    const label = `revision-health policy.checks[${index}]`;
    assertRecord(check, label);
    assertExactKeys(check, ['id', 'applicability'], label);
    assertSafeId(check.id, `${label}.id`);
    if (!['required', 'not-applicable'].includes(String(check.applicability))) {
      throw new Error(`${label}.applicability is invalid.`);
    }
    return check as unknown as DefaultBranchRevisionHealthPolicyCheckV2;
  });
  if (new Set(policyChecks.map(({ id }) => id)).size !== policyChecks.length) {
    throw new Error('Revision-health policy check IDs must be unique.');
  }

  assertProducer(parsed.producer, 'revision-health producer');

  assertRecord(parsed.workspace, 'revision-health workspace');
  assertExactKeys(parsed.workspace, ['before', 'after'], 'revision-health workspace');
  assertWorkspace(parsed.workspace.before, 'revision-health workspace.before', subject);
  assertWorkspace(parsed.workspace.after, 'revision-health workspace.after', subject);

  if (!Array.isArray(parsed.commands)) {
    throw new Error('Revision-health commands must be an array.');
  }
  parsed.commands.forEach((command, index) =>
    assertCommand(command, `revision-health commands[${index}]`));
  const commands = parsed.commands as unknown as DefaultBranchRevisionHealthCommandEvidenceV2[];
  if (new Set(commands.map(({ checkId }) => checkId)).size !== commands.length) {
    throw new Error('Revision-health command check IDs must be unique.');
  }
  const policyIds = new Set(policyChecks.map(({ id }) => id));
  const unknownCommand = commands.find(({ checkId }) => !policyIds.has(checkId));
  if (unknownCommand) {
    throw new Error(`Revision-health command ${unknownCommand.checkId} is absent from policy.`);
  }

  return {
    schema: DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA,
    subject,
    policy: {
      profile: parsed.policy.profile as string,
      revision: parsed.policy.revision as string,
      digest: parsed.policy.digest as string,
      checks: policyChecks
    },
    producer: parsed.producer,
    workspace: {
      before: parsed.workspace.before,
      after: parsed.workspace.after
    },
    commands
  };
}

function artifactDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function latestFinishedAt(
  commands: readonly DefaultBranchRevisionHealthCommandEvidenceV2[]
): string | null {
  const timestamps = commands
    .map(({ finishedAt }) => finishedAt)
    .filter((value): value is string => value !== null)
    .sort();
  return timestamps.at(-1) ?? null;
}

function deriveHealth(
  evidence: DefaultBranchRevisionHealthPhysicalEvidenceV2,
  checks: readonly DefaultBranchRevisionHealthProjectedCheckV2[]
): DefaultBranchVerificationHealth {
  if (!evidence.workspace.before.clean || !evidence.workspace.after.clean) {
    return 'verification-failed';
  }
  if (checks.some(({ applicability, outcome, failureClass }) =>
    applicability === 'required'
    && outcome === 'failed'
    && failureClass === 'deterministic')) {
    return 'verification-failed';
  }
  if (checks.some(({ applicability, outcome }) =>
    applicability === 'required' && outcome !== 'passed')) {
    return 'verification-partial';
  }
  return 'verification-passed';
}

export function CodexDevelopmentCaptureDefaultBranchRevisionHealthRecorderV2():
DefaultBranchRevisionHealthProducerV2 {
  return {
    identity: `sec-default-branch-revision-health-recorder:${process.platform}-${process.arch}`,
    revision: 'sec-default-branch-revision-health-recorder-v2',
    runtime: `bun@${Bun.version}`,
    os: process.platform,
    arch: process.arch,
    toolchain: 'sec-default-branch-revision-health-v2'
  };
}

/**
 * Validate one external physical-Evidence artifact and project an exact-subject
 * revision-health receipt. This source module contains no live receipt and no
 * command result. Dynamic facts exist only in `artifactBytes` and are rejected
 * unless their identity, execution metadata, policy lattice, workspace binding,
 * and producer metadata are internally coherent.
 */
export function CodexDevelopmentProjectDefaultBranchRevisionHealthV2(
  artifactBytes: Uint8Array,
  options: DefaultBranchRevisionHealthProjectionOptionsV2
): DefaultBranchRevisionHealthReceiptV2 {
  assertString(options.artifactRef, 'revision-health artifactRef');
  assertGitSha(options.expectedSubjectRevision, 'revision-health expectedSubjectRevision');
  const evidence = parsePhysicalEvidence(artifactBytes);
  if (evidence.subject.revision !== options.expectedSubjectRevision) {
    throw new Error(
      'Revision-health physical Evidence does not bind the expected exact subject revision.'
    );
  }

  const commands = new Map(evidence.commands.map((command) => [command.checkId, command]));
  const checks = evidence.policy.checks.map((policyCheck) => {
    const command = commands.get(policyCheck.id) ?? null;
    if (policyCheck.applicability === 'not-applicable' && command !== null) {
      throw new Error(
        `Revision-health not-applicable check ${policyCheck.id} must not carry command Evidence.`
      );
    }
    return {
      id: policyCheck.id,
      applicability: policyCheck.applicability,
      outcome: policyCheck.applicability === 'not-applicable'
        ? 'not-run' as const
        : command?.outcome ?? 'not-run' as const,
      failureClass: command?.failureClass ?? null,
      command
    };
  });

  const verifiedAt = latestFinishedAt(evidence.commands);
  const now = options.now ?? (() => new Date());
  const recordedAt = now().toISOString();
  if (verifiedAt !== null && Date.parse(recordedAt) < Date.parse(verifiedAt)) {
    throw new Error('Revision-health recorder time precedes physical verification.');
  }
  const verificationHealth = deriveHealth(evidence, checks);

  return {
    schema: DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT_SCHEMA,
    subject: evidence.subject,
    policy: evidence.policy,
    producer: evidence.producer,
    recorder: options.recorder
      ?? CodexDevelopmentCaptureDefaultBranchRevisionHealthRecorderV2(),
    workspace: evidence.workspace,
    checks,
    verificationHealth,
    trustEligibility: verificationHealth === 'verification-passed'
      ? 'trust-transition-required'
      : 'repair-only',
    verifiedAt,
    recordedAt,
    artifact: {
      ref: options.artifactRef,
      digest: artifactDigest(artifactBytes),
      byteLength: artifactBytes.byteLength
    }
  };
}
