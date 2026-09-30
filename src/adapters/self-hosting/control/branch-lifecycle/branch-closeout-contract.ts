/** Branch-closeout data contract; authorization policy is a separate owner. */
import { assertGitBranchName, assertGitSha, auditBranchLifecycle, branchLifecycleDigest } from './branch-lifecycle-audit.ts';
import { BRANCH_CLOSEOUT_PREPARATION_SCHEMA, BRANCH_CLOSEOUT_RECEIPT_SCHEMA, type BranchCloseoutAttempt, type BranchCloseoutAuthorization, type BranchCloseoutPreparation, type BranchCloseoutReceipt, type BranchCloseoutStatus, type BranchLifecycleInventory } from './branch-lifecycle-types.ts';
import { createHash } from 'node:crypto';
export { authorizeBranchCloseout } from './branch-closeout-authorization.ts';

const BRANCH_CLOSEOUT_OPERATION_SCHEMA =
  'sec-branch-closeout-operation-v1' as const;

const BRANCH_CLOSEOUT_OPERATION_JOURNAL_SCHEMA =
  'sec-branch-closeout-operation-journal-v1' as const;

const BRANCH_CLOSEOUT_OPERATION_RECEIPT_SCHEMA =
  'sec-branch-closeout-operation-receipt-v1' as const;

const BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_SCHEMA =
  'sec-branch-closeout-recovery-artifact-v1' as const;

export const BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME =
  'branch-closeout-recovery.json' as const;

type BranchCloseoutEffectState =
  | 'not-started'
  | 'applied'
  | 'observed-absent'
  | 'failed';

export interface BranchCloseoutOperationBinding {
  schema: typeof BRANCH_CLOSEOUT_OPERATION_SCHEMA;
  closeoutOperationId: `sha256:${string}`;
  authorizationId: string;
  consumptionOperationId: string;
  integrationAuthorizationReceiptDigest: `sha256:${string}`;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  newMainSha: string;
  newMainTreeSha: string;
  candidateTreeSha: string;
  preparationDigest: `sha256:${string}`;
  recoveryDigest: `sha256:${string}`;
}

/**
 * The closeout owner consumes only the authorization identity facts it binds
 * into its own operation.  The integration owner remains authoritative for
 * the authorization contract; keeping this narrow structural projection here
 * avoids a reverse implementation dependency and therefore an owner cycle.
 */

export interface BranchCloseoutAuthorizationIdentity {
  authorizationId: string;
  consumptionOperationId: string;
  receiptDigest: `sha256:${string}`;
  repository: string;
  prNumber: number;
  headSha: string;
}

export interface BranchCloseoutEffect {
  state: BranchCloseoutEffectState;
  detailDigest: `sha256:${string}` | null;
}

export interface BranchCloseoutOperationJournal {
  schema: typeof BRANCH_CLOSEOUT_OPERATION_JOURNAL_SCHEMA;
  binding: BranchCloseoutOperationBinding;
  writerId: string;
  remote: BranchCloseoutEffect;
  local: BranchCloseoutEffect;
  prune: BranchCloseoutEffect;
  terminalReceiptDigest: `sha256:${string}` | null;
  journalDigest: `sha256:${string}`;
}

export interface BranchCloseoutOperationReceipt {
  schema: typeof BRANCH_CLOSEOUT_OPERATION_RECEIPT_SCHEMA;
  binding: BranchCloseoutOperationBinding;
  writerId: string;
  generatedAt: string;
  remote: BranchCloseoutEffect;
  local: BranchCloseoutEffect;
  prune: BranchCloseoutEffect;
  receipt: BranchCloseoutReceipt;
  operationReceiptDigest: `sha256:${string}`;
}

export interface BranchCloseoutRecoveryArtifact {
  schema: typeof BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_SCHEMA;
  repository: string;
  pullRequestNumber: number;
  sessionRevision: `sha256:${string}`;
  headSha: string;
  headTreeSha: string;
  preparedEnvelopeBase64: string;
  preparedEnvelopeByteLength: number;
  preparedEnvelopeDigest: `sha256:${string}`;
  recoveryBundleBase64: string;
  recoveryBundleByteLength: number;
  recoveryBundleDigest: `sha256:${string}`;
  artifactDigest: `sha256:${string}`;
}

