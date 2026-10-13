import {
  GENERATED_STATE_DISPOSAL_RECEIPT_SCHEMA, generatedStateDigest, normalizeGeneratedStateRelativePath,
  parseGeneratedStatePhysicalIdentity,
  type GeneratedStateCleanupProfile,
  type GeneratedStateDisposalReceipt,
  type GeneratedStatePhysicalIdentity
} from '../../../execution/generated-state/contract.ts';
import { GeneratedStateProducerBindingBlockedError } from '../../../execution/generated-state/errors.ts';
import type { GeneratedStateCleanupIntent, GeneratedStateWorktreeRetirementIntent } from '../../../execution/generated-state/journal-port.ts';
import { createGeneratedStateWorktreeRetirementIntent as worktreeRetirementIntent } from '../../../execution/generated-state/journal-port.ts';
import { canonicalBytes } from './canonical-bytes.ts';
const GENERATED_STATE_CLEANUP_INTENT_SCHEMA = 'sec-generated-state-cleanup-intent-v2' as const;

export function parseGeneratedStateCleanupIntentBytes(source: string, relativePath: string): GeneratedStateCleanupIntent {
    let value: Partial<GeneratedStateCleanupIntent>;
    try {
        value = JSON.parse(source) as Partial<GeneratedStateCleanupIntent>;
    }
    catch (error) {
        throw new GeneratedStateProducerBindingBlockedError(`Generated-state cleanup intent is not exact JSON: ${error instanceof Error ? error.message : String(error)}.`);
    }
    const expectedKeys = [
        'beforeInventoryDigest',
        'intentDigest',
        'profile',
        'registrationDigest',
        'relativePath',
        'root',
        'schema',
        'tombstoneName'
    ];
    if (Object.keys(value).sort().join('\0') !== expectedKeys.join('\0')) {
        throw new GeneratedStateProducerBindingBlockedError('Generated-state cleanup intent has noncanonical keys; physical state is preserved.');
    }
    let root: GeneratedStatePhysicalIdentity;
    try {
        root = parseGeneratedStatePhysicalIdentity(value.root, 'cleanupIntent.root');
    }
    catch (error) {
        throw new GeneratedStateProducerBindingBlockedError(`Generated-state cleanup intent physical identity is malformed: ${error instanceof Error ? error.message : String(error)}.`);
    }
    if (value.schema !== GENERATED_STATE_CLEANUP_INTENT_SCHEMA
        || value.relativePath !== normalizeGeneratedStateRelativePath(relativePath)
        || typeof value.beforeInventoryDigest !== 'string'
        || !/^sha256:[0-9a-f]{64}$/u.test(value.beforeInventoryDigest)
        || !['automatic', 'safe', 'all-rebuildable'].includes(String(value.profile))
        || typeof value.registrationDigest !== 'string'
        || !/^sha256:[0-9a-f]{64}$/u.test(value.registrationDigest)
        || typeof value.tombstoneName !== 'string' || !/^q-[0-9a-f]{48}$/u.test(value.tombstoneName)
        || typeof value.intentDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.intentDigest)) {
        throw new GeneratedStateProducerBindingBlockedError('Generated-state cleanup intent pointer is malformed; physical state is preserved.');
    }
    const material = Object.freeze({
        schema: value.schema,
        beforeInventoryDigest: value.beforeInventoryDigest,
        profile: value.profile,
        registrationDigest: value.registrationDigest,
        relativePath: value.relativePath,
        root,
        tombstoneName: value.tombstoneName
    });
    if (generatedStateDigest(material) !== value.intentDigest) {
        throw new GeneratedStateProducerBindingBlockedError('Generated-state cleanup intent digest is invalid; physical state is preserved.');
    }
    const intent = Object.freeze({ ...material, intentDigest: value.intentDigest }) as GeneratedStateCleanupIntent;
    if (canonicalBytes(intent) !== source) {
        throw new GeneratedStateProducerBindingBlockedError('Generated-state cleanup intent bytes are noncanonical; physical state is preserved.');
    }
    return intent;
}

