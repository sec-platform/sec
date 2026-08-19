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
  /** Bind provider/toolchain observations once for the whole lowering operation. */
  render(intents: readonly MicroserviceDeploymentIntent[]): Promise<readonly RenderedMicroserviceArtifact[]>;
}

/**
 * Publication authority is supplied independently from the renderer. A
 * provider may propose artifact bytes only inside these pre-authorized roots;
 * it cannot expand its own write surface by returning a different path.
 */
export interface MicroserviceDeploymentPublicationPolicy {
  readonly allowedArtifactRoots: readonly string[];
}
