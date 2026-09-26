import type { SemanticMutationVerificationCapabilityPlan } from '../../../assurance/verification/contract/types.ts';
import {
  planSemanticMutationVerificationCapabilitiesForIsolation
} from '../../../assurance/verification/semantic-mutation/verification-runtime.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../semantics/engineering-ir/validated-types.ts';
import type { VerificationRequirement } from '../../../semantics/mutation/types.ts';
import { forwardIsolatedRuntimeBinding } from './isolated/runtime-binding.ts';
import {
  hasProvenIsolationCapability,
  probeSemanticMutationIsolationCapability,
  type IsolationCapabilityProbe
} from './isolated/capability.ts';

/**
 * Bind Assurance capability planning to the physical isolation probe. The
 * adapter contributes only freshly observed host capability and forwards the
 * process-local runtime binding when Assurance issues a runnable plan.
 */
export async function planSemanticMutationVerificationCapabilities(input: {
  readonly snapshot: ValidatedEngineeringIRSnapshot;
  readonly requirements: readonly VerificationRequirement[];
  readonly isolationCapabilityProbe?: IsolationCapabilityProbe;
}): Promise<SemanticMutationVerificationCapabilityPlan> {
  const isolationCapability = await probeSemanticMutationIsolationCapability(
    input.isolationCapabilityProbe
  );
  const isolationProven = hasProvenIsolationCapability(
    isolationCapability
  );
  const plan = planSemanticMutationVerificationCapabilitiesForIsolation({
    snapshot: input.snapshot,
    requirements: input.requirements,
    isolationProven
  });
  if (plan.status === 'runnable' && isolationProven) {
    forwardIsolatedRuntimeBinding(isolationCapability, plan);
  }
  return plan;
}
