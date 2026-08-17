export interface MicroserviceResiliencePolicy {
  readonly failureThreshold: number;
  readonly cooldownPeriodMs: number;
  readonly timeoutMs: number;
  readonly initialRetryDelayMs: number;
  readonly maxRetries: number;
}

export interface MicroserviceDeploymentIntent {
  readonly blockId: string;
  readonly transport: 'json-rpc';
  readonly requestMethod: 'POST';
  readonly packaging: 'isolated-service';
  readonly resilience: MicroserviceResiliencePolicy;
}

export interface RenderedMicroserviceArtifact {
  readonly relativePath: string;
  readonly text: string;
}

export interface MicroserviceDeploymentRenderer {
  readonly providerId: string;
  readonly revision: string;
  render(intent: MicroserviceDeploymentIntent): Promise<readonly RenderedMicroserviceArtifact[]>;
}
