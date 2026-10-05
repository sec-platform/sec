import { assertGitCandidateCheckoutCurrent, type GitCandidateCheckout } from '../../adapters/providers/git-bundle/runtime.ts';
import {
  createAgentOperationActivationHostedStagePorts,
  type AgentOperationActivationHostedValues
} from '../../adapters/self-hosting/control/agent/agent-operation-activation.ts';
import {
  produceHostedAgentOperationActivation as produceActivation,
  publishHostedAgentOperationActivation as publishActivation,
  type HostedActivationPorts
} from '../../application/agent-operation-activation.ts';

function stagePorts(checkout?: GitCandidateCheckout): HostedActivationPorts<AgentOperationActivationHostedValues> {
  return createAgentOperationActivationHostedStagePorts(checkout);
}

export async function produceHostedAgentOperationActivation(input: Readonly<{
  runtimeRoot: string; candidateRoot: string; candidateCheckout: GitCandidateCheckout;
  requestPath: string; outputPath: string;
}>) {
  const checkout = input.candidateCheckout;
  assertGitCandidateCheckoutCurrent(checkout);
  if (checkout.purpose !== 'activation-static' || input.candidateRoot !== checkout.candidateRoot) throw new Error('Activation candidate differs from its private Git borrower.');
  const native = stagePorts(checkout);
  const result = await produceActivation<AgentOperationActivationHostedValues>(input, {
    ...native,
    workDecision: async root => {
      assertGitCandidateCheckoutCurrent(checkout);
      const decision = await native.workDecision(root);
      assertGitCandidateCheckoutCurrent(checkout);
      return decision;
    },
    writePayload: async (output, value) => {
      assertGitCandidateCheckoutCurrent(checkout);
      await native.writePayload(output, value);
      assertGitCandidateCheckoutCurrent(checkout);
    }
  });
  assertGitCandidateCheckoutCurrent(checkout);
  return result;
}

export function publishHostedAgentOperationActivation(input: Readonly<{
  runtimeRoot: string; requestPath: string; payloadPath: string;
  artifactId: string; artifactDigest: `sha256:${string}`;
}>) {
  return publishActivation<AgentOperationActivationHostedValues>(input, stagePorts());
}
