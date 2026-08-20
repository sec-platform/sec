import type { MicroserviceResiliencePolicy } from './microservice-deployment-contract.ts';

/**
 * Current default resilience policy for the first microservice deployment
 * provider. Values are explicit policy input to lowering rather than hidden
 * inside generated code. Future Target/Profile binding may replace this owner.
 */
export const DEFAULT_MICROSERVICE_RESILIENCE_POLICY: MicroserviceResiliencePolicy = Object.freeze({
  failureThreshold: 3,
  cooldownPeriodMs: 5_000,
  timeoutMs: 5_000,
  initialRetryDelayMs: 100,
  maxRetries: 3
});
