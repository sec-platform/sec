import {
  createAgentOperationActivationHostedStagePorts,
  type AgentOperationActivationHostedValues
} from '../../adapters/self-hosting/control/agent/agent-operation-activation.ts';
import {
  produceHostedAgentOperationActivation as produceActivation,
  publishHostedAgentOperationActivation as publishActivation,
  type HostedActivationPorts
} from '../../application/agent-operation-activation.ts';

function stagePorts(): HostedActivationPorts<AgentOperationActivationHostedValues> {
  return createAgentOperationActivationHostedStagePorts();
}

export async function produceHostedAgentOperationActivation(input: Readonly<{
  runtimeRoot: string; candidateRoot: string; requestPath: string; outputPath: string;
}>) {
  return await produceActivation<AgentOperationActivationHostedValues>(input, stagePorts());
}

export function publishHostedAgentOperationActivation(input: Readonly<{
  runtimeRoot: string; requestPath: string; payloadPath: string;
  artifactId: string; artifactDigest: `sha256:${string}`;
}>) {
  return publishActivation<AgentOperationActivationHostedValues>(input, stagePorts());
}
