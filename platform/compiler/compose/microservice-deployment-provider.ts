import type {
  MicroserviceDeploymentPublicationPolicy,
  MicroserviceDeploymentRenderer,
  MicroserviceResiliencePolicy
} from './microservice-deployment-contract.ts';
import { DEFAULT_MICROSERVICE_RESILIENCE_POLICY } from './microservice-deployment-policy.ts';
import { nextBunDockerMicroserviceRenderer } from './microservice-next-bun-docker-adapter.ts';

export interface MicroserviceDeploymentBinding {
  readonly renderer: MicroserviceDeploymentRenderer;
  readonly resilience: MicroserviceResiliencePolicy;
  readonly publication: MicroserviceDeploymentPublicationPolicy;
}

const DEFAULT_MICROSERVICE_PUBLICATION_POLICY: MicroserviceDeploymentPublicationPolicy = Object.freeze({
  allowedArtifactRoots: Object.freeze([
    'app/api/rpc',
    'src/rpc-clients',
    'docker'
  ])
});

/**
 * Current compatibility binding for `target: microservices`.
 * Provider/Profile resolution may replace this owner later without changing
 * the provider-neutral lowering pass. Publication authority remains separate
 * from renderer implementation so a provider cannot grant itself new paths.
 */
export function defaultMicroserviceDeploymentBinding(): MicroserviceDeploymentBinding {
  return Object.freeze({
    renderer: nextBunDockerMicroserviceRenderer,
    resilience: DEFAULT_MICROSERVICE_RESILIENCE_POLICY,
    publication: DEFAULT_MICROSERVICE_PUBLICATION_POLICY
  });
}
