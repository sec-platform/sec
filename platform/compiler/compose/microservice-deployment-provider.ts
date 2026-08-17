import type {
  MicroserviceDeploymentRenderer,
  MicroserviceResiliencePolicy
} from './microservice-deployment-contract.ts';
import { DEFAULT_MICROSERVICE_RESILIENCE_POLICY } from './microservice-deployment-policy.ts';
import { nextBunDockerMicroserviceRenderer } from './microservice-next-bun-docker-adapter.ts';

export interface MicroserviceDeploymentBinding {
  readonly renderer: MicroserviceDeploymentRenderer;
  readonly resilience: MicroserviceResiliencePolicy;
}

/**
 * Current compatibility binding for `target: microservices`.
 * Provider/Profile resolution may replace this owner later without changing
 * the provider-neutral lowering pass.
 */
export function defaultMicroserviceDeploymentBinding(): MicroserviceDeploymentBinding {
  return Object.freeze({
    renderer: nextBunDockerMicroserviceRenderer,
    resilience: DEFAULT_MICROSERVICE_RESILIENCE_POLICY
  });
}
