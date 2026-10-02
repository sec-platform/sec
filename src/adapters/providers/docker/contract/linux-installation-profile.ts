import { sha256 } from '../../../../contracts/canonical.ts';

/** Fixed Linux x64 installation layout; capabilities are admitted independently. */
export const DOCKER_LINUX_INSTALLATION_PROFILE = Object.freeze({
  schema: 'sec-docker-linux-installation-profile-v1',
  platform: 'linux',
  architecture: 'x64',
  commandProtocol: 'engine-http',
  daemonProbeExecutable: '/usr/bin/curl',
  endpointHost: 'unix:///run/docker.sock',
  daemonPeerUid: 0,
  runtimeParent: '/tmp',
  runtimePrefix: 'sec-docker-',
  maximumRuntimeEntries: 4_096,
  maximumRuntimeBytes: 64 * 1024 * 1024,
  runtimeRetirementTimeoutMs: 30_000
} as const);

export const DOCKER_LINUX_INSTALLATION_PROFILE_DIGEST = sha256(
  DOCKER_LINUX_INSTALLATION_PROFILE
);
