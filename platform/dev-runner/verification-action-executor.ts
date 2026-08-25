import {
  ciVerificationNormalizedOperationArgvV2,
  resolveCiVerificationDevRunnerTargetV1,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationNormalizedOperationV2
} from '../shared/verification-action-ci-contract.ts';
import {
  createVerificationActionEffectCapabilityDescriptorV1,
  createVerificationActionEvidenceV1,
  createVerificationActionTerminalV2,
  type VerificationActionEffectCapabilityV1,
  type VerificationActionEffectProviderV1,
  type VerificationActionEvidenceV1,
  type VerificationActionKeyV2,
  type VerificationActionPlanV2,
  type VerificationActionTerminalV2
} from '../shared/verification-action-contract.ts';

export const VERIFICATION_ACTION_EFFECT_PROVIDER_UNWIRED_REASON_V1 =
  'verification-effect-provider-unwired' as const;

export type VerificationActionEffectExecutionResultV1 = Readonly<{
  terminal: VerificationActionTerminalV2;
  evidenceRefs?: readonly string[];
  startedAt?: string;
  finishedAt?: string;
}>;

/**
 * Canonical adapter for a real provider or a test double.  The callback is
 * below the provider boundary: it can only return a terminal observation;
 * this adapter owns capability issuance, one-shot consumption, Evidence
 * construction, and provider readback.  It is intentionally not a second
 * journal or result authority.
 */
export function createVerificationActionCallbackEffectProviderV1(input: {
  readonly providerRevision: string;
  readonly execute: (input: Readonly<{
    action: VerificationActionKeyV2;
    capability: VerificationActionEffectCapabilityV1;
    signal: AbortSignal;
  }>) => Promise<VerificationActionEffectExecutionResultV1> | VerificationActionEffectExecutionResultV1;
  readonly release?: (input: Readonly<{
    action: VerificationActionKeyV2;
    capability: VerificationActionEffectCapabilityV1 | null;
    evidence: VerificationActionEvidenceV1;
    signal: AbortSignal;
  }>) => Promise<void> | void;
  readonly observe?: (input: Readonly<{
    actionKey: `sha256:${string}`;
    actionPlanDigest: `sha256:${string}`;
    executionBindingDigest: `sha256:${string}`;
    staticClosureDigest: `sha256:${string}`;
    signal: AbortSignal;
  }>) => Promise<VerificationActionEvidenceV1 | null> | VerificationActionEvidenceV1 | null;
  readonly now?: () => Date;
  readonly ttlMs?: number;
}): VerificationActionEffectProviderV1 {
  const providerRevision = input.providerRevision;
  if (typeof providerRevision !== 'string' || providerRevision.length === 0) {
    throw new Error('VerificationAction Effect provider revision is required.');
  }
  const now = input.now ?? (() => new Date());
  const ttlMs = input.ttlMs ?? 15 * 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 24 * 60 * 60_000) {
    throw new Error('VerificationAction Effect provider capability TTL is invalid.');
  }
  const evidenceByAction = new Map<string, VerificationActionEvidenceV1>();
  const issuedCapabilities = new WeakSet<object>();
  const consumedCapabilities = new WeakSet<object>();
  return Object.freeze({
    providerRevision,
    async issue(
      capabilityInput: Parameters<VerificationActionEffectProviderV1['issue']>[0]
    ): Promise<VerificationActionEffectCapabilityV1> {
      if (capabilityInput.start.actionKey !== capabilityInput.action.actionKey ||
          capabilityInput.start.providerRevision !== providerRevision ||
          capabilityInput.actionPlanDigest !== capabilityInput.start.actionPlanDigest ||
          capabilityInput.executionBindingDigest !== capabilityInput.start.executionBindingDigest ||
          capabilityInput.staticClosureDigest !== capabilityInput.start.staticClosureDigest) {
        throw new Error('VerificationAction Effect provider start binding mismatch.');
      }
      const issuedAt = now().toISOString();
      const descriptor = createVerificationActionEffectCapabilityDescriptorV1({
        actionKey: capabilityInput.action.actionKey,
        actionPlanDigest: capabilityInput.actionPlanDigest,
        executionBindingDigest: capabilityInput.executionBindingDigest,
        staticClosureDigest: capabilityInput.staticClosureDigest,
        providerRevision,
        issuedAt,
        expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(),
        oneShot: true
      });
      const handle = Object.freeze({ descriptor }) as unknown as VerificationActionEffectCapabilityV1;
      issuedCapabilities.add(handle as object);
      return handle;
    },
    async execute(
      effectInput: Parameters<VerificationActionEffectProviderV1['execute']>[0]
    ): Promise<VerificationActionEvidenceV1> {
      const handle = effectInput.capability as object;
      if (!issuedCapabilities.has(handle)) {
        throw new Error('VerificationAction Effect capability was not issued by this provider.');
      }
      const capability = effectInput.capability.descriptor;
      if (capability.providerRevision !== providerRevision ||
          capability.actionKey !== effectInput.action.actionKey) {
        throw new Error('VerificationAction Effect capability does not bind this provider/action.');
      }
      if (Date.parse(now().toISOString()) > Date.parse(capability.expiresAt)) {
        throw new Error('VerificationAction Effect capability expired before execution.');
      }
      if (consumedCapabilities.has(handle)) {
        throw new Error('VerificationAction Effect capability is one-shot and was already consumed.');
      }
      consumedCapabilities.add(handle);
      const startedAt = now().toISOString();
      const result = await input.execute({
        action: effectInput.action,
        capability: effectInput.capability,
        signal: effectInput.signal
      });
      const finishedAt = result.finishedAt ?? now().toISOString();
      const evidence = createVerificationActionEvidenceV1({
        actionKey: effectInput.action.actionKey,
        actionPlanDigest: capability.actionPlanDigest,
        executionBindingDigest: capability.executionBindingDigest,
        staticClosureDigest: capability.staticClosureDigest,
        providerRevision,
        capabilityDigest: capability.capabilityDigest,
        terminal: createVerificationActionTerminalV2(result.terminal),
        evidenceRefs: result.evidenceRefs === undefined || result.evidenceRefs.length === 0
          ? [`verification-action-effect:${capability.capabilityDigest}`]
          : result.evidenceRefs,
        startedAt: result.startedAt ?? startedAt,
        finishedAt
      });
      const published = await effectInput.evidencePublication.publish(evidence);
      const readback = await effectInput.evidencePublication.read();
      if (readback === null || readback.evidenceDigest !== published.evidenceDigest ||
          readback.evidenceDigest !== evidence.evidenceDigest) {
        throw new Error('VerificationAction provider Evidence durable publication readback mismatch.');
      }
      evidenceByAction.set(effectInput.action.actionKey, readback);
      return readback;
    },
    async observe(
      observation: Parameters<VerificationActionEffectProviderV1['observe']>[0]
    ): Promise<VerificationActionEvidenceV1 | null> {
      const durable = await observation.readPublishedEvidence();
      const external = await input.observe?.({
        actionKey: observation.actionKey,
        actionPlanDigest: observation.actionPlanDigest,
        executionBindingDigest: observation.executionBindingDigest,
        staticClosureDigest: observation.staticClosureDigest,
        signal: observation.signal
      });
      if (durable !== null && external !== null && external !== undefined &&
          durable.evidenceDigest !== external.evidenceDigest) {
        throw new Error('VerificationAction provider native and durable Evidence observations disagree.');
      }
      const evidence = external ?? durable ?? evidenceByAction.get(observation.actionKey) ?? null;
      if (evidence === null) return null;
      if (evidence.actionPlanDigest !== observation.actionPlanDigest ||
          evidence.executionBindingDigest !== observation.executionBindingDigest ||
          evidence.staticClosureDigest !== observation.staticClosureDigest ||
          evidence.providerRevision !== providerRevision) {
        throw new Error('VerificationAction provider Evidence does not match the requested closure.');
      }
      evidenceByAction.set(observation.actionKey, evidence);
      return evidence;
    },
    async release(
      releaseInput: Parameters<VerificationActionEffectProviderV1['release']>[0]
    ): Promise<void> {
      const evidence = evidenceByAction.get(releaseInput.action.actionKey);
      if (evidence === undefined || evidence.evidenceDigest !== releaseInput.evidence.evidenceDigest) {
        throw new Error('VerificationAction provider release requires the exact Evidence readback.');
      }
      if (releaseInput.capability !== null &&
          !issuedCapabilities.has(releaseInput.capability as object)) {
        throw new Error('VerificationAction provider release received an unissued Effect capability.');
      }
      await input.release?.(releaseInput);
    }
  });
}

