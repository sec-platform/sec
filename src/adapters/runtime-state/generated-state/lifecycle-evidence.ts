import type { GeneratedStateCleanupContinuationReceipt, GeneratedStateDisposalReceipt } from '../../../execution/generated-state/contract.ts';
import type { GeneratedStateRetirementObservation } from '../../../execution/generated-state/lifecycle-port.ts';
import { assertIssuedObservationMatchesFacts, inspectIssuedGeneratedStateObservation } from '../../../execution/generated-state/observation.ts';
import { inspectIssuedGeneratedStateTerminalReceipt } from '../../../execution/generated-state/terminal-receipt.ts';
import { assertGeneratedStateWorktreeRetirementEffectStart as assertWorktreeReadback } from '../../../execution/generated-state/worktree-admission.ts';
import { verifyGeneratedStateNativeContinuationEvidence, verifyGeneratedStateNativeDisposalEvidence } from './journals.ts';
import { createGeneratedStatePhysicalObservationBackend } from './physical-effects.ts';
import { readVerifiedGeneratedStateObservationFacts } from './registration-store.ts';

/** Fixed native validation surface for real consumers, independent of any
 * supplied lifecycle methods. No method issues an Effect or composes a flow. */
export async function assertGeneratedStateRetirementObservation(observation: GeneratedStateRetirementObservation,
  scope: Readonly<{ workspaceRoot: string; relativePath: string }>): Promise<void> {
  const issued = inspectIssuedGeneratedStateObservation(observation);
  const facts = await readVerifiedGeneratedStateObservationFacts(issued.nativeEvidence, scope);
  assertIssuedObservationMatchesFacts(observation, facts);
}
export async function assertGeneratedStateDisposalReceipt(receipt: GeneratedStateDisposalReceipt,
  scope: Readonly<{ workspaceRoot: string; relativePath: string }>): Promise<void> {
  const issued = inspectIssuedGeneratedStateTerminalReceipt(receipt);
  await verifyGeneratedStateNativeDisposalEvidence(issued.nativeEvidence, { ...scope, receipt });
}
export async function assertGeneratedStateCleanupContinuationReceipt(receipt: GeneratedStateCleanupContinuationReceipt,
  scope: Readonly<{ workspaceRoot: string }>): Promise<void> {
  const issued = inspectIssuedGeneratedStateTerminalReceipt(receipt);
  await verifyGeneratedStateNativeContinuationEvidence(issued.nativeEvidence, { ...scope, receipt });
}
export function assertGeneratedStateWorktreeRetirementEffectStart(input: Parameters<typeof assertWorktreeReadback>[0]) {
  return assertWorktreeReadback(input, createGeneratedStatePhysicalObservationBackend(input.workspaceRoot));
}
