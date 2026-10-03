import type { SecOperationDigest } from '../../../../execution/operation/semantic.ts';

/**
 * Opaque ownership transfer for one already-retained Container Engine transport/cwd
 * and its canonical child environment. The runtime owner keeps the physical
 * capabilities private; consumers can only bind an operation to this identity.
 */
export interface DockerCommandProviderCapability {
  readonly executable: string;
  /** The retained executable is interpreted only through its native protocol. */
  readonly commandProtocol: 'docker-cli' | 'engine-http';
  readonly providerIdentityDigest: SecOperationDigest;
  readonly workingDirectory: string;
}

export class DockerCommandProviderUnavailableError extends Error {
  readonly code = 'SEC-DOCKER-COMMAND-PROVIDER-UNAVAILABLE' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DockerCommandProviderUnavailableError';
  }
}

/** A command family was rejected before its process or external effect began. */
export class DockerCommandOperationUnavailableError extends Error {
  readonly code = 'SEC-DOCKER-COMMAND-OPERATION-UNAVAILABLE' as const;
  constructor(
    readonly operation: string,
    readonly reason: 'linux-cli-plugin-closure-unavailable' | 'linux-buildx-closure-unavailable' | 'linux-endpoint-identity-unavailable'
  ) {
    super(`Docker operation ${operation} is unavailable: ${reason}.`);
    this.name = 'DockerCommandOperationUnavailableError';
  }
}