export interface BranchCloseoutOperationStore {
  read(filePath: string): string | null;
  createExclusive(filePath: string, bytes: string): boolean;
  replace(filePath: string, expectedBytes: string, nextBytes: string): void;
}

/**
 * Stable closeout preparation identity. Host-local paths, observation time,
 * worktree inventory, and verifier prose are deliberately excluded so a
 * trusted hosted retry can reconstruct the same remote operation from a fresh
 * checkout while independently re-verifying the recovery bytes.
 */

function branchCloseoutPreparationIdentity(
  preparation: Omit<BranchCloseoutPreparation, 'preparationDigest'>
): object {
  return {
    schema: preparation.schema,
    repository: {
      fullName: preparation.repository.fullName,
      remote: preparation.repository.remote,
      defaultBranch: preparation.repository.defaultBranch
    },
    branch: preparation.branch,
    refState: preparation.refState,
    expectedHeadSha: preparation.expectedHeadSha,
    expectedRemoteSha: preparation.expectedRemoteSha,
    expectedPrHeadSha: preparation.expectedPrHeadSha,
    pullRequestNumber: preparation.pullRequestNumber,
    pullRequestStateAtPreparation: preparation.pullRequestStateAtPreparation,
    recovery: {
      kind: preparation.recovery.kind,
      sha256: preparation.recovery.sha256,
      verified: preparation.recovery.verified
    }
  };
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function sha256Bytes(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalBase64(value: unknown, label: string, maximumBytes: number): {
  base64: string;
  bytes: Buffer;
} {
  if (typeof value !== 'string' || value.length === 0 || /\s/u.test(value)) {
    throw new Error(`${label} must be non-empty canonical base64.`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString('base64') !== value) {
    throw new Error(`${label} is malformed or exceeds its byte bound.`);
  }
  return { base64: value, bytes };
}

function recoveryArtifactPayload(input: Omit<
  BranchCloseoutRecoveryArtifact,
  'schema' | 'artifactDigest'
>): Omit<BranchCloseoutRecoveryArtifact, 'artifactDigest'> {
  return { schema: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_SCHEMA, ...input };
}

export function createBranchCloseoutRecoveryArtifact(input: {
  repository: string;
  pullRequestNumber: number;
  sessionRevision: `sha256:${string}`;
  headSha: string;
  headTreeSha: string;
  preparedEnvelopeBytes: string;
  recoveryBundleBytes: Uint8Array;
}): BranchCloseoutRecoveryArtifact {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input.repository)) {
    throw new Error('Branch closeout recovery artifact repository is invalid.');
  }
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber < 1) {
    throw new Error('Branch closeout recovery artifact PR must be a positive integer.');
  }
  assertDigest(input.sessionRevision, 'sessionRevision');
  assertGitSha(input.headSha, 'recovery artifact headSha');
  assertGitSha(input.headTreeSha, 'recovery artifact headTreeSha');
  const envelopeBytes = Buffer.from(input.preparedEnvelopeBytes, 'utf8');
  const bundleBytes = Buffer.from(input.recoveryBundleBytes);
  if (envelopeBytes.length === 0 || envelopeBytes.length > 10 * 1024 * 1024
    || bundleBytes.length === 0 || bundleBytes.length > 100 * 1024 * 1024) {
    throw new Error('Branch closeout recovery artifact bytes are empty or oversized.');
  }
  const payload = recoveryArtifactPayload({ repository: input.repository,
    pullRequestNumber: input.pullRequestNumber, sessionRevision: input.sessionRevision,
    headSha: input.headSha, headTreeSha: input.headTreeSha,
    preparedEnvelopeBase64: envelopeBytes.toString('base64'),
    preparedEnvelopeByteLength: envelopeBytes.length,
    preparedEnvelopeDigest: sha256Bytes(envelopeBytes),
    recoveryBundleBase64: bundleBytes.toString('base64'),
    recoveryBundleByteLength: bundleBytes.length,
    recoveryBundleDigest: sha256Bytes(bundleBytes) });
  return Object.freeze({ ...payload, artifactDigest: branchLifecycleDigest(payload) });
}

