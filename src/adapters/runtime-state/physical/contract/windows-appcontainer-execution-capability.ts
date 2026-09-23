import path from 'node:path';

const WINDOWS_APPCONTAINER_EXECUTION_RECEIPT_FORMAT =
  'windows-appcontainer-execution-binding-v1' as const;
const SHA256_IDENTITY = /^sha256:[0-9a-f]{64}$/u;

declare const WINDOWS_APPCONTAINER_EXECUTION_CAPABILITY: unique symbol;

/**
 * Process-local authorization for one Windows AppContainer execution root.
 * The capability has no structural runtime fields; origin is proven by the
 * physical owner's private WeakMap rather than by caller-authored data.
 */
export interface WindowsAppContainerExecutionCapability {
  readonly [WINDOWS_APPCONTAINER_EXECUTION_CAPABILITY]: never;
}

/**
 * Serializable binding consumed inside the native helper. It is deliberately
 * not an authorization: the host capability and its live fence authorize the
 * helper process before spawn and while it is running.
 */
export interface WindowsAppContainerExecutionBindingReceipt {
  readonly formatVersion: typeof WINDOWS_APPCONTAINER_EXECUTION_RECEIPT_FORMAT;
  readonly stagingRoot: string;
  readonly authorityBindingDigest: string;
  readonly deadlineAtUnixMs: number;
}

interface WindowsAppContainerExecutionCapabilityBinding
extends WindowsAppContainerExecutionBindingReceipt {
  readonly deadlineAtMonotonicMs: number;
  readonly assertCurrent: () => Promise<void>;
}

type WindowsAppContainerExecutionReceiptInput = Omit<
  WindowsAppContainerExecutionBindingReceipt,
  'formatVersion'
>;

const issuedCapabilities = new WeakMap<
  WindowsAppContainerExecutionCapability,
  WindowsAppContainerExecutionCapabilityBinding
>();

export class WindowsAppContainerExecutionCapabilityError extends Error {
  public readonly code = 'WINDOWS-APPCONTAINER-CAPABILITY-INVALID' as const;

  constructor() {
    super('Windows AppContainer execution capability is invalid');
    this.name = 'WindowsAppContainerExecutionCapabilityError';
  }
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLocaleLowerCase('en-US') === resolvedRight.toLocaleLowerCase('en-US')
    : resolvedLeft === resolvedRight;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length && actual.every((entry, index) => entry === canonical[index]);
}

function canonicalReceipt(
  input: WindowsAppContainerExecutionReceiptInput
): WindowsAppContainerExecutionBindingReceipt {
  if (
    typeof input.stagingRoot !== 'string'
    || !path.isAbsolute(input.stagingRoot)
    || path.resolve(input.stagingRoot) !== input.stagingRoot
    || !SHA256_IDENTITY.test(input.authorityBindingDigest)
    || !Number.isSafeInteger(input.deadlineAtUnixMs)
    || input.deadlineAtUnixMs <= Date.now()
  ) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  return Object.freeze({
    formatVersion: WINDOWS_APPCONTAINER_EXECUTION_RECEIPT_FORMAT,
    stagingRoot: input.stagingRoot,
    authorityBindingDigest: input.authorityBindingDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
  });
}

/**
 * Physical-owner issuer. The workspace lease owner is the only production
 * importer: it proves its canonical live lease before supplying assertCurrent.
 */
export async function issueWindowsAppContainerExecutionCapability(input: {
  readonly stagingRoot: string;
  readonly authorityBindingDigest: string;
  readonly deadlineAtUnixMs: number;
  readonly deadlineAtMonotonicMs: number;
  readonly assertCurrent: () => Promise<void>;
}): Promise<WindowsAppContainerExecutionCapability> {
  if (typeof input.assertCurrent !== 'function') {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  const receipt = canonicalReceipt(input);
  const observedAtMonotonicMs = performance.now();
  const observedAtUnixMs = Date.now();
  if (
    !Number.isFinite(input.deadlineAtMonotonicMs)
    || input.deadlineAtMonotonicMs <= observedAtMonotonicMs
  ) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  const deadlineAtMonotonicMs = Math.min(
    input.deadlineAtMonotonicMs,
    observedAtMonotonicMs + (receipt.deadlineAtUnixMs - observedAtUnixMs)
  );
  await input.assertCurrent();
  if (performance.now() >= deadlineAtMonotonicMs) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  const capability = Object.freeze({}) as WindowsAppContainerExecutionCapability;
  issuedCapabilities.set(capability, Object.freeze({
    ...receipt,
    deadlineAtMonotonicMs,
    assertCurrent: input.assertCurrent
  }));
  return capability;
}

function parseWindowsAppContainerExecutionBindingReceipt(
  value: unknown
): WindowsAppContainerExecutionBindingReceipt {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || !exactKeys(value, [
      'deadlineAtUnixMs',
      'formatVersion',
      'stagingRoot',
      'authorityBindingDigest'
    ])
  ) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.formatVersion !== WINDOWS_APPCONTAINER_EXECUTION_RECEIPT_FORMAT) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  return canonicalReceipt({
    stagingRoot: candidate.stagingRoot as string,
    authorityBindingDigest: candidate.authorityBindingDigest as string,
    deadlineAtUnixMs: candidate.deadlineAtUnixMs as number
  });
}

export async function assertWindowsAppContainerExecutionCapability(
  capability: WindowsAppContainerExecutionCapability,
  expectedStagingRoot: string
): Promise<WindowsAppContainerExecutionBindingReceipt> {
  const binding = issuedCapabilities.get(capability);
  if (!binding || !samePath(binding.stagingRoot, expectedStagingRoot)
    || performance.now() >= binding.deadlineAtMonotonicMs) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  await binding.assertCurrent();
  if (performance.now() >= binding.deadlineAtMonotonicMs) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  return Object.freeze({
    formatVersion: binding.formatVersion,
    stagingRoot: binding.stagingRoot,
    authorityBindingDigest: binding.authorityBindingDigest,
    deadlineAtUnixMs: binding.deadlineAtUnixMs
  });
}

export function assertWindowsAppContainerExecutionBindingReceipt(
  receipt: WindowsAppContainerExecutionBindingReceipt,
  expectedStagingRoot: string
): WindowsAppContainerExecutionBindingReceipt {
  const canonical = parseWindowsAppContainerExecutionBindingReceipt(receipt);
  if (!samePath(canonical.stagingRoot, expectedStagingRoot)) {
    throw new WindowsAppContainerExecutionCapabilityError();
  }
  return canonical;
}
