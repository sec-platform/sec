import type {
  BoundSemanticOperation,
  OperationDigest,
  ProviderSettlementReceipt
} from '../../../../execution/operation/semantic.ts';
import type { DockerCommandProviderCapability } from './command-provider.ts';
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
  /** Runtime-issued identity of the retained executable/cwd/endpoint provider. */
  readonly providerIdentityDigest: OperationDigest;
  openOperationScope(input: Readonly<{
    operation: BoundSemanticOperation;
    requirementId: string;
  }>): ContainerEngineOperationScope;
  /** Independent exact endpoint/daemon readback outside any Effect scope. */
  observeEndpoint(): Promise<DockerEndpointIdentity>;
  /** Executes only inside the one currently open, unsettled scope. */
  execute(
    operation: ContainerEngineOperation,
    options?: ContainerEngineOperationOptions
  ): Promise<ContainerEngineCommandResult>;
  /** Physical session close only; never signs a semantic operation settlement. */
  close(): void;
}

export interface ContainerEngineOperationScope {
  readonly operationIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly requirementId: string;
  settle(): ProviderSettlementReceipt;
}

export interface OpenContainerEngineSessionInput {
  readonly operation: BoundSemanticOperation;
  readonly provider: DockerCommandProviderCapability;
  readonly signal?: AbortSignal;
  readonly cwd: string;
  readonly availability: 'observe' | 'ensure-started';
  readonly expectedEndpoint?: DockerEndpointIdentity;
}