export function parseBranchCloseoutRecoveryArtifact(
  value: unknown
): BranchCloseoutRecoveryArtifact {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (error) {
      throw new Error('Branch closeout recovery artifact JSON is invalid.', { cause: error });
    }
  }
  assertRecord(value, 'Branch closeout recovery artifact');
  const expectedKeys = [
    'artifactDigest', 'headSha', 'headTreeSha', 'preparedEnvelopeBase64',
    'preparedEnvelopeByteLength', 'preparedEnvelopeDigest', 'pullRequestNumber',
    'recoveryBundleBase64', 'recoveryBundleByteLength', 'recoveryBundleDigest',
    'repository', 'schema', 'sessionRevision'
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Branch closeout recovery artifact fields are not exact.');
  }
  if (value.schema !== BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_SCHEMA) {
    throw new Error('Branch closeout recovery artifact schema mismatch.');
  }
  const envelope = canonicalBase64(value.preparedEnvelopeBase64,
    'preparedEnvelopeBase64', 10 * 1024 * 1024);
  const bundle = canonicalBase64(value.recoveryBundleBase64,
    'recoveryBundleBase64', 100 * 1024 * 1024);
  const rebuilt = createBranchCloseoutRecoveryArtifact({
    repository: String(value.repository), pullRequestNumber: Number(value.pullRequestNumber),
    sessionRevision: value.sessionRevision as `sha256:${string}`,
    headSha: String(value.headSha), headTreeSha: String(value.headTreeSha),
    preparedEnvelopeBytes: envelope.bytes.toString('utf8'), recoveryBundleBytes: bundle.bytes
  });
  const checks: readonly [unknown, unknown, string][] = [
    [value.preparedEnvelopeByteLength, envelope.bytes.length, 'prepared envelope byte length'],
    [value.preparedEnvelopeDigest, sha256Bytes(envelope.bytes), 'prepared envelope digest'],
    [value.recoveryBundleByteLength, bundle.bytes.length, 'recovery bundle byte length'],
    [value.recoveryBundleDigest, sha256Bytes(bundle.bytes), 'recovery bundle digest'],
    [value.artifactDigest, rebuilt.artifactDigest, 'artifact digest']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Branch closeout recovery artifact ${label} mismatch.`);
  }
  return rebuilt;
}

function normalizeSha(value: string | null, label: string): string | null {
  if (value === null) return null;
  assertGitSha(value, label);
  return value;
}

export function createBranchCloseoutPreparation(input: Omit<
  BranchCloseoutPreparation,
  'schema' | 'preparationDigest'
>): BranchCloseoutPreparation {
  assertGitBranchName(input.branch);
  if (input.refState !== 'present' && input.refState !== 'absent') {
    throw new Error('refState must be present or absent.');
  }
  assertGitSha(input.expectedHeadSha, 'expectedHeadSha');
  assertGitSha(input.expectedRemoteSha, 'expectedRemoteSha');
  normalizeSha(input.expectedLocalSha, 'expectedLocalSha');
  normalizeSha(input.expectedPrHeadSha, 'expectedPrHeadSha');
  if (
    input.pullRequestNumber !== null
    && (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0)
  ) {
    throw new Error('pullRequestNumber must be null or a positive safe integer.');
  }
  if ((input.pullRequestNumber === null) !== (input.pullRequestStateAtPreparation === null)) {
    throw new Error('pullRequest number and preparation state must either both be present or both be null.');
  }
  if (input.refState === 'absent') {
    if (input.pullRequestNumber === null) {
      throw new Error('absent-ref closeout requires an exact PR binding.');
    }
    if (input.pullRequestStateAtPreparation !== 'merged' && input.pullRequestStateAtPreparation !== 'closed') {
      throw new Error('absent-ref closeout requires a merged or closed PR state.');
    }
    if (input.expectedPrHeadSha === null) {
      throw new Error('absent-ref closeout requires the exact PR-recorded head SHA.');
    }
  } else if (input.expectedPrHeadSha !== null) {
    throw new Error('expectedPrHeadSha is only valid for absent-ref closeout.');
  }
  if (!input.recovery.verified) throw new Error('Recovery authority is not verified.');
  const withoutDigest = {
    schema: BRANCH_CLOSEOUT_PREPARATION_SCHEMA,
    ...input
  };
  return {
    ...withoutDigest,
    preparationDigest: branchLifecycleDigest(branchCloseoutPreparationIdentity(withoutDigest))
  };
}

export function assertBranchCloseoutPreparation(
  preparation: BranchCloseoutPreparation
): void {
  if (preparation.schema !== BRANCH_CLOSEOUT_PREPARATION_SCHEMA) {
    throw new Error('Branch closeout preparation schema mismatch.');
  }
  const { preparationDigest, ...withoutDigest } = preparation;
  if (branchLifecycleDigest(branchCloseoutPreparationIdentity(withoutDigest)) !== preparationDigest) {
    throw new Error('Branch closeout preparation digest mismatch.');
  }
  assertGitBranchName(preparation.branch);
  if (preparation.refState !== 'present' && preparation.refState !== 'absent') {
    throw new Error('refState must be present or absent.');
  }
  assertGitSha(preparation.expectedHeadSha, 'expectedHeadSha');
  assertGitSha(preparation.expectedRemoteSha, 'expectedRemoteSha');
  normalizeSha(preparation.expectedLocalSha, 'expectedLocalSha');
  normalizeSha(preparation.expectedPrHeadSha, 'expectedPrHeadSha');
}

function deriveBranchCloseoutStatus(input: {
  preparation: BranchCloseoutPreparation;
  authorization: BranchCloseoutAuthorization;
  attempts: readonly BranchCloseoutAttempt[];
  after: BranchLifecycleInventory;
}): { status: BranchCloseoutStatus; residue: string[] } {
  const residue: string[] = [];
  const { preparation, authorization, attempts, after } = input;

  if (authorization.blockers.length > 0) {
    return {
      status: 'blocked',
      residue: [...authorization.blockers]
    };
  }

  const remote = after.remoteBranches.find(({ branch }) => branch === preparation.branch);
  const local = after.localBranches.find(({ branch }) => branch === preparation.branch);
  const failedAttempts = attempts.filter(({ status }) => status === 'failed');

  if (remote !== undefined) {
    residue.push(`remote ref remains at ${remote.sha}`);
  }
  if (local !== undefined && authorization.localAction !== 'protect-local') {
    residue.push(`local ref remains at ${local.sha}`);
  }
  for (const attempt of failedAttempts) {
    residue.push(`${attempt.operation}: ${attempt.detail}`);
  }
  const afterAudit = auditBranchLifecycle(
    after,
    local !== undefined && authorization.localAction === 'protect-local'
      ? [{
          branch: preparation.branch,
          disposition: 'protected-pending',
          reference: preparation.preparationDigest
        }]
      : []
  );
  if (afterAudit.status === 'drift' || afterAudit.status === 'blocked') {
    for (const finding of afterAudit.findings.filter(({ severity }) => severity === 'error')) {
      residue.push(
        `lifecycle ${finding.code}${finding.branch ? `(${finding.branch})` : ''}: ${finding.message}`
      );
    }
  }

  if (residue.length > 0) {
    return {
      status: 'residue',
      residue: [...new Set(residue)].sort((left, right) => left.localeCompare(right))
    };
  }

  if (local !== undefined && authorization.localAction === 'protect-local') {
    return {
      status: 'protected-pending',
      residue: authorization.protections.length > 0
        ? authorization.protections
        : ['local branch remains protected by a worktree binding']
    };
  }

  return { status: 'completed', residue: [] };
}

export function createBranchCloseoutReceipt(input: Omit<
  BranchCloseoutReceipt,
  'schema' | 'status' | 'residue' | 'receiptDigest'
>): BranchCloseoutReceipt {
  const outcome = deriveBranchCloseoutStatus({
    preparation: input.preparation,
    authorization: input.authorization,
    attempts: input.attempts,
    after: input.after
  });
  const withoutDigest = {
    schema: BRANCH_CLOSEOUT_RECEIPT_SCHEMA,
    ...input,
    status: outcome.status,
    residue: outcome.residue
  };
  return {
    ...withoutDigest,
    receiptDigest: branchLifecycleDigest(withoutDigest)
  };
}

export function parseBranchCloseoutReceipt(source: string): BranchCloseoutReceipt {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Branch closeout receipt');
  if (parsed.schema !== BRANCH_CLOSEOUT_RECEIPT_SCHEMA) {
    throw new Error('Branch closeout receipt schema mismatch.');
  }
  const receipt = parsed as unknown as BranchCloseoutReceipt;
  const { receiptDigest, ...withoutDigest } = receipt;
  if (branchLifecycleDigest(withoutDigest) !== receiptDigest) {
    throw new Error('Branch closeout receipt digest mismatch.');
  }
  assertBranchCloseoutPreparation(receipt.preparation);
  const derived = deriveBranchCloseoutStatus({
    preparation: receipt.preparation,
    authorization: receipt.authorization,
    attempts: receipt.attempts,
    after: receipt.after
  });
  if (
    receipt.status !== derived.status
    || JSON.stringify(receipt.residue) !== JSON.stringify(derived.residue)
  ) {
    throw new Error('Branch closeout receipt outcome does not match its evidence.');
  }
  return receipt;
}

function assertDigest(value: string, label: string): asserts value is `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
}