/** Production boundary until A0 wires a real provider implementation. */
export function createUnwiredVerificationActionEffectProviderV1(
  reason = VERIFICATION_ACTION_EFFECT_PROVIDER_UNWIRED_REASON_V1
): VerificationActionEffectProviderV1 {
  const blocked = async (): Promise<never> => {
    throw new Error(`${reason}: A0 must wire a provider-issued Effect capability before physical execution.`);
  };
  return Object.freeze({
    providerRevision: 'unwired',
    issue: blocked,
    execute: blocked,
    observe: blocked,
    release: blocked
  });
}

/**
 * Execute one producer-normalized Verification Action operation.
 *
 * This is the narrow physical executor consumed by CI and local SEC tooling.
 * The multi-command dev-runner CLI is deliberately not a library boundary:
 * importing it would pull its dynamic command-loading surface into the TCB.
 */
export async function executeVerifiedCiActionPlanV1(options: {
  readonly plan: VerificationActionPlanV2;
  readonly authorizedClosure: CiVerificationActionPlanClosureV1;
  readonly repositoryRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly executeNormalizedOperation?: (
    operation: CiVerificationNormalizedOperationV2
  ) => Promise<number> | number;
}): Promise<number> {
  const operation = resolveCiVerificationDevRunnerTargetV1(options);
  if (options.executeNormalizedOperation !== undefined) {
    return options.executeNormalizedOperation(operation);
  }
  const [, ...args] = ciVerificationNormalizedOperationArgvV2(operation);
  const argv = [process.execPath, ...args];
  const child = Bun.spawn(argv, {
    cwd: options.repositoryRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: options.environment ?? process.env
  });
  return child.exited;
}
