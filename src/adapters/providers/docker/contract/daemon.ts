import { sha256 } from '../../../../contracts/canonical.ts';

export const DOCKER_ENDPOINT_IDENTITY_SCHEMA = 'sec-docker-endpoint-identity-v1' as const;

export interface DockerEndpointIdentity {
  readonly schema: typeof DOCKER_ENDPOINT_IDENTITY_SCHEMA;
  readonly contextName: string;
  readonly endpointHost: string;
  readonly daemonId: string;
  readonly osType: 'linux';
  readonly architecture: 'x86_64';
}

function boundedIdentityText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`Docker daemon ${label} must be bounded non-control text`);
  }
  return value;
}

export function parseDockerEndpointIdentity(value: unknown): DockerEndpointIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Docker daemon endpoint identity must be an object');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const expectedKeys = [
    'architecture', 'contextName', 'daemonId', 'endpointHost', 'osType', 'schema'
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Docker daemon endpoint identity keys are noncanonical');
  }
  if (input.schema !== DOCKER_ENDPOINT_IDENTITY_SCHEMA
      || input.osType !== 'linux' || input.architecture !== 'x86_64') {
    throw new Error('Docker daemon endpoint identity contract is invalid');
  }
  const contextName = boundedIdentityText(input.contextName, 'context name');
  const endpointHost = boundedIdentityText(input.endpointHost, 'endpoint host');
  const daemonId = boundedIdentityText(input.daemonId, 'identity');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(contextName)) {
    throw new Error('Docker daemon context name is invalid');
  }
  if (!/^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_.-]+$/u.test(endpointHost)
      && !/^unix:\/{3}[^\u0000-\u001f]+$/u.test(endpointHost)) {
    throw new Error('Docker daemon endpoint host must be a local npipe or unix transport');
  }
  return Object.freeze({
    schema: input.schema,
    contextName,
    endpointHost,
    daemonId,
    osType: input.osType,
    architecture: input.architecture
  });
}

export function createDockerEndpointIdentity(
  input: Omit<DockerEndpointIdentity, 'schema'>
): DockerEndpointIdentity {
  return parseDockerEndpointIdentity({
    ...input,
    schema: DOCKER_ENDPOINT_IDENTITY_SCHEMA
  });
}

export type DockerDaemonAvailabilityFailureReason =
  | 'deadline-exhausted'
  | 'desktop-environment-unavailable'
  | 'desktop-launcher-busy'
  | 'desktop-launcher-path-unavailable'
  | 'desktop-launcher-settlement-unknown'
  | 'desktop-start-failed'
  | 'endpoint-unavailable'
  | 'process-settlement-failed'
  | 'runtime-endpoint-residue';

export type DockerDaemonAvailabilityFailurePhase =
  | 'admission'
  | 'desktop-start'
  | 'endpoint-observe'
  | 'final-readback'
  | 'process-settlement';

export class DockerDaemonAvailabilityFailure extends Error {
  readonly code = 'SEC-DOCKER-DAEMON-UNAVAILABLE' as const;
  readonly endpointHost: string;
  readonly reason: DockerDaemonAvailabilityFailureReason;
  readonly phase: DockerDaemonAvailabilityFailurePhase;
  readonly providerEvidenceByteLength: number;
  readonly providerEvidenceDigest: `sha256:${string}`;
  readonly detailDigest: `sha256:${string}`;

  constructor(input: Readonly<{
    endpointHost: string;
    reason: DockerDaemonAvailabilityFailureReason;
    phase?: DockerDaemonAvailabilityFailurePhase;
    providerEvidence?: string;
  }>, options?: ErrorOptions) {
    super(`Docker daemon is unavailable: ${input.reason}`, options);
    this.name = 'DockerDaemonAvailabilityFailure';
    this.endpointHost = boundedIdentityText(input.endpointHost, 'endpoint host');
    this.reason = input.reason;
    this.phase = input.phase ?? 'admission';
    const providerEvidence = Buffer.from((input.providerEvidence ?? '').slice(-8_192), 'utf8');
    this.providerEvidenceByteLength = providerEvidence.byteLength;
    this.providerEvidenceDigest = sha256({
      domain: 'sec.docker.daemon.provider-evidence',
      evidence: providerEvidence.toString('base64')
    }) as `sha256:${string}`;
    this.detailDigest = sha256({
      code: this.code,
      endpointHost: this.endpointHost,
      reason: this.reason,
      phase: this.phase,
      providerEvidenceByteLength: this.providerEvidenceByteLength,
      providerEvidenceDigest: this.providerEvidenceDigest
    }) as `sha256:${string}`;
  }
}
