import type {
  SecBoundSemanticOperation,
  SecProviderSettlementReceipt
} from '../../../system-architecture/operation/semantic.ts';
import type { DockerEndpointIdentity } from './daemon.ts';

export type ContainerEngineOperation =
  | Readonly<{ kind: 'buildx-bake'; arguments: readonly string[] }>
  | Readonly<{ kind: 'buildx-build'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-copy'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-create'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-exec'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-inspect'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-list'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-remove'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-run'; arguments: readonly string[] }>
  | Readonly<{ kind: 'container-start'; arguments: readonly string[] }>
  | Readonly<{ kind: 'image-inspect'; arguments: readonly string[] }>
  | Readonly<{ kind: 'image-list'; arguments: readonly string[] }>
  | Readonly<{ kind: 'image-remove'; arguments: readonly string[] }>
  | Readonly<{ kind: 'network-disconnect'; arguments: readonly string[] }>
  | Readonly<{ kind: 'volume-create'; arguments: readonly string[] }>
  | Readonly<{ kind: 'volume-inspect'; arguments: readonly string[] }>;

export interface ContainerEngineCommandResult {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface ContainerEngineOperationOptions {
  readonly input?: Uint8Array;
  readonly acceptedCodes?: readonly number[];
  readonly acceptAnyExitCode?: boolean;
  readonly maxStdinBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly stallTimeoutMs?: number;
  readonly admitProgress?: (chunk: Buffer, stream: 'stdout' | 'stderr') => boolean;
}

/**
 * One retained Docker executable/cwd/endpoint transport. It owns only the
 * external Container Engine effect; its result cannot sign Verification
 * terminal state or evidence.
 */
export interface ContainerEngineSession {
  readonly endpoint: DockerEndpointIdentity;
  readonly cwd: string;
  readonly executable: string;
  readonly deadlineAtUnixMs: number;
  execute(
    operation: ContainerEngineOperation,
    options?: ContainerEngineOperationOptions
  ): Promise<ContainerEngineCommandResult>;
  close(): SecProviderSettlementReceipt;
}

export interface OpenContainerEngineSessionInput {
  readonly operation: SecBoundSemanticOperation;
  readonly signal?: AbortSignal;
  readonly cwd: string;
  readonly availability: 'observe' | 'ensure-started';
  readonly expectedEndpoint?: DockerEndpointIdentity;
}
