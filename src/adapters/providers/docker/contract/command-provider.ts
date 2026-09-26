import type { OperationDigest } from '../../../../execution/operation/semantic.ts';

/**
 * Opaque ownership transfer for one already-retained Docker executable/cwd
 * and its canonical child environment. The runtime owner keeps the physical
 * capabilities private; consumers can only bind an operation to this identity.
 */
export interface DockerCommandProviderCapability {
  readonly executable: string;
  readonly providerIdentityDigest: OperationDigest;
  readonly workingDirectory: string;
}

export class DockerCommandProviderUnavailableError extends Error {
  readonly code = 'SEC-DOCKER-COMMAND-PROVIDER-UNAVAILABLE' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DockerCommandProviderUnavailableError';
  }
}
