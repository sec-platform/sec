import path from 'node:path';
import type { AuthenticatedGitHubJobOrigin } from '../../adapters/providers/github-api/hosted-job-origin.ts';
import { createHostedActionTerminalStagePorts } from '../../adapters/verification/platform/ci/verification-cli.ts';
import {
  anchorHostedActionTerminal as anchorTerminal,
  assembleHostedActionTerminal as assembleTerminal,
  prepareHostedActionTerminalAnchor as prepareAnchor,
  type HostedActionTerminalInput,
  type HostedActionTerminalPorts
} from '../../application/hosted-action-terminal.ts';
import type { VerificationActionKeyDigest } from '../../execution/verification/action.ts';

type NativePorts = ReturnType<typeof createHostedActionTerminalStagePorts>;
type Transaction = Awaited<ReturnType<NativePorts['coordinateChild']>>;
type Index = ReturnType<NativePorts['providerIndex']>;
type TerminalValues = {
  providerEnvelope: ReturnType<NativePorts['readProviderEnvelope']>;
  envelope: ReturnType<NativePorts['readHostedEnvelope']>;
  actionRequest: ReturnType<NativePorts['parseActionRequest']>;
  resolution: ReturnType<NativePorts['resolveAction']>;
  ticket: ReturnType<NativePorts['readExecutionTicket']>;
  rawResult: ReturnType<NativePorts['readRawResult']>;
  producer: ReturnType<NativePorts['producer']>;
  repositoryIdentity: ReturnType<NativePorts['repositoryIdentity']>;
  snapshot: Transaction['snapshot'];
  transaction: Transaction;
  index: Index;
  marker: NonNullable<Index['startObservations'][number]['payload']>;
  start: Index['startObservations'][number];
  status: Index['providerStatusReadbacks'][number]['statuses'][number];
  terminal: Index['terminalObservations'][number];
  anchor: ReturnType<NativePorts['createAnchor']>;
  artifact: ReturnType<NativePorts['assembleTerminal']>;
  inventory: ReturnType<NativePorts['inventoryClosureFromTicket']>;
  decision: ReturnType<NativePorts['reduceProvider']>;
};

function stagePorts(origin: AuthenticatedGitHubJobOrigin): HostedActionTerminalPorts<TerminalValues> {
  return createHostedActionTerminalStagePorts(origin);
}

export async function assembleHostedActionTerminal(origin: AuthenticatedGitHubJobOrigin,
  input: HostedActionTerminalInput & Readonly<{
    ticketPath: string; rawResultPath: string; expectedRawResultDigest: VerificationActionKeyDigest; outputPath: string;
  }>) {
  return await assembleTerminal<TerminalValues>({ ...input, outputPath: path.resolve(input.outputPath) }, stagePorts(origin));
}

export async function prepareHostedActionTerminalAnchor(origin: AuthenticatedGitHubJobOrigin,
  input: HostedActionTerminalInput & Readonly<{ outputPath: string }>) {
  return await prepareAnchor<TerminalValues>({ ...input, outputPath: path.resolve(input.outputPath) }, stagePorts(origin));
}

export async function anchorHostedActionTerminal(origin: AuthenticatedGitHubJobOrigin, input: HostedActionTerminalInput) {
  return await anchorTerminal<TerminalValues>(input, stagePorts(origin));
}