export function parseGeneratedStateDisposalReceiptBytes(
  source: string,
  label: string
): GeneratedStateDisposalReceipt {
  let unknownValue: unknown;
  try {
    unknownValue = JSON.parse(source);
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `${label} is not exact JSON: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  if (unknownValue === null || typeof unknownValue !== 'object' || Array.isArray(unknownValue)) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} is not one canonical object.`);
  }
  const value = unknownValue as Record<string, unknown>;
  const expectedKeys = [
    'afterInventoryDigest',
    'beforeInventoryDigest',
    'physical',
    'profile',
    'receiptDigest',
    'registrationDigest',
    'relativePath',
    'retirementRef',
    'schema',
    'settlementDigest',
    'terminal'
  ];
  if (Object.keys(value).sort().join('\0') !== expectedKeys.join('\0')) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} has noncanonical keys.`);
  }
  let physical: GeneratedStatePhysicalIdentity;
  try {
    physical = parseGeneratedStatePhysicalIdentity(value.physical, `${label}.physical`);
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `${label} has malformed physical identity: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  if (value.schema !== GENERATED_STATE_DISPOSAL_RECEIPT_SCHEMA ||
      typeof value.relativePath !== 'string' ||
      value.relativePath !== normalizeGeneratedStateRelativePath(value.relativePath) ||
      !['automatic', 'safe', 'all-rebuildable'].includes(String(value.profile)) ||
      typeof value.registrationDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.registrationDigest) ||
      typeof value.retirementRef !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.retirementRef) ||
      typeof value.beforeInventoryDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.beforeInventoryDigest) ||
      typeof value.afterInventoryDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.afterInventoryDigest) ||
      typeof value.settlementDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.settlementDigest) ||
      value.terminal !== 'disposed' ||
      typeof value.receiptDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.receiptDigest)) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} is malformed.`);
  }
  const material = Object.freeze({
    schema: value.schema,
    relativePath: value.relativePath,
    profile: value.profile as GeneratedStateCleanupProfile,
    registrationDigest: value.registrationDigest as `sha256:${string}`,
    retirementRef: value.retirementRef as `sha256:${string}`,
    physical,
    beforeInventoryDigest: value.beforeInventoryDigest as `sha256:${string}`,
    afterInventoryDigest: value.afterInventoryDigest as `sha256:${string}`,
    settlementDigest: value.settlementDigest as `sha256:${string}`,
    terminal: value.terminal
  });
  if (generatedStateDigest(material) !== value.receiptDigest) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} digest is invalid.`);
  }
  const receipt = Object.freeze({
    ...material,
    receiptDigest: value.receiptDigest as `sha256:${string}`
  });
  if (canonicalBytes(receipt) !== source) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} bytes are noncanonical.`);
  }
  return receipt;
}

export function parseWorktreeRetirementIntent(value: unknown): GeneratedStateWorktreeRetirementIntent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Generated-state worktree retirement intent is not an object.');
  }
  const candidate = value as GeneratedStateWorktreeRetirementIntent;
  if (
    candidate.schema !== 'sec-generated-state-worktree-retirement-intent-v1' ||
    !Array.isArray(candidate.entries) ||
    typeof candidate.intentDigest !== 'string'
  ) {
    throw new Error('Generated-state worktree retirement intent is malformed.');
  }
  const rebuilt = worktreeRetirementIntent({
    operationId: candidate.operationId,
    repositoryRoot: candidate.repositoryRoot,
    workspacePath: candidate.workspacePath,
    workspace: candidate.workspace,
    worktree: candidate.worktree,
    statusDigest: candidate.statusDigest,
    inventoryDigest: candidate.inventoryDigest,
    retentionRoot: candidate.retentionRoot,
    entries: candidate.entries
  });
  if (rebuilt.intentDigest !== candidate.intentDigest || generatedStateDigest(rebuilt) !== generatedStateDigest(candidate)) {
    throw new Error('Generated-state worktree retirement intent digest is invalid.');
  }
  return candidate;
}