function assertBoundedIdentity(value: string, label: string): void {
  if (
    value.length === 0
    || value.length > 512
    || value.trim() !== value
    || /[\u0000-\u001f]/u.test(value)
  ) {
    throw new Error(`${label} must be bounded canonical text.`);
  }
}

function operationIdentityPayload(
  binding: Omit<BranchCloseoutOperationBinding, 'schema' | 'closeoutOperationId'>
): Record<string, unknown> {
  return {
    schema: BRANCH_CLOSEOUT_OPERATION_SCHEMA,
    authorizationId: binding.authorizationId,
    consumptionOperationId: binding.consumptionOperationId,
    integrationAuthorizationReceiptDigest: binding.integrationAuthorizationReceiptDigest,
    repository: binding.repository,
    pullRequestNumber: binding.pullRequestNumber,
    headSha: binding.headSha,
    newMainSha: binding.newMainSha,
    newMainTreeSha: binding.newMainTreeSha,
    candidateTreeSha: binding.candidateTreeSha,
    preparationDigest: binding.preparationDigest,
    recoveryDigest: binding.recoveryDigest
  };
}

export function createBranchCloseoutOperationBinding(input: {
  integrationAuthorization: BranchCloseoutAuthorizationIdentity;
  preparation: BranchCloseoutPreparation;
  newMainSha: string;
  newMainTreeSha: string;
  candidateTreeSha: string;
}): BranchCloseoutOperationBinding {
  assertBranchCloseoutPreparation(input.preparation);
  const authorization = input.integrationAuthorization;
  assertBoundedIdentity(authorization.authorizationId, 'authorizationId');
  assertBoundedIdentity(authorization.consumptionOperationId, 'consumptionOperationId');
  assertDigest(authorization.receiptDigest, 'integrationAuthorization.receiptDigest');
  assertGitSha(input.newMainSha, 'newMainSha');
  assertGitSha(input.newMainTreeSha, 'newMainTreeSha');
  assertGitSha(input.candidateTreeSha, 'candidateTreeSha');
  if (input.newMainTreeSha !== input.candidateTreeSha) {
    throw new Error('Post-parity closeout requires newMainTreeSha to match candidateTreeSha.');
  }
  if (authorization.repository !== input.preparation.repository.fullName) {
    throw new Error('IntegrationAuthorization repository does not match closeout preparation.');
  }
  if (authorization.prNumber !== input.preparation.pullRequestNumber) {
    throw new Error('IntegrationAuthorization PR does not match closeout preparation.');
  }
  if (authorization.headSha !== input.preparation.expectedHeadSha) {
    throw new Error('IntegrationAuthorization head does not match closeout preparation.');
  }
  const payload = operationIdentityPayload({
    authorizationId: authorization.authorizationId,
    consumptionOperationId: authorization.consumptionOperationId,
    integrationAuthorizationReceiptDigest: authorization.receiptDigest,
    repository: authorization.repository,
    pullRequestNumber: authorization.prNumber,
    headSha: authorization.headSha,
    newMainSha: input.newMainSha,
    newMainTreeSha: input.newMainTreeSha,
    candidateTreeSha: input.candidateTreeSha,
    preparationDigest: input.preparation.preparationDigest,
    recoveryDigest: input.preparation.recovery.sha256
  });
  return {
    ...payload,
    closeoutOperationId: branchLifecycleDigest(payload)
  } as BranchCloseoutOperationBinding;
}

