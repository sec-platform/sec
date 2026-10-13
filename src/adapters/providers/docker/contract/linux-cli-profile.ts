import { sha256 } from '../../../../contracts/canonical.ts';
import {
  LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST,
  LINUX_DOCKER_SYSTEM_PLUGIN_DIRECTORIES
} from './linux-static-toolchain.ts';

/**
 * Required policy for a distinct, authenticated fresh-job CLI provider.
 * This identity is not an installed-provider observation or an Engine grant.
 * Generic Linux admission remains closed until every physical prerequisite
 * has been established by its own runtime owner.
 */
export const LINUX_DOCKER_CLI_PROFILE = Object.freeze({
  schema: 'sec-linux-docker-cli-profile-v1' as const,
  authority: 'policy-only' as const,
  platform: 'linux' as const,
  architecture: 'x64' as const,
  commandProtocol: 'docker-cli' as const,
  staticToolchainDigest: LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST,
  hostPrerequisite: 'authenticated-fresh-job-origin-and-candidate-host-isolation-v1',
  pluginSearch: Object.freeze({
    // Docker CLI v28.0.4 manager.go selects the first candidate even when
    // its metadata execution fails. It does not execute a shadowed candidate.
    selection: 'docker-cli-v28-first-candidate-no-fallback-v1',
    extraDirectoryOrder: Object.freeze(['pinned-static-generation', 'private-deny-candidates']),
    systemDirectories: LINUX_DOCKER_SYSTEM_PLUGIN_DIRECTORIES,
    privateDefaultDirectory: 'must-remain-absent',
    membership: 'complete-positive-and-negative-observation',
    writerExclusion: 'separate-authenticated-host-isolation-prerequisite',
    maximumEntriesPerDirectory: 256,
    denyCandidate: Object.freeze({ bytes: 0, mode: 0o400, links: 1 })
  }),
  configuration: 'exact-extra-directories-without-credentials-or-helpers',
  environment: 'private-home-config-temp-empty-path-no-ambient-environment',
  endpoint: 'retained-local-unix-socket-and-connected-peer',
  operation: 'original-bound-budget-cancellation-and-provider-settlement',
  ociExporter: 'actual-export-and-layout-readback-bound-to-same-engine-lifetime'
} as const);

/** Consumers may bind required semantics; a digest cannot authorize execution. */
export const LINUX_DOCKER_CLI_PROFILE_DIGEST = sha256(LINUX_DOCKER_CLI_PROFILE);
