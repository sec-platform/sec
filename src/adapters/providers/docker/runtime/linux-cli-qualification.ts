import { sha256 } from '../../../../contracts/canonical.ts';
import { assertRetainedNoFollowCapability, type RetainedNoFollowChildProcessDirectory } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent,
  getAuthenticatedGitHubJobOriginSignal,
  type AuthenticatedGitHubJobOrigin
} from '../../github-api/hosted-job-origin.ts';
import { LINUX_DOCKER_CLI_PROFILE_DIGEST } from '../contract/linux-cli-profile.ts';
import { DOCKER_LINUX_INSTALLATION_PROFILE } from '../contract/linux-installation-profile.ts';
import { assertLinuxDockerEndpoint, type LinuxDockerEndpoint } from './linux-endpoint.ts';
import { assertLinuxDockerCliRuntimeState, type LinuxDockerRuntimeState } from './linux-runtime-state.ts';
import {
  assertRetainedLinuxDockerStaticToolchain,
  linuxDockerStaticToolchainInputs,
  type RetainedLinuxDockerStaticToolchain
} from './linux-static-toolchain.ts';

/** In-memory physical prerequisite, never reconstructible from policy/receipt JSON. */
export interface QualifiedLinuxDockerCli {
  readonly identityDigest: `sha256:${string}`;
  readonly originIdentityDigest: `sha256:${string}`;
  readonly deadlineAtUnixMs: number;
  readonly signal: AbortSignal;
  assertCurrent(): Promise<void>;
  close(): void;
}

type Inputs = Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  toolchain: RetainedLinuxDockerStaticToolchain;
  runtimeState: LinuxDockerRuntimeState;
  endpoint: LinuxDockerEndpoint;
  workingDirectory: RetainedNoFollowChildProcessDirectory;
  deadlineAtUnixMs: number;
}>;

const issued = new WeakMap<object, Inputs>();
const closedQualifications = new WeakSet<object>();

export function assertQualifiedLinuxDockerCli(value: QualifiedLinuxDockerCli): void {
  const retained = issued.get(value);
  if (retained === undefined) throw new Error('Linux Docker CLI qualification is not owner-issued.');
  if (closedQualifications.has(value) || Date.now() >= retained.deadlineAtUnixMs) {
    throw new Error('Linux Docker CLI qualification is closed or expired.');
  }
  assertAuthenticatedGitHubJobOriginCurrent(retained.origin);
}

/** Exact physical resource matching at the command-provider transfer boundary. */
export function assertQualifiedLinuxDockerCliBinding(value: QualifiedLinuxDockerCli, input: Readonly<{
  executable: unknown;
  workingDirectory: unknown;
  runtimeState: unknown;
  endpoint: unknown;
}>): void {
  assertQualifiedLinuxDockerCli(value);
  const record = issued.get(value)!;
  assertAuthenticatedGitHubJobOriginCurrent(record.origin);
  if (input.executable !== linuxDockerStaticToolchainInputs(record.toolchain).docker
      || input.workingDirectory !== record.workingDirectory || input.runtimeState !== record.runtimeState
      || input.endpoint !== record.endpoint) {
    throw new Error('Linux Docker CLI qualification does not bind these retained inputs.');
  }
}

/**
 * Origin issuance belongs to the GitHub provider. It binds the reviewed fresh
 * job/bootstrap and candidate-isolated lifetime under the accepted VM/kernel/
 * administrator TCB. A forwarded/stolen origin credential or compromised
 * trusted administrator is outside that premise; directory readback cannot
 * repair either. This owner checks the actual Docker resources independently.
 */
export async function qualifyLinuxDockerCli(input: Inputs): Promise<QualifiedLinuxDockerCli> {
  input = Object.freeze({ ...input });
  const origin = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || Date.now() >= input.deadlineAtUnixMs
      || input.deadlineAtUnixMs > origin.originalDeadlineAtUnixMs) {
    throw new Error('Linux Docker CLI deadline exceeds the original authenticated job lifetime.');
  }
  let closed = false;
  const assertCurrent = async (): Promise<void> => {
    if (closed) throw new Error('Linux Docker CLI qualification is closed.');
    const current = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    if (current.identityDigest !== origin.identityDigest || Date.now() >= input.deadlineAtUnixMs
        || input.deadlineAtUnixMs > current.originalDeadlineAtUnixMs) {
      throw new Error('Linux Docker CLI authenticated lifetime changed or expired.');
    }
    await assertRetainedLinuxDockerStaticToolchain(input.toolchain);
    assertRetainedNoFollowCapability(input.workingDirectory, 'working-directory', 'Linux Docker CLI working directory');
    input.workingDirectory.assertCurrent();
    assertLinuxDockerCliRuntimeState(input.runtimeState, input.toolchain);
    assertLinuxDockerEndpoint(input.endpoint, { endpointHost: DOCKER_LINUX_INSTALLATION_PROFILE.endpointHost,
      peerUid: DOCKER_LINUX_INSTALLATION_PROFILE.daemonPeerUid });
    // The asynchronous static-generation authority read cannot renew origin TTL.
    assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    if (Date.now() >= input.deadlineAtUnixMs) throw new Error('Linux Docker CLI original deadline expired.');
  };
  await assertCurrent();
  const value = Object.freeze({
    originIdentityDigest: origin.identityDigest,
    identityDigest: sha256({ domain: 'sec.docker.qualified-linux-cli',
      profile: LINUX_DOCKER_CLI_PROFILE_DIGEST, origin: origin.identityDigest,
      toolchain: input.toolchain.identityDigest, runtimeState: input.runtimeState.identityDigest,
      endpoint: input.endpoint.identityDigest, workingDirectory: input.workingDirectory.childPath,
      deadlineAtUnixMs: input.deadlineAtUnixMs }) as `sha256:${string}`,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    signal: getAuthenticatedGitHubJobOriginSignal(input.origin),
    assertCurrent,
    close: () => { closed = true; closedQualifications.add(value); input.toolchain.close(); }
  });
  issued.set(value, input);
  return value;
}