export function assertBranchCloseoutOperationBinding(
  binding: BranchCloseoutOperationBinding
): void {
  if (binding.schema !== BRANCH_CLOSEOUT_OPERATION_SCHEMA) {
    throw new Error('Branch closeout operation schema mismatch.');
  }
  assertDigest(binding.closeoutOperationId, 'closeoutOperationId');
  assertBoundedIdentity(binding.authorizationId, 'authorizationId');
  assertBoundedIdentity(binding.consumptionOperationId, 'consumptionOperationId');
  assertDigest(
    binding.integrationAuthorizationReceiptDigest,
    'integrationAuthorizationReceiptDigest'
  );
  assertGitSha(binding.headSha, 'headSha');
  assertGitSha(binding.newMainSha, 'newMainSha');
  assertGitSha(binding.newMainTreeSha, 'newMainTreeSha');
  assertGitSha(binding.candidateTreeSha, 'candidateTreeSha');
  assertDigest(binding.preparationDigest, 'preparationDigest');
  assertDigest(binding.recoveryDigest, 'recoveryDigest');
  if (binding.newMainTreeSha !== binding.candidateTreeSha) {
    throw new Error('Branch closeout operation tree parity is not matched.');
  }
  const { schema: _schema, closeoutOperationId, ...identity } = binding;
  if (branchLifecycleDigest(operationIdentityPayload(identity)) !== closeoutOperationId) {
    throw new Error('Branch closeout operation identity digest mismatch.');
  }
}

function assertEffect(effect: BranchCloseoutEffect, label: string): void {
  if (
    effect.state !== 'not-started'
    && effect.state !== 'applied'
    && effect.state !== 'observed-absent'
    && effect.state !== 'failed'
  ) {
    throw new Error(`${label}.state is invalid.`);
  }
  if (effect.detailDigest !== null) assertDigest(effect.detailDigest, `${label}.detailDigest`);
  if (effect.state === 'not-started' && effect.detailDigest !== null) {
    throw new Error(`${label} not-started state cannot contain a detail digest.`);
  }
}

export function createBranchCloseoutOperationJournal(input: Omit<
  BranchCloseoutOperationJournal,
  'schema' | 'journalDigest'
>): BranchCloseoutOperationJournal {
  assertBranchCloseoutOperationBinding(input.binding);
  assertBoundedIdentity(input.writerId, 'writerId');
  assertEffect(input.remote, 'remote');
  assertEffect(input.local, 'local');
  assertEffect(input.prune, 'prune');
  if (input.terminalReceiptDigest !== null) {
    assertDigest(input.terminalReceiptDigest, 'terminalReceiptDigest');
  }
  const payload = { schema: BRANCH_CLOSEOUT_OPERATION_JOURNAL_SCHEMA, ...input };
  return { ...payload, journalDigest: branchLifecycleDigest(payload) };
}

export function parseBranchCloseoutOperationJournal(
  source: string
): BranchCloseoutOperationJournal {
  const value: unknown = JSON.parse(source);
  assertRecord(value, 'Branch closeout operation journal');
  const journal = value as unknown as BranchCloseoutOperationJournal;
  if (journal.schema !== BRANCH_CLOSEOUT_OPERATION_JOURNAL_SCHEMA) {
    throw new Error('Branch closeout operation journal schema mismatch.');
  }
  const { journalDigest, ...payload } = journal;
  assertDigest(journalDigest, 'journalDigest');
  if (branchLifecycleDigest(payload) !== journalDigest) {
    throw new Error('Branch closeout operation journal digest mismatch.');
  }
  createBranchCloseoutOperationJournal({
    binding: journal.binding,
    writerId: journal.writerId,
    remote: journal.remote,
    local: journal.local,
    prune: journal.prune,
    terminalReceiptDigest: journal.terminalReceiptDigest
  });
  if (source !== `${JSON.stringify(journal, null, 2)}\n`) {
    throw new Error('Branch closeout operation journal bytes are not canonical.');
  }
  return journal;
}

export function createBranchCloseoutOperationReceipt(input: Omit<
  BranchCloseoutOperationReceipt,
  'schema' | 'operationReceiptDigest'
>): BranchCloseoutOperationReceipt {
  assertBranchCloseoutOperationBinding(input.binding);
  assertBoundedIdentity(input.writerId, 'writerId');
  if (new Date(input.generatedAt).toISOString() !== input.generatedAt) {
    throw new Error('generatedAt must be a canonical ISO timestamp.');
  }
  assertEffect(input.remote, 'remote');
  assertEffect(input.local, 'local');
  assertEffect(input.prune, 'prune');
  const receipt = parseBranchCloseoutReceipt(`${JSON.stringify(input.receipt)}\n`);
  if (receipt.preparation.preparationDigest !== input.binding.preparationDigest) {
    throw new Error('Terminal receipt preparation does not match closeout operation.');
  }
  const payload = {
    schema: BRANCH_CLOSEOUT_OPERATION_RECEIPT_SCHEMA,
    ...input,
    receipt
  };
  return { ...payload, operationReceiptDigest: branchLifecycleDigest(payload) };
}

export function parseBranchCloseoutOperationReceipt(
  source: string
): BranchCloseoutOperationReceipt {
  const value: unknown = JSON.parse(source);
  assertRecord(value, 'Branch closeout operation receipt');
  const receipt = value as unknown as BranchCloseoutOperationReceipt;
  if (receipt.schema !== BRANCH_CLOSEOUT_OPERATION_RECEIPT_SCHEMA) {
    throw new Error('Branch closeout operation receipt schema mismatch.');
  }
  const { operationReceiptDigest, ...payload } = receipt;
  assertDigest(operationReceiptDigest, 'operationReceiptDigest');
  if (branchLifecycleDigest(payload) !== operationReceiptDigest) {
    throw new Error('Branch closeout operation receipt digest mismatch.');
  }
  const rebuilt = createBranchCloseoutOperationReceipt({
    binding: receipt.binding,
    writerId: receipt.writerId,
    generatedAt: receipt.generatedAt,
    remote: receipt.remote,
    local: receipt.local,
    prune: receipt.prune,
    receipt: receipt.receipt
  });
  if (rebuilt.operationReceiptDigest !== operationReceiptDigest) {
    throw new Error('Branch closeout operation receipt bytes are not canonical.');
  }
  if (source !== `${JSON.stringify(receipt, null, 2)}\n`) {
    throw new Error('Branch closeout operation receipt persistence bytes are not canonical.');
  }
  return receipt;
}
